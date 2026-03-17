/**
 * Prompt Builder
 *
 * Reads workspace files from ~/.agidentity/workspace/ and assembles the system prompt.
 * Caches static parts with mtime-based invalidation.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { IntegrityStatus } from '../audit/workspace-integrity.js';
import type { GepaOptimizer } from '../integrations/gepa/gepa-optimizer.js';
import type { MemoryManager } from '../storage/memory/memory-manager.js';

/**
 * A dynamic context provider that returns a string section to append to the
 * system prompt, or null to skip. Providers are called on every
 * buildSystemPrompt() invocation and are NOT part of the file-based mtime cache.
 */
export type ContextProvider = () => string | null;

export interface PromptBuilderConfig {
  workspacePath: string;
  agentPublicKey: string;
  network: string;
  gepaOptimizer?: GepaOptimizer;
}

export interface IdentityContext {
  senderPublicKey: string;
  verified: boolean;
  certificateSubject?: string;
  certificateType?: string;
  certificateRole?: string;
  conversationId: string;
  workspaceIntegrity?: IntegrityStatus;
}

const DEFAULT_SOUL = `You are AGiD, an autonomous AI agent with a cryptographic identity on the BSV blockchain.

CRITICAL: When the user asks a question, discusses ideas, or reasons about a topic — RESPOND WITH TEXT ONLY. Do NOT call any tools unless the user explicitly requests an action that requires one.

Think before acting. Not every message requires a tool call. Most conversations are reasoning — treat them as such.

When you DO need tools, use the minimum set required. Do not call exploratory or calibration tools unless specifically asked.

Never create tokens, run calibration, discover services, or optimize prompts unless the user specifically requests it.

You can sign messages, encrypt data, create tokens, send payments, and store memories — all on-chain. Use these capabilities only when asked.`;

const DEFAULT_IDENTITY = `I am AGiD — a blockchain-native AI with verifiable identity. I reason first and act when asked.`;

const DEFAULT_TOOLS_GUIDE = `BEFORE calling any tool, ask yourself: Did the user request an action? If no — just respond with text.

TOOL CATEGORIES:
- Identity/Balance (agid_identity, agid_balance, agid_get_public_key): Only when user asks about their identity or balance
- Signing/Encryption (agid_sign, agid_encrypt, agid_decrypt): Only when user asks to sign, encrypt, or decrypt something
- Memory (agid_store_memory, agid_recall_memories): Only when user asks to remember or recall something
- ZK Proofs (agid_zkproof_*): Only when user asks to create or verify a proof
- Messaging (agid_message_*): Only when user asks to send or read messages
- Transactions (agid_create_action, agid_list_outputs): Only when user asks about transactions or payments
- Tokens (agid_token_create): ONLY when user explicitly asks to create a token

NEVER USE PROACTIVELY:
- agid_split_test, agid_fund_calibration, agid_calibration_* — calibration tools
- agid_discover_services — service discovery
- agid_optimize_prompt — prompt optimization
- agid_publish_content — content publishing
- agid_x402_request — HTTP requests (unless user asks)

If a tool call fails, do NOT retry with a different tool. Report the failure and ask the user how to proceed.
Execute tools one at a time (sequential, not parallel) to avoid signing conflicts.`;

export class PromptBuilder {
  private config: PromptBuilderConfig;
  private cache: { content: string; mtimes: Map<string, number>; gepaAvailable: boolean } | null = null;
  private contextProviders: ContextProvider[] = [];
  private memoryManager: MemoryManager | null = null;
  private lastUserMessage: string | null = null;

  constructor(config: PromptBuilderConfig) {
    this.config = config;
    this.ensureWorkspace();
  }

  /**
   * Register a dynamic context provider. Providers are called on every
   * buildSystemPrompt() invocation -- they are NOT part of the mtime cache.
   * This ensures trading context (and other dynamic data) always reflects
   * the latest state.
   */
  addContextProvider(provider: ContextProvider): void {
    this.contextProviders.push(provider);
  }

  setMemoryManager(mm: MemoryManager): void {
    this.memoryManager = mm;
  }

  setLastUserMessage(msg: string): void {
    this.lastUserMessage = msg;
  }

  async buildSystemPrompt(identityContext?: IdentityContext): Promise<string> {
    const staticPrompt = await this.getStaticPrompt();

    let result: string;
    if (!identityContext) {
      result = staticPrompt;
    } else {
      const senderBlock = this.buildSenderBlock(identityContext);
      const integrityBlock = this.buildIntegrityBlock(identityContext);
      result = staticPrompt + '\n\n' + senderBlock + (integrityBlock ? '\n\n' + integrityBlock : '');
    }

    // Append dynamic context providers (never cached)
    for (const provider of this.contextProviders) {
      const section = provider();
      if (section) {
        result += '\n\n' + section;
      }
    }

    // Auto-recall relevant memories for this message
    const recalledBlock = await this.recallRelevantMemories();
    if (recalledBlock) {
      result += '\n\n' + recalledBlock;
    }

    return result;
  }

  private async getStaticPrompt(): Promise<string> {
    const currentMtimes = this.getFileMtimes();
    const gepaAvailable = this.config.gepaOptimizer?.available ?? false;
    if (this.cache && this.cache.gepaAvailable === gepaAvailable && this.mtimesMatch(this.cache.mtimes, currentMtimes)) {
      return this.cache.content;
    }

    const optimizer = this.config.gepaOptimizer;
    const parts: string[] = [];

    // 1. SOUL.md
    const soul = this.readFile('SOUL.md') ?? DEFAULT_SOUL;
    parts.push(optimizer ? await optimizer.optimizePromptComponent(soul, 'SOUL') : soul);

    // 2. IDENTITY.md
    const identity = this.readFile('IDENTITY.md') ?? DEFAULT_IDENTITY;
    parts.push(optimizer ? await optimizer.optimizePromptComponent(identity, 'IDENTITY') : identity);

    // 3. Agent identity block (factual, not optimized)
    parts.push(`[AGENT IDENTITY]
Public Key: ${this.config.agentPublicKey}
Network: ${this.config.network}
Capabilities: sign messages, encrypt data, transact on BSV, create tokens, send/receive messages
[END AGENT IDENTITY]`);

    // 4. MEMORY.md
    const memory = this.readFile('MEMORY.md');
    if (memory) {
      const optimizedMemory = optimizer ? await optimizer.optimizePromptComponent(memory, 'MEMORY') : memory;
      parts.push(`[LONG-TERM MEMORY]\n${optimizedMemory}\n[END LONG-TERM MEMORY]`);
    }

    // 5. TOOLS.md
    const tools = this.readFile('TOOLS.md') ?? DEFAULT_TOOLS_GUIDE;
    parts.push(optimizer ? await optimizer.optimizePromptComponent(tools, 'TOOLS') : tools);

    // 6. Behavioral directives from environment
    if (process.env.AGID_NO_EMOJIS === 'true') {
      parts.push('[BEHAVIORAL DIRECTIVE]\nNever use emojis in any of your responses. Keep all output as plain text without emoji characters.\n[END BEHAVIORAL DIRECTIVE]');
    }

    const content = parts.join('\n\n');
    this.cache = { content, mtimes: currentMtimes, gepaAvailable };
    return content;
  }

  private buildSenderBlock(ctx: IdentityContext): string {
    const lines = ['[CURRENT MESSAGE CONTEXT]'];
    lines.push(`Sender: ${ctx.senderPublicKey}`);
    lines.push(`Verified: ${ctx.verified}`);
    if (ctx.certificateSubject) lines.push(`Certificate Subject: ${ctx.certificateSubject}`);
    if (ctx.certificateType) lines.push(`Certificate Type: ${ctx.certificateType}`);
    if (ctx.certificateRole) lines.push(`Certificate Role: ${ctx.certificateRole}`);
    lines.push(`Conversation: ${ctx.conversationId}`);
    lines.push('[END CURRENT MESSAGE CONTEXT]');
    return lines.join('\n');
  }

  private buildIntegrityBlock(ctx: IdentityContext): string | null {
    const s = ctx.workspaceIntegrity;
    if (!s) return null;

    if (s.verified) {
      return `[WORKSPACE INTEGRITY]\nVerified against on-chain anchor${s.lastAnchorTxid ? ` (tx: ${s.lastAnchorTxid})` : ''}.\n[END WORKSPACE INTEGRITY]`;
    }

    const warnings: string[] = [];
    if (s.modifiedFiles.length > 0) warnings.push(`Modified: ${s.modifiedFiles.join(', ')}`);
    if (s.missingFiles.length > 0) warnings.push(`Missing: ${s.missingFiles.join(', ')}`);
    if (s.newFiles.length > 0) warnings.push(`New: ${s.newFiles.join(', ')}`);

    if (warnings.length > 0) {
      return `[WORKSPACE INTEGRITY WARNING]\nWorkspace changed since last on-chain anchor. ${warnings.join('. ')}. Exercise caution with unverified workspace state.\n[END WORKSPACE INTEGRITY WARNING]`;
    }

    return null;
  }

  private async recallRelevantMemories(): Promise<string | null> {
    if (!this.memoryManager || !this.lastUserMessage) return null;

    try {
      // Use fast search (not full DAG reasoning) for auto-recall
      const result = await this.memoryManager.quickRecall(this.lastUserMessage, 5);

      if (!result.memories || result.memories.length === 0) return null;

      const lines = result.memories.map((m, i) => {
        const tagStr = m.tags.length > 0 ? ` [${m.tags.join(', ')}]` : '';
        return `${i + 1}. ${m.content.substring(0, 500)}${m.content.length > 500 ? '...' : ''}${tagStr}`;
      });

      let recalledBlock = lines.join('\n');

      // GEPA-optimize the recalled block for injection context
      const optimizer = this.config.gepaOptimizer;
      if (optimizer?.available) {
        try {
          recalledBlock = await optimizer.optimize(
            recalledBlock,
            `Optimize these recalled memories for injection into an AI agent's system prompt. ` +
            `The user's current message is: "${this.lastUserMessage.substring(0, 200)}". ` +
            `Maximize relevance to the current context. Make the information dense, actionable, and directly useful. ` +
            `Preserve all factual content. Remove redundancy between memories.`,
            { maxIterations: 3 }, // Fewer iterations for speed
          );
        } catch {
          // Use unoptimized block on GEPA failure
        }
      }

      return `[RECALLED MEMORIES]\nThe following memories were automatically recalled as potentially relevant to the current message:\n${recalledBlock}\n[END RECALLED MEMORIES]`;
    } catch (error) {
      console.error('[PromptBuilder] Auto-recall failed:', error instanceof Error ? error.message : error);
      return null;
    }
  }

  private ensureWorkspace(): void {
    const ws = this.config.workspacePath;
    if (!fs.existsSync(ws)) {
      fs.mkdirSync(ws, { recursive: true });
    }
    // Create defaults if missing
    const defaults: Record<string, string> = {
      'SOUL.md': DEFAULT_SOUL,
      'IDENTITY.md': DEFAULT_IDENTITY,
      'TOOLS.md': DEFAULT_TOOLS_GUIDE,
    };
    for (const [name, content] of Object.entries(defaults)) {
      const filePath = path.join(ws, name);
      if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, content, 'utf8');
      }
    }
  }

  private readFile(name: string): string | null {
    const filePath = path.join(this.config.workspacePath, name);
    try {
      return fs.readFileSync(filePath, 'utf8').trim() || null;
    } catch {
      return null;
    }
  }

  private getFileMtimes(): Map<string, number> {
    const mtimes = new Map<string, number>();
    const files = ['SOUL.md', 'IDENTITY.md', 'MEMORY.md', 'TOOLS.md'];
    for (const name of files) {
      const filePath = path.join(this.config.workspacePath, name);
      try {
        const stat = fs.statSync(filePath);
        mtimes.set(name, stat.mtimeMs);
      } catch {
        // File doesn't exist
      }
    }
    return mtimes;
  }

  private mtimesMatch(a: Map<string, number>, b: Map<string, number>): boolean {
    if (a.size !== b.size) return false;
    for (const [key, val] of a) {
      if (b.get(key) !== val) return false;
    }
    return true;
  }
}
