/**
 * AGIdentity Memory Server
 *
 * MCP-compatible server exposing encrypted vault as AI memory tools.
 * Provides privacy-preserving local search without external API calls.
 *
 * Tools:
 * - memory_search: Search documents by query
 * - memory_get: Read a specific document
 * - verify_document: Get blockchain provenance proof
 */

import type { LocalEncryptedVault } from '../vault/local-encrypted-vault.js';
import type { EncryptedShadVault } from '../shad/encrypted-vault.js';
import type { VaultProof } from '../types/index.js';

/**
 * MCP-compatible tool response format
 */
export interface MCPToolResponse {
  content: Array<{ type: 'text'; text: string }>;
}

/**
 * Search result from memory_search tool
 */
export interface MemorySearchResult {
  path: string;
  score: number;
  snippet?: string;
}

/**
 * Configuration for AGIdentityMemoryServer
 */
export interface AGIdentityMemoryServerConfig {
  /** Encrypted vault instance (LocalEncryptedVault or EncryptedShadVault) */
  vault: LocalEncryptedVault | EncryptedShadVault;
  /** User's public key for EncryptedShadVault operations */
  userPublicKey?: string;
}

/**
 * Type guard to check if vault is EncryptedShadVault
 */
function isEncryptedShadVault(
  vault: LocalEncryptedVault | EncryptedShadVault
): vault is EncryptedShadVault {
  return 'searchDocumentsWithContent' in vault && 'readDocument' in vault;
}

/**
 * AGIdentity Memory Server
 *
 * Exposes encrypted vault as MCP-compatible memory tools for AI agents.
 * Supports both LocalEncryptedVault (fast local) and EncryptedShadVault (UHRP-backed).
 *
 * @example
 * ```typescript
 * const server = new AGIdentityMemoryServer({
 *   vault: localVault,
 * });
 *
 * // Search for documents
 * const results = await server.memory_search('authentication', 5);
 *
 * // Get a specific document
 * const content = await server.memory_get('notes/auth.md');
 * ```
 */
export class AGIdentityMemoryServer {
  private vault: LocalEncryptedVault | EncryptedShadVault;
  private userPublicKey?: string;

  constructor(config: AGIdentityMemoryServerConfig) {
    this.vault = config.vault;
    this.userPublicKey = config.userPublicKey;
  }

  /**
   * Search documents by query
   *
   * MCP Tool: memory_search
   *
   * @param query - Search query string
   * @param limit - Maximum number of results (default: 10)
   * @returns MCP-compatible response with search results
   */
  async memory_search(query: string, limit: number = 10): Promise<MCPToolResponse> {
    const results = await this.searchVault(query, limit);

    const responseText = JSON.stringify({
      results: results.map((r) => ({
        path: r.path,
        score: r.score,
        snippet: r.snippet,
      })),
      count: results.length,
      query,
    });

    return {
      content: [{ type: 'text', text: responseText }],
    };
  }

  /**
   * Get a specific document by path
   *
   * MCP Tool: memory_get
   *
   * @param path - Document path (e.g., 'notes/meeting.md')
   * @returns MCP-compatible response with document content
   */
  async memory_get(path: string): Promise<MCPToolResponse> {
    const content = await this.readDocument(path);

    if (content === null) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              error: 'Document not found',
              path,
            }),
          },
        ],
      };
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            path,
            content,
            length: content.length,
          }),
        },
      ],
    };
  }

  /**
   * Verify document blockchain provenance
   *
   * MCP Tool: verify_document
   *
   * @param path - Document path to verify
   * @returns MCP-compatible response with VaultProof
   */
  async verify_document(path: string): Promise<MCPToolResponse> {
    const proof = await this.getDocumentProof(path);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(proof),
        },
      ],
    };
  }

  // ===========================================================================
  // Private Implementation Methods
  // ===========================================================================

  /**
   * Search vault for documents matching query
   */
  private async searchVault(
    query: string,
    limit: number
  ): Promise<MemorySearchResult[]> {
    if (isEncryptedShadVault(this.vault)) {
      // EncryptedShadVault path
      if (!this.userPublicKey) {
        throw new Error('userPublicKey required for EncryptedShadVault');
      }

      const results = await this.vault.searchDocumentsWithContent(
        this.userPublicKey,
        query,
        { limit }
      );

      return results.map((r) => ({
        path: r.path,
        score: r.relevanceScore,
        snippet: r.snippet,
      }));
    } else {
      // LocalEncryptedVault path
      const results = await this.vault.search(query, { limit });

      return results.map((r) => ({
        path: r.path,
        score: r.score,
        snippet: r.snippet,
      }));
    }
  }

  /**
   * Read a document from the vault
   */
  private async readDocument(path: string): Promise<string | null> {
    if (isEncryptedShadVault(this.vault)) {
      // EncryptedShadVault path
      if (!this.userPublicKey) {
        throw new Error('userPublicKey required for EncryptedShadVault');
      }

      return this.vault.readDocument(this.userPublicKey, path);
    } else {
      // LocalEncryptedVault path
      return this.vault.read(path);
    }
  }

  /**
   * Get blockchain proof for a document
   */
  private async getDocumentProof(path: string): Promise<VaultProof> {
    if (isEncryptedShadVault(this.vault)) {
      // EncryptedShadVault has blockchain backing
      return this.vault.getVaultProof(path);
    } else {
      // LocalEncryptedVault has no blockchain backing
      // Check if document exists
      const content = await this.vault.read(path);
      return { exists: content !== null };
    }
  }
}

/**
 * Create an AGIdentityMemoryServer instance
 *
 * Factory function for creating memory server with the specified vault.
 *
 * @param config - Server configuration
 * @returns Configured AGIdentityMemoryServer instance
 *
 * @example
 * ```typescript
 * // With LocalEncryptedVault
 * const server = createAGIdentityMemoryServer({
 *   vault: localVault,
 * });
 *
 * // With EncryptedShadVault
 * const server = createAGIdentityMemoryServer({
 *   vault: shadVault,
 *   userPublicKey: '03abc...',
 * });
 * ```
 */
export function createAGIdentityMemoryServer(
  config: AGIdentityMemoryServerConfig
): AGIdentityMemoryServer {
  return new AGIdentityMemoryServer(config);
}
