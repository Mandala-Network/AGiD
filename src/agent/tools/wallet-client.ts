import { HTTPWalletJSON } from '@bsv/sdk';
import type { ToolDescriptor } from './types.js';
import { ok } from './types.js';

export function walletClientTools(): ToolDescriptor[] {
  return [
    {
      definition: {
        name: 'agid_wallet_client_request',
        description:
          'Request the USER\'s wallet client to perform a cryptographic operation. Use when you need the user\'s key or signature, not your own agent key.',
        input_schema: {
          type: 'object',
          properties: {
            operation: {
              type: 'string',
              description:
                'Operation to perform: createSignature, getPublicKey, encrypt, decrypt, createHmac, verifySignature, verifyHmac',
            },
            params: {
              type: 'object',
              description: 'Operation-specific arguments matching the BRC-100 method signature',
            },
            walletClientUrl: {
              type: 'string',
              description:
                'URL of the wallet client HTTP server (default: AGID_WALLET_CLIENT_URL env or http://localhost:3301)',
            },
          },
          required: ['operation', 'params'],
        },
      },
      requiresWallet: false,
      category: 'crypto',
      execute: async (params, _ctx) => {
        const url =
          (params.walletClientUrl as string) ||
          process.env.AGID_WALLET_CLIENT_URL ||
          'http://localhost:3301';
        const operation = params.operation as string;
        const opParams = params.params as Record<string, unknown>;

        const validOps = [
          'createSignature',
          'getPublicKey',
          'encrypt',
          'decrypt',
          'createHmac',
          'verifySignature',
          'verifyHmac',
        ];
        if (!validOps.includes(operation)) {
          return {
            content: JSON.stringify({
              error: `Invalid operation: ${operation}. Valid: ${validOps.join(', ')}`,
            }),
            isError: true,
          };
        }

        try {
          const client = new HTTPWalletJSON(undefined, url);
          const method = client[operation as keyof typeof client] as Function;
          const result = await method.call(client, opParams);
          return ok(result as Record<string, unknown>);
        } catch (error) {
          return {
            content: JSON.stringify({
              error: `Wallet client error (${url}): ${error instanceof Error ? error.message : String(error)}`,
            }),
            isError: true,
          };
        }
      },
    },
    {
      definition: {
        name: 'agid_request_user_signature',
        description:
          'Request the user to sign data with their wallet. Use to prove USER authorship. Returns the user\'s signature as hex.',
        input_schema: {
          type: 'object',
          properties: {
            data: {
              type: 'string',
              description: 'Hex-encoded data to sign',
            },
            protocolID: {
              type: 'array',
              description: '[securityLevel, protocolName] tuple (default: [0, "user authorship"])',
            },
            keyID: {
              type: 'string',
              description: 'Key derivation ID (default: "1")',
            },
            counterparty: {
              type: 'string',
              description: 'Counterparty public key (default: "self")',
            },
            walletClientUrl: {
              type: 'string',
              description:
                'URL of the wallet client HTTP server (default: AGID_WALLET_CLIENT_URL env or http://localhost:3301)',
            },
          },
          required: ['data'],
        },
      },
      requiresWallet: false,
      category: 'crypto',
      execute: async (params, _ctx) => {
        const url =
          (params.walletClientUrl as string) ||
          process.env.AGID_WALLET_CLIENT_URL ||
          'http://localhost:3301';
        const data = params.data as string;
        const protocolID = (params.protocolID as [0 | 1 | 2, string]) || [0 as const, 'user authorship'];
        const keyID = (params.keyID as string) || '1';
        const counterparty = (params.counterparty as string) || 'self';

        try {
          const client = new HTTPWalletJSON(undefined, url);
          const result = await client.createSignature({
            data: Array.from(Buffer.from(data, 'hex')),
            protocolID,
            keyID,
            counterparty,
          });
          const signature = Buffer.from(result.signature).toString('hex');
          return ok({ data, signature, signed: true });
        } catch (error) {
          return {
            content: JSON.stringify({
              error: `Wallet client error (${url}): ${error instanceof Error ? error.message : String(error)}`,
            }),
            isError: true,
          };
        }
      },
    },
  ];
}
