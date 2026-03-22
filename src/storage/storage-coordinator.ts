/**
 * Storage Coordinator
 *
 * Wraps local and optional remote vaults. All reads/writes go to local.
 * Tracks which documents have changed since last sync (dirty list).
 * Remote is a write-only backup target — never read from.
 */

import type { VaultStore } from '../types/index.js';

export interface StorageCoordinatorConfig {
  localVault: VaultStore;
  remoteVault?: VaultStore;
}

export class StorageCoordinator implements VaultStore {
  private readonly localVault: VaultStore;
  private readonly remoteVault?: VaultStore;
  private dirtyPaths: Set<string> = new Set();
  private deletedPaths: Set<string> = new Set();

  constructor(config: StorageCoordinatorConfig) {
    this.localVault = config.localVault;
    this.remoteVault = config.remoteVault;
  }

  async read(path: string): Promise<string | null> {
    return this.localVault.read(path);
  }

  async write(path: string, content: string): Promise<void> {
    await this.localVault.write(path, content);
    this.dirtyPaths.add(path);
    this.deletedPaths.delete(path);
  }

  async delete(path: string): Promise<boolean> {
    const result = await this.localVault.delete(path);
    this.dirtyPaths.add(path);
    this.deletedPaths.add(path);
    return result;
  }

  async list(): Promise<string[]> {
    return this.localVault.list();
  }

  async search(query: string, options?: { limit?: number }): Promise<Array<{ path: string; score: number }>> {
    if (this.localVault.search) {
      return this.localVault.search(query, options);
    }
    return [];
  }

  getDirtyPaths(): string[] {
    return [...this.dirtyPaths];
  }

  getDeletions(): string[] {
    return [...this.deletedPaths];
  }

  clearDirty(paths?: string[]): void {
    if (paths) {
      for (const p of paths) {
        this.dirtyPaths.delete(p);
        this.deletedPaths.delete(p);
      }
    } else {
      this.dirtyPaths.clear();
      this.deletedPaths.clear();
    }
  }

  getRemoteVault(): VaultStore | undefined {
    return this.remoteVault;
  }
}
