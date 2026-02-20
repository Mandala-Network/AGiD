import { GepaExecutor } from '../../integrations/gepa/index.js';
import { X402Client } from '../../integrations/x402/index.js';
import { OverlayClient } from '../../integrations/overlay/index.js';
import type { ToolDescriptor } from './types.js';
import { ok } from './types.js';

export function serviceTools(): ToolDescriptor[] {
  return [
    {
      definition: {
        name: 'agid_optimize_prompt',
        description: 'Optimize any text or prompt using GEPA evolutionary optimization.',
        input_schema: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'The text or prompt to optimize' },
            objective: { type: 'string', description: 'What the optimized text should achieve' },
            mode: { type: 'string', description: '"fast" (10 iterations) or "thorough" (30 iterations). Default: fast' },
            storeOnChain: { type: 'boolean', description: 'Store the optimized result on-chain (default: false)' },
          },
          required: ['text', 'objective'],
        },
      },
      requiresWallet: false,
      execute: async (params, ctx) => {
        const text = params.text as string;
        const objective = params.objective as string;
        const mode = (params.mode as string) || 'fast';
        const storeOnChainFlag = params.storeOnChain as boolean ?? false;
        const maxIterations = mode === 'thorough' ? 30 : 10;

        const executor = new GepaExecutor();
        const availability = await executor.checkGepaAvailable();

        if (!availability.available) {
          return ok({ original: text, optimized: null, gepaAvailable: false, error: availability.error ?? 'gepa not installed' });
        }

        const result = await executor.optimize({ text, objective, maxIterations });

        if (!result.success) {
          return ok({ original: text, optimized: null, gepaAvailable: true, error: result.error });
        }

        let stored = false;
        if (storeOnChainFlag && result.optimizedText && ctx.memoryManager) {
          try {
            await ctx.memoryManager.store({ content: result.optimizedText, tags: ['gepa-optimized'], importance: 'medium' });
            stored = true;
          } catch {
            // Non-fatal
          }
        }

        return ok({ original: text, optimized: result.optimizedText, reasoning: result.reasoning, iterations: result.iterations, stored, gepaAvailable: true });
      },
    },
    {
      definition: {
        name: 'agid_discover_services',
        description: 'Discover available x402 AI services from the registry (x402agency.com).',
        input_schema: { type: 'object', properties: {}, required: [] },
      },
      requiresWallet: false,
      execute: async (_params, ctx) => {
        const client = new X402Client(ctx.wallet);
        const services = await client.discoverServices();
        return ok({ services, total: services.length });
      },
    },
    {
      definition: {
        name: 'agid_x402_request',
        description: 'Make an authenticated HTTP request to an x402 service with automatic payment handling.',
        input_schema: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'Full URL to request' },
            method: { type: 'string', description: 'HTTP method (default: GET)' },
            body: { type: 'string', description: 'Request body (for POST/PUT)' },
            headers: { type: 'object', description: 'Additional headers', additionalProperties: { type: 'string' } },
          },
          required: ['url'],
        },
      },
      requiresWallet: true,
      execute: async (params, ctx) => {
        const client = new X402Client(ctx.wallet);
        const result = await client.request(params.url as string, {
          method: (params.method as string) || 'GET',
          body: params.body as string | undefined,
          headers: params.headers as Record<string, string> | undefined,
        });
        return ok({ status: result.status, headers: result.headers, body: result.body, paid: result.paid });
      },
    },
    {
      definition: {
        name: 'agid_overlay_lookup',
        description: 'Query any BSV overlay network via SHIP/SLAP. Use service "ls_slap" with empty query to list all available services.',
        input_schema: {
          type: 'object',
          properties: {
            service: { type: 'string', description: 'Lookup service name (e.g. "ls_identity", "ls_slap")' },
            query: { type: 'object', description: 'Service-specific query object', additionalProperties: true },
          },
          required: ['service'],
        },
      },
      requiresWallet: false,
      execute: async (params) => {
        const service = params.service as string;
        const query = (params.query as Record<string, unknown>) ?? {};
        const client = new OverlayClient();
        const outputs = await client.query(service, query);
        return ok({ service, outputs, total: outputs.length });
      },
    },
  ];
}
