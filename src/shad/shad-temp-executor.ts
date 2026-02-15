/**
 * ShadTempVaultExecutor
 *
 * Executes Shad tasks using a secure temp vault pattern.
 * This replaces the non-functional AGIdentityShadBridge HTTP API approach.
 *
 * Process:
 * 1. Create secure temp directory (0o700 permissions)
 * 2. Decrypt all documents from encrypted vault to temp directory
 * 3. Run Shad with --retriever filesystem pointing to temp vault
 * 4. ALWAYS cleanup temp directory in finally block (security critical)
 *
 * @module agidentity/shad
 */

import { spawn } from 'child_process';
import { mkdtemp, chmod, mkdir, writeFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import type { LocalEncryptedVault } from '../vault/local-encrypted-vault.js';
import type { EncryptedShadVault } from './encrypted-vault.js';
import type {
  ShadConfig,
  ShadResult,
  ShadStrategy,
} from '../types/index.js';

/**
 * Vault interface that both LocalEncryptedVault and EncryptedShadVault implement
 */
interface VaultReader {
  read(path: string): Promise<string | null>;
  list(): Promise<string[]>;
}

/**
 * Options for Shad execution
 */
export interface ShadExecuteOptions {
  /** Shad strategy (default: 'research') */
  strategy?: ShadStrategy;
  /** Maximum recursion depth (default: 3) */
  maxDepth?: number;
  /** Maximum execution time in seconds (default: 300) */
  maxTime?: number;
  /** Additional CLI arguments */
  additionalArgs?: string[];
}

/**
 * Configuration for ShadTempVaultExecutor
 */
export interface ShadTempVaultExecutorConfig {
  /** The encrypted vault to read from */
  vault: LocalEncryptedVault | EncryptedShadVault;
  /** User public key (required for EncryptedShadVault) */
  userPublicKey?: string;
  /** Shad configuration */
  shadConfig?: Partial<ShadConfig>;
}

/**
 * Result of checking Shad availability
 */
export interface ShadAvailability {
  available: boolean;
  version?: string;
  error?: string;
}

/**
 * ShadTempVaultExecutor - Executes Shad with secure temp vault pattern
 *
 * Uses the correct Shad CLI flags:
 * - --retriever filesystem (NOT 'api' which doesn't exist)
 * - --vault pointing to decrypted temp directory
 *
 * @example
 * ```typescript
 * const executor = new ShadTempVaultExecutor({
 *   vault: localEncryptedVault,
 *   shadConfig: { strategy: 'research' }
 * });
 *
 * const result = await executor.execute('Analyze all patterns in my notes');
 * console.log(result.output);
 * ```
 */
export class ShadTempVaultExecutor {
  private readonly vault: LocalEncryptedVault | EncryptedShadVault;
  private readonly userPublicKey?: string;
  private readonly config: Required<Omit<ShadConfig, 'retriever'>>;

  constructor(config: ShadTempVaultExecutorConfig) {
    this.vault = config.vault;
    this.userPublicKey = config.userPublicKey;

    // Set defaults (retriever is always 'filesystem' for temp vault pattern)
    this.config = {
      pythonPath: config.shadConfig?.pythonPath ?? 'python3',
      shadPath: config.shadConfig?.shadPath ?? '~/.shad',
      maxDepth: config.shadConfig?.maxDepth ?? 3,
      maxNodes: config.shadConfig?.maxNodes ?? 50,
      maxTime: config.shadConfig?.maxTime ?? 300,
      strategy: config.shadConfig?.strategy ?? 'research',
    };
  }

  /**
   * Check if Shad is available on the system
   */
  async checkShadAvailable(): Promise<ShadAvailability> {
    return new Promise((resolve) => {
      const proc = spawn(this.config.pythonPath, ['-m', 'shad.cli', '--version']);

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve({
            available: true,
            version: stdout.trim(),
          });
        } else {
          resolve({
            available: false,
            error: stderr || 'Shad not found or not installed',
          });
        }
      });

      proc.on('error', (error) => {
        resolve({
          available: false,
          error: `Failed to check Shad: ${error.message}`,
        });
      });

      // Timeout after 10 seconds
      setTimeout(() => {
        proc.kill('SIGTERM');
        resolve({
          available: false,
          error: 'Shad availability check timed out',
        });
      }, 10000);
    });
  }

  /**
   * Execute a Shad task with secure temp vault pattern
   *
   * @param task - The task description for Shad to execute
   * @param options - Optional execution parameters
   * @returns ShadResult with output and retrieved documents
   */
  async execute(task: string, options?: ShadExecuteOptions): Promise<ShadResult> {
    // Validate vault is provided
    if (!this.vault) {
      throw new Error('Vault is required for ShadTempVaultExecutor');
    }

    // 1. Create secure temp directory (0o700 = owner read/write/execute only)
    const tempDir = await mkdtemp(join(tmpdir(), 'agid-shad-'));
    await chmod(tempDir, 0o700);

    try {
      // 2. Decrypt all documents to temp vault
      await this.decryptToTempVault(tempDir);

      // 3. Run Shad with filesystem retriever
      return await this.runShad(task, tempDir, options);
    } finally {
      // 4. ALWAYS cleanup temp vault (security critical)
      await this.secureCleanup(tempDir);
    }
  }

  /**
   * Decrypt all documents from the encrypted vault to the temp directory
   */
  private async decryptToTempVault(tempDir: string): Promise<void> {
    const vaultReader = this.getVaultReader();
    const docs = await vaultReader.list();

    for (const docPath of docs) {
      const content = await vaultReader.read(docPath);
      if (content) {
        const tempPath = join(tempDir, docPath);

        // Ensure parent directory exists
        await mkdir(dirname(tempPath), { recursive: true });

        // Write decrypted content to temp file
        await writeFile(tempPath, content, { encoding: 'utf-8', mode: 0o600 });
      }
    }
  }

  /**
   * Get a consistent vault reader interface
   */
  private getVaultReader(): VaultReader {
    // Check if it's an EncryptedShadVault (has readDocument method)
    if ('readDocument' in this.vault && typeof this.vault.readDocument === 'function') {
      const uhrpVault = this.vault as EncryptedShadVault;
      const userKey = this.userPublicKey;

      if (!userKey) {
        throw new Error('userPublicKey is required for EncryptedShadVault');
      }

      return {
        read: (path: string) => uhrpVault.readDocument(userKey, path),
        list: async () => uhrpVault.listDocuments().map((d) => d.path),
      };
    }

    // LocalEncryptedVault
    const localVault = this.vault as LocalEncryptedVault;
    return {
      read: (path: string) => localVault.read(path),
      list: () => localVault.list(),
    };
  }

  /**
   * Run Shad CLI with filesystem retriever pointing to temp vault
   */
  private async runShad(
    task: string,
    tempVaultPath: string,
    options?: ShadExecuteOptions
  ): Promise<ShadResult> {
    return new Promise((resolve, reject) => {
      // Build CLI arguments with correct Shad flags
      // NOTE: --retriever 'filesystem' is the correct flag (NOT 'api')
      const args = [
        '-m',
        'shad.cli',
        'run',
        task,
        '--vault',
        tempVaultPath,
        '--retriever',
        'filesystem', // Correct retriever - NOT 'api'!
        '--strategy',
        options?.strategy ?? this.config.strategy,
        '--max-depth',
        String(options?.maxDepth ?? this.config.maxDepth),
        '--max-time',
        String(options?.maxTime ?? this.config.maxTime),
        '--json',
      ];

      // Add any additional arguments
      if (options?.additionalArgs) {
        args.push(...options.additionalArgs);
      }

      const shadProcess = spawn(this.config.pythonPath, args, {
        env: {
          ...process.env,
          PYTHONUNBUFFERED: '1',
        },
        cwd: this.config.shadPath.replace('~', process.env.HOME ?? ''),
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
          // Check if this is Shad not being installed
          if (stderr.includes('No module named') || stderr.includes('not found')) {
            resolve({
              success: false,
              output: '',
              retrievedDocuments: [],
              error: 'Shad is not installed. Install with: pip install shad',
            });
            return;
          }

          resolve({
            success: false,
            output: stderr,
            retrievedDocuments: [],
            error: `Shad exited with code ${code}: ${stderr}`,
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
            executionTrace: result.trace,
          });
        } catch {
          // If not JSON, return as plain text
          resolve({
            success: true,
            output: stdout,
            retrievedDocuments: [],
          });
        }
      });

      // Set timeout
      const maxTime = options?.maxTime ?? this.config.maxTime;
      setTimeout(() => {
        shadProcess.kill('SIGTERM');
        resolve({
          success: false,
          output: stdout,
          retrievedDocuments: [],
          error: `Shad execution timed out after ${maxTime}s`,
        });
      }, maxTime * 1000);
    });
  }

  /**
   * Securely cleanup the temp vault directory
   * This ALWAYS runs via finally block for security
   */
  private async secureCleanup(tempDir: string): Promise<void> {
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch (error) {
      // Log but don't throw - cleanup errors shouldn't break the execution
      console.error(`Warning: Failed to cleanup temp vault at ${tempDir}:`, error);
    }
  }
}
