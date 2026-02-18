/**
 * Session Store
 *
 * JSONL-based conversation persistence at ~/.agidentity/sessions/{sessionId}.jsonl.
 * Each line is a JSON-encoded ConversationTurn.
 * Trims old turns when approaching token limits.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ConversationTurn, SessionData } from '../../07-shared/types/agent-types.js';

/** Anthropic API message format */
export interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: unknown;
}

export interface SessionStoreConfig {
  sessionsPath: string;
  /** Approximate max tokens before trimming (default: 100000) */
  maxTokenEstimate?: number;
}

export class SessionStore {
  private sessionsPath: string;
  private maxTokenEstimate: number;

  constructor(config: SessionStoreConfig) {
    this.sessionsPath = config.sessionsPath;
    this.maxTokenEstimate = config.maxTokenEstimate ?? 100000;
    if (!fs.existsSync(this.sessionsPath)) {
      fs.mkdirSync(this.sessionsPath, { recursive: true });
    }
  }

  async getSession(sessionId: string): Promise<SessionData> {
    const filePath = this.sessionPath(sessionId);
    const turns: ConversationTurn[] = [];

    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8');
      for (const line of content.split('\n')) {
        if (!line.trim()) continue;
        try {
          turns.push(JSON.parse(line));
        } catch {
          // Skip malformed lines
        }
      }
    }

    return {
      sessionId,
      turns,
      createdAt: turns[0]?.timestamp ?? Date.now(),
      lastActivityAt: turns[turns.length - 1]?.timestamp ?? Date.now(),
    };
  }

  async addTurn(sessionId: string, turn: ConversationTurn): Promise<void> {
    const filePath = this.sessionPath(sessionId);
    const line = JSON.stringify(turn) + '\n';
    fs.appendFileSync(filePath, line, 'utf8');
  }

  async getMessages(sessionId: string): Promise<AnthropicMessage[]> {
    const session = await this.getSession(sessionId);
    let turns = session.turns;

    // Trim if over token estimate (4 chars ≈ 1 token heuristic)
    const estimateTokens = (t: ConversationTurn[]) =>
      t.reduce((sum, turn) => {
        const text = typeof turn.content === 'string' ? turn.content : JSON.stringify(turn.content);
        return sum + Math.ceil(text.length / 4);
      }, 0);

    if (estimateTokens(turns) > this.maxTokenEstimate && turns.length > 2) {
      // Keep first turn for context continuity, trim from the middle
      const first = turns[0];
      let trimmed = [first];
      let remaining = turns.slice(1);

      // Remove oldest turns until under limit
      while (estimateTokens([first, ...remaining]) > this.maxTokenEstimate && remaining.length > 1) {
        remaining = remaining.slice(1);
      }
      trimmed = [first, ...remaining];
      turns = trimmed;
    }

    return turns.map((t) => ({
      role: t.role,
      content: t.content,
    }));
  }

  private sessionPath(sessionId: string): string {
    // Sanitize session ID for filesystem
    const safe = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(this.sessionsPath, `${safe}.jsonl`);
  }
}
