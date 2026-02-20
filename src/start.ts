#!/usr/bin/env node
/**
 * AGIdentity Gateway - Start Script
 *
 * Usage:
 *   npm run gateway
 *
 * Wallet:
 *   AGENT_PRIVATE_KEY=<64-hex-chars>   (generate with: openssl rand -hex 32)
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
import type { AgentWallet } from './wallet/agent-wallet.js';
import { runFirstRunSetup, loadCertConfig } from './startup/first-run-setup.js';

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

  // Wallet setup — single private key via @bsv/wallet-toolbox
  const privateKey = process.env.AGENT_PRIVATE_KEY;

  if (!privateKey) {
    console.error('ERROR: AGENT_PRIVATE_KEY not set');
    console.error('');
    console.error('Generate one with: openssl rand -hex 32');
    console.error('Then set: AGENT_PRIVATE_KEY=<your-64-char-hex>');
    process.exit(1);
  }

  console.log('Creating wallet (wallet-toolbox)...');
  let wallet: AgentWallet;
  let identityPublicKey: string;

  const { wallet: agentWallet } = await createAgentWallet({
    privateKeyHex: privateKey,
    network: (process.env.AGID_NETWORK as 'mainnet' | 'testnet') || 'mainnet',
  });
  wallet = agentWallet;
  const keyResult = await agentWallet.getPublicKey({ identityKey: true });
  identityPublicKey = keyResult.publicKey;

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

  // First-run certificate setup
  let certConfig = loadCertConfig();
  if (!certConfig && process.stdin.isTTY) {
    console.log('');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('First-Run Certificate Setup');
    console.log('═══════════════════════════════════════════════════════════');
    try {
      certConfig = await runFirstRunSetup(identityPublicKey);
    } catch (err) {
      console.warn('Certificate setup failed:', err instanceof Error ? err.message : err);
      console.warn('Continuing without certificates. Re-run to try again.');
    }
    console.log('═══════════════════════════════════════════════════════════');
    console.log('');
  } else if (!certConfig) {
    console.warn('No cert-config.json found (non-interactive mode — skipping first-run setup)');
  }

  // Check trusted certifiers
  const trustedCertifiers = process.env.TRUSTED_CERTIFIERS?.split(',').filter(Boolean) || [];

  // Auto-trust the user from cert-config
  if (certConfig?.userKey && !trustedCertifiers.includes(certConfig.userKey)) {
    trustedCertifiers.push(certConfig.userKey);
    console.log(`Trusted certifier (from cert-config): ${certConfig.userKey.substring(0, 16)}...`);
  }

  if (trustedCertifiers.length === 0) {
    console.warn('WARNING: No TRUSTED_CERTIFIERS set - all certificates will be rejected');
    console.warn('Add comma-separated CA public keys to .env');
    console.warn('');
  }

  // Cert enforcement
  if (process.env.AGID_REQUIRE_CERTS === 'true') {
    console.log('Certificate enforcement: ENABLED');
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
