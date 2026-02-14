/**
 * Team Vault
 *
 * Group encryption support for team collaboration using CurvePoint.
 * Enables multiple team members to access shared encrypted documents
 * with role-based access control.
 */

import { CurvePoint } from 'curvepoint';
import type {
  BRC100Wallet,
  TeamConfig,
  TeamMember,
  TeamRole,
  TeamDocument,
  TeamDocumentMetadata,
  TeamVaultIndex,
  TeamDocumentEntry,
  TeamOperationResult,
  TeamAccessResult,
  TeamAuditEntry,
  TeamAction,
  TeamSettings,
  SecurityLevel,
} from '../types/index.js';

/**
 * Configuration for TeamVault
 */
export interface TeamVaultConfig {
  wallet: BRC100Wallet;
  defaultProtocolID?: [SecurityLevel, string];
  persistTeamConfig?: (teamId: string, config: TeamConfig) => Promise<void>;
  loadTeamConfig?: (teamId: string) => Promise<TeamConfig | null>;
}

/**
 * Team Vault - Group encryption for team collaboration
 *
 * Uses CurvePoint to encrypt documents that can be decrypted by any team member.
 * The symmetric key is encrypted for each member individually using ECDH.
 *
 * @example
 * ```typescript
 * const teamVault = new TeamVault({ wallet });
 *
 * // Create a new team
 * const team = await teamVault.createTeam('Engineering', ownerPublicKey);
 *
 * // Add team members
 * await teamVault.addMember(team.teamId, memberPublicKey, 'member');
 *
 * // Store encrypted document for the team
 * await teamVault.storeDocument(team.teamId, '/docs/readme.md', content);
 *
 * // Any team member can decrypt
 * const doc = await teamVault.readDocument(team.teamId, '/docs/readme.md');
 * ```
 */
export class TeamVault {
  private curvePoint: CurvePoint;
  private wallet: BRC100Wallet;
  private defaultProtocolID: [SecurityLevel, string];
  private teams: Map<string, TeamConfig> = new Map();
  private teamIndices: Map<string, TeamVaultIndex> = new Map();
  private documents: Map<string, TeamDocument> = new Map();
  private auditLog: TeamAuditEntry[] = [];
  private persistTeamConfig?: (teamId: string, config: TeamConfig) => Promise<void>;
  private loadTeamConfig?: (teamId: string) => Promise<TeamConfig | null>;

  constructor(config: TeamVaultConfig) {
    this.wallet = config.wallet;
    // CurvePoint uses BSV SDK WalletInterface which is compatible with BRC100Wallet
    this.curvePoint = new CurvePoint(this.wallet as any);
    this.defaultProtocolID = config.defaultProtocolID ?? [2 as SecurityLevel, 'agidentity-team'];
    this.persistTeamConfig = config.persistTeamConfig;
    this.loadTeamConfig = config.loadTeamConfig;
  }

  // ===========================================================================
  // Team Management
  // ===========================================================================

  /**
   * Create a new team with the creator as owner
   */
  async createTeam(
    name: string,
    ownerPublicKey: string,
    settings?: TeamSettings,
    parentTeamId?: string
  ): Promise<TeamConfig> {
    const teamId = await this.generateTeamId(name);
    const now = Date.now();

    const config: TeamConfig = {
      teamId,
      name,
      createdAt: now,
      createdBy: ownerPublicKey,
      protocolID: this.defaultProtocolID,
      keyID: `team-${teamId}`,
      members: [
        {
          publicKey: ownerPublicKey,
          role: 'owner',
          addedAt: now,
          addedBy: ownerPublicKey,
        },
      ],
      parentTeamId,
      settings: {
        allowMemberInvite: false,
        requireAdminApproval: true,
        maxMembers: 100,
        defaultMemberRole: 'member',
        botAccessLevel: 'member',
        ...settings,
      },
    };

    this.teams.set(teamId, config);
    this.teamIndices.set(teamId, {
      teamId,
      documents: [],
      lastSynced: now,
    });

    // Persist if configured
    if (this.persistTeamConfig) {
      await this.persistTeamConfig(teamId, config);
    }

    // Audit
    await this.addAuditEntry(teamId, 'team_created', ownerPublicKey);

    return config;
  }

  /**
   * Get team configuration
   */
  async getTeam(teamId: string): Promise<TeamConfig | null> {
    // Check local cache
    const cachedTeam = this.teams.get(teamId);
    if (cachedTeam) return cachedTeam;

    // Try loading from persistence
    if (this.loadTeamConfig) {
      const loadedTeam = await this.loadTeamConfig(teamId);
      if (loadedTeam) {
        this.teams.set(teamId, loadedTeam);
        return loadedTeam;
      }
    }

    return null;
  }

  /**
   * Add a member to a team
   */
  async addMember(
    teamId: string,
    memberPublicKey: string,
    role: TeamRole,
    addedByPublicKey: string,
    metadata?: TeamMember['metadata']
  ): Promise<TeamOperationResult> {
    const team = await this.getTeam(teamId);
    if (!team) {
      return {
        success: false,
        teamId,
        operation: 'addMember',
        timestamp: Date.now(),
        error: 'Team not found',
      };
    }

    // Check if requester has permission
    const requesterAccess = this.getMemberRole(team, addedByPublicKey);
    if (!this.canAddMember(requesterAccess)) {
      return {
        success: false,
        teamId,
        operation: 'addMember',
        timestamp: Date.now(),
        error: 'Insufficient permissions to add members',
      };
    }

    // Check if already a member
    if (team.members.some(m => m.publicKey === memberPublicKey)) {
      return {
        success: false,
        teamId,
        operation: 'addMember',
        timestamp: Date.now(),
        error: 'Already a team member',
      };
    }

    // Check max members
    if (team.settings?.maxMembers && team.members.length >= team.settings.maxMembers) {
      return {
        success: false,
        teamId,
        operation: 'addMember',
        timestamp: Date.now(),
        error: 'Team has reached maximum members',
      };
    }

    // Add the member
    const newMember: TeamMember = {
      publicKey: memberPublicKey,
      role,
      addedAt: Date.now(),
      addedBy: addedByPublicKey,
      metadata,
    };

    team.members.push(newMember);

    // Re-encrypt all existing documents for the new member
    await this.reencryptDocumentsForNewMember(teamId, memberPublicKey);

    // Persist
    if (this.persistTeamConfig) {
      await this.persistTeamConfig(teamId, team);
    }

    // Audit
    await this.addAuditEntry(teamId, 'member_added', addedByPublicKey, memberPublicKey);

    return {
      success: true,
      teamId,
      operation: 'addMember',
      timestamp: Date.now(),
    };
  }

  /**
   * Remove a member from a team
   */
  async removeMember(
    teamId: string,
    memberPublicKey: string,
    removedByPublicKey: string
  ): Promise<TeamOperationResult> {
    const team = await this.getTeam(teamId);
    if (!team) {
      return {
        success: false,
        teamId,
        operation: 'removeMember',
        timestamp: Date.now(),
        error: 'Team not found',
      };
    }

    // Check if requester has permission
    const requesterRole = this.getMemberRole(team, removedByPublicKey);
    const targetRole = this.getMemberRole(team, memberPublicKey);

    if (!this.canRemoveMember(requesterRole, targetRole)) {
      return {
        success: false,
        teamId,
        operation: 'removeMember',
        timestamp: Date.now(),
        error: 'Insufficient permissions to remove this member',
      };
    }

    // Cannot remove the last owner
    const owners = team.members.filter(m => m.role === 'owner');
    if (owners.length === 1 && owners[0].publicKey === memberPublicKey) {
      return {
        success: false,
        teamId,
        operation: 'removeMember',
        timestamp: Date.now(),
        error: 'Cannot remove the last owner',
      };
    }

    // Remove the member
    team.members = team.members.filter(m => m.publicKey !== memberPublicKey);

    // Re-encrypt all documents without the removed member
    await this.reencryptDocumentsAfterMemberRemoval(teamId, memberPublicKey);

    // Persist
    if (this.persistTeamConfig) {
      await this.persistTeamConfig(teamId, team);
    }

    // Audit
    await this.addAuditEntry(teamId, 'member_removed', removedByPublicKey, memberPublicKey);

    return {
      success: true,
      teamId,
      operation: 'removeMember',
      timestamp: Date.now(),
    };
  }

  /**
   * Check if a user has access to a team
   */
  async checkAccess(teamId: string, userPublicKey: string): Promise<TeamAccessResult> {
    const team = await this.getTeam(teamId);
    if (!team) {
      return { hasAccess: false, error: 'Team not found' };
    }

    const member = team.members.find(m => m.publicKey === userPublicKey);
    if (!member) {
      return { hasAccess: false, teamId, error: 'Not a team member' };
    }

    return {
      hasAccess: true,
      role: member.role,
      teamId,
    };
  }

  /**
   * Add a bot/agent to the team
   */
  async addBot(
    teamId: string,
    botPublicKey: string,
    addedByPublicKey: string
  ): Promise<TeamOperationResult> {
    const team = await this.getTeam(teamId);
    if (!team) {
      return {
        success: false,
        teamId,
        operation: 'addMember',
        timestamp: Date.now(),
        error: 'Team not found',
      };
    }

    // Use bot-specific role, but still mark as 'bot' type
    return this.addMember(teamId, botPublicKey, 'bot', addedByPublicKey, {
      displayName: 'AI Agent',
    });
  }

  // ===========================================================================
  // Document Storage (Group Encrypted)
  // ===========================================================================

  /**
   * Store a document encrypted for the entire team
   */
  async storeDocument(
    teamId: string,
    path: string,
    content: Uint8Array | string,
    authorPublicKey: string,
    metadata?: TeamDocumentMetadata
  ): Promise<TeamDocument> {
    const team = await this.getTeam(teamId);
    if (!team) {
      throw new Error('Team not found');
    }

    // Check write access
    const role = this.getMemberRole(team, authorPublicKey);
    if (!this.canWriteDocuments(role)) {
      throw new Error('Insufficient permissions to write documents');
    }

    // Convert content to bytes
    const contentBytes = typeof content === 'string'
      ? Array.from(new TextEncoder().encode(content))
      : Array.from(content);

    // Get all team member public keys
    const recipients = team.members.map(m => m.publicKey);

    // Encrypt with CurvePoint for the group
    // Cast protocolID to any since CurvePoint uses BSV SDK WalletProtocol type
    const { encryptedMessage, header } = await this.curvePoint.encrypt(
      contentBytes,
      team.protocolID as any,
      team.keyID,
      recipients
    );

    const now = Date.now();
    const documentId = await this.generateDocumentId(teamId, path);
    const contentHash = await this.hashContent(contentBytes);

    const doc: TeamDocument = {
      documentId,
      teamId,
      path,
      encryptedContent: encryptedMessage,
      header,
      createdAt: now,
      createdBy: authorPublicKey,
      lastModifiedAt: now,
      lastModifiedBy: authorPublicKey,
      contentHash,
      metadata,
    };

    // Store locally
    this.documents.set(`${teamId}:${path}`, doc);

    // Update index
    const index = this.teamIndices.get(teamId);
    if (index) {
      const existingEntry = index.documents.findIndex(d => d.path === path);
      const entry: TeamDocumentEntry = {
        documentId,
        path,
        uhrpUrl: '', // Would be set after UHRP upload
        keyId: team.keyID,
        lastModified: now,
        contentHash,
        createdBy: authorPublicKey,
      };

      if (existingEntry >= 0) {
        index.documents[existingEntry] = entry;
      } else {
        index.documents.push(entry);
      }
      index.lastSynced = now;
    }

    // Audit
    await this.addAuditEntry(teamId, 'document_created', authorPublicKey, undefined, documentId);

    return doc;
  }

  /**
   * Read a document (decrypt for current wallet holder)
   */
  async readDocument(
    teamId: string,
    path: string
  ): Promise<{ content: Uint8Array; document: TeamDocument }> {
    const team = await this.getTeam(teamId);
    if (!team) {
      throw new Error('Team not found');
    }

    const docKey = `${teamId}:${path}`;
    const doc = this.documents.get(docKey);
    if (!doc) {
      throw new Error('Document not found');
    }

    // Combine header and encrypted content for decryption
    const fullCiphertext = [...doc.header, ...doc.encryptedContent];

    // Decrypt with CurvePoint
    const decrypted = await this.curvePoint.decrypt(
      fullCiphertext,
      team.protocolID as any,
      team.keyID
    );

    return {
      content: new Uint8Array(decrypted),
      document: doc,
    };
  }

  /**
   * Read document as text
   */
  async readDocumentText(teamId: string, path: string): Promise<string> {
    const { content } = await this.readDocument(teamId, path);
    return new TextDecoder().decode(content);
  }

  /**
   * Update an existing document
   */
  async updateDocument(
    teamId: string,
    path: string,
    content: Uint8Array | string,
    authorPublicKey: string,
    metadata?: Partial<TeamDocumentMetadata>
  ): Promise<TeamDocument> {
    const team = await this.getTeam(teamId);
    if (!team) {
      throw new Error('Team not found');
    }

    const docKey = `${teamId}:${path}`;
    const existingDoc = this.documents.get(docKey);
    if (!existingDoc) {
      throw new Error('Document not found');
    }

    // Check write access
    const role = this.getMemberRole(team, authorPublicKey);
    if (!this.canWriteDocuments(role)) {
      throw new Error('Insufficient permissions to update documents');
    }

    // Create new encrypted version
    const contentBytes = typeof content === 'string'
      ? Array.from(new TextEncoder().encode(content))
      : Array.from(content);

    const recipients = team.members.map(m => m.publicKey);

    const { encryptedMessage, header } = await this.curvePoint.encrypt(
      contentBytes,
      team.protocolID as any,
      team.keyID,
      recipients
    );

    const now = Date.now();
    const contentHash = await this.hashContent(contentBytes);

    const updatedDoc: TeamDocument = {
      ...existingDoc,
      encryptedContent: encryptedMessage,
      header,
      lastModifiedAt: now,
      lastModifiedBy: authorPublicKey,
      contentHash,
      metadata: { ...existingDoc.metadata, ...metadata },
    };

    this.documents.set(docKey, updatedDoc);

    // Audit
    await this.addAuditEntry(teamId, 'document_updated', authorPublicKey, undefined, existingDoc.documentId);

    return updatedDoc;
  }

  /**
   * Delete a document
   */
  async deleteDocument(
    teamId: string,
    path: string,
    deletedByPublicKey: string
  ): Promise<boolean> {
    const team = await this.getTeam(teamId);
    if (!team) {
      return false;
    }

    const role = this.getMemberRole(team, deletedByPublicKey);
    if (!this.canDeleteDocuments(role)) {
      throw new Error('Insufficient permissions to delete documents');
    }

    const docKey = `${teamId}:${path}`;
    const doc = this.documents.get(docKey);
    if (!doc) {
      return false;
    }

    this.documents.delete(docKey);

    // Update index
    const index = this.teamIndices.get(teamId);
    if (index) {
      index.documents = index.documents.filter(d => d.path !== path);
      index.lastSynced = Date.now();
    }

    // Audit
    await this.addAuditEntry(teamId, 'document_deleted', deletedByPublicKey, undefined, doc.documentId);

    return true;
  }

  /**
   * List all documents in a team vault
   */
  async listDocuments(teamId: string): Promise<TeamDocumentEntry[]> {
    const index = this.teamIndices.get(teamId);
    return index?.documents ?? [];
  }

  // ===========================================================================
  // Hierarchical Teams
  // ===========================================================================

  /**
   * Create a sub-team under a parent team
   */
  async createSubTeam(
    parentTeamId: string,
    name: string,
    ownerPublicKey: string,
    settings?: TeamSettings
  ): Promise<TeamConfig> {
    const parentTeam = await this.getTeam(parentTeamId);
    if (!parentTeam) {
      throw new Error('Parent team not found');
    }

    // Owner must be a member of parent team
    const role = this.getMemberRole(parentTeam, ownerPublicKey);
    if (!role) {
      throw new Error('Must be a member of parent team to create sub-team');
    }

    return this.createTeam(name, ownerPublicKey, settings, parentTeamId);
  }

  /**
   * Get all sub-teams of a team
   */
  async getSubTeams(teamId: string): Promise<TeamConfig[]> {
    const subTeams: TeamConfig[] = [];
    for (const team of this.teams.values()) {
      if (team.parentTeamId === teamId) {
        subTeams.push(team);
      }
    }
    return subTeams;
  }

  // ===========================================================================
  // Audit Trail
  // ===========================================================================

  /**
   * Get audit log for a team
   */
  getAuditLog(teamId: string): TeamAuditEntry[] {
    return this.auditLog.filter(e => e.teamId === teamId);
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  private getMemberRole(team: TeamConfig, publicKey: string): TeamRole | null {
    const member = team.members.find(m => m.publicKey === publicKey);
    return member?.role ?? null;
  }

  private canAddMember(role: TeamRole | null): boolean {
    return role === 'owner' || role === 'admin';
  }

  private canRemoveMember(requesterRole: TeamRole | null, targetRole: TeamRole | null): boolean {
    if (!requesterRole) return false;
    if (requesterRole === 'owner') return true;
    if (requesterRole === 'admin' && targetRole !== 'owner' && targetRole !== 'admin') return true;
    return false;
  }

  private canWriteDocuments(role: TeamRole | null): boolean {
    return role === 'owner' || role === 'admin' || role === 'member' || role === 'bot';
  }

  private canDeleteDocuments(role: TeamRole | null): boolean {
    return role === 'owner' || role === 'admin';
  }

  private async generateTeamId(_name: string): Promise<string> {
    const timestamp = Date.now().toString(36);
    const random = crypto.getRandomValues(new Uint8Array(8));
    const randomHex = Array.from(random).map(b => b.toString(16).padStart(2, '0')).join('');
    return `team-${timestamp}-${randomHex}`;
  }

  private async generateDocumentId(teamId: string, path: string): Promise<string> {
    const data = new TextEncoder().encode(`${teamId}:${path}:${Date.now()}`);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
  }

  private async hashContent(content: number[]): Promise<string> {
    const hashBuffer = await crypto.subtle.digest('SHA-256', new Uint8Array(content));
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  private async addAuditEntry(
    teamId: string,
    action: TeamAction,
    actorPublicKey: string,
    targetPublicKey?: string,
    documentId?: string
  ): Promise<void> {
    const entry: TeamAuditEntry = {
      entryId: await this.generateDocumentId(teamId, action),
      teamId,
      action,
      actorPublicKey,
      targetPublicKey,
      documentId,
      timestamp: Date.now(),
      signature: '', // Would be signed in production
    };

    this.auditLog.push(entry);
  }

  private async reencryptDocumentsForNewMember(
    teamId: string,
    newMemberPublicKey: string
  ): Promise<void> {
    const team = await this.getTeam(teamId);
    if (!team) return;

    // Get all documents for this team
    const teamDocs: TeamDocument[] = [];
    for (const [key, doc] of this.documents) {
      if (key.startsWith(`${teamId}:`)) {
        teamDocs.push(doc);
      }
    }

    // Re-encrypt each document with the new member added
    for (const doc of teamDocs) {
      // Get the original content using CurvePoint's addParticipant
      // This adds the new member to existing documents
      const fullCiphertext = [...doc.header, ...doc.encryptedContent];

      try {
        // Use CurvePoint to add participant to existing header
        const updatedHeader = await this.curvePoint.addParticipant(
          fullCiphertext,
          team.protocolID as any,
          team.keyID,
          newMemberPublicKey
        );

        // Update the document with new header
        doc.header = updatedHeader;
        this.documents.set(`${teamId}:${doc.path}`, doc);
      } catch (error) {
        // If addParticipant fails, we need to re-encrypt the entire document
        // This happens if we can't decrypt the symmetric key
        console.warn(`Could not add participant to document ${doc.path}, skipping`);
      }
    }
  }

  private async reencryptDocumentsAfterMemberRemoval(
    teamId: string,
    removedMemberPublicKey: string
  ): Promise<void> {
    const team = await this.getTeam(teamId);
    if (!team) return;

    // Get all documents for this team
    const teamDocs: TeamDocument[] = [];
    for (const [key, doc] of this.documents) {
      if (key.startsWith(`${teamId}:`)) {
        teamDocs.push(doc);
      }
    }

    // Re-encrypt each document without the removed member
    for (const doc of teamDocs) {
      const fullCiphertext = [...doc.header, ...doc.encryptedContent];

      try {
        // Use CurvePoint to remove participant from header
        const updatedHeader = await this.curvePoint.removeParticipant(
          fullCiphertext,
          removedMemberPublicKey
        );

        // Update the document with new header
        doc.header = updatedHeader;
        this.documents.set(`${teamId}:${doc.path}`, doc);
      } catch (error) {
        console.warn(`Could not remove participant from document ${doc.path}, skipping`);
      }
    }
  }
}
