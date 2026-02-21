import type { ToolDescriptor } from './types.js';
import { ok } from './types.js';

export function transactionTools(): ToolDescriptor[] {
  return [
    {
      definition: {
        name: 'agid_create_action',
        description: 'Create a BSV transaction (BRC-100 createAction). Supports outputs with baskets and tags.',
        input_schema: {
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
      },
      requiresWallet: true,
      execute: async (params, ctx) => {
        const underlyingWallet = ctx.wallet.getUnderlyingWallet();
        if (!underlyingWallet) throw new Error('Wallet not available');
        const result = await underlyingWallet.createAction({
          description: params.description as string,
          outputs: (params.outputs as any[])?.map((o) => ({
            lockingScript: o.lockingScript,
            satoshis: o.satoshis,
            outputDescription: o.description || 'token output',
            basket: o.basket,
            tags: o.tags,
          })),
          labels: params.labels as string[] | undefined,
          options: { acceptDelayedBroadcast: false },
        });
        return ok({ txid: result.txid });
      },
    },
    {
      definition: {
        name: 'agid_internalize_action',
        description: 'Accept an incoming transaction (BEEF format) into the wallet',
        input_schema: {
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
      },
      requiresWallet: true,
      execute: async (params, ctx) => {
        const underlyingWallet = ctx.wallet.getUnderlyingWallet();
        if (!underlyingWallet) throw new Error('Wallet not available');
        const result = await (underlyingWallet as any).internalizeAction({
          tx: params.tx,
          outputs: params.outputs,
          description: (params.description as string) ?? 'Internalize action',
        });
        return ok({ accepted: result?.accepted ?? true, txid: result?.txid });
      },
    },
    {
      definition: {
        name: 'agid_list_outputs',
        description: 'List wallet outputs (UTXOs), optionally filtered by basket and tags',
        input_schema: {
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
      },
      requiresWallet: false,
      execute: async (params, ctx) => {
        const underlyingWallet = ctx.wallet.getUnderlyingWallet();
        if (!underlyingWallet) throw new Error('Wallet not available');
        const result = await (underlyingWallet as any).listOutputs({
          basket: (params.basket as string) ?? 'default',
          tags: params.tags as string[] | undefined,
          include: (params.include as string) ?? 'locking scripts',
          limit: (params.limit as number) ?? 25,
          offset: (params.offset as number) ?? 0,
        });
        return ok({ totalOutputs: result?.totalOutputs ?? 0, outputs: result?.outputs ?? [] });
      },
    },
    {
      definition: {
        name: 'agid_send_payment',
        description: 'Send a BSV payment to another identity via PeerPay',
        input_schema: {
          type: 'object',
          properties: {
            recipient: { type: 'string', description: 'Recipient public key (33-byte hex)' },
            amount: { type: 'number', description: 'Amount in satoshis' },
          },
          required: ['recipient', 'amount'],
        },
      },
      requiresWallet: true,
      execute: async (params, ctx) => {
        const ppClient = ctx.wallet.getPeerPayClient();
        if (!ppClient) throw new Error('PeerPay not initialized');
        await ppClient.sendPayment({
          recipient: params.recipient as string,
          amount: params.amount as number,
        });
        return ok({ recipient: params.recipient, amount: params.amount, sent: true });
      },
    },
  ];
}
