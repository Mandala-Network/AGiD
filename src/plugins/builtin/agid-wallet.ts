/**
 * AGiD Wallet Plugin
 *
 * Transaction, payment, and PushDrop token tools.
 */

import { definePluginEntry } from '../define-plugin-entry.js';
import { lockPushDropToken, decodePushDropToken, unlockPushDropToken } from '../../wallet/pushdrop-ops.js';

function json(data: Record<string, unknown>) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

function error(message: string) {
  return { content: [{ type: 'text' as const, text: JSON.stringify({ error: message }, null, 2) }], isError: true as const };
}

export const agidWalletPlugin = definePluginEntry({
  id: 'agid-wallet',
  name: 'AGiD Wallet',
  register(api) {
    // --- agid_create_action ---
    api.registerTool(
      {
        name: 'agid_create_action',
        description: 'Create a BSV transaction (BRC-100 createAction). Supports outputs with baskets and tags.',
        parameters: {
          type: 'object',
          properties: {
            description: { type: 'string', description: 'Transaction description' },
            outputs: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  lockingScript: { type: 'string' },
                  satoshis: { type: 'number' },
                  description: { type: 'string' },
                  basket: { type: 'string' },
                  tags: { type: 'array', items: { type: 'string' } },
                },
              },
              description: 'Transaction outputs',
            },
            labels: { type: 'array', items: { type: 'string' }, description: 'Transaction labels' },
          },
          required: ['description'],
        },
        requiresWallet: true,
        async execute(_id, params, ctx) {
          const wallet = ctx?.wallet;
          if (!wallet) return error('Wallet not available');
          const underlyingWallet = wallet.getUnderlyingWallet();
          if (!underlyingWallet) return error('Wallet not available');
          const result = await underlyingWallet.createAction({
            description: params.description as string,
            outputs: (params.outputs as any[])?.map((o: any) => ({
              lockingScript: o.lockingScript,
              satoshis: o.satoshis,
              outputDescription: o.description || 'token output',
              basket: o.basket,
              tags: o.tags,
            })),
            labels: params.labels as string[] | undefined,
            options: { acceptDelayedBroadcast: false },
          });
          return json({ txid: result.txid });
        },
      },
      { group: 'wallet' },
    );

    // --- agid_internalize_action ---
    api.registerTool(
      {
        name: 'agid_internalize_action',
        description: 'Accept an incoming transaction (BEEF format) into the wallet',
        parameters: {
          type: 'object',
          properties: {
            tx: { type: 'object', description: 'Transaction object with rawTx (hex) and optional txid' },
            outputs: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  outputIndex: { type: 'number' },
                  protocol: { type: 'string' },
                  paymentRemittance: { type: 'object' },
                  insertionRemittance: { type: 'object' },
                },
              },
            },
            description: { type: 'string' },
          },
          required: ['tx', 'outputs'],
        },
        requiresWallet: true,
        async execute(_id, params, ctx) {
          const wallet = ctx?.wallet;
          if (!wallet) return error('Wallet not available');
          const underlyingWallet = wallet.getUnderlyingWallet();
          if (!underlyingWallet) return error('Wallet not available');
          const result = await (underlyingWallet as any).internalizeAction({
            tx: params.tx,
            outputs: params.outputs,
            description: (params.description as string) ?? 'Internalize action',
          });
          return json({ accepted: result?.accepted ?? true, txid: result?.txid });
        },
      },
      { group: 'wallet' },
    );

    // --- agid_list_outputs ---
    api.registerTool(
      {
        name: 'agid_list_outputs',
        description: 'List wallet outputs (UTXOs), optionally filtered by basket and tags',
        parameters: {
          type: 'object',
          properties: {
            basket: { type: 'string', description: 'Basket name (default: default)' },
            tags: { type: 'array', items: { type: 'string' }, description: 'Filter by tags' },
            include: { type: 'string', description: '"locking scripts" or "entire transactions"' },
            limit: { type: 'number', description: 'Max results (default: 25)' },
            offset: { type: 'number', description: 'Skip results (default: 0)' },
          },
          required: [],
        },
        requiresWallet: false,
        async execute(_id, params, ctx) {
          const wallet = ctx?.wallet;
          if (!wallet) return error('Wallet not available');
          const underlyingWallet = wallet.getUnderlyingWallet();
          if (!underlyingWallet) return error('Wallet not available');
          const result = await (underlyingWallet as any).listOutputs({
            basket: (params.basket as string) ?? 'default',
            tags: params.tags as string[] | undefined,
            include: (params.include as string) ?? 'locking scripts',
            limit: (params.limit as number) ?? 25,
            offset: (params.offset as number) ?? 0,
          });
          return json({ totalOutputs: result?.totalOutputs ?? 0, outputs: result?.outputs ?? [] });
        },
      },
      { group: 'wallet' },
    );

    // --- agid_send_payment ---
    api.registerTool(
      {
        name: 'agid_send_payment',
        description: 'Send a BSV payment to another identity via PeerPay',
        parameters: {
          type: 'object',
          properties: {
            recipient: { type: 'string', description: 'Recipient public key (33-byte hex)' },
            amount: { type: 'number', description: 'Amount in satoshis' },
          },
          required: ['recipient', 'amount'],
        },
        requiresWallet: true,
        async execute(_id, params, ctx) {
          const wallet = ctx?.wallet;
          if (!wallet) return error('Wallet not available');
          const ppClient = wallet.getPeerPayClient();
          if (!ppClient) return error('PeerPay not initialized');
          await ppClient.sendPayment({
            recipient: params.recipient as string,
            amount: params.amount as number,
          });
          return json({ recipient: params.recipient as string, amount: params.amount as number, sent: true });
        },
      },
      { group: 'wallet' },
    );

    // --- agid_token_create ---
    api.registerTool(
      {
        name: 'agid_token_create',
        description: 'Create a raw on-chain PushDrop token with arbitrary data fields. NOT for memories — use agid_store_memory instead, which handles encryption, UHRP upload, and proper memory indexing.',
        parameters: {
          type: 'object',
          properties: {
            fields: { type: 'array', items: { type: 'string' }, description: 'Data fields to store in the token' },
            protocol: { type: 'string', description: 'Protocol name (default: agidentity token)' },
            keyId: { type: 'string', description: 'Key identifier (default: default)' },
            basket: { type: 'string', description: 'Wallet basket name (default: tokens)' },
          },
          required: ['fields'],
        },
        requiresWallet: true,
        async execute(_id, params, ctx) {
          const wallet = ctx?.wallet;
          if (!wallet) return error('Wallet not available');
          const fields = params.fields as string[];
          const protocol = (params.protocol as string) || 'agidentity token';
          const keyId = (params.keyId as string) || 'default';
          const basket = (params.basket as string) || 'tokens';
          const result = await lockPushDropToken(wallet, {
            fields,
            protocolID: [2, protocol],
            keyID: keyId,
            basket,
            description: `Token: ${fields[0]?.substring(0, 30) || 'unnamed'}`,
          });
          return json({ txid: result.txid, vout: result.vout, satoshis: result.satoshis, fields, basket, created: true });
        },
      },
      { group: 'wallet' },
    );

    // --- agid_token_list ---
    api.registerTool(
      {
        name: 'agid_token_list',
        description: 'List PushDrop tokens from a wallet basket',
        parameters: {
          type: 'object',
          properties: {
            basket: { type: 'string', description: 'Basket name to query (default: tokens)' },
          },
          required: [],
        },
        requiresWallet: false,
        async execute(_id, params, ctx) {
          const wallet = ctx?.wallet;
          if (!wallet) return error('Wallet not available');
          const basket = (params.basket as string) || 'tokens';
          const underlyingWallet = wallet.getUnderlyingWallet();
          if (!underlyingWallet) return error('Wallet not initialized');
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
          return json({ tokens, total: tokens.length, basket });
        },
      },
      { group: 'wallet' },
    );

    // --- agid_token_redeem ---
    api.registerTool(
      {
        name: 'agid_token_redeem',
        description: 'Redeem (spend) a PushDrop token to reclaim its satoshis',
        parameters: {
          type: 'object',
          properties: {
            txid: { type: 'string', description: 'Transaction ID of the token' },
            vout: { type: 'number', description: 'Output index (default: 0)' },
            protocol: { type: 'string', description: 'Protocol name (default: agidentity token)' },
            keyId: { type: 'string', description: 'Key identifier (default: default)' },
          },
          required: ['txid'],
        },
        requiresWallet: true,
        async execute(_id, params, ctx) {
          const wallet = ctx?.wallet;
          if (!wallet) return error('Wallet not available');
          const underlyingWallet = wallet.getUnderlyingWallet();
          if (!underlyingWallet) return error('Wallet not initialized');
          const result = await unlockPushDropToken(underlyingWallet, {
            txid: params.txid as string,
            vout: (params.vout as number) ?? 0,
            protocolID: [2, (params.protocol as string) || 'agidentity token'],
            keyID: (params.keyId as string) || 'default',
          });
          return json({ txid: result.txid, satoshis: result.satoshis, redeemed: true });
        },
      },
      { group: 'wallet' },
    );
  },
});
