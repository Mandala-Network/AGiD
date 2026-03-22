import { describe, it, expect } from 'vitest';
import { createHash } from 'crypto';
import { computeUhrpUrl, verifyIntegrity, attachProofs } from '../storage/integrity-verifier.js';
import { StorageCoordinator } from '../storage/storage-coordinator.js';
import { SyncScheduler } from '../storage/sync-scheduler.js';
import type { VaultStore, ShadRetrievedDocument } from '../types/index.js';

function createInMemoryVault(): VaultStore {
  const store = new Map<string, string>();
  return {
    read: async (path) => store.get(path) ?? null,
    write: async (path, content) => { store.set(path, content); },
    delete: async (path) => store.delete(path),
    list: async () => [...store.keys()],
  };
}

describe('local-first integration', () => {
  it('full cycle: write → verify → attach proofs', async () => {
    // Simulate encrypted content
    const encryptedContent = new Uint8Array([72, 101, 108, 108, 111]);
    const uhrpUrl = computeUhrpUrl(encryptedContent);

    // Verify
    const result = verifyIntegrity(encryptedContent, uhrpUrl);
    expect(result.verified).toBe(true);

    // Attach proofs to mock Shad result
    const docs: ShadRetrievedDocument[] = [
      { path: 'memory.md', content: 'Hello', confidence: 0.9, source: 'qmd' },
    ];
    const proofMap = new Map([
      ['memory.md', { contentHash: result.contentHash, tokenTxid: 'tx123', verified: true }],
    ]);
    const proven = attachProofs(docs, proofMap);
    expect(proven[0].verified).toBe(true);
    expect(proven[0].tokenTxid).toBe('tx123');
  });

  it('coordinator + sync scheduler cycle', async () => {
    const local = createInMemoryVault();
    const remote = createInMemoryVault();
    const coordinator = new StorageCoordinator({ localVault: local, remoteVault: remote });
    const scheduler = new SyncScheduler({ coordinator, intervalMs: 60000 });

    // Write locally
    await coordinator.write('note.md', 'encrypted-content');
    expect(coordinator.getDirtyPaths()).toContain('note.md');

    // Sync to remote
    const stats = await scheduler.syncNow();
    expect(stats.uploaded).toBe(1);
    expect(coordinator.getDirtyPaths()).toHaveLength(0);

    // Remote has the content
    const remoteContent = await remote.read('note.md');
    expect(remoteContent).toBe('encrypted-content');
  });
});
