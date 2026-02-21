import { IdentityClient } from '@bsv/sdk';
import type { ToolDescriptor } from './types.js';
import { ok } from './types.js';

export function identityTools(): ToolDescriptor[] {
  return [
    {
      definition: {
        name: 'agid_identity',
        description: 'Get your cryptographic identity (BSV public key, network, balance)',
        input_schema: { type: 'object', properties: {}, required: [] },
      },
      requiresWallet: false,
      execute: async (_params, ctx) => {
        const identity = await ctx.wallet.getPublicKey({ identityKey: true });
        const network = await ctx.wallet.getNetwork();
        const messageBoxEnabled = !!ctx.wallet.getMessageBoxClient();
        return ok({ publicKey: identity.publicKey, network, messageBoxEnabled });
      },
    },
    {
      definition: {
        name: 'agid_balance',
        description: 'Check your BSV wallet balance in satoshis',
        input_schema: { type: 'object', properties: {}, required: [] },
      },
      requiresWallet: false,
      execute: async (_params, ctx) => {
        const balance = await ctx.wallet.getBalanceAndUtxos();
        const network = await ctx.wallet.getNetwork();
        return ok({ balance: balance.total, utxos: balance.utxos?.length || 0, network });
      },
    },
    {
      definition: {
        name: 'agid_get_public_key',
        description: 'Derive a protocol-specific public key (BRC-42 key derivation)',
        input_schema: {
          type: 'object',
          properties: {
            identityKey: { type: 'boolean', description: 'Return identity key (default: false)' },
            securityLevel: { type: 'number', description: 'Security level: 0=public, 1=app-wide, 2=per-counterparty' },
            protocolName: { type: 'string', description: 'Protocol name for derivation' },
            keyID: { type: 'string', description: 'Key identifier' },
            counterparty: { type: 'string', description: 'Counterparty public key' },
          },
          required: [],
        },
      },
      requiresWallet: false,
      execute: async (params, ctx) => {
        const result = await ctx.wallet.getPublicKey({
          identityKey: params.identityKey as boolean | undefined,
          protocolID: params.protocolName
            ? [params.securityLevel as number ?? 0, params.protocolName as string]
            : undefined,
          keyID: params.keyID as string | undefined,
          counterparty: params.counterparty as string | undefined,
        });
        return ok({ publicKey: result.publicKey });
      },
    },
    {
      definition: {
        name: 'agid_get_height',
        description: 'Get the current BSV blockchain block height',
        input_schema: { type: 'object', properties: {}, required: [] },
      },
      requiresWallet: false,
      execute: async (_params, ctx) => {
        const height = await ctx.wallet.getHeight();
        return ok({ height });
      },
    },
    {
      definition: {
        name: 'agid_lookup_identity',
        description:
          'Look up a person on the BSV identity overlay by name or other attributes. Returns their identity key and profile info. Use this to find someone before sending them a payment.',
        input_schema: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: 'Person name to search for (e.g. "brayden", "Brayden Langley")',
            },
            email: { type: 'string', description: 'Email address to search for' },
            phoneNumber: { type: 'string', description: 'Phone number to search for' },
          },
          required: [],
        },
      },
      requiresWallet: false,
      execute: async (params, ctx) => {
        const attributes: Record<string, string> = {};
        if (params.name) attributes.name = params.name as string;
        if (params.email) attributes.email = params.email as string;
        if (params.phoneNumber) attributes.phoneNumber = params.phoneNumber as string;

        if (Object.keys(attributes).length === 0) {
          return ok({ error: 'At least one attribute (name, email, phoneNumber) must be provided' });
        }

        const client = new IdentityClient(ctx.wallet.asWalletInterface() as any);
        const results = await client.resolveByAttributes({ attributes, seekPermission: false });

        return ok({
          matches: results.map((r) => ({
            name: r.name,
            identityKey: r.identityKey,
            abbreviatedKey: r.abbreviatedKey,
            avatarURL: r.avatarURL,
            badgeLabel: r.badgeLabel,
          })),
          count: results.length,
        });
      },
    },
  ];
}
