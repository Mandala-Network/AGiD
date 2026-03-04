/**
 * X/Twitter Research Tools
 *
 * Typed tool wrappers for the X Research Agent service at x402agency.com.
 * Uses x402 authenticated+paid requests under the hood.
 */

import { X402Client } from '../../integrations/x402/index.js';
import type { ToolDescriptor, ToolContext } from './types.js';
import { ok } from './types.js';

const BASE_URL = 'https://x-research.x402agency.com';

interface XResearchResponse {
  ok: boolean;
  data: Record<string, unknown>;
  paid: boolean;
  refund?: string;
}

async function callXResearch(
  ctx: ToolContext,
  endpoint: string,
  params: Record<string, unknown>
): Promise<XResearchResponse> {
  const client = new X402Client(ctx.wallet);
  const result = await client.request(`${BASE_URL}${endpoint}`, {
    method: 'POST',
    body: JSON.stringify(params),
    headers: { 'Content-Type': 'application/json' },
  });

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(result.body);
  } catch {
    data = { raw: result.body };
  }

  const isError = result.status >= 400 || data.service_failure === true;
  const refund = typeof data.refund === 'string' ? data.refund : undefined;

  return { ok: !isError, data, paid: result.paid, refund };
}

function formatError(resp: XResearchResponse, action: string): { content: string; isError: true } {
  const msg = typeof resp.data.error === 'string' ? resp.data.error : JSON.stringify(resp.data);
  const refundNote = resp.refund ? ` Refund info: ${resp.refund}` : '';
  return { content: `${action} failed: ${msg}${refundNote}`, isError: true };
}

export function xResearchTools(): ToolDescriptor[] {
  return [
    {
      definition: {
        name: 'agid_x_search',
        description:
          'Search recent tweets on X/Twitter with engagement filtering, pagination, and time filtering. ' +
          'Returns matching tweets with full metrics. Paid via x402.',
        input_schema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query (supports Twitter search operators)' },
            sort: {
              type: 'string',
              description: 'Sort order: likes, retweets, views, or recent (default: recent)',
              enum: ['likes', 'retweets', 'views', 'recent'],
            },
            pages: {
              type: 'number',
              description: 'Number of pages to fetch (1-5, default: 1)',
            },
            since: { type: 'string', description: 'Start date filter (YYYY-MM-DD)' },
            until: { type: 'string', description: 'End date filter (YYYY-MM-DD)' },
            limit: {
              type: 'number',
              description: 'Max results to return (1-100, default: 20)',
            },
            quality: { type: 'string', description: 'Quality filter level' },
            format: {
              type: 'string',
              description: 'Response format: json or markdown (default: json)',
              enum: ['json', 'markdown'],
            },
          },
          required: ['query'],
        },
      },
      requiresWallet: true,
      execute: async (params, ctx) => {
        try {
          const body: Record<string, unknown> = { query: params.query };
          if (params.sort !== undefined) body.sort = params.sort;
          if (params.pages !== undefined) body.pages = params.pages;
          if (params.since !== undefined) body.since = params.since;
          if (params.until !== undefined) body.until = params.until;
          if (params.limit !== undefined) body.limit = params.limit;
          if (params.quality !== undefined) body.quality = params.quality;
          if (params.format !== undefined) body.format = params.format;
          const resp = await callXResearch(ctx, '/search', body);
          if (!resp.ok) return formatError(resp, 'Tweet search');
          return ok({ ...resp.data, paid: resp.paid });
        } catch (err) {
          return { content: `Tweet search failed: ${err instanceof Error ? err.message : String(err)}`, isError: true };
        }
      },
    },
    {
      definition: {
        name: 'agid_x_profile',
        description:
          'Look up an X/Twitter user profile and their 20 most recent tweets with full engagement metrics. Paid via x402.',
        input_schema: {
          type: 'object',
          properties: {
            username: { type: 'string', description: 'Twitter/X username (with or without leading @)' },
          },
          required: ['username'],
        },
      },
      requiresWallet: true,
      execute: async (params, ctx) => {
        try {
          const username = (params.username as string).replace(/^@/, '');
          const resp = await callXResearch(ctx, '/profile', { username });
          if (!resp.ok) return formatError(resp, 'Profile lookup');
          return ok({ ...resp.data, paid: resp.paid });
        } catch (err) {
          return { content: `Profile lookup failed: ${err instanceof Error ? err.message : String(err)}`, isError: true };
        }
      },
    },
    {
      definition: {
        name: 'agid_x_thread',
        description:
          'Retrieve a full conversation thread from X/Twitter including the root tweet and up to 100 replies. Paid via x402.',
        input_schema: {
          type: 'object',
          properties: {
            tweet_id: { type: 'string', description: 'ID of any tweet in the thread' },
            sort: {
              type: 'string',
              description: 'Sort replies by: likes, retweets, views, or recent',
              enum: ['likes', 'retweets', 'views', 'recent'],
            },
          },
          required: ['tweet_id'],
        },
      },
      requiresWallet: true,
      execute: async (params, ctx) => {
        try {
          const body: Record<string, unknown> = { tweet_id: params.tweet_id };
          if (params.sort !== undefined) body.sort = params.sort;
          const resp = await callXResearch(ctx, '/thread', body);
          if (!resp.ok) return formatError(resp, 'Thread retrieval');
          return ok({ ...resp.data, paid: resp.paid });
        } catch (err) {
          return { content: `Thread retrieval failed: ${err instanceof Error ? err.message : String(err)}`, isError: true };
        }
      },
    },
    {
      definition: {
        name: 'agid_x_trending',
        description:
          'Get current trending topics on X/Twitter. Common WOEIDs: 1 = Worldwide, 23424977 = US, 23424975 = UK, 23424848 = India. Paid via x402.',
        input_schema: {
          type: 'object',
          properties: {
            woeid: {
              type: 'number',
              description: 'Yahoo WOEID for location (default: 1 = worldwide)',
            },
          },
          required: [],
        },
      },
      requiresWallet: true,
      execute: async (params, ctx) => {
        try {
          const body: Record<string, unknown> = {};
          if (params.woeid !== undefined) body.woeid = params.woeid;
          const resp = await callXResearch(ctx, '/trending', body);
          if (!resp.ok) return formatError(resp, 'Trending lookup');
          return ok({ ...resp.data, paid: resp.paid });
        } catch (err) {
          return { content: `Trending lookup failed: ${err instanceof Error ? err.message : String(err)}`, isError: true };
        }
      },
    },
    {
      definition: {
        name: 'agid_x_tweet',
        description:
          'Retrieve a single tweet by ID with full metrics, entities, and media details. Paid via x402.',
        input_schema: {
          type: 'object',
          properties: {
            tweet_id: { type: 'string', description: 'The tweet ID to look up' },
          },
          required: ['tweet_id'],
        },
      },
      requiresWallet: true,
      execute: async (params, ctx) => {
        try {
          const resp = await callXResearch(ctx, '/tweet', { tweet_id: params.tweet_id });
          if (!resp.ok) return formatError(resp, 'Tweet lookup');
          return ok({ ...resp.data, paid: resp.paid });
        } catch (err) {
          return { content: `Tweet lookup failed: ${err instanceof Error ? err.message : String(err)}`, isError: true };
        }
      },
    },
  ];
}
