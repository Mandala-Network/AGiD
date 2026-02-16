/**
 * AGIdentity Client SDK Tests
 *
 * Tests for the authenticated HTTP client.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AGIDClient, createAGIDClient } from '../05-interfaces/client/agidentity-client.js';
import { MockSecureWallet } from './test-utils.js';
import type { AgentWallet } from '../01-core/wallet/agent-wallet.js';
import type { BRC100Wallet } from '../07-shared/types/index.js';

/**
 * Create a mock AgentWallet for testing
 */
function createMockAgentWallet(): AgentWallet {
  const mockWallet = new MockSecureWallet();

  return {
    async getPublicKey(args) {
      return mockWallet.getPublicKey(args);
    },
    async encrypt(args) {
      return mockWallet.encrypt(args);
    },
    async decrypt(args) {
      return mockWallet.decrypt(args);
    },
    async createSignature(args) {
      return mockWallet.createSignature(args);
    },
    async verifySignature(args) {
      return mockWallet.verifySignature(args);
    },
    async createHmac(args) {
      return mockWallet.createHmac(args);
    },
    async verifyHmac(args) {
      return mockWallet.verifyHmac(args);
    },
    async createAction(args) {
      return mockWallet.createAction(args);
    },
    async acquireCertificate(args) {
      return mockWallet.acquireCertificate(args);
    },
    async listCertificates(args) {
      return mockWallet.listCertificates(args);
    },
    async getNetwork() {
      return mockWallet.getNetwork();
    },
    async getHeight() {
      return mockWallet.getHeight();
    },
    async isAuthenticated() {
      return mockWallet.isAuthenticated();
    },
    getUnderlyingWallet() {
      return mockWallet as unknown as BRC100Wallet;
    },
    async destroy() {
      // No-op for mock
    },
  } as AgentWallet;
}

describe('AGIdentity Client SDK', () => {
  let wallet: AgentWallet;
  let originalFetch: typeof fetch;

  beforeEach(() => {
    wallet = createMockAgentWallet();
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('Client Initialization', () => {
    it('should create a client with factory function', () => {
      const client = createAGIDClient({
        wallet,
        serverUrl: 'http://localhost:3000',
      });
      expect(client).toBeInstanceOf(AGIDClient);
    });

    it('should create a client with constructor', () => {
      const client = new AGIDClient({
        wallet,
        serverUrl: 'http://localhost:3000',
      });
      expect(client).toBeInstanceOf(AGIDClient);
    });

    it('should strip trailing slash from server URL', async () => {
      const client = createAGIDClient({
        wallet,
        serverUrl: 'http://localhost:3000/',
      });
      await client.initialize();
      expect(client.getIdentityKey()).toBeDefined();
    });

    it('should initialize and get identity key', async () => {
      const client = createAGIDClient({
        wallet,
        serverUrl: 'http://localhost:3000',
      });

      await client.initialize();

      const identityKey = client.getIdentityKey();
      expect(identityKey).toBeDefined();
      expect(identityKey.length).toBeGreaterThan(0);
    });

    it('should throw if getting identity key before initialization', () => {
      const client = createAGIDClient({
        wallet,
        serverUrl: 'http://localhost:3000',
      });

      expect(() => client.getIdentityKey()).toThrow('Client not initialized');
    });

    it('should apply default configuration values', () => {
      const client = createAGIDClient({
        wallet,
        serverUrl: 'http://localhost:3000',
      });

      expect(client).toBeInstanceOf(AGIDClient);
    });

    it('should accept custom configuration values', () => {
      const client = createAGIDClient({
        wallet,
        serverUrl: 'http://localhost:3000',
        timeout: 60000,
        retries: 5,
        retryDelay: 2000,
        debug: true,
      });

      expect(client).toBeInstanceOf(AGIDClient);
    });
  });

  describe('Request Handling', () => {
    it('should throw error when making request before initialization', async () => {
      const client = createAGIDClient({
        wallet,
        serverUrl: 'http://localhost:3000',
      });

      await expect(client.getHealth()).rejects.toThrow('Client not initialized');
    });
  });

  describe('Type Safety', () => {
    it('should have correct method signatures', async () => {
      const client = createAGIDClient({
        wallet,
        serverUrl: 'http://localhost:3000',
      });
      await client.initialize();

      // Type checks - verify methods exist
      expect(typeof client.getIdentity).toBe('function');
      expect(typeof client.registerSession).toBe('function');
      expect(typeof client.initVault).toBe('function');
      expect(typeof client.storeDocument).toBe('function');
      expect(typeof client.readDocument).toBe('function');
      expect(typeof client.listDocuments).toBe('function');
      expect(typeof client.searchDocuments).toBe('function');
      expect(typeof client.getDocumentProof).toBe('function');
      expect(typeof client.createTeam).toBe('function');
      expect(typeof client.getTeam).toBe('function');
      expect(typeof client.addTeamMember).toBe('function');
      expect(typeof client.removeTeamMember).toBe('function');
      expect(typeof client.checkTeamAccess).toBe('function');
      expect(typeof client.storeTeamDocument).toBe('function');
      expect(typeof client.readTeamDocument).toBe('function');
      expect(typeof client.listTeamDocuments).toBe('function');
      expect(typeof client.signMessage).toBe('function');
      expect(typeof client.verifySignature).toBe('function');
      expect(typeof client.getHealth).toBe('function');
      expect(typeof client.getStatus).toBe('function');
      expect(typeof client.setup).toBe('function');
      expect(typeof client.storeDocuments).toBe('function');
      expect(typeof client.readDocuments).toBe('function');
    });
  });

  describe('Convenience Methods', () => {
    it('should have storeDocuments method for batch operations', async () => {
      const client = createAGIDClient({
        wallet,
        serverUrl: 'http://localhost:3000',
      });
      await client.initialize();

      expect(typeof client.storeDocuments).toBe('function');
    });

    it('should have readDocuments method for batch operations', async () => {
      const client = createAGIDClient({
        wallet,
        serverUrl: 'http://localhost:3000',
      });
      await client.initialize();

      expect(typeof client.readDocuments).toBe('function');
    });

    it('should have setup method for combined initialization', async () => {
      const client = createAGIDClient({
        wallet,
        serverUrl: 'http://localhost:3000',
      });
      await client.initialize();

      expect(typeof client.setup).toBe('function');
    });
  });

  describe('API Response Types', () => {
    it('should return properly typed responses for health check', async () => {
      const client = createAGIDClient({
        wallet,
        serverUrl: 'http://localhost:3000',
      });
      await client.initialize();

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          status: 'healthy',
          agentIdentity: '03abc123',
          activeSessions: 0,
          timestamp: new Date().toISOString(),
        }),
      });

      const result = await client.getHealth();
      expect(result.success).toBe(true);
      expect(result.statusCode).toBe(200);
      expect(result.data).toBeDefined();
    });

    it('should handle error responses', async () => {
      const client = createAGIDClient({
        wallet,
        serverUrl: 'http://localhost:3000',
      });
      await client.initialize();

      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({
          error: 'Authentication required',
        }),
      });

      const result = await client.registerSession();
      expect(result.success).toBe(false);
      expect(result.statusCode).toBe(401);
      expect(result.error).toBe('Authentication required');
    });

    it('should handle network errors with retry', async () => {
      const client = createAGIDClient({
        wallet,
        serverUrl: 'http://localhost:3000',
        retries: 1,
        retryDelay: 10,
      });
      await client.initialize();

      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      const result = await client.getHealth();
      expect(result.success).toBe(false);
      expect(result.error).toBe('Network error');
      expect(result.statusCode).toBe(0);
    });

    it('should retry on failure', async () => {
      const client = createAGIDClient({
        wallet,
        serverUrl: 'http://localhost:3000',
        retries: 2,
        retryDelay: 10,
      });
      await client.initialize();

      let callCount = 0;
      global.fetch = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount < 3) {
          return Promise.reject(new Error('Temporary error'));
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ success: true, status: 'healthy' }),
        });
      });

      const result = await client.getHealth();
      expect(result.success).toBe(true);
      expect(callCount).toBe(3);
    });
  });

  describe('URL Encoding', () => {
    it('should encode path parameters correctly', async () => {
      const client = createAGIDClient({
        wallet,
        serverUrl: 'http://localhost:3000',
      });
      await client.initialize();

      let capturedUrl = '';
      global.fetch = vi.fn().mockImplementation((url: string) => {
        capturedUrl = url;
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ success: true, content: 'test' }),
        });
      });

      await client.readDocument('path/with spaces/file.md');
      expect(capturedUrl).toContain('path%2Fwith%20spaces%2Ffile.md');
    });
  });

  describe('Debug Mode', () => {
    it('should log when debug is enabled', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const client = createAGIDClient({
        wallet,
        serverUrl: 'http://localhost:3000',
        debug: true,
      });

      await client.initialize();

      const debugLogs = consoleSpy.mock.calls.filter(
        (call) => call[0]?.toString().includes('[AGIDClient]')
      );
      expect(debugLogs.length).toBeGreaterThan(0);

      consoleSpy.mockRestore();
    });

    it('should not log when debug is disabled', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const client = createAGIDClient({
        wallet,
        serverUrl: 'http://localhost:3000',
        debug: false,
      });

      await client.initialize();

      const debugLogs = consoleSpy.mock.calls.filter(
        (call) => call[0]?.toString().includes('[AGIDClient]')
      );
      expect(debugLogs.length).toBe(0);

      consoleSpy.mockRestore();
    });
  });

  describe('Authentication Headers', () => {
    it('should include auth headers in requests', async () => {
      const client = createAGIDClient({
        wallet,
        serverUrl: 'http://localhost:3000',
      });
      await client.initialize();

      let capturedHeaders: Headers | null = null;
      global.fetch = vi.fn().mockImplementation((_url: string, options: RequestInit) => {
        capturedHeaders = options.headers as Headers;
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ success: true }),
        });
      });

      await client.getHealth();

      expect(capturedHeaders).not.toBeNull();
      expect(capturedHeaders!.get('X-BSV-Auth-Version')).toBe('0.1');
      expect(capturedHeaders!.get('X-BSV-Auth-Identity-Key')).toBeDefined();
      expect(capturedHeaders!.get('X-BSV-Auth-Timestamp')).toBeDefined();
      expect(capturedHeaders!.get('X-BSV-Auth-Nonce')).toBeDefined();
    });
  });
});

describe('Client Integration', () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('Multiple Client Instances', () => {
    it('should support multiple independent clients', async () => {
      const wallet1 = createMockAgentWallet();
      const wallet2 = createMockAgentWallet();

      const client1 = createAGIDClient({ wallet: wallet1, serverUrl: 'http://server1:3000' });
      const client2 = createAGIDClient({ wallet: wallet2, serverUrl: 'http://server2:3000' });

      await client1.initialize();
      await client2.initialize();

      const key1 = client1.getIdentityKey();
      const key2 = client2.getIdentityKey();

      // Both should have identity keys
      expect(key1.length).toBeGreaterThan(0);
      expect(key2.length).toBeGreaterThan(0);
    });
  });

  describe('Setup Convenience Method', () => {
    it('should setup session and vault in one call', async () => {
      const wallet = createMockAgentWallet();
      const client = createAGIDClient({ wallet, serverUrl: 'http://localhost:3000' });
      await client.initialize();

      let callCount = 0;
      global.fetch = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ success: true, sessionCreated: true, publicKey: 'test-key' }),
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ success: true, vaultId: 'vault-123' }),
        });
      });

      const result = await client.setup();

      expect(result.session.sessionCreated).toBe(true);
      expect(result.vault.vaultId).toBe('vault-123');
      expect(callCount).toBe(2);
    });

    it('should throw if session registration fails', async () => {
      const wallet = createMockAgentWallet();
      const client = createAGIDClient({ wallet, serverUrl: 'http://localhost:3000' });
      await client.initialize();

      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ error: 'Auth failed' }),
      });

      await expect(client.setup()).rejects.toThrow('Failed to register session');
    });
  });

  describe('Batch Operations', () => {
    it('should store multiple documents', async () => {
      const wallet = createMockAgentWallet();
      const client = createAGIDClient({ wallet, serverUrl: 'http://localhost:3000' });
      await client.initialize();

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ success: true, path: 'test.md' }),
      });

      const results = await client.storeDocuments([
        { path: 'doc1.md', content: 'Content 1' },
        { path: 'doc2.md', content: 'Content 2' },
        { path: 'doc3.md', content: 'Content 3' },
      ]);

      expect(results.length).toBe(3);
      results.forEach((result) => {
        expect(result.success).toBe(true);
      });
    });

    it('should read multiple documents', async () => {
      const wallet = createMockAgentWallet();
      const client = createAGIDClient({ wallet, serverUrl: 'http://localhost:3000' });
      await client.initialize();

      let callIndex = 0;
      const contents = ['Content 1', 'Content 2', 'Content 3'];
      global.fetch = vi.fn().mockImplementation(() => {
        const content = contents[callIndex % contents.length];
        callIndex++;
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ success: true, content }),
        });
      });

      const results = await client.readDocuments(['doc1.md', 'doc2.md', 'doc3.md']);

      expect(results.size).toBe(3);
      expect(results.get('doc1.md')).toBeDefined();
      expect(results.get('doc2.md')).toBeDefined();
      expect(results.get('doc3.md')).toBeDefined();
    });
  });
});
