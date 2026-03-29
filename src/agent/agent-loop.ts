/**
 * Agent Loop
 *
 * Iterative LLM call → tool execution cycle using a pluggable LLMProvider.
 * Non-streaming, sequential tool execution to respect wallet signing safety.
 */

import type { LLMProvider, LLMMessage } from './llm-provider.js';
import type { ToolRegistry } from './tool-registry.js';
import type { ToolCategory } from './tools/types.js';
import type { SessionStore } from './session-store.js';
import type { PromptBuilder, IdentityContext } from './prompt-builder.js';
import type { AgentLoopResult, AgentToolCall, AgentUsageStats, ConversationTurn } from '../types/agent-types.js';
import type { AnchorChain } from '../audit/anchor-chain.js';
import { sha256 } from '../audit/anchor-chain.js';
import { ProgressEmitter } from '../messaging/progress-emitter.js';
import type { ProgressEvent } from '../messaging/progress-emitter.js';
import { calculateBudget, truncateToolResult } from './token-budget.js';

export interface AgentLoopConfig {
  toolRegistry: ToolRegistry;
  sessionStore: SessionStore;
  promptBuilder: PromptBuilder;
  model: string;
  provider: LLMProvider;
  maxIterations: number;
  maxTokens: number;
  /** Model context window size in tokens (default: 128000) */
  contextWindow?: number;
  /** Max tokens per tool result before truncation (default: 4000) */
  maxToolResultTokens?: number;
  /** Called with assistant reasoning text before each tool execution batch.
   *  Use this to inject reasoning text into plugins (e.g. NautilusTradingPlugin). */
  preToolExecution?: (assistantText: string) => void;
}

export class AgentLoop {
  private provider: LLMProvider;
  private toolRegistry: ToolRegistry;
  private sessionStore: SessionStore;
  private promptBuilder: PromptBuilder;
  private model: string;
  private maxIterations: number;
  private maxTokens: number;
  private contextWindow: number;
  private maxToolResultTokens: number;
  private preToolExecution?: (assistantText: string) => void;

  constructor(config: AgentLoopConfig) {
    this.provider = config.provider;
    this.toolRegistry = config.toolRegistry;
    this.sessionStore = config.sessionStore;
    this.promptBuilder = config.promptBuilder;
    this.model = config.model;
    this.maxIterations = config.maxIterations;
    this.maxTokens = config.maxTokens;
    this.contextWindow = config.contextWindow ?? 128_000;
    this.maxToolResultTokens = config.maxToolResultTokens ?? 4000;
    this.preToolExecution = config.preToolExecution;
  }

  private classifyIntent(userMessage: string): { needsTools: boolean; categories: ToolCategory[] | null } {
    const msg = userMessage.toLowerCase();

    // Reasoning patterns — no tools needed
    const reasoningPatterns = [
      /^(what|why|how|when|where|who|can you|could you|would you|do you|is it|are you|tell me|explain|think|discuss|opinion|idea|thought|consider)/,
      /\?$/,
      /^(hi|hello|hey|thanks|thank you|ok|okay|sure|yes|no|right|got it)/,
    ];

    const isReasoning = reasoningPatterns.some(p => p.test(msg));

    // Action keywords that override reasoning classification
    const actionKeywords: Record<string, ToolCategory[]> = {
      'sign': ['crypto'],
      'encrypt': ['crypto'],
      'decrypt': ['crypto'],
      'hmac': ['crypto'],
      'balance': ['identity', 'wallet'],
      'identity': ['identity'],
      'public key': ['identity'],
      'payment': ['transactions', 'wallet', 'messaging'],
      'send payment': ['transactions', 'wallet'],
      'send message': ['messaging'],
      'message': ['messaging'],
      'memory': ['memory', 'shad'],
      'remember': ['memory'],
      'recall': ['memory', 'shad'],
      'store': ['memory'],
      'clean up': ['memory'],
      'legacy': ['memory'],
      'garbage': ['memory'],
      'proof': ['zkproof'],
      'zkproof': ['zkproof'],
      'commitment': ['zkproof'],
      'verify': ['zkproof', 'audit'],
      'token': ['tokens', 'wallet'],
      'create token': ['tokens', 'wallet'],
      'transaction': ['transactions', 'wallet'],
      'utxo': ['wallet'],
      'output': ['wallet'],
      'deploy': ['deployment', 'deploy'],
      'mandala': ['deployment', 'deploy'],
      'certificate': ['identity'],
      'calibrat': ['calibration'],
      'discover': ['services'],
      'overlay': ['services'],
      'audit': ['audit'],
      'workspace': ['audit'],
      'session': ['audit'],
      'file': ['fs'],
      'read': ['fs'],
      'write': ['fs'],
      'edit': ['fs'],
      'patch': ['fs'],
      'exec': ['runtime'],
      'run': ['runtime'],
      'command': ['runtime'],
      'shell': ['runtime'],
      'process': ['runtime'],
      'browser': ['browser'],
      'navigate': ['browser'],
      'screenshot': ['browser'],
    };

    // Check for action keywords
    const matchedCategories = new Set<ToolCategory>();
    for (const [keyword, cats] of Object.entries(actionKeywords)) {
      if (msg.includes(keyword)) {
        cats.forEach(c => matchedCategories.add(c));
      }
    }

    if (matchedCategories.size > 0) {
      matchedCategories.add('identity');
      return { needsTools: true, categories: Array.from(matchedCategories) };
    }

    if (isReasoning) {
      return { needsTools: false, categories: null };
    }

    // Ambiguous — provide all tools, let the prompt guide behavior
    return { needsTools: true, categories: null };
  }

  async run(userMessage: string, sessionId: string, identityContext?: IdentityContext, anchorChain?: AnchorChain): Promise<AgentLoopResult> {
    const toolCalls: AgentToolCall[] = [];
    const usage: AgentUsageStats = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

    // Set user message hint for auto-recall
    (this.promptBuilder as any).setLastUserMessage?.(userMessage);

    // 1. Build system prompt
    const systemPrompt = await this.promptBuilder.buildSystemPrompt(identityContext);

    // 2. Load session history
    const history = await this.sessionStore.getMessages(sessionId);

    // 3. Append user message
    history.push({ role: 'user', content: userMessage });

    // Save user turn (canonical v1 format)
    const userTurn: ConversationTurn = { role: 'user', content: userMessage, timestamp: Date.now(), v: 1 };
    await this.sessionStore.addTurn(sessionId, userTurn);

    // 4. Classify intent and get filtered tool definitions
    const intent = this.classifyIntent(userMessage);
    console.log(`[AgentLoop] Intent: needsTools=${intent.needsTools}, categories=${intent.categories?.join(',') ?? 'all'}`);
    const tools = intent.needsTools
      ? this.toolRegistry.getDefinitionsByCategories(intent.categories).map(t => ({
          name: t.name,
          description: t.description,
          input_schema: t.input_schema,
        }))
      : [];

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
        // Save assistant turn (canonical v1 format)
        const assistantTurn: ConversationTurn = {
          role: 'assistant',
          content: response.rawContent,
          timestamp: Date.now(),
          v: 1,
        };
        await this.sessionStore.addTurn(sessionId, assistantTurn);

        return { response: response.text, toolCalls, usage, iterations };
      }

      if (response.toolCalls.length > 0) {
        // Append assistant response to messages
        messages = [...messages, { role: 'assistant', content: response.rawContent }];

        // Inject reasoning text into plugins before tool execution
        if (this.preToolExecution && response.text) {
          this.preToolExecution(response.text);
        }

        // Partition: wallet tools must be sequential (wallet signing safety), rest can be parallel
        const walletCalls = response.toolCalls.filter(c => this.toolRegistry.requiresWallet(c.name));
        const readOnlyCalls = response.toolCalls.filter(c => !this.toolRegistry.requiresWallet(c.name));

        // Build a map to preserve original order for Anthropic API
        const resultMap = new Map<string, { toolUseId: string; content: string; isError?: boolean }>();

        const executeSingle = async (call: typeof response.toolCalls[0]) => {
          console.log(`[AgentLoop] Executing tool: ${call.name}`);
          const result = await this.toolRegistry.execute(call.name, call.input);

          // Truncate oversized tool results to protect context budget
          const content = truncateToolResult(result.content, this.maxToolResultTokens);

          toolCalls.push({ name: call.name, input: call.input, result: { ...result, content } });
          resultMap.set(call.id, { toolUseId: call.id, content, isError: result.isError });

          if (result.isError) {
            const errStr = typeof content === 'string' ? content : JSON.stringify(content);
            console.log(`[AgentLoop] ❌ ${call.name} FAILED: ${errStr.substring(0, 300)}`);
          } else {
            console.log(`[AgentLoop] ✅ ${call.name} completed`);
          }

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
        };

        // Execute read-only tools in parallel
        if (readOnlyCalls.length > 0) {
          await Promise.all(readOnlyCalls.map(executeSingle));
        }

        // Execute wallet tools sequentially (wallet signing safety)
        for (const call of walletCalls) {
          await executeSingle(call);
        }

        // Re-order results to match original tool_use_id order
        const toolResults = response.toolCalls.map(c => resultMap.get(c.id)!);

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

  /**
   * Run the agent loop with progress event emission.
   *
   * Same behavior as run() but emits progress events via the onEvent callback:
   *   - thinking: before each LLM call
   *   - tool_start: before each tool execution
   *   - tool_result: after each tool execution (with status and optional error type)
   *   - completion: after the loop finishes
   *
   * The onEvent callback sends each ProgressEvent as a MessageBox message.
   * Events are queued and sent sequentially to prevent concurrent wallet signing.
   *
   * @param userMessage - The user's message
   * @param sessionId - Session ID for conversation history
   * @param onEvent - Callback to emit progress events (sent via MessageBox)
   * @param identityContext - Optional identity context for the prompt
   * @param anchorChain - Optional anchor chain for audit
   * @param requestId - Optional requestId to correlate progress events with the original request.
   *                     If not provided, a new UUID is generated.
   */
  async runWithEvents(
    userMessage: string,
    sessionId: string,
    onEvent: (event: ProgressEvent) => Promise<void>,
    identityContext?: IdentityContext,
    anchorChain?: AnchorChain,
    requestId?: string,
  ): Promise<AgentLoopResult> {
    const resolvedRequestId = requestId ?? crypto.randomUUID();
    const startTime = Date.now();
    const emitter = new ProgressEmitter(onEvent);

    const toolCalls: AgentToolCall[] = [];
    const usage: AgentUsageStats = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

    // Set user message hint for auto-recall
    (this.promptBuilder as any).setLastUserMessage?.(userMessage);

    // 1. Build system prompt
    const systemPrompt = await this.promptBuilder.buildSystemPrompt(identityContext);

    // 2. Load session history
    const history = await this.sessionStore.getMessages(sessionId);

    // 3. Append user message
    history.push({ role: 'user', content: userMessage });

    // Save user turn (canonical v1 format)
    const userTurn: ConversationTurn = { role: 'user', content: userMessage, timestamp: Date.now(), v: 1 };
    await this.sessionStore.addTurn(sessionId, userTurn);

    // 4. Classify intent and get filtered tool definitions
    const intent = this.classifyIntent(userMessage);
    console.log(`[AgentLoop] Intent: needsTools=${intent.needsTools}, categories=${intent.categories?.join(',') ?? 'all'}`);
    const tools = intent.needsTools
      ? this.toolRegistry.getDefinitionsByCategories(intent.categories).map(t => ({
          name: t.name,
          description: t.description,
          input_schema: t.input_schema,
        }))
      : [];

    // 5. Iterative loop with event emission
    let messages: LLMMessage[] = history as LLMMessage[];
    let iterations = 0;
    let outcome: 'success' | 'error' = 'success';

    try {
      while (iterations < this.maxIterations) {
        iterations++;

        // Emit thinking event before LLM call
        await emitter.emitThinking(resolvedRequestId);

        // Token budget check — log context pressure
        const budget = calculateBudget(this.contextWindow, systemPrompt, tools, messages, this.maxTokens);
        if (budget.pressureHigh) {
          console.log(`[AgentLoop] Context pressure HIGH (${budget.usagePercent}% used, ${budget.available} tokens available)`);
        }

        const response = await this.provider.chat({
          model: this.model,
          maxTokens: this.maxTokens,
          system: systemPrompt,
          messages,
          tools,
        });

        // Emit reasoning event if the model produced chain-of-thought
        if (response.reasoning) {
          await emitter.emitReasoning(resolvedRequestId, response.reasoning);
        }

        // Accumulate usage
        usage.inputTokens += response.usage.inputTokens;
        usage.outputTokens += response.usage.outputTokens;
        usage.totalTokens = usage.inputTokens + usage.outputTokens;

        // Check if model is done (end_turn or max_tokens)
        if (response.done) {
          // Save assistant turn (canonical v1 format)
          const assistantTurn: ConversationTurn = {
            role: 'assistant',
            content: response.rawContent,
            timestamp: Date.now(),
            v: 1,
          };
          await this.sessionStore.addTurn(sessionId, assistantTurn);

          // Emit completion event
          await emitter.emitCompletion(resolvedRequestId, toolCalls.length, Date.now() - startTime, 'success');

          return { response: response.text, toolCalls, usage, iterations };
        }

        if (response.toolCalls.length > 0) {
          // Append assistant response to messages
          messages = [...messages, { role: 'assistant', content: response.rawContent }];

          // Inject reasoning text into plugins before tool execution
          if (this.preToolExecution && response.text) {
            this.preToolExecution(response.text);
          }

          // Partition: wallet tools must be sequential, rest can be parallel
          const walletCalls = response.toolCalls.filter(c => this.toolRegistry.requiresWallet(c.name));
          const readOnlyCalls = response.toolCalls.filter(c => !this.toolRegistry.requiresWallet(c.name));

          // Build a map to preserve original order for Anthropic API
          const resultMap = new Map<string, { toolUseId: string; content: string; isError?: boolean }>();

          const executeSingle = async (call: typeof response.toolCalls[0]) => {
            // Emit tool_start before execution
            await emitter.emitToolStart(resolvedRequestId, call.name);

            console.log(`[AgentLoop] Executing tool: ${call.name}`);
            const result = await this.toolRegistry.execute(call.name, call.input);

            // Truncate oversized tool results to protect context budget
            const content = truncateToolResult(result.content, this.maxToolResultTokens);

            toolCalls.push({ name: call.name, input: call.input, result: { ...result, content } });
            resultMap.set(call.id, { toolUseId: call.id, content, isError: result.isError });

            // Emit tool_result after execution
            if (result.isError) {
              // Extract error type name from the error content (no stack traces)
              const errStr = typeof result.content === 'string' ? result.content : JSON.stringify(result.content);
              const errorType = extractErrorType(errStr);
              await emitter.emitToolResult(resolvedRequestId, call.name, 'failed', errorType);
              console.log(`[AgentLoop] ${call.name} FAILED: ${errStr.substring(0, 300)}`);
            } else {
              await emitter.emitToolResult(resolvedRequestId, call.name, 'completed');
              console.log(`[AgentLoop] ${call.name} completed`);
            }

            // Anchor tool execution if chain provided
            if (anchorChain) {
              const anchorType = call.name === 'agid_send_payment' ? 'payment' as const
                : call.name === 'agid_store_memory' ? 'memory_write' as const
                : 'tool_use' as const;
              const outputHash = await sha256(result.content);
              await anchorChain.addAnchor({
                type: anchorType,
                data: { tool: call.name, input: call.input, outputHash },
                summary: `${call.name}${anchorType === 'payment' ? `: ${(call.input as any).amount} sats -> ${((call.input as any).recipient as string)?.substring(0, 12)}...` : ''}`,
                metadata: anchorType === 'payment' ? { recipient: (call.input as any).recipient, amount: (call.input as any).amount } : undefined,
              });
            }
          };

          // Execute read-only tools in parallel
          if (readOnlyCalls.length > 0) {
            await Promise.all(readOnlyCalls.map(executeSingle));
          }

          // Execute wallet tools sequentially (wallet signing safety)
          for (const call of walletCalls) {
            await executeSingle(call);
          }

          // Re-order results to match original tool_use_id order
          const toolResults = response.toolCalls.map(c => resultMap.get(c.id)!);

          // Append tool results as user message
          messages = [...messages, this.provider.buildToolResultMessage(toolResults)];
          continue;
        }

        // No tool calls and not done -- return what we have
        await emitter.emitCompletion(resolvedRequestId, toolCalls.length, Date.now() - startTime, 'success');
        return { response: response.text || 'I was unable to complete the request.', toolCalls, usage, iterations };
      }

      // Max iterations exceeded
      await emitter.emitCompletion(resolvedRequestId, toolCalls.length, Date.now() - startTime, 'success');
      return {
        response: 'I reached the maximum number of tool iterations. Here is what I was able to accomplish so far.',
        toolCalls,
        usage,
        iterations,
      };
    } catch (error) {
      // Emit completion with error outcome
      outcome = 'error';
      await emitter.emitCompletion(resolvedRequestId, toolCalls.length, Date.now() - startTime, outcome).catch(() => {
        // Best-effort: do not mask the original error
      });
      throw error;
    }
  }
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Extract a short error type name from an error string.
 * Returns the first word/identifier that looks like an error class name,
 * e.g. "InsufficientFunds" from "InsufficientFunds: not enough balance".
 * Falls back to "Error" if no recognizable type is found.
 * No raw stack traces are ever returned.
 */
function extractErrorType(errStr: string): string {
  // Try to match a PascalCase or camelCase error type at the start
  const match = errStr.match(/^([A-Z][a-zA-Z0-9]+(?:Error|Exception|Fault)?)/);
  if (match) return match[1];

  // Try to match "ErrorType:" pattern anywhere
  const colonMatch = errStr.match(/([A-Z][a-zA-Z0-9]+):/);
  if (colonMatch) return colonMatch[1];

  // Fallback: return a generic type
  return 'Error';
}
