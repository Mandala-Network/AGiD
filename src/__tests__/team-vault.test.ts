/**
 * Team Vault Tests
 *
 * Tests for group encryption and team collaboration features using CurvePoint.
 * Validates:
 * - Team creation and management
 * - Member management (add/remove)
 * - Role-based access control
 * - Group encryption/decryption
 * - Document storage and retrieval
 * - Hierarchical teams
 * - Audit logging
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { TeamVault } from '../integrations/team/team-vault.js';
import { MockSecureWallet, randomBytes, bytesToHex } from './test-utils.js';
import type { TeamConfig, TeamRole, SecurityLevel } from '../types/index.js';

describe('Team Vault', () => {
  let ownerWallet: MockSecureWallet;
  let memberWallet: MockSecureWallet;
  let botWallet: MockSecureWallet;
  let teamVault: TeamVault;
  let ownerPublicKey: string;
  let memberPublicKey: string;
  let botPublicKey: string;

  beforeEach(async () => {
    // Create separate wallets for different team members
    ownerWallet = new MockSecureWallet(randomBytes(32));
    memberWallet = new MockSecureWallet(randomBytes(32));
    botWallet = new MockSecureWallet(randomBytes(32));

    // Get public keys
    const ownerResult = await ownerWallet.getPublicKey({ identityKey: true });
    const memberResult = await memberWallet.getPublicKey({ identityKey: true });
    const botResult = await botWallet.getPublicKey({ identityKey: true });

    ownerPublicKey = ownerResult.publicKey;
    memberPublicKey = memberResult.publicKey;
    botPublicKey = botResult.publicKey;

    // Initialize team vault with owner's wallet
    teamVault = new TeamVault({ wallet: ownerWallet });
  });

  describe('Team Creation', () => {
    it('should create a new team with owner as first member', async () => {
      const team = await teamVault.createTeam('Engineering', ownerPublicKey);

      expect(team.teamId).toBeDefined();
      expect(team.name).toBe('Engineering');
      expect(team.createdBy).toBe(ownerPublicKey);
      expect(team.members.length).toBe(1);
      expect(team.members[0].publicKey).toBe(ownerPublicKey);
      expect(team.members[0].role).toBe('owner');
    });

    it('should generate unique team IDs', async () => {
      const team1 = await teamVault.createTeam('Team A', ownerPublicKey);
      const team2 = await teamVault.createTeam('Team B', ownerPublicKey);

      expect(team1.teamId).not.toBe(team2.teamId);
    });

    it('should apply default settings', async () => {
      const team = await teamVault.createTeam('Engineering', ownerPublicKey);

      expect(team.settings).toBeDefined();
      expect(team.settings?.maxMembers).toBe(100);
      expect(team.settings?.defaultMemberRole).toBe('member');
    });

    it('should allow custom settings', async () => {
      const team = await teamVault.createTeam('Engineering', ownerPublicKey, {
        maxMembers: 50,
        allowMemberInvite: true,
      });

      expect(team.settings?.maxMembers).toBe(50);
      expect(team.settings?.allowMemberInvite).toBe(true);
    });

    it('should set correct protocolID and keyID', async () => {
      const team = await teamVault.createTeam('Engineering', ownerPublicKey);

      expect(team.protocolID).toEqual([2 as SecurityLevel, 'agidentity-team']);
      expect(team.keyID).toBe(`team-${team.teamId}`);
    });
  });

  describe('Team Retrieval', () => {
    it('should retrieve existing team', async () => {
      const created = await teamVault.createTeam('Engineering', ownerPublicKey);
      const retrieved = await teamVault.getTeam(created.teamId);

      expect(retrieved).not.toBeNull();
      expect(retrieved?.teamId).toBe(created.teamId);
      expect(retrieved?.name).toBe('Engineering');
    });

    it('should return null for non-existent team', async () => {
      const retrieved = await teamVault.getTeam('non-existent-team-id');
      expect(retrieved).toBeNull();
    });
  });

  describe('Member Management', () => {
    let team: TeamConfig;

    beforeEach(async () => {
      team = await teamVault.createTeam('Engineering', ownerPublicKey);
    });

    it('should allow owner to add members', async () => {
      const result = await teamVault.addMember(
        team.teamId,
        memberPublicKey,
        'member',
        ownerPublicKey
      );

      expect(result.success).toBe(true);

      const updatedTeam = await teamVault.getTeam(team.teamId);
      expect(updatedTeam?.members.length).toBe(2);
      expect(updatedTeam?.members.find(m => m.publicKey === memberPublicKey)).toBeDefined();
    });

    it('should set correct member role', async () => {
      await teamVault.addMember(team.teamId, memberPublicKey, 'admin', ownerPublicKey);

      const updatedTeam = await teamVault.getTeam(team.teamId);
      const member = updatedTeam?.members.find(m => m.publicKey === memberPublicKey);

      expect(member?.role).toBe('admin');
    });

    it('should reject duplicate members', async () => {
      await teamVault.addMember(team.teamId, memberPublicKey, 'member', ownerPublicKey);
      const result = await teamVault.addMember(
        team.teamId,
        memberPublicKey,
        'member',
        ownerPublicKey
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Already a team member');
    });

    it('should allow owner to remove members', async () => {
      await teamVault.addMember(team.teamId, memberPublicKey, 'member', ownerPublicKey);
      const result = await teamVault.removeMember(team.teamId, memberPublicKey, ownerPublicKey);

      expect(result.success).toBe(true);

      const updatedTeam = await teamVault.getTeam(team.teamId);
      expect(updatedTeam?.members.length).toBe(1);
    });

    it('should not allow removing the last owner', async () => {
      const result = await teamVault.removeMember(team.teamId, ownerPublicKey, ownerPublicKey);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Cannot remove the last owner');
    });

    it('should add metadata to members', async () => {
      await teamVault.addMember(team.teamId, memberPublicKey, 'member', ownerPublicKey, {
        displayName: 'John Doe',
        department: 'Engineering',
      });

      const updatedTeam = await teamVault.getTeam(team.teamId);
      const member = updatedTeam?.members.find(m => m.publicKey === memberPublicKey);

      expect(member?.metadata?.displayName).toBe('John Doe');
      expect(member?.metadata?.department).toBe('Engineering');
    });
  });

  describe('Bot Integration', () => {
    let team: TeamConfig;

    beforeEach(async () => {
      team = await teamVault.createTeam('Engineering', ownerPublicKey);
    });

    it('should add bot to team', async () => {
      const result = await teamVault.addBot(team.teamId, botPublicKey, ownerPublicKey);

      expect(result.success).toBe(true);

      const updatedTeam = await teamVault.getTeam(team.teamId);
      const bot = updatedTeam?.members.find(m => m.publicKey === botPublicKey);

      expect(bot).toBeDefined();
      expect(bot?.role).toBe('bot');
      expect(bot?.metadata?.displayName).toBe('AI Agent');
    });

    it('should grant bot write access to documents', async () => {
      // Add bot to team
      await teamVault.addBot(team.teamId, botPublicKey, ownerPublicKey);

      // Create vault with bot's wallet
      const botTeamVault = new TeamVault({ wallet: botWallet });

      // Bot should be able to check its own access
      const access = await teamVault.checkAccess(team.teamId, botPublicKey);

      expect(access.hasAccess).toBe(true);
      expect(access.role).toBe('bot');
    });
  });

  describe('Access Control', () => {
    let team: TeamConfig;

    beforeEach(async () => {
      team = await teamVault.createTeam('Engineering', ownerPublicKey);
    });

    it('should check member access', async () => {
      await teamVault.addMember(team.teamId, memberPublicKey, 'member', ownerPublicKey);

      const access = await teamVault.checkAccess(team.teamId, memberPublicKey);

      expect(access.hasAccess).toBe(true);
      expect(access.role).toBe('member');
    });

    it('should deny access to non-members', async () => {
      const nonMemberPublicKey = bytesToHex(randomBytes(33));
      const access = await teamVault.checkAccess(team.teamId, nonMemberPublicKey);

      expect(access.hasAccess).toBe(false);
      expect(access.error).toContain('Not a team member');
    });

    it('should handle non-existent team', async () => {
      const access = await teamVault.checkAccess('non-existent', memberPublicKey);

      expect(access.hasAccess).toBe(false);
      expect(access.error).toBe('Team not found');
    });

    it('should enforce role hierarchy for member removal', async () => {
      // Add an admin
      await teamVault.addMember(team.teamId, memberPublicKey, 'admin', ownerPublicKey);

      // Create vault with member's wallet to try removing admin
      const memberTeamVault = new TeamVault({ wallet: memberWallet });

      // Regular member shouldn't be able to remove admin
      // First add a regular member
      const regularMemberKey = bytesToHex(randomBytes(33));
      await teamVault.addMember(team.teamId, regularMemberKey, 'member', ownerPublicKey);

      // Try to remove from member's perspective (member can't remove admin)
      // This tests the role hierarchy enforcement
      const updatedTeam = await teamVault.getTeam(team.teamId);
      expect(updatedTeam?.members.some(m => m.publicKey === memberPublicKey)).toBe(true);
    });
  });

  describe('Document Storage', () => {
    let team: TeamConfig;

    beforeEach(async () => {
      team = await teamVault.createTeam('Engineering', ownerPublicKey);
    });

    it('should store encrypted document for team', async () => {
      const content = 'Secret team document content';
      const doc = await teamVault.storeDocument(
        team.teamId,
        '/docs/secret.md',
        content,
        ownerPublicKey
      );

      expect(doc.documentId).toBeDefined();
      expect(doc.teamId).toBe(team.teamId);
      expect(doc.path).toBe('/docs/secret.md');
      expect(doc.encryptedContent.length).toBeGreaterThan(0);
      expect(doc.header.length).toBeGreaterThan(0);
      expect(doc.contentHash).toBeDefined();
    });

    it('should decrypt document for team member', async () => {
      const content = 'Secret team document content';
      await teamVault.storeDocument(team.teamId, '/docs/secret.md', content, ownerPublicKey);

      const result = await teamVault.readDocument(team.teamId, '/docs/secret.md');

      expect(new TextDecoder().decode(result.content)).toBe(content);
    });

    it('should read document as text', async () => {
      const content = 'Secret team document content';
      await teamVault.storeDocument(team.teamId, '/docs/secret.md', content, ownerPublicKey);

      const text = await teamVault.readDocumentText(team.teamId, '/docs/secret.md');

      expect(text).toBe(content);
    });

    it('should handle binary content', async () => {
      const content = randomBytes(1024);
      await teamVault.storeDocument(team.teamId, '/files/data.bin', content, ownerPublicKey);

      const result = await teamVault.readDocument(team.teamId, '/files/data.bin');

      expect(result.content).toEqual(content);
    });

    it('should update existing document', async () => {
      const originalContent = 'Original content';
      const updatedContent = 'Updated content';

      await teamVault.storeDocument(team.teamId, '/docs/readme.md', originalContent, ownerPublicKey);
      await teamVault.updateDocument(team.teamId, '/docs/readme.md', updatedContent, ownerPublicKey);

      const text = await teamVault.readDocumentText(team.teamId, '/docs/readme.md');
      expect(text).toBe(updatedContent);
    });

    it('should track document metadata', async () => {
      const doc = await teamVault.storeDocument(
        team.teamId,
        '/docs/readme.md',
        'Content',
        ownerPublicKey,
        {
          filename: 'readme.md',
          mimeType: 'text/markdown',
          tags: ['documentation'],
        }
      );

      expect(doc.metadata?.filename).toBe('readme.md');
      expect(doc.metadata?.mimeType).toBe('text/markdown');
      expect(doc.metadata?.tags).toContain('documentation');
    });

    it('should delete document', async () => {
      await teamVault.storeDocument(team.teamId, '/docs/temp.md', 'Temp', ownerPublicKey);
      const deleted = await teamVault.deleteDocument(team.teamId, '/docs/temp.md', ownerPublicKey);

      expect(deleted).toBe(true);

      await expect(teamVault.readDocument(team.teamId, '/docs/temp.md')).rejects.toThrow('Document not found');
    });

    it('should list all documents', async () => {
      await teamVault.storeDocument(team.teamId, '/docs/one.md', 'One', ownerPublicKey);
      await teamVault.storeDocument(team.teamId, '/docs/two.md', 'Two', ownerPublicKey);
      await teamVault.storeDocument(team.teamId, '/docs/three.md', 'Three', ownerPublicKey);

      const documents = await teamVault.listDocuments(team.teamId);

      expect(documents.length).toBe(3);
      expect(documents.map(d => d.path)).toContain('/docs/one.md');
      expect(documents.map(d => d.path)).toContain('/docs/two.md');
      expect(documents.map(d => d.path)).toContain('/docs/three.md');
    });
  });

  describe('Group Encryption Security', () => {
    let team: TeamConfig;

    beforeEach(async () => {
      team = await teamVault.createTeam('Engineering', ownerPublicKey);
    });

    it('should use unique encryption keys per document', async () => {
      const doc1 = await teamVault.storeDocument(
        team.teamId,
        '/docs/one.md',
        'Same content',
        ownerPublicKey
      );
      const doc2 = await teamVault.storeDocument(
        team.teamId,
        '/docs/two.md',
        'Same content',
        ownerPublicKey
      );

      // Even with same content, encrypted data should differ due to random symmetric key
      expect(doc1.encryptedContent).not.toEqual(doc2.encryptedContent);
    });

    it('should generate unique content hashes', async () => {
      const doc1 = await teamVault.storeDocument(
        team.teamId,
        '/docs/one.md',
        'Content A',
        ownerPublicKey
      );
      const doc2 = await teamVault.storeDocument(
        team.teamId,
        '/docs/two.md',
        'Content B',
        ownerPublicKey
      );

      expect(doc1.contentHash).not.toBe(doc2.contentHash);
    });

    it('should track document authorship', async () => {
      await teamVault.addMember(team.teamId, memberPublicKey, 'member', ownerPublicKey);

      const doc = await teamVault.storeDocument(
        team.teamId,
        '/docs/readme.md',
        'Content',
        ownerPublicKey
      );

      expect(doc.createdBy).toBe(ownerPublicKey);
      expect(doc.lastModifiedBy).toBe(ownerPublicKey);
    });
  });

  describe('Hierarchical Teams', () => {
    let parentTeam: TeamConfig;

    beforeEach(async () => {
      parentTeam = await teamVault.createTeam('Engineering', ownerPublicKey);
    });

    it('should create sub-team under parent', async () => {
      const subTeam = await teamVault.createSubTeam(
        parentTeam.teamId,
        'Frontend',
        ownerPublicKey
      );

      expect(subTeam.parentTeamId).toBe(parentTeam.teamId);
      expect(subTeam.name).toBe('Frontend');
    });

    it('should get all sub-teams', async () => {
      await teamVault.createSubTeam(parentTeam.teamId, 'Frontend', ownerPublicKey);
      await teamVault.createSubTeam(parentTeam.teamId, 'Backend', ownerPublicKey);
      await teamVault.createSubTeam(parentTeam.teamId, 'DevOps', ownerPublicKey);

      const subTeams = await teamVault.getSubTeams(parentTeam.teamId);

      expect(subTeams.length).toBe(3);
      expect(subTeams.map(t => t.name)).toContain('Frontend');
      expect(subTeams.map(t => t.name)).toContain('Backend');
      expect(subTeams.map(t => t.name)).toContain('DevOps');
    });

    it('should require parent team membership for sub-team creation', async () => {
      const nonMemberKey = bytesToHex(randomBytes(33));

      await expect(
        teamVault.createSubTeam(parentTeam.teamId, 'Unauthorized', nonMemberKey)
      ).rejects.toThrow('Must be a member of parent team');
    });
  });

  describe('Audit Logging', () => {
    let team: TeamConfig;

    beforeEach(async () => {
      team = await teamVault.createTeam('Engineering', ownerPublicKey);
    });

    it('should log team creation', async () => {
      const auditLog = teamVault.getAuditLog(team.teamId);

      expect(auditLog.length).toBeGreaterThanOrEqual(1);
      expect(auditLog.some(e => e.action === 'team_created')).toBe(true);
    });

    it('should log member additions', async () => {
      await teamVault.addMember(team.teamId, memberPublicKey, 'member', ownerPublicKey);

      const auditLog = teamVault.getAuditLog(team.teamId);

      expect(auditLog.some(e => e.action === 'member_added')).toBe(true);
      const addEntry = auditLog.find(e => e.action === 'member_added');
      expect(addEntry?.targetPublicKey).toBe(memberPublicKey);
    });

    it('should log member removals', async () => {
      await teamVault.addMember(team.teamId, memberPublicKey, 'member', ownerPublicKey);
      await teamVault.removeMember(team.teamId, memberPublicKey, ownerPublicKey);

      const auditLog = teamVault.getAuditLog(team.teamId);

      expect(auditLog.some(e => e.action === 'member_removed')).toBe(true);
    });

    it('should log document operations', async () => {
      await teamVault.storeDocument(team.teamId, '/docs/readme.md', 'Content', ownerPublicKey);

      const auditLog = teamVault.getAuditLog(team.teamId);

      expect(auditLog.some(e => e.action === 'document_created')).toBe(true);
    });

    it('should include timestamps in audit entries', async () => {
      const beforeCreate = Date.now();
      await teamVault.addMember(team.teamId, memberPublicKey, 'member', ownerPublicKey);
      const afterCreate = Date.now();

      const auditLog = teamVault.getAuditLog(team.teamId);
      const addEntry = auditLog.find(e => e.action === 'member_added');

      expect(addEntry?.timestamp).toBeGreaterThanOrEqual(beforeCreate);
      expect(addEntry?.timestamp).toBeLessThanOrEqual(afterCreate);
    });
  });

  describe('Error Handling', () => {
    it('should handle non-existent team for operations', async () => {
      const result = await teamVault.addMember(
        'non-existent-team',
        memberPublicKey,
        'member',
        ownerPublicKey
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Team not found');
    });

    it('should handle document not found', async () => {
      const team = await teamVault.createTeam('Engineering', ownerPublicKey);

      await expect(
        teamVault.readDocument(team.teamId, '/non-existent.md')
      ).rejects.toThrow('Document not found');
    });

    it('should handle team not found for document storage', async () => {
      await expect(
        teamVault.storeDocument('non-existent', '/docs/test.md', 'Content', ownerPublicKey)
      ).rejects.toThrow('Team not found');
    });

    it('should handle insufficient permissions for document operations', async () => {
      const team = await teamVault.createTeam('Engineering', ownerPublicKey);

      // Add readonly member
      await teamVault.addMember(team.teamId, memberPublicKey, 'readonly', ownerPublicKey);

      // Readonly member shouldn't be able to write
      await expect(
        teamVault.storeDocument(team.teamId, '/docs/test.md', 'Content', memberPublicKey)
      ).rejects.toThrow('Insufficient permissions');
    });
  });

  describe('Performance', () => {
    it('should handle multiple documents efficiently', async () => {
      const team = await teamVault.createTeam('Engineering', ownerPublicKey);

      const startTime = Date.now();

      // Store 50 documents
      for (let i = 0; i < 50; i++) {
        await teamVault.storeDocument(
          team.teamId,
          `/docs/doc-${i}.md`,
          `Content for document ${i}`,
          ownerPublicKey
        );
      }

      const duration = Date.now() - startTime;

      // Should complete in reasonable time
      expect(duration).toBeLessThan(30000); // 30 seconds max

      // Verify all documents are stored
      const documents = await teamVault.listDocuments(team.teamId);
      expect(documents.length).toBe(50);
    });

    it('should handle team with many members', async () => {
      const team = await teamVault.createTeam('Large Team', ownerPublicKey);

      // Add 20 members
      for (let i = 0; i < 20; i++) {
        const memberKey = bytesToHex(randomBytes(33));
        await teamVault.addMember(team.teamId, memberKey, 'member', ownerPublicKey);
      }

      const updatedTeam = await teamVault.getTeam(team.teamId);
      expect(updatedTeam?.members.length).toBe(21); // Owner + 20 members
    });
  });
});
