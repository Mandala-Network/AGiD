/**
 * Agent Module
 *
 * Native agent core: tool registry, prompt builder, session store, agent loop.
 */

export { ToolRegistry } from './tool-registry.js';
export { PromptBuilder, type PromptBuilderConfig, type IdentityContext } from './prompt-builder.js';
export { SessionStore, type SessionStoreConfig, type AnthropicMessage } from './session-store.js';
export { AgentLoop, type AgentLoopConfig } from './agent-loop.js';
export type { LLMProvider, LLMResponse, LLMMessage, LLMToolDef, LLMToolUse, LLMToolResult } from './llm-provider.js';
export { AnthropicProvider } from './providers/index.js';
