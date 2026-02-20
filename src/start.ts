#!/usr/bin/env node
/**
 * AGIdentity Gateway - Start Script
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
 * LLM Provider (any one of):
 *   ANTHROPIC_API_KEY=<key>                          (Anthropic, auto-detected)
 *   AGID_LLM_PROVIDER=ollama AGID_MODEL=llama3.1    (Ollama/local)
 *   AGID_LLM_PROVIDER=openai-compatible AGID_LLM_BASE_URL=... AGID_LLM_API_KEY=...
 *
 * Common:
 *   AGID_MODEL=claude-sonnet-4-5-20250929 (optional)
 *   AGID_WORKSPACE_PATH=~/.agidentity/workspace/ (optional)
 *   AGID_SESSIONS_PATH=~/.agidentity/sessions/ (optional)
 *   AGID_MAX_ITERATIONS=25 (optional)
 *   AGID_MAX_TOKENS=8192 (optional)
 *   HEALTH_PORT=3000 (optional, health check endpoint)
 */

import 'dotenv/config';
import * as http from 'http';
import { createAGIdentityGateway } from './gateway/index.js';
import { createProvider } from './agent/providers/index.js';
import { createAgentWallet } from './wallet/agent-wallet.js';
import { createProductionMPCWallet, loadMPCConfigFromEnv } from './wallet/mpc-integration.js';
import type { AgentWallet } from './wallet/agent-wallet.js';

async function main() {
  console.log('');
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║                    AGIdentity Gateway                      ║');
  console.log('║         Enterprise AI with Cryptographic Identity          ║');
  console.log('╚═══════════════════════════════════════════════════════════╝');
  console.log('');

  // Validate that some LLM provider is configured
  const hasAnthropic = !!process.env.ANTHROPIC_API_KEY;
  const hasExplicitProvider = !!process.env.AGID_LLM_PROVIDER;
  const hasBaseUrl = !!process.env.AGID_LLM_BASE_URL;

  if (!hasAnthropic && !hasExplicitProvider && !hasBaseUrl) {
    console.error('ERROR: No LLM provider configured');
    console.error('');
    console.error('Set one of:');
    console.error('  ANTHROPIC_API_KEY=<key>                         (Anthropic Claude)');
    console.error('  AGID_LLM_PROVIDER=ollama AGID_MODEL=llama3.1   (Local Ollama)');
    console.error('  AGID_LLM_BASE_URL=http://... AGID_LLM_API_KEY=<key>  (OpenAI-compatible)');
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

    // Background presign warmup (non-blocking)
    if (result.presignPool) {
      const keyId = `${mpcConfig.walletId}:0`;
      console.log('Generating initial presignatures...');
      result.presignPool.generate(keyId).then(() => {
        console.log(`Presign pool ready (${result.presignPool!.availableCount(keyId)} available)`);
      }).catch((err: Error) => {
        console.warn('Presign pool warmup failed:', err.message);
      });
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
    const mbTimeout = parseInt(process.env.MESSAGEBOX_INIT_TIMEOUT || '10000');
    await Promise.race([
      (wallet as any).initializeMessageBox(messageBoxHost),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`MessageBox init timed out after ${mbTimeout}ms`)), mbTimeout)),
    ]);
    console.log(`MessageBox initialized (host: ${messageBoxHost})`);
  } catch (error) {
    console.warn('MessageBox initialization failed:', error instanceof Error ? error.message : error);
    console.warn('   Continuing without MessageBox wallet integration');
  }

  // Check trusted certifiers
  const trustedCertifiers = process.env.TRUSTED_CERTIFIERS?.split(',').filter(Boolean) || [];
  if (trustedCertifiers.length === 0) {
    console.warn('WARNING: No TRUSTED_CERTIFIERS set - all certificates will be rejected');
    console.warn('Add comma-separated CA public keys to .env');
    console.warn('');
  }

  // Create LLM provider (auto-detects from environment)
  let provider;
  let providerType: string;
  try {
    provider = createProvider();
    providerType = process.env.AGID_LLM_PROVIDER
      ?? (hasAnthropic ? 'anthropic' : hasBaseUrl ? 'ollama' : 'anthropic');
    console.log(`LLM Provider: ${providerType}`);
  } catch (error) {
    console.error('ERROR: Failed to create LLM provider:', error instanceof Error ? error.message : error);
    process.exit(1);
  }

  // Create gateway with native agent loop
  console.log('Starting native agent gateway...');
  let gateway = null;
  try {
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
    console.log('Agent gateway initialized');
  } catch (error) {
    console.warn('Agent gateway failed to start:', error instanceof Error ? error.message : error);
    console.warn('   Agent will not respond to messages.');
  }

  // Minimal health check endpoint for container orchestration (k8s, Docker)
  const healthPort = parseInt(process.env.HEALTH_PORT || '3000');
  let healthServer: http.Server | null = null;
  try {
    healthServer = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: gateway?.isRunning() ? 'healthy' : 'degraded',
        agent: identityPublicKey,
        provider: providerType,
        model: process.env.AGID_MODEL ?? 'default',
        gateway: gateway?.isRunning() ?? false,
        uptime: process.uptime(),
        presignPool: wallet.getPresignPoolStatus(),
      }));
    });
    healthServer.listen(healthPort, '127.0.0.1');
    console.log(`Health check on http://127.0.0.1:${healthPort}/`);
  } catch (error) {
    console.warn('Health check server failed:', error instanceof Error ? error.message : error);
  }

  console.log('');
  console.log('===================================================================');
  console.log('Gateway running!');
  console.log('');
  if (gateway) {
    console.log(`  MessageBox: Listening for encrypted messages`);
    console.log(`  Agent Core: ${providerType} (model: ${process.env.AGID_MODEL ?? 'default'})`);
  } else {
    console.log('  MessageBox: Not running');
  }
  console.log('');
  console.log('Press Ctrl+C to stop.');
  console.log('===================================================================');
  console.log('');

  // Graceful shutdown
  const shutdown = async () => {
    console.log('');
    console.log('Shutting down...');
    if (healthServer) {
      healthServer.close();
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
