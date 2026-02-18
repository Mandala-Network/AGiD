/**
 * Anthropic LLM Provider
 *
 * Implements LLMProvider using the @anthropic-ai/sdk.
 */

import Anthropic from '@anthropic-ai/sdk';
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
    const response = await this.client.messages.create({
      model: params.model,
      max_tokens: params.maxTokens,
      system: params.system,
      messages: params.messages as Anthropic.MessageParam[],
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
      rawContent: response.content,
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
        tool_use_id: r.toolUseId,
        content: r.content,
        is_error: r.isError,
      })),
    };
  }
}
