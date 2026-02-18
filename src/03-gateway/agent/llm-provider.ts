/**
 * LLM Provider Interface
 *
 * Provider-neutral abstraction for language model interactions.
 * Allows plugging in any model backend (Anthropic, OpenAI, Gemini, local, etc.).
 */

export interface LLMMessage {
  role: 'user' | 'assistant';
  content: unknown; // Provider-specific content blocks stored opaquely
}

export interface LLMToolDef {
  name: string;
  description: string;
  input_schema: { type: 'object'; properties: Record<string, unknown>; required?: string[] };
}

export interface LLMToolUse {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface LLMToolResult {
  toolUseId: string;
  content: string;
  isError?: boolean;
}

export interface LLMResponse {
  /** Extracted text (empty string if only tool calls) */
  text: string;
  /** Tool calls requested by the model (empty if done) */
  toolCalls: LLMToolUse[];
  /** true = model finished, false = needs tool execution */
  done: boolean;
  /** Opaque assistant content for message history (provider-native format) */
  rawContent: unknown;
  /** Token usage statistics */
  usage: { inputTokens: number; outputTokens: number };
}

export interface LLMProvider {
  /** Send messages to the model, get back text and/or tool calls */
  chat(params: {
    model: string;
    maxTokens: number;
    system: string;
    messages: LLMMessage[];
    tools: LLMToolDef[];
  }): Promise<LLMResponse>;

  /** Build a user-role message containing tool execution results */
  buildToolResultMessage(results: LLMToolResult[]): LLMMessage;
}
