/**
 * AGiD Crypto Plugin
 *
 * Cryptographic signing, encryption/decryption, and wallet client tools.
 */

import { HTTPWalletJSON } from '@bsv/sdk';
import { definePluginEntry } from '../define-plugin-entry.js';

function json(data: Record<string, unknown>) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

function error(message: string) {
  return { content: [{ type: 'text' as const, text: JSON.stringify({ error: message }, null, 2) }], isError: true as const };
}

export const agidCryptoPlugin = definePluginEntry({
  id: 'agid-crypto',
  name: 'AGiD Crypto',
  register(api) {
    // --- agid_sign ---
    api.registerTool(
      {
        name: 'agid_sign',
        description: 'Sign a message with your wallet to prove you created it',
        parameters: {
          type: 'object',
          properties: {
            message: { type: 'string', description: 'Message to sign' },
            protocol: { type: 'string', description: 'Protocol identifier (default: agent message)' },
          },
          required: ['message'],
        },
        requiresWallet: true,
        async execute(_id, params, ctx) {
          const wallet = ctx?.wallet;
          if (!wallet) return error('Wallet not available');
          const message = params.message as string;
          const protocol = (params.protocol as string) || 'agent message';
          const data = Array.from(Buffer.from(message, 'utf8'));
          const result = await wallet.createSignature({
            data,
            protocolID: [0, protocol],
            keyID: '1',
            counterparty: 'self',
          });
          const signature = Buffer.from(result.signature).toString('hex');
          return json({ message, signature, signed: true });
        },
      },
      { group: 'crypto' },
    );

    // --- agid_encrypt ---
    api.registerTool(
      {
        name: 'agid_encrypt',
        description: 'Encrypt data for secure storage or communication',
        parameters: {
          type: 'object',
          properties: {
            data: { type: 'string', description: 'Data to encrypt' },
            protocol: { type: 'string', description: 'Protocol identifier (default: agent memory)' },
            keyId: { type: 'string', description: 'Key identifier (default: default)' },
            counterparty: { type: 'string', description: 'Counterparty public key or "self" (default: self)' },
          },
          required: ['data'],
        },
        requiresWallet: true,
        async execute(_id, params, ctx) {
          const wallet = ctx?.wallet;
          if (!wallet) return error('Wallet not available');
          const { data, protocol = 'agent memory', keyId = 'default', counterparty = 'self' } = params as Record<string, string>;
          const plaintext = Array.from(Buffer.from(data, 'utf8'));
          const result = await wallet.encrypt({
            plaintext,
            protocolID: [0, protocol],
            keyID: keyId,
            counterparty,
          });
          const ciphertext = Buffer.from(result.ciphertext as number[]).toString('hex');
          return json({ ciphertext, encrypted: true });
        },
      },
      { group: 'crypto' },
    );

    // --- agid_decrypt ---
    api.registerTool(
      {
        name: 'agid_decrypt',
        description: 'Decrypt previously encrypted data',
        parameters: {
          type: 'object',
          properties: {
            ciphertext: { type: 'string', description: 'Hex-encoded ciphertext' },
            protocol: { type: 'string', description: 'Protocol identifier (default: agent memory)' },
            keyId: { type: 'string', description: 'Key identifier (default: default)' },
            counterparty: { type: 'string', description: 'Counterparty public key or "self" (default: self)' },
          },
          required: ['ciphertext'],
        },
        requiresWallet: true,
        async execute(_id, params, ctx) {
          const wallet = ctx?.wallet;
          if (!wallet) return error('Wallet not available');
          const { ciphertext, protocol = 'agent memory', keyId = 'default', counterparty = 'self' } = params as Record<string, string>;
          const ciphertextBytes = Array.from(Buffer.from(ciphertext, 'hex'));
          const result = await wallet.decrypt({
            ciphertext: ciphertextBytes,
            protocolID: [0, protocol],
            keyID: keyId,
            counterparty,
          });
          const plaintext = Buffer.from(result.plaintext as number[]).toString('utf8');
          return json({ plaintext, decrypted: true });
        },
      },
      { group: 'crypto' },
    );

    // --- agid_wallet_client_request ---
    api.registerTool(
      {
        name: 'agid_wallet_client_request',
        description:
          'Request the USER\'s wallet client to perform a cryptographic operation. Use when you need the user\'s key or signature, not your own agent key.',
        parameters: {
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
        requiresWallet: false,
        async execute(_id, params, _ctx) {
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
            return error(`Invalid operation: ${operation}. Valid: ${validOps.join(', ')}`);
          }

          try {
            const client = new HTTPWalletJSON(undefined, url);
            const method = client[operation as keyof typeof client] as Function;
            const result = await method.call(client, opParams);
            return json(result as Record<string, unknown>);
          } catch (err) {
            return error(`Wallet client error (${url}): ${err instanceof Error ? err.message : String(err)}`);
          }
        },
      },
      { group: 'crypto' },
    );

    // --- agid_request_user_signature ---
    api.registerTool(
      {
        name: 'agid_request_user_signature',
        description:
          'Request the user to sign data with their wallet. Use to prove USER authorship. Returns the user\'s signature as hex.',
        parameters: {
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
        requiresWallet: false,
        async execute(_id, params, _ctx) {
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
            return json({ data, signature, signed: true });
          } catch (err) {
            return error(`Wallet client error (${url}): ${err instanceof Error ? err.message : String(err)}`);
          }
        },
      },
      { group: 'crypto' },
    );
  },
});
