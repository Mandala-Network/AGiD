/**
 * Cryptographic Security Tests
 *
 * These tests validate the core cryptographic security properties:
 * - Key derivation uniqueness (BRC-42 compliance)
 * - Encryption strength (AES-256-GCM)
 * - Signature integrity
 * - Tamper detection
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  MockSecureWallet,
  createDeterministicWallet,
  randomBytes,
  bytesToHex,
  assertBytesNotEqual,
} from './test-utils.js';

describe('Cryptographic Security', () => {
  let wallet: MockSecureWallet;

  beforeEach(() => {
    wallet = new MockSecureWallet();
  });

  describe('Key Derivation (BRC-42)', () => {
    it('should derive unique keys for different keyIDs', async () => {
      const publicKey1 = await wallet.getPublicKey({
        protocolID: [2, 'test-protocol'],
        keyID: 'key-1'
      });

      const publicKey2 = await wallet.getPublicKey({
        protocolID: [2, 'test-protocol'],
        keyID: 'key-2'
      });

      expect(publicKey1.publicKey).not.toBe(publicKey2.publicKey);
    });

    it('should derive unique keys for different protocols', async () => {
      const publicKey1 = await wallet.getPublicKey({
        protocolID: [2, 'protocol-a'],
        keyID: 'same-key'
      });

      const publicKey2 = await wallet.getPublicKey({
        protocolID: [2, 'protocol-b'],
        keyID: 'same-key'
      });

      expect(publicKey1.publicKey).not.toBe(publicKey2.publicKey);
    });

    it('should derive unique keys for different security levels', async () => {
      const level0Key = await wallet.getPublicKey({
        protocolID: [0, 'test-protocol'],
        keyID: 'same-key'
      });

      const level1Key = await wallet.getPublicKey({
        protocolID: [1, 'test-protocol'],
        keyID: 'same-key'
      });

      const level2Key = await wallet.getPublicKey({
        protocolID: [2, 'test-protocol'],
        keyID: 'same-key'
      });

      expect(level0Key.publicKey).not.toBe(level1Key.publicKey);
      expect(level1Key.publicKey).not.toBe(level2Key.publicKey);
      expect(level0Key.publicKey).not.toBe(level2Key.publicKey);
    });

    it('should derive unique keys for different counterparties', async () => {
      const keyForAlice = await wallet.getPublicKey({
        protocolID: [2, 'test-protocol'],
        keyID: 'shared-key',
        counterparty: 'alice-public-key'
      });

      const keyForBob = await wallet.getPublicKey({
        protocolID: [2, 'test-protocol'],
        keyID: 'shared-key',
        counterparty: 'bob-public-key'
      });

      expect(keyForAlice.publicKey).not.toBe(keyForBob.publicKey);
    });

    it('should derive same key for same parameters (deterministic)', async () => {
      const key1 = await wallet.getPublicKey({
        protocolID: [2, 'test-protocol'],
        keyID: 'consistent-key',
        counterparty: 'counterparty'
      });

      const key2 = await wallet.getPublicKey({
        protocolID: [2, 'test-protocol'],
        keyID: 'consistent-key',
        counterparty: 'counterparty'
      });

      expect(key1.publicKey).toBe(key2.publicKey);
    });

    it('should produce cryptographically strong keys (entropy check)', async () => {
      const keys: string[] = [];

      // Generate 100 keys with sequential keyIDs
      for (let i = 0; i < 100; i++) {
        const result = await wallet.getPublicKey({
          protocolID: [2, 'entropy-test'],
          keyID: `key-${i}`
        });
        keys.push(result.publicKey);
      }

      // All keys should be unique
      const uniqueKeys = new Set(keys);
      expect(uniqueKeys.size).toBe(100);

      // Keys should have good distribution (no obvious patterns)
      const firstBytes = keys.map(k => k.slice(0, 4));
      const uniqueFirstBytes = new Set(firstBytes);
      expect(uniqueFirstBytes.size).toBeGreaterThan(50); // At least 50% unique prefixes
    });
  });

  describe('Encryption (AES-256-GCM)', () => {
    it('should encrypt and decrypt data correctly', async () => {
      const plaintext = new TextEncoder().encode('Hello, secure world!');

      const encrypted = await wallet.encrypt({
        plaintext: Array.from(plaintext),
        protocolID: [2, 'test-encryption'],
        keyID: 'encryption-key',
        counterparty: 'counterparty'
      });

      const decrypted = await wallet.decrypt({
        ciphertext: encrypted.ciphertext,
        protocolID: [2, 'test-encryption'],
        keyID: 'encryption-key',
        counterparty: 'counterparty'
      });

      expect(new TextDecoder().decode(new Uint8Array(decrypted.plaintext)))
        .toBe('Hello, secure world!');
    });

    it('should produce different ciphertext for same plaintext (random IV)', async () => {
      const plaintext = new TextEncoder().encode('Same message');

      const encrypted1 = await wallet.encrypt({
        plaintext: Array.from(plaintext),
        protocolID: [2, 'test-encryption'],
        keyID: 'same-key',
        counterparty: 'counterparty'
      });

      const encrypted2 = await wallet.encrypt({
        plaintext: Array.from(plaintext),
        protocolID: [2, 'test-encryption'],
        keyID: 'same-key',
        counterparty: 'counterparty'
      });

      // Ciphertexts should be different due to random IV
      expect(bytesToHex(new Uint8Array(encrypted1.ciphertext)))
        .not.toBe(bytesToHex(new Uint8Array(encrypted2.ciphertext)));
    });

    it('should fail decryption with wrong key', async () => {
      const plaintext = new TextEncoder().encode('Secret message');

      const encrypted = await wallet.encrypt({
        plaintext: Array.from(plaintext),
        protocolID: [2, 'test-encryption'],
        keyID: 'correct-key',
        counterparty: 'counterparty'
      });

      // Try to decrypt with wrong keyID
      await expect(wallet.decrypt({
        ciphertext: encrypted.ciphertext,
        protocolID: [2, 'test-encryption'],
        keyID: 'wrong-key',
        counterparty: 'counterparty'
      })).rejects.toThrow();
    });

    it('should fail decryption with wrong counterparty', async () => {
      const plaintext = new TextEncoder().encode('Private message');

      const encrypted = await wallet.encrypt({
        plaintext: Array.from(plaintext),
        protocolID: [2, 'test-encryption'],
        keyID: 'shared-key',
        counterparty: 'alice'
      });

      // Try to decrypt as different counterparty
      await expect(wallet.decrypt({
        ciphertext: encrypted.ciphertext,
        protocolID: [2, 'test-encryption'],
        keyID: 'shared-key',
        counterparty: 'bob'
      })).rejects.toThrow();
    });

    it('should detect tampered ciphertext', async () => {
      const plaintext = new TextEncoder().encode('Important data');

      const encrypted = await wallet.encrypt({
        plaintext: Array.from(plaintext),
        protocolID: [2, 'test-encryption'],
        keyID: 'integrity-key',
        counterparty: 'counterparty'
      });

      // Tamper with the ciphertext
      const tamperedCiphertext = [...encrypted.ciphertext];
      tamperedCiphertext[20] ^= 0xFF; // Flip some bits

      // Decryption should fail due to authentication tag mismatch
      await expect(wallet.decrypt({
        ciphertext: tamperedCiphertext,
        protocolID: [2, 'test-encryption'],
        keyID: 'integrity-key',
        counterparty: 'counterparty'
      })).rejects.toThrow();
    });

    it('should handle large data efficiently', async () => {
      // 64KB of random data (within Web Crypto API limits)
      const largeData = randomBytes(64 * 1024);

      const startTime = performance.now();

      const encrypted = await wallet.encrypt({
        plaintext: Array.from(largeData),
        protocolID: [2, 'test-encryption'],
        keyID: 'large-data-key',
        counterparty: 'counterparty'
      });

      const decrypted = await wallet.decrypt({
        ciphertext: encrypted.ciphertext,
        protocolID: [2, 'test-encryption'],
        keyID: 'large-data-key',
        counterparty: 'counterparty'
      });

      const endTime = performance.now();

      // Verify data integrity
      expect(decrypted.plaintext).toEqual(Array.from(largeData));

      // Should complete in reasonable time (< 5 seconds)
      expect(endTime - startTime).toBeLessThan(5000);
    });
  });

  describe('Signatures', () => {
    it('should create valid signatures', async () => {
      const data = new TextEncoder().encode('Sign this message');

      const signature = await wallet.createSignature({
        data: Array.from(data),
        protocolID: [1, 'test-signing'],
        keyID: 'signing-key'
      });

      const verification = await wallet.verifySignature({
        data: Array.from(data),
        signature: signature.signature,
        protocolID: [1, 'test-signing'],
        keyID: 'signing-key'
      });

      expect(verification.valid).toBe(true);
    });

    it('should reject tampered data', async () => {
      const originalData = new TextEncoder().encode('Original message');
      const tamperedData = new TextEncoder().encode('Tampered message');

      const signature = await wallet.createSignature({
        data: Array.from(originalData),
        protocolID: [1, 'test-signing'],
        keyID: 'signing-key'
      });

      const verification = await wallet.verifySignature({
        data: Array.from(tamperedData),
        signature: signature.signature,
        protocolID: [1, 'test-signing'],
        keyID: 'signing-key'
      });

      expect(verification.valid).toBe(false);
    });

    it('should reject signatures from wrong key', async () => {
      const data = new TextEncoder().encode('Message');

      const signature = await wallet.createSignature({
        data: Array.from(data),
        protocolID: [1, 'test-signing'],
        keyID: 'key-1'
      });

      const verification = await wallet.verifySignature({
        data: Array.from(data),
        signature: signature.signature,
        protocolID: [1, 'test-signing'],
        keyID: 'key-2' // Different key
      });

      expect(verification.valid).toBe(false);
    });

    it('should produce deterministic signatures', async () => {
      const data = new TextEncoder().encode('Deterministic signing');

      const signature1 = await wallet.createSignature({
        data: Array.from(data),
        protocolID: [1, 'test-signing'],
        keyID: 'deterministic-key'
      });

      const signature2 = await wallet.createSignature({
        data: Array.from(data),
        protocolID: [1, 'test-signing'],
        keyID: 'deterministic-key'
      });

      expect(signature1.signature).toEqual(signature2.signature);
    });
  });

  describe('HMAC', () => {
    it('should create and verify HMAC', async () => {
      const data = new TextEncoder().encode('HMAC this data');

      const hmac = await wallet.createHmac({
        data: Array.from(data),
        protocolID: [2, 'test-hmac'],
        keyID: 'hmac-key'
      });

      const verification = await wallet.verifyHmac({
        data: Array.from(data),
        hmac: hmac.hmac,
        protocolID: [2, 'test-hmac'],
        keyID: 'hmac-key'
      });

      expect(verification.valid).toBe(true);
    });

    it('should reject invalid HMAC', async () => {
      const data = new TextEncoder().encode('HMAC this data');

      const hmac = await wallet.createHmac({
        data: Array.from(data),
        protocolID: [2, 'test-hmac'],
        keyID: 'hmac-key'
      });

      // Tamper with HMAC
      const tamperedHmac = [...hmac.hmac];
      tamperedHmac[0] ^= 0xFF;

      const verification = await wallet.verifyHmac({
        data: Array.from(data),
        hmac: tamperedHmac,
        protocolID: [2, 'test-hmac'],
        keyID: 'hmac-key'
      });

      expect(verification.valid).toBe(false);
    });
  });

  describe('Wallet Isolation', () => {
    it('should not share keys between different wallets', async () => {
      const wallet1 = new MockSecureWallet();
      const wallet2 = new MockSecureWallet();

      const key1 = await wallet1.getPublicKey({ identityKey: true });
      const key2 = await wallet2.getPublicKey({ identityKey: true });

      expect(key1.publicKey).not.toBe(key2.publicKey);
    });

    it('should not decrypt with different wallet', async () => {
      const wallet1 = new MockSecureWallet();
      const wallet2 = new MockSecureWallet();

      const plaintext = new TextEncoder().encode('Secret');

      const encrypted = await wallet1.encrypt({
        plaintext: Array.from(plaintext),
        protocolID: [2, 'test'],
        keyID: 'key',
        counterparty: 'counterparty'
      });

      // Different wallet should not be able to decrypt
      await expect(wallet2.decrypt({
        ciphertext: encrypted.ciphertext,
        protocolID: [2, 'test'],
        keyID: 'key',
        counterparty: 'counterparty'
      })).rejects.toThrow();
    });

    it('should maintain determinism with same seed', () => {
      const wallet1 = createDeterministicWallet('test-seed');
      const wallet2 = createDeterministicWallet('test-seed');

      // Same seed should produce same master key
      expect(bytesToHex(wallet1.getMasterKeyForTesting()))
        .toBe(bytesToHex(wallet2.getMasterKeyForTesting()));
    });

    it('should produce different wallets with different seeds', () => {
      const wallet1 = createDeterministicWallet('seed-1');
      const wallet2 = createDeterministicWallet('seed-2');

      expect(bytesToHex(wallet1.getMasterKeyForTesting()))
        .not.toBe(bytesToHex(wallet2.getMasterKeyForTesting()));
    });
  });
});
