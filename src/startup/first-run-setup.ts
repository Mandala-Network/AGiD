/**
 * First-Run Interactive Setup
 *
 * Comprehensive setup wizard that walks the user through:
 *   1. Private key generation/import
 *   2. Network selection
 *   3. Wallet storage mode
 *   4. UHRP host
 *   5. LLM provider configuration
 *   6. MetaNet Client connection
 *   7. Certificate issuance
 *   8. Initial funding
 *   9. Config persistence
 *
 * Called from start.ts when ~/.agidentity/config.json is missing.
 */

import * as readline from 'readline';
import * as fs from 'fs';
import * as path from 'path';
import { PrivateKey, WalletClient, Utils } from '@bsv/sdk';
import { PeerCert } from 'peercert';

const AGID_CERT_TYPE = Utils.toBase64(Utils.toArray('agidentity.identity', 'utf8'));

// =========================================================================
// Types
// =========================================================================

export interface CertConfig {
  userKey: string;
  agentKey: string;
  agentCertSerialNumber: string;
  userCertSerialNumber: string;
  issuedAt: number;
}

export interface GatewayConfig {
  /** Agent private key hex */
  privateKey: string;
  /** Network: mainnet or testnet */
  network: 'mainnet' | 'testnet';
  /** Wallet storage mode */
  storageMode: 'local' | 'remote';
  /** SQLite path for local storage */
  storagePath?: string;
  /** Remote storage URL */
  storageUrl?: string;
  /** UHRP storage URL */
  uhrpUrl: string;
  /** LLM provider type */
  llmProvider: 'anthropic' | 'ollama' | 'openai-compatible';
  /** LLM API key (Anthropic or OpenAI-compatible) */
  llmApiKey?: string;
  /** LLM model name */
  llmModel?: string;
  /** LLM base URL (OpenAI-compatible or Ollama) */
  llmBaseUrl?: string;
  /** User identity key from MetaNet Client */
  userIdentityKey?: string;
  /** Timestamp of config creation */
  createdAt: number;
}

// =========================================================================
// Config paths
// =========================================================================

function getAgidentityDir(): string {
  const home = process.env.HOME || '/tmp';
  return path.join(home, '.agidentity');
}

function getCertConfigPath(): string {
  return path.join(getAgidentityDir(), 'cert-config.json');
}

function getGatewayConfigPath(): string {
  return path.join(getAgidentityDir(), 'config.json');
}

function getAgidentityEnvPath(): string {
  return path.join(getAgidentityDir(), '.env');
}

// =========================================================================
// Config load/save
// =========================================================================

export function loadCertConfig(): CertConfig | null {
  try {
    return JSON.parse(fs.readFileSync(getCertConfigPath(), 'utf8'));
  } catch {
    return null;
  }
}

export function loadGatewayConfig(): GatewayConfig | null {
  try {
    return JSON.parse(fs.readFileSync(getGatewayConfigPath(), 'utf8'));
  } catch {
    return null;
  }
}

export function saveGatewayConfig(config: GatewayConfig): void {
  const configPath = getGatewayConfigPath();
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

export function needsFirstRunSetup(): boolean {
  return !fs.existsSync(getGatewayConfigPath());
}

// =========================================================================
// Interactive setup
// =========================================================================

export async function runFirstRunSetup(): Promise<{
  gatewayConfig: GatewayConfig;
  certConfig: CertConfig | null;
}> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string): Promise<string> => new Promise(r => rl.question(q, r));

  console.log('');
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║              AGIdentity — First Run Setup                 ║');
  console.log('╚═══════════════════════════════════════════════════════════╝');
  console.log('');

  const agidDir = getAgidentityDir();
  fs.mkdirSync(agidDir, { recursive: true });

  // -----------------------------------------------------------------------
  // 1. PRIVATE KEY
  // -----------------------------------------------------------------------
  console.log('1. PRIVATE KEY');
  console.log('');
  const keyChoice = await ask('   Generate new private key or paste existing? [generate/paste] (generate): ');
  let privateKeyHex: string;

  if (keyChoice.trim().toLowerCase() === 'paste') {
    const pasted = await ask('   Paste private key hex (64 chars): ');
    const trimmed = pasted.trim();
    if (!/^[0-9a-fA-F]{64}$/.test(trimmed)) {
      rl.close();
      throw new Error('Invalid private key hex — must be 64 hex characters');
    }
    privateKeyHex = trimmed;
    console.log('   Private key accepted.');
  } else {
    const pk = PrivateKey.fromRandom();
    privateKeyHex = pk.toHex();
    console.log(`   Generated: ${privateKeyHex}`);
    console.log('   IMPORTANT: Save this key securely! It cannot be recovered.');
  }
  console.log('');

  // -----------------------------------------------------------------------
  // 2. NETWORK
  // -----------------------------------------------------------------------
  console.log('2. NETWORK');
  const networkInput = await ask('   Network? [mainnet/testnet] (mainnet): ');
  const network: 'mainnet' | 'testnet' =
    networkInput.trim().toLowerCase() === 'testnet' ? 'testnet' : 'mainnet';
  console.log(`   Selected: ${network}`);
  console.log('');

  // -----------------------------------------------------------------------
  // 3. WALLET STORAGE
  // -----------------------------------------------------------------------
  console.log('3. WALLET STORAGE');
  const storageInput = await ask('   Storage mode? [local/remote] (remote): ');
  const storageMode: 'local' | 'remote' =
    storageInput.trim().toLowerCase() === 'local' ? 'local' : 'remote';

  let storagePath: string | undefined;
  let storageUrl: string | undefined;

  if (storageMode === 'local') {
    const defaultPath = path.join(agidDir, 'wallet.sqlite');
    const pathInput = await ask(`   SQLite path (${defaultPath}): `);
    storagePath = pathInput.trim() || defaultPath;
    console.log(`   Storage: local SQLite at ${storagePath}`);
  } else {
    const urlInput = await ask('   Remote storage URL (leave blank for default): ');
    storageUrl = urlInput.trim() || undefined;
    console.log(`   Storage: remote${storageUrl ? ` (${storageUrl})` : ' (default)'}`);
  }
  console.log('');

  // -----------------------------------------------------------------------
  // 4. UHRP HOST
  // -----------------------------------------------------------------------
  console.log('4. UHRP HOST');
  const defaultUhrp = 'https://go-uhrp.b1nary.cloud';
  const uhrpInput = await ask(`   UHRP storage URL (${defaultUhrp}): `);
  const uhrpUrl = uhrpInput.trim() || defaultUhrp;
  console.log(`   UHRP: ${uhrpUrl}`);
  console.log('');

  // -----------------------------------------------------------------------
  // 5. LLM PROVIDER
  // -----------------------------------------------------------------------
  console.log('5. LLM PROVIDER');
  const providerInput = await ask('   Provider? [anthropic/ollama/openai-compatible] (anthropic): ');
  const providerChoice = providerInput.trim().toLowerCase();
  let llmProvider: 'anthropic' | 'ollama' | 'openai-compatible' = 'anthropic';
  let llmApiKey: string | undefined;
  let llmModel: string | undefined;
  let llmBaseUrl: string | undefined;

  if (providerChoice === 'ollama') {
    llmProvider = 'ollama';
    const modelInput = await ask('   Ollama model name (llama3.1): ');
    llmModel = modelInput.trim() || 'llama3.1';
    const baseInput = await ask('   Ollama base URL (http://localhost:11434): ');
    llmBaseUrl = baseInput.trim() || 'http://localhost:11434';
    console.log(`   Provider: ollama (${llmModel} at ${llmBaseUrl})`);
  } else if (providerChoice === 'openai-compatible') {
    llmProvider = 'openai-compatible';
    const baseInput = await ask('   Base URL: ');
    llmBaseUrl = baseInput.trim();
    if (!llmBaseUrl) {
      rl.close();
      throw new Error('Base URL is required for openai-compatible provider');
    }
    const keyInput = await ask('   API key: ');
    llmApiKey = keyInput.trim() || undefined;
    const modelInput = await ask('   Model name (optional): ');
    llmModel = modelInput.trim() || undefined;
    console.log(`   Provider: openai-compatible (${llmBaseUrl})`);
  } else {
    llmProvider = 'anthropic';
    const keyInput = await ask('   Anthropic API key: ');
    llmApiKey = keyInput.trim();
    if (!llmApiKey) {
      rl.close();
      throw new Error('Anthropic API key is required');
    }
    const modelInput = await ask('   Model (claude-sonnet-4-5-20250929): ');
    llmModel = modelInput.trim() || undefined;
    console.log(`   Provider: anthropic${llmModel ? ` (${llmModel})` : ''}`);
  }
  console.log('');

  // -----------------------------------------------------------------------
  // 6. CONNECT TO METANET CLIENT (required)
  // -----------------------------------------------------------------------
  console.log('6. METANET CLIENT');
  let walletClient: InstanceType<typeof WalletClient>;
  let userIdentityKey: string;

  try {
    process.stdout.write('   Connecting to MetaNet Client... ');
    walletClient = new WalletClient('json-api', 'agidentity');
    const { publicKey: userKey } = await walletClient.getPublicKey({ identityKey: true });
    userIdentityKey = userKey;
    console.log('connected');
    console.log(`   Your Identity Key: ${userKey}`);
  } catch (err) {
    console.log('failed');
    console.log('');
    console.log('   ╔═══════════════════════════════════════════════════════════╗');
    console.log('   ║  MetaNet Desktop is required to run AGIdentity.          ║');
    console.log('   ║                                                           ║');
    console.log('   ║  Download it at: https://getmetanet.com                  ║');
    console.log('   ║                                                           ║');
    console.log('   ║  Install, create your identity, then re-run this setup.  ║');
    console.log('   ╚═══════════════════════════════════════════════════════════╝');
    console.log('');
    rl.close();
    throw new Error('MetaNet Desktop is required. Download at https://getmetanet.com');
  }
  console.log('');

  // -----------------------------------------------------------------------
  // 7. CERTIFICATE ISSUANCE
  // -----------------------------------------------------------------------
  console.log('7. CERTIFICATE ISSUANCE');
  const agentPublicKey = PrivateKey.fromHex(privateKeyHex).toPublicKey().toString();

  const nameInput = await ask('   Agent name (required): ');
  if (!nameInput.trim()) {
    rl.close();
    throw new Error('Agent name is required');
  }
  const agentName = nameInput.trim();
  const organization = await ask('   Organization (optional): ');
  const email = await ask('   Email (optional): ');
  const capabilities = await ask('   Capabilities (optional, comma-separated): ');
  const userName = await ask('   Your name (required): ');
  if (!userName.trim()) {
    rl.close();
    throw new Error('Your name is required');
  }

  // `as any` — bundled SDK type mismatch (curvepoint vs top-level @bsv/sdk)
  const peerCert = new PeerCert(walletClient as any);

  const agentFields: Record<string, string> = {
    name: agentName,
    role: 'agent',
  };
  if (organization.trim()) agentFields.organization = organization.trim();
  if (email.trim()) agentFields.email = email.trim();
  if (capabilities.trim()) agentFields.capabilities = capabilities.trim();

  let certConfig: CertConfig | null = null;

  // PeerCert.issue() resolves even when overlay broadcast fails, but dumps
  // unhandled rejection stack traces. Suppress them during cert issuance.
  const overlayErrors: string[] = [];
  const suppressOverlay = (reason: unknown) => {
    const msg = reason instanceof Error ? reason.message : String(reason);
    if (msg.includes('fetch failed') || msg.includes('ENETUNREACH') || msg.includes('ECONNREFUSED')) {
      overlayErrors.push(msg);
    } else {
      // Re-throw non-overlay errors
      throw reason;
    }
  };
  process.on('unhandledRejection', suppressOverlay);

  try {
    process.stdout.write('   Issuing certificate to agent... ');
    const agentCert = await peerCert.issue({
      certificateType: AGID_CERT_TYPE,
      subjectIdentityKey: agentPublicKey,
      fields: agentFields,
      autoSend: true,
    });
    console.log('done');

    process.stdout.write('   Issuing self-certificate...     ');
    const userCert = await peerCert.issue({
      certificateType: AGID_CERT_TYPE,
      subjectIdentityKey: userIdentityKey,
      fields: { name: userName.trim(), role: 'admin' },
    });
    console.log('done');

    certConfig = {
      userKey: userIdentityKey,
      agentKey: agentPublicKey,
      agentCertSerialNumber: agentCert.serialNumber,
      userCertSerialNumber: userCert.serialNumber,
      issuedAt: Date.now(),
    };

    // Save cert config
    fs.writeFileSync(getCertConfigPath(), JSON.stringify(certConfig, null, 2));
    console.log(`   Cert config saved to ${getCertConfigPath()}`);

    if (overlayErrors.length > 0) {
      console.log(`   Note: Overlay broadcast failed (${overlayErrors.length} errors) — certs created locally but not published to overlay network.`);
    }
  } catch (err) {
    console.log('failed');
    console.log('');
    console.log('   Certificate issuance failed.');
    const errMsg = err instanceof Error ? err.message : String(err);
    console.log(`   Error: ${errMsg}`);
    console.log('');
    console.log('   Your config will be saved — re-run setup later to issue certs:');
    console.log('   rm ~/.agidentity/cert-config.json && npx tsx src/start.ts');
  } finally {
    process.removeListener('unhandledRejection', suppressOverlay);
  }
  console.log('');

  // -----------------------------------------------------------------------
  // 8. INITIAL FUNDING
  // -----------------------------------------------------------------------
  console.log('8. INITIAL FUNDING');
  const fundInput = await ask('   Send initial funding to agent? Amount in sats (10000, 0 to skip): ');
  const fundAmount = parseInt(fundInput.trim()) || 10000;

  if (fundAmount > 0) {
    try {
      process.stdout.write(`   Sending ${fundAmount} sats to agent... `);
      const { PeerPayClient } = await import('@bsv/message-box-client');
      const peerPay = new PeerPayClient({ walletClient: walletClient as any });
      await peerPay.sendPayment({ recipient: agentPublicKey, amount: fundAmount });
      console.log('done');
    } catch (err) {
      console.log('failed');
      console.warn(`   Payment failed: ${err instanceof Error ? err.message : err}`);
    }
  } else {
    console.log('   Skipping initial funding.');
  }
  console.log('');

  // -----------------------------------------------------------------------
  // 9. AGENT WORKSPACE (SOUL.md, IDENTITY.md, TOOLS.md)
  // -----------------------------------------------------------------------
  console.log('9. AGENT WORKSPACE');
  console.log('   These files define your agent\'s persona and behavior.');
  console.log('   They live in ~/.agidentity/workspace/ and can be edited later.');
  console.log('');

  const workspaceDir = path.join(agidDir, 'workspace');
  fs.mkdirSync(workspaceDir, { recursive: true });

  // -- SOUL.md (core persona) --
  const soulDefault = `You are ${agentName}, an autonomous AI agent with a cryptographic identity on the BSV blockchain.
You can sign messages, encrypt data, create tokens, send payments, and store memories — all on-chain.
Be helpful, precise, and use your tools when the user's request requires blockchain operations.
When asked to prove your identity, sign a message with your wallet key.`;

  console.log('   SOUL.md — defines your agent\'s core persona and behavioral rules.');
  console.log('   Default:');
  for (const line of soulDefault.split('\n')) {
    console.log(`     ${line}`);
  }
  const soulChoice = await ask('   Keep default SOUL.md? [yes/edit] (yes): ');

  let soulContent: string;
  if (soulChoice.trim().toLowerCase() === 'edit') {
    console.log('   Enter custom SOUL.md content (end with an empty line):');
    const lines: string[] = [];
    while (true) {
      const line = await ask('   > ');
      if (line.trim() === '') break;
      lines.push(line);
    }
    soulContent = lines.length > 0 ? lines.join('\n') : soulDefault;
  } else {
    soulContent = soulDefault;
  }
  fs.writeFileSync(path.join(workspaceDir, 'SOUL.md'), soulContent, 'utf8');
  console.log('   SOUL.md saved.');
  console.log('');

  // -- IDENTITY.md (self-description) --
  const identityDefault = `I am ${agentName} — a blockchain-native AI with verifiable identity.`;
  console.log('   IDENTITY.md — the agent\'s self-description.');
  console.log(`   Default: "${identityDefault}"`);
  const identityChoice = await ask('   Keep default? [yes/edit] (yes): ');

  let identityContent: string;
  if (identityChoice.trim().toLowerCase() === 'edit') {
    const customId = await ask('   Enter custom IDENTITY.md (one line): ');
    identityContent = customId.trim() || identityDefault;
  } else {
    identityContent = identityDefault;
  }
  fs.writeFileSync(path.join(workspaceDir, 'IDENTITY.md'), identityContent, 'utf8');
  console.log('   IDENTITY.md saved.');
  console.log('');

  // -- TOOLS.md (tool usage guidelines) --
  const toolsDefault = `Tool usage guidelines:
- Use agid_balance before any payment to check funds
- Use agid_sign to prove authorship of a statement
- Use agid_store_memory to persist important information across sessions
- Use agid_token_create for on-chain data anchoring
- Execute tools one at a time (sequential, not parallel) to avoid signing conflicts`;

  fs.writeFileSync(path.join(workspaceDir, 'TOOLS.md'), toolsDefault, 'utf8');
  console.log('   TOOLS.md saved (default tool guidelines).');
  console.log(`   Workspace: ${workspaceDir}`);
  console.log('');

  // -----------------------------------------------------------------------
  // 10. SAVE CONFIG
  // -----------------------------------------------------------------------
  console.log('10. SAVING CONFIGURATION');

  const gatewayConfig: GatewayConfig = {
    privateKey: privateKeyHex,
    network,
    storageMode,
    storagePath,
    storageUrl,
    uhrpUrl,
    llmProvider,
    llmApiKey,
    llmModel,
    llmBaseUrl,
    userIdentityKey,
    createdAt: Date.now(),
  };

  // Save gateway config
  saveGatewayConfig(gatewayConfig);
  console.log(`   Gateway config saved to ${getGatewayConfigPath()}`);

  // Write ~/.agidentity/.env with key env vars
  const envLines: string[] = [
    '# AGIdentity — auto-generated by first-run setup',
    `AGENT_PRIVATE_KEY=${privateKeyHex}`,
    `AGID_NETWORK=${network}`,
    `AGID_STORAGE_MODE=${storageMode}`,
  ];
  if (storagePath) envLines.push(`AGID_STORAGE_PATH=${storagePath}`);
  if (storageUrl) envLines.push(`AGID_STORAGE_URL=${storageUrl}`);
  envLines.push(`UHRP_STORAGE_URL=${uhrpUrl}`);
  if (llmProvider === 'anthropic' && llmApiKey) {
    envLines.push(`ANTHROPIC_API_KEY=${llmApiKey}`);
  } else if (llmProvider === 'ollama') {
    envLines.push(`AGID_LLM_PROVIDER=ollama`);
    if (llmModel) envLines.push(`AGID_MODEL=${llmModel}`);
    if (llmBaseUrl) envLines.push(`AGID_LLM_BASE_URL=${llmBaseUrl}`);
  } else if (llmProvider === 'openai-compatible') {
    envLines.push(`AGID_LLM_PROVIDER=openai-compatible`);
    if (llmBaseUrl) envLines.push(`AGID_LLM_BASE_URL=${llmBaseUrl}`);
    if (llmApiKey) envLines.push(`AGID_LLM_API_KEY=${llmApiKey}`);
    if (llmModel) envLines.push(`AGID_MODEL=${llmModel}`);
  }

  fs.writeFileSync(getAgidentityEnvPath(), envLines.join('\n') + '\n');
  console.log(`   Env file saved to ${getAgidentityEnvPath()}`);

  rl.close();

  console.log('');
  console.log('Setup complete!');
  console.log('');

  return { gatewayConfig, certConfig };
}
