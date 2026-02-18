#!/usr/bin/env npx tsx
/**
 * Pre-derive MPC keys for UTXOs that need spending.
 * Run this after internalize-payments.ts if keys weren't persisted.
 */
import 'dotenv/config';
import { createProductionMPCWallet, loadMPCConfigFromEnv } from '../src/01-core/wallet/mpc-integration.js';

async function main() {
  console.log('Loading MPC wallet...');
  const mpcConfig = loadMPCConfigFromEnv();
  const { wallet, rawWallet } = await createProductionMPCWallet(mpcConfig);

  // Get the key deriver from the raw wallet
  const keyDeriver = (rawWallet as any).keyDeriver;
  if (!keyDeriver || !keyDeriver.preDeriveKey) {
    console.error('KeyDeriver not available or missing preDeriveKey');
    process.exit(1);
  }

  // Check how many derivations are stored
  const count = await keyDeriver.initializeFromStorage();
  console.log(`Currently stored derivations: ${count}`);

  // The missing derivation from the PeerPay payment
  const brc29ProtocolID: [number, string] = [2, '3241645161d8'];
  const senderKey = '030bf09f05230ddf4a62f77a5960702a9dd37bdbf0ac38b9d52f5202b47a4c3f15';
  const keyID = 'QT56BwXwttLycB+RhOL4B16u7dKC0fuwkmAubr2c7c/arjJKdMFgsodYyeiFgNqJ z6GXLUXyE6lldLQ0sJbxt8AVT7b6ZgSp0uui7Zbw6kk6dW2pS1jXdDvkImKdKCB0';

  console.log(`Pre-deriving key for counterparty ${senderKey.slice(0, 10)}...`);
  console.log(`  Protocol: ${JSON.stringify(brc29ProtocolID)}`);
  console.log(`  KeyID: ${keyID.slice(0, 30)}...`);

  try {
    const derivation = await keyDeriver.preDeriveKey(brc29ProtocolID, keyID, senderKey);
    console.log('Derivation successful!');
    console.log(`  Derived public key: ${derivation.derivedPublicKey.slice(0, 20)}...`);
    console.log(`  Offset: ${derivation.offset.slice(0, 20)}...`);
  } catch (err) {
    console.error('Pre-derivation failed:', err);
  }

  // Wait for async persistence to flush
  console.log('Waiting for persistence to flush...');
  await new Promise(resolve => setTimeout(resolve, 3000));

  await (wallet as any).destroy();
  process.exit(0);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
