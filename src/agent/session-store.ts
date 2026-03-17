/**
 * Session Store
 *
 * JSONL-based conversation persistence at ~/.agidentity/sessions/{sessionId}.jsonl.
 * Each line is a JSON-encoded ConversationTurn.
 *
 * Features:
 * - Rolling summarization (progressive compression instead of cliff trimming)
 * - Keeps recent turns in full detail + compressed summaries of older turns
 * - Token budget awareness via estimateTokens heuristic
 */

import * as fs from 'fs';
import * as path from 'path';
import { normalizeToCanonical } from './canonical-format.js';
import type { LLMMessage } from './llm-provider.js';
import type { ConversationTurn, SessionData } from '../types/agent-types.js';

/** Number of recent turns to always keep in full detail */
const RECENT_WINDOW_SIZE = 20;

/** Max turns per summary chunk */
const SUMMARY_CHUNK_SIZE = 10;

/** Approximate max tokens before triggering summarization */
const DEFAULT_MAX_TOKEN_ESTIMATE = 100_000;

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
    this.maxTokenEstimate = config.maxTokenEstimate ?? DEFAULT_MAX_TOKEN_ESTIMATE;
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

  async getMessages(sessionId: string): Promise<LLMMessage[]> {
    const session = await this.getSession(sessionId);
    let turns = session.turns;

    // Apply rolling summarization if over token budget
    const totalTokens = this.estimateTokens(turns);
    if (totalTokens > this.maxTokenEstimate && turns.length > RECENT_WINDOW_SIZE + 2) {
      turns = this.rollingSummarize(turns);
    }

    // Normalize each turn to canonical format (handles legacy Anthropic format)
    return turns.map((t) => {
      const canonical = normalizeToCanonical(t);
      return { role: canonical.role, content: canonical.content };
    });
  }

  // ===========================================================================
  // Rolling Summarization
  // ===========================================================================

  /**
   * Progressive compression: keep recent turns in full, compress older turns
   * into dense summaries. Unlike cliff trimming, this preserves context quality
   * by creating layered summaries:
   *
   *   [first turn] [summary chunk 1] [summary chunk 2] ... [recent N turns]
   *
   * Each summary chunk captures key decisions, facts, and outcomes.
   */
  private rollingSummarize(turns: ConversationTurn[]): ConversationTurn[] {
    // Always keep the first turn (conversation opener)
    const first = turns[0];

    // Keep the most recent turns in full detail
    const recentStart = Math.max(1, turns.length - RECENT_WINDOW_SIZE);
    const recentTurns = turns.slice(recentStart);

    // Everything between first and recent window needs summarization
    const middleTurns = turns.slice(1, recentStart);

    if (middleTurns.length === 0) {
      return [first, ...recentTurns];
    }

    // Check if there are already summary turns (from previous summarization rounds)
    const existingSummaries = middleTurns.filter(t => this.isSummaryTurn(t));
    const nonSummaryMiddle = middleTurns.filter(t => !this.isSummaryTurn(t));

    // If we still have too many non-summary turns, chunk and summarize them
    const summaryTurns: ConversationTurn[] = [...existingSummaries];

    if (nonSummaryMiddle.length > 0) {
      // Break into chunks and summarize each
      for (let i = 0; i < nonSummaryMiddle.length; i += SUMMARY_CHUNK_SIZE) {
        const chunk = nonSummaryMiddle.slice(i, i + SUMMARY_CHUNK_SIZE);
        const summary = this.summarizeChunk(chunk);
        summaryTurns.push(summary);
      }
    }

    // Check if summaries themselves are too large — compress summaries of summaries
    const summaryTokens = this.estimateTokens(summaryTurns);
    const targetSummaryBudget = Math.floor(this.maxTokenEstimate * 0.3); // 30% budget for history

    if (summaryTokens > targetSummaryBudget && summaryTurns.length > 3) {
      // Mega-summarize: collapse all summaries into one
      const megaSummary = this.createMegaSummary(summaryTurns);
      return [first, megaSummary, ...recentTurns];
    }

    return [first, ...summaryTurns, ...recentTurns];
  }

  /**
   * Summarize a chunk of conversation turns into a single dense summary turn.
   * Extracts key information: decisions made, facts learned, tools used, outcomes.
   */
  private summarizeChunk(turns: ConversationTurn[]): ConversationTurn {
    const points: string[] = [];
    const toolsUsed = new Set<string>();

    for (const turn of turns) {
      const text = this.extractText(turn);
      const role = turn.role === 'user' ? 'User' : 'Agent';

      // Extract tool calls from assistant content
      if (turn.role === 'assistant' && Array.isArray(turn.content)) {
        for (const block of turn.content as any[]) {
          if (block.type === 'tool_use') {
            toolsUsed.add(block.name);
          }
        }
      }

      // Dense summary: first 200 chars, prioritize actionable content
      const preview = text.substring(0, 200).replace(/\n/g, ' ').trim();
      if (preview) {
        points.push(`${role}: ${preview}${text.length > 200 ? '...' : ''}`);
      }
    }

    // Build compact summary
    const dateRange = this.getDateRange(turns);
    const toolList = toolsUsed.size > 0 ? `\nTools used: ${[...toolsUsed].join(', ')}` : '';

    // Limit to 8 most important points
    const trimmedPoints = points.length > 8
      ? [...points.slice(0, 4), `(${points.length - 8} messages omitted)`, ...points.slice(-4)]
      : points;

    const content = `[CONTEXT SUMMARY — ${dateRange}, ${turns.length} turns]${toolList}\n${trimmedPoints.join('\n')}\n[END SUMMARY]`;

    return {
      role: 'user',
      content,
      timestamp: turns[0]?.timestamp ?? Date.now(),
      v: 1,
    };
  }

  /**
   * Collapse multiple summaries into a single mega-summary.
   * Used when even the summaries exceed budget.
   */
  private createMegaSummary(summaryTurns: ConversationTurn[]): ConversationTurn {
    const allContent = summaryTurns.map(t => this.extractText(t)).join('\n---\n');

    // Extract just the key facts from all summaries
    const lines = allContent.split('\n').filter(l => l.trim());
    const keyLines = lines
      .filter(l => !l.startsWith('[') && !l.startsWith('(') && l.length > 20)
      .slice(0, 15);

    const content = `[COMPRESSED HISTORY — ${summaryTurns.length} summary blocks consolidated]\n${keyLines.join('\n')}\n[END COMPRESSED HISTORY]`;

    return {
      role: 'user',
      content,
      timestamp: summaryTurns[0]?.timestamp ?? Date.now(),
      v: 1,
    };
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  private isSummaryTurn(turn: ConversationTurn): boolean {
    const text = typeof turn.content === 'string' ? turn.content : '';
    return text.startsWith('[CONTEXT SUMMARY') || text.startsWith('[COMPRESSED HISTORY') || text.startsWith('[CONVERSATION HISTORY SUMMARY]');
  }

  private extractText(turn: ConversationTurn): string {
    if (typeof turn.content === 'string') return turn.content;
    if (Array.isArray(turn.content)) {
      return (turn.content as any[])
        .filter((b: any) => b.type === 'text')
        .map((b: any) => b.text)
        .join(' ');
    }
    return JSON.stringify(turn.content);
  }

  private getDateRange(turns: ConversationTurn[]): string {
    if (turns.length === 0) return 'unknown';
    const first = new Date(turns[0].timestamp).toISOString().split('T')[0];
    const last = new Date(turns[turns.length - 1].timestamp).toISOString().split('T')[0];
    return first === last ? first : `${first} to ${last}`;
  }

  private estimateTokens(turns: ConversationTurn[]): number {
    return turns.reduce((sum, turn) => {
      const text = typeof turn.content === 'string' ? turn.content : JSON.stringify(turn.content);
      return sum + Math.ceil(text.length / 3.5);
    }, 0);
  }

  private sessionPath(sessionId: string): string {
    // Sanitize session ID for filesystem
    const safe = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(this.sessionsPath, `${safe}.jsonl`);
  }
}
