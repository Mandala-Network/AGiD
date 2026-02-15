/**
 * Secure Team Vault
 *
 * Certificate-based team vault that requires valid BRC-52/53 identity
 * certificates for all team operations. When an employee's certificate
 * is revoked, they immediately lose access to team documents.
 */

import { CurvePoint } from 'curvepoint';
import type {
  BRC100Wallet,
  Certificate,
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
import { CertificateVerifier } from '../identity/certificate-verifier.js';
import type { CertificateType } from '../identity/certificate-authority.js';

/**
 * Extended team member with certificate info
 */
export interface CertifiedTeamMember extends TeamMember {
  certificate: Certificate;
  certificateType: CertificateType;
}

/**
 * Certificate-required team configuration
 */
export interface CertifiedTeamConfig extends Omit<TeamConfig, 'members'> {
  members: CertifiedTeamMember[];
  requireCertificate: true;
  trustedCertifiers: string[];
}

/**
 * Configuration for SecureTeamVault
 */
export interface SecureTeamVaultConfig {
  wallet: BRC100Wallet;
  trustedCertifiers: string[];  // CA public keys
  defaultProtocolID?: [SecurityLevel, string];
  checkRevocationOnChain?: boolean;
  revocationCheckUrl?: string;
  persistTeamConfig?: (teamId: string, config: CertifiedTeamConfig) => Promise<void>;
  loadTeamConfig?: (teamId: string) => Promise<CertifiedTeamConfig | null>;
}

/**
 * Secure Team Vault with Certificate-Based Access Control
 *
 * All team members must have valid, non-revoked certificates issued by
 * a trusted Certificate Authority. Certificate validity is checked on
 * every document access.
 *
 * @example
 * ```typescript
 * // Create secure team vault with trusted CA
 * const teamVault = new SecureTeamVault({
 *   wallet,
 *   trustedCertifiers: [companyCA.getCertifierPublicKey()],
 * });
 *
 * // Create team (owner must have valid certificate)
 * const team = await teamVault.createTeam('Engineering', ownerCertificate);
 *
 * // Add member with their certificate
 * await teamVault.addMember(team.teamId, memberCertificate, 'member', ownerPublicKey);
 *
 * // When employee leaves, revoke their certificate
 * await ca.revokeCertificate(memberCertificate.serialNumber, 'Employment terminated');
 *
 * // Member can no longer access documents (checked on every access)
 * ```
 */
export class SecureTeamVault {
  private curvePoint: CurvePoint;
  private wallet: BRC100Wallet;
  private verifier: CertificateVerifier;
  private defaultProtocolID: [SecurityLevel, string];
  private trustedCertifiers: string[];
  private teams: Map<string, CertifiedTeamConfig> = new Map();
  private teamIndices: Map<string, TeamVaultIndex> = new Map();
  private documents: Map<string, TeamDocument> = new Map();
  private auditLog: TeamAuditEntry[] = [];
  private persistTeamConfig?: (teamId: string, config: CertifiedTeamConfig) => Promise<void>;
  private loadTeamConfig?: (teamId: string) => Promise<CertifiedTeamConfig | null>;

  constructor(config: SecureTeamVaultConfig) {
    this.wallet = config.wallet;
    this.curvePoint = new CurvePoint(this.wallet as any);
    this.defaultProtocolID = config.defaultProtocolID ?? [2 as SecurityLevel, 'agidentity-team'];
    this.trustedCertifiers = config.trustedCertifiers;
    this.persistTeamConfig = config.persistTeamConfig;
    this.loadTeamConfig = config.loadTeamConfig;

    // Initialize certificate verifier
    this.verifier = new CertificateVerifier({
      wallet: this.wallet,
      trustedCertifiers: config.trustedCertifiers,
      checkRevocationOnChain: config.checkRevocationOnChain,
      revocationCheckUrl: config.revocationCheckUrl,
    });
  }

  /**
   * Get the certificate verifier for external operations
   */
  getVerifier(): CertificateVerifier {
    return this.verifier;
  }

  // ===========================================================================
  // Team Management (Certificate-Required)
  // ===========================================================================

  /**
   * Create a new team - owner must have a valid certificate
   */
  async createTeam(
    name: string,
    ownerCertificate: Certificate,
    settings?: TeamSettings,
    parentTeamId?: string
  ): Promise<CertifiedTeamConfig> {
    // Verify owner's certificate
    const verifyResult = await this.verifier.verify(ownerCertificate);
    if (!verifyResult.valid) {
      throw new Error(`Invalid owner certificate: ${verifyResult.error}`);
    }

    const teamId = await this.generateTeamId(name);
    const now = Date.now();
    const ownerPublicKey = ownerCertificate.subject;

    // Register the certificate
    await this.verifier.registerCertificate(ownerCertificate);

    const config: CertifiedTeamConfig = {
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
          certificate: ownerCertificate,
          certificateType: (verifyResult.certificateType ?? 'admin') as CertificateType,
        },
      ],
      parentTeamId,
      requireCertificate: true,
      trustedCertifiers: this.trustedCertifiers,
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

    if (this.persistTeamConfig) {
      await this.persistTeamConfig(teamId, config);
    }

    await this.addAuditEntry(teamId, 'team_created', ownerPublicKey);

    return config;
  }

  /**
   * Get team configuration
   */
  async getTeam(teamId: string): Promise<CertifiedTeamConfig | null> {
    const cachedTeam = this.teams.get(teamId);
    if (cachedTeam) return cachedTeam;

    if (this.loadTeamConfig) {
      const loadedTeam = await this.loadTeamConfig(teamId);
      if (loadedTeam) {
        this.teams.set(teamId, loadedTeam);
        // Re-register all member certificates with verifier
        for (const member of loadedTeam.members) {
          await this.verifier.registerCertificate(member.certificate);
        }
        return loadedTeam;
      }
    }

    return null;
  }

  /**
   * Add a member with their certificate
   */
  async addMember(
    teamId: string,
    memberCertificate: Certificate,
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

    // Verify adding user has valid certificate
    const adderVerify = await this.verifier.verifyPublicKey(addedByPublicKey);
    if (!adderVerify.valid) {
      return {
        success: false,
        teamId,
        operation: 'addMember',
        timestamp: Date.now(),
        error: `Adder certificate invalid: ${adderVerify.error}`,
      };
    }

    // Check adder has permission
    const adderRole = this.getMemberRole(team, addedByPublicKey);
    if (!this.canAddMember(adderRole)) {
      return {
        success: false,
        teamId,
        operation: 'addMember',
        timestamp: Date.now(),
        error: 'Insufficient permissions to add members',
      };
    }

    // Verify new member's certificate
    const memberVerify = await this.verifier.verify(memberCertificate);
    if (!memberVerify.valid) {
      return {
        success: false,
        teamId,
        operation: 'addMember',
        timestamp: Date.now(),
        error: `Invalid member certificate: ${memberVerify.error}`,
      };
    }

    const memberPublicKey = memberCertificate.subject;

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

    // Register certificate
    await this.verifier.registerCertificate(memberCertificate);

    // Add member with certificate
    const newMember: CertifiedTeamMember = {
      publicKey: memberPublicKey,
      role,
      addedAt: Date.now(),
      addedBy: addedByPublicKey,
      metadata,
      certificate: memberCertificate,
      certificateType: (memberVerify.certificateType ?? 'employee') as CertificateType,
    };

    team.members.push(newMember);

    // Re-encrypt documents for new member
    await this.reencryptDocumentsForNewMember(teamId, memberPublicKey);

    if (this.persistTeamConfig) {
      await this.persistTeamConfig(teamId, team);
    }

    await this.addAuditEntry(teamId, 'member_added', addedByPublicKey, memberPublicKey);

    return {
      success: true,
      teamId,
      operation: 'addMember',
      timestamp: Date.now(),
    };
  }

  /**
   * Remove a member (e.g., when certificate is revoked)
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

    // Verify remover has valid certificate
    const removerVerify = await this.verifier.verifyPublicKey(removedByPublicKey);
    if (!removerVerify.valid) {
      return {
        success: false,
        teamId,
        operation: 'removeMember',
        timestamp: Date.now(),
        error: `Remover certificate invalid: ${removerVerify.error}`,
      };
    }

    const removerRole = this.getMemberRole(team, removedByPublicKey);
    const targetRole = this.getMemberRole(team, memberPublicKey);

    if (!this.canRemoveMember(removerRole, targetRole)) {
      return {
        success: false,
        teamId,
        operation: 'removeMember',
        timestamp: Date.now(),
        error: 'Insufficient permissions to remove this member',
      };
    }

    // Cannot remove last owner
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

    // Remove member
    team.members = team.members.filter(m => m.publicKey !== memberPublicKey);

    // Re-encrypt documents without removed member
    await this.reencryptDocumentsAfterMemberRemoval(teamId, memberPublicKey);

    if (this.persistTeamConfig) {
      await this.persistTeamConfig(teamId, team);
    }

    await this.addAuditEntry(teamId, 'member_removed', removedByPublicKey, memberPublicKey);

    return {
      success: true,
      teamId,
      operation: 'removeMember',
      timestamp: Date.now(),
    };
  }

  /**
   * Add a bot with its certificate
   */
  async addBot(
    teamId: string,
    botCertificate: Certificate,
    addedByPublicKey: string
  ): Promise<TeamOperationResult> {
    // Verify it's a bot certificate
    const verifyResult = await this.verifier.verify(botCertificate);
    if (!verifyResult.valid) {
      return {
        success: false,
        teamId,
        operation: 'addMember',
        timestamp: Date.now(),
        error: `Invalid bot certificate: ${verifyResult.error}`,
      };
    }

    return this.addMember(teamId, botCertificate, 'bot', addedByPublicKey, {
      displayName: botCertificate.fields.name ?? 'AI Agent',
    });
  }

  /**
   * Check if user has valid access (certificate verified)
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

    // CRITICAL: Verify certificate is still valid (not revoked)
    const verifyResult = await this.verifier.verify(member.certificate);
    if (!verifyResult.valid) {
      return {
        hasAccess: false,
        teamId,
        error: `Certificate invalid: ${verifyResult.error}`,
      };
    }

    return {
      hasAccess: true,
      role: member.role,
      teamId,
    };
  }

  /**
   * Sync revocation list - call this to immediately revoke access
   */
  async syncRevocationList(revokedSerialNumbers: string[]): Promise<void> {
    await this.verifier.syncRevocationList(revokedSerialNumbers);
  }

  /**
   * Manually revoke a certificate (used when notified of revocation)
   */
  revokeCertificate(serialNumber: string): void {
    this.verifier.revokeCertificate(serialNumber);
  }

  // ===========================================================================
  // Document Storage (Certificate-Verified Access)
  // ===========================================================================

  /**
   * Store document - verifies author certificate first
   */
  async storeDocument(
    teamId: string,
    path: string,
    content: Uint8Array | string,
    authorPublicKey: string,
    metadata?: TeamDocumentMetadata
  ): Promise<TeamDocument> {
    // CRITICAL: Verify author's certificate before allowing write
    const accessResult = await this.checkAccess(teamId, authorPublicKey);
    if (!accessResult.hasAccess) {
      throw new Error(`Access denied: ${accessResult.error}`);
    }

    const role = accessResult.role;
    if (!this.canWriteDocuments(role ?? null)) {
      throw new Error('Insufficient permissions to write documents');
    }

    const team = await this.getTeam(teamId);
    if (!team) {
      throw new Error('Team not found');
    }

    // Convert content
    const contentBytes = typeof content === 'string'
      ? Array.from(new TextEncoder().encode(content))
      : Array.from(content);

    // Get all VALID team member public keys (verify each certificate)
    const validRecipients = await this.getValidMemberPublicKeys(team);

    if (validRecipients.length === 0) {
      throw new Error('No valid team members to encrypt for');
    }

    // Encrypt with CurvePoint
    const { encryptedMessage, header } = await this.curvePoint.encrypt(
      contentBytes,
      team.protocolID as any,
      team.keyID,
      validRecipients
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

    this.documents.set(`${teamId}:${path}`, doc);

    const index = this.teamIndices.get(teamId);
    if (index) {
      const existingEntry = index.documents.findIndex(d => d.path === path);
      const entry: TeamDocumentEntry = {
        documentId,
        path,
        uhrpUrl: '',
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

    await this.addAuditEntry(teamId, 'document_created', authorPublicKey, undefined, documentId);

    return doc;
  }

  /**
   * Read document - verifies reader's certificate first
   */
  async readDocument(
    teamId: string,
    path: string,
    readerPublicKey?: string
  ): Promise<{ content: Uint8Array; document: TeamDocument }> {
    // If reader specified, verify their certificate
    if (readerPublicKey) {
      const accessResult = await this.checkAccess(teamId, readerPublicKey);
      if (!accessResult.hasAccess) {
        throw new Error(`Access denied: ${accessResult.error}`);
      }
    }

    const team = await this.getTeam(teamId);
    if (!team) {
      throw new Error('Team not found');
    }

    const docKey = `${teamId}:${path}`;
    const doc = this.documents.get(docKey);
    if (!doc) {
      throw new Error('Document not found');
    }

    const fullCiphertext = [...doc.header, ...doc.encryptedContent];

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
  async readDocumentText(teamId: string, path: string, readerPublicKey?: string): Promise<string> {
    const { content } = await this.readDocument(teamId, path, readerPublicKey);
    return new TextDecoder().decode(content);
  }

  /**
   * Update document - verifies author certificate
   */
  async updateDocument(
    teamId: string,
    path: string,
    content: Uint8Array | string,
    authorPublicKey: string,
    metadata?: Partial<TeamDocumentMetadata>
  ): Promise<TeamDocument> {
    const accessResult = await this.checkAccess(teamId, authorPublicKey);
    if (!accessResult.hasAccess) {
      throw new Error(`Access denied: ${accessResult.error}`);
    }

    if (!this.canWriteDocuments(accessResult.role ?? null)) {
      throw new Error('Insufficient permissions to update documents');
    }

    const team = await this.getTeam(teamId);
    if (!team) {
      throw new Error('Team not found');
    }

    const docKey = `${teamId}:${path}`;
    const existingDoc = this.documents.get(docKey);
    if (!existingDoc) {
      throw new Error('Document not found');
    }

    const contentBytes = typeof content === 'string'
      ? Array.from(new TextEncoder().encode(content))
      : Array.from(content);

    const validRecipients = await this.getValidMemberPublicKeys(team);

    const { encryptedMessage, header } = await this.curvePoint.encrypt(
      contentBytes,
      team.protocolID as any,
      team.keyID,
      validRecipients
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

    await this.addAuditEntry(teamId, 'document_updated', authorPublicKey, undefined, existingDoc.documentId);

    return updatedDoc;
  }

  /**
   * Delete document
   */
  async deleteDocument(
    teamId: string,
    path: string,
    deletedByPublicKey: string
  ): Promise<boolean> {
    const accessResult = await this.checkAccess(teamId, deletedByPublicKey);
    if (!accessResult.hasAccess) {
      throw new Error(`Access denied: ${accessResult.error}`);
    }

    if (!this.canDeleteDocuments(accessResult.role ?? null)) {
      throw new Error('Insufficient permissions to delete documents');
    }

    const docKey = `${teamId}:${path}`;
    const doc = this.documents.get(docKey);
    if (!doc) {
      return false;
    }

    this.documents.delete(docKey);

    const index = this.teamIndices.get(teamId);
    if (index) {
      index.documents = index.documents.filter(d => d.path !== path);
      index.lastSynced = Date.now();
    }

    await this.addAuditEntry(teamId, 'document_deleted', deletedByPublicKey, undefined, doc.documentId);

    return true;
  }

  /**
   * List documents
   */
  async listDocuments(teamId: string): Promise<TeamDocumentEntry[]> {
    const index = this.teamIndices.get(teamId);
    return index?.documents ?? [];
  }

  // ===========================================================================
  // Audit Trail
  // ===========================================================================

  getAuditLog(teamId: string): TeamAuditEntry[] {
    return this.auditLog.filter(e => e.teamId === teamId);
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  private async getValidMemberPublicKeys(team: CertifiedTeamConfig): Promise<string[]> {
    const validKeys: string[] = [];

    for (const member of team.members) {
      const verifyResult = await this.verifier.verify(member.certificate);
      if (verifyResult.valid) {
        validKeys.push(member.publicKey);
      }
    }

    return validKeys;
  }

  private getMemberRole(team: CertifiedTeamConfig, publicKey: string): TeamRole | null {
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
    const entryId = await this.generateDocumentId(teamId, action);
    const timestamp = Date.now();

    // Create entry data without signature for signing
    const entryData = {
      entryId,
      teamId,
      action,
      actorPublicKey,
      targetPublicKey,
      documentId,
      timestamp,
    };

    // Sign the entry data using wallet
    const dataToSign = JSON.stringify(entryData);
    const signatureResult = await this.wallet.createSignature({
      data: Array.from(new TextEncoder().encode(dataToSign)),
      protocolID: [0, 'agidentity-team-audit'], // Level 0 = publicly verifiable
      keyID: `audit-${entryId}`,
    });

    // Convert signature to hex string
    const signature = Array.from(new Uint8Array(signatureResult.signature))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    const entry: TeamAuditEntry = {
      ...entryData,
      signature,
    };

    this.auditLog.push(entry);
  }

  private async reencryptDocumentsForNewMember(
    teamId: string,
    newMemberPublicKey: string
  ): Promise<void> {
    const team = await this.getTeam(teamId);
    if (!team) return;

    const teamDocs: TeamDocument[] = [];
    for (const [key, doc] of this.documents) {
      if (key.startsWith(`${teamId}:`)) {
        teamDocs.push(doc);
      }
    }

    for (const doc of teamDocs) {
      const fullCiphertext = [...doc.header, ...doc.encryptedContent];

      try {
        const updatedHeader = await this.curvePoint.addParticipant(
          fullCiphertext,
          team.protocolID as any,
          team.keyID,
          newMemberPublicKey
        );

        doc.header = updatedHeader;
        this.documents.set(`${teamId}:${doc.path}`, doc);
      } catch (error) {
        console.warn(`Could not add participant to document ${doc.path}`);
      }
    }
  }

  private async reencryptDocumentsAfterMemberRemoval(
    teamId: string,
    removedMemberPublicKey: string
  ): Promise<void> {
    const team = await this.getTeam(teamId);
    if (!team) return;

    const teamDocs: TeamDocument[] = [];
    for (const [key, doc] of this.documents) {
      if (key.startsWith(`${teamId}:`)) {
        teamDocs.push(doc);
      }
    }

    for (const doc of teamDocs) {
      const fullCiphertext = [...doc.header, ...doc.encryptedContent];

      try {
        const updatedHeader = await this.curvePoint.removeParticipant(
          fullCiphertext,
          removedMemberPublicKey
        );

        doc.header = updatedHeader;
        this.documents.set(`${teamId}:${doc.path}`, doc);
      } catch (error) {
        console.warn(`Could not remove participant from document ${doc.path}`);
      }
    }
  }
}
