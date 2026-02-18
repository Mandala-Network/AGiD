#!/usr/bin/env npx tsx
/**
 * Quick diagnostic: test MessageBox list from MPC wallet
 */
import 'dotenv/config';
import { createProductionMPCWallet, loadMPCConfigFromEnv } from '../src/01-core/wallet/mpc-integration.js';
import { MessageBoxClient } from '@bsv/message-box-client';

async function main() {
  console.log('Loading MPC wallet...');
  const mpcConfig = loadMPCConfigFromEnv();
  const result = await createProductionMPCWallet(mpcConfig);
  const wallet = result.wallet as any;
  console.log('Wallet loaded, public key:', result.collectivePublicKey);

  // Create a MessageBoxClient with logging enabled
  console.log('Creating MessageBoxClient with logging...');
  const mbClient = new MessageBoxClient({
    walletClient: wallet.getUnderlyingMPCWallet?.() ?? wallet,
    host: 'https://messagebox.babbage.systems',
    enableLogging: true,
    networkPreset: 'mainnet',
  });

  console.log('Initializing MessageBoxClient...');
  await mbClient.init();
  console.log('Init done');

  console.log('Testing listMessages on "chat" box...');
  try {
    const messages = await mbClient.listMessages({ messageBox: 'chat' });
    console.log('SUCCESS! Got', messages.length, 'messages');
  } catch (err: any) {
    console.error('FAILED:', err.message);
  }
}

main().catch(console.error);
