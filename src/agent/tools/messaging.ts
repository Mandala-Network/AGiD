import type { ToolDescriptor } from './types.js';
import { ok } from './types.js';

export function messagingTools(): ToolDescriptor[] {
  return [
    {
      definition: {
        name: 'agid_message_send',
        description: 'Send an encrypted message to a recipient via MessageBox',
        input_schema: {
          type: 'object',
          properties: {
            recipient: { type: 'string', description: 'Recipient public key (33-byte hex)' },
            messageBox: { type: 'string', description: 'MessageBox name (default: general)' },
            body: { type: 'string', description: 'Message content (auto-encrypted via BRC-2 ECDH)' },
          },
          required: ['recipient', 'body'],
        },
      },
      requiresWallet: true,
      execute: async (params, ctx) => {
        const recipient = params.recipient as string;
        const messageBox = (params.messageBox as string) || 'general';
        const body = params.body as string;
        const result = await ctx.wallet.sendMessage({ recipient, messageBox, body });
        return ok({
          messageId: result.messageId,
          status: result.status,
          recipient: recipient.substring(0, 16) + '...',
          messageBox,
          sent: true,
        });
      },
    },
    {
      definition: {
        name: 'agid_message_list',
        description: 'List encrypted messages in a MessageBox (auto-decrypted)',
        input_schema: {
          type: 'object',
          properties: {
            messageBox: { type: 'string', description: 'MessageBox name (default: general)' },
          },
          required: [],
        },
      },
      requiresWallet: false,
      execute: async (params, ctx) => {
        const messageBox = (params.messageBox as string) || 'general';
        const messages = await ctx.wallet.listMessages({ messageBox });
        return ok({
          messages: messages.map((m: any) => ({
            messageId: m.messageId,
            sender: m.sender,
            body: m.body,
            createdAt: m.created_at ?? m.createdAt,
          })),
          total: messages.length,
          messageBox,
        });
      },
    },
    {
      definition: {
        name: 'agid_message_ack',
        description: 'Acknowledge (delete) processed messages from MessageBox',
        input_schema: {
          type: 'object',
          properties: {
            messageIds: {
              type: 'array',
              items: { type: 'string' },
              description: 'Message IDs to acknowledge',
            },
          },
          required: ['messageIds'],
        },
      },
      requiresWallet: true,
      execute: async (params, ctx) => {
        const messageIds = params.messageIds as string[];
        await ctx.wallet.acknowledgeMessages({ messageIds });
        return ok({ acknowledged: messageIds.length, success: true });
      },
    },
  ];
}
