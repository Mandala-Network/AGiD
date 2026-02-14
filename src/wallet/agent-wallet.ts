/**
 * Agent Wallet
 *
 * Full BRC-100 wallet using @bsv/wallet-toolbox.
 * Wallet-toolbox handles all key derivation, UTXO management, and transactions.
 */

import { PrivateKey } from '@bsv/sdk';
import { Setup, Wallet } from '@bsv/wallet-toolbox';
import type { Chain } from '@bsv/wallet-toolbox';
import type {
  BRC100Wallet,
  GetPublicKeyArgs,
  GetPublicKeyResult,
  EncryptArgs,
  EncryptResult,
  DecryptArgs,
  DecryptResult,
  CreateSignatureArgs,
  CreateSignatureResult,
  VerifySignatureArgs,
  VerifySignatureResult,
  CreateHmacArgs,
  CreateHmacResult,
  VerifyHmacArgs,
  VerifyHmacResult,
  CreateActionArgs,
  CreateActionResult,
  AcquireCertificateArgs,
  AcquireCertificateResult,
  ListCertificatesArgs,
  ListCertificatesResult,
} from '../types/index.js';

/**
 * Configuration for agent wallet
 */
export interface AgentWalletConfig {
  /** Private key hex - store this securely (env var, secrets manager, etc.) */
  privateKeyHex: string;
  /** Path to SQLite database for wallet storage (only for 'local' storage mode) */
  storagePath?: string;
  /** Network: 'mainnet' or 'testnet' */
  network?: 'mainnet' | 'testnet';
  /** Database name (only for 'local' storage mode) */
  databaseName?: string;
  /** Storage mode: 'local' (SQLite) or 'remote' (Babbage storage service) */
  storageMode?: 'local' | 'remote';
  /** Custom storage URL (only for 'remote' storage mode) */
  storageUrl?: string;
}

/**
 * Wallet balance info
 */
export interface WalletBalanceInfo {
  total: number;
  utxos: Array<{ satoshis: number; outpoint: string }>;
}

/**
 * Agent Wallet - wraps wallet-toolbox
 */
export class AgentWallet implements BRC100Wallet {
  private wallet: Wallet | null = null;
  private config: AgentWalletConfig;
  private initialized = false;
  private identityPublicKey: string | null = null;
  private chain: Chain;

  constructor(config: AgentWalletConfig) {
    this.config = config;
    this.chain = config.network === 'testnet' ? 'test' : 'main';
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    const pk = PrivateKey.fromHex(this.config.privateKeyHex);
    this.identityPublicKey = pk.toPublicKey().toString();

    const storageMode = this.config.storageMode ?? 'remote';

    if (storageMode === 'remote') {
      // Use remote storage (Babbage storage service) - no SQLite required
      this.wallet = await Setup.createWalletClientNoEnv({
        chain: this.chain,
        rootKeyHex: this.config.privateKeyHex,
        storageUrl: this.config.storageUrl,
      });
    } else {
      // Use local SQLite storage
      const storagePath = this.config.storagePath ?? './agent-wallet.sqlite';
      const databaseName = this.config.databaseName ?? 'agentWallet';

      const env = {
        chain: this.chain,
        identityKey: this.identityPublicKey,
        identityKey2: this.identityPublicKey,
        filePath: storagePath,
        taalApiKey: '',
        devKeys: { [this.identityPublicKey]: this.config.privateKeyHex },
        mySQLConnection: '',
      };

      const result = await Setup.createWalletSQLite({
        filePath: storagePath,
        databaseName,
        env,
        rootKeyHex: this.config.privateKeyHex,
      });
      this.wallet = result.wallet;
    }

    this.initialized = true;
  }

  getUnderlyingWallet(): Wallet | null {
    return this.wallet;
  }

  async getBalance(): Promise<number> {
    await this.ensureInitialized();
    return this.wallet!.balance();
  }

  async getBalanceAndUtxos(): Promise<WalletBalanceInfo> {
    await this.ensureInitialized();
    const result = await this.wallet!.balanceAndUtxos();
    return { total: result.total, utxos: result.utxos };
  }

  async getFundingAddress(): Promise<string> {
    await this.ensureInitialized();
    return PrivateKey.fromHex(this.config.privateKeyHex).toAddress();
  }

  // BRC-100 Interface
  async getPublicKey(args: GetPublicKeyArgs): Promise<GetPublicKeyResult> {
    await this.ensureInitialized();
    if (args.identityKey) return { publicKey: this.identityPublicKey! };

    if (args.protocolID && args.keyID) {
      const result = await this.wallet!.getPublicKey({
        identityKey: args.identityKey ? true : undefined,
        protocolID: args.protocolID as [0 | 1 | 2, string],
        keyID: args.keyID,
        counterparty: args.counterparty,
        forSelf: args.forSelf,
      });
      return { publicKey: result.publicKey };
    }
    return { publicKey: this.identityPublicKey! };
  }

  async encrypt(args: EncryptArgs): Promise<EncryptResult> {
    await this.ensureInitialized();
    const plaintext = args.plaintext instanceof Uint8Array ? Array.from(args.plaintext) : args.plaintext;
    const result = await this.wallet!.encrypt({
      plaintext,
      protocolID: args.protocolID as [0 | 1 | 2, string],
      keyID: args.keyID,
      counterparty: args.counterparty,
    });
    return { ciphertext: result.ciphertext };
  }

  async decrypt(args: DecryptArgs): Promise<DecryptResult> {
    await this.ensureInitialized();
    const ciphertext = args.ciphertext instanceof Uint8Array ? Array.from(args.ciphertext) : args.ciphertext;
    const result = await this.wallet!.decrypt({
      ciphertext,
      protocolID: args.protocolID as [0 | 1 | 2, string],
      keyID: args.keyID,
      counterparty: args.counterparty,
    });
    return { plaintext: result.plaintext };
  }

  async createSignature(args: CreateSignatureArgs): Promise<CreateSignatureResult> {
    await this.ensureInitialized();
    const data = args.data instanceof Uint8Array ? Array.from(args.data) : args.data;
    const result = await this.wallet!.createSignature({
      data,
      protocolID: args.protocolID as [0 | 1 | 2, string],
      keyID: args.keyID,
      counterparty: args.counterparty,
    });
    return { signature: result.signature };
  }

  async verifySignature(args: VerifySignatureArgs): Promise<VerifySignatureResult> {
    await this.ensureInitialized();
    const data = args.data instanceof Uint8Array ? Array.from(args.data) : args.data;
    const signature = args.signature instanceof Uint8Array ? Array.from(args.signature) : args.signature;
    const result = await this.wallet!.verifySignature({
      data,
      signature,
      protocolID: args.protocolID as [0 | 1 | 2, string],
      keyID: args.keyID,
      counterparty: args.counterparty,
    });
    return { valid: result.valid };
  }

  async createHmac(args: CreateHmacArgs): Promise<CreateHmacResult> {
    await this.ensureInitialized();
    const data = args.data instanceof Uint8Array ? Array.from(args.data) : args.data;
    const result = await this.wallet!.createHmac({
      data,
      protocolID: args.protocolID as [0 | 1 | 2, string],
      keyID: args.keyID,
      counterparty: args.counterparty,
    });
    return { hmac: result.hmac };
  }

  async verifyHmac(args: VerifyHmacArgs): Promise<VerifyHmacResult> {
    await this.ensureInitialized();
    const data = args.data instanceof Uint8Array ? Array.from(args.data) : args.data;
    const hmac = args.hmac instanceof Uint8Array ? Array.from(args.hmac) : args.hmac;
    const result = await this.wallet!.verifyHmac({
      data,
      hmac,
      protocolID: args.protocolID as [0 | 1 | 2, string],
      keyID: args.keyID,
      counterparty: args.counterparty,
    });
    return { valid: result.valid };
  }

  async createAction(args: CreateActionArgs): Promise<CreateActionResult> {
    await this.ensureInitialized();
    const result = await this.wallet!.createAction({
      description: args.description,
      outputs: args.outputs?.map(o => ({
        lockingScript: o.script,
        satoshis: o.satoshis,
        outputDescription: o.description ?? '',
        basket: o.basket,
        tags: o.tags,
      })),
      inputs: args.inputs?.map(i => ({
        outpoint: i.outpoint,
        unlockingScript: i.unlockingScript,
        inputDescription: i.inputDescription ?? '',
      })),
      labels: args.labels,
      lockTime: args.lockTime,
      version: args.version,
    });

    let rawTx: number[] | undefined;
    if (result.tx) {
      rawTx = Array.isArray(result.tx) ? result.tx : Array.from(result.tx);
    }
    return { txid: result.txid ?? '', rawTx };
  }

  async acquireCertificate(args: AcquireCertificateArgs): Promise<AcquireCertificateResult> {
    await this.ensureInitialized();
    const result = await this.wallet!.acquireCertificate({
      type: args.type,
      certifier: args.certifier,
      acquisitionProtocol: args.acquisitionProtocol,
      fields: args.fields ?? {},
    });
    return {
      certificate: {
        type: result.type,
        serialNumber: result.serialNumber,
        subject: result.subject,
        certifier: result.certifier,
        revocationOutpoint: result.revocationOutpoint,
        fields: result.fields,
        signature: result.signature ?? '',
      },
    };
  }

  async listCertificates(args: ListCertificatesArgs): Promise<ListCertificatesResult> {
    await this.ensureInitialized();
    const result = await this.wallet!.listCertificates({
      certifiers: args.certifiers ?? [],
      types: args.types ?? [],
    });
    return {
      certificates: result.certificates.map(c => ({
        type: c.type,
        serialNumber: c.serialNumber,
        subject: c.subject,
        certifier: c.certifier,
        revocationOutpoint: c.revocationOutpoint,
        fields: c.fields,
        signature: c.signature ?? '',
      })),
    };
  }

  async getNetwork(): Promise<'mainnet' | 'testnet'> {
    return this.chain === 'main' ? 'mainnet' : 'testnet';
  }

  async getHeight(): Promise<number> {
    await this.ensureInitialized();
    return (await this.wallet!.getHeight({})).height;
  }

  async isAuthenticated(): Promise<boolean> {
    return this.initialized;
  }

  async destroy(): Promise<void> {
    if (this.wallet) {
      await this.wallet.destroy();
      this.wallet = null;
    }
    this.initialized = false;
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) await this.initialize();
  }
}

/**
 * Create an agent wallet
 *
 * @example
 * ```typescript
 * const { wallet } = await createAgentWallet({
 *   privateKeyHex: process.env.AGENT_PRIVATE_KEY!,
 *   network: 'mainnet'
 * });
 * ```
 */
export async function createAgentWallet(config: AgentWalletConfig): Promise<{ wallet: AgentWallet }> {
  const wallet = new AgentWallet(config);
  await wallet.initialize();
  return { wallet };
}
