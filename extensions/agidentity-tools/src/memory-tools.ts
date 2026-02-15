import { Type } from '@sinclair/typebox';
import type { AnyAgentTool } from 'openclaw/plugin-sdk';
import { request } from './api-client.js';

export interface MemoryToolsConfig {
  gatewayUrl: string;
}

/**
 * Create memory tools for OpenClaw
 *
 * These tools interact with the agent's encrypted long-term memory
 * stored on BSV blockchain via UHRP protocol.
 */
export function createMemoryTools(config: MemoryToolsConfig): AnyAgentTool[] {
  return [
    // Tool 1: Store memory
    {
      name: 'agid_store_memory',
      label: 'Store Memory',
      description:
        "Store information in agent's long-term encrypted memory. Memories are stored on BSV blockchain via UHRP (encrypted). Use this to remember important information across conversations.",
      parameters: Type.Object({
        content: Type.String({
          description: 'Information to remember',
        }),
        tags: Type.Optional(
          Type.Array(Type.String(), {
            description: 'Tags for categorization (e.g., ["meeting", "todo"])',
          })
        ),
      }),
      async execute(toolCallId, params, signal, onUpdate) {
        // Provide progress update if callback available
        if (onUpdate) {
          onUpdate({
            content: [
              {
                type: 'text' as const,
                text: 'Encrypting memory...',
              },
            ],
          });
        }

        const data = await request(config.gatewayUrl, 'POST', '/vault/store', {
          path: `memory-${Date.now()}.md`,
          content: params.content,
        });

        return {
          content: [
            {
              type: 'text' as const,
              text: `Memory stored successfully!\nPath: ${data.path}\nUHRP URL: ${data.uhrpUrl}`,
            },
          ],
          details: data,
        };
      },
    },

    // Tool 2: Recall memory
    {
      name: 'agid_recall_memory',
      label: 'Recall Memory',
      description:
        "Search agent's long-term memory for relevant information. Returns most relevant memories based on semantic similarity. Use this to retrieve information from past conversations.",
      parameters: Type.Object({
        query: Type.String({
          description: 'What to search for',
        }),
        limit: Type.Optional(
          Type.Integer({
            description: 'Max results (default: 3, max: 10)',
          })
        ),
      }),
      async execute(toolCallId, params, signal) {
        const data = await request(config.gatewayUrl, 'POST', '/memory/search', {
          query: params.query,
          limit: params.limit ?? 3,
        });

        // Format results as numbered list
        const formattedResults =
          data.count > 0
            ? `Found ${data.count} memories:\n\n` +
              data.results
                .map(
                  (result: any, index: number) =>
                    `${index + 1}. ${result.content} (relevance: ${(result.score * 100).toFixed(1)}%)`
                )
                .join('\n')
            : 'No matching memories found.';

        return {
          content: [
            {
              type: 'text' as const,
              text: formattedResults,
            },
          ],
          details: data,
        };
      },
    },
  ];
}
