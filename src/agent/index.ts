/**
 * Agent Module
 *
 * Native agent core: tool registry, prompt builder, session store, agent loop.
 * Supports any LLM provider via canonical message format.
 */

export { ToolRegistry } from './tool-registry.js';
export { PromptBuilder, type PromptBuilderConfig, type IdentityContext } from './prompt-builder.js';
export { SessionStore, type SessionStoreConfig } from './session-store.js';
export { AgentLoop, type AgentLoopConfig } from './agent-loop.js';
export type { LLMProvider, LLMResponse, LLMMessage, LLMToolDef, LLMToolUse, LLMToolResult } from './llm-provider.js';
export type { CanonicalContent, CanonicalBlock, CanonicalTurn } from './canonical-format.js';
export { normalizeToCanonical } from './canonical-format.js';
export { AnthropicProvider, OllamaProvider, createProvider } from './providers/index.js';
export type { ProviderConfig, ProviderType, OllamaProviderConfig } from './providers/index.js';
