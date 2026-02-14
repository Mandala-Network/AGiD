/**
 * Encrypted Shad Vault
 *
 * Manages an encrypted Obsidian-compatible vault stored on UHRP.
 * Each user's vault is encrypted with their own keys, ensuring
 * complete data isolation even when stored on shared infrastructure.
 */

import { AGIdentityStorageManager } from '../uhrp/storage-manager.js';
import type {
  BRC100Wallet,
  VaultIndex,
  VaultDocumentEntry,
  VaultSyncStats,
  VaultProof,
  SearchResult,
} from '../types/index.js';
import * as fs from 'fs/promises';
import * as path from 'path';

export interface EncryptedVaultConfig {
  storageManager: AGIdentityStorageManager;
  wallet: BRC100Wallet;
  cacheDir?: string;
}

export class EncryptedShadVault {
  private storageManager: AGIdentityStorageManager;
  readonly wallet: BRC100Wallet;
  private cacheDir: string;
  private vaultIndex: VaultIndex | null = null;
  private documentCache: Map<string, string> = new Map();

  constructor(config: EncryptedVaultConfig) {
    this.storageManager = config.storageManager;
    this.wallet = config.wallet;
    this.cacheDir = config.cacheDir ?? '/tmp/agidentity-vault-cache';
  }

  /**
   * Initialize or load a user's encrypted vault
   */
  async initializeVault(
    userPublicKey: string,
    vaultId: string
  ): Promise<VaultIndex> {
    // Try to load existing vault index from UHRP
    const existingIndex = await this.loadVaultIndex(userPublicKey, vaultId);

    if (existingIndex) {
      this.vaultIndex = existingIndex;
      return existingIndex;
    }

    // Create new vault index
    this.vaultIndex = {
      vaultId,
      userPublicKey,
      documents: [],
      lastSynced: Date.now()
    };

    // Save initial index to UHRP
    await this.saveVaultIndex();

    return this.vaultIndex;
  }

  /**
   * Get the current vault index
   */
  getVaultIndex(): VaultIndex | null {
    return this.vaultIndex;
  }

  /**
   * Sync a local Obsidian vault to encrypted UHRP storage
   *
   * Process:
   * 1. Walk local vault directory
   * 2. Compare with existing index
   * 3. Upload new/changed files (encrypted)
   * 4. Update index
   * 5. Save index to UHRP
   */
  async syncFromLocalVault(
    localVaultPath: string,
    userPublicKey: string
  ): Promise<VaultSyncStats> {
    if (!this.vaultIndex) {
      throw new Error('Vault not initialized. Call initializeVault first.');
    }

    const stats: VaultSyncStats = {
      uploaded: 0,
      updated: 0,
      unchanged: 0,
      errors: 0
    };

    // Walk the local vault
    const markdownFiles = await this.walkDirectory(localVaultPath);

    for (const filePath of markdownFiles) {
      try {
        const relativePath = path.relative(localVaultPath, filePath);
        const content = await fs.readFile(filePath);
        const contentHash = await this.hashContent(content);

        // Check if document exists and is unchanged
        const existingDoc = this.vaultIndex.documents.find(
          d => d.path === relativePath
        );

        if (existingDoc && existingDoc.contentHash === contentHash) {
          stats.unchanged++;
          continue;
        }

        // Upload new or updated document
        const uploaded = await this.storageManager.uploadVaultDocument(
          userPublicKey,
          {
            filename: relativePath,
            content: content,
            mimeType: 'text/markdown'
          }
        );

        // Update index
        if (existingDoc) {
          existingDoc.uhrpUrl = uploaded.uhrpUrl;
          existingDoc.keyId = uploaded.metadata.encryptionKeyId;
          existingDoc.lastModified = Date.now();
          existingDoc.contentHash = contentHash;
          stats.updated++;
        } else {
          this.vaultIndex.documents.push({
            path: relativePath,
            uhrpUrl: uploaded.uhrpUrl,
            keyId: uploaded.metadata.encryptionKeyId,
            lastModified: Date.now(),
            contentHash
          });
          stats.uploaded++;
        }
      } catch (error) {
        console.error(`Error syncing ${filePath}:`, error);
        stats.errors++;
      }
    }

    // Save updated index
    this.vaultIndex.lastSynced = Date.now();
    await this.saveVaultIndex();

    return stats;
  }

  /**
   * Upload a single document to the vault
   */
  async uploadDocument(
    userPublicKey: string,
    documentPath: string,
    content: string
  ): Promise<VaultDocumentEntry> {
    if (!this.vaultIndex) {
      throw new Error('Vault not initialized');
    }

    const contentBytes = new TextEncoder().encode(content);
    const contentHash = await this.hashContent(contentBytes);

    const uploaded = await this.storageManager.uploadVaultDocument(
      userPublicKey,
      {
        filename: documentPath,
        content: contentBytes,
        mimeType: 'text/markdown'
      }
    );

    const entry: VaultDocumentEntry = {
      path: documentPath,
      uhrpUrl: uploaded.uhrpUrl,
      keyId: uploaded.metadata.encryptionKeyId,
      lastModified: Date.now(),
      contentHash
    };

    // Update or add to index
    const existingIndex = this.vaultIndex.documents.findIndex(
      d => d.path === documentPath
    );

    if (existingIndex >= 0) {
      this.vaultIndex.documents[existingIndex] = entry;
    } else {
      this.vaultIndex.documents.push(entry);
    }

    await this.saveVaultIndex();

    // Update cache
    this.documentCache.set(documentPath, content);

    return entry;
  }

  /**
   * Read a document from the encrypted vault
   *
   * Used by Shad retrieval layer. Documents are decrypted on-demand
   * and cached in memory for the session.
   */
  async readDocument(
    userPublicKey: string,
    documentPath: string
  ): Promise<string | null> {
    // Check cache first
    if (this.documentCache.has(documentPath)) {
      return this.documentCache.get(documentPath)!;
    }

    const doc = this.vaultIndex?.documents.find(d => d.path === documentPath);

    if (!doc) {
      return null;
    }

    try {
      const content = await this.storageManager.downloadVaultDocument(
        userPublicKey,
        doc.uhrpUrl,
        doc.keyId
      );

      const text = new TextDecoder().decode(content);

      // Cache the decrypted content
      this.documentCache.set(documentPath, text);

      return text;
    } catch (error) {
      console.error(`Error reading document ${documentPath}:`, error);
      return null;
    }
  }

  /**
   * Search documents by path/name
   *
   * Returns document paths, not content.
   * Content retrieval requires separate decryption call.
   */
  async searchDocuments(
    _userPublicKey: string,
    query: string,
    options?: { limit?: number }
  ): Promise<SearchResult[]> {
    if (!this.vaultIndex) {
      return [];
    }

    const limit = options?.limit ?? 10;
    const lowerQuery = query.toLowerCase();

    // Score and filter documents
    const scored = this.vaultIndex.documents
      .map(doc => ({
        path: doc.path,
        uhrpUrl: doc.uhrpUrl,
        relevanceScore: this.calculateRelevance(doc.path, lowerQuery)
      }))
      .filter(doc => doc.relevanceScore > 0)
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, limit);

    return scored;
  }

  /**
   * Search documents with content matching
   *
   * This requires decrypting documents, so it's more expensive.
   * Use searchDocuments for path-only search.
   */
  async searchDocumentsWithContent(
    userPublicKey: string,
    query: string,
    options?: { limit?: number }
  ): Promise<Array<SearchResult & { snippet?: string }>> {
    if (!this.vaultIndex) {
      return [];
    }

    const limit = options?.limit ?? 10;
    const lowerQuery = query.toLowerCase();
    const results: Array<SearchResult & { snippet?: string }> = [];

    // Search through all documents
    for (const doc of this.vaultIndex.documents) {
      const content = await this.readDocument(userPublicKey, doc.path);

      if (!content) continue;

      const lowerContent = content.toLowerCase();
      const pathScore = this.calculateRelevance(doc.path, lowerQuery);
      const contentScore = lowerContent.includes(lowerQuery) ? 0.5 : 0;
      const totalScore = pathScore + contentScore;

      if (totalScore > 0) {
        // Extract snippet around match
        let snippet: string | undefined;
        const matchIndex = lowerContent.indexOf(lowerQuery);
        if (matchIndex >= 0) {
          const start = Math.max(0, matchIndex - 50);
          const end = Math.min(content.length, matchIndex + query.length + 50);
          snippet = '...' + content.slice(start, end) + '...';
        }

        results.push({
          path: doc.path,
          uhrpUrl: doc.uhrpUrl,
          relevanceScore: totalScore,
          snippet
        });
      }

      if (results.length >= limit * 2) break;  // Early exit for performance
    }

    return results
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, limit);
  }

  /**
   * List all documents in the vault
   */
  listDocuments(): VaultDocumentEntry[] {
    return this.vaultIndex?.documents ?? [];
  }

  /**
   * Get blockchain proof for a document
   */
  async getVaultProof(documentPath: string): Promise<VaultProof> {
    const doc = this.vaultIndex?.documents.find(d => d.path === documentPath);

    if (!doc) {
      return { exists: false };
    }

    try {
      const verification = await this.storageManager.verifyDocumentTimestamp(
        doc.uhrpUrl,
        Date.now()
      );

      return {
        exists: true,
        uhrpUrl: doc.uhrpUrl,
        blockchainTxId: verification.txId,
        timestamp: verification.timestamp,
        blockHeight: verification.blockHeight
      };
    } catch {
      // No blockchain timestamp found
      return {
        exists: true,
        uhrpUrl: doc.uhrpUrl
      };
    }
  }

  /**
   * Delete a document from the vault
   */
  async deleteDocument(documentPath: string): Promise<boolean> {
    if (!this.vaultIndex) {
      return false;
    }

    const index = this.vaultIndex.documents.findIndex(d => d.path === documentPath);

    if (index < 0) {
      return false;
    }

    this.vaultIndex.documents.splice(index, 1);
    this.documentCache.delete(documentPath);

    await this.saveVaultIndex();

    return true;
  }

  /**
   * Clear the document cache
   */
  clearCache(): void {
    this.documentCache.clear();
  }

  // =========================================================================
  // Private Helper Methods
  // =========================================================================

  private async loadVaultIndex(
    userPublicKey: string,
    vaultId: string
  ): Promise<VaultIndex | null> {
    // Try to load from local cache first
    const cacheFile = path.join(
      this.cacheDir,
      `index-${this.hashSync(userPublicKey)}-${vaultId}.json`
    );

    try {
      await fs.mkdir(this.cacheDir, { recursive: true });
      const cached = await fs.readFile(cacheFile, 'utf-8');
      return JSON.parse(cached);
    } catch {
      // Cache miss or error
    }

    // Try to load from UHRP
    // This would require knowing the index UHRP URL
    // For now, return null to create a new vault
    return null;
  }

  private async saveVaultIndex(): Promise<void> {
    if (!this.vaultIndex) return;

    // Save to local cache
    const cacheFile = path.join(
      this.cacheDir,
      `index-${this.hashSync(this.vaultIndex.userPublicKey)}-${this.vaultIndex.vaultId}.json`
    );

    try {
      await fs.mkdir(this.cacheDir, { recursive: true });
      await fs.writeFile(cacheFile, JSON.stringify(this.vaultIndex, null, 2));
    } catch (error) {
      console.error('Error saving vault index to cache:', error);
    }

    // Save to UHRP
    try {
      const indexContent = JSON.stringify(this.vaultIndex);
      const uploaded = await this.storageManager.uploadVaultDocument(
        this.vaultIndex.userPublicKey,
        {
          filename: `vault-index-${this.vaultIndex.vaultId}.json`,
          content: new TextEncoder().encode(indexContent),
          mimeType: 'application/json'
        },
        { skipBlockchainTimestamp: true }  // Don't timestamp every index update
      );

      this.vaultIndex.indexUhrpUrl = uploaded.uhrpUrl;
    } catch (error) {
      console.error('Error saving vault index to UHRP:', error);
    }
  }

  private async walkDirectory(dir: string): Promise<string[]> {
    const files: string[] = [];

    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          // Skip hidden directories and .obsidian
          if (!entry.name.startsWith('.')) {
            files.push(...await this.walkDirectory(fullPath));
          }
        } else if (entry.name.endsWith('.md')) {
          files.push(fullPath);
        }
      }
    } catch (error) {
      console.error(`Error walking directory ${dir}:`, error);
    }

    return files;
  }

  private async hashContent(content: Uint8Array): Promise<string> {
    const hashBuffer = await crypto.subtle.digest('SHA-256', content);
    return Array.from(new Uint8Array(hashBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  private hashSync(input: string): string {
    // Simple sync hash for cache file names
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
      const char = input.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16).slice(0, 8);
  }

  private calculateRelevance(docPath: string, query: string): number {
    const lowerPath = docPath.toLowerCase();

    // Exact match
    if (lowerPath === query) return 1.0;

    // Path contains query
    if (lowerPath.includes(query)) return 0.8;

    // Word matching
    const pathWords = lowerPath.split(/[\/\-_\s.]+/);
    const queryWords = query.split(/\s+/);

    let matchCount = 0;
    for (const queryWord of queryWords) {
      for (const pathWord of pathWords) {
        if (pathWord.includes(queryWord)) {
          matchCount++;
          break;
        }
      }
    }

    if (matchCount > 0) {
      return (matchCount / queryWords.length) * 0.6;
    }

    return 0;
  }
}
