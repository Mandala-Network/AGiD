/**
 * UHRP Storage Manager
 *
 * Manages encrypted file storage using UHRP (Universal Hash Resolution Protocol).
 * Files are encrypted with user-specific keys before upload, and timestamped on
 * the BSV blockchain for verifiable proof of existence.
 */

import type {
  BRC100Wallet,
  UHRPDocument,
  UHRPDocumentMetadata,
  UploadFileResult,
  DownloadResult,
  FindFileData,
  RenewFileResult,
} from '../../07-shared/types/index.js';

export interface StorageManagerConfig {
  storageUrl: string;
  wallet: BRC100Wallet;
  network?: 'mainnet' | 'testnet';
}

export interface UploadOptions {
  retentionDays?: number;
  skipBlockchainTimestamp?: boolean;
}

export class AGIdentityStorageManager {
  private storageUrl: string;
  private wallet: BRC100Wallet;
  private network: 'mainnet' | 'testnet';

  constructor(config: StorageManagerConfig) {
    this.storageUrl = config.storageUrl;
    this.wallet = config.wallet;
    this.network = config.network ?? 'mainnet';
  }

  /**
   * Upload and encrypt a vault document
   *
   * Process:
   * 1. Derive encryption key for this document (BRC-42)
   * 2. Encrypt document content with AES-256-GCM
   * 3. Upload encrypted data to UHRP storage
   * 4. Create blockchain timestamp transaction
   */
  async uploadVaultDocument(
    userPublicKey: string,
    document: {
      filename: string;
      content: Uint8Array;
      mimeType: string;
    },
    options: UploadOptions = {}
  ): Promise<UHRPDocument> {
    const retentionDays = options.retentionDays ?? 365;

    // 1. Generate unique key ID for this document
    const keyId = this.generateKeyId(document.filename);

    // 2. Encrypt document content using BRC-42 derived key
    const encryptedContent = await this.wallet.encrypt({
      plaintext: Array.from(document.content),
      protocolID: [2, 'agidentity-vault'],  // Level 2 = per-counterparty
      keyID: keyId,
      counterparty: userPublicKey
    });

    // 3. Calculate content hash for UHRP URL
    const contentHash = await this.sha256(new Uint8Array(encryptedContent.ciphertext));
    const uhrpUrl = `uhrp://${this.bufferToHex(contentHash)}`;

    // 4. Upload to UHRP storage provider
    const uploadResult = await this.uploadToProvider(
      new Uint8Array(encryptedContent.ciphertext),
      retentionDays * 24 * 60  // Convert to minutes
    );

    // 5. Create blockchain timestamp (unless skipped)
    let blockchainTxId: string | undefined;
    if (!options.skipBlockchainTimestamp) {
      blockchainTxId = await this.createBlockchainTimestamp(
        uhrpUrl,
        userPublicKey,
        document.filename,
        contentHash
      );
    }

    const metadata: UHRPDocumentMetadata = {
      filename: document.filename,
      mimeType: document.mimeType,
      uploadedAt: Date.now(),
      expiresAt: Date.now() + (retentionDays * 24 * 60 * 60 * 1000),
      userPublicKey,
      encryptionKeyId: keyId,
      contentHash: this.bufferToHex(contentHash)
    };

    return {
      uhrpUrl: uploadResult.uhrpUrl,
      encryptedContent: new Uint8Array(encryptedContent.ciphertext),
      metadata,
      blockchainTxId
    };
  }

  /**
   * Download and decrypt a vault document
   *
   * Only succeeds if the caller has the correct decryption key
   * (i.e., they are the original owner or have been granted access)
   */
  async downloadVaultDocument(
    userPublicKey: string,
    uhrpUrl: string,
    encryptionKeyId: string
  ): Promise<Uint8Array> {
    // 1. Resolve UHRP URL to HTTP URLs
    const httpUrls = await this.resolveUhrpUrl(uhrpUrl);

    if (httpUrls.length === 0) {
      throw new Error(`Could not resolve UHRP URL: ${uhrpUrl}`);
    }

    // 2. Download from first available provider
    const downloadResult = await this.downloadFromProvider(httpUrls[0]);

    // 3. Verify content hash matches UHRP URL
    const expectedHash = this.extractHashFromUrl(uhrpUrl);
    const actualHash = await this.sha256(downloadResult.data);

    if (!this.compareHashes(expectedHash, actualHash)) {
      throw new Error('Content hash mismatch - file may be corrupted');
    }

    // 4. Decrypt with user's key
    const decrypted = await this.wallet.decrypt({
      ciphertext: Array.from(downloadResult.data),
      protocolID: [2, 'agidentity-vault'],
      keyID: encryptionKeyId,
      counterparty: userPublicKey
    });

    return new Uint8Array(decrypted.plaintext);
  }

  /**
   * Find file metadata by UHRP URL
   */
  async findFile(uhrpUrl: string): Promise<FindFileData | null> {
    try {
      const response = await fetch(`${this.storageUrl}/find`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uhrpUrl })
      });

      if (!response.ok) {
        return null;
      }

      return await response.json() as FindFileData;
    } catch {
      return null;
    }
  }

  /**
   * List all uploads for a user
   */
  async listUploads(_userPublicKey: string): Promise<UHRPDocumentMetadata[]> {
    // This would query an index of user's uploads
    // Implementation depends on your storage backend
    return [];
  }

  /**
   * Renew file storage
   */
  async renewFile(
    uhrpUrl: string,
    additionalDays: number
  ): Promise<RenewFileResult> {
    const response = await fetch(`${this.storageUrl}/renew`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        uhrpUrl,
        additionalMinutes: additionalDays * 24 * 60
      })
    });

    if (!response.ok) {
      throw new Error(`Failed to renew file: ${response.statusText}`);
    }

    return await response.json() as RenewFileResult;
  }

  /**
   * Verify document existed at a specific time using blockchain timestamp
   */
  async verifyDocumentTimestamp(
    uhrpUrl: string,
    expectedBeforeTime: number
  ): Promise<{
    verified: boolean;
    timestamp: number;
    blockHeight: number;
    txId: string;
  }> {
    // Query blockchain for timestamp transaction
    const timestampTx = await this.queryTimestampTransaction(uhrpUrl);

    if (!timestampTx) {
      throw new Error('No blockchain timestamp found for document');
    }

    return {
      verified: timestampTx.timestamp <= expectedBeforeTime,
      timestamp: timestampTx.timestamp,
      blockHeight: timestampTx.blockHeight,
      txId: timestampTx.txId
    };
  }

  /**
   * Get UHRP URL for file contents without uploading
   */
  getUrlForContent(content: Uint8Array): string {
    // Synchronous hash - would need async in real implementation
    // This is a placeholder
    const hash = this.syncSha256(content);
    return `uhrp://${this.bufferToHex(hash)}`;
  }

  /**
   * Validate UHRP URL format
   */
  isValidUrl(url: string): boolean {
    if (!url.startsWith('uhrp://')) {
      return false;
    }

    const hash = url.slice(7);

    // Should be 64 hex characters (32 bytes)
    if (hash.length !== 64) {
      return false;
    }

    return /^[0-9a-fA-F]+$/.test(hash);
  }

  // =========================================================================
  // Private Helper Methods
  // =========================================================================

  private generateKeyId(filename: string): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 10);
    return `vault-${filename.replace(/[^a-zA-Z0-9]/g, '-')}-${timestamp}-${random}`;
  }

  private async uploadToProvider(
    data: Uint8Array,
    retentionMinutes: number
  ): Promise<UploadFileResult> {
    const response = await fetch(`${this.storageUrl}/upload`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-Retention-Minutes': String(retentionMinutes)
      },
      body: data
    });

    if (!response.ok) {
      throw new Error(`Upload failed: ${response.statusText}`);
    }

    const result = await response.json() as { uhrpUrl: string };
    return {
      published: true,
      uhrpUrl: result.uhrpUrl
    };
  }

  private async resolveUhrpUrl(uhrpUrl: string): Promise<string[]> {
    // Query UHRP resolution service (configurable via env)
    const { getUhrpResolver } = await import('../../01-core/config/index.js');
    const lookupUrl = getUhrpResolver(this.network);

    try {
      const response = await fetch(lookupUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uhrpUrl })
      });

      if (!response.ok) {
        return [];
      }

      const result = await response.json() as { urls?: string[] };
      return result.urls ?? [];
    } catch {
      // Fallback to direct provider URL
      return [`${this.storageUrl}/download/${uhrpUrl.slice(7)}`];
    }
  }

  private async downloadFromProvider(url: string): Promise<DownloadResult> {
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Download failed: ${response.statusText}`);
    }

    const data = new Uint8Array(await response.arrayBuffer());
    const mimeType = response.headers.get('Content-Type') ?? 'application/octet-stream';

    return { data, mimeType };
  }

  private async createBlockchainTimestamp(
    uhrpUrl: string,
    userPublicKey: string,
    filename: string,
    contentHash: Uint8Array
  ): Promise<string> {
    // Create OP_RETURN transaction with timestamp data
    const timestampData = {
      type: 'agidentity-vault-timestamp',
      version: 1,
      uhrpUrl,
      userPubKeyHash: await this.hashPublicKey(userPublicKey),
      filenameHash: await this.hashFilename(filename),
      contentHash: this.bufferToHex(contentHash),
      timestamp: Date.now()
    };

    const dataBytes = new TextEncoder().encode(JSON.stringify(timestampData));
    const script = this.createOpReturnScript(dataBytes);

    const result = await this.wallet.createAction({
      description: 'AGIdentity Vault Timestamp',
      outputs: [{
        script,
        satoshis: 0
      }],
      labels: ['agidentity', 'vault-timestamp', 'uhrp']
    });

    return result.txid;
  }

  private async queryTimestampTransaction(_uhrpUrl: string): Promise<{
    timestamp: number;
    blockHeight: number;
    txId: string;
  } | null> {
    // Query blockchain or overlay service for timestamp
    // This would use a BSV node or indexer service
    // Placeholder implementation
    return null;
  }

  private createOpReturnScript(data: Uint8Array): string {
    // OP_FALSE OP_RETURN <data>
    // In hex: 00 6a <push_data> <data>
    const dataHex = this.bufferToHex(data);
    const pushOp = data.length < 76
      ? data.length.toString(16).padStart(2, '0')
      : data.length < 256
        ? '4c' + data.length.toString(16).padStart(2, '0')
        : '4d' + data.length.toString(16).padStart(4, '0');

    return `006a${pushOp}${dataHex}`;
  }

  private async sha256(data: Uint8Array): Promise<Uint8Array> {
    const hash = await crypto.subtle.digest('SHA-256', data);
    return new Uint8Array(hash);
  }

  private syncSha256(data: Uint8Array): Uint8Array {
    // Synchronous SHA256 - would need a sync crypto library
    // Placeholder that returns the first 32 bytes
    const result = new Uint8Array(32);
    for (let i = 0; i < 32 && i < data.length; i++) {
      result[i] = data[i];
    }
    return result;
  }

  private async hashPublicKey(pubKey: string): Promise<string> {
    const data = new TextEncoder().encode(pubKey);
    const hash = await this.sha256(data);
    return this.bufferToHex(hash).slice(0, 16);
  }

  private async hashFilename(filename: string): Promise<string> {
    const data = new TextEncoder().encode(filename);
    const hash = await this.sha256(data);
    return this.bufferToHex(hash).slice(0, 16);
  }

  private extractHashFromUrl(uhrpUrl: string): Uint8Array {
    const hex = uhrpUrl.slice(7);  // Remove "uhrp://"
    return this.hexToBuffer(hex);
  }

  private compareHashes(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false;

    let result = 0;
    for (let i = 0; i < a.length; i++) {
      result |= a[i] ^ b[i];
    }

    return result === 0;
  }

  private bufferToHex(buffer: Uint8Array): string {
    return Array.from(buffer)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  private hexToBuffer(hex: string): Uint8Array {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
      bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
    }
    return bytes;
  }
}
