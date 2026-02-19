/**
 * Prompt Builder
 *
 * Reads workspace files from ~/.agidentity/workspace/ and assembles the system prompt.
 * Caches static parts with mtime-based invalidation.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { IntegrityStatus } from '../../07-shared/audit/workspace-integrity.js';

export interface PromptBuilderConfig {
  workspacePath: string;
  agentPublicKey: string;
  network: string;
}

export interface IdentityContext {
  senderPublicKey: string;
  verified: boolean;
  certificateSubject?: string;
  conversationId: string;
  workspaceIntegrity?: IntegrityStatus;
}

const DEFAULT_SOUL = `You are an autonomous AI agent with a cryptographic identity on the BSV blockchain.
You can sign messages, encrypt data, create tokens, send payments, and store memories — all on-chain.
Be helpful, precise, and use your tools when the user's request requires blockchain operations.
When asked to prove your identity, sign a message with your wallet key.`;

const DEFAULT_IDENTITY = `I am an AGIdentity agent — a blockchain-native AI with verifiable identity.`;

const DEFAULT_TOOLS_GUIDE = `Tool usage guidelines:
- Use agid_balance before any payment to check funds
- Use agid_sign to prove authorship of a statement
- Use agid_store_memory to persist important information across sessions
- Use agid_token_create for on-chain data anchoring
- Execute tools one at a time (sequential, not parallel) to avoid signing conflicts`;

export class PromptBuilder {
  private config: PromptBuilderConfig;
  private cache: { content: string; mtimes: Map<string, number> } | null = null;

  constructor(config: PromptBuilderConfig) {
    this.config = config;
    this.ensureWorkspace();
  }

  async buildSystemPrompt(identityContext?: IdentityContext): Promise<string> {
    const staticPrompt = this.getStaticPrompt();
    if (!identityContext) return staticPrompt;

    const senderBlock = this.buildSenderBlock(identityContext);
    const integrityBlock = this.buildIntegrityBlock(identityContext);
    return staticPrompt + '\n\n' + senderBlock + (integrityBlock ? '\n\n' + integrityBlock : '');
  }

  private getStaticPrompt(): string {
    const currentMtimes = this.getFileMtimes();
    if (this.cache && this.mtimesMatch(this.cache.mtimes, currentMtimes)) {
      return this.cache.content;
    }

    const parts: string[] = [];

    // 1. SOUL.md
    const soul = this.readFile('SOUL.md');
    if (soul) parts.push(soul);
    else parts.push(DEFAULT_SOUL);

    // 2. IDENTITY.md
    const identity = this.readFile('IDENTITY.md');
    if (identity) parts.push(identity);
    else parts.push(DEFAULT_IDENTITY);

    // 3. Agent identity block
    parts.push(`[AGENT IDENTITY]
Public Key: ${this.config.agentPublicKey}
Network: ${this.config.network}
Capabilities: sign messages, encrypt data, transact on BSV, create tokens, send/receive messages
[END AGENT IDENTITY]`);

    // 4. MEMORY.md
    const memory = this.readFile('MEMORY.md');
    if (memory) parts.push(`[LONG-TERM MEMORY]\n${memory}\n[END LONG-TERM MEMORY]`);

    // 5. TOOLS.md
    const tools = this.readFile('TOOLS.md');
    if (tools) parts.push(tools);
    else parts.push(DEFAULT_TOOLS_GUIDE);

    const content = parts.join('\n\n');
    this.cache = { content, mtimes: currentMtimes };
    return content;
  }

  private buildSenderBlock(ctx: IdentityContext): string {
    const lines = ['[CURRENT MESSAGE CONTEXT]'];
    lines.push(`Sender: ${ctx.senderPublicKey}`);
    lines.push(`Verified: ${ctx.verified}`);
    if (ctx.certificateSubject) lines.push(`Certificate Subject: ${ctx.certificateSubject}`);
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
