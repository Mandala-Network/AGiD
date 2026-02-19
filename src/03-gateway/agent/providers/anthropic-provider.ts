/**
 * Anthropic LLM Provider
 *
 * Implements LLMProvider using the @anthropic-ai/sdk.
 * Converts canonical ↔ Anthropic native format at the boundary.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { CanonicalContent, CanonicalBlock } from '../canonical-format.js';
import type { LLMProvider, LLMMessage, LLMToolDef, LLMToolResult, LLMResponse } from '../llm-provider.js';

export class AnthropicProvider implements LLMProvider {
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async chat(params: {
    model: string;
    maxTokens: number;
    system: string;
    messages: LLMMessage[];
    tools: LLMToolDef[];
  }): Promise<LLMResponse> {
    // Convert canonical messages to Anthropic native format
    const anthropicMessages = params.messages.map((m) => ({
      role: m.role,
      content: this.toAnthropicContent(m.content),
    })) as Anthropic.MessageParam[];

    const response = await this.client.messages.create({
      model: params.model,
      max_tokens: params.maxTokens,
      system: params.system,
      messages: anthropicMessages,
      tools: params.tools as Anthropic.Tool[],
    });

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');

    const toolCalls = response.content
      .filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
      .map((b) => ({
        id: b.id,
        name: b.name,
        input: b.input as Record<string, unknown>,
      }));

    const done = response.stop_reason === 'end_turn' || response.stop_reason === 'max_tokens';

    return {
      text,
      toolCalls,
      done,
      rawContent: this.fromAnthropicContent(response.content),
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
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

  /** Convert canonical content → Anthropic native format for API calls */
  private toAnthropicContent(content: CanonicalContent): string | Anthropic.ContentBlockParam[] {
    if (typeof content === 'string') return content;

    return content.map((block) => {
      if (block.type === 'text') {
        return { type: 'text' as const, text: block.text };
      }
      if (block.type === 'tool_use') {
        return { type: 'tool_use' as const, id: block.id, name: block.name, input: block.input };
      }
      if (block.type === 'tool_result') {
        return {
          type: 'tool_result' as const,
          tool_use_id: block.toolUseId,
          content: block.content,
          ...(block.isError ? { is_error: block.isError } : {}),
        };
      }
      return { type: 'text' as const, text: JSON.stringify(block) };
    }) as Anthropic.ContentBlockParam[];
  }

  /** Convert Anthropic response content → canonical format for storage */
  private fromAnthropicContent(content: Anthropic.ContentBlock[]): CanonicalBlock[] {
    return content.map((block) => {
      if (block.type === 'text') {
        return { type: 'text' as const, text: block.text };
      }
      if (block.type === 'tool_use') {
        return {
          type: 'tool_use' as const,
          id: block.id,
          name: block.name,
          input: block.input as Record<string, unknown>,
        };
      }
      // Fallback for any unknown block types
      return { type: 'text' as const, text: JSON.stringify(block) };
    });
  }
}
