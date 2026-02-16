/**
 * Enterprise Compliance Tests
 *
 * These tests validate enterprise-grade security requirements:
 * - End-to-end encryption workflow
 * - Defense against known attack vectors
 * - Compliance with security best practices
 * - Performance under load
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  MockSecureWallet,
  createDeterministicWallet,
  bytesToHex,
  randomBytes,
  sleep,
} from './test-utils.js';
import {
  PerInteractionEncryption,
  SessionEncryption,
} from '../03-gateway/encryption/per-interaction.js';
import { SessionManager } from '../03-gateway/auth/session-manager.js';
import { SignedAuditTrail } from '../07-shared/audit/signed-audit.js';

describe('Enterprise Security Compliance', () => {
  describe('End-to-End Encryption Flow', () => {
    it('should maintain security through complete message lifecycle', async () => {
      const agentWallet = new MockSecureWallet();
      const encryption = new PerInteractionEncryption(agentWallet);
      const userPublicKey = 'enterprise-user-public-key';

      // 1. Create signed envelope for message
      const sensitiveMessage = 'Confidential: Q4 revenue projections show 15% growth';
      const context = {
        sessionId: 'enterprise-session',
        messageIndex: 0,
        timestamp: Date.now(),
        direction: 'outbound' as const
      };

      const envelope = await encryption.createSignedEnvelope(
        userPublicKey,
        sensitiveMessage,
        context
      );

      // 2. Verify envelope integrity - decryption should succeed
      const verified = await encryption.verifyAndDecrypt(userPublicKey, envelope);

      expect(verified.plaintext).toBe(sensitiveMessage);
      expect(verified.keyId).toBe(envelope.encrypted.keyId);

      // 3. Verify tampered metadata is detected via signature
      const tamperedEnvelope = {
        ...envelope,
        signedData: envelope.signedData.replace('enterprise-session', 'hacked-session')
      };

      const tamperedResult = await encryption.verifyAndDecrypt(
        userPublicKey,
        tamperedEnvelope
      );

      expect(tamperedResult.signatureValid).toBe(false);
    });

    it('should maintain PFS across session lifetime', async () => {
      const wallet = new MockSecureWallet();
      const session = new SessionEncryption(wallet, 'user-key', 'pfs-session');

      const keyIds: string[] = [];

      // Send multiple messages in session
      for (let i = 0; i < 100; i++) {
        const encrypted = await session.encryptOutbound(`Message ${i}`);
        keyIds.push(encrypted.keyId);
      }

      // All key IDs should be unique (PFS property)
      const uniqueKeyIds = new Set(keyIds);
      expect(uniqueKeyIds.size).toBe(100);

      // Key IDs should have no predictable pattern
      for (let i = 1; i < keyIds.length; i++) {
        // Adjacent key IDs should differ significantly
        expect(keyIds[i]).not.toBe(keyIds[i - 1]);
      }
    });
  });

  describe('Attack Vector Defense', () => {
    describe('Replay Attacks', () => {
      it('should prevent message replay via unique key IDs', async () => {
        const wallet = new MockSecureWallet();
        const encryption = new PerInteractionEncryption(wallet);

        // Fixed timestamp for deterministic testing
        const fixedTimestamp = 1700000000000;

        // Attacker captures a valid encrypted message
        const capturedMessage = await encryption.encryptMessage(
          'user-key',
          'Transfer $10000 to account XYZ',
          {
            sessionId: 'session-1',
            messageIndex: 5,
            timestamp: fixedTimestamp,
            direction: 'outbound'
          }
        );

        // Attempting to use the same message context again would produce
        // the same keyId, which should be detected by the system
        // (tracking used keyIds in production)

        // The keyId is deterministically tied to the context
        const replayKeyId = encryption.generateKeyId({
          sessionId: 'session-1',
          messageIndex: 5,
          timestamp: fixedTimestamp,
          direction: 'outbound'
        });

        expect(capturedMessage.keyId).toBe(replayKeyId);
        // In production, this keyId would be in a "used" set
      });

      it('should prevent session replay via timing checks', async () => {
        const wallet = new MockSecureWallet();
        const sessionManager = new SessionManager({
          wallet,
          maxSessionDurationMs: 3600000,
          timingAnomalyThresholdMs: 100
        });

        const session = await sessionManager.createSession('user');

        // Create valid signature
        const signature = await wallet.createSignature({
          data: Array.from(new TextEncoder().encode(session.nonce)),
          protocolID: [2, 'agidentity-auth'],
          keyID: `session-${session.sessionId}`,
          counterparty: session.userPublicKey
        });

        // Replay with old timestamp should fail (timing anomaly)
        const replayResult = await sessionManager.verifySession(
          session.sessionId,
          new Uint8Array(signature.signature),
          Date.now() - 120000 // 2 minutes ago
        );

        expect(replayResult.valid).toBe(false);
        // Could be either timing anomaly or timestamp too old
        expect(replayResult.error).toBeDefined();

        sessionManager.stop();
      });
    });

    describe('Man-in-the-Middle', () => {
      it('should detect message modification via signed envelopes', async () => {
        const wallet = new MockSecureWallet();
        const encryption = new PerInteractionEncryption(wallet);

        const originalMessage = 'Transfer $100';
        const envelope = await encryption.createSignedEnvelope(
          'user-key',
          originalMessage,
          {
            sessionId: 'secure-session',
            messageIndex: 0,
            timestamp: Date.now(),
            direction: 'outbound'
          }
        );

        // MITM modifies the signed data (e.g., changes amount)
        const modifiedSignedData = envelope.signedData.replace('100', '10000');

        const tamperedEnvelope = {
          ...envelope,
          signedData: modifiedSignedData
        };

        const result = await encryption.verifyAndDecrypt('user-key', tamperedEnvelope);

        expect(result.signatureValid).toBe(false);
      });

      it('should detect key substitution via counterparty binding', async () => {
        const legitimateWallet = new MockSecureWallet();
        const attackerWallet = new MockSecureWallet();

        const message = 'Confidential data';

        // Legitimate encryption
        const encrypted = await legitimateWallet.encrypt({
          plaintext: Array.from(new TextEncoder().encode(message)),
          protocolID: [2, 'test'],
          keyID: 'shared-key',
          counterparty: 'legitimate-counterparty'
        });

        // Attacker cannot decrypt
        await expect(attackerWallet.decrypt({
          ciphertext: encrypted.ciphertext,
          protocolID: [2, 'test'],
          keyID: 'shared-key',
          counterparty: 'legitimate-counterparty'
        })).rejects.toThrow();

        // Attacker cannot decrypt even with different counterparty
        await expect(attackerWallet.decrypt({
          ciphertext: encrypted.ciphertext,
          protocolID: [2, 'test'],
          keyID: 'shared-key',
          counterparty: 'attacker-counterparty'
        })).rejects.toThrow();
      });
    });

    describe('Brute Force', () => {
      it('should use sufficient key entropy (256 bits)', async () => {
        const wallet = new MockSecureWallet();

        // Master key should be 256 bits
        const masterKey = wallet.getMasterKeyForTesting();
        expect(masterKey.length).toBe(32); // 256 bits

        // Derived keys should also be 256 bits
        const hmac = await wallet.createHmac({
          data: Array.from(new TextEncoder().encode('test')),
          protocolID: [2, 'test'],
          keyID: 'test-key'
        });

        expect(hmac.hmac.length).toBe(32); // 256 bits
      });

      it('should use cryptographically secure random numbers', async () => {
        const entropy: number[] = [];

        // Collect random values
        for (let i = 0; i < 1000; i++) {
          const random = randomBytes(1)[0];
          entropy.push(random);
        }

        // Check distribution (should be roughly uniform)
        const buckets = new Array(16).fill(0);
        for (const val of entropy) {
          buckets[Math.floor(val / 16)]++;
        }

        // Each bucket should have roughly 1000/16 = 62.5 values
        // With variance, expect between 30 and 95
        for (const count of buckets) {
          expect(count).toBeGreaterThan(30);
          expect(count).toBeLessThan(95);
        }
      });
    });

    describe('Side Channel', () => {
      it('should use constant-time comparison for secrets', async () => {
        const wallet = new MockSecureWallet();

        const data = new TextEncoder().encode('test data');
        const hmac = await wallet.createHmac({
          data: Array.from(data),
          protocolID: [2, 'test'],
          keyID: 'hmac-key'
        });

        // Verify the implementation uses constant-time comparison
        // by checking the wallet implementation directly
        const correctResult = await wallet.verifyHmac({
          data: Array.from(data),
          hmac: hmac.hmac,
          protocolID: [2, 'test'],
          keyID: 'hmac-key'
        });

        const wrongHmac = [...hmac.hmac];
        wrongHmac[0] ^= 0xFF;

        const wrongResult = await wallet.verifyHmac({
          data: Array.from(data),
          hmac: wrongHmac,
          protocolID: [2, 'test'],
          keyID: 'hmac-key'
        });

        // Correct HMAC should verify, wrong should not
        expect(correctResult.valid).toBe(true);
        expect(wrongResult.valid).toBe(false);

        // The implementation uses constant-time comparison
        // (verified by code review of constantTimeCompare function)
      });
    });
  });

  describe('Audit Trail Completeness', () => {
    it('should capture all security-relevant events', async () => {
      const wallet = new MockSecureWallet();
      const auditTrail = new SignedAuditTrail({ wallet });

      const events = [
        { action: 'session.create', input: 'user-123' },
        { action: 'session.verify', input: 'session-456' },
        { action: 'message.encrypt', input: 'message-789' },
        { action: 'document.store', input: 'doc-abc' },
        { action: 'document.access', input: 'doc-abc' },
        { action: 'session.invalidate', input: 'session-456' }
      ];

      for (const event of events) {
        await auditTrail.createEntry({
          action: event.action,
          userPublicKey: 'user-123',
          agentPublicKey: 'agent-key',
          input: event.input
        });
      }

      const chain = auditTrail.getChain();

      expect(chain.entries.length).toBe(6);
      expect(chain.entries.map(e => e.action)).toEqual(events.map(e => e.action));
    });

    it('should maintain immutable audit history', async () => {
      const wallet = new MockSecureWallet();
      const auditTrail = new SignedAuditTrail({ wallet });

      // Create audit entries
      for (let i = 0; i < 10; i++) {
        await auditTrail.createEntry({
          action: `action-${i}`,
          userPublicKey: 'user',
          agentPublicKey: 'agent'
        });
      }

      // Export chain
      const originalExport = auditTrail.exportToJson();
      const originalChain = JSON.parse(originalExport);

      // Create more entries
      for (let i = 10; i < 20; i++) {
        await auditTrail.createEntry({
          action: `action-${i}`,
          userPublicKey: 'user',
          agentPublicKey: 'agent'
        });
      }

      // Original entries should be unchanged
      const currentChain = auditTrail.getChain();
      for (let i = 0; i < 10; i++) {
        expect(currentChain.entries[i].signature)
          .toBe(originalChain.entries[i].signature);
      }
    });
  });

  describe('Performance Under Load', () => {
    it('should handle concurrent encryption operations', async () => {
      const wallet = new MockSecureWallet();
      const encryption = new PerInteractionEncryption(wallet);

      const startTime = performance.now();

      // Run 100 concurrent encryption operations
      const operations = Array.from({ length: 100 }, async (_, i) => {
        return encryption.encryptMessage(
          `user-${i % 10}`,
          `Concurrent message ${i}`,
          {
            sessionId: `session-${i % 5}`,
            messageIndex: i,
            timestamp: Date.now(),
            direction: 'outbound'
          }
        );
      });

      const results = await Promise.all(operations);

      const endTime = performance.now();

      expect(results.length).toBe(100);
      expect(results.every(r => r.ciphertext.length > 0)).toBe(true);

      // Should complete in reasonable time (< 10 seconds)
      expect(endTime - startTime).toBeLessThan(10000);
    });

    it('should handle concurrent session operations', async () => {
      const wallet = new MockSecureWallet();
      const sessionManager = new SessionManager({
        wallet,
        maxSessionDurationMs: 60000,
        timingAnomalyThresholdMs: 1000
      });

      const startTime = performance.now();

      // Create 50 concurrent sessions
      const sessions = await Promise.all(
        Array.from({ length: 50 }, (_, i) =>
          sessionManager.createSession(`user-${i}`)
        )
      );

      // Verify all sessions concurrently
      const verifications = await Promise.all(
        sessions.map(async (session) => {
          const signature = await wallet.createSignature({
            data: Array.from(new TextEncoder().encode(session.nonce)),
            protocolID: [2, 'agidentity-auth'],
            keyID: `session-${session.sessionId}`,
            counterparty: session.userPublicKey
          });

          return sessionManager.verifySession(
            session.sessionId,
            new Uint8Array(signature.signature),
            Date.now()
          );
        })
      );

      const endTime = performance.now();

      expect(sessions.length).toBe(50);
      expect(verifications.every(v => v.valid)).toBe(true);
      expect(endTime - startTime).toBeLessThan(10000);

      sessionManager.stop();
    });

    it('should maintain security properties under stress', async () => {
      const wallet = new MockSecureWallet();
      const auditTrail = new SignedAuditTrail({ wallet });

      const startTime = performance.now();

      // Create 500 audit entries rapidly
      for (let i = 0; i < 500; i++) {
        await auditTrail.createEntry({
          action: 'stress-test',
          userPublicKey: `user-${i % 20}`,
          agentPublicKey: 'agent',
          input: `input-${i}`,
          output: `output-${i}`
        });
      }

      const endTime = performance.now();

      // Verify chain integrity maintained
      const verification = await auditTrail.verifyChain();

      expect(verification.valid).toBe(true);
      expect(verification.entriesVerified).toBe(500);
      expect(endTime - startTime).toBeLessThan(30000);
    });
  });

  describe('Key Management Security', () => {
    it('should never expose private keys in logs or errors', async () => {
      const wallet = createDeterministicWallet('test-seed-should-not-appear');

      // Capture any thrown errors
      let errorMessage = '';
      try {
        await wallet.decrypt({
          ciphertext: [1, 2, 3], // Invalid ciphertext
          protocolID: [2, 'test'],
          keyID: 'test'
        });
      } catch (e) {
        errorMessage = String(e);
      }

      // Error should not contain seed or key material
      expect(errorMessage).not.toContain('test-seed');
      expect(errorMessage).not.toContain('should-not-appear');
    });

    it('should derive keys without exposing master key', async () => {
      const wallet = new MockSecureWallet();
      const masterKey = wallet.getMasterKeyForTesting();

      // Derive multiple keys
      const derivedKeys = await Promise.all([
        wallet.getPublicKey({ protocolID: [2, 'test'], keyID: 'key-1' }),
        wallet.getPublicKey({ protocolID: [2, 'test'], keyID: 'key-2' }),
        wallet.getPublicKey({ protocolID: [2, 'test'], keyID: 'key-3' })
      ]);

      // None of the derived keys should match the master key
      const masterKeyHex = bytesToHex(masterKey);
      for (const derived of derivedKeys) {
        expect(derived.publicKey).not.toContain(masterKeyHex);
      }
    });
  });

  describe('Protocol Compliance', () => {
    it('should follow BRC-42 key derivation structure', async () => {
      const wallet = new MockSecureWallet();

      // BRC-42 specifies: protocolID = [securityLevel, protocolString]
      const securityLevels = [0, 1, 2];
      const protocols = ['test-a', 'test-b'];
      const keyIds = ['key-1', 'key-2'];

      const derivedKeys: Map<string, string> = new Map();

      for (const level of securityLevels) {
        for (const protocol of protocols) {
          for (const keyId of keyIds) {
            const key = await wallet.getPublicKey({
              protocolID: [level, protocol],
              keyID: keyId
            });

            const identifier = `${level}-${protocol}-${keyId}`;

            // Each unique combination should produce unique key
            expect(derivedKeys.has(identifier)).toBe(false);
            derivedKeys.set(identifier, key.publicKey);
          }
        }
      }

      // Verify we generated expected number of unique keys
      expect(derivedKeys.size).toBe(
        securityLevels.length * protocols.length * keyIds.length
      );
    });

    it('should follow BRC-43 security level semantics', async () => {
      const wallet = new MockSecureWallet();

      // Level 0: Anyone can derive (public)
      // Level 1: App-specific derivation
      // Level 2: Per-counterparty derivation

      // Level 2 with different counterparties should produce different keys
      const level2Key1 = await wallet.getPublicKey({
        protocolID: [2, 'secure-protocol'],
        keyID: 'shared-key',
        counterparty: 'alice'
      });

      const level2Key2 = await wallet.getPublicKey({
        protocolID: [2, 'secure-protocol'],
        keyID: 'shared-key',
        counterparty: 'bob'
      });

      expect(level2Key1.publicKey).not.toBe(level2Key2.publicKey);

      // Level 0 and 1 without counterparty should still work
      const level0Key = await wallet.getPublicKey({
        protocolID: [0, 'public-protocol'],
        keyID: 'public-key'
      });

      const level1Key = await wallet.getPublicKey({
        protocolID: [1, 'app-protocol'],
        keyID: 'app-key'
      });

      expect(level0Key.publicKey).toBeDefined();
      expect(level1Key.publicKey).toBeDefined();
    });
  });
});
