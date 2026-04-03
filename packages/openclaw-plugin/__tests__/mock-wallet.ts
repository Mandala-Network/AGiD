/**
 * Stateful mock wallet for integration tests.
 *
 * Tracks outputs, tokens, and memory state so tests can verify
 * that the plugin's proxy wiring actually passes data through correctly.
 * Uses consistent data transformations (hex encoding, Buffer round-trips)
 * but does NOT perform real cryptographic operations.
 */

interface MockOutput {
  outpoint: string;
  satoshis: number;
  lockingScript: string;
  basket?: string;
  tags?: string[];
  customInstructions?: string;
  spendable: boolean;
}

let txCounter = 0;

export class MockAgentWallet {
  private publicKey = '02' + 'ab'.repeat(32);
  private networkValue: 'mainnet' | 'testnet';
  private outputs: MockOutput[] = [];
  private balanceValue = 100000;

  constructor(network: 'mainnet' | 'testnet' = 'testnet') {
    this.networkValue = network;
  }

  async getPublicKey(args: { identityKey?: boolean; protocolID?: [number, string]; keyID?: string }) {
    if (args.protocolID && args.keyID) {
      const derived = '03' + Buffer.from(
        `${args.protocolID[1]}-${args.keyID}`.padEnd(32, '0')
      ).toString('hex').slice(0, 64);
      return { publicKey: derived };
    }
    return { publicKey: this.publicKey };
  }

  async encrypt(args: { plaintext: number[] | Uint8Array; protocolID: [number, string]; keyID: string; counterparty?: string }) {
    const plainBytes = Array.isArray(args.plaintext) ? args.plaintext : Array.from(args.plaintext);
    const marker = Buffer.from(`ENC:${args.protocolID[1]}:${args.keyID}:`);
    const ciphertext = [...Array.from(marker), ...plainBytes];
    return { ciphertext };
  }

  async decrypt(args: { ciphertext: number[] | Uint8Array; protocolID: [number, string]; keyID: string; counterparty?: string }) {
    const cipherBytes = Array.isArray(args.ciphertext) ? args.ciphertext : Array.from(args.ciphertext);
    const marker = `ENC:${args.protocolID[1]}:${args.keyID}:`;
    const markerBytes = Array.from(Buffer.from(marker));
    const actualMarker = Buffer.from(cipherBytes.slice(0, markerBytes.length)).toString();
    if (actualMarker !== marker) {
      throw new Error(`Decrypt failed: key mismatch. Expected marker "${marker}", got "${actualMarker}"`);
    }
    const plaintext = cipherBytes.slice(markerBytes.length);
    return { plaintext };
  }

  async createSignature(args: { data: number[] | Uint8Array; protocolID: [number, string]; keyID: string }) {
    const dataBytes = Array.isArray(args.data) ? args.data : Array.from(args.data);
    const sigInput = `SIG:${args.protocolID[1]}:${args.keyID}:${Buffer.from(dataBytes).toString('hex')}`;
    const signature = Array.from(Buffer.from(sigInput));
    return { signature };
  }

  async verifySignature(args: { data: number[] | Uint8Array; signature: number[] | Uint8Array; protocolID: [number, string]; keyID: string }) {
    const dataBytes = Array.isArray(args.data) ? args.data : Array.from(args.data);
    const expected = `SIG:${args.protocolID[1]}:${args.keyID}:${Buffer.from(dataBytes).toString('hex')}`;
    const actual = Buffer.from(Array.isArray(args.signature) ? args.signature : Array.from(args.signature)).toString();
    return { valid: actual === expected };
  }

  async createHmac(args: { data: number[] | Uint8Array; protocolID: [number, string]; keyID: string }) {
    const dataBytes = Array.isArray(args.data) ? args.data : Array.from(args.data);
    const hmacInput = `HMAC:${args.protocolID[1]}:${args.keyID}:${Buffer.from(dataBytes).toString('hex')}`;
    return { hmac: Array.from(Buffer.from(hmacInput)) };
  }

  async verifyHmac(args: { data: number[] | Uint8Array; hmac: number[] | Uint8Array; protocolID: [number, string]; keyID: string }) {
    const dataBytes = Array.isArray(args.data) ? args.data : Array.from(args.data);
    const expected = `HMAC:${args.protocolID[1]}:${args.keyID}:${Buffer.from(dataBytes).toString('hex')}`;
    const actual = Buffer.from(Array.isArray(args.hmac) ? args.hmac : Array.from(args.hmac)).toString();
    return { valid: actual === expected };
  }

  async createAction(args: {
    description: string;
    outputs?: Array<{ script: string; satoshis: number; description?: string; basket?: string; tags?: string[]; customInstructions?: string }>;
    inputs?: Array<{ outpoint: string; unlockingScript?: string; inputDescription?: string }>;
  }) {
    const txid = `mock_tx_${++txCounter}_${Date.now().toString(16)}`;
    if (args.inputs) {
      for (const input of args.inputs) {
        const output = this.outputs.find(o => o.outpoint === input.outpoint && o.spendable);
        if (!output) throw new Error(`Output not found or already spent: ${input.outpoint}`);
        output.spendable = false;
        this.balanceValue += output.satoshis;
      }
    }
    if (args.outputs) {
      args.outputs.forEach((out, i) => {
        this.outputs.push({
          outpoint: `${txid}.${i}`,
          satoshis: out.satoshis,
          lockingScript: out.script,
          basket: out.basket,
          tags: out.tags,
          customInstructions: out.customInstructions,
          spendable: true,
        });
        this.balanceValue -= out.satoshis;
      });
    }
    return { txid };
  }

  async listOutputs(args: { basket: string; tags?: string[]; include?: string }) {
    const filtered = this.outputs.filter(o => {
      if (o.basket !== args.basket) return false;
      if (!o.spendable) return false;
      if (args.tags && args.tags.length > 0) {
        if (!o.tags || !args.tags.every(t => o.tags!.includes(t))) return false;
      }
      return true;
    });
    return {
      totalOutputs: filtered.length,
      outputs: filtered.map(o => ({
        outpoint: o.outpoint,
        satoshis: o.satoshis,
        lockingScript: o.lockingScript,
        customInstructions: o.customInstructions,
        spendable: o.spendable,
      })),
    };
  }

  async acquireCertificate() { return { certificate: {} as any }; }
  async listCertificates() { return { totalCertificates: 0, certificates: [] }; }
  async getNetwork() { return this.networkValue; }
  async getHeight() { return 800000; }
  async isAuthenticated() { return true; }
  async getBalance() { return this.balanceValue; }
  getMessageBoxClient() { return null; }
  getUnderlyingWallet() { return null; }
  asWalletInterface(): any { return this; }
}
