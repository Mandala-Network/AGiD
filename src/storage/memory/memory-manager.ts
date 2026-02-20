/**
 * MemoryManager
 *
 * Unified facade for memory operations: store, recall (with optional semantic search),
 * and garbage collection. Absorbs the semantic search logic previously embedded
 * in tool-registry.ts.
 */

import * as fs from 'fs';
import * as path from 'path';
import { mkdtemp, chmod, writeFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { storeMemory } from './memory-writer.js';
import { listMemories } from './memory-reader.js';
import { applyGarbageCollection } from './memory-gc.js';
import { ShadTempVaultExecutor } from '../../integrations/shad/shad-temp-executor.js';
import type { Memory } from './memory-reader.js';
import type { MemoryInput, MemoryToken } from './memory-types.js';
import type { GCStats } from './memory-gc.js';
import type { AgentWallet } from '../../wallet/agent-wallet.js';
import type { GepaOptimizer } from '../../integrations/gepa/gepa-optimizer.js';

export interface MemoryManagerOptions {
  workspacePath?: string;
  gepaOptimizer?: GepaOptimizer;
}

export interface RecallOptions {
  tags?: string[];
  importance?: string;
  limit?: number;
  semantic?: boolean;
  query?: string;
  strategy?: string;
  maxDepth?: number;
  maxTime?: number;
}

export interface RecallResult {
  memories: Array<{
    content: string;
    tags: string[];
    importance: string;
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
}

export class MemoryManager {
  constructor(
    private wallet: AgentWallet,
    private options?: MemoryManagerOptions,
  ) {}

  async store(input: MemoryInput): Promise<MemoryToken> {
    const optimizer = this.options?.gepaOptimizer;
    if (optimizer?.available) {
      const optimizedContent = await optimizer.optimizeMemory(input.content, input.tags);
      return storeMemory(this.wallet, { ...input, content: optimizedContent });
    }
    return storeMemory(this.wallet, input);
  }

  async recall(opts?: RecallOptions): Promise<RecallResult> {
    if (opts?.semantic && opts.query) {
      return this.semanticRecall(opts);
    }
    return this.directRecall(opts);
  }

  async gc(): Promise<GCStats> {
    return applyGarbageCollection(this.wallet);
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private async directRecall(opts?: RecallOptions): Promise<RecallResult> {
    const limit = opts?.limit ?? 20;
    const memories = await listMemories(this.wallet, {
      tags: opts?.tags,
      importance: opts?.importance,
    });
    const limited = memories.slice(0, limit);
    return {
      memories: limited.map(toRecallEntry),
      total: memories.length,
      returned: limited.length,
    };
  }

  private async semanticRecall(opts: RecallOptions): Promise<RecallResult> {
    const query = opts.query!;
    const strategy = opts.strategy ?? 'research';
    const maxDepth = opts.maxDepth ?? 3;
    const maxTime = opts.maxTime ?? 120;
    const importance = opts.importance;

    // 1. Fetch all on-chain memories
    let memories: Memory[];
    try {
      memories = await listMemories(this.wallet, { importance });
    } catch (error) {
      return {
        memories: [],
        total: 0,
        returned: 0,
        message: `Failed to retrieve memories: ${error instanceof Error ? error.message : String(error)}`,
      };
    }

    if (memories.length === 0 && !this.options?.workspacePath) {
      return { memories: [], total: 0, returned: 0, message: 'No memories found' };
    }

    // 2. Create secure temp directory
    const tempDir = await mkdtemp(path.join(tmpdir(), 'agid-search-'));
    await chmod(tempDir, 0o700);

    try {
      // 3. Write decrypted memories as files
      const provenanceMap = new Map<string, Memory>();
      for (const memory of memories) {
        const safeName = `${memory.tags.join('-') || 'memory'}-${memory.txid.substring(0, 8)}.md`;
        await writeFile(path.join(tempDir, safeName), memory.content, { encoding: 'utf-8', mode: 0o600 });
        provenanceMap.set(safeName, memory);
      }

      // 4. Include workspace MEMORY.md if present
      if (this.options?.workspacePath) {
        const memoryMdPath = path.join(this.options.workspacePath, 'MEMORY.md');
        if (fs.existsSync(memoryMdPath)) {
          const content = fs.readFileSync(memoryMdPath, 'utf8');
          await writeFile(path.join(tempDir, 'workspace-MEMORY.md'), content, { encoding: 'utf-8', mode: 0o600 });
        }
      }

      // 5. Check Shad availability
      const executor = new ShadTempVaultExecutor({
        vault: {
          read: async (p: string) => fs.readFileSync(path.join(tempDir, p), 'utf8'),
          list: async () => fs.readdirSync(tempDir),
          write: async () => {},
          delete: async () => false,
        },
        shadConfig: { strategy: strategy as any, maxDepth, maxTime },
      });

      const availability = await executor.checkShadAvailable();
      if (!availability.available) {
        return {
          memories: memories.slice(0, 10).map(toRecallEntry),
          total: memories.length,
          returned: Math.min(10, memories.length),
          shadAvailable: false,
          message: 'Shad not installed — returning unranked memories. Install: pip install shad',
        };
      }

      // 6. Run Shad search
      const result = await executor.execute(query, { strategy: strategy as any, maxDepth, maxTime });

      if (!result.success) {
        return {
          memories: memories.slice(0, 5).map(toRecallEntry),
          total: memories.length,
          returned: Math.min(5, memories.length),
          shadAvailable: true,
          message: `Shad search failed: ${result.error}`,
        };
      }

      // 7. Attach provenance to results
      const enriched = (result.retrievedDocuments ?? []).map((doc: any) => {
        const fileName = typeof doc === 'string' ? path.basename(doc) : doc.path ? path.basename(doc.path) : '';
        const provenance = provenanceMap.get(fileName);
        return {
          content: typeof doc === 'string' ? doc : doc.content ?? String(doc),
          tags: provenance?.tags ?? [],
          importance: provenance?.importance ?? 'medium',
          txid: provenance?.txid ?? '',
          blockTimestamp: provenance?.createdAt ?? 0,
          uhrpUrl: provenance?.uhrpUrl ?? '',
        };
      });

      return {
        memories: enriched,
        total: enriched.length,
        returned: enriched.length,
        shadAvailable: true,
        output: result.output,
      };
    } finally {
      try { await rm(tempDir, { recursive: true, force: true }); } catch {}
    }
  }
}

function toRecallEntry(m: Memory) {
  return {
    content: m.content,
    tags: m.tags,
    importance: m.importance,
    txid: m.txid,
    blockTimestamp: m.createdAt,
    uhrpUrl: m.uhrpUrl,
    outpoint: m.outpoint,
  };
}
