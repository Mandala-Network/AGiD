/**
 * AGiD Messaging Plugin
 *
 * MessageBox-based encrypted messaging tools.
 */

import { definePluginEntry } from '../define-plugin-entry.js';

function json(data: Record<string, unknown>) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

export const agidMessagingPlugin = definePluginEntry({
  id: 'agid-messaging',
  name: 'AGiD Messaging',
  register(api) {
    api.registerTool(
      {
        name: 'agid_message_send',
        description: 'Send an encrypted message to a recipient via MessageBox',
        parameters: {
          type: 'object',
          properties: {
            recipient: { type: 'string', description: 'Recipient public key (33-byte hex)' },
            messageBox: { type: 'string', description: 'MessageBox name (default: general)' },
            body: { type: 'string', description: 'Message content (auto-encrypted via BRC-2 ECDH)' },
          },
          required: ['recipient', 'body'],
        },
        requiresWallet: true,
        async execute(_id, params, ctx) {
          const wallet = ctx?.wallet;
          if (!wallet) return json({ error: 'Wallet not available' });
          const recipient = params.recipient as string;
          const messageBox = (params.messageBox as string) || 'general';
          const body = params.body as string;
          const result = await wallet.sendMessage({ recipient, messageBox, body });
          return json({
            messageId: result.messageId,
            status: result.status,
            recipient: recipient.substring(0, 16) + '...',
            messageBox,
            sent: true,
          });
        },
      },
      { group: 'messaging' },
    );

    api.registerTool(
      {
        name: 'agid_message_list',
        description: 'List encrypted messages in a MessageBox (auto-decrypted)',
        parameters: {
          type: 'object',
          properties: {
            messageBox: { type: 'string', description: 'MessageBox name (default: general)' },
          },
        },
        requiresWallet: true,
        async execute(_id, params, ctx) {
          const wallet = ctx?.wallet;
          if (!wallet) return json({ error: 'Wallet not available' });
          const messageBox = (params.messageBox as string) || 'general';
          const messages = await wallet.listMessages({ messageBox });
          return json({
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
      { group: 'messaging' },
    );

    api.registerTool(
      {
        name: 'agid_message_ack',
        description: 'Acknowledge (delete) processed messages from MessageBox',
        parameters: {
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
        requiresWallet: true,
        async execute(_id, params, ctx) {
          const wallet = ctx?.wallet;
          if (!wallet) return json({ error: 'Wallet not available' });
          const messageIds = params.messageIds as string[];
          await wallet.acknowledgeMessages({ messageIds });
          return json({ acknowledged: messageIds.length, success: true });
        },
      },
      { group: 'messaging' },
    );

    api.registerTool(
      {
        name: 'agid_list_payments',
        description: 'List pending incoming payments waiting to be accepted.',
        parameters: { type: 'object', properties: {} },
        requiresWallet: true,
        async execute(_id, _params, ctx) {
          const wallet = ctx?.wallet;
          if (!wallet) return json({ error: 'Wallet not available' });
          const payments = await (wallet as any).listIncomingPayments();
          return json({
            payments: payments.map((p: any) => ({
              messageId: p.messageId,
              sender: p.sender,
              amount: p.token?.amount ?? p.amount ?? 0,
            })),
            total: payments.length,
          });
        },
      },
      { group: 'messaging' },
    );

    api.registerTool(
      {
        name: 'agid_accept_payment',
        description: 'Accept an incoming payment by messageId.',
        parameters: {
          type: 'object',
          properties: {
            messageId: { type: 'string', description: 'Message ID of the payment to accept' },
            sender: { type: 'string', description: 'Sender public key' },
          },
          required: ['messageId', 'sender'],
        },
        requiresWallet: true,
        async execute(_id, params, ctx) {
          const wallet = ctx?.wallet;
          if (!wallet) return json({ error: 'Wallet not available' });
          const payments = await (wallet as any).listIncomingPayments();
          const payment = payments.find((p: any) => p.messageId === params.messageId);
          if (!payment) return json({ error: 'Payment not found', messageId: params.messageId });
          await (wallet as any).acceptPayment(payment);
          return json({
            accepted: true,
            messageId: params.messageId,
            amount: payment.token?.amount ?? payment.amount ?? 0,
          });
        },
      },
      { group: 'messaging' },
    );
  },
});
