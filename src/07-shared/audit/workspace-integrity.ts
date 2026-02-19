/**
 * Workspace Integrity
 *
 * Hashes workspace files (SOUL.md, IDENTITY.md, MEMORY.md, TOOLS.md) and
 * compares against the last on-chain anchor to detect tampering between sessions.
 */

import * as fs from 'fs';
import * as path from 'path';
import { sha256 } from './anchor-chain.js';
import { decodePushDropToken } from '../../01-core/wallet/pushdrop-ops.js';
import type { BRC100Wallet } from '../types/index.js';

// ============================================================================
// Types
// ============================================================================

export interface WorkspaceHash {
  files: Record<string, string>;  // filename → SHA-256
  combinedHash: string;           // SHA-256 of sorted file hashes
  timestamp: number;
}

export interface IntegrityStatus {
  verified: boolean;
  lastAnchorTxid?: string;
  modifiedFiles: string[];
  missingFiles: string[];
  newFiles: string[];
}

// ============================================================================
// Constants
// ============================================================================

const WORKSPACE_FILES = ['SOUL.md', 'IDENTITY.md', 'MEMORY.md', 'TOOLS.md'];

// ============================================================================
// WorkspaceIntegrity Class
// ============================================================================

export class WorkspaceIntegrity {
  private workspacePath: string;

  constructor(workspacePath: string) {
    this.workspacePath = workspacePath;
  }

  async hashWorkspace(): Promise<WorkspaceHash> {
    const files: Record<string, string> = {};

    for (const filename of WORKSPACE_FILES) {
      const filePath = path.join(this.workspacePath, filename);
      try {
        const content = fs.readFileSync(filePath, 'utf8');
        files[filename] = await sha256(content);
      } catch {
        // File doesn't exist — skip
      }
    }

    // Combined hash: sort filenames, concatenate hashes, SHA-256
    const sortedEntries = Object.keys(files)
      .sort()
      .map((k) => `${k}:${files[k]}`);
    const combinedHash = sortedEntries.length > 0
      ? await sha256(sortedEntries.join('|'))
      : '0'.repeat(64);

    return { files, combinedHash, timestamp: Date.now() };
  }

  checkIntegrity(current: WorkspaceHash, reference: WorkspaceHash): IntegrityStatus {
    const modifiedFiles: string[] = [];
    const missingFiles: string[] = [];
    const newFiles: string[] = [];

    // Check files that existed in reference
    for (const [filename, hash] of Object.entries(reference.files)) {
      if (!(filename in current.files)) {
        missingFiles.push(filename);
      } else if (current.files[filename] !== hash) {
        modifiedFiles.push(filename);
      }
    }

    // Check for new files not in reference
    for (const filename of Object.keys(current.files)) {
      if (!(filename in reference.files)) {
        newFiles.push(filename);
      }
    }

    const verified = modifiedFiles.length === 0 && missingFiles.length === 0 && newFiles.length === 0;

    return { verified, modifiedFiles, missingFiles, newFiles };
  }

  async getLastAnchor(wallet: BRC100Wallet): Promise<{ txid: string; workspaceHash: string } | null> {
    try {
      const underlyingWallet = (wallet as any).getUnderlyingWallet?.() ?? wallet;
      const result = await underlyingWallet.listOutputs({
        basket: 'anchor-chain',
        tags: ['pushdrop', 'proto:agidentity-anchor'],
        include: 'locking scripts',
        limit: 10,
      });

      const outputs = (result?.outputs ?? []) as any[];
      // Find most recent spendable token
      const spendable = outputs.filter((o: any) => o.spendable && o.lockingScript);
      if (spendable.length === 0) return null;

      // Sort by outpoint (rough chronological order)
      spendable.sort((a: any, b: any) => {
        const aTxid = a.outpoint?.split('.')[0] ?? '';
        const bTxid = b.outpoint?.split('.')[0] ?? '';
        return bTxid.localeCompare(aTxid);
      });

      const latest = spendable[0];
      const decoded = decodePushDropToken(latest.lockingScript);

      // Fields: [0]=protocol, [1]=sessionId, [2]=merkleRoot, [3]=headHash, [4]=workspaceHash, [5]=anchorCount
      const txid = latest.outpoint?.split('.')[0] ?? 'unknown';
      const workspaceHash = decoded.fields[4] ?? '';

      return { txid, workspaceHash };
    } catch {
      return null;
    }
  }
}
