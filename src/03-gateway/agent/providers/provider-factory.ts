/**
 * Provider Factory
 *
 * Auto-detects and creates the appropriate LLM provider from environment variables.
 * Backward compatible: ANTHROPIC_API_KEY still works as before.
 */

import type { LLMProvider } from '../llm-provider.js';
import { AnthropicProvider } from './anthropic-provider.js';
import { OllamaProvider } from './ollama-provider.js';
import type { OllamaProviderConfig } from './ollama-provider.js';

export type ProviderType = 'anthropic' | 'ollama' | 'openai-compatible';

export interface ProviderConfig {
  type?: ProviderType;
  /** Anthropic API key (for type: 'anthropic') */
  anthropicApiKey?: string;
  /** Base URL for OpenAI-compatible endpoints (for type: 'ollama' | 'openai-compatible') */
  baseUrl?: string;
  /** API key for the provider (for type: 'ollama' | 'openai-compatible') */
  apiKey?: string;
}

/**
 * Create an LLM provider, auto-detecting from environment if no config given.
 *
 * Detection order:
 * 1. `AGID_LLM_PROVIDER` explicit → use that
 * 2. `ANTHROPIC_API_KEY` set → 'anthropic'
 * 3. `AGID_LLM_BASE_URL` set → 'ollama'
 * 4. Default → 'anthropic' (backward compatible)
 */
export function createProvider(config?: ProviderConfig): LLMProvider {
  const type = config?.type ?? detectProviderType();

  switch (type) {
    case 'anthropic': {
      const apiKey = config?.anthropicApiKey ?? process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        throw new Error(
          'ANTHROPIC_API_KEY not set. Either set the environment variable or pass anthropicApiKey in config.'
        );
      }
      return new AnthropicProvider(apiKey);
    }

    case 'ollama':
    case 'openai-compatible': {
      const ollamaConfig: OllamaProviderConfig = {
        baseUrl: config?.baseUrl ?? process.env.AGID_LLM_BASE_URL ?? 'http://localhost:11434',
        apiKey: config?.apiKey ?? process.env.AGID_LLM_API_KEY,
      };
      return new OllamaProvider(ollamaConfig);
    }

    default:
      throw new Error(`Unknown provider type: ${type}`);
  }
}

function detectProviderType(): ProviderType {
  const explicit = process.env.AGID_LLM_PROVIDER;
  if (explicit) return explicit as ProviderType;

  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  if (process.env.AGID_LLM_BASE_URL) return 'ollama';

  return 'anthropic';
}
