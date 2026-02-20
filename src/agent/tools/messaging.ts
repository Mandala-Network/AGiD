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
    {
      definition: {
        name: 'agid_list_payments',
        description: 'List pending incoming payments waiting to be accepted. Returns payment details (sender, amount, messageId).',
        input_schema: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
      requiresWallet: true,
      execute: async (_params, ctx) => {
        const payments = await (ctx.wallet as any).listIncomingPayments();
        return ok({
          payments: payments.map((p: any) => ({
            messageId: p.messageId,
            sender: p.sender,
            amount: p.token?.amount ?? p.amount ?? 0,
          })),
          total: payments.length,
        });
      },
    },
    {
      definition: {
        name: 'agid_accept_payment',
        description: 'Accept an incoming payment by messageId. This internalizes the transaction and adds the funds to the wallet balance.',
        input_schema: {
          type: 'object',
          properties: {
            messageId: { type: 'string', description: 'Message ID of the payment to accept' },
            sender: { type: 'string', description: 'Sender public key' },
          },
          required: ['messageId', 'sender'],
        },
      },
      requiresWallet: true,
      execute: async (params, ctx) => {
        const payments = await (ctx.wallet as any).listIncomingPayments();
        const payment = payments.find((p: any) => p.messageId === params.messageId);
        if (!payment) return ok({ error: 'Payment not found', messageId: params.messageId });
        await (ctx.wallet as any).acceptPayment(payment);
        return ok({
          accepted: true,
          messageId: params.messageId,
          amount: payment.token?.amount ?? payment.amount ?? 0,
        });
      },
    },
  ];
}
