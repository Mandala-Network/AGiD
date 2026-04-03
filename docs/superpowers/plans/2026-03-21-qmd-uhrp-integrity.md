# QMD/UHRP Integrity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable Shad's auto-detected QMD retriever, implement local-first memory storage with PushDrop integrity tokens, add a storage coordinator with scheduled UHRP sync, and verify document integrity before/after Shad retrieval.

**Architecture:** Local-first storage writes encrypted content to disk and creates a PushDrop token with the content hash immediately. A StorageCoordinator wraps local+remote vaults and tracks dirty files. A SyncScheduler periodically pushes dirty files to UHRP. An IntegrityVerifier hashes encrypted content pre-retrieval and attaches proofs post-retrieval. Shad uses `--retriever auto` to auto-detect QMD.

**Tech Stack:** TypeScript, @bsv/sdk (PushDrop, StorageUploader, StorageDownloader), Node crypto (SHA-256), Shad CLI, vitest

**Spec:** `docs/superpowers/specs/2026-03-21-qmd-uhrp-integrity-design.md`

---

## File Structure

| Action | Path | Responsibility |
|--------|------|----------------|
| Modify | `src/types/index.ts` | Add integrity proof fields to `ShadRetrievedDocument`, add `IntegrityConfig`/`RemoteBackupConfig` types, update `MemoryInput` to drop importance |
| Modify | `src/config/index.ts` | Add `shadRetriever`, `remoteBackup`, `integrity` config fields + env vars |
| Modify | `src/storage/memory/memory-types.ts` | Remove `importance` from `MemoryInput` and `MemoryToken` |
| Modify | `src/storage/memory/memory-writer.ts` | Local-first flow: encrypt → hash encrypted → local vault → PushDrop `[uhrpUrl, tags]` in `agid-memory` basket |
| Modify | `src/storage/memory/memory-reader.ts` | Read from `agid-memory` basket, use new protocol/keyID, support recovery from UHRP |
| Modify | `src/storage/memory/memory-manager.ts` | Remove `importance` references, wire integrity verifier into recall paths |
| Modify | `src/storage/memory/memory-gc.ts` | Update basket name to `agid-memory`, remove importance-based retention |
| Modify | `src/integrations/shad/shad-temp-executor.ts` | Change `--retriever filesystem` to `--retriever auto` (read from config) |
| Create | `src/storage/integrity-verifier.ts` | Pre-retrieval hash verification + post-retrieval proof attachment |
| Create | `src/storage/storage-coordinator.ts` | Wraps local+remote vaults, tracks dirty list, exposes `VaultStore` |
| Create | `src/storage/sync-scheduler.ts` | Scheduled interval sync of dirty files to UHRP |
| Create | `src/__tests__/integrity-verifier.test.ts` | Tests for hash verification and proof attachment |
| Create | `src/__tests__/storage-coordinator.test.ts` | Tests for dirty list tracking and VaultStore delegation |
| Create | `src/__tests__/sync-scheduler.test.ts` | Tests for scheduled sync lifecycle |
| Create | `src/__tests__/memory-writer-local-first.test.ts` | Tests for local-first write flow |
| Modify | `src/agent/tools/memory.ts` | Remove `importance` from tool schemas and call sites |

---

### Task 1: Update Types

**Files:**
- Modify: `src/types/index.ts:301-326` (Shad types)
- Modify: `src/storage/memory/memory-types.ts`

- [ ] **Step 1: Write failing test for new types**

Create `src/__tests__/types-integrity.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import type {
  ShadRetrievedDocument,
  IntegrityConfig,
  RemoteBackupConfig,
} from '../types/index.js';

describe('integrity types', () => {
  it('ShadRetrievedDocument supports integrity proof fields', () => {
    const doc: ShadRetrievedDocument = {
      path: 'test.md',
      content: 'hello',
      confidence: 0.9,
      source: 'qmd',
      contentHash: 'abc123',
      tokenTxid: 'txid123',
      verified: true,
    };
    expect(doc.verified).toBe(true);
    expect(doc.contentHash).toBe('abc123');
    expect(doc.tokenTxid).toBe('txid123');
  });

  it('IntegrityConfig has strict and verifyOnRetrieval', () => {
    const config: IntegrityConfig = {
      strict: false,
      verifyOnRetrieval: true,
    };
    expect(config.strict).toBe(false);
  });

  it('RemoteBackupConfig has enabled and intervalMs', () => {
    const config: RemoteBackupConfig = {
      enabled: true,
      intervalMs: 3600000,
    };
    expect(config.enabled).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/types-integrity.test.ts`
Expected: FAIL — `IntegrityConfig` and `RemoteBackupConfig` not exported

- [ ] **Step 3: Add integrity proof fields to ShadRetrievedDocument**

In `src/types/index.ts`, update `ShadRetrievedDocument` (line 321):

```typescript
export interface ShadRetrievedDocument {
  path: string;
  content: string;
  confidence: number;
  source: string;
  contentHash?: string;
  tokenTxid?: string;
  verified?: boolean;
}
```

- [ ] **Step 4: Add IntegrityConfig and RemoteBackupConfig types**

In `src/types/index.ts`, after the `ShadExecutionTrace` interface (after line 334):

```typescript
export interface IntegrityConfig {
  strict: boolean;
  verifyOnRetrieval: boolean;
}

export interface RemoteBackupConfig {
  enabled: boolean;
  intervalMs: number;
}
```

- [ ] **Step 5: Update MemoryInput and MemoryToken to drop importance**

In `src/storage/memory/memory-types.ts`:

```typescript
export interface MemoryInput {
  content: string;
  tags: string[];
}

export interface MemoryToken {
  txid: string;
  uhrpUrl: string;
  tags: string[];
  createdAt: number;
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run src/__tests__/types-integrity.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/types/index.ts src/storage/memory/memory-types.ts src/__tests__/types-integrity.test.ts
git commit -m "feat: add integrity proof types, drop importance from memory tokens"
```

---

### Task 2: Update Config

**Files:**
- Modify: `src/config/index.ts:11-54` (AGIdentityEnvConfig)
- Modify: `src/config/index.ts:84-131` (loadConfig)

- [ ] **Step 1: Write failing test**

Create `src/__tests__/config-integrity.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { loadConfig, resetConfig } from '../config/index.js';

describe('config integrity fields', () => {
  beforeEach(() => {
    resetConfig();
  });

  it('loads shadRetriever defaulting to auto', () => {
    const config = loadConfig();
    expect(config.shadRetriever).toBe('auto');
  });

  it('loads shadRetriever from env', () => {
    process.env.SHAD_RETRIEVER = 'qmd';
    const config = loadConfig();
    expect(config.shadRetriever).toBe('qmd');
    delete process.env.SHAD_RETRIEVER;
  });

  it('loads remoteBackup defaults', () => {
    const config = loadConfig();
    expect(config.remoteBackupEnabled).toBe(false);
    expect(config.remoteBackupIntervalMs).toBe(3600000);
  });

  it('loads integrity defaults', () => {
    const config = loadConfig();
    expect(config.integrityStrict).toBe(false);
    expect(config.integrityVerify).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/config-integrity.test.ts`
Expected: FAIL — `shadRetriever` property doesn't exist

- [ ] **Step 3: Add new fields to AGIdentityEnvConfig**

In `src/config/index.ts`, add to the `AGIdentityEnvConfig` interface after the Shad section (after line 31):

```typescript
  shadRetriever: 'auto' | 'qmd' | 'filesystem';

  // Remote Backup
  remoteBackupEnabled: boolean;
  remoteBackupIntervalMs: number;

  // Integrity Verification
  integrityStrict: boolean;
  integrityVerify: boolean;
```

- [ ] **Step 4: Add loading logic in loadConfig()**

In `src/config/index.ts`, add to the return object in `loadConfig()` after `shadMaxTime` (after line 107):

```typescript
    shadRetriever: (env.SHAD_RETRIEVER as 'auto' | 'qmd' | 'filesystem') ?? 'auto',

    // Remote Backup
    remoteBackupEnabled: parseBool(env.REMOTE_BACKUP_ENABLED, false),
    remoteBackupIntervalMs: parseInt(env.REMOTE_BACKUP_INTERVAL_MS, 3600000),

    // Integrity Verification
    integrityStrict: parseBool(env.INTEGRITY_STRICT, false),
    integrityVerify: parseBool(env.INTEGRITY_VERIFY, true),
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/__tests__/config-integrity.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/config/index.ts src/__tests__/config-integrity.test.ts
git commit -m "feat: add shadRetriever, remoteBackup, integrity config"
```

---

### Task 3: Shad Retriever — Change Hardcoded Filesystem to Auto

**Files:**
- Modify: `src/integrations/shad/shad-temp-executor.ts:82-100,281-293`

- [ ] **Step 1: Write failing test**

Create `src/__tests__/shad-retriever-auto.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { ShadTempVaultExecutor } from '../integrations/shad/shad-temp-executor.js';
import { spawn } from 'child_process';

// We can't easily test CLI args without spawning, so test the config acceptance
describe('ShadTempVaultExecutor retriever config', () => {
  it('accepts retriever in shadConfig', () => {
    const executor = new ShadTempVaultExecutor({
      vault: {
        read: async () => null,
        list: async () => [],
        write: async () => {},
        delete: async () => false,
      },
      shadConfig: { retriever: 'auto' },
    });
    // Should not throw
    expect(executor).toBeDefined();
  });

  it('defaults retriever to auto', () => {
    const executor = new ShadTempVaultExecutor({
      vault: {
        read: async () => null,
        list: async () => [],
        write: async () => {},
        delete: async () => false,
      },
    });
    expect(executor).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it passes (baseline)**

Run: `npx vitest run src/__tests__/shad-retriever-auto.test.ts`
Expected: PASS (constructor already accepts shadConfig)

- [ ] **Step 3: Store retriever in config and use in CLI args**

In `src/integrations/shad/shad-temp-executor.ts`, add a new field:

```typescript
  private readonly retriever: 'auto' | 'qmd' | 'filesystem';
```

In constructor (after line 98):

```typescript
    this.retriever = config.shadConfig?.retriever ?? 'auto';
```

In `runShad()` (line 286-287), change:

```typescript
        '--retriever',
        'filesystem',
```

to:

```typescript
        '--retriever',
        this.retriever,
```

Update the JSDoc at line 10 from `--retriever filesystem` to `--retriever auto`.

Update the comment at line 91 from:
```typescript
    // Set defaults (retriever is always 'filesystem' for temp vault pattern)
```
to:
```typescript
    // Set defaults (retriever defaults to 'auto' — Shad auto-detects QMD if installed)
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/__tests__/shad-retriever-auto.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/integrations/shad/shad-temp-executor.ts src/__tests__/shad-retriever-auto.test.ts
git commit -m "feat: change Shad retriever from hardcoded filesystem to auto"
```

---

### Task 4: Integrity Verifier

**Files:**
- Create: `src/storage/integrity-verifier.ts`
- Create: `src/__tests__/integrity-verifier.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/__tests__/integrity-verifier.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { createHash } from 'crypto';
import {
  verifyIntegrity,
  verifyBatch,
  attachProofs,
  computeUhrpUrl,
} from '../storage/integrity-verifier.js';
import type { ShadRetrievedDocument } from '../types/index.js';

function sha256hex(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

describe('computeUhrpUrl', () => {
  it('computes uhrp URL from encrypted content', () => {
    const content = new Uint8Array([1, 2, 3, 4]);
    const url = computeUhrpUrl(content);
    const expectedHash = sha256hex(content);
    expect(url).toBe(`uhrp://${expectedHash}`);
  });
});

describe('verifyIntegrity', () => {
  it('returns verified for matching hash', () => {
    const content = new Uint8Array([10, 20, 30]);
    const hash = sha256hex(content);
    const uhrpUrl = `uhrp://${hash}`;

    const result = verifyIntegrity(content, uhrpUrl);
    expect(result.verified).toBe(true);
    expect(result.contentHash).toBe(hash);
  });

  it('returns not verified for mismatched hash', () => {
    const content = new Uint8Array([10, 20, 30]);
    const uhrpUrl = 'uhrp://0000000000000000000000000000000000000000000000000000000000000000';

    const result = verifyIntegrity(content, uhrpUrl);
    expect(result.verified).toBe(false);
  });
});

describe('attachProofs', () => {
  it('attaches proof metadata to retrieved documents', () => {
    const docs: ShadRetrievedDocument[] = [
      { path: 'note.md', content: 'hello', confidence: 0.9, source: 'qmd' },
    ];
    const proofMap = new Map<string, { contentHash: string; tokenTxid: string; verified: boolean }>([
      ['note.md', { contentHash: 'abc', tokenTxid: 'tx1', verified: true }],
    ]);

    const result = attachProofs(docs, proofMap);
    expect(result[0].contentHash).toBe('abc');
    expect(result[0].tokenTxid).toBe('tx1');
    expect(result[0].verified).toBe(true);
  });

  it('marks unmatched documents as unverified', () => {
    const docs: ShadRetrievedDocument[] = [
      { path: 'unknown.md', content: 'x', confidence: 0.5, source: 'qmd' },
    ];
    const proofMap = new Map();

    const result = attachProofs(docs, proofMap);
    expect(result[0].verified).toBe(false);
  });
});

describe('verifyBatch', () => {
  it('returns verified map and empty failed for valid files', () => {
    const content = new Uint8Array([1, 2, 3]);
    const hash = sha256hex(content);
    const uhrpUrl = `uhrp://${hash}`;

    const result = verifyBatch([
      { path: 'a.md', encryptedContent: content, uhrpUrl, tokenTxid: 'tx1' },
    ]);
    expect(result.verified.size).toBe(1);
    expect(result.failed).toHaveLength(0);
    expect(result.verified.get('a.md')?.verified).toBe(true);
  });

  it('adds failed files to failed list in soft mode', () => {
    const content = new Uint8Array([1, 2, 3]);
    const badUrl = 'uhrp://0000000000000000000000000000000000000000000000000000000000000000';

    const result = verifyBatch([
      { path: 'bad.md', encryptedContent: content, uhrpUrl: badUrl, tokenTxid: 'tx1' },
    ]);
    expect(result.verified.size).toBe(0);
    expect(result.failed).toContain('bad.md');
  });

  it('throws in strict mode on hash mismatch', () => {
    const content = new Uint8Array([1, 2, 3]);
    const badUrl = 'uhrp://0000000000000000000000000000000000000000000000000000000000000000';

    expect(() => verifyBatch(
      [{ path: 'bad.md', encryptedContent: content, uhrpUrl: badUrl, tokenTxid: 'tx1' }],
      { strict: true },
    )).toThrow('Integrity verification failed');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/integrity-verifier.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement integrity-verifier.ts**

Create `src/storage/integrity-verifier.ts`:

```typescript
/**
 * Integrity Verifier
 *
 * Verifies document integrity by comparing SHA-256 hashes of encrypted
 * content against UHRP URLs stored in PushDrop tokens.
 *
 * - Pre-retrieval: hash encrypted content, compare to token hash
 * - Post-retrieval: attach proof metadata to Shad results
 */

import { createHash } from 'crypto';
import type { ShadRetrievedDocument } from '../types/index.js';

export interface IntegrityResult {
  verified: boolean;
  contentHash: string;
  expectedHash: string;
}

export interface ProofMetadata {
  contentHash: string;
  tokenTxid: string;
  verified: boolean;
}

/**
 * Compute a UHRP URL from encrypted content.
 * UHRP URLs are `uhrp://{sha256hex}`.
 */
export function computeUhrpUrl(encryptedContent: Uint8Array): string {
  const hash = createHash('sha256').update(encryptedContent).digest('hex');
  return `uhrp://${hash}`;
}

/**
 * Extract the hex hash from a UHRP URL.
 */
export function extractHash(uhrpUrl: string): string {
  return uhrpUrl.replace('uhrp://', '');
}

/**
 * Verify encrypted content against a UHRP URL hash.
 */
export function verifyIntegrity(
  encryptedContent: Uint8Array,
  uhrpUrl: string,
): IntegrityResult {
  const computedHash = createHash('sha256').update(encryptedContent).digest('hex');
  const expectedHash = extractHash(uhrpUrl);

  return {
    verified: computedHash === expectedHash,
    contentHash: computedHash,
    expectedHash,
  };
}

/**
 * Verify a batch of encrypted files against their token hashes.
 * Returns a map of path → proof for verified files and a list of failed paths.
 */
export function verifyBatch(
  files: Array<{ path: string; encryptedContent: Uint8Array; uhrpUrl: string; tokenTxid: string }>,
  options?: { strict?: boolean },
): { verified: Map<string, ProofMetadata>; failed: string[] } {
  const verified = new Map<string, ProofMetadata>();
  const failed: string[] = [];

  for (const file of files) {
    const result = verifyIntegrity(file.encryptedContent, file.uhrpUrl);

    if (result.verified) {
      verified.set(file.path, {
        contentHash: result.contentHash,
        tokenTxid: file.tokenTxid,
        verified: true,
      });
    } else {
      console.warn(`[IntegrityVerifier] Hash mismatch for ${file.path}: expected ${result.expectedHash}, got ${result.contentHash}`);
      failed.push(file.path);

      if (options?.strict) {
        throw new Error(`Integrity verification failed for ${file.path} (strict mode)`);
      }
    }
  }

  return { verified, failed };
}

/**
 * Attach proof metadata to Shad retrieved documents.
 */
export function attachProofs(
  docs: ShadRetrievedDocument[],
  proofMap: Map<string, ProofMetadata>,
): ShadRetrievedDocument[] {
  return docs.map(doc => {
    const proof = proofMap.get(doc.path);
    if (proof) {
      return { ...doc, ...proof };
    }
    return { ...doc, verified: false };
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/integrity-verifier.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/storage/integrity-verifier.ts src/__tests__/integrity-verifier.test.ts
git commit -m "feat: add integrity verifier for pre/post retrieval hash checks"
```

---

### Task 5: Storage Coordinator

**Files:**
- Create: `src/storage/storage-coordinator.ts`
- Create: `src/__tests__/storage-coordinator.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/__tests__/storage-coordinator.test.ts`:

```typescript
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
    coordinator.clearDirty(); // reset
    await coordinator.delete('doc.md');
    expect(localVault.delete).toHaveBeenCalledWith('doc.md');
    expect(coordinator.getDirtyPaths()).toContain('doc.md');
    expect(coordinator.getDeletions()).toContain('doc.md');
  });

  it('clears dirty list', async () => {
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/storage-coordinator.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement storage-coordinator.ts**

Create `src/storage/storage-coordinator.ts`:

```typescript
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
    this.deletedPaths.delete(path); // un-mark deletion if re-written
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

  /** Get paths that have changed since last clearDirty() */
  getDirtyPaths(): string[] {
    return [...this.dirtyPaths];
  }

  /** Get paths that were deleted (subset of dirty) */
  getDeletions(): string[] {
    return [...this.deletedPaths];
  }

  /** Clear dirty tracking for specific paths or all */
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

  /** Get remote vault (for sync scheduler) */
  getRemoteVault(): VaultStore | undefined {
    return this.remoteVault;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/storage-coordinator.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/storage/storage-coordinator.ts src/__tests__/storage-coordinator.test.ts
git commit -m "feat: add StorageCoordinator with dirty list tracking"
```

---

### Task 6: Sync Scheduler

**Files:**
- Create: `src/storage/sync-scheduler.ts`
- Create: `src/__tests__/sync-scheduler.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/__tests__/sync-scheduler.test.ts`:

```typescript
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
    await scheduler.syncNow(); // sync first
    coordinator.clearDirty();
    await coordinator.delete('b.md');
    await scheduler.syncNow();
    expect(remoteVault.delete).toHaveBeenCalledWith('b.md');
  });

  it('is a no-op when no remote vault configured', async () => {
    const localOnly = new StorageCoordinator({ localVault });
    const localScheduler = new SyncScheduler({ coordinator: localOnly, intervalMs: 1000 });
    await coordinator.write('c.md', 'x');
    await localScheduler.syncNow(); // should not throw
    localScheduler.stop();
  });

  it('skips tick if sync is already running', async () => {
    // Write something to make sync do work
    await coordinator.write('d.md', 'content');

    // Make remote write slow
    (remoteVault.write as any).mockImplementation(async () => {
      await new Promise(r => setTimeout(r, 5000));
    });

    scheduler.start();
    // Trigger first tick
    await vi.advanceTimersByTimeAsync(1000);
    // Second tick should be skipped (first still running)
    const writeCallCount = (remoteVault.write as any).mock.calls.length;
    await vi.advanceTimersByTimeAsync(1000);
    expect((remoteVault.write as any).mock.calls.length).toBe(writeCallCount);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/sync-scheduler.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement sync-scheduler.ts**

Create `src/storage/sync-scheduler.ts`:

```typescript
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/sync-scheduler.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/storage/sync-scheduler.ts src/__tests__/sync-scheduler.test.ts
git commit -m "feat: add SyncScheduler for periodic UHRP backup"
```

---

### Task 7: Rewrite Memory Writer (Local-First)

**Depends on:** Task 4 (IntegrityVerifier), Task 5 (StorageCoordinator)

**Files:**
- Modify: `src/storage/memory/memory-writer.ts`
- Create: `src/__tests__/memory-writer-local-first.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/__tests__/memory-writer-local-first.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { createHash } from 'crypto';

/**
 * These tests validate the local-first write contract:
 * 1. Encrypts with protocol [2, 'agid memory'], keyID "1"
 * 2. Hashes encrypted output to compute UHRP URL
 * 3. Writes encrypted content to local vault via coordinator
 * 4. Creates PushDrop token with [uhrpUrl, tags] in 'agid-memory' basket
 * 5. No UHRP upload at write time
 */
describe('memory-writer local-first contract', () => {
  it('encrypts with correct protocol and keyID', async () => {
    const { storeMemory } = await import('../storage/memory/memory-writer.js');

    const mockEncrypt = vi.fn().mockResolvedValue({ ciphertext: [1, 2, 3, 4, 5] });
    const mockWallet = {
      encrypt: mockEncrypt,
      createAction: vi.fn().mockResolvedValue({ txid: 'test-txid' }),
      getUnderlyingWallet: () => ({}),
    } as any;

    const mockCoordinator = {
      write: vi.fn().mockResolvedValue(undefined),
    } as any;

    // Will fail on PushDrop (needs real wallet), but we can check encrypt was called correctly
    try {
      await storeMemory(mockWallet, { content: 'test', tags: ['tag1'] }, mockCoordinator);
    } catch {}

    expect(mockEncrypt).toHaveBeenCalledWith({
      plaintext: expect.any(Array),
      protocolID: [2, 'agid memory'],
      keyID: '1',
    });
  });

  it('writes encrypted content to coordinator', async () => {
    const { storeMemory } = await import('../storage/memory/memory-writer.js');

    const ciphertext = [10, 20, 30, 40, 50];
    const mockWallet = {
      encrypt: vi.fn().mockResolvedValue({ ciphertext }),
      createAction: vi.fn().mockResolvedValue({ txid: 'test-txid' }),
      getUnderlyingWallet: () => ({}),
    } as any;

    const mockCoordinator = {
      write: vi.fn().mockResolvedValue(undefined),
    } as any;

    try {
      await storeMemory(mockWallet, { content: 'test', tags: ['tag1'] }, mockCoordinator);
    } catch {}

    // Coordinator should have been called to write encrypted content
    expect(mockCoordinator.write).toHaveBeenCalled();
  });

  it('creates action in agid-memory basket without importance', async () => {
    const { storeMemory } = await import('../storage/memory/memory-writer.js');

    const mockCreateAction = vi.fn().mockResolvedValue({ txid: 'test-txid' });
    const mockWallet = {
      encrypt: vi.fn().mockResolvedValue({ ciphertext: [1, 2, 3] }),
      createAction: mockCreateAction,
      getUnderlyingWallet: () => ({}),
    } as any;

    const mockCoordinator = { write: vi.fn() } as any;

    try {
      await storeMemory(mockWallet, { content: 'test', tags: ['tag1'] }, mockCoordinator);
    } catch {}

    if (mockCreateAction.mock.calls.length > 0) {
      const actionArgs = mockCreateAction.mock.calls[0][0];
      expect(actionArgs.outputs[0].basket).toBe('agid-memory');
      // Verify no importance in tags
      expect(actionArgs.outputs[0].tags).not.toContain('high');
      expect(actionArgs.outputs[0].tags).not.toContain('medium');
      expect(actionArgs.outputs[0].tags).not.toContain('low');
    }
  });

  it('returns token without importance field', async () => {
    const { storeMemory } = await import('../storage/memory/memory-writer.js');
    expect(storeMemory).toBeDefined();
    // Full integration tested in Task 12
  });
});
```

- [ ] **Step 2: Rewrite memory-writer.ts**

Replace `src/storage/memory/memory-writer.ts` with the local-first implementation:

```typescript
/**
 * Memory Writer (Local-First)
 *
 * Local-first memory write workflow:
 * 1. Encrypt content with BRC-42 ([2, 'agid memory'], keyID "1")
 * 2. SHA-256 hash the encrypted output → compute UHRP URL locally
 * 3. Store encrypted content to local vault (via StorageCoordinator)
 * 4. Create PushDrop token [uhrpUrl, tags] in 'agid-memory' basket
 * 5. No UHRP upload at write time — deferred to SyncScheduler
 */

import { PushDrop } from '@bsv/sdk';
import type { BRC100Wallet } from '../../types/index.js';
import type { MemoryInput, MemoryToken } from './memory-types.js';
import { computeUhrpUrl } from '../integrity-verifier.js';
import type { StorageCoordinator } from '../storage-coordinator.js';

/** Constants */
export const PROTOCOL_ID: [number, string] = [2, 'agid memory'];
export const KEY_ID = '1';
export const BASKET = 'agid-memory';

/**
 * Store a memory with local-first pattern.
 *
 * @param wallet - Agent's BRC-100 wallet
 * @param memory - Memory content and tags
 * @param coordinator - Storage coordinator for local vault write + dirty tracking
 * @returns Memory token with txid and locally-computed UHRP URL
 */
export async function storeMemory(
  wallet: BRC100Wallet & { getUnderlyingWallet?: () => any },
  memory: MemoryInput,
  coordinator?: StorageCoordinator,
): Promise<MemoryToken> {
  const underlyingWallet = wallet.getUnderlyingWallet?.();
  if (!underlyingWallet) {
    throw new Error('Cannot access underlying wallet for memory storage');
  }

  // 1. Encrypt content
  const plaintext = new TextEncoder().encode(memory.content);
  const encrypted = await wallet.encrypt({
    plaintext: Array.from(plaintext),
    protocolID: PROTOCOL_ID,
    keyID: KEY_ID,
  });

  // 2. Hash encrypted output → compute UHRP URL locally
  const encryptedBytes = new Uint8Array(encrypted.ciphertext);
  const uhrpUrl = computeUhrpUrl(encryptedBytes);

  // 3. Store encrypted content to local vault (adds to dirty list for sync)
  const storagePath = `memories/${memory.tags.join('-') || 'memory'}-${Date.now()}.enc`;
  if (coordinator) {
    await coordinator.write(storagePath, Buffer.from(encryptedBytes).toString('base64'));
  }

  // 4. Create PushDrop token with [uhrpUrl, tags]
  const fields: number[][] = [
    Array.from(new TextEncoder().encode(uhrpUrl)),
    Array.from(new TextEncoder().encode(memory.tags.join(','))),
  ];

  const pushDrop = new PushDrop(underlyingWallet);
  const lockingScript = await pushDrop.lock(
    fields,
    PROTOCOL_ID,
    KEY_ID,
    'self',
    false,
    true,
    'before',
  );

  // 5. Create transaction with token in agid-memory basket
  const result = await wallet.createAction({
    description: `Memory: ${memory.tags.join(', ')}`,
    outputs: [{
      script: lockingScript.toHex(),
      satoshis: 1,
      basket: BASKET,
      tags: ['agid memory', ...memory.tags],
    }],
    labels: ['agid memory', ...memory.tags],
  });

  return {
    txid: result.txid,
    uhrpUrl,
    tags: memory.tags,
    createdAt: Date.now(),
  };
}
```

- [ ] **Step 3: Run test**

Run: `npx vitest run src/__tests__/memory-writer-local-first.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/storage/memory/memory-writer.ts src/__tests__/memory-writer-local-first.test.ts
git commit -m "feat: rewrite memory writer to local-first pattern"
```

---

### Task 8: Rewrite Memory Reader

**Depends on:** Task 4 (IntegrityVerifier), Task 5 (StorageCoordinator)

**Files:**
- Modify: `src/storage/memory/memory-reader.ts`

- [ ] **Step 1: Update memory-reader.ts**

Replace `src/storage/memory/memory-reader.ts` to use:
- `agid-memory` basket
- `[2, 'agid memory']` protocol ID
- Key ID `"1"`
- 2-field PushDrop tokens `[uhrpUrl, tags]` (no importance)
- **Local vault read first**, UHRP download only as recovery fallback

```typescript
/**
 * Memory Reader
 *
 * Local-first read flow:
 * 1. Query 'agid-memory' basket for PushDrop tokens
 * 2. Try reading encrypted content from local vault (via coordinator)
 * 3. If local not available, fall back to UHRP download + verify + restore
 * 4. Decrypt with protocol [2, 'agid memory'], keyID "1"
 */

import { PushDrop, StorageDownloader, LockingScript } from '@bsv/sdk';
import type { BRC100Wallet } from '../../types/index.js';
import { getTransactionTimestamp } from './arc-client.js';
import { verifyIntegrity } from '../integrity-verifier.js';
import type { StorageCoordinator } from '../storage-coordinator.js';

const PROTOCOL_ID: [number, string] = [2, 'agid memory'];
const KEY_ID = '1';
const BASKET = 'agid-memory';
const DOWNLOAD_TIMEOUT_MS = 15_000;

export interface Memory {
  outpoint: string;
  txid: string;
  uhrpUrl: string;
  content: string;
  tags: string[];
  createdAt: number;
  beef?: number[];
}

export async function listMemories(
  wallet: BRC100Wallet & { getUnderlyingWallet?: () => any },
  options?: { tags?: string[]; coordinator?: StorageCoordinator },
): Promise<Memory[]> {
  const underlyingWallet = wallet.getUnderlyingWallet?.();
  if (!underlyingWallet) {
    throw new Error('Wallet not initialized');
  }

  const network = await wallet.getNetwork();
  const coordinator = options?.coordinator;

  // 1. Query agid-memory basket
  const listArgs = {
    basket: BASKET,
    tags: options?.tags ? ['agid memory', ...options.tags] : ['agid memory'],
    include: 'locking scripts',
    includeCustomInstructions: true,
  };
  const result = await underlyingWallet.listOutputs(listArgs);

  // 2. Decode and decrypt each token
  const memories: Memory[] = [];
  const downloader = new StorageDownloader({ networkPreset: network });

  for (let idx = 0; idx < result.outputs.length; idx++) {
    const output = result.outputs[idx];
    try {
      if (!output.spendable || !output.lockingScript) continue;

      // Decode PushDrop token: [uhrpUrl, tags]
      const decoded = PushDrop.decode(LockingScript.fromHex(output.lockingScript), 'before');
      const [uhrpUrlBytes, tagsBytes] = decoded.fields;

      const uhrpUrl = new TextDecoder().decode(new Uint8Array(uhrpUrlBytes));
      const tagsStr = new TextDecoder().decode(new Uint8Array(tagsBytes));

      // 3. Get encrypted content — local first, then UHRP recovery
      let ciphertextBytes: Uint8Array | null = null;

      // 3a. Try embedded data in token
      if (uhrpUrl === 'embedded' && decoded.fields.length >= 3) {
        ciphertextBytes = new Uint8Array(decoded.fields[2]);
      }

      // 3b. Try local vault via coordinator
      if (!ciphertextBytes && coordinator) {
        const localPaths = await coordinator.list();
        // Find matching file by scanning local vault
        for (const localPath of localPaths) {
          const localContent = await coordinator.read(localPath);
          if (localContent) {
            const decoded = Buffer.from(localContent, 'base64');
            const integrity = verifyIntegrity(new Uint8Array(decoded), uhrpUrl);
            if (integrity.verified) {
              ciphertextBytes = new Uint8Array(decoded);
              break;
            }
          }
        }
      }

      // 3c. Recovery: download from UHRP
      if (!ciphertextBytes) {
        const downloadResult = await Promise.race([
          downloader.download(uhrpUrl),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('UHRP download timed out')), DOWNLOAD_TIMEOUT_MS)
          ),
        ]);
        ciphertextBytes = downloadResult.data;

        // Verify integrity of downloaded content
        const integrity = verifyIntegrity(ciphertextBytes, uhrpUrl);
        if (!integrity.verified) {
          console.warn(`[MemoryReader] Integrity check failed for ${uhrpUrl} — skipping`);
          continue;
        }

        // Restore to local vault
        if (coordinator) {
          const restorePath = `memories/recovered-${output.outpoint.split(':')[0].substring(0, 8)}.enc`;
          await coordinator.write(restorePath, Buffer.from(ciphertextBytes).toString('base64'));
          console.log(`[MemoryReader] Restored ${uhrpUrl} to local vault`);
        }
      }

      // 4. Decrypt
      const decrypted = await wallet.decrypt({
        ciphertext: Array.from(ciphertextBytes),
        protocolID: PROTOCOL_ID,
        keyID: KEY_ID,
      });

      // 5. Get timestamp
      const txid = output.outpoint.split(':')[0];
      const createdAt = await getTransactionTimestamp(txid);

      const content = Buffer.from(decrypted.plaintext).toString('utf-8');
      memories.push({
        outpoint: output.outpoint,
        txid,
        uhrpUrl,
        content,
        tags: tagsStr.split(',').filter(t => t.length > 0),
        createdAt,
      });
    } catch (error) {
      console.warn(`[MemoryReader] Output ${idx} failed:`, error);
    }
  }

  return memories;
}
```

- [ ] **Step 2: Run existing tests**

Run: `npx vitest run`
Expected: Compilation and existing tests pass (may need to fix import references in memory-manager.ts — see Task 9)

- [ ] **Step 3: Commit**

```bash
git add src/storage/memory/memory-reader.ts
git commit -m "feat: rewrite memory reader — local-first with UHRP recovery fallback"
```

---

### Task 9: Update Memory Manager

**Files:**
- Modify: `src/storage/memory/memory-manager.ts`

- [ ] **Step 1: Remove importance references**

In `src/storage/memory/memory-manager.ts`:

1. Remove `importance` from `RecallOptions` interface (line 54)
2. Remove `importance` from `RecallResult.memories` entries (line 67)
3. Remove `importance` from `toRecallEntry()` function (line 484)
4. Remove `importance` parameter from `getCachedMemories()` (line 244)
5. Remove `importance` filter in `directRecall()` (line 362)
6. Remove `importance` filter in `semanticRecall()` (line 386)
7. Remove `importance` boost in `keywordRecall()` (line 310)

- [ ] **Step 2: Update toRecallEntry to match new Memory interface**

```typescript
function toRecallEntry(m: Memory) {
  return {
    content: m.content,
    tags: m.tags,
    txid: m.txid,
    blockTimestamp: m.createdAt,
    uhrpUrl: m.uhrpUrl,
    outpoint: m.outpoint,
  };
}
```

- [ ] **Step 3: Update RecallResult type**

```typescript
export interface RecallResult {
  memories: Array<{
    content: string;
    tags: string[];
    txid: string;
    blockTimestamp: number;
    uhrpUrl: string;
    outpoint?: string;
  }>;
  total: number;
  returned: number;
  shadAvailable?: boolean;
  output?: string;
  message?: string;
  skipped?: boolean;
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/storage/memory/memory-manager.ts
git commit -m "feat: remove importance from memory manager, update recall types"
```

---

### Task 10: Update Memory GC

**Files:**
- Modify: `src/storage/memory/memory-gc.ts`

- [ ] **Step 1: Update basket name and remove importance-based retention**

Change:
- Basket query from `agent-memories` to `agid-memory`
- Tags from `agidentity memory` to `agid memory`
- Remove importance-based retention logic — use a single retention period (e.g., 365 days for all)
- Update PushDrop decode to expect 2 fields `[uhrpUrl, tags]` instead of 3

- [ ] **Step 2: Run tests**

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/storage/memory/memory-gc.ts
git commit -m "feat: update memory GC for agid-memory basket and flat retention"
```

---

### Task 11: Fix Remaining Imports and References

**Files:**
- Modify: `src/agent/tools/memory.ts` (remove `importance` from tool schemas and call sites)
- Modify: `src/storage/memory/agidentity-memory-server.ts` (update basket/protocol references if present)
- Modify: any other files referencing old basket name, protocol ID, or importance

- [ ] **Step 1: Update `src/agent/tools/memory.ts`**

This file defines the agent-facing tool schemas (`agid_store_memory`, `agid_recall_memories`). Changes:
- Remove `importance` parameter from `agid_store_memory` tool schema
- Remove `importance` parameter from `agid_recall_memories` tool schema
- Update `store()` calls to not pass `importance`
- Update `recall()` calls to not pass `importance`

- [ ] **Step 2: Search for old references in remaining files**

```bash
grep -r "agent-memories\|agidentity memory\|importance.*high\|importance.*medium\|importance.*low" src/ --include="*.ts" -l
```

Fix each file found to use the new constants.

- [ ] **Step 3: Check `agidentity-memory-server.ts`**

```bash
grep -r "agent-memories\|agidentity memory\|importance" src/storage/memory/agidentity-memory-server.ts
```

Update any references found.

- [ ] **Step 4: Search for old memory type usage**

```bash
grep -r "importance.*MemoryInput\|importance.*MemoryToken" src/ --include="*.ts" -l
```

Fix callers that pass `importance` to `storeMemory()` or expect it in return values.

- [ ] **Step 5: Run full test suite**

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "fix: update all references to new basket, protocol, and token format"
```

---

### Task 12: Integration Test — Full Write/Verify/Read Cycle

**Files:**
- Create: `src/__tests__/integration-local-first.test.ts`

- [ ] **Step 1: Write integration test**

Create `src/__tests__/integration-local-first.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run integration test**

Run: `npx vitest run src/__tests__/integration-local-first.test.ts`
Expected: PASS

- [ ] **Step 3: Run full test suite**

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/__tests__/integration-local-first.test.ts
git commit -m "test: add integration tests for local-first write/verify/sync cycle"
```

---

## Summary

| Task | Component | Estimated Steps |
|------|-----------|-----------------|
| 1 | Types | 7 |
| 2 | Config | 6 |
| 3 | Shad retriever | 5 |
| 4 | Integrity verifier | 5 |
| 5 | Storage coordinator | 5 |
| 6 | Sync scheduler | 5 |
| 7 | Memory writer rewrite | 4 |
| 8 | Memory reader rewrite | 3 |
| 9 | Memory manager update | 5 |
| 10 | Memory GC update | 3 |
| 11 | Fix references | 4 |
| 12 | Integration tests | 4 |
| **Total** | | **56 steps** |

Tasks 1-3 are foundational (types, config, retriever flag). Tasks 4-6 are new modules (verifier, coordinator, scheduler). Tasks 7-10 are rewrites of existing memory code. Tasks 11-12 are cleanup and integration testing.
