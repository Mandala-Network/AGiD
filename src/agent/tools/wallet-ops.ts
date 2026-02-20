import type { ToolDescriptor } from './types.js';
import { ok } from './types.js';

export function walletOpsTools(): ToolDescriptor[] {
  return [
    {
      definition: {
        name: 'agid_sign',
        description: 'Sign a message with your wallet to prove you created it',
        input_schema: {
          type: 'object',
          properties: {
            message: { type: 'string', description: 'Message to sign' },
            protocol: { type: 'string', description: 'Protocol identifier (default: agent message)' },
          },
          required: ['message'],
        },
      },
      requiresWallet: true,
      execute: async (params, ctx) => {
        const message = params.message as string;
        const protocol = (params.protocol as string) || 'agent message';
        const data = Array.from(Buffer.from(message, 'utf8'));
        const result = await ctx.wallet.createSignature({
          data,
          protocolID: [0, protocol],
          keyID: '1',
          counterparty: 'self',
        });
        const signature = Buffer.from(result.signature).toString('hex');
        return ok({ message, signature, signed: true });
      },
    },
    {
      definition: {
        name: 'agid_encrypt',
        description: 'Encrypt data for secure storage or communication',
        input_schema: {
          type: 'object',
          properties: {
            data: { type: 'string', description: 'Data to encrypt' },
            protocol: { type: 'string', description: 'Protocol identifier (default: agent memory)' },
            keyId: { type: 'string', description: 'Key identifier (default: default)' },
            counterparty: { type: 'string', description: 'Counterparty public key or "self" (default: self)' },
          },
          required: ['data'],
        },
      },
      requiresWallet: true,
      execute: async (params, ctx) => {
        const { data, protocol = 'agent memory', keyId = 'default', counterparty = 'self' } = params as Record<string, string>;
        const plaintext = Array.from(Buffer.from(data, 'utf8'));
        const result = await ctx.wallet.encrypt({
          plaintext,
          protocolID: [0, protocol],
          keyID: keyId,
          counterparty,
        });
        const ciphertext = Buffer.from(result.ciphertext as number[]).toString('hex');
        return ok({ ciphertext, encrypted: true });
      },
    },
    {
      definition: {
        name: 'agid_decrypt',
        description: 'Decrypt previously encrypted data',
        input_schema: {
          type: 'object',
          properties: {
            ciphertext: { type: 'string', description: 'Hex-encoded ciphertext' },
            protocol: { type: 'string', description: 'Protocol identifier (default: agent memory)' },
            keyId: { type: 'string', description: 'Key identifier (default: default)' },
            counterparty: { type: 'string', description: 'Counterparty public key or "self" (default: self)' },
          },
          required: ['ciphertext'],
        },
      },
      requiresWallet: true,
      execute: async (params, ctx) => {
        const { ciphertext, protocol = 'agent memory', keyId = 'default', counterparty = 'self' } = params as Record<string, string>;
        const ciphertextBytes = Array.from(Buffer.from(ciphertext, 'hex'));
        const result = await ctx.wallet.decrypt({
          ciphertext: ciphertextBytes,
          protocolID: [0, protocol],
          keyID: keyId,
          counterparty,
        });
        const plaintext = Buffer.from(result.plaintext as number[]).toString('utf8');
        return ok({ plaintext, decrypted: true });
      },
    },
  ];
}
