/**
 * Local Encrypted Vault
 *
 * Encrypts an Obsidian vault locally for fast, secure access.
 * Documents are encrypted at rest and decrypted on-demand into memory.
 *
 * Architecture:
 * - Source vault: Original Obsidian .md files (can be plaintext or encrypted)
 * - Encrypted store: AES-256-GCM encrypted files in .agid/ subdirectory
 * - Memory cache: Decrypted content for fast Shad access
 * - Semantic index: Built from decrypted content for sub-second search
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { createHash, randomBytes } from 'crypto';
import { z } from 'zod';
import type { BRC100Wallet } from '../../07-shared/types/index.js';

/**
 * Configuration for local encrypted vault
 */
export interface LocalEncryptedVaultConfig {
  /** Path to the Obsidian vault directory */
  vaultPath: string;
  /** Wallet for encryption key derivation */
  wallet: BRC100Wallet;
  /** Subdirectory for encrypted files (default: .agid) */
  encryptedDir?: string;
  /** Auto-warmup cache on initialization */
  autoWarmup?: boolean;
  /** File extensions to encrypt (default: ['.md']) */
  extensions?: string[];
}

/**
 * Cached document entry
 */
interface CachedDocument {
  path: string;
  content: string;
  hash: string;
  decryptedAt: number;
}

/**
 * Encryption metadata stored with each file
 */
interface EncryptionMeta {
  version: 1;
  keyId: string;
  iv: string; // hex
  originalPath: string;
  originalHash: string;
  encryptedAt: number;
}

/**
 * Zod schema for validating encryption metadata
 */
const EncryptionMetaSchema = z.object({
  version: z.literal(1),
  keyId: z.string(),
  iv: z.string(),
  originalPath: z.string(),
  originalHash: z.string(),
  encryptedAt: z.number(),
});

/**
 * Local Encrypted Vault
 *
 * Provides fast, encrypted storage for Obsidian vaults.
 * Designed for use with Shad's RLM system.
 *
 * @example
 * ```typescript
 * const vault = new LocalEncryptedVault({
 *   vaultPath: '~/Documents/MyVault',
 *   wallet,
 *   autoWarmup: true,
 * });
 *
 * await vault.initialize();
 *
 * // Fast cached read
 * const content = await vault.read('notes/meeting.md');
 *
 * // Search across all documents
 * const results = await vault.search('authentication');
 * ```
 */
export class LocalEncryptedVault {
  private vaultPath: string;
  private encryptedDir: string;
  private wallet: BRC100Wallet;
  private extensions: string[];
  private autoWarmup: boolean;

  // Memory cache for fast access
  private cache = new Map<string, CachedDocument>();
  private initialized = false;
  private keyId: string = 'vault-master';

  constructor(config: LocalEncryptedVaultConfig) {
    this.vaultPath = config.vaultPath.replace(/^~/, process.env.HOME ?? '');
    this.encryptedDir = config.encryptedDir ?? '.agid';
    this.wallet = config.wallet;
    this.extensions = config.extensions ?? ['.md', '.markdown', '.txt'];
    this.autoWarmup = config.autoWarmup ?? true;
  }

  /**
   * Initialize the vault
   * - Creates encrypted directory if needed
   * - Optionally warms up cache with all documents
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Ensure vault path exists
    try {
      await fs.access(this.vaultPath);
    } catch {
      throw new Error(`Vault path does not exist: ${this.vaultPath}`);
    }

    // Create encrypted directory
    const encPath = path.join(this.vaultPath, this.encryptedDir);
    await fs.mkdir(encPath, { recursive: true });

    // Add to .gitignore if not already
    await this.ensureGitignore();

    this.initialized = true;

    if (this.autoWarmup) {
      await this.warmup();
    }
  }

  /**
   * Warmup cache by decrypting all documents into memory
   * Call this at session start for fast subsequent reads
   */
  async warmup(): Promise<{ loaded: number; errors: number }> {
    this.ensureInitialized();

    const files = await this.walkVault();
    let loaded = 0;
    let errors = 0;

    for (const filePath of files) {
      try {
        const content = await this.read(filePath);
        if (content !== null) {
          loaded++;
        }
      } catch {
        errors++;
      }
    }

    console.log(`Vault warmup: ${loaded} docs loaded, ${errors} errors`);
    return { loaded, errors };
  }

  /**
   * Read a document (from cache or decrypt on-demand)
   */
  async read(relativePath: string): Promise<string | null> {
    this.ensureInitialized();

    // Check cache first
    const cached = this.cache.get(relativePath);
    if (cached) {
      return cached.content;
    }

    // Try to read from encrypted store
    const encryptedPath = this.getEncryptedPath(relativePath);
    try {
      const encrypted = await fs.readFile(encryptedPath);
      const content = await this.decryptContent(encrypted);

      // Cache it
      this.cache.set(relativePath, {
        path: relativePath,
        content,
        hash: this.hashContent(content),
        decryptedAt: Date.now(),
      });

      return content;
    } catch (error) {
      // Distinguish error types
      if (error instanceof Error) {
        const nodeError = error as NodeJS.ErrnoException;

        // Permission denied - re-throw with context
        if (nodeError.code === 'EACCES') {
          throw new Error(`Permission denied reading encrypted file: ${encryptedPath}`);
        }

        // Decryption errors should propagate (file exists but is corrupted)
        if (nodeError.code !== 'ENOENT') {
          // Check for decryption-specific errors
          if (error.message.includes('decrypt') ||
              error.message.includes('cipher') ||
              error.message.includes('Invalid') ||
              error.name === 'ZodError') {
            throw new Error(
              `Decryption failed for ${relativePath}: file may be corrupted or encrypted with different key. ` +
              `Original error: ${error.message}`
            );
          }
          // Unknown error - re-throw
          throw error;
        }
      }

      // ENOENT or non-Error: Not in encrypted store, try original file
      const originalPath = path.join(this.vaultPath, relativePath);
      try {
        const content = await fs.readFile(originalPath, 'utf-8');

        // Encrypt and store for next time
        await this.encryptAndStore(relativePath, content);

        // Cache it
        this.cache.set(relativePath, {
          path: relativePath,
          content,
          hash: this.hashContent(content),
          decryptedAt: Date.now(),
        });

        return content;
      } catch (origError) {
        // Distinguish error types for original file
        if (origError instanceof Error) {
          const nodeError = origError as NodeJS.ErrnoException;
          if (nodeError.code === 'EACCES') {
            throw new Error(`Permission denied reading file: ${originalPath}`);
          }
          if (nodeError.code === 'ENOENT') {
            // File not found in either location - return null
            return null;
          }
          // Unknown error - re-throw
          throw origError;
        }
        return null;
      }
    }
  }

  /**
   * Write a document (encrypts and stores)
   */
  async write(relativePath: string, content: string): Promise<void> {
    this.ensureInitialized();

    // Encrypt and store
    await this.encryptAndStore(relativePath, content);

    // Update cache
    this.cache.set(relativePath, {
      path: relativePath,
      content,
      hash: this.hashContent(content),
      decryptedAt: Date.now(),
    });
  }

  /**
   * Search documents by content
   */
  async search(
    query: string,
    options?: { limit?: number; caseSensitive?: boolean }
  ): Promise<Array<{ path: string; score: number; snippet?: string }>> {
    this.ensureInitialized();

    const limit = options?.limit ?? 10;
    const caseSensitive = options?.caseSensitive ?? false;
    const searchQuery = caseSensitive ? query : query.toLowerCase();

    const results: Array<{ path: string; score: number; snippet?: string }> = [];

    // Ensure all docs are in cache
    if (this.cache.size === 0) {
      await this.warmup();
    }

    for (const [docPath, doc] of this.cache) {
      const content = caseSensitive ? doc.content : doc.content.toLowerCase();
      const pathLower = caseSensitive ? docPath : docPath.toLowerCase();

      // Simple scoring: path match + content match + frequency
      let score = 0;
      let snippet: string | undefined;

      // Path contains query
      if (pathLower.includes(searchQuery)) {
        score += 0.5;
      }

      // Content contains query
      const index = content.indexOf(searchQuery);
      if (index >= 0) {
        score += 0.3;

        // Count occurrences
        const occurrences = content.split(searchQuery).length - 1;
        score += Math.min(occurrences * 0.05, 0.2);

        // Extract snippet
        const start = Math.max(0, index - 50);
        const end = Math.min(doc.content.length, index + query.length + 50);
        snippet = '...' + doc.content.slice(start, end) + '...';
      }

      if (score > 0) {
        results.push({ path: docPath, score, snippet });
      }
    }

    // Sort by score descending
    results.sort((a, b) => b.score - a.score);

    return results.slice(0, limit);
  }

  /**
   * List all documents in the vault
   */
  async list(): Promise<string[]> {
    this.ensureInitialized();
    return this.walkVault();
  }

  /**
   * Sync: encrypt any new/changed plaintext files
   */
  async sync(): Promise<{ encrypted: number; unchanged: number; errors: number }> {
    this.ensureInitialized();

    const files = await this.walkVault();
    let encrypted = 0;
    let unchanged = 0;
    let errors = 0;

    for (const relativePath of files) {
      try {
        const originalPath = path.join(this.vaultPath, relativePath);
        const encryptedPath = this.getEncryptedPath(relativePath);

        const originalContent = await fs.readFile(originalPath, 'utf-8');
        const originalHash = this.hashContent(originalContent);

        // Check if encrypted version exists and is current
        try {
          const encryptedData = await fs.readFile(encryptedPath);
          const meta = this.extractMeta(encryptedData);
          if (meta && meta.originalHash === originalHash) {
            unchanged++;
            continue;
          }
        } catch {
          // No encrypted version exists
        }

        // Encrypt and store
        await this.encryptAndStore(relativePath, originalContent);
        encrypted++;
      } catch {
        errors++;
      }
    }

    return { encrypted, unchanged, errors };
  }

  /**
   * Clear the memory cache
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; documents: number } {
    let size = 0;
    for (const doc of this.cache.values()) {
      size += doc.content.length;
    }
    return { size, documents: this.cache.size };
  }

  /**
   * Delete a document
   */
  async delete(relativePath: string): Promise<boolean> {
    this.ensureInitialized();

    const encryptedPath = this.getEncryptedPath(relativePath);
    try {
      await fs.unlink(encryptedPath);
      this.cache.delete(relativePath);
      return true;
    } catch {
      return false;
    }
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('Vault not initialized. Call initialize() first.');
    }
  }

  private getEncryptedPath(relativePath: string): string {
    // Replace path separators and add .enc extension
    const safeName = relativePath.replace(/[/\\]/g, '__') + '.enc';
    return path.join(this.vaultPath, this.encryptedDir, safeName);
  }

  private async walkVault(): Promise<string[]> {
    const files: string[] = [];

    const walk = async (dir: string, prefix: string = ''): Promise<void> => {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;

        if (entry.isDirectory()) {
          // Skip hidden directories and our encrypted dir
          if (!entry.name.startsWith('.')) {
            await walk(fullPath, relativePath);
          }
        } else if (this.extensions.some(ext => entry.name.endsWith(ext))) {
          files.push(relativePath);
        }
      }
    };

    await walk(this.vaultPath);
    return files;
  }

  private async encryptAndStore(relativePath: string, content: string): Promise<void> {
    const encrypted = await this.encryptContent(relativePath, content);
    const encryptedPath = this.getEncryptedPath(relativePath);

    // Ensure directory exists
    await fs.mkdir(path.dirname(encryptedPath), { recursive: true });
    await fs.writeFile(encryptedPath, encrypted);
  }

  private async encryptContent(relativePath: string, content: string): Promise<Buffer> {
    // Generate IV
    const iv = randomBytes(12);

    // Derive encryption key using wallet
    const keyData = await this.wallet.encrypt({
      plaintext: Array.from(Buffer.from(content, 'utf-8')),
      protocolID: [2, 'agidentity-vault'],
      keyID: this.keyId,
    });

    // Create metadata
    const meta: EncryptionMeta = {
      version: 1,
      keyId: this.keyId,
      iv: iv.toString('hex'),
      originalPath: relativePath,
      originalHash: this.hashContent(content),
      encryptedAt: Date.now(),
    };

    const metaJson = JSON.stringify(meta);
    const metaBuffer = Buffer.from(metaJson, 'utf-8');
    const metaLength = Buffer.alloc(4);
    metaLength.writeUInt32BE(metaBuffer.length);

    // Format: [metaLength:4][meta:N][ciphertext:...]
    const ciphertext = Buffer.from(keyData.ciphertext);
    return Buffer.concat([metaLength, metaBuffer, ciphertext]);
  }

  private async decryptContent(encrypted: Buffer): Promise<string> {
    // Parse format: [metaLength:4][meta:N][ciphertext:...]
    const metaLength = encrypted.readUInt32BE(0);
    const metaBuffer = encrypted.slice(4, 4 + metaLength);
    const ciphertext = encrypted.slice(4 + metaLength);

    const metaRaw = JSON.parse(metaBuffer.toString('utf-8'));
    const meta = EncryptionMetaSchema.parse(metaRaw);

    // Decrypt using wallet
    const decrypted = await this.wallet.decrypt({
      ciphertext: Array.from(ciphertext),
      protocolID: [2, 'agidentity-vault'],
      keyID: meta.keyId,
    });

    return Buffer.from(decrypted.plaintext).toString('utf-8');
  }

  private extractMeta(encrypted: Buffer): EncryptionMeta | null {
    try {
      const metaLength = encrypted.readUInt32BE(0);
      const metaBuffer = encrypted.slice(4, 4 + metaLength);
      const parsed = JSON.parse(metaBuffer.toString('utf-8'));
      return EncryptionMetaSchema.parse(parsed);
    } catch {
      return null;
    }
  }

  private hashContent(content: string): string {
    return createHash('sha256').update(content).digest('hex');
  }

  private async ensureGitignore(): Promise<void> {
    const gitignorePath = path.join(this.vaultPath, '.gitignore');
    const entry = `${this.encryptedDir}/`;

    try {
      const content = await fs.readFile(gitignorePath, 'utf-8');
      if (!content.includes(entry)) {
        await fs.appendFile(gitignorePath, `\n# AGIdentity encrypted vault\n${entry}\n`);
      }
    } catch {
      // No .gitignore, create one
      await fs.writeFile(gitignorePath, `# AGIdentity encrypted vault\n${entry}\n`);
    }
  }
}

/**
 * Create a local encrypted vault
 */
export async function createLocalEncryptedVault(
  config: LocalEncryptedVaultConfig
): Promise<LocalEncryptedVault> {
  const vault = new LocalEncryptedVault(config);
  await vault.initialize();
  return vault;
}
