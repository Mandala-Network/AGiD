import type { ToolDescriptor } from './types.js';
import { ok } from './types.js';

export function memoryTools(): ToolDescriptor[] {
  return [
    {
      definition: {
        name: 'agid_store_memory',
        description: 'Store a memory on the blockchain. Encrypts content, uploads to UHRP, creates a PushDrop token, and stores in the agent-memories basket. Use this for all memory storage — including tokenizing core memories, insights, and learnings. Returns txid and UHRP URL on success, or an error if insufficient funds.',
        input_schema: {
          type: 'object',
          properties: {
            content: { type: 'string', description: 'Memory content to store' },
            tags: { type: 'array', items: { type: 'string' }, description: 'Tags for categorization' },
            importance: { type: 'string', description: '"high", "medium", or "low" (default: medium)' },
          },
          required: ['content'],
        },
      },
      requiresWallet: true,
      execute: async (params, ctx) => {
        if (!ctx.memoryManager) throw new Error('MemoryManager not configured');
        const content = params.content as string;
        const tags = (params.tags as string[]) || [];
        const importance = (params.importance as 'high' | 'medium' | 'low') || 'medium';
        const result = await ctx.memoryManager.store({ content, tags, importance });
        return ok({ txid: result.txid, uhrpUrl: result.uhrpUrl, tags: result.tags, stored: true });
      },
    },
    {
      definition: {
        name: 'agid_recall_memories',
        description: 'Recall memories from your on-chain memory vault. Supports optional semantic search via Shad. Returns results with blockchain provenance.',
        input_schema: {
          type: 'object',
          properties: {
            tags: { type: 'array', items: { type: 'string' }, description: 'Filter by tags' },
            importance: { type: 'string', description: '"high", "medium", or "low"' },
            limit: { type: 'number', description: 'Max memories to return (default: 20)' },
            semantic: { type: 'boolean', description: 'Enable semantic search via Shad (default: false)' },
            query: { type: 'string', description: 'Search query (required when semantic=true)' },
            strategy: { type: 'string', description: 'Shad strategy when semantic=true (default: research)' },
            maxDepth: { type: 'number', description: 'Max recursion depth for semantic search (default: 3)' },
            maxTime: { type: 'number', description: 'Max execution time in seconds for semantic search (default: 120)' },
          },
          required: [],
        },
      },
      requiresWallet: false,
      execute: async (params, ctx) => {
        if (!ctx.memoryManager) throw new Error('MemoryManager not configured');
        const result = await ctx.memoryManager.recall({
          tags: params.tags as string[] | undefined,
          importance: params.importance as string | undefined,
          limit: params.limit as number | undefined,
          semantic: params.semantic as boolean | undefined,
          query: params.query as string | undefined,
          strategy: params.strategy as string | undefined,
          maxDepth: params.maxDepth as number | undefined,
          maxTime: params.maxTime as number | undefined,
        });
        return ok(result as unknown as Record<string, unknown>);
      },
    },
  ];
}
