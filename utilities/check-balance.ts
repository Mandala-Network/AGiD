#!/usr/bin/env node
/**
 * Check wallet balance
 */

import 'dotenv/config';
import { createAgentWallet } from './wallet/agent-wallet.js';

async function main() {
  const privateKey = process.env.AGENT_PRIVATE_KEY;
  if (!privateKey) {
    console.error('ERROR: AGENT_PRIVATE_KEY not set in .env');
    process.exit(1);
  }

  console.log('Loading wallet...');
  const { wallet } = await createAgentWallet({
    privateKeyHex: privateKey,
    network: (process.env.AGID_NETWORK as 'mainnet' | 'testnet') || 'mainnet',
  });

  const identity = await wallet.getPublicKey({ identityKey: true });
  console.log(`Identity: ${identity.publicKey}`);
  console.log('');

  // Check balance using wallet-toolbox's internal wallet
  const balance = await wallet.getBalanceAndUtxos();
  console.log(`Balance: ${balance.total} satoshis`);

  if (balance.utxos && balance.utxos.length > 0) {
    console.log(`UTXOs: ${balance.utxos.length}`);
    for (const utxo of balance.utxos) {
      console.log(`  - ${utxo.satoshis} sats @ ${utxo.outpoint}`);
    }
  } else {
    console.log('No UTXOs found');
  }
}

main().catch(console.error);
