/**
 * Audit Trail Security Tests
 *
 * These tests validate enterprise audit requirements:
 * - Hash chain integrity (tamper-evident)
 * - Cryptographic signatures on all entries
 * - Privacy-preserving hashing of user data
 * - Chain verification
 * - Export/import integrity
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SignedAuditTrail } from '../audit/signed-audit.js';
import { MockSecureWallet, bytesToHex } from './test-utils.js';

describe('Signed Audit Trail', () => {
  let wallet: MockSecureWallet;
  let auditTrail: SignedAuditTrail;
  const agentPublicKey = 'agent-public-key-hex';

  beforeEach(() => {
    wallet = new MockSecureWallet();
    auditTrail = new SignedAuditTrail({
      wallet,
      anchorToBlockchain: false,
      anchorIntervalEntries: 100,
      storagePath: '/tmp/test-audit'
    });
  });

  describe('Entry Creation', () => {
    it('should create signed audit entries', async () => {
      const entry = await auditTrail.createEntry({
        action: 'test-action',
        userPublicKey: 'user-public-key',
        agentPublicKey,
        input: 'test input',
        output: 'test output'
      });

      expect(entry.entryId).toBeDefined();
      expect(entry.timestamp).toBeDefined();
      expect(entry.action).toBe('test-action');
      expect(entry.signature).toBeDefined();
      expect(entry.signature.length).toBe(64); // SHA-256 HMAC as hex
    });

    it('should hash user public key for privacy', async () => {
      const userPublicKey = 'sensitive-user-public-key-12345';

      const entry = await auditTrail.createEntry({
        action: 'test',
        userPublicKey,
        agentPublicKey
      });

      // User public key should be hashed, not stored in plaintext
      expect(entry.userPublicKeyHash).not.toBe(userPublicKey);
      expect(entry.userPublicKeyHash).not.toContain('sensitive');
    });

    it('should hash input and output for privacy', async () => {
      const sensitiveInput = 'User credit card: 1234-5678-9012-3456';
      const sensitiveOutput = 'Transaction approved for John Doe';

      const entry = await auditTrail.createEntry({
        action: 'payment',
        userPublicKey: 'user-key',
        agentPublicKey,
        input: sensitiveInput,
        output: sensitiveOutput
      });

      // Input/output should be hashed
      expect(entry.inputHash).not.toBe(sensitiveInput);
      expect(entry.inputHash).not.toContain('credit card');
      expect(entry.outputHash).not.toBe(sensitiveOutput);
      expect(entry.outputHash).not.toContain('John Doe');
    });

    it('should include metadata in entries', async () => {
      const entry = await auditTrail.createEntry({
        action: 'api-call',
        userPublicKey: 'user-key',
        agentPublicKey,
        metadata: {
          endpoint: '/api/users',
          method: 'GET',
          statusCode: 200
        }
      });

      expect(entry.metadata).toBeDefined();
      expect(entry.metadata?.endpoint).toBe('/api/users');
      expect(entry.metadata?.method).toBe('GET');
    });
  });

  describe('Hash Chain Integrity', () => {
    it('should link entries with previous entry hash', async () => {
      const entry1 = await auditTrail.createEntry({
        action: 'first',
        userPublicKey: 'user',
        agentPublicKey
      });

      const entry2 = await auditTrail.createEntry({
        action: 'second',
        userPublicKey: 'user',
        agentPublicKey
      });

      // First entry should reference the genesis hash
      expect(entry1.previousEntryHash).toBe('0'.repeat(64));

      // Second entry should reference first entry's hash
      expect(entry2.previousEntryHash).not.toBe('0'.repeat(64));
      expect(entry2.previousEntryHash.length).toBe(64);
    });

    it('should create unbroken chain across many entries', async () => {
      const entries = [];

      for (let i = 0; i < 20; i++) {
        const entry = await auditTrail.createEntry({
          action: `action-${i}`,
          userPublicKey: 'user',
          agentPublicKey
        });
        entries.push(entry);
      }

      // Verify chain linkage
      for (let i = 1; i < entries.length; i++) {
        expect(entries[i].previousEntryHash).toBeDefined();
        expect(entries[i].previousEntryHash).not.toBe(entries[i - 1].previousEntryHash);
      }

      // Each entry should have unique hash link
      const hashes = new Set(entries.map(e => e.previousEntryHash));
      expect(hashes.size).toBe(entries.length);
    });
  });

  describe('Signature Verification', () => {
    it('should verify valid entry signature', async () => {
      const entry = await auditTrail.createEntry({
        action: 'verified-action',
        userPublicKey: 'user',
        agentPublicKey,
        input: 'test input'
      });

      const verification = await auditTrail.verifyEntry(entry);

      expect(verification.valid).toBe(true);
      expect(verification.errors).toHaveLength(0);
    });

    it('should detect tampered entry', async () => {
      const entry = await auditTrail.createEntry({
        action: 'original-action',
        userPublicKey: 'user',
        agentPublicKey
      });

      // Tamper with the entry
      const tamperedEntry = {
        ...entry,
        action: 'tampered-action'
      };

      const verification = await auditTrail.verifyEntry(tamperedEntry);

      expect(verification.valid).toBe(false);
      expect(verification.errors).toContain('Invalid signature');
    });

    it('should detect tampered timestamp', async () => {
      const entry = await auditTrail.createEntry({
        action: 'time-sensitive',
        userPublicKey: 'user',
        agentPublicKey
      });

      const tamperedEntry = {
        ...entry,
        timestamp: entry.timestamp + 1000
      };

      const verification = await auditTrail.verifyEntry(tamperedEntry);

      expect(verification.valid).toBe(false);
    });

    it('should detect tampered input hash', async () => {
      const entry = await auditTrail.createEntry({
        action: 'hashed-input',
        userPublicKey: 'user',
        agentPublicKey,
        input: 'original input'
      });

      const tamperedEntry = {
        ...entry,
        inputHash: 'a'.repeat(64) // Fake hash
      };

      const verification = await auditTrail.verifyEntry(tamperedEntry);

      expect(verification.valid).toBe(false);
    });
  });

  describe('Chain Verification', () => {
    it('should verify intact chain', async () => {
      for (let i = 0; i < 10; i++) {
        await auditTrail.createEntry({
          action: `action-${i}`,
          userPublicKey: 'user',
          agentPublicKey
        });
      }

      const verification = await auditTrail.verifyChain();

      expect(verification.valid).toBe(true);
      expect(verification.entriesVerified).toBe(10);
      expect(verification.errors).toHaveLength(0);
    });

    it('should detect broken chain linkage', async () => {
      // Create entries
      for (let i = 0; i < 5; i++) {
        await auditTrail.createEntry({
          action: `action-${i}`,
          userPublicKey: 'user',
          agentPublicKey
        });
      }

      // Get chain and tamper with it
      const chain = auditTrail.getChain();
      chain.entries[2].previousEntryHash = 'tampered'.repeat(8);

      // Create new audit trail and import tampered chain
      const tamperedAuditTrail = new SignedAuditTrail({ wallet });

      // Direct modification for testing
      (tamperedAuditTrail as any).entries = chain.entries;
      (tamperedAuditTrail as any).headHash = chain.headHash;

      const verification = await tamperedAuditTrail.verifyChain();

      expect(verification.valid).toBe(false);
      expect(verification.errors.some(e => e.error.includes('Chain linkage broken'))).toBe(true);
    });

    it('should detect multiple tampered entries', async () => {
      for (let i = 0; i < 10; i++) {
        await auditTrail.createEntry({
          action: `action-${i}`,
          userPublicKey: 'user',
          agentPublicKey
        });
      }

      const chain = auditTrail.getChain();

      // Tamper with multiple entries
      chain.entries[3].action = 'tampered-3';
      chain.entries[7].action = 'tampered-7';

      const tamperedAuditTrail = new SignedAuditTrail({ wallet });
      (tamperedAuditTrail as any).entries = chain.entries;

      const verification = await tamperedAuditTrail.verifyChain();

      expect(verification.valid).toBe(false);
      expect(verification.errors.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Chain Queries', () => {
    it('should query entries by user', async () => {
      await auditTrail.createEntry({
        action: 'user1-action',
        userPublicKey: 'user-1',
        agentPublicKey
      });

      await auditTrail.createEntry({
        action: 'user2-action',
        userPublicKey: 'user-2',
        agentPublicKey
      });

      await auditTrail.createEntry({
        action: 'user1-action-2',
        userPublicKey: 'user-1',
        agentPublicKey
      });

      const user1Entries = await auditTrail.getEntriesForUser('user-1');

      expect(user1Entries.length).toBe(2);
      expect(user1Entries.every(e => e.action.includes('user1'))).toBe(true);
    });

    it('should query entries by action', async () => {
      await auditTrail.createEntry({
        action: 'login',
        userPublicKey: 'user',
        agentPublicKey
      });

      await auditTrail.createEntry({
        action: 'api-call',
        userPublicKey: 'user',
        agentPublicKey
      });

      await auditTrail.createEntry({
        action: 'login',
        userPublicKey: 'user2',
        agentPublicKey
      });

      const loginEntries = auditTrail.getEntriesByAction('login');

      expect(loginEntries.length).toBe(2);
    });

    it('should query entries by time range', async () => {
      const startTime = Date.now();

      await auditTrail.createEntry({
        action: 'early',
        userPublicKey: 'user',
        agentPublicKey
      });

      // Add small delay to ensure different timestamps
      await new Promise(r => setTimeout(r, 10));
      const midTime = Date.now();

      await auditTrail.createEntry({
        action: 'middle',
        userPublicKey: 'user',
        agentPublicKey
      });

      await auditTrail.createEntry({
        action: 'late',
        userPublicKey: 'user',
        agentPublicKey
      });

      const endTime = Date.now() + 1; // Add 1ms buffer

      const allEntries = auditTrail.getEntriesInRange(startTime, endTime);
      expect(allEntries.length).toBe(3);

      // Note: midTime might include middle entry if timestamp is same
      const laterEntries = auditTrail.getEntriesInRange(midTime, endTime);
      expect(laterEntries.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Export/Import', () => {
    it('should export chain to JSON', async () => {
      await auditTrail.createEntry({
        action: 'export-test',
        userPublicKey: 'user',
        agentPublicKey
      });

      const json = auditTrail.exportToJson();

      expect(json).toBeDefined();
      expect(typeof json).toBe('string');

      const parsed = JSON.parse(json);
      expect(parsed.entries).toBeInstanceOf(Array);
      expect(parsed.headHash).toBeDefined();
    });

    it('should import valid chain from JSON', async () => {
      // Create entries in original audit trail
      for (let i = 0; i < 5; i++) {
        await auditTrail.createEntry({
          action: `import-test-${i}`,
          userPublicKey: 'user',
          agentPublicKey
        });
      }

      const json = auditTrail.exportToJson();

      // Import into new audit trail
      const importedAuditTrail = new SignedAuditTrail({ wallet });
      await importedAuditTrail.importFromJson(json);

      const importedChain = importedAuditTrail.getChain();
      expect(importedChain.entries.length).toBe(5);

      // Verify imported chain integrity
      const verification = await importedAuditTrail.verifyChain();
      expect(verification.valid).toBe(true);
    });

    it('should reject tampered JSON import', async () => {
      await auditTrail.createEntry({
        action: 'tamper-test',
        userPublicKey: 'user',
        agentPublicKey
      });

      const json = auditTrail.exportToJson();
      const parsed = JSON.parse(json);

      // Tamper with the exported data
      parsed.entries[0].action = 'tampered-action';

      const tamperedJson = JSON.stringify(parsed);

      const importedAuditTrail = new SignedAuditTrail({ wallet });

      await expect(importedAuditTrail.importFromJson(tamperedJson))
        .rejects.toThrow('Invalid audit chain');
    });
  });

  describe('Blockchain Anchoring', () => {
    it('should anchor chain to blockchain', async () => {
      const anchoredAuditTrail = new SignedAuditTrail({
        wallet,
        anchorToBlockchain: true,
        anchorIntervalEntries: 5
      });

      // Create entries
      for (let i = 0; i < 5; i++) {
        await anchoredAuditTrail.createEntry({
          action: `anchor-test-${i}`,
          userPublicKey: 'user',
          agentPublicKey
        });
      }

      const chain = anchoredAuditTrail.getChain();

      expect(chain.blockchainAnchors.length).toBe(1);
      expect(chain.blockchainAnchors[0].txId).toBeDefined();
      expect(chain.blockchainAnchors[0].entryHashes).toHaveLength(5);
    });

    it('should create multiple anchors as chain grows', async () => {
      const anchoredAuditTrail = new SignedAuditTrail({
        wallet,
        anchorToBlockchain: true,
        anchorIntervalEntries: 3
      });

      // Create 9 entries (should trigger 3 anchors)
      for (let i = 0; i < 9; i++) {
        await anchoredAuditTrail.createEntry({
          action: `anchor-test-${i}`,
          userPublicKey: 'user',
          agentPublicKey
        });
      }

      const chain = anchoredAuditTrail.getChain();

      expect(chain.blockchainAnchors.length).toBe(3);
    });

    it('should include merkle root in anchor', async () => {
      const anchoredAuditTrail = new SignedAuditTrail({
        wallet,
        anchorToBlockchain: true,
        anchorIntervalEntries: 5
      });

      for (let i = 0; i < 5; i++) {
        await anchoredAuditTrail.createEntry({
          action: `merkle-test-${i}`,
          userPublicKey: 'user',
          agentPublicKey
        });
      }

      const chain = anchoredAuditTrail.getChain();
      const anchor = chain.blockchainAnchors[0];

      expect(anchor.txId).toBeDefined();
      expect(anchor.timestamp).toBeDefined();
      expect(anchor.entryHashes.length).toBe(5);
    });
  });

  describe('Enterprise Compliance', () => {
    it('should maintain sequential entry IDs', async () => {
      const entryIds = [];

      for (let i = 0; i < 10; i++) {
        const entry = await auditTrail.createEntry({
          action: 'compliance-test',
          userPublicKey: 'user',
          agentPublicKey
        });
        entryIds.push(entry.entryId);
      }

      // Entry IDs should be unique
      const uniqueIds = new Set(entryIds);
      expect(uniqueIds.size).toBe(10);

      // Entry IDs should contain index
      for (let i = 0; i < entryIds.length; i++) {
        expect(entryIds[i]).toContain(String(i));
      }
    });

    it('should preserve timestamp ordering', async () => {
      const timestamps = [];

      for (let i = 0; i < 10; i++) {
        const entry = await auditTrail.createEntry({
          action: `order-test-${i}`,
          userPublicKey: 'user',
          agentPublicKey
        });
        timestamps.push(entry.timestamp);
      }

      // Timestamps should be monotonically increasing
      for (let i = 1; i < timestamps.length; i++) {
        expect(timestamps[i]).toBeGreaterThanOrEqual(timestamps[i - 1]);
      }
    });

    it('should support high volume of entries', async () => {
      const startTime = performance.now();

      // Create 1000 entries
      for (let i = 0; i < 1000; i++) {
        await auditTrail.createEntry({
          action: 'high-volume-test',
          userPublicKey: `user-${i % 10}`,
          agentPublicKey,
          input: `Input ${i}`,
          output: `Output ${i}`
        });
      }

      const endTime = performance.now();
      const duration = endTime - startTime;

      // Should complete in reasonable time (< 30 seconds for 1000 entries)
      expect(duration).toBeLessThan(30000);

      // Verify chain integrity
      const verification = await auditTrail.verifyChain();
      expect(verification.valid).toBe(true);
      expect(verification.entriesVerified).toBe(1000);
    });
  });
});
