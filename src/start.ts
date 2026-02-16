#!/usr/bin/env node
/**
 * AGIdentity Gateway - Simple Start Script
 *
 * Usage:
 *   npm run gateway
 *
 * MPC Mode (Production - Recommended):
 *   MPC_COSIGNER_ENDPOINTS=http://cosigner1:3001,http://cosigner2:3002
 *   MPC_SHARE_SECRET=<encryption-key>
 *   MPC_SHARE_PATH=./agent-mpc-share.json
 *
 * Local Mode (Development Only):
 *   AGENT_PRIVATE_KEY=<64-hex-chars>
 *
 * Common:
 *   TRUSTED_CERTIFIERS=<comma-separated-ca-pubkeys>
 *   OPENCLAW_GATEWAY_URL=ws://127.0.0.1:18789 (optional)
 */

import 'dotenv/config';
import { createAGIdentityGateway } from './gateway/index.js';
import { createAgentWallet } from './wallet/agent-wallet.js';
import { createProductionMPCWallet, loadMPCConfigFromEnv } from './wallet/mpc-integration.js';
import { createAGIDServer } from './server/auth-server.js';
import { IdentityGate } from './identity/identity-gate.js';
import type { AgentWallet } from './wallet/agent-wallet.js';
import type { AGIDServer } from './server/auth-server.js';

async function main() {
  console.log('');
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║                    AGIdentity Gateway                      ║');
  console.log('║         Enterprise AI with Cryptographic Identity          ║');
  console.log('╚═══════════════════════════════════════════════════════════╝');
  console.log('');

  // Determine wallet mode
  const mpcEndpoints = process.env.MPC_COSIGNER_ENDPOINTS;
  const localPrivateKey = process.env.AGENT_PRIVATE_KEY;

  let wallet: AgentWallet;
  let identityPublicKey: string;

  if (mpcEndpoints) {
    // MPC Mode (Production)
    console.log('Mode: MPC (threshold signatures)');
    console.log('');

    if (!process.env.MPC_SHARE_SECRET) {
      console.error('ERROR: MPC_SHARE_SECRET not set');
      console.error('Generate one with: openssl rand -hex 32');
      process.exit(1);
    }

    console.log('Initializing MPC wallet...');
    const mpcConfig = loadMPCConfigFromEnv();
    const result = await createProductionMPCWallet(mpcConfig);
    wallet = result.wallet as unknown as AgentWallet;
    identityPublicKey = result.collectivePublicKey;

    if (result.isNewWallet) {
      console.log('DKG complete - new distributed key generated');
    } else {
      console.log('Restored from existing key share');
    }
  } else if (localPrivateKey) {
    // Local Mode (Development)
    console.log('Mode: Local (single key - DEVELOPMENT ONLY)');
    console.warn('WARNING: Do not use local mode in production!');
    console.log('');

    console.log('Creating local wallet...');
    const { wallet: localWallet } = await createAgentWallet({
      privateKeyHex: localPrivateKey,
      network: (process.env.AGID_NETWORK as 'mainnet' | 'testnet') || 'mainnet',
    });
    wallet = localWallet;
    const keyResult = await localWallet.getPublicKey({ identityKey: true });
    identityPublicKey = keyResult.publicKey;
  } else {
    console.error('ERROR: No wallet configuration found');
    console.error('');
    console.error('For production (MPC):');
    console.error('  MPC_COSIGNER_ENDPOINTS=http://cosigner1:3001,http://cosigner2:3002');
    console.error('  MPC_SHARE_SECRET=<generate with: openssl rand -hex 32>');
    console.error('');
    console.error('For development (local key):');
    console.error('  AGENT_PRIVATE_KEY=<generate with: openssl rand -hex 32>');
    process.exit(1);
  }

  console.log(`Agent Identity: ${identityPublicKey}`);
  console.log('');

  // Check trusted certifiers
  const trustedCertifiers = process.env.TRUSTED_CERTIFIERS?.split(',').filter(Boolean) || [];
  if (trustedCertifiers.length === 0) {
    console.warn('WARNING: No TRUSTED_CERTIFIERS set - all certificates will be rejected');
    console.warn('Add comma-separated CA public keys to .env');
    console.warn('');
  }

  // Create gateway (optional - for MessageBox)
  console.log('Starting MessageBox gateway...');
  let gateway = null;
  try {
    gateway = await createAGIdentityGateway({
      wallet,
      trustedCertifiers,
      openclawUrl: process.env.OPENCLAW_GATEWAY_URL || 'ws://127.0.0.1:18789',
      openclawToken: process.env.OPENCLAW_GATEWAY_TOKEN,
      signResponses: true,
      audit: { enabled: true },
    });
    console.log('✅ MessageBox gateway initialized');
  } catch (error) {
    console.warn('⚠️  MessageBox gateway failed to start:', error instanceof Error ? error.message : error);
    console.warn('   Continuing without MessageBox (HTTP API will still work)');
  }

  // Start HTTP API server for AI tools
  console.log('Starting HTTP API server for AI tools...');
  const identityGate = new IdentityGate({
    wallet,
    trustedCertifiers,
  });

  let httpServer: AGIDServer | null = null;
  try {
    httpServer = await createAGIDServer({
      wallet,
      identityGate,
      port: parseInt(process.env.AUTH_SERVER_PORT || '3000'),
      trustedCertifiers,
      allowUnauthenticated: true, // Allow OpenClaw plugin without BRC-103
      enableLogging: true,
      logLevel: 'info',
    });

    await httpServer.start();
    console.log('✅ HTTP API server running on http://localhost:' + (process.env.AUTH_SERVER_PORT || '3000'));
  } catch (error) {
    console.warn('⚠️  HTTP API server failed to start:', error);
    console.warn('   AI tools will not be available.');
  }

  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('Gateway running!');
  console.log('');
  if (gateway) {
    console.log('✅ MessageBox: Listening for encrypted messages');
  } else {
    console.log('❌ MessageBox: Not running (insufficient funds)');
  }
  if (httpServer) {
    console.log('✅ HTTP API: AI tools available on port ' + (process.env.AUTH_SERVER_PORT || '3000'));
  } else {
    console.log('❌ HTTP API: Not running');
  }
  console.log('');
  console.log('Press Ctrl+C to stop.');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');

  // Graceful shutdown
  const shutdown = async () => {
    console.log('');
    console.log('Shutting down...');
    if (httpServer) {
      await httpServer.stop();
    }
    if (gateway) {
      await gateway.shutdown();
    }
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
