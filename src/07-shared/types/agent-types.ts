/**
 * Agent Core Types
 *
 * Type definitions for the native agent system that replaces OpenClaw.
 */

// ============================================================================
// Tool System Types
// ============================================================================

/**
 * Tool definition in JSON Schema format (compatible with Anthropic, OpenAI, etc.)
 */
export interface AgentToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

/**
 * Result of executing a tool
 */
export interface ToolResult {
  content: string;
  isError?: boolean;
}

/**
 * A registered tool with its definition and execution function
 */
export interface RegisteredTool {
  definition: AgentToolDefinition;
  execute: (params: Record<string, unknown>) => Promise<ToolResult>;
}

// ============================================================================
// Conversation / Session Types
// ============================================================================

/**
 * A single conversation turn
 */
export interface ConversationTurn {
  role: 'user' | 'assistant';
  content: unknown; // Anthropic message content (string or content blocks)
  timestamp: number;
}

/**
 * Persisted session data
 */
export interface SessionData {
  sessionId: string;
  turns: ConversationTurn[];
  createdAt: number;
  lastActivityAt: number;
}

// ============================================================================
// Agent Loop Types
// ============================================================================

/**
 * Result of running the agent loop
 */
export interface AgentLoopResult {
  response: string;
  toolCalls: AgentToolCall[];
  usage: AgentUsageStats;
  iterations: number;
}

/**
 * A tool call made during the agent loop
 */
export interface AgentToolCall {
  name: string;
  input: Record<string, unknown>;
  result: ToolResult;
}

/**
 * Usage statistics for the agent loop
 */
export interface AgentUsageStats {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}
