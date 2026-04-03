import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SyncScheduler } from '../storage/sync-scheduler.js';
import { StorageCoordinator } from '../storage/storage-coordinator.js';
import type { VaultStore } from '../types/index.js';

function createMockVault(): VaultStore {
  const store = new Map<string, string>();
  return {
    read: vi.fn(async (path: string) => store.get(path) ?? null),
    write: vi.fn(async (path: string, content: string) => { store.set(path, content); }),
    delete: vi.fn(async (path: string) => store.delete(path)),
    list: vi.fn(async () => [...store.keys()]),
  };
}

describe('SyncScheduler', () => {
  let localVault: VaultStore;
  let remoteVault: VaultStore;
  let coordinator: StorageCoordinator;
  let scheduler: SyncScheduler;

  beforeEach(() => {
    vi.useFakeTimers();
    localVault = createMockVault();
    remoteVault = createMockVault();
    coordinator = new StorageCoordinator({ localVault, remoteVault });
    scheduler = new SyncScheduler({ coordinator, intervalMs: 1000 });
  });

  afterEach(() => {
    scheduler.stop();
    vi.useRealTimers();
  });

  it('starts and stops without error', () => {
    scheduler.start();
    scheduler.stop();
  });

  it('syncs dirty files to remote on syncNow', async () => {
    await coordinator.write('a.md', 'content-a');
    await scheduler.syncNow();
    expect(remoteVault.write).toHaveBeenCalledWith('a.md', 'content-a');
    expect(coordinator.getDirtyPaths()).toHaveLength(0);
  });

  it('syncs deletions to remote', async () => {
    await coordinator.write('b.md', 'content');
    await scheduler.syncNow();
    coordinator.clearDirty();
    await coordinator.delete('b.md');
    await scheduler.syncNow();
    expect(remoteVault.delete).toHaveBeenCalledWith('b.md');
  });

  it('is a no-op when no remote vault configured', async () => {
    const localOnly = new StorageCoordinator({ localVault });
    const localScheduler = new SyncScheduler({ coordinator: localOnly, intervalMs: 1000 });
    await coordinator.write('c.md', 'x');
    await localScheduler.syncNow();
    localScheduler.stop();
  });

  it('skips tick if sync is already running', async () => {
    await coordinator.write('d.md', 'content');

    (remoteVault.write as any).mockImplementation(async () => {
      await new Promise(r => setTimeout(r, 5000));
    });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(1000);
    const writeCallCount = (remoteVault.write as any).mock.calls.length;
    await vi.advanceTimersByTimeAsync(1000);
    expect((remoteVault.write as any).mock.calls.length).toBe(writeCallCount);
  });
});
