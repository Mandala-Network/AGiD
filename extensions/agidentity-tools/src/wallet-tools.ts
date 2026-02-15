import { Type } from '@sinclair/typebox';
import type { AnyAgentTool } from 'openclaw/plugin-sdk';
import { request } from './api-client.js';

export interface WalletToolsConfig {
  gatewayUrl: string;
}

/**
 * Create wallet tools for OpenClaw
 *
 * These tools interact with the agent's MPC-protected BSV wallet
 * through the AGIdentity gateway HTTP API.
 */
export function createWalletTools(config: WalletToolsConfig): AnyAgentTool[] {
  return [
    // Tool 1: Get wallet balance
    {
      name: 'agid_get_balance',
      label: 'Get Wallet Balance',
      description:
        "Get current BSV wallet balance in satoshis and UTXO count. Use this before creating transactions to ensure sufficient funds. Checks the agent's MPC-protected wallet balance.",
      parameters: Type.Object({}),
      async execute(toolCallId, params, signal) {
        const data = await request(config.gatewayUrl, 'GET', '/wallet/balance');

        return {
          content: [
            {
              type: 'text' as const,
              text: `Balance: ${data.satoshis} satoshis (${data.utxoCount} UTXOs)`,
            },
          ],
          details: data,
        };
      },
    },

    // Tool 2: Create transaction
    {
      name: 'agid_create_transaction',
      label: 'Create BSV Transaction',
      description:
        'Create an unsigned BSV transaction to send satoshis. Returns transaction hex. This does NOT broadcast the transaction - it only creates it. The transaction must be signed and broadcast separately.',
      parameters: Type.Object({
        recipient: Type.String({
          description: 'BSV address (P2PKH starting with 1)',
        }),
        satoshis: Type.Integer({
          description: 'Amount in satoshis (1 BSV = 100,000,000 sats)',
        }),
        data: Type.Optional(
          Type.String({
            description: 'Optional OP_RETURN data (hex, max 100KB)',
          })
        ),
      }),
      async execute(toolCallId, params, signal) {
        const data = await request(config.gatewayUrl, 'POST', '/wallet/create-transaction', params);

        return {
          content: [
            {
              type: 'text' as const,
              text: `Transaction created:\nTXID: ${data.txid}\nSize: ${data.size} bytes\nFee: ${data.fee} satoshis`,
            },
          ],
          details: data,
        };
      },
    },
  ];
}
