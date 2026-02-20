/**
 * First-Run Certificate Setup
 *
 * Interactive prompts for issuing initial identity certificates
 * and optionally funding the agent. Called from start.ts on first run.
 */

import * as readline from 'readline';
import * as fs from 'fs';
import * as path from 'path';
import { WalletClient, Utils } from '@bsv/sdk';
import { PeerCert } from 'peercert';

const AGID_CERT_TYPE = Utils.toBase64(Utils.toArray('agidentity.identity', 'utf8'));

export interface CertConfig {
  userKey: string;
  agentKey: string;
  agentCertSerialNumber: string;
  userCertSerialNumber: string;
  issuedAt: number;
}

function getCertConfigPath(): string {
  const home = process.env.HOME || '/tmp';
  return path.join(home, '.agidentity', 'cert-config.json');
}

export function needsFirstRunSetup(): boolean {
  return !fs.existsSync(getCertConfigPath());
}

export function loadCertConfig(): CertConfig | null {
  try {
    return JSON.parse(fs.readFileSync(getCertConfigPath(), 'utf8'));
  } catch {
    return null;
  }
}

export async function runFirstRunSetup(agentPublicKey: string): Promise<CertConfig> {
  // 1. Connect to MetaNet Client (user's local wallet)
  console.log('Connecting to MetaNet Client...');
  const walletClient = new WalletClient('json-api', 'agidentity');
  const { publicKey: userKey } = await walletClient.getPublicKey({ identityKey: true });
  console.log(`Your Identity Key: ${userKey}`);
  console.log('');

  // 2. Prompt for fields
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string): Promise<string> => new Promise(r => rl.question(q, r));

  const agentName = await ask('What name for the agent? > ');
  if (!agentName.trim()) {
    rl.close();
    throw new Error('Agent name is required');
  }

  const organization = await ask('Organization (optional)? > ');
  const email = await ask('Email (optional)? > ');
  const capabilities = await ask('Capabilities (optional, comma-separated)? > ');
  const userName = await ask('Your name? > ');
  if (!userName.trim()) {
    rl.close();
    throw new Error('Your name is required');
  }

  // 3. Issue cert TO agent (autoSend delivers via PeerCert MessageBox)
  console.log('');
  // `as any` — bundled SDK type mismatch (curvepoint vs top-level @bsv/sdk)
  const peerCert = new PeerCert(walletClient as any);

  const agentFields: Record<string, string> = {
    name: agentName.trim(),
    role: 'agent',
  };
  if (organization.trim()) agentFields.organization = organization.trim();
  if (email.trim()) agentFields.email = email.trim();
  if (capabilities.trim()) agentFields.capabilities = capabilities.trim();

  process.stdout.write('Issuing certificate to agent...     ');
  const agentCert = await peerCert.issue({
    certificateType: AGID_CERT_TYPE,
    subjectIdentityKey: agentPublicKey,
    fields: agentFields,
    autoSend: true,
  });
  console.log('done');

  // 4. Issue self-cert (stored in user's wallet)
  process.stdout.write('Issuing self-certificate...         ');
  const userCert = await peerCert.issue({
    certificateType: AGID_CERT_TYPE,
    subjectIdentityKey: userKey,
    fields: { name: userName.trim(), role: 'admin' },
  });
  console.log('done');

  // 5. Optional: send initial funding
  const fund = await ask('Send initial funding (1000 sats)? [Y/n] > ');
  if (fund.toLowerCase() !== 'n') {
    try {
      process.stdout.write('Sending 1000 sats to agent...       ');
      const { PeerPayClient } = await import('@bsv/message-box-client');
      const peerPay = new PeerPayClient(walletClient as any);
      await peerPay.sendPayment({ recipient: agentPublicKey, amount: 1000 });
      console.log('done');
    } catch (err) {
      console.log('failed');
      console.warn('  Payment failed:', err instanceof Error ? err.message : err);
    }
  }

  rl.close();

  // 6. Save config
  // issue() returns MasterCertificate — access serialNumber directly
  const config: CertConfig = {
    userKey,
    agentKey: agentPublicKey,
    agentCertSerialNumber: agentCert.serialNumber,
    userCertSerialNumber: userCert.serialNumber,
    issuedAt: Date.now(),
  };

  const configPath = getCertConfigPath();
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  console.log('');
  console.log(`Config saved to ${configPath}`);

  return config;
}
