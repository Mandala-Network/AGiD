#!/usr/bin/env node
/**
 * AGIdentity Gateway - Simple Start Script
 *
 * Usage:
 *   npm run gateway
 *
 * Required environment variables:
 *   AGENT_PRIVATE_KEY - 64 hex chars (generate: openssl rand -hex 32)
 *   TRUSTED_CERTIFIERS - Comma-separated CA public keys
 *
 * Optional:
 *   OPENCLAW_GATEWAY_URL - OpenClaw WebSocket URL (default: ws://127.0.0.1:18789)
 *   OPENCLAW_GATEWAY_TOKEN - OpenClaw auth token
 *   MESSAGEBOX_HOST - MessageBox server URL
 */

import 'dotenv/config';
import { createAGIdentityGateway } from './gateway/index.js';
import { createAgentWallet } from './wallet/agent-wallet.js';

async function main() {
  console.log('');
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║                    AGIdentity Gateway                      ║');
  console.log('║         Enterprise AI with Cryptographic Identity          ║');
  console.log('╚═══════════════════════════════════════════════════════════╝');
  console.log('');

  // Check required env vars
  const privateKey = process.env.AGENT_PRIVATE_KEY;
  if (!privateKey) {
    console.error('ERROR: AGENT_PRIVATE_KEY not set');
    console.error('');
    console.error('Generate one with:');
    console.error('  openssl rand -hex 32');
    console.error('');
    console.error('Then add to .env:');
    console.error('  AGENT_PRIVATE_KEY=<your-key>');
    process.exit(1);
  }

  const trustedCertifiers = process.env.TRUSTED_CERTIFIERS?.split(',').filter(Boolean) || [];
  if (trustedCertifiers.length === 0) {
    console.warn('WARNING: No TRUSTED_CERTIFIERS set - all certificates will be rejected');
    console.warn('Add comma-separated CA public keys to .env:');
    console.warn('  TRUSTED_CERTIFIERS=03abc...,03def...');
    console.warn('');
  }

  // Create wallet
  console.log('Creating agent wallet...');
  const { wallet } = await createAgentWallet({
    privateKeyHex: privateKey,
    network: (process.env.AGID_NETWORK as 'mainnet' | 'testnet') || 'mainnet',
  });

  const identityKey = await wallet.getPublicKey({ identityKey: true });
  console.log(`Agent Identity: ${identityKey.publicKey}`);
  console.log('');

  // Create gateway
  console.log('Starting gateway...');
  const gateway = await createAGIdentityGateway({
    wallet: wallet as any, // AgentWallet implements BRC100Wallet
    trustedCertifiers,
    openclawUrl: process.env.OPENCLAW_GATEWAY_URL || 'ws://127.0.0.1:18789',
    openclawToken: process.env.OPENCLAW_GATEWAY_TOKEN,
    signResponses: true,
    audit: { enabled: true },
  });

  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('Gateway running!');
  console.log('');
  console.log('Listening for encrypted messages on MessageBox.');
  console.log('All responses are signed with the agent wallet.');
  console.log('');
  console.log('Press Ctrl+C to stop.');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');

  // Graceful shutdown
  const shutdown = async () => {
    console.log('');
    console.log('Shutting down...');
    await gateway.shutdown();
    console.log('Goodbye!');
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Keep alive
  await new Promise(() => {});
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
