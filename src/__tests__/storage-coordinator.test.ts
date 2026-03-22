import { describe, it, expect, vi, beforeEach } from 'vitest';
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

describe('StorageCoordinator', () => {
  let localVault: VaultStore;
  let coordinator: StorageCoordinator;

  beforeEach(() => {
    localVault = createMockVault();
    coordinator = new StorageCoordinator({ localVault });
  });

  it('writes to local vault and tracks dirty path', async () => {
    await coordinator.write('doc.md', 'content');
    expect(localVault.write).toHaveBeenCalledWith('doc.md', 'content');
    expect(coordinator.getDirtyPaths()).toContain('doc.md');
  });

  it('reads from local vault only', async () => {
    await coordinator.write('doc.md', 'content');
    const result = await coordinator.read('doc.md');
    expect(result).toBe('content');
    expect(localVault.read).toHaveBeenCalledWith('doc.md');
  });

  it('tracks deletions in dirty list', async () => {
    await coordinator.write('doc.md', 'content');
    coordinator.clearDirty();
    await coordinator.delete('doc.md');
    expect(localVault.delete).toHaveBeenCalledWith('doc.md');
    expect(coordinator.getDirtyPaths()).toContain('doc.md');
    expect(coordinator.getDeletions()).toContain('doc.md');
  });

  it('clears dirty list for specific paths', async () => {
    await coordinator.write('a.md', 'x');
    await coordinator.write('b.md', 'y');
    expect(coordinator.getDirtyPaths().length).toBe(2);
    coordinator.clearDirty(['a.md']);
    expect(coordinator.getDirtyPaths()).toContain('b.md');
    expect(coordinator.getDirtyPaths()).not.toContain('a.md');
  });

  it('lists from local vault', async () => {
    await coordinator.write('a.md', 'x');
    await coordinator.write('b.md', 'y');
    const list = await coordinator.list();
    expect(list).toContain('a.md');
    expect(list).toContain('b.md');
  });
});
