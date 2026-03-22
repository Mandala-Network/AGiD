/**
 * MemoryManager
 *
 * Unified facade for memory operations: store, recall (with optional semantic search),
 * and garbage collection. Features:
 * - TTL-based memory cache (avoids decrypting all memories every request)
 * - Smart recall gating (skips recall for trivial messages)
 * - Cached Shad availability (checks once, not per call)
 * - GEPA optimization at store time
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

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** How long cached memories stay fresh (ms) */
const MEMORY_CACHE_TTL_MS = 60_000; // 60 seconds

/** Messages shorter than this skip recall entirely */
const TRIVIAL_MESSAGE_MAX_LENGTH = 15;

/** Trivial message patterns that don't need memory recall */
const TRIVIAL_PATTERNS = /^(hi|hey|hello|yo|sup|thanks|thank you|ok|okay|yes|no|yep|nope|sure|bye|goodbye|cool|nice|great|lol|haha|hmm|wow|k)\s*[.!?]*$/i;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MemoryManagerOptions {
  workspacePath?: string;
  gepaOptimizer?: GepaOptimizer;
  /** Pre-initialized Shad executor (skips per-call availability checks) */
  shadExecutor?: ShadTempVaultExecutor;
  /** Memory cache TTL in ms (default: 60000) */
  cacheTtlMs?: number;
}

export interface RecallOptions {
  tags?: string[];
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
  /** True if recall was skipped (trivial message) */
  skipped?: boolean;
}

// ---------------------------------------------------------------------------
// Memory Cache
// ---------------------------------------------------------------------------

interface MemoryCache {
  memories: Memory[];
  fetchedAt: number;
}

// ---------------------------------------------------------------------------
// MemoryManager
// ---------------------------------------------------------------------------

export class MemoryManager {
  private shadAvailable: boolean | null = null;
  private memoryCache: MemoryCache | null = null;
  private cacheTtlMs: number;

  constructor(
    private wallet: AgentWallet,
    private options?: MemoryManagerOptions,
  ) {
    this.cacheTtlMs = options?.cacheTtlMs ?? MEMORY_CACHE_TTL_MS;
  }

  // =========================================================================
  // Store
  // =========================================================================

  async store(input: MemoryInput): Promise<MemoryToken> {
    // Invalidate cache when new memory is stored
    this.memoryCache = null;

    const optimizer = this.options?.gepaOptimizer;
    if (optimizer?.available) {
      const optimizedContent = await optimizer.optimizeMemory(input.content, input.tags);
      return storeMemory(this.wallet, { ...input, content: optimizedContent });
    }
    return storeMemory(this.wallet, input);
  }

  // =========================================================================
  // Recall
  // =========================================================================

  async recall(opts?: RecallOptions): Promise<RecallResult> {
    if (opts?.semantic && opts.query) {
      return this.semanticRecall(opts);
    }
    return this.directRecall(opts);
  }

  // =========================================================================
  // Garbage Collection
  // =========================================================================

  async gc(): Promise<GCStats> {
    this.memoryCache = null; // Invalidate after GC
    return applyGarbageCollection(this.wallet);
  }

  // =========================================================================
  // Quick Recall (auto-injection into system prompt)
  // =========================================================================

  /**
   * Fast recall for auto-injection into system prompt.
   * Features:
   * - Skips trivial messages ("hello", "ok", etc.)
   * - Uses TTL-cached memories (avoids re-decrypting every request)
   * - Shad hybrid search with cached availability
   * - Falls back to keyword matching
   */
  async quickRecall(query: string, limit: number = 5): Promise<RecallResult> {
    // Gate: skip recall for trivial messages
    if (this.isTrivialMessage(query)) {
      return { memories: [], total: 0, returned: 0, skipped: true, message: 'Skipped (trivial message)' };
    }

    // 1. Fetch memories (cached)
    const memories = await this.getCachedMemories();
    if (memories.length === 0) {
      return { memories: [], total: 0, returned: 0, message: 'No memories found' };
    }

    // 2. Create secure temp directory
    const tempDir = await mkdtemp(path.join(tmpdir(), 'agid-quick-'));
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

      // 5. Try Shad fast search
      const executor = this.createMemoryVaultExecutor(tempDir);

      if (this.shadAvailable === null) {
        const availability = await executor.checkShadAvailable();
        this.shadAvailable = availability.available;
        if (!this.shadAvailable) {
          console.log('[MemoryManager] Shad not available — using keyword recall');
        }
      }

      if (!this.shadAvailable) {
        return this.keywordRecall(memories, query, limit);
      }

      // Use fast search mode (not full DAG)
      const result = await executor.search(query, { mode: 'hybrid', limit });

      if (!result.success) {
        return this.keywordRecall(memories, query, limit);
      }

      // Attach provenance
      const enriched = (result.retrievedDocuments ?? []).map((doc: any) => {
        const fileName = typeof doc === 'string' ? path.basename(doc) : doc.path ? path.basename(doc.path) : '';
        const provenance = provenanceMap.get(fileName);
        return {
          content: typeof doc === 'string' ? doc : doc.content ?? String(doc),
          tags: provenance?.tags ?? [],
          txid: provenance?.txid ?? '',
          blockTimestamp: provenance?.createdAt ?? 0,
          uhrpUrl: provenance?.uhrpUrl ?? '',
        };
      });

      return {
        memories: enriched.length > 0 ? enriched : this.keywordRecall(memories, query, limit).memories,
        total: memories.length,
        returned: enriched.length,
        shadAvailable: true,
      };
    } finally {
      try { await rm(tempDir, { recursive: true, force: true }); } catch {}
    }
  }

  // =========================================================================
  // Private: Memory Cache
  // =========================================================================

  /**
   * Get memories from cache or fetch fresh from chain.
   * Cache invalidates after TTL or when store() is called.
   */
  private async getCachedMemories(options?: { tags?: string[] }): Promise<Memory[]> {
    const now = Date.now();

    // Return cached if fresh and no filters (filtered queries bypass cache)
    if (
      this.memoryCache &&
      (now - this.memoryCache.fetchedAt) < this.cacheTtlMs &&
      !options?.tags
    ) {
      return this.memoryCache.memories;
    }

    // Fetch fresh
    const memories = await listMemories(this.wallet, options);

    // Only cache unfiltered results
    if (!options?.tags) {
      this.memoryCache = { memories, fetchedAt: now };
    }

    return memories;
  }

  // =========================================================================
  // Private: Trivial Message Detection
  // =========================================================================

  /**
   * Detect trivial messages that don't warrant memory recall.
   * Saves 5-30s of decryption + search overhead per trivial message.
   */
  private isTrivialMessage(query: string): boolean {
    const trimmed = query.trim();
    if (trimmed.length <= TRIVIAL_MESSAGE_MAX_LENGTH && TRIVIAL_PATTERNS.test(trimmed)) {
      return true;
    }
    return false;
  }

  // =========================================================================
  // Private: Keyword Recall Fallback
  // =========================================================================

  /**
   * Simple keyword-based recall fallback when Shad is unavailable.
   * Scores memories by keyword overlap with the query.
   */
  private keywordRecall(memories: Memory[], query: string, limit: number): RecallResult {
    const queryTerms = query.toLowerCase().split(/\s+/).filter(t => t.length > 2);

    if (queryTerms.length === 0) {
      const limited = memories.slice(0, limit);
      return { memories: limited.map(toRecallEntry), total: memories.length, returned: limited.length };
    }

    // Score each memory by keyword overlap
    const scored = memories.map(m => {
      const content = m.content.toLowerCase();
      const tagText = m.tags.join(' ').toLowerCase();
      let score = 0;
      for (const term of queryTerms) {
        if (content.includes(term)) score += 1;
        if (tagText.includes(term)) score += 2; // Tags weighted higher
      }
      return { memory: m, score };
    });

    const ranked = scored
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    // If no keyword matches, return most recent
    if (ranked.length === 0) {
      const recent = memories.slice(0, limit);
      return { memories: recent.map(toRecallEntry), total: memories.length, returned: recent.length, shadAvailable: false };
    }

    return {
      memories: ranked.map(r => toRecallEntry(r.memory)),
      total: memories.length,
      returned: ranked.length,
      shadAvailable: false,
    };
  }

  // =========================================================================
  // Private: Shad Executor Factory
  // =========================================================================

  /**
   * Create a ShadTempVaultExecutor backed by a temp directory of decrypted memories.
   */
  private createMemoryVaultExecutor(
    tempDir: string,
    shadConfig?: { strategy?: string; maxDepth?: number; maxTime?: number },
  ): ShadTempVaultExecutor {
    return new ShadTempVaultExecutor({
      vault: {
        read: async (p: string) => fs.readFileSync(path.join(tempDir, p), 'utf8'),
        list: async () => fs.readdirSync(tempDir),
        write: async () => {},
        delete: async () => false,
      },
      shadConfig: shadConfig as any,
    });
  }

  // =========================================================================
  // Private: Direct Recall
  // =========================================================================

  private async directRecall(opts?: RecallOptions): Promise<RecallResult> {
    const limit = opts?.limit ?? 20;
    const memories = await this.getCachedMemories({
      tags: opts?.tags,
    });
    const limited = memories.slice(0, limit);
    return {
      memories: limited.map(toRecallEntry),
      total: memories.length,
      returned: limited.length,
    };
  }

  // =========================================================================
  // Private: Semantic Recall (Full Shad DAG)
  // =========================================================================

  private async semanticRecall(opts: RecallOptions): Promise<RecallResult> {
    const query = opts.query!;
    const strategy = opts.strategy ?? 'research';
    const maxDepth = opts.maxDepth ?? 3;
    const maxTime = opts.maxTime ?? 120;

    // 1. Fetch memories (cached)
    let memories: Memory[];
    try {
      memories = await this.getCachedMemories();
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
      const executor = this.createMemoryVaultExecutor(tempDir, { strategy: strategy as any, maxDepth, maxTime });

      if (this.shadAvailable === null) {
        const availability = await executor.checkShadAvailable();
        this.shadAvailable = availability.available;
      }

      if (!this.shadAvailable) {
        return {
          memories: memories.slice(0, 10).map(toRecallEntry),
          total: memories.length,
          returned: Math.min(10, memories.length),
          shadAvailable: false,
          message: 'Shad not installed — returning unranked memories.',
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
    txid: m.txid,
    blockTimestamp: m.createdAt,
    uhrpUrl: m.uhrpUrl,
    outpoint: m.outpoint,
  };
}
