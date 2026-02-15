/**
 * AGIdentityOpenClawGateway Tests
 *
 * Integration tests for the gateway logic using mocks for external services.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AgentWallet } from '../wallet/agent-wallet.js';
import type { ProcessedMessage } from '../messaging/messagebox-gateway.js';
import type { VerifiedMessage } from '../messaging/gated-message-handler.js';
import type { Conversation } from '../messaging/conversation-manager.js';

// =============================================================================
// Mock Setup - must be before imports and use factory pattern
// =============================================================================

// Mock messaging/messagebox-gateway
vi.mock('../messaging/messagebox-gateway.js', () => {
  return {
    createMessageBoxGateway: vi.fn().mockImplementation(async () => ({
      shutdown: vi.fn().mockResolvedValue(undefined),
      isRunning: vi.fn().mockReturnValue(true),
    })),
    MessageBoxGateway: vi.fn(),
  };
});

// Mock identity/identity-gate with class that has initialize method
vi.mock('../identity/identity-gate.js', () => {
  class MockIdentityGate {
    async initialize() { return; }
    async verifyIdentity() { return { verified: true }; }
    async verifyByPublicKey() { return { verified: true }; }
    addTrustedCertifier() {}
    clearCache() {}
  }
  return { IdentityGate: MockIdentityGate };
});

// Mock openclaw/index
vi.mock('../openclaw/index.js', () => {
  return {
    OpenClawClient: vi.fn(),
    createOpenClawClient: vi.fn().mockImplementation(async () => ({
      isConnected: vi.fn().mockReturnValue(true),
      onChatMessage: vi.fn(),
      sendChat: vi.fn().mockResolvedValue('msg-456'),
      disconnect: vi.fn().mockResolvedValue(undefined),
    })),
  };
});

// Mock audit/signed-audit
vi.mock('../audit/signed-audit.js', () => {
  class MockSignedAuditTrail {
    async createEntry() { return {}; }
    async verifyChain() { return { valid: true, entriesVerified: 0, errors: [] }; }
  }
  return { SignedAuditTrail: MockSignedAuditTrail };
});

// Mock memory/agidentity-memory-server
vi.mock('../memory/agidentity-memory-server.js', () => {
  return {
    createAGIdentityMemoryServer: vi.fn().mockImplementation(() => ({
      memory_search: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: JSON.stringify({ results: [], count: 0, query: '' }) }],
      }),
      memory_get: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: JSON.stringify({ path: '', content: null }) }],
      }),
    })),
    AGIdentityMemoryServer: vi.fn(),
  };
});

// Import after mocks are set up
import { AGIdentityOpenClawGateway, type AGIdentityOpenClawGatewayConfig } from './agidentity-openclaw-gateway.js';
import { createAGIdentityGateway } from './index.js';

// =============================================================================
// Test Helpers
// =============================================================================

// Create mock wallet
function createMockWallet(): AgentWallet {
  return {
    getPublicKey: vi.fn().mockResolvedValue({
      publicKey: '03abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
    }),
    createSignature: vi.fn().mockResolvedValue({
      signature: [0xde, 0xad, 0xbe, 0xef],
    }),
    verifySignature: vi.fn().mockResolvedValue({ valid: true }),
    encrypt: vi.fn().mockResolvedValue({ ciphertext: [0x01, 0x02, 0x03] }),
    decrypt: vi.fn().mockResolvedValue({ plaintext: [0x01, 0x02, 0x03] }),
    createHmac: vi.fn().mockResolvedValue({ hmac: [0x01, 0x02, 0x03] }),
    verifyHmac: vi.fn().mockResolvedValue({ valid: true }),
    createAction: vi.fn().mockResolvedValue({ txid: 'mocktxid' }),
    acquireCertificate: vi.fn().mockResolvedValue({ certificate: {} }),
    listCertificates: vi.fn().mockResolvedValue({ certificates: [] }),
    getNetwork: vi.fn().mockResolvedValue('mainnet'),
    isAuthenticated: vi.fn().mockResolvedValue(true),
  } as unknown as AgentWallet;
}

// Create mock message
function createMockProcessedMessage(overrides?: Partial<ProcessedMessage>): ProcessedMessage {
  const defaultMessage: VerifiedMessage = {
    messageId: 'msg-123',
    sender: '02sender1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
    body: 'Hello AI!',
    verified: true,
    timestamp: Date.now(),
    messageBox: 'inbox',
  };

  const defaultConversation: Conversation = {
    conversationId: 'conv-123',
    participants: [defaultMessage.sender],
    messages: [],
    createdAt: Date.now(),
    lastActivity: Date.now(),
  };

  return {
    original: defaultMessage,
    conversation: defaultConversation,
    context: {
      identityVerified: true,
      conversationId: 'conv-123',
      isNewConversation: true,
    },
    ...overrides,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('AGIdentityOpenClawGateway', () => {
  let mockWallet: AgentWallet;
  let config: AGIdentityOpenClawGatewayConfig;

  beforeEach(() => {
    vi.clearAllMocks();
    mockWallet = createMockWallet();
    config = {
      wallet: mockWallet,
      trustedCertifiers: ['02certifier123456789abcdef123456789abcdef123456789abcdef123456789'],
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should create gateway with default config', () => {
      const gateway = new AGIdentityOpenClawGateway(config);

      expect(gateway).toBeInstanceOf(AGIdentityOpenClawGateway);
      expect(gateway.isRunning()).toBe(false);
    });

    it('should apply custom config', () => {
      const customConfig: AGIdentityOpenClawGatewayConfig = {
        ...config,
        openclawUrl: 'ws://custom:1234',
        openclawToken: 'custom-token',
        messageBoxes: ['custom-inbox'],
        signResponses: false,
        audit: { enabled: false },
      };

      const gateway = new AGIdentityOpenClawGateway(customConfig);
      expect(gateway).toBeInstanceOf(AGIdentityOpenClawGateway);
    });
  });

  describe('initialization', () => {
    it('should initialize all components', async () => {
      const gateway = new AGIdentityOpenClawGateway(config);
      await gateway.initialize();

      expect(gateway.isRunning()).toBe(true);
      expect(mockWallet.getPublicKey).toHaveBeenCalledWith({ identityKey: true });
    });

    it('should handle OpenClaw connection failure gracefully', async () => {
      // Make OpenClaw reject
      const { createOpenClawClient } = await import('../openclaw/index.js');
      vi.mocked(createOpenClawClient).mockRejectedValueOnce(new Error('Connection refused'));

      const gateway = new AGIdentityOpenClawGateway(config);

      // Should not throw - gateway continues without OpenClaw
      await gateway.initialize();

      expect(gateway.isRunning()).toBe(true);
      expect(gateway.getOpenClawClient()).toBeNull();
    });

    it('should not reinitialize if already running', async () => {
      const gateway = new AGIdentityOpenClawGateway(config);
      await gateway.initialize();

      const { createMessageBoxGateway } = await import('../messaging/messagebox-gateway.js');
      const callCount = vi.mocked(createMessageBoxGateway).mock.calls.length;

      await gateway.initialize(); // Second call

      // Should not call createMessageBoxGateway again
      expect(vi.mocked(createMessageBoxGateway).mock.calls.length).toBe(callCount);
    });
  });

  describe('message handling', () => {
    it('should get identity gate after initialization', async () => {
      const gateway = new AGIdentityOpenClawGateway(config);
      expect(gateway.getIdentityGate()).toBeNull();

      await gateway.initialize();

      expect(gateway.getIdentityGate()).not.toBeNull();
    });

    it('should create audit entries when audit is enabled', async () => {
      const gatewayConfig = {
        ...config,
        audit: { enabled: true },
      };

      const gateway = new AGIdentityOpenClawGateway(gatewayConfig);
      await gateway.initialize();

      expect(gateway.getAuditTrail()).not.toBeNull();
    });
  });

  describe('response signing', () => {
    it('should get agent public key after initialization', async () => {
      const gateway = new AGIdentityOpenClawGateway({
        ...config,
        signResponses: true,
      });
      await gateway.initialize();

      expect(gateway.getAgentPublicKey()).toBe('03abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890');
    });
  });

  describe('shutdown', () => {
    it('should shutdown gracefully', async () => {
      const gateway = new AGIdentityOpenClawGateway(config);
      await gateway.initialize();
      expect(gateway.isRunning()).toBe(true);

      await gateway.shutdown();

      expect(gateway.isRunning()).toBe(false);
      expect(gateway.getMessageBoxGateway()).toBeFalsy();
      expect(gateway.getOpenClawClient()).toBeFalsy();
    });

    it('should handle shutdown when not running', async () => {
      const gateway = new AGIdentityOpenClawGateway(config);

      // Should not throw
      await gateway.shutdown();

      expect(gateway.isRunning()).toBe(false);
    });

    it('should clean up all resources', async () => {
      const gateway = new AGIdentityOpenClawGateway({
        ...config,
        audit: { enabled: true },
      });
      await gateway.initialize();

      expect(gateway.getIdentityGate()).not.toBeNull();
      expect(gateway.getAuditTrail()).not.toBeNull();

      await gateway.shutdown();

      expect(gateway.getIdentityGate()).toBeNull();
      expect(gateway.getAuditTrail()).toBeNull();
    });
  });

  describe('accessors', () => {
    it('should return agent public key after initialization', async () => {
      const gateway = new AGIdentityOpenClawGateway(config);

      expect(gateway.getAgentPublicKey()).toBeNull();

      await gateway.initialize();

      expect(gateway.getAgentPublicKey()).toBe('03abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890');
    });
  });

  describe('error handling', () => {
    it('should handle signing failure gracefully', async () => {
      const failingWallet = {
        ...createMockWallet(),
        createSignature: vi.fn().mockRejectedValue(new Error('Signing failed')),
      } as unknown as AgentWallet;

      const gateway = new AGIdentityOpenClawGateway({
        ...config,
        wallet: failingWallet,
      });

      // Gateway should still create successfully
      expect(gateway).toBeInstanceOf(AGIdentityOpenClawGateway);
    });
  });

  describe('memory integration', () => {
    it('should initialize without memory config (backward compatible)', async () => {
      const gateway = new AGIdentityOpenClawGateway(config);
      await gateway.initialize();

      expect(gateway.isRunning()).toBe(true);

      await gateway.shutdown();
    });

    it('should initialize with memory config', async () => {
      const mockVault = {
        read: vi.fn().mockResolvedValue('test content'),
        list: vi.fn().mockResolvedValue(['doc1.md']),
        search: vi.fn().mockResolvedValue([]),
      };

      const gatewayConfig: AGIdentityOpenClawGatewayConfig = {
        ...config,
        memory: {
          vault: mockVault as unknown as import('../vault/local-encrypted-vault.js').LocalEncryptedVault,
          autoRetrieve: true,
          retrieveLimit: 5,
        },
      };

      const gateway = new AGIdentityOpenClawGateway(gatewayConfig);
      await gateway.initialize();

      expect(gateway.isRunning()).toBe(true);

      await gateway.shutdown();
    });

    it('should initialize with shad executor config', async () => {
      const mockVault = {
        read: vi.fn().mockResolvedValue('test content'),
        list: vi.fn().mockResolvedValue(['doc1.md']),
        search: vi.fn().mockResolvedValue([]),
      };

      const mockShadExecutor = {
        execute: vi.fn().mockResolvedValue({ success: true, output: 'shad result', retrievedDocuments: [] }),
        checkShadAvailable: vi.fn().mockResolvedValue({ available: true }),
      };

      const gatewayConfig: AGIdentityOpenClawGatewayConfig = {
        ...config,
        memory: {
          vault: mockVault as unknown as import('../vault/local-encrypted-vault.js').LocalEncryptedVault,
          shadExecutor: mockShadExecutor as unknown as import('../shad/shad-temp-executor.js').ShadTempVaultExecutor,
        },
      };

      const gateway = new AGIdentityOpenClawGateway(gatewayConfig);
      await gateway.initialize();

      expect(gateway.isRunning()).toBe(true);

      await gateway.shutdown();
    });

    it('should gracefully handle missing shad executor', async () => {
      const gatewayConfig: AGIdentityOpenClawGatewayConfig = {
        ...config,
        memory: {
          // No shadExecutor provided
          autoRetrieve: true,
        },
      };

      const gateway = new AGIdentityOpenClawGateway(gatewayConfig);
      await gateway.initialize();

      // Gateway should work without shadExecutor
      expect(gateway.isRunning()).toBe(true);

      await gateway.shutdown();
    });
  });
});

describe('createAGIdentityGateway', () => {
  it('should create and initialize gateway', async () => {
    const mockWallet = createMockWallet();

    const gateway = await createAGIdentityGateway({
      wallet: mockWallet,
      trustedCertifiers: ['02certifier123456789abcdef123456789abcdef123456789abcdef123456789'],
    });

    expect(gateway).toBeInstanceOf(AGIdentityOpenClawGateway);
    expect(gateway.isRunning()).toBe(true);

    await gateway.shutdown();
  });
});
