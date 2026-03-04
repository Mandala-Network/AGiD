/**
 * Ollama / OpenAI-Compatible LLM Provider
 *
 * Works with Ollama, vLLM, LM Studio, OpenAI, Groq, MiniMax, or any OpenAI-compatible endpoint.
 * Uses raw fetch -- no SDK dependency. Converts canonical <-> wire format at the boundary.
 *
 * MiniMax auto-detection: When the base URL contains "minimax", the provider switches to
 * MiniMax's Anthropic-compatible endpoint (/anthropic/v1/messages) which returns full
 * thinking/reasoning blocks. The OpenAI-compatible endpoint consumes reasoning tokens
 * internally but does not expose the reasoning text.
 */

import type { CanonicalContent, CanonicalBlock } from '../canonical-format.js';
import type { LLMProvider, LLMMessage, LLMToolDef, LLMToolResult, LLMResponse } from '../llm-provider.js';

export interface OllamaProviderConfig {
  /** Base URL for the API (default: http://localhost:11434) */
  baseUrl?: string;
  /** API key (optional -- needed for OpenAI/Groq/MiniMax, not for local Ollama) */
  apiKey?: string;
}

// ---------------------------------------------------------------------------
// OpenAI-compatible format types
// ---------------------------------------------------------------------------

interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

interface OpenAIChatMessage {
  role: string;
  content?: string | null;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
}

interface OpenAIChatResponse {
  choices: Array<{
    message: OpenAIChatMessage;
    finish_reason: string;
  }>;
  usage?: { prompt_tokens: number; completion_tokens: number };
}

// ---------------------------------------------------------------------------
// Anthropic-compatible format types (used for MiniMax)
// ---------------------------------------------------------------------------

interface AnthropicContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  signature?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

interface AnthropicToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicContentBlock[];
}

interface AnthropicResponse {
  content: AnthropicContentBlock[];
  stop_reason: string;
  usage?: { input_tokens: number; output_tokens: number };
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export class OllamaProvider implements LLMProvider {
  private baseUrl: string;
  private apiKey?: string;
  /** True when baseUrl is a MiniMax endpoint -- uses Anthropic-compatible format for reasoning. */
  private isMiniMax: boolean;

  constructor(config?: OllamaProviderConfig) {
    this.baseUrl = (config?.baseUrl ?? 'http://localhost:11434').replace(/\/$/, '');
    this.apiKey = config?.apiKey;
    this.isMiniMax = this.baseUrl.toLowerCase().includes('minimax');
  }

  async chat(params: {
    model: string;
    maxTokens: number;
    system: string;
    messages: LLMMessage[];
    tools: LLMToolDef[];
  }): Promise<LLMResponse> {
    if (this.isMiniMax) {
      return this.chatAnthropicFormat(params);
    }
    return this.chatOpenAIFormat(params);
  }

  buildToolResultMessage(results: LLMToolResult[]): LLMMessage {
    return {
      role: 'user',
      content: results.map((r) => ({
        type: 'tool_result' as const,
        toolUseId: r.toolUseId,
        content: r.content,
        ...(r.isError ? { isError: r.isError } : {}),
      })),
    };
  }

  // =========================================================================
  // Anthropic-compatible format (MiniMax)
  // =========================================================================

  /**
   * Chat via MiniMax's Anthropic-compatible endpoint.
   * Returns full thinking/reasoning blocks alongside text and tool_use.
   */
  private async chatAnthropicFormat(params: {
    model: string;
    maxTokens: number;
    system: string;
    messages: LLMMessage[];
    tools: LLMToolDef[];
  }): Promise<LLMResponse> {
    const anthropicMessages = this.toAnthropicMessages(params.messages);
    const anthropicTools: AnthropicToolDef[] = params.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.input_schema,
    }));

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
    };
    if (this.apiKey) headers['x-api-key'] = this.apiKey;

    const body: Record<string, unknown> = {
      model: params.model,
      max_tokens: params.maxTokens,
      system: params.system,
      messages: anthropicMessages,
    };

    if (anthropicTools.length > 0) {
      body.tools = anthropicTools;
    }

    const response = await fetch(`${this.baseUrl}/anthropic/v1/messages`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`MiniMax Anthropic API error (${response.status}): ${errorText}`);
    }

    const data = await response.json() as AnthropicResponse;
    const blocks = data.content ?? [];

    // Extract text, thinking, and tool_use from content blocks
    let text = '';
    let reasoning: string | undefined;
    const thinkingParts: string[] = [];
    const toolCalls: Array<{ id: string; name: string; input: Record<string, unknown> }> = [];

    for (const block of blocks) {
      if (block.type === 'text' && block.text) {
        text += block.text;
      } else if (block.type === 'thinking' && block.thinking) {
        thinkingParts.push(block.thinking);
      } else if (block.type === 'tool_use' && block.id && block.name) {
        toolCalls.push({
          id: block.id,
          name: block.name,
          input: block.input ?? {},
        });
      }
    }

    if (thinkingParts.length > 0) {
      reasoning = thinkingParts.join('\n');
      console.log(`[OllamaProvider] Reasoning extracted (anthropic format): ${reasoning.length} chars`);
    }

    // Strip any residual <think> tags from content
    text = text.replace(/<think>[\s\S]*?<\/think>\s*/g, '').trim();

    const done = data.stop_reason === 'end_turn' || data.stop_reason === 'stop';
    const rawContent = this.buildCanonicalContent(text, toolCalls);

    return {
      text,
      toolCalls,
      done,
      rawContent,
      usage: {
        inputTokens: data.usage?.input_tokens ?? 0,
        outputTokens: data.usage?.output_tokens ?? 0,
      },
      reasoning,
    };
  }

  /** Convert canonical messages to Anthropic format */
  private toAnthropicMessages(messages: LLMMessage[]): AnthropicMessage[] {
    const result: AnthropicMessage[] = [];

    for (const msg of messages) {
      if (typeof msg.content === 'string') {
        result.push({ role: msg.role, content: msg.content });
        continue;
      }

      // Array of canonical blocks -- convert to Anthropic content blocks
      const blocks = msg.content;
      const anthropicBlocks: AnthropicContentBlock[] = [];

      for (const block of blocks) {
        if (block.type === 'text') {
          anthropicBlocks.push({ type: 'text', text: block.text });
        } else if (block.type === 'tool_use') {
          anthropicBlocks.push({
            type: 'tool_use',
            id: block.id,
            name: block.name,
            input: block.input,
          });
        } else if (block.type === 'tool_result') {
          // Anthropic format uses tool_use_id (snake_case)
          const toolResultBlock: Record<string, unknown> = {
            type: 'tool_result',
            tool_use_id: block.toolUseId,
            content: block.content,
          };
          if (block.isError) {
            toolResultBlock.is_error = true;
          }
          anthropicBlocks.push(toolResultBlock as unknown as AnthropicContentBlock);
        }
      }

      result.push({ role: msg.role, content: anthropicBlocks });
    }

    return result;
  }

  // =========================================================================
  // OpenAI-compatible format (Ollama, Groq, vLLM, etc.)
  // =========================================================================

  private async chatOpenAIFormat(params: {
    model: string;
    maxTokens: number;
    system: string;
    messages: LLMMessage[];
    tools: LLMToolDef[];
  }): Promise<LLMResponse> {
    const openaiMessages = this.toOpenAIMessages(params.system, params.messages);

    const openaiTools = params.tools.map((t) => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.input_schema,
      },
    }));

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`;

    const body: Record<string, unknown> = {
      model: params.model,
      max_tokens: params.maxTokens,
      messages: openaiMessages,
      stream: false,
    };

    // Only include tools if there are any
    if (openaiTools.length > 0) {
      body.tools = openaiTools;
    }

    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI-compatible API error (${response.status}): ${errorText}`);
    }

    const data = await response.json() as OpenAIChatResponse;

    const choice = data.choices?.[0];
    if (!choice) throw new Error('No response from OpenAI-compatible API');

    const msg = choice.message;
    let text = msg.content ?? '';

    // Fallback: extract <think> tags from content (some providers embed reasoning this way)
    let reasoning: string | undefined;
    const thinkMatch = text.match(/<think>([\s\S]*?)<\/think>/);
    if (thinkMatch) {
      reasoning = thinkMatch[1].trim();
    }

    if (reasoning) {
      console.log(`[OllamaProvider] Reasoning extracted (openai format): ${reasoning.length} chars`);
    }

    // Strip <think> tags from content text
    text = text.replace(/<think>[\s\S]*?<\/think>\s*/g, '').trim();

    const toolCalls = (msg.tool_calls ?? []).map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      input: JSON.parse(tc.function.arguments) as Record<string, unknown>,
    }));

    // Map finish_reason: 'stop' = done, 'tool_calls' = needs tool execution
    const done = choice.finish_reason === 'stop' || choice.finish_reason === 'length';

    // Build canonical content for storage
    const rawContent = this.buildCanonicalContent(text, toolCalls);

    return {
      text,
      toolCalls,
      done,
      rawContent,
      usage: {
        inputTokens: data.usage?.prompt_tokens ?? 0,
        outputTokens: data.usage?.completion_tokens ?? 0,
      },
      reasoning,
    };
  }

  /** Convert system prompt + canonical messages -> OpenAI chat format */
  private toOpenAIMessages(system: string, messages: LLMMessage[]): OpenAIChatMessage[] {
    const result: OpenAIChatMessage[] = [{ role: 'system', content: system }];

    for (const msg of messages) {
      if (typeof msg.content === 'string') {
        result.push({ role: msg.role, content: msg.content });
        continue;
      }

      // Array of canonical blocks
      const blocks = msg.content;

      // Check if this is a tool_result message (user role with tool_result blocks)
      const toolResults = blocks.filter((b): b is Extract<CanonicalBlock, { type: 'tool_result' }> =>
        b.type === 'tool_result'
      );
      if (toolResults.length > 0) {
        // OpenAI uses separate `tool` role messages for each result
        for (const tr of toolResults) {
          result.push({
            role: 'tool',
            content: tr.content,
            tool_call_id: tr.toolUseId,
          });
        }
        continue;
      }

      // Assistant message with possible tool_use blocks
      const textParts = blocks.filter((b): b is Extract<CanonicalBlock, { type: 'text' }> => b.type === 'text');
      const toolUses = blocks.filter((b): b is Extract<CanonicalBlock, { type: 'tool_use' }> => b.type === 'tool_use');

      const oaiMsg: OpenAIChatMessage = {
        role: msg.role,
        content: textParts.map((t) => t.text).join('') || null,
      };

      if (toolUses.length > 0) {
        oaiMsg.tool_calls = toolUses.map((tu) => ({
          id: tu.id,
          type: 'function' as const,
          function: {
            name: tu.name,
            arguments: JSON.stringify(tu.input),
          },
        }));
      }

      result.push(oaiMsg);
    }

    return result;
  }

  // =========================================================================
  // Shared helpers
  // =========================================================================

  /** Build canonical content from text + tool calls */
  private buildCanonicalContent(
    text: string,
    toolCalls: Array<{ id: string; name: string; input: Record<string, unknown> }>
  ): CanonicalContent {
    if (toolCalls.length === 0 && text) return text;

    const blocks: CanonicalBlock[] = [];
    if (text) blocks.push({ type: 'text', text });
    for (const tc of toolCalls) {
      blocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.input });
    }
    return blocks.length > 0 ? blocks : text;
  }
}
