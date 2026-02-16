/**
 * Shad Integration Bridge
 *
 * Integrates Shannon's Daemon (Shad) with AGIdentity's encrypted vault system.
 * Provides secure retrieval layer that decrypts documents on-demand for Shad's
 * Code Mode execution.
 *
 * Key features:
 * - Secure retrieval server for Shad's Code Mode
 * - Per-user vault isolation
 * - On-demand decryption (documents never stored in plaintext on server)
 * - Memory-cached for fast RLM access
 * - Supports both local encrypted vault and UHRP-based vault
 */

import { spawn } from 'child_process';
import { createServer } from 'http';
import type { AddressInfo } from 'net';
import { EncryptedShadVault } from './encrypted-vault.js';
import { LocalEncryptedVault } from '../../02-storage/vault/local-encrypted-vault.js';
import type {
  BRC100Wallet,
  ShadConfig,
  ShadResult,
  ShadStrategy,
  SecureRetrievalContext,
  SearchResult,
  VaultProof,
} from '../../07-shared/types/index.js';

/**
 * Vault interface that both local and UHRP vaults implement
 */
interface VaultInterface {
  read(path: string): Promise<string | null>;
  search(query: string, options?: { limit?: number }): Promise<Array<{ path: string; score: number; snippet?: string }>>;
  list(): Promise<string[]>;
}

export interface ShadBridgeConfig extends ShadConfig {
  /** Local encrypted vault (fast, recommended) */
  localVault?: LocalEncryptedVault;
  /** UHRP-based vault (slower, blockchain-backed) */
  encryptedVault?: EncryptedShadVault;
  /** Wallet for identity */
  wallet: BRC100Wallet;
  /** User public key for UHRP vault access */
  userPublicKey?: string;
}

/**
 * @deprecated Use ShadTempVaultExecutor instead. This class uses non-existent
 * Shad CLI flags (--retriever api, --retriever-url) and will not work with
 * actual Shad installations. Shad only supports: auto, qmd, filesystem retrievers.
 *
 * The ShadTempVaultExecutor uses the correct approach:
 * 1. Decrypt vault to temp directory
 * 2. Run Shad with --retriever filesystem
 * 3. Cleanup temp directory in finally block
 *
 * Kept for backwards compatibility but will be removed in future versions.
 *
 * @see ShadTempVaultExecutor
 */
export class AGIdentityShadBridge {
  private localVault?: LocalEncryptedVault;
  private uhrpVault?: EncryptedShadVault;
  private userPublicKey?: string;
  readonly wallet: BRC100Wallet;
  private config: Required<ShadConfig>;

  constructor(bridgeConfig: ShadBridgeConfig) {
    this.localVault = bridgeConfig.localVault;
    this.uhrpVault = bridgeConfig.encryptedVault;
    this.userPublicKey = bridgeConfig.userPublicKey;
    this.wallet = bridgeConfig.wallet;

    if (!this.localVault && !this.uhrpVault) {
      throw new Error('Either localVault or encryptedVault must be provided');
    }

    // Set defaults
    this.config = {
      pythonPath: bridgeConfig.pythonPath ?? 'python3',
      shadPath: bridgeConfig.shadPath ?? '~/.shad',
      maxDepth: bridgeConfig.maxDepth ?? 3,
      maxNodes: bridgeConfig.maxNodes ?? 50,
      maxTime: bridgeConfig.maxTime ?? 300,
      strategy: bridgeConfig.strategy ?? 'research',
      retriever: bridgeConfig.retriever ?? 'api'
    };
  }

  /**
   * Get the active vault (prefers local for speed)
   */
  private getVault(): VaultInterface {
    if (this.localVault) {
      return {
        read: (path) => this.localVault!.read(path),
        search: (query, opts) => this.localVault!.search(query, opts),
        list: () => this.localVault!.list(),
      };
    }

    if (this.uhrpVault && this.userPublicKey) {
      return {
        read: (path) => this.uhrpVault!.readDocument(this.userPublicKey!, path),
        search: async (query, opts) => {
          const results = await this.uhrpVault!.searchDocuments(this.userPublicKey!, query, opts);
          return results.map(r => ({ path: r.path, score: r.relevanceScore }));
        },
        list: async () => this.uhrpVault!.listDocuments().map(d => d.path),
      };
    }

    throw new Error('No vault available');
  }

  /**
   * Execute a Shad task with encrypted vault retrieval
   *
   * This is the core Edwin-style approach:
   * 1. Create secure retrieval context
   * 2. Start temporary retrieval server
   * 3. Execute Shad pointing to our secure endpoint
   * 4. Shad's Code Mode queries our server
   * 5. Server decrypts documents on-demand (from cache for speed)
   * 6. Return results
   */
  async executeTask(
    task: string,
    options?: {
      strategy?: ShadStrategy;
      maxDepth?: number;
      maxTime?: number;
      userPublicKey?: string;
    }
  ): Promise<ShadResult> {
    // Use provided userPublicKey or fall back to configured one
    const userKey = options?.userPublicKey ?? this.userPublicKey;

    // 1. Create secure retrieval context
    const retrievalContext = this.createSecureRetrievalContext(userKey);

    // 2. Start secure retrieval server
    const server = await this.startSecureRetrievalServer(retrievalContext);

    try {
      // 3. Execute Shad with our secure retrieval endpoint
      const result = await this.runShad(task, server.port, {
        strategy: options?.strategy ?? this.config.strategy,
        maxDepth: options?.maxDepth ?? this.config.maxDepth,
        maxTime: options?.maxTime ?? this.config.maxTime
      });

      return result;
    } finally {
      // 4. Always stop the server
      await server.stop();
    }
  }

  /**
   * Execute a simple retrieval query without full Shad task execution
   *
   * Useful for quick lookups or when you just need to search/read documents.
   */
  async quickRetrieve(
    query: string,
    options?: { limit?: number; includeContent?: boolean }
  ): Promise<Array<{ path: string; score: number; content?: string }>> {
    const limit = options?.limit ?? 5;
    const vault = this.getVault();

    // Search for matching documents
    const searchResults = await vault.search(query, { limit });

    if (!options?.includeContent) {
      return searchResults.map(r => ({ path: r.path, score: r.score }));
    }

    // Fetch content for each result
    const resultsWithContent = await Promise.all(
      searchResults.map(async (result) => {
        const content = await vault.read(result.path);
        return { path: result.path, score: result.score, content: content ?? undefined };
      })
    );

    return resultsWithContent;
  }

  /**
   * Create a secure retrieval context
   *
   * This wraps vault access. Documents are decrypted on-demand
   * but cached in memory for fast subsequent access.
   */
  private createSecureRetrievalContext(
    userPublicKey?: string
  ): SecureRetrievalContext {
    const vault = this.getVault();

    return {
      userPublicKey: userPublicKey ?? 'local',

      // Search returns paths only (no content)
      search: async (query: string, limit: number = 10): Promise<SearchResult[]> => {
        const results = await vault.search(query, { limit });
        return results.map(r => ({
          path: r.path,
          uhrpUrl: '', // Not applicable for local vault
          relevanceScore: r.score,
        }));
      },

      // Read decrypts document on demand (cached for speed)
      readNote: async (path: string): Promise<string | null> => {
        return vault.read(path);
      },

      // Verify document - only applicable for UHRP vault
      verifyDocument: async (path: string): Promise<VaultProof> => {
        if (this.uhrpVault) {
          return this.uhrpVault.getVaultProof(path);
        }
        // Local vault doesn't have blockchain proofs
        return { exists: true };
      }
    };
  }

  /**
   * Start a temporary local HTTP server for secure retrieval
   *
   * Shad's Code Mode will call this server to search and read documents.
   * The server only lives for the duration of the task execution.
   */
  private async startSecureRetrievalServer(
    context: SecureRetrievalContext
  ): Promise<{ port: number; stop: () => Promise<void> }> {
    return new Promise((resolve, reject) => {
      const server = createServer(async (req, res) => {
        // CORS headers for local requests
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

        if (req.method === 'OPTIONS') {
          res.writeHead(200);
          res.end();
          return;
        }

        if (req.method !== 'POST') {
          res.writeHead(405);
          res.end(JSON.stringify({ error: 'Method not allowed' }));
          return;
        }

        // Parse request body
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', async () => {
          try {
            const data = JSON.parse(body);
            const url = req.url ?? '/';

            if (url === '/search') {
              // Search endpoint
              const { query, limit } = data;
              const results = await context.search(query, limit);
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ results }));
            } else if (url === '/read') {
              // Read endpoint
              const { path } = data;
              const content = await context.readNote(path);

              if (content === null) {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Document not found' }));
              } else {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ content }));
              }
            } else if (url === '/verify') {
              // Verify endpoint
              const { path } = data;
              const proof = await context.verifyDocument(path);
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify(proof));
            } else if (url === '/list') {
              // List all documents
              const vault = this.getVault();
              const docs = await vault.list();
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ documents: docs }));
            } else {
              res.writeHead(404, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Unknown endpoint' }));
            }
          } catch (error) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: String(error) }));
          }
        });
      });

      // Listen on random available port
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address() as AddressInfo;
        resolve({
          port: addr.port,
          stop: () => new Promise<void>((resolveStop) => {
            server.close(() => resolveStop());
          })
        });
      });

      server.on('error', reject);
    });
  }

  /**
   * Run Shad CLI with secure retrieval endpoint
   */
  private async runShad(
    task: string,
    retrieverPort: number,
    options: {
      strategy: ShadStrategy;
      maxDepth: number;
      maxTime: number;
    }
  ): Promise<ShadResult> {
    return new Promise((resolve, reject) => {
      const args = [
        '-m', 'shad.cli',
        'run', task,
        '--retriever', 'api',
        '--retriever-url', `http://127.0.0.1:${retrieverPort}`,
        '--strategy', options.strategy,
        '--max-depth', String(options.maxDepth),
        '--max-time', String(options.maxTime),
        '--json'
      ];

      const shadProcess = spawn(this.config.pythonPath, args, {
        env: {
          ...process.env,
          SHAD_SECURE_MODE: 'true',
          PYTHONUNBUFFERED: '1'
        },
        cwd: this.config.shadPath.replace('~', process.env.HOME ?? '')
      });

      let stdout = '';
      let stderr = '';

      shadProcess.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      shadProcess.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      shadProcess.on('error', (error) => {
        reject(new Error(`Failed to start Shad: ${error.message}`));
      });

      shadProcess.on('close', (code) => {
        if (code !== 0) {
          // Check if this is just Shad not being installed
          if (stderr.includes('No module named') || stderr.includes('not found')) {
            resolve({
              success: false,
              output: '',
              retrievedDocuments: [],
              error: 'Shad is not installed. Install with: pip install shad'
            });
            return;
          }

          resolve({
            success: false,
            output: stderr,
            retrievedDocuments: [],
            error: `Shad exited with code ${code}: ${stderr}`
          });
          return;
        }

        try {
          // Try to parse JSON output
          const result = JSON.parse(stdout);
          resolve({
            success: true,
            output: result.output ?? stdout,
            retrievedDocuments: result.retrievedDocuments ?? [],
            executionTrace: result.trace
          });
        } catch {
          // If not JSON, return as plain text
          resolve({
            success: true,
            output: stdout,
            retrievedDocuments: []
          });
        }
      });

      // Set timeout
      setTimeout(() => {
        shadProcess.kill('SIGTERM');
        resolve({
          success: false,
          output: stdout,
          retrievedDocuments: [],
          error: `Shad execution timed out after ${options.maxTime}s`
        });
      }, options.maxTime * 1000);
    });
  }

  /**
   * Check if Shad is available
   */
  async checkShadAvailable(): Promise<{
    available: boolean;
    version?: string;
    error?: string;
  }> {
    return new Promise((resolve) => {
      const process = spawn(this.config.pythonPath, ['-m', 'shad.cli', '--version']);

      let stdout = '';
      let stderr = '';

      process.stdout.on('data', (data) => { stdout += data; });
      process.stderr.on('data', (data) => { stderr += data; });

      process.on('close', (code) => {
        if (code === 0) {
          resolve({
            available: true,
            version: stdout.trim()
          });
        } else {
          resolve({
            available: false,
            error: stderr || 'Shad not found'
          });
        }
      });

      process.on('error', () => {
        resolve({
          available: false,
          error: 'Python not found or Shad not installed'
        });
      });
    });
  }
}

/**
 * Create Shad bridge with local encrypted vault (recommended for speed)
 */
export function createShadBridgeWithLocalVault(
  localVault: LocalEncryptedVault,
  wallet: BRC100Wallet,
  config?: Partial<ShadConfig>
): AGIdentityShadBridge {
  return new AGIdentityShadBridge({
    localVault,
    wallet,
    ...config
  });
}

/**
 * Create Shad bridge with UHRP vault (blockchain-backed, slower)
 */
export function createShadBridgeWithUHRP(
  encryptedVault: EncryptedShadVault,
  wallet: BRC100Wallet,
  userPublicKey: string,
  config?: Partial<ShadConfig>
): AGIdentityShadBridge {
  return new AGIdentityShadBridge({
    encryptedVault,
    wallet,
    userPublicKey,
    ...config
  });
}

/**
 * Create Shad bridge with default configuration
 * @deprecated Use createShadBridgeWithLocalVault for better performance
 */
export function createShadBridge(
  encryptedVault: EncryptedShadVault,
  wallet: BRC100Wallet,
  config?: Partial<ShadConfig>
): AGIdentityShadBridge {
  return new AGIdentityShadBridge({
    encryptedVault,
    wallet,
    ...config
  });
}
