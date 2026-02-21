import { lockPushDropToken, decodePushDropToken, unlockPushDropToken } from '../../wallet/pushdrop-ops.js';
import type { ToolDescriptor } from './types.js';
import { ok } from './types.js';

export function tokenTools(): ToolDescriptor[] {
  return [
    {
      definition: {
        name: 'agid_token_create',
        description: 'Create a raw on-chain PushDrop token with arbitrary data fields. NOT for memories — use agid_store_memory instead, which handles encryption, UHRP upload, and proper memory indexing.',
        input_schema: {
          type: 'object',
          properties: {
            fields: { type: 'array', items: { type: 'string' }, description: 'Data fields to store in the token' },
            protocol: { type: 'string', description: 'Protocol name (default: agidentity token)' },
            keyId: { type: 'string', description: 'Key identifier (default: default)' },
            basket: { type: 'string', description: 'Wallet basket name (default: tokens)' },
          },
          required: ['fields'],
        },
      },
      requiresWallet: true,
      execute: async (params, ctx) => {
        const fields = params.fields as string[];
        const protocol = (params.protocol as string) || 'agidentity token';
        const keyId = (params.keyId as string) || 'default';
        const basket = (params.basket as string) || 'tokens';
        const result = await lockPushDropToken(ctx.wallet, {
          fields,
          protocolID: [2, protocol],
          keyID: keyId,
          basket,
          description: `Token: ${fields[0]?.substring(0, 30) || 'unnamed'}`,
        });
        return ok({ txid: result.txid, vout: result.vout, satoshis: result.satoshis, fields, basket, created: true });
      },
    },
    {
      definition: {
        name: 'agid_token_list',
        description: 'List PushDrop tokens from a wallet basket',
        input_schema: {
          type: 'object',
          properties: {
            basket: { type: 'string', description: 'Basket name to query (default: tokens)' },
          },
          required: [],
        },
      },
      requiresWallet: false,
      execute: async (params, ctx) => {
        const basket = (params.basket as string) || 'tokens';
        const underlyingWallet = ctx.wallet.getUnderlyingWallet();
        if (!underlyingWallet) throw new Error('Wallet not initialized');
        const result = await underlyingWallet.listOutputs({
          basket,
          tags: ['pushdrop'],
          include: 'locking scripts',
        });
        const tokens = (result.outputs as any[])
          .filter((o: any) => o.spendable && o.lockingScript)
          .map((o: any) => {
            try {
              const decoded = decodePushDropToken(o.lockingScript);
              return { outpoint: o.outpoint, satoshis: o.satoshis, fields: decoded.fields };
            } catch {
              return { outpoint: o.outpoint, satoshis: o.satoshis, fields: ['[decode error]'] };
            }
          });
        return ok({ tokens, total: tokens.length, basket });
      },
    },
    {
      definition: {
        name: 'agid_token_redeem',
        description: 'Redeem (spend) a PushDrop token to reclaim its satoshis',
        input_schema: {
          type: 'object',
          properties: {
            txid: { type: 'string', description: 'Transaction ID of the token' },
            vout: { type: 'number', description: 'Output index (default: 0)' },
            protocol: { type: 'string', description: 'Protocol name (default: agidentity token)' },
            keyId: { type: 'string', description: 'Key identifier (default: default)' },
          },
          required: ['txid'],
        },
      },
      requiresWallet: true,
      execute: async (params, ctx) => {
        const underlyingWallet = ctx.wallet.getUnderlyingWallet();
        if (!underlyingWallet) throw new Error('Wallet not initialized');
        const result = await unlockPushDropToken(underlyingWallet, {
          txid: params.txid as string,
          vout: (params.vout as number) ?? 0,
          protocolID: [2, (params.protocol as string) || 'agidentity token'],
          keyID: (params.keyId as string) || 'default',
        });
        return ok({ txid: result.txid, satoshis: result.satoshis, redeemed: true });
      },
    },
  ];
}
