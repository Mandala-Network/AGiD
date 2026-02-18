#!/usr/bin/env npx tsx
/**
 * Internalize pending PeerPay payments into the MPC wallet.
 * Run standalone (no concurrent signing) to avoid MPC race conditions.
 */
import 'dotenv/config';
import { createProductionMPCWallet, loadMPCConfigFromEnv } from '../src/01-core/wallet/mpc-integration.js';

async function main() {
  console.log('Loading MPC wallet...');
  const mpcConfig = loadMPCConfigFromEnv();
  const { wallet } = await createProductionMPCWallet(mpcConfig);

  const messageBoxHost = process.env.MESSAGEBOX_HOST || 'https://messagebox.babbage.systems';
  console.log('Initializing MessageBox...');
  await (wallet as any).initializeMessageBox(messageBoxHost);
  console.log('MessageBox initialized');

  const peerPayClient = (wallet as any).getPeerPayClient();
  if (!peerPayClient) {
    console.error('PeerPay client not available');
    process.exit(1);
  }

  console.log('Listing incoming payments...');
  const payments = await peerPayClient.listIncomingPayments();
  console.log(`Found ${payments.length} pending payment(s)`);

  for (const payment of payments) {
    console.log(`Accepting payment from ${payment.sender} (${payment.messageId})...`);
    const result = await peerPayClient.acceptPayment(payment);
    console.log('Result:', result);
  }

  console.log('Done!');
  await (wallet as any).destroy();
  process.exit(0);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
