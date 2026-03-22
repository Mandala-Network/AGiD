/**
 * Sync Scheduler
 *
 * Periodically pushes dirty files from the StorageCoordinator
 * to the remote vault (UHRP backup).
 *
 * - Default interval: 1 hour
 * - Skips tick if previous sync still running
 * - No-op if no remote vault configured
 */

import { StorageCoordinator } from './storage-coordinator.js';

export interface SyncSchedulerConfig {
  coordinator: StorageCoordinator;
  intervalMs: number;
}

export class SyncScheduler {
  private readonly coordinator: StorageCoordinator;
  private readonly intervalMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private syncing = false;

  constructor(config: SyncSchedulerConfig) {
    this.coordinator = config.coordinator;
    this.intervalMs = config.intervalMs;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), this.intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async syncNow(): Promise<{ uploaded: number; deleted: number; failed: number }> {
    return this.doSync();
  }

  private async tick(): Promise<void> {
    if (this.syncing) {
      console.log('[SyncScheduler] Skipping tick — previous sync still running');
      return;
    }
    await this.doSync();
  }

  private async doSync(): Promise<{ uploaded: number; deleted: number; failed: number }> {
    const remote = this.coordinator.getRemoteVault();
    if (!remote) {
      return { uploaded: 0, deleted: 0, failed: 0 };
    }

    this.syncing = true;
    let uploaded = 0;
    let deleted = 0;
    let failed = 0;

    try {
      const dirtyPaths = this.coordinator.getDirtyPaths();
      const deletions = new Set(this.coordinator.getDeletions());
      const synced: string[] = [];

      for (const path of dirtyPaths) {
        try {
          if (deletions.has(path)) {
            await remote.delete(path);
            deleted++;
          } else {
            const content = await this.coordinator.read(path);
            if (content !== null) {
              await remote.write(path, content);
              uploaded++;
            }
          }
          synced.push(path);
        } catch (error) {
          console.warn(`[SyncScheduler] Failed to sync ${path}:`, error);
          failed++;
        }
      }

      this.coordinator.clearDirty(synced);

      if (uploaded > 0 || deleted > 0 || failed > 0) {
        console.log(`[SyncScheduler] Sync complete: ${uploaded} uploaded, ${deleted} deleted, ${failed} failed`);
      }
    } finally {
      this.syncing = false;
    }

    return { uploaded, deleted, failed };
  }
}
