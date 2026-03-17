/**
 * Token Budget Manager
 *
 * Estimates token usage and manages context window budget.
 * Uses a 3.5 chars/token heuristic (more accurate than 4:1 for English + JSON).
 * Provides proactive warnings before context overflow.
 */

const CHARS_PER_TOKEN = 3.5;

/**
 * Estimate token count for a string or message array.
 */
export function estimateTokens(input: string | unknown[]): number {
  if (typeof input === 'string') {
    return Math.ceil(input.length / CHARS_PER_TOKEN);
  }
  // For message arrays, serialize and estimate
  const text = JSON.stringify(input);
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Estimate token count for tool definitions (JSON schemas).
 * Tool schemas are more token-dense than prose.
 */
export function estimateToolTokens(tools: Array<{ name: string; description: string; input_schema: unknown }>): number {
  const text = JSON.stringify(tools);
  // JSON schemas are ~3 chars/token (more structured)
  return Math.ceil(text.length / 3);
}

export interface TokenBudget {
  /** Total context window (model-specific) */
  contextWindow: number;
  /** Tokens used by system prompt */
  systemPrompt: number;
  /** Tokens used by tool definitions */
  toolDefinitions: number;
  /** Tokens used by conversation history */
  history: number;
  /** Tokens reserved for model output */
  outputReserve: number;
  /** Available tokens for new content */
  available: number;
  /** Percentage of context used */
  usagePercent: number;
  /** True if context pressure is high (>80%) */
  pressureHigh: boolean;
}

/**
 * Calculate current token budget.
 * @param contextWindow - Model's total context window size
 * @param systemPrompt - System prompt string
 * @param tools - Tool definitions
 * @param history - Conversation history messages
 * @param maxOutputTokens - Reserved for model output (default: 8192)
 */
export function calculateBudget(
  contextWindow: number,
  systemPrompt: string,
  tools: Array<{ name: string; description: string; input_schema: unknown }>,
  history: unknown[],
  maxOutputTokens: number = 8192,
): TokenBudget {
  const systemTokens = estimateTokens(systemPrompt);
  const toolTokens = estimateToolTokens(tools);
  const historyTokens = estimateTokens(history);
  const used = systemTokens + toolTokens + historyTokens + maxOutputTokens;
  const available = Math.max(0, contextWindow - used);
  const usagePercent = Math.round((used / contextWindow) * 100);

  return {
    contextWindow,
    systemPrompt: systemTokens,
    toolDefinitions: toolTokens,
    history: historyTokens,
    outputReserve: maxOutputTokens,
    available,
    usagePercent,
    pressureHigh: usagePercent > 80,
  };
}

/**
 * Truncate a tool result to fit within a token budget.
 * Preserves the beginning (usually most relevant) and adds a truncation notice.
 */
export function truncateToolResult(content: string, maxTokens: number): string {
  const currentTokens = estimateTokens(content);
  if (currentTokens <= maxTokens) return content;

  const maxChars = Math.floor(maxTokens * CHARS_PER_TOKEN);
  const truncated = content.substring(0, maxChars - 100); // Leave room for notice
  return truncated + '\n\n[... truncated — result exceeded token budget]';
}
