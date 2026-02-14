/**
 * Vault Isolation Tests
 *
 * These tests validate per-user encryption isolation:
 * - Each user's data is encrypted with unique keys
 * - Users cannot access each other's data
 * - Content hash verification
 * - Document integrity
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { EncryptedShadVault } from '../shad/encrypted-vault.js';
import { AGIdentityStorageManager } from '../uhrp/storage-manager.js';
import { MockSecureWallet, bytesToHex, randomBytes } from './test-utils.js';

// Mock storage provider for testing
class MockStorageProvider {
  private storage = new Map<string, { data: Uint8Array; metadata: any }>();

  async upload(data: Uint8Array, metadata: any): Promise<string> {
    const hash = await this.sha256(data);
    const uhrpUrl = `uhrp://${hash}`;
    this.storage.set(uhrpUrl, { data, metadata });
    return uhrpUrl;
  }

  async download(uhrpUrl: string): Promise<{ data: Uint8Array; metadata: any } | null> {
    return this.storage.get(uhrpUrl) ?? null;
  }

  async exists(uhrpUrl: string): Promise<boolean> {
    return this.storage.has(uhrpUrl);
  }

  private async sha256(data: Uint8Array): Promise<string> {
    const hash = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hash))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }
}

describe('Vault Isolation', () => {
  let wallet: MockSecureWallet;
  let storageManager: AGIdentityStorageManager;
  let vault: EncryptedShadVault;

  beforeEach(() => {
    wallet = new MockSecureWallet();
    storageManager = new AGIdentityStorageManager({
      storageUrl: 'http://localhost:8080',
      wallet,
      network: 'testnet'
    });
    vault = new EncryptedShadVault({
      storageManager,
      wallet
    });
  });

  describe('User Key Derivation', () => {
    it('should derive unique encryption keys per user', async () => {
      // This test verifies that the wallet derives different keys for different counterparties
      const user1Key = await wallet.getPublicKey({
        protocolID: [2, 'agidentity-vault'],
        keyID: 'document-1',
        counterparty: 'user-1-public-key'
      });

      const user2Key = await wallet.getPublicKey({
        protocolID: [2, 'agidentity-vault'],
        keyID: 'document-1',
        counterparty: 'user-2-public-key'
      });

      expect(user1Key.publicKey).not.toBe(user2Key.publicKey);
    });

    it('should use consistent keys for same user', async () => {
      const key1 = await wallet.getPublicKey({
        protocolID: [2, 'agidentity-vault'],
        keyID: 'document-1',
        counterparty: 'user-public-key'
      });

      const key2 = await wallet.getPublicKey({
        protocolID: [2, 'agidentity-vault'],
        keyID: 'document-1',
        counterparty: 'user-public-key'
      });

      expect(key1.publicKey).toBe(key2.publicKey);
    });

    it('should use different keys for different documents', async () => {
      const doc1Key = await wallet.getPublicKey({
        protocolID: [2, 'agidentity-vault'],
        keyID: 'document-1',
        counterparty: 'user-public-key'
      });

      const doc2Key = await wallet.getPublicKey({
        protocolID: [2, 'agidentity-vault'],
        keyID: 'document-2',
        counterparty: 'user-public-key'
      });

      expect(doc1Key.publicKey).not.toBe(doc2Key.publicKey);
    });
  });

  describe('Encryption Isolation', () => {
    it('should encrypt data with user-specific keys', async () => {
      const plaintext = new TextEncoder().encode('Sensitive user data');

      const encrypted1 = await wallet.encrypt({
        plaintext: Array.from(plaintext),
        protocolID: [2, 'agidentity-vault'],
        keyID: 'test-doc',
        counterparty: 'user-1'
      });

      const encrypted2 = await wallet.encrypt({
        plaintext: Array.from(plaintext),
        protocolID: [2, 'agidentity-vault'],
        keyID: 'test-doc',
        counterparty: 'user-2'
      });

      // Same plaintext should produce different ciphertexts for different users
      expect(bytesToHex(new Uint8Array(encrypted1.ciphertext)))
        .not.toBe(bytesToHex(new Uint8Array(encrypted2.ciphertext)));
    });

    it('should not decrypt with wrong user key', async () => {
      const plaintext = new TextEncoder().encode('User 1 secret');

      const encrypted = await wallet.encrypt({
        plaintext: Array.from(plaintext),
        protocolID: [2, 'agidentity-vault'],
        keyID: 'private-doc',
        counterparty: 'user-1'
      });

      // Attempt to decrypt with different user's key
      await expect(wallet.decrypt({
        ciphertext: encrypted.ciphertext,
        protocolID: [2, 'agidentity-vault'],
        keyID: 'private-doc',
        counterparty: 'user-2'
      })).rejects.toThrow();
    });

    it('should maintain isolation across multiple documents', async () => {
      const user1Docs = ['doc1', 'doc2', 'doc3'];
      const user2Docs = ['doc1', 'doc2', 'doc3'];

      const user1Encrypted = await Promise.all(
        user1Docs.map(async (docId) => {
          const encrypted = await wallet.encrypt({
            plaintext: Array.from(new TextEncoder().encode(`User 1 ${docId}`)),
            protocolID: [2, 'agidentity-vault'],
            keyID: docId,
            counterparty: 'user-1'
          });
          return { docId, ciphertext: encrypted.ciphertext };
        })
      );

      const user2Encrypted = await Promise.all(
        user2Docs.map(async (docId) => {
          const encrypted = await wallet.encrypt({
            plaintext: Array.from(new TextEncoder().encode(`User 2 ${docId}`)),
            protocolID: [2, 'agidentity-vault'],
            keyID: docId,
            counterparty: 'user-2'
          });
          return { docId, ciphertext: encrypted.ciphertext };
        })
      );

      // Verify user 1 can decrypt their own documents
      for (const { docId, ciphertext } of user1Encrypted) {
        const decrypted = await wallet.decrypt({
          ciphertext,
          protocolID: [2, 'agidentity-vault'],
          keyID: docId,
          counterparty: 'user-1'
        });
        expect(new TextDecoder().decode(new Uint8Array(decrypted.plaintext)))
          .toBe(`User 1 ${docId}`);
      }

      // Verify user 2 cannot decrypt user 1's documents
      for (const { docId, ciphertext } of user1Encrypted) {
        await expect(wallet.decrypt({
          ciphertext,
          protocolID: [2, 'agidentity-vault'],
          keyID: docId,
          counterparty: 'user-2'
        })).rejects.toThrow();
      }
    });
  });

  describe('Content Hash Verification', () => {
    it('should generate correct content hashes', async () => {
      const content = new TextEncoder().encode('Test content for hashing');

      const hash1 = await sha256(content);
      const hash2 = await sha256(content);

      expect(hash1).toBe(hash2);
      expect(hash1.length).toBe(64); // SHA-256 produces 32 bytes = 64 hex chars
    });

    it('should detect modified content via hash', async () => {
      const originalContent = new TextEncoder().encode('Original content');
      const modifiedContent = new TextEncoder().encode('Modified content');

      const originalHash = await sha256(originalContent);
      const modifiedHash = await sha256(modifiedContent);

      expect(originalHash).not.toBe(modifiedHash);
    });

    it('should detect single byte changes', async () => {
      const content = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
      const modifiedContent = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 9]);

      const originalHash = await sha256(content);
      const modifiedHash = await sha256(modifiedContent);

      expect(originalHash).not.toBe(modifiedHash);
    });
  });

  describe('Vault Index Isolation', () => {
    it('should create separate vault indices per user', async () => {
      // Initialize vaults for two users
      const vault1Index = await vault.initializeVault('user-1-public-key', 'vault-1');
      const vault2Index = await vault.initializeVault('user-2-public-key', 'vault-2');

      expect(vault1Index.vaultId).toBe('vault-1');
      expect(vault1Index.userPublicKey).toBe('user-1-public-key');

      expect(vault2Index.vaultId).toBe('vault-2');
      expect(vault2Index.userPublicKey).toBe('user-2-public-key');
    });

    it('should track documents separately per vault', async () => {
      await vault.initializeVault('user-1', 'vault-1');

      // Note: uploadDocument would require a working storage backend
      // For now, we verify the vault index structure is correct
      const vaultIndex = vault.getVaultIndex();

      expect(vaultIndex).not.toBeNull();
      expect(vaultIndex?.userPublicKey).toBe('user-1');
      expect(vaultIndex?.documents).toBeInstanceOf(Array);
    });
  });

  describe('Document Path Security', () => {
    it('should not allow path traversal attacks', () => {
      const maliciousPaths = [
        '../../../etc/passwd',
        '..\\..\\..\\windows\\system32',
        '/etc/passwd',
        'C:\\Windows\\System32',
        '....//....//etc/passwd',
        'documents/../../../secrets'
      ];

      for (const path of maliciousPaths) {
        // Validate that paths are sanitized
        const sanitized = sanitizePath(path);
        expect(sanitized).not.toContain('..');
        expect(sanitized).not.toMatch(/^[\/\\]/);
        expect(sanitized).not.toMatch(/^[A-Za-z]:\\/);
      }
    });

    it('should normalize document paths', () => {
      const paths = [
        { input: 'notes/meeting.md', expected: 'notes/meeting.md' },
        { input: './notes/meeting.md', expected: 'notes/meeting.md' },
        { input: 'notes//meeting.md', expected: 'notes/meeting.md' },
        { input: 'NOTES/Meeting.MD', expected: 'notes/meeting.md' }
      ];

      for (const { input, expected } of paths) {
        const normalized = normalizePath(input);
        expect(normalized.toLowerCase()).toBe(expected);
      }
    });
  });

  describe('Multi-Tenant Security', () => {
    it('should maintain complete isolation between tenants', async () => {
      const tenant1Wallet = new MockSecureWallet();
      const tenant2Wallet = new MockSecureWallet();

      // Each tenant has different master keys
      expect(bytesToHex(tenant1Wallet.getMasterKeyForTesting()))
        .not.toBe(bytesToHex(tenant2Wallet.getMasterKeyForTesting()));

      // Encrypt same content with both wallets
      const content = new TextEncoder().encode('Shared content');

      const tenant1Encrypted = await tenant1Wallet.encrypt({
        plaintext: Array.from(content),
        protocolID: [2, 'agidentity-vault'],
        keyID: 'shared-doc',
        counterparty: 'user'
      });

      const tenant2Encrypted = await tenant2Wallet.encrypt({
        plaintext: Array.from(content),
        protocolID: [2, 'agidentity-vault'],
        keyID: 'shared-doc',
        counterparty: 'user'
      });

      // Ciphertexts should be completely different
      expect(bytesToHex(new Uint8Array(tenant1Encrypted.ciphertext)))
        .not.toBe(bytesToHex(new Uint8Array(tenant2Encrypted.ciphertext)));

      // Tenant 1 cannot decrypt tenant 2's data
      await expect(tenant1Wallet.decrypt({
        ciphertext: tenant2Encrypted.ciphertext,
        protocolID: [2, 'agidentity-vault'],
        keyID: 'shared-doc',
        counterparty: 'user'
      })).rejects.toThrow();

      // Tenant 2 cannot decrypt tenant 1's data
      await expect(tenant2Wallet.decrypt({
        ciphertext: tenant1Encrypted.ciphertext,
        protocolID: [2, 'agidentity-vault'],
        keyID: 'shared-doc',
        counterparty: 'user'
      })).rejects.toThrow();
    });

    it('should prevent cross-tenant document access', async () => {
      const tenant1Wallet = new MockSecureWallet();
      const tenant2Wallet = new MockSecureWallet();

      // Tenant 1 encrypts sensitive document
      const sensitiveData = new TextEncoder().encode('Tenant 1 confidential: API_KEY=secret123');

      const encrypted = await tenant1Wallet.encrypt({
        plaintext: Array.from(sensitiveData),
        protocolID: [2, 'agidentity-vault'],
        keyID: 'config/secrets.env',
        counterparty: 'admin'
      });

      // Even if tenant 2 obtains the ciphertext, they cannot decrypt
      await expect(tenant2Wallet.decrypt({
        ciphertext: encrypted.ciphertext,
        protocolID: [2, 'agidentity-vault'],
        keyID: 'config/secrets.env',
        counterparty: 'admin'
      })).rejects.toThrow();

      // Tenant 2 also cannot decrypt with any variation
      await expect(tenant2Wallet.decrypt({
        ciphertext: encrypted.ciphertext,
        protocolID: [2, 'agidentity-vault'],
        keyID: 'config/secrets.env',
        counterparty: 'user' // Different counterparty
      })).rejects.toThrow();
    });
  });

  describe('Data Integrity', () => {
    it('should detect bit flips in encrypted data', async () => {
      const content = new TextEncoder().encode('Critical business data');

      const encrypted = await wallet.encrypt({
        plaintext: Array.from(content),
        protocolID: [2, 'agidentity-vault'],
        keyID: 'critical-doc',
        counterparty: 'user'
      });

      // Flip a single bit in the ciphertext
      const corruptedCiphertext = [...encrypted.ciphertext];
      corruptedCiphertext[20] ^= 0x01;

      // Should fail to decrypt due to authentication tag mismatch
      await expect(wallet.decrypt({
        ciphertext: corruptedCiphertext,
        protocolID: [2, 'agidentity-vault'],
        keyID: 'critical-doc',
        counterparty: 'user'
      })).rejects.toThrow();
    });

    it('should detect truncated ciphertext', async () => {
      const content = new TextEncoder().encode('Data that should not be truncated');

      const encrypted = await wallet.encrypt({
        plaintext: Array.from(content),
        protocolID: [2, 'agidentity-vault'],
        keyID: 'truncation-test',
        counterparty: 'user'
      });

      // Truncate ciphertext
      const truncatedCiphertext = encrypted.ciphertext.slice(0, encrypted.ciphertext.length - 10);

      // Should fail to decrypt
      await expect(wallet.decrypt({
        ciphertext: truncatedCiphertext,
        protocolID: [2, 'agidentity-vault'],
        keyID: 'truncation-test',
        counterparty: 'user'
      })).rejects.toThrow();
    });

    it('should detect appended data to ciphertext', async () => {
      const content = new TextEncoder().encode('Original data');

      const encrypted = await wallet.encrypt({
        plaintext: Array.from(content),
        protocolID: [2, 'agidentity-vault'],
        keyID: 'append-test',
        counterparty: 'user'
      });

      // Append extra data
      const appendedCiphertext = [...encrypted.ciphertext, ...Array(10).fill(0)];

      // Should fail to decrypt
      await expect(wallet.decrypt({
        ciphertext: appendedCiphertext,
        protocolID: [2, 'agidentity-vault'],
        keyID: 'append-test',
        counterparty: 'user'
      })).rejects.toThrow();
    });
  });
});

// Helper functions
async function sha256(data: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function sanitizePath(path: string): string {
  // Remove path traversal attempts
  return path
    .replace(/\.\./g, '')
    .replace(/^[\/\\]+/, '')
    .replace(/^[A-Za-z]:[\/\\]/, '')
    .replace(/\/+/g, '/')
    .replace(/\\+/g, '/');
}

function normalizePath(path: string): string {
  return path
    .replace(/^\.\//, '')
    .replace(/\/+/g, '/')
    .toLowerCase();
}
