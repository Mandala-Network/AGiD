/**
 * Ollama / OpenAI-Compatible LLM Provider
 *
 * Works with Ollama, vLLM, LM Studio, OpenAI, Groq, or any OpenAI-compatible endpoint.
 * Uses raw fetch — no SDK dependency. Converts canonical ↔ OpenAI chat format at the boundary.
 */

import type { CanonicalContent, CanonicalBlock } from '../canonical-format.js';
import type { LLMProvider, LLMMessage, LLMToolDef, LLMToolResult, LLMResponse } from '../llm-provider.js';

export interface OllamaProviderConfig {
  /** Base URL for the API (default: http://localhost:11434) */
  baseUrl?: string;
  /** API key (optional — needed for OpenAI/Groq, not for local Ollama) */
  apiKey?: string;
}

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

export class OllamaProvider implements LLMProvider {
  private baseUrl: string;
  private apiKey?: string;

  constructor(config?: OllamaProviderConfig) {
    this.baseUrl = (config?.baseUrl ?? 'http://localhost:11434').replace(/\/$/, '');
    this.apiKey = config?.apiKey;
  }

  async chat(params: {
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
    const text = msg.content ?? '';

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
    };
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

  /** Convert system prompt + canonical messages → OpenAI chat format */
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
