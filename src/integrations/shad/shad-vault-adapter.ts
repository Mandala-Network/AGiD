/**
 * Shad Vault Adapter
 *
 * Wraps EncryptedShadVault to implement the VaultStore interface,
 * binding a userPublicKey at construction time.
 */

import type { VaultStore } from '../../types/index.js';
import type { EncryptedShadVault } from './encrypted-vault.js';

export class ShadVaultAdapter implements VaultStore {
  constructor(
    private vault: EncryptedShadVault,
    private userPublicKey: string,
  ) {}

  async read(filePath: string): Promise<string | null> {
    return this.vault.readDocument(this.userPublicKey, filePath);
  }

  async write(filePath: string, content: string): Promise<void> {
    await this.vault.uploadDocument(this.userPublicKey, filePath, content);
  }

  async delete(filePath: string): Promise<boolean> {
    return this.vault.deleteDocument(filePath);
  }

  async list(): Promise<string[]> {
    return this.vault.listDocuments().map(d => d.path);
  }

  async search(query: string, options?: { limit?: number }): Promise<Array<{ path: string; score: number }>> {
    const results = await this.vault.searchDocuments(this.userPublicKey, query, options);
    return results.map(r => ({ path: r.path, score: r.relevanceScore }));
  }
}
