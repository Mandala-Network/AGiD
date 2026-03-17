/**
 * Shad Tools
 *
 * Agent tools for Shannon's Daemon (Shad) integration.
 * Provides deep reasoning, search, and context retrieval over the agent's
 * on-chain memories via MemoryManager's Shad integration.
 *
 * These tools complement the existing agid_recall_memories tool by providing
 * Shad's DAG-based reasoning and hybrid search capabilities.
 */

import type { ToolDescriptor, ToolContext } from './types.js';
import { ok } from './types.js';

export function shadTools(): ToolDescriptor[] {
  return [
    {
      definition: {
        name: 'shad_deep_recall',
        description:
          'Deep reasoning over all stored memories using Shad\'s DAG-based reasoning engine. ' +
          'Use for complex analysis, pattern discovery, and multi-step reasoning across memories. ' +
          'Slower than agid_recall_memories but produces higher quality, synthesized results.',
        input_schema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'The question or analysis task to reason about across memories' },
            strategy: {
              type: 'string',
              enum: ['research', 'analysis', 'planning', 'software'],
              description: 'Reasoning strategy (default: research)',
            },
            maxDepth: { type: 'number', description: 'Maximum recursion depth (default: 3)' },
            maxTime: { type: 'number', description: 'Maximum execution time in seconds (default: 120)' },
          },
          required: ['query'],
        },
      },
      requiresWallet: false,
      execute: async (params, ctx: ToolContext) => {
        if (!ctx.memoryManager) {
          return ok({ success: false, error: 'Memory manager not available' });
        }

        const result = await ctx.memoryManager.recall({
          semantic: true,
          query: params.query as string,
          strategy: (params.strategy as string) ?? 'research',
          maxDepth: (params.maxDepth as number) ?? 3,
          maxTime: (params.maxTime as number) ?? 120,
        });

        return ok({
          success: true,
          memories: result.memories,
          total: result.total,
          returned: result.returned,
          shadAvailable: result.shadAvailable,
          output: result.output,
          message: result.message,
        });
      },
    },
    {
      definition: {
        name: 'shad_search_memories',
        description:
          'Fast hybrid search across all stored memories using Shad. ' +
          'Faster than shad_deep_recall, uses keyword + semantic matching without full DAG reasoning.',
        input_schema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query' },
            limit: { type: 'number', description: 'Maximum results to return (default: 10)' },
          },
          required: ['query'],
        },
      },
      requiresWallet: false,
      execute: async (params, ctx: ToolContext) => {
        if (!ctx.memoryManager) {
          return ok({ success: false, error: 'Memory manager not available' });
        }

        const result = await ctx.memoryManager.quickRecall(
          params.query as string,
          (params.limit as number) ?? 10,
        );

        return ok({
          success: true,
          memories: result.memories,
          total: result.total,
          returned: result.returned,
          shadAvailable: result.shadAvailable,
          message: result.message,
        });
      },
    },
  ];
}
