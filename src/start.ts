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
 *   ANTHROPIC_API_KEY=<required>
 *   TRUSTED_CERTIFIERS=<comma-separated-ca-pubkeys>
 *   AGID_MODEL=claude-sonnet-4-5-20250929 (optional)
 *   AGID_WORKSPACE_PATH=~/.agidentity/workspace/ (optional)
 *   AGID_SESSIONS_PATH=~/.agidentity/sessions/ (optional)
 *   AGID_MAX_ITERATIONS=25 (optional)
 *   AGID_MAX_TOKENS=8192 (optional)
 */

import 'dotenv/config';
import { createAGIdentityGateway } from './03-gateway/gateway/index.js';
import { AnthropicProvider } from './03-gateway/agent/providers/index.js';
import { createAgentWallet } from './01-core/wallet/agent-wallet.js';
import { createProductionMPCWallet, loadMPCConfigFromEnv } from './01-core/wallet/mpc-integration.js';
import { createAGIDServer } from './05-interfaces/server/auth-server.js';
import { IdentityGate } from './01-core/identity/identity-gate.js';
import type { AgentWallet } from './01-core/wallet/agent-wallet.js';
import type { AGIDServer } from './05-interfaces/server/auth-server.js';

async function main() {
  console.log('');
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║                    AGIdentity Gateway                      ║');
  console.log('║         Enterprise AI with Cryptographic Identity          ║');
  console.log('╚═══════════════════════════════════════════════════════════╝');
  console.log('');

  // Validate ANTHROPIC_API_KEY
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicApiKey) {
    console.error('ERROR: ANTHROPIC_API_KEY not set');
    console.error('Set your Anthropic API key in .env or environment');
    process.exit(1);
  }

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

  // Initialize MessageBox for encrypted messaging
  const messageBoxHost = process.env.MESSAGEBOX_HOST || 'https://messagebox.babbage.systems';
  try {
    console.log('Initializing MessageBox...');
    await (wallet as any).initializeMessageBox(messageBoxHost);
    console.log(`✅ MessageBox initialized (host: ${messageBoxHost})`);
  } catch (error) {
    console.warn('⚠️  MessageBox initialization failed:', error instanceof Error ? error.message : error);
    console.warn('   Continuing without MessageBox wallet integration');
  }

  // Check trusted certifiers
  const trustedCertifiers = process.env.TRUSTED_CERTIFIERS?.split(',').filter(Boolean) || [];
  if (trustedCertifiers.length === 0) {
    console.warn('WARNING: No TRUSTED_CERTIFIERS set - all certificates will be rejected');
    console.warn('Add comma-separated CA public keys to .env');
    console.warn('');
  }

  // Create gateway with native agent loop
  console.log('Starting native agent gateway...');
  let gateway = null;
  try {
    const provider = new AnthropicProvider(anthropicApiKey);
    gateway = await createAGIdentityGateway({
      wallet,
      trustedCertifiers,
      provider,
      model: process.env.AGID_MODEL,
      workspacePath: process.env.AGID_WORKSPACE_PATH,
      sessionsPath: process.env.AGID_SESSIONS_PATH,
      maxIterations: process.env.AGID_MAX_ITERATIONS ? parseInt(process.env.AGID_MAX_ITERATIONS) : undefined,
      maxTokens: process.env.AGID_MAX_TOKENS ? parseInt(process.env.AGID_MAX_TOKENS) : undefined,
      signResponses: true,
      audit: { enabled: true },
      messageBoxes: ['inbox', 'chat'],
    });
    console.log('✅ Agent gateway initialized');
  } catch (error) {
    console.warn('⚠️  Agent gateway failed to start:', error instanceof Error ? error.message : error);
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
      allowUnauthenticated: true,
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
    console.log('✅ Agent Core: Native Anthropic API (no OpenClaw)');
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
