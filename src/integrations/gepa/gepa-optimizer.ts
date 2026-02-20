/**
 * GEPA Optimizer — Cached wrapper for deep GEPA integration.
 *
 * Optimizes prompts, tool descriptions, and memories at startup/store time.
 * Results are cached by SHA-256(input+objective) in ~/.agidentity/gepa-cache/.
 * If GEPA is unavailable, gracefully returns original text.
 *
 * @module agidentity/gepa
 */

import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { GepaExecutor } from './gepa-executor.js';
import type { GepaExecutorConfig } from './gepa-executor.js';

export interface GepaOptimizerConfig extends GepaExecutorConfig {
  /** Cache directory (default: ~/.agidentity/gepa-cache/) */
  cacheDir?: string;
  /** Default max iterations for optimization (default: 10) */
  defaultMaxIterations?: number;
}

interface CacheEntry {
  input: string;
  objective: string;
  optimizedText: string;
  timestamp: number;
}

export class GepaOptimizer {
  private cacheDir: string;
  private executor: GepaExecutor;
  private _available: boolean | null = null;
  private _version: string | undefined;
  private defaultMaxIterations: number;

  constructor(config?: GepaOptimizerConfig) {
    const home = process.env.HOME || '/tmp';
    this.cacheDir = config?.cacheDir ?? path.join(home, '.agidentity', 'gepa-cache');
    this.executor = new GepaExecutor(config);
    this.defaultMaxIterations = config?.defaultMaxIterations ?? 10;
  }

  /**
   * Check GEPA availability and create cache directory.
   * Must be called before using optimize methods.
   */
  async initialize(): Promise<void> {
    // Check availability
    const check = await this.executor.checkGepaAvailable();
    this._available = check.available;
    this._version = check.version;

    // Create cache directory
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true, mode: 0o700 });
    }
  }

  get available(): boolean {
    return this._available === true;
  }

  get version(): string | undefined {
    return this._version;
  }

  /**
   * Optimize text for a given objective. Returns original text on failure.
   */
  async optimize(text: string, objective: string, opts?: { maxIterations?: number }): Promise<string> {
    if (!this.available) return text;
    if (!text.trim()) return text;

    const cacheKey = this.cacheKey(text, objective);
    const cached = this.readCache(cacheKey);
    if (cached) return cached.optimizedText;

    try {
      const result = await this.executor.optimize({
        text,
        objective,
        maxIterations: opts?.maxIterations ?? this.defaultMaxIterations,
      });

      if (result.success && result.optimizedText) {
        this.writeCache(cacheKey, { input: text, objective, optimizedText: result.optimizedText, timestamp: Date.now() });
        return result.optimizedText;
      }
    } catch (error) {
      console.warn(`[GepaOptimizer] Optimization failed, using original text: ${error instanceof Error ? error.message : error}`);
    }

    return text;
  }

  /**
   * Optimize a system prompt component (SOUL.md, IDENTITY.md, etc.)
   */
  async optimizePromptComponent(text: string, componentName: string): Promise<string> {
    return this.optimize(
      text,
      `Optimize this ${componentName} prompt component for an autonomous AI agent. ` +
      `Maximize clarity, instruction-following potential, and persona consistency. ` +
      `Preserve all factual content and behavioral directives. ` +
      `Make instructions unambiguous and actionable for an LLM.`,
    );
  }

  /**
   * Optimize a tool description for LLM comprehension.
   */
  async optimizeToolDescription(name: string, description: string): Promise<string> {
    return this.optimize(
      description,
      `Optimize this tool description for "${name}" so an LLM agent can understand when and how to use it. ` +
      `Maximize parameter clarity, actionability, and conciseness. ` +
      `Preserve all technical details and constraints.`,
    );
  }

  /**
   * Optimize memory content before storage.
   */
  async optimizeMemory(content: string, tags: string[]): Promise<string> {
    return this.optimize(
      content,
      `Optimize this memory entry (tags: ${tags.join(', ')}) for future retrieval by an AI agent. ` +
      `Maximize information density, retrieval relevance, and future utility. ` +
      `Preserve all factual content. Make it self-contained and searchable.`,
    );
  }

  // ---------------------------------------------------------------------------
  // Cache
  // ---------------------------------------------------------------------------

  private cacheKey(text: string, objective: string): string {
    return createHash('sha256').update(text + '\n---\n' + objective).digest('hex');
  }

  private readCache(key: string): CacheEntry | null {
    const filePath = path.join(this.cacheDir, `${key}.json`);
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(raw) as CacheEntry;
    } catch {
      return null;
    }
  }

  private writeCache(key: string, entry: CacheEntry): void {
    const filePath = path.join(this.cacheDir, `${key}.json`);
    try {
      fs.writeFileSync(filePath, JSON.stringify(entry, null, 2), { encoding: 'utf8', mode: 0o600 });
    } catch (error) {
      console.warn(`[GepaOptimizer] Cache write failed: ${error instanceof Error ? error.message : error}`);
    }
  }
}
