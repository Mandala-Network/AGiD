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
 * - Blockchain-verifiable document proofs
 */

import { spawn } from 'child_process';
import { createServer } from 'http';
import type { AddressInfo } from 'net';
import { EncryptedShadVault } from './encrypted-vault.js';
import type {
  BRC100Wallet,
  ShadConfig,
  ShadResult,
  ShadStrategy,
  SecureRetrievalContext,
  SearchResult,
  VaultProof,
} from '../types/index.js';

export interface ShadBridgeConfig extends ShadConfig {
  encryptedVault: EncryptedShadVault;
  wallet: BRC100Wallet;
}

export class AGIdentityShadBridge {
  private encryptedVault: EncryptedShadVault;
  readonly wallet: BRC100Wallet;
  private config: Required<ShadConfig>;

  constructor(bridgeConfig: ShadBridgeConfig) {
    this.encryptedVault = bridgeConfig.encryptedVault;
    this.wallet = bridgeConfig.wallet;

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
   * Execute a Shad task with encrypted vault retrieval
   *
   * This is the core Edwin-style approach:
   * 1. Create secure retrieval context for user
   * 2. Start temporary retrieval server
   * 3. Execute Shad pointing to our secure endpoint
   * 4. Shad's Code Mode queries our server
   * 5. Server decrypts documents on-demand
   * 6. Return results
   */
  async executeTask(
    userPublicKey: string,
    task: string,
    options?: {
      strategy?: ShadStrategy;
      maxDepth?: number;
      maxTime?: number;
    }
  ): Promise<ShadResult> {
    // 1. Create secure retrieval context for this user
    const retrievalContext = this.createSecureRetrievalContext(userPublicKey);

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
    userPublicKey: string,
    query: string,
    options?: { limit?: number; includeContent?: boolean }
  ): Promise<Array<SearchResult & { content?: string }>> {
    const limit = options?.limit ?? 5;

    // Search for matching documents
    const searchResults = await this.encryptedVault.searchDocuments(
      userPublicKey,
      query,
      { limit }
    );

    if (!options?.includeContent) {
      return searchResults;
    }

    // Fetch content for each result
    const resultsWithContent = await Promise.all(
      searchResults.map(async (result) => {
        const content = await this.encryptedVault.readDocument(
          userPublicKey,
          result.path
        );
        return { ...result, content: content ?? undefined };
      })
    );

    return resultsWithContent;
  }

  /**
   * Create a secure retrieval context for a user
   *
   * This wraps vault access with encryption/decryption.
   * Shad's Code Mode will use these methods to access the vault.
   */
  private createSecureRetrievalContext(
    userPublicKey: string
  ): SecureRetrievalContext {
    return {
      userPublicKey,

      // Search returns paths only (no content)
      search: async (query: string, limit: number = 10): Promise<SearchResult[]> => {
        return this.encryptedVault.searchDocuments(userPublicKey, query, { limit });
      },

      // Read decrypts document on demand
      readNote: async (path: string): Promise<string | null> => {
        return this.encryptedVault.readDocument(userPublicKey, path);
      },

      // Verify document with blockchain proof
      verifyDocument: async (path: string): Promise<VaultProof> => {
        return this.encryptedVault.getVaultProof(path);
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
              const docs = this.encryptedVault.listDocuments();
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ documents: docs.map(d => d.path) }));
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
 * Create Shad bridge with default configuration
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
