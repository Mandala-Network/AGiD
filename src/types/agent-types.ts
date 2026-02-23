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
 * A single conversation turn (canonical format for cross-model continuity)
 */
export interface ConversationTurn {
  role: 'user' | 'assistant';
  content: unknown; // CanonicalContent (string or CanonicalBlock[]), kept as `unknown` for serialization flexibility
  timestamp: number;
  /** Format version. Absent = legacy Anthropic format, 1 = canonical. */
  v?: 1;
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

// ============================================================================
// Direct Tool Invocation Types (MessageBox protocol)
// ============================================================================

/**
 * A direct tool invocation request sent via MessageBox.
 * Allows the frontend to invoke individual agent tools without going through the LLM.
 */
export interface ToolRequest {
  type: 'tool_request';
  /** Request ID for correlation */
  id: string;
  /** Tool name, e.g. "agid_wallet_balance" */
  toolName: string;
  /** Tool input parameters */
  parameters: Record<string, unknown>;
  timestamp: number;
}

/**
 * Response to a direct tool invocation, returned via MessageBox.
 */
export interface ToolResponse {
  type: 'tool_response';
  /** Response ID */
  id: string;
  /** Correlates to the originating tool_request.id */
  requestId: string;
  toolName: string;
  /** Tool execution result */
  result: string;
  isError: boolean;
  timestamp: number;
  /** Agent public key */
  agent: string;
  /** Wallet signature of the response */
  signature: string;
  signed: boolean;
}
