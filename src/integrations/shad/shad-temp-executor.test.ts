/**
 * ShadTempVaultExecutor Tests
 *
 * Tests for the secure temp vault pattern Shad executor.
 * Note: Actual Shad execution is mocked since Shad may not be installed.
 */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { ShadTempVaultExecutor } from './shad-temp-executor.js';
import type { LocalEncryptedVault } from '../../storage/vault/local-encrypted-vault.js';

// Mock child_process spawn
vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

// Mock fs/promises
vi.mock('fs/promises', () => ({
  mkdtemp: vi.fn().mockResolvedValue('/tmp/agid-shad-test123'),
  chmod: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
  rm: vi.fn().mockResolvedValue(undefined),
}));

describe('ShadTempVaultExecutor', () => {
  let mockVault: LocalEncryptedVault;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create mock vault
    mockVault = {
      read: vi.fn().mockResolvedValue('mock document content'),
      list: vi.fn().mockResolvedValue(['note1.md', 'folder/note2.md']),
      search: vi.fn().mockResolvedValue([]),
      write: vi.fn().mockResolvedValue(undefined),
      initialize: vi.fn().mockResolvedValue(undefined),
      warmup: vi.fn().mockResolvedValue({ loaded: 0, errors: 0 }),
      sync: vi.fn().mockResolvedValue({ encrypted: 0, unchanged: 0, errors: 0 }),
      clearCache: vi.fn(),
      getCacheStats: vi.fn().mockReturnValue({ size: 0, documents: 0 }),
      delete: vi.fn().mockResolvedValue(true),
    } as unknown as LocalEncryptedVault;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    test('should create executor with default config', () => {
      const executor = new ShadTempVaultExecutor({
        vault: mockVault,
      });

      expect(executor).toBeDefined();
    });

    test('should create executor with custom config', () => {
      const executor = new ShadTempVaultExecutor({
        vault: mockVault,
        shadConfig: {
          pythonPath: '/usr/bin/python3',
          strategy: 'analysis',
          maxDepth: 5,
          maxTime: 600,
        },
      });

      expect(executor).toBeDefined();
    });
  });

  describe('checkShadAvailable', () => {
    test('should return available: false when Shad is not installed', async () => {
      const { spawn } = await import('child_process');
      const mockSpawn = spawn as ReturnType<typeof vi.fn>;

      // Mock process that simulates Shad not found
      const mockProcess = {
        stdout: {
          on: vi.fn(),
        },
        stderr: {
          on: vi.fn((event, cb) => {
            if (event === 'data') {
              cb(Buffer.from('No module named shad'));
            }
          }),
        },
        on: vi.fn((event, cb) => {
          if (event === 'close') {
            cb(1); // Non-zero exit code
          }
        }),
        kill: vi.fn(),
      };

      mockSpawn.mockReturnValue(mockProcess);

      const executor = new ShadTempVaultExecutor({ vault: mockVault });
      const result = await executor.checkShadAvailable();

      expect(result.available).toBe(false);
      expect(result.error).toBeDefined();
    });

    test('should return available: true when Shad is installed', async () => {
      const { spawn } = await import('child_process');
      const mockSpawn = spawn as ReturnType<typeof vi.fn>;

      // Mock process that simulates Shad found
      const mockProcess = {
        stdout: {
          on: vi.fn((event, cb) => {
            if (event === 'data') {
              cb(Buffer.from('shad 1.0.0'));
            }
          }),
        },
        stderr: {
          on: vi.fn(),
        },
        on: vi.fn((event, cb) => {
          if (event === 'close') {
            cb(0); // Success exit code
          }
        }),
        kill: vi.fn(),
      };

      mockSpawn.mockReturnValue(mockProcess);

      const executor = new ShadTempVaultExecutor({ vault: mockVault });
      const result = await executor.checkShadAvailable();

      expect(result.available).toBe(true);
      expect(result.version).toBe('shad 1.0.0');
    });

    test('should handle spawn error gracefully', async () => {
      const { spawn } = await import('child_process');
      const mockSpawn = spawn as ReturnType<typeof vi.fn>;

      // Mock process that emits an error
      const mockProcess = {
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn((event, cb) => {
          if (event === 'error') {
            cb(new Error('spawn ENOENT'));
          }
        }),
        kill: vi.fn(),
      };

      mockSpawn.mockReturnValue(mockProcess);

      const executor = new ShadTempVaultExecutor({ vault: mockVault });
      const result = await executor.checkShadAvailable();

      expect(result.available).toBe(false);
      expect(result.error).toContain('Failed to check Shad');
    });
  });

  describe('execute', () => {
    test('should throw if vault is not provided', async () => {
      // This tests the runtime check
      const executor = new ShadTempVaultExecutor({
        vault: null as unknown as LocalEncryptedVault,
      });

      await expect(executor.execute('test task')).rejects.toThrow(
        'Vault is required'
      );
    });

    test('should use filesystem retriever in CLI args (not api)', async () => {
      const { spawn } = await import('child_process');
      const { mkdtemp } = await import('fs/promises');
      const mockSpawn = spawn as ReturnType<typeof vi.fn>;
      const mockMkdtemp = mkdtemp as ReturnType<typeof vi.fn>;

      // Ensure mkdtemp returns a proper path
      mockMkdtemp.mockResolvedValue('/tmp/agid-shad-test123');

      // Track the args passed to spawn
      let capturedArgs: string[] = [];

      const mockProcess = {
        stdout: {
          on: vi.fn((event, cb) => {
            if (event === 'data') {
              cb(Buffer.from('{"output": "test result", "retrievedDocuments": []}'));
            }
          }),
        },
        stderr: { on: vi.fn() },
        on: vi.fn((event, cb) => {
          if (event === 'close') {
            setTimeout(() => cb(0), 10);
          }
        }),
        kill: vi.fn(),
      };

      mockSpawn.mockImplementation((_cmd: string, args: string[]) => {
        capturedArgs = args;
        return mockProcess;
      });

      const executor = new ShadTempVaultExecutor({ vault: mockVault });

      // Execute a task
      await executor.execute('analyze my notes');

      // Verify --retriever filesystem is used (NOT 'api')
      const retrieverIndex = capturedArgs.indexOf('--retriever');
      expect(retrieverIndex).toBeGreaterThan(-1);
      expect(capturedArgs[retrieverIndex + 1]).toBe('filesystem');

      // Ensure 'api' is NOT in the args
      expect(capturedArgs).not.toContain('api');
      expect(capturedArgs.join(' ')).not.toContain('--retriever-url');
    });

    test('should cleanup temp vault even on error', async () => {
      const { spawn } = await import('child_process');
      const { rm, mkdtemp } = await import('fs/promises');
      const mockSpawn = spawn as ReturnType<typeof vi.fn>;
      const mockRm = rm as ReturnType<typeof vi.fn>;
      const mockMkdtemp = mkdtemp as ReturnType<typeof vi.fn>;

      // Ensure mkdtemp returns a proper path
      mockMkdtemp.mockResolvedValue('/tmp/agid-shad-test123');

      // Mock process that fails
      const mockProcess = {
        stdout: { on: vi.fn() },
        stderr: {
          on: vi.fn((event, cb) => {
            if (event === 'data') {
              cb(Buffer.from('Shad error occurred'));
            }
          }),
        },
        on: vi.fn((event, cb) => {
          if (event === 'close') {
            setTimeout(() => cb(1), 10); // Error exit
          }
        }),
        kill: vi.fn(),
      };

      mockSpawn.mockReturnValue(mockProcess);

      const executor = new ShadTempVaultExecutor({ vault: mockVault });
      await executor.execute('failing task');

      // Verify rm was called for cleanup
      expect(mockRm).toHaveBeenCalledWith(
        '/tmp/agid-shad-test123',
        expect.objectContaining({ recursive: true, force: true })
      );
    });
  });
});

describe('createShadExecutor factory', () => {
  test('should return null when Shad is not available', async () => {
    const { spawn } = await import('child_process');
    const mockSpawn = spawn as ReturnType<typeof vi.fn>;

    // Mock Shad not available
    const mockProcess = {
      stdout: { on: vi.fn() },
      stderr: {
        on: vi.fn((event, cb) => {
          if (event === 'data') {
            cb(Buffer.from('No module named shad'));
          }
        }),
      },
      on: vi.fn((event, cb) => {
        if (event === 'close') {
          cb(1);
        }
      }),
      kill: vi.fn(),
    };

    mockSpawn.mockReturnValue(mockProcess);

    // Import the factory function
    const { createShadExecutor } = await import('./index.js');

    const mockVault = {
      read: vi.fn().mockResolvedValue('content'),
      list: vi.fn().mockResolvedValue([]),
    } as unknown as LocalEncryptedVault;

    // Suppress console.warn for this test
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const executor = await createShadExecutor({ vault: mockVault });

    expect(executor).toBeNull();
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });
});
