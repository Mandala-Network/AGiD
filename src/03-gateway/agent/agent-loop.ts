/**
 * Agent Loop
 *
 * Iterative LLM call → tool execution cycle using a pluggable LLMProvider.
 * Non-streaming, sequential tool execution to respect MPC signing lock.
 */

import type { LLMProvider, LLMMessage } from './llm-provider.js';
import type { ToolRegistry } from './tool-registry.js';
import type { SessionStore } from './session-store.js';
import type { PromptBuilder, IdentityContext } from './prompt-builder.js';
import type { AgentLoopResult, AgentToolCall, AgentUsageStats, ConversationTurn } from '../../07-shared/types/agent-types.js';
import type { AnchorChain } from '../../07-shared/audit/anchor-chain.js';
import { sha256 } from '../../07-shared/audit/anchor-chain.js';

export interface AgentLoopConfig {
  toolRegistry: ToolRegistry;
  sessionStore: SessionStore;
  promptBuilder: PromptBuilder;
  model: string;
  provider: LLMProvider;
  maxIterations: number;
  maxTokens: number;
}

export class AgentLoop {
  private provider: LLMProvider;
  private toolRegistry: ToolRegistry;
  private sessionStore: SessionStore;
  private promptBuilder: PromptBuilder;
  private model: string;
  private maxIterations: number;
  private maxTokens: number;

  constructor(config: AgentLoopConfig) {
    this.provider = config.provider;
    this.toolRegistry = config.toolRegistry;
    this.sessionStore = config.sessionStore;
    this.promptBuilder = config.promptBuilder;
    this.model = config.model;
    this.maxIterations = config.maxIterations;
    this.maxTokens = config.maxTokens;
  }

  async run(userMessage: string, sessionId: string, identityContext?: IdentityContext, anchorChain?: AnchorChain): Promise<AgentLoopResult> {
    const toolCalls: AgentToolCall[] = [];
    const usage: AgentUsageStats = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

    // 1. Build system prompt
    const systemPrompt = await this.promptBuilder.buildSystemPrompt(identityContext);

    // 2. Load session history
    const history = await this.sessionStore.getMessages(sessionId);

    // 3. Append user message
    history.push({ role: 'user', content: userMessage });

    // Save user turn
    const userTurn: ConversationTurn = { role: 'user', content: userMessage, timestamp: Date.now() };
    await this.sessionStore.addTurn(sessionId, userTurn);

    // 4. Get tool definitions
    const tools = this.toolRegistry.getDefinitions().map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.input_schema,
    }));

    // 5. Iterative loop
    let messages: LLMMessage[] = history as LLMMessage[];
    let iterations = 0;

    while (iterations < this.maxIterations) {
      iterations++;

      const response = await this.provider.chat({
        model: this.model,
        maxTokens: this.maxTokens,
        system: systemPrompt,
        messages,
        tools,
      });

      // Accumulate usage
      usage.inputTokens += response.usage.inputTokens;
      usage.outputTokens += response.usage.outputTokens;
      usage.totalTokens = usage.inputTokens + usage.outputTokens;

      // Check if model is done (end_turn or max_tokens)
      if (response.done) {
        // Save assistant turn
        const assistantTurn: ConversationTurn = {
          role: 'assistant',
          content: response.rawContent,
          timestamp: Date.now(),
        };
        await this.sessionStore.addTurn(sessionId, assistantTurn);

        return { response: response.text, toolCalls, usage, iterations };
      }

      if (response.toolCalls.length > 0) {
        // Append assistant response to messages
        messages = [...messages, { role: 'assistant', content: response.rawContent }];

        // Execute each tool sequentially (MPC signing lock)
        const toolResults = [];

        for (const call of response.toolCalls) {
          console.log(`[AgentLoop] 🔧 Executing tool: ${call.name}`);
          const result = await this.toolRegistry.execute(call.name, call.input);

          toolCalls.push({
            name: call.name,
            input: call.input,
            result,
          });

          toolResults.push({
            toolUseId: call.id,
            content: result.content,
            isError: result.isError,
          });

          console.log(`[AgentLoop] ${result.isError ? '❌' : '✅'} ${call.name} completed`);

          // Anchor tool execution if chain provided
          if (anchorChain) {
            const anchorType = call.name === 'agid_send_payment' ? 'payment' as const
              : call.name === 'agid_store_memory' ? 'memory_write' as const
              : 'tool_use' as const;
            const outputHash = await sha256(result.content);
            await anchorChain.addAnchor({
              type: anchorType,
              data: { tool: call.name, input: call.input, outputHash },
              summary: `${call.name}${anchorType === 'payment' ? `: ${(call.input as any).amount} sats → ${((call.input as any).recipient as string)?.substring(0, 12)}...` : ''}`,
              metadata: anchorType === 'payment' ? { recipient: (call.input as any).recipient, amount: (call.input as any).amount } : undefined,
            });
          }
        }

        // Append tool results as user message
        messages = [...messages, this.provider.buildToolResultMessage(toolResults)];
        continue;
      }

      // No tool calls and not done — return what we have
      return { response: response.text || 'I was unable to complete the request.', toolCalls, usage, iterations };
    }

    // Max iterations exceeded
    return {
      response: 'I reached the maximum number of tool iterations. Here is what I was able to accomplish so far.',
      toolCalls,
      usage,
      iterations,
    };
  }
}
