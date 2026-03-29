/**
 * AGiD Memory Plugin
 *
 * On-chain memory storage and retrieval, including Shad deep reasoning.
 */

import { PushDrop, LockingScript, Transaction } from '@bsv/sdk';
import { definePluginEntry } from '../define-plugin-entry.js';

function json(data: Record<string, unknown>) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

export const agidMemoryPlugin = definePluginEntry({
  id: 'agid-memory',
  name: 'AGiD Memory',
  register(api) {
    const getMemoryManager = () => api.agid?.memoryManager;

    // =========================================================================
    // 1. agid_store_memory — Store a memory on the blockchain
    // =========================================================================
    api.registerTool(
      {
        name: 'agid_store_memory',
        description:
          'Store a memory on the blockchain. Encrypts content, uploads to UHRP, creates a PushDrop token, and stores in the agid-memory basket. Use this for all memory storage — including tokenizing core memories, insights, and learnings. Returns txid and UHRP URL on success, or an error if insufficient funds.',
        parameters: {
          type: 'object',
          properties: {
            content: { type: 'string', description: 'Memory content to store' },
            tags: { type: 'array', items: { type: 'string' }, description: 'Tags for categorization' },
          },
          required: ['content'],
        },
        requiresWallet: true,
        async execute(_id, params, _ctx) {
          const memoryManager = getMemoryManager();
          if (!memoryManager) {
            return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'MemoryManager not configured' }) }], isError: true };
          }
          const content = params.content as string;
          const tags = (params.tags as string[]) || [];
          const result = await memoryManager.store({ content, tags });
          return json({ txid: result.txid, uhrpUrl: result.uhrpUrl, tags: result.tags, stored: true });
        },
      },
      { group: 'memory' },
    );

    // =========================================================================
    // 2. agid_recall_memories — Recall memories from on-chain vault
    // =========================================================================
    api.registerTool(
      {
        name: 'agid_recall_memories',
        description:
          'Recall memories from your on-chain memory vault. Supports optional semantic search via Shad. Returns results with blockchain provenance.',
        parameters: {
          type: 'object',
          properties: {
            tags: { type: 'array', items: { type: 'string' }, description: 'Filter by tags' },
            limit: { type: 'number', description: 'Max memories to return (default: 20)' },
            semantic: { type: 'boolean', description: 'Enable semantic search via Shad (default: false)' },
            query: { type: 'string', description: 'Search query (required when semantic=true)' },
            strategy: { type: 'string', description: 'Shad strategy when semantic=true (default: research)' },
            maxDepth: { type: 'number', description: 'Max recursion depth for semantic search (default: 3)' },
            maxTime: { type: 'number', description: 'Max execution time in seconds for semantic search (default: 120)' },
          },
          required: [],
        },
        requiresWallet: false,
        async execute(_id, params, _ctx) {
          const memoryManager = getMemoryManager();
          if (!memoryManager) {
            return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'MemoryManager not configured' }) }], isError: true };
          }
          const result = await memoryManager.recall({
            tags: params.tags as string[] | undefined,
            limit: params.limit as number | undefined,
            semantic: params.semantic as boolean | undefined,
            query: params.query as string | undefined,
            strategy: params.strategy as string | undefined,
            maxDepth: params.maxDepth as number | undefined,
            maxTime: params.maxTime as number | undefined,
          });
          return json(result as unknown as Record<string, unknown>);
        },
      },
      { group: 'memory' },
    );

    // =========================================================================
    // 3. shad_deep_recall — Deep reasoning over memories via Shad
    // =========================================================================
    api.registerTool(
      {
        name: 'shad_deep_recall',
        description:
          'Deep reasoning over all stored memories using Shad\'s DAG-based reasoning engine. ' +
          'Use for complex analysis, pattern discovery, and multi-step reasoning across memories. ' +
          'Slower than agid_recall_memories but produces higher quality, synthesized results.',
        parameters: {
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
        requiresWallet: false,
        async execute(_id, params, _ctx) {
          const memoryManager = getMemoryManager();
          if (!memoryManager) {
            return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Memory manager not available' }) }], isError: true };
          }

          const result = await memoryManager.recall({
            semantic: true,
            query: params.query as string,
            strategy: (params.strategy as string) ?? 'research',
            maxDepth: (params.maxDepth as number) ?? 3,
            maxTime: (params.maxTime as number) ?? 120,
          });

          return json({
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
      { group: 'memory' },
    );

    // =========================================================================
    // 4. shad_search_memories — Fast hybrid search via Shad
    // =========================================================================
    api.registerTool(
      {
        name: 'shad_search_memories',
        description:
          'Fast hybrid search across all stored memories using Shad. ' +
          'Faster than shad_deep_recall, uses keyword + semantic matching without full DAG reasoning.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query' },
            limit: { type: 'number', description: 'Maximum results to return (default: 10)' },
          },
          required: ['query'],
        },
        requiresWallet: false,
        async execute(_id, params, _ctx) {
          const memoryManager = getMemoryManager();
          if (!memoryManager) {
            return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Memory manager not available' }) }], isError: true };
          }

          const result = await memoryManager.quickRecall(
            params.query as string,
            (params.limit as number) ?? 10,
          );

          return json({
            success: true,
            memories: result.memories,
            total: result.total,
            returned: result.returned,
            shadAvailable: result.shadAvailable,
            message: result.message,
          });
        },
      },
      { group: 'memory' },
    );

    // =========================================================================
    // 5. agid_gc_legacy_tokens — Spend legacy hex-format memory tokens
    // =========================================================================
    api.registerTool(
      {
        name: 'agid_gc_legacy_tokens',
        description:
          'Find and spend legacy memory tokens that use the old hex-format UHRP URLs ' +
          '(uhrp://{hex}). These tokens cannot be downloaded and should be cleaned up. ' +
          'Returns the count of tokens found and spent.',
        parameters: {
          type: 'object',
          properties: {
            dryRun: { type: 'boolean', description: 'If true, only count legacy tokens without spending them (default: false)' },
          },
          required: [],
        },
        requiresWallet: true,
        async execute(_id, params, ctx) {
          const wallet = ctx?.wallet;
          if (!wallet) return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Wallet not available' }) }], isError: true };

          const dryRun = (params.dryRun as boolean) ?? false;
          const underlyingWallet = wallet.getUnderlyingWallet?.();
          if (!underlyingWallet) return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Wallet not initialized' }) }], isError: true };

          const legacyHexPattern = /^uhrp:\/\/[0-9a-f]{64}$/i;

          // List all memory tokens
          const result = await underlyingWallet.listOutputs({
            basket: 'agid-memory',
            tags: ['agid memory'],
            include: 'locking scripts',
            includeCustomInstructions: true,
          });

          const legacyTokens: Array<{ outpoint: string; lockingScript: string; satoshis: number }> = [];

          for (const output of result.outputs) {
            if (!output.spendable || !output.lockingScript) continue;
            try {
              const decoded = PushDrop.decode(LockingScript.fromHex(output.lockingScript), 'before');
              const uhrpUrl = new TextDecoder().decode(new Uint8Array(decoded.fields[0]));
              if (legacyHexPattern.test(uhrpUrl)) {
                legacyTokens.push({
                  outpoint: output.outpoint,
                  lockingScript: output.lockingScript,
                  satoshis: output.satoshis,
                });
              }
            } catch {
              // Skip tokens that can't be decoded
            }
          }

          if (legacyTokens.length === 0) {
            return json({ found: 0, spent: 0, message: 'No legacy hex-format tokens found' });
          }

          if (dryRun) {
            return json({ found: legacyTokens.length, spent: 0, dryRun: true, outpoints: legacyTokens.map(t => t.outpoint) });
          }

          // Spend legacy tokens
          let spent = 0;
          const errors: string[] = [];

          for (const token of legacyTokens) {
            try {
              const pushDrop = new PushDrop(underlyingWallet);
              const unlockInfo = pushDrop.unlock(
                [2, 'agid memory'],
                '1',
                'self',
                'all',
                false,
                token.satoshis,
                LockingScript.fromHex(token.lockingScript),
              );
              const dummyTx = new Transaction();
              const unlockingScript = await unlockInfo.sign(dummyTx, 0);

              await wallet.createAction({
                description: 'GC: Spend legacy hex-format memory token',
                inputs: [{
                  outpoint: token.outpoint,
                  unlockingScript: unlockingScript.toHex(),
                  inputDescription: 'Legacy hex-format memory token',
                }],
                outputs: [],
              });
              spent++;
            } catch (err) {
              errors.push(`${token.outpoint}: ${err instanceof Error ? err.message : String(err)}`);
            }
          }

          return json({ found: legacyTokens.length, spent, errors: errors.length > 0 ? errors : undefined });
        },
      },
      { group: 'memory' },
    );
  },
});
