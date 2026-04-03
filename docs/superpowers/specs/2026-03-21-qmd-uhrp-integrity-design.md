# QMD Retriever, Local-First Storage & Integrity Verification

**Date:** 2026-03-21
**Status:** Draft

## Overview

Let Shad auto-detect and use QMD for hybrid retrieval (BM25 + vector + reranking), implement local-first storage with scheduled UHRP backup, and add integrity verification using content hashes stored in PushDrop tokens.

## Goals

1. Use Shad with `--retriever auto` so it auto-detects QMD for hybrid search
2. Local-first storage with PushDrop tokens created at write-time
3. Scheduled sync to UHRP as optional remote backup
4. Pre- and post-retrieval integrity verification using content hashes
5. Recovery path from PushDrop tokens when local storage is lost

## Non-Goals

- Replacing existing vault implementations (LocalEncryptedVault, EncryptedShadVault)
- Managing QMD embeddings or indexing directly (Shad handles this)
- Adding `@tobilu/qmd` as a direct dependency (Shad manages its own QMD integration)
- Passphrase-based key ID protection (future feature)

---

## 1. Shad Retriever Configuration

The `ShadTempVaultExecutor` currently hardcodes `--retriever filesystem`. Change to `--retriever auto`.

- Default: `auto` — Shad auto-detects QMD if installed and uses hybrid search (BM25 + vector + RRF + reranking). Falls back to filesystem if QMD is not available.
- Shad's `--qmd-hybrid` flag is on by default, so hybrid search is automatic when QMD is detected.
- Shad manages QMD indexing and embedding internally — AGiD just provides the decrypted files in the temp directory as before.
- The retriever remains configurable via `ShadConfig` and env var `SHAD_RETRIEVER` for cases where you want to force a specific backend.
- **Prerequisite:** QMD must be installed globally (`npm install -g @tobilu/qmd`) for Shad to detect it.

No changes to the temp vault decrypt/cleanup flow. The only difference is which flag Shad receives.

**Shad search modes available via `ShadTempVaultExecutor`:**
- `execute()` — full DAG reasoning with vault context
- `search()` — `shad search` with hybrid/bm25/vector modes
- `context()` — retrieval + synthesis without full DAG

---

## 2. PushDrop Token Format

**Basket:** `agid-memory`

**Token fields:** `[uhrpUrl, tags]`

| Field    | Description                                              |
|----------|----------------------------------------------------------|
| uhrpUrl  | `uhrp://{sha256 of encrypted content}` — computed locally at write-time |
| tags     | Serialized tag array for filtering without decryption    |

**Encryption parameters:**

| Parameter     | Value                    |
|---------------|--------------------------|
| Protocol ID   | `[2, 'agid memory']`    |
| Key ID        | `"1"`                    |
| Counterparty  | User's own public key    |

**Note:** No backward compatibility needed — system is not yet in production. Old code using `agent-memories` basket, `[2, 'agidentity memory']` protocol, and `importance` field will be replaced directly.

---

## 3. Memory Writer Flow (Local-First)

1. Encrypt content with BRC-42 (`[2, 'agid memory']`, key ID `"1"`, counterparty = user pubkey)
2. SHA-256 hash the **encrypted** output → compute `uhrp://{hash}` locally
3. Store encrypted content to local vault
4. Create PushDrop token immediately: `[uhrpUrl, tags]` in `agid-memory` basket
5. Add path to Storage Coordinator's dirty list for scheduled remote sync
6. Return: `{ txid, uhrpUrl, tags, createdAt }`

**Key detail:** The UHRP URL is computed from the encrypted content hash, not the plaintext hash. This is because UHRP stores encrypted bytes, and the hash must match what is actually stored for integrity verification to work without decryption.

---

## 4. Memory Reader Flow

### Normal read (local available)

1. Query `agid-memory` basket for PushDrop tokens
2. Extract UHRP URLs, tags from token fields
3. Read encrypted content from local vault
4. Decrypt with BRC-42 using protocol ID `[2, 'agid memory']`, key ID `"1"`
5. Return memories

### Recovery read (local lost)

1. Query `agid-memory` basket — tokens are still in wallet
2. Extract UHRP URLs from tokens
3. Download encrypted content from UHRP using those URLs
4. Re-hash downloaded content, verify against UHRP URL hash
5. If verified: decrypt and restore to local vault
6. If mismatch: flag as corrupted, do not restore

### Retrieval with Shad (QMD path)

1. Read encrypted memories from local vault
2. Run integrity verifier on encrypted content (pre-retrieval)
3. Decrypt verified files to temp directory
4. Execute Shad with `--retriever auto` (auto-detects QMD if installed)
5. Run integrity verifier (post-retrieval, attach proofs to cited docs)
6. Cleanup temp directory

---

## 5. Storage Coordinator

A thin coordination layer on top of existing `LocalEncryptedVault` and `EncryptedShadVault`. Does not replace them.

**Responsibilities:**
- All reads and writes go to local first (always the primary)
- Tracks which documents have changed since last sync (dirty list)
- Exposes the `VaultStore` interface so consumers are unaware of coordination

**Behavior:**
- `write()` → writes to local vault, adds path to dirty list
- `read()` → reads from local vault only
- `delete()` → deletes from local vault, adds deletion to dirty list
- `list()` → lists from local vault
- `search()` → searches local vault

The coordinator never reads from remote. Remote is a write-only backup target.

---

## 6. Sync Scheduler

Runs on a configurable interval and pushes dirty changes to the remote backend.

**Behavior:**
- Runs on configurable interval (default: 1 hour)
- On each tick: reads the dirty list from the coordinator, batches changes, pushes to UHRP
- Deletions are tracked and synced (removes from remote index)
- After successful sync: clears dirty list for synced items
- On failure: item stays on dirty list for next tick
- Logs sync results (uploaded, failed, skipped)

**Lifecycle:**
- `start()` — begins the interval timer
- `stop()` — clears the timer, optionally runs a final sync
- `syncNow()` — manual trigger for immediate sync (shutdown/testing)

**Edge cases:**
- If a sync is still running when the next tick fires, skip that tick
- If remote vault is not configured, scheduler is a no-op
- On startup, compares local dirty list against remote UHRP index (metadata-only, no content download) to catch anything missed while offline

---

## 7. Integrity Verifier

### Pre-retrieval (before Shad runs)

Integrity verification happens on the **encrypted** content, before decryption. This allows verification without needing the private key.

1. Read encrypted content from local vault for each memory
2. SHA-256 hash the **encrypted** content
3. Compare computed hash against the `uhrpUrl` hash in the corresponding PushDrop token from `agid-memory` basket
4. **Soft fail (default):** exclude tampered file, log warning, continue
5. **Strict mode:** abort entire Shad execution
6. Only verified files are decrypted to the temp directory for Shad

### Post-retrieval (after Shad returns)

For each document Shad cited in its results, attach proof metadata:

| Field         | Description                              |
|---------------|------------------------------------------|
| contentHash   | The verified SHA-256                     |
| tokenTxid     | The PushDrop token transaction ID        |
| verified      | `true` / `false`                         |

This proof metadata is returned in the `ShadResult` so consumers can verify provenance.

**Type changes required:** Add optional fields to `ShadRetrievedDocument`:

```typescript
export interface ShadRetrievedDocument {
  path: string;
  content: string;
  confidence: number;
  source: string;
  // New integrity proof fields
  contentHash?: string;
  tokenTxid?: string;
  verified?: boolean;
}
```

---

## 8. Configuration

The config extends the existing `AGIdentityEnvConfig` type. The `retriever` field already exists in `ShadConfig` — we just ensure it is read from env and passed through to the executor.

```typescript
interface AGiDConfig {
  // ... existing fields ...

  // Shad retriever — default: 'auto' (auto-detects QMD if installed)
  shadRetriever: 'auto' | 'qmd' | 'filesystem';

  // Remote backup
  remoteBackup: {
    enabled: boolean;              // default: false
    intervalMs: number;            // default: 3600000 (1 hour)
    remoteVault?: EncryptedShadVault;
  };

  // Integrity verification
  integrity: {
    strict: boolean;               // default: false
    verifyOnRetrieval: boolean;    // default: true
  };
}
```

**Environment variables:**

| Variable                   | Default     | Description                    |
|----------------------------|-------------|--------------------------------|
| `SHAD_RETRIEVER`           | `auto`      | Shad retriever mode (auto-detects QMD) |
| `REMOTE_BACKUP_ENABLED`    | `false`     | Enable UHRP backup sync       |
| `REMOTE_BACKUP_INTERVAL_MS`| `3600000`   | Sync interval (1 hour)         |
| `INTEGRITY_STRICT`         | `false`     | Abort on verification failure  |
| `INTEGRITY_VERIFY`         | `true`      | Enable verification on retrieval |

**Constants (not configurable):**

| Constant      | Value                |
|---------------|----------------------|
| Basket name   | `agid-memory`        |
| Protocol ID   | `[2, 'agid memory']` |
| Key ID        | `"1"`                |

---

## Architecture Diagram

```
Write Path:
  Agent creates memory
    → Encrypt (BRC-42, protocol [2, 'agid memory'], key "1")
    → SHA-256 hash encrypted content → uhrp://{hash}
    → Store to local vault
    → Create PushDrop token [uhrpUrl, tags] in agid-memory basket
    → Add to dirty list

Sync Path (scheduled, default 1 hour):
  SyncScheduler tick
    → Read dirty list from StorageCoordinator
    → Batch upload encrypted content to UHRP
    → Clear synced items from dirty list

Read Path:
  Agent recalls memories
    → Query agid-memory basket for PushDrop tokens
    → Read encrypted content from local vault (or recover from UHRP)
    → IntegrityVerifier: hash encrypted content, compare to token hashes
    → Decrypt verified files to temp directory
    → Shad --retriever auto (auto-detects QMD, over verified files only)
    → IntegrityVerifier: attach proofs to cited documents
    → Cleanup temp directory
    → Return results with provenance

Recovery Path:
  Local storage lost
    → PushDrop tokens still in wallet
    → Extract UHRP URLs → download encrypted content
    → Verify hash against token → decrypt → restore local
```
