/**
 * Team Vault Adapter
 *
 * Wraps TeamVault to implement the VaultStore interface,
 * binding teamId and authorPublicKey at construction time.
 */

import type { VaultStore } from '../../types/index.js';
import type { TeamVault } from './team-vault.js';

export class TeamVaultAdapter implements VaultStore {
  constructor(
    private vault: TeamVault,
    private teamId: string,
    private authorPublicKey: string,
  ) {}

  async read(filePath: string): Promise<string | null> {
    try {
      return await this.vault.readDocumentText(this.teamId, filePath);
    } catch {
      return null;
    }
  }

  async write(filePath: string, content: string): Promise<void> {
    await this.vault.storeDocument(this.teamId, filePath, content, this.authorPublicKey);
  }

  async delete(filePath: string): Promise<boolean> {
    return this.vault.deleteDocument(this.teamId, filePath, this.authorPublicKey);
  }

  async list(): Promise<string[]> {
    const entries = await this.vault.listDocuments(this.teamId);
    return entries.map(e => e.path);
  }
}
