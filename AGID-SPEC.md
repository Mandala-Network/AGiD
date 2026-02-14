# AGIdentity Full System Specification

## Overview

AGIdentity (AGID) is a complete blockchain-native identity and security system for AI agents. This specification defines the full implementation using:

- **@bsv/wallet-toolbox** - BRC-100 wallet (DONE)
- **@bsv/auth-express-middleware** - BRC-103/104 mutual authentication
- **@bsv/message-box-client** - Store-and-forward async messaging
- **Existing AGIdentity modules** - Encryption, vaults, certificates, teams

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              AGIdentity System                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────┐    ┌──────────────────┐    ┌────────────────────────┐  │
│  │  AgentWallet    │    │  Auth Middleware │    │   MessageBox Client    │  │
│  │  (BRC-100)      │◄──►│  (BRC-103/104)   │◄──►│   (Async Messaging)    │  │
│  │  [DONE]         │    │  [TO IMPLEMENT]  │    │   [TO IMPLEMENT]       │  │
│  └────────┬────────┘    └────────┬─────────┘    └───────────┬────────────┘  │
│           │                      │                          │               │
│           ▼                      ▼                          ▼               │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                        AGIdentity Server                                │ │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌───────────────┐  │ │
│  │  │  Identity   │  │  Encrypted  │  │    Team     │  │    Audit      │  │ │
│  │  │    Gate     │  │    Vault    │  │    Vault    │  │    Trail      │  │ │
│  │  │  [DONE]     │  │  [DONE]     │  │  [DONE]     │  │  [DONE]       │  │ │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  └───────────────┘  │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                          External Services                              │ │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌───────────────┐  │ │
│  │  │   UHRP      │  │  MessageBox │  │  Overlay    │  │  Certificate  │  │ │
│  │  │  Storage    │  │   Server    │  │  Services   │  │   Registries  │  │ │
│  │  │  [PARTIAL]  │  │  [EXTERNAL] │  │  [STUB]     │  │  [STUB]       │  │ │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  └───────────────┘  │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Component Breakdown

### 1. AgentWallet (COMPLETE)

**Status:** ✅ Fully implemented

**Location:** `src/wallet/agent-wallet.ts`

**Capabilities:**
- Full BRC-100 wallet via wallet-toolbox
- Key derivation (BRC-42/43)
- Encryption/decryption
- Signatures/verification
- HMAC operations
- Transaction creation
- Certificate management
- UTXO tracking for payments

**Usage:**
```typescript
const { wallet } = await createAgentWallet({
  privateKeyHex: process.env.AGENT_PRIVATE_KEY!,
  network: 'mainnet',
  storagePath: './agent-wallet.sqlite'
});
```

---

### 2. Auth Server (TO IMPLEMENT)

**Status:** 🔨 New component

**Location:** `src/server/auth-server.ts`

**Purpose:** HTTP API server with BRC-103/104 mutual authentication

**Dependencies:**
- `@bsv/auth-express-middleware`
- `express` (already installed)
- `AgentWallet` (done)

**Implementation:**

```typescript
// src/server/auth-server.ts

import express from 'express';
import { createAuthMiddleware, AuthRequest } from '@bsv/auth-express-middleware';
import type { AgentWallet } from '../wallet/agent-wallet.js';
import type { IdentityGate } from '../identity/identity-gate.js';
import type { EncryptedShadVault } from '../shad/encrypted-vault.js';
import type { TeamVault } from '../team/team-vault.js';

export interface AGIDServerConfig {
  wallet: AgentWallet;
  identityGate: IdentityGate;
  vault: EncryptedShadVault;
  teamVault: TeamVault;
  port?: number;
  trustedCertifiers: string[];
  allowUnauthenticated?: boolean;
}

export interface AGIDServer {
  app: express.Application;
  start(): Promise<void>;
  stop(): Promise<void>;
  getIdentityKey(): string;
}

export async function createAGIDServer(config: AGIDServerConfig): Promise<AGIDServer> {
  const app = express();
  const port = config.port ?? 3000;

  // Get underlying wallet-toolbox wallet for auth middleware
  const underlyingWallet = config.wallet.getUnderlyingWallet();
  if (!underlyingWallet) {
    throw new Error('Wallet not initialized');
  }

  const agentIdentity = await config.wallet.getPublicKey({ identityKey: true });

  // Create auth middleware with BRC-103/104 mutual authentication
  const authMiddleware = createAuthMiddleware({
    wallet: underlyingWallet,
    allowUnauthenticated: config.allowUnauthenticated ?? false,
    logger: console,
    logLevel: 'info',
    certificatesToRequest: {
      certifiers: config.trustedCertifiers,
      types: {
        // Request agent capability certificates (base64-encoded type IDs)
        [Buffer.from('agidentity.agent').toString('base64')]: ['capabilities', 'trustLevel'],
        [Buffer.from('agidentity.employee').toString('base64')]: ['department', 'role'],
      }
    },
    onCertificatesReceived: async (senderPublicKey, certs, req, res, next) => {
      // Verify certificates with identity gate
      for (const cert of certs) {
        const result = await config.identityGate.verifyIdentity({
          type: cert.type,
          serialNumber: cert.serialNumber,
          subject: cert.subject,
          certifier: cert.certifier,
          revocationOutpoint: cert.revocationOutpoint,
          fields: cert.fields,
          signature: cert.signature ?? '',
        });

        if (!result.verified) {
          res.status(403).json({ error: 'Certificate verification failed', reason: result.error });
          return;
        }
      }
      next();
    },
  });

  // Middleware stack
  app.use(express.json());
  app.use(authMiddleware);

  // Session tracking
  const activeSessions = new Map<string, {
    publicKey: string;
    vaultInitialized: boolean;
    vaultId?: string;
    authenticatedAt: number;
  }>();

  // =========================================================================
  // Identity Endpoints
  // =========================================================================

  app.get('/identity', (req: AuthRequest, res) => {
    res.json({
      agentIdentityKey: agentIdentity.publicKey,
      clientIdentityKey: req.auth?.identityKey ?? 'unknown',
      authenticated: req.auth?.identityKey !== 'unknown',
    });
  });

  app.post('/identity/register', async (req: AuthRequest, res) => {
    const clientKey = req.auth?.identityKey;
    if (!clientKey || clientKey === 'unknown') {
      return res.status(401).json({ error: 'Authentication required' });
    }

    activeSessions.set(clientKey, {
      publicKey: clientKey,
      vaultInitialized: false,
      authenticatedAt: Date.now(),
    });

    res.json({
      success: true,
      sessionCreated: true,
      publicKey: clientKey,
    });
  });

  // =========================================================================
  // Vault Endpoints
  // =========================================================================

  app.post('/vault/init', async (req: AuthRequest, res) => {
    const clientKey = req.auth?.identityKey;
    if (!clientKey || clientKey === 'unknown') {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const session = activeSessions.get(clientKey);
    if (!session) {
      return res.status(403).json({ error: 'Session not registered' });
    }

    try {
      const vaultId = `vault-${clientKey.slice(0, 16)}`;
      await config.vault.initializeVault(clientKey, vaultId);

      session.vaultInitialized = true;
      session.vaultId = vaultId;

      res.json({ success: true, vaultId });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.post('/vault/store', async (req: AuthRequest, res) => {
    const clientKey = req.auth?.identityKey;
    if (!clientKey || clientKey === 'unknown') {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const session = activeSessions.get(clientKey);
    if (!session?.vaultInitialized) {
      return res.status(403).json({ error: 'Vault not initialized' });
    }

    const { path, content } = req.body;
    if (!path || !content) {
      return res.status(400).json({ error: 'Missing path or content' });
    }

    try {
      const entry = await config.vault.uploadDocument(clientKey, path, content);
      res.json({ success: true, path: entry.path, uhrpUrl: entry.uhrpUrl });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.get('/vault/read/:path(*)', async (req: AuthRequest, res) => {
    const clientKey = req.auth?.identityKey;
    if (!clientKey || clientKey === 'unknown') {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const session = activeSessions.get(clientKey);
    if (!session?.vaultInitialized) {
      return res.status(403).json({ error: 'Vault not initialized' });
    }

    try {
      const content = await config.vault.readDocument(clientKey, req.params.path);
      res.json({ success: true, content });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.get('/vault/list', async (req: AuthRequest, res) => {
    const clientKey = req.auth?.identityKey;
    if (!clientKey || clientKey === 'unknown') {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const session = activeSessions.get(clientKey);
    if (!session?.vaultInitialized) {
      return res.status(403).json({ error: 'Vault not initialized' });
    }

    const docs = config.vault.listDocuments();
    res.json({ success: true, documents: docs });
  });

  app.post('/vault/search', async (req: AuthRequest, res) => {
    const clientKey = req.auth?.identityKey;
    if (!clientKey || clientKey === 'unknown') {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const session = activeSessions.get(clientKey);
    if (!session?.vaultInitialized) {
      return res.status(403).json({ error: 'Vault not initialized' });
    }

    const { query, limit } = req.body;
    if (!query) {
      return res.status(400).json({ error: 'Missing query' });
    }

    try {
      const results = await config.vault.searchDocuments(query, limit ?? 10);
      res.json({ success: true, results });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // =========================================================================
  // Team Endpoints
  // =========================================================================

  app.post('/team/create', async (req: AuthRequest, res) => {
    const clientKey = req.auth?.identityKey;
    if (!clientKey || clientKey === 'unknown') {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { name, settings } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Missing team name' });
    }

    try {
      const result = await config.teamVault.createTeam(clientKey, name, settings);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.post('/team/:teamId/member', async (req: AuthRequest, res) => {
    const clientKey = req.auth?.identityKey;
    if (!clientKey || clientKey === 'unknown') {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { memberPublicKey, role, metadata } = req.body;
    if (!memberPublicKey || !role) {
      return res.status(400).json({ error: 'Missing memberPublicKey or role' });
    }

    try {
      const result = await config.teamVault.addMember(
        req.params.teamId,
        clientKey,
        memberPublicKey,
        role,
        metadata
      );
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.post('/team/:teamId/document', async (req: AuthRequest, res) => {
    const clientKey = req.auth?.identityKey;
    if (!clientKey || clientKey === 'unknown') {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { path, content, metadata } = req.body;
    if (!path || !content) {
      return res.status(400).json({ error: 'Missing path or content' });
    }

    try {
      const doc = await config.teamVault.storeDocument(
        req.params.teamId,
        clientKey,
        path,
        content,
        metadata
      );
      res.json({ success: true, documentId: doc.documentId });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.get('/team/:teamId/document/:path(*)', async (req: AuthRequest, res) => {
    const clientKey = req.auth?.identityKey;
    if (!clientKey || clientKey === 'unknown') {
      return res.status(401).json({ error: 'Authentication required' });
    }

    try {
      const content = await config.teamVault.readDocument(
        req.params.teamId,
        clientKey,
        req.params.path
      );
      res.json({ success: true, content });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // =========================================================================
  // Signature Endpoints
  // =========================================================================

  app.post('/sign', async (req: AuthRequest, res) => {
    const clientKey = req.auth?.identityKey;
    if (!clientKey || clientKey === 'unknown') {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { message, keyId } = req.body;
    if (!message) {
      return res.status(400).json({ error: 'Missing message' });
    }

    try {
      const signature = await config.wallet.createSignature({
        data: Array.from(new TextEncoder().encode(message)),
        protocolID: [2, 'agidentity-sign'],
        keyID: keyId ?? `sign-${Date.now()}`,
        counterparty: clientKey,
      });

      res.json({
        success: true,
        signature: signature.signature.map(b => b.toString(16).padStart(2, '0')).join(''),
        signerPublicKey: agentIdentity.publicKey,
      });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // =========================================================================
  // Health & Status
  // =========================================================================

  app.get('/health', (_req, res) => {
    res.json({
      status: 'healthy',
      agentIdentity: agentIdentity.publicKey,
      activeSessions: activeSessions.size,
      timestamp: new Date().toISOString(),
    });
  });

  // =========================================================================
  // Server Lifecycle
  // =========================================================================

  let server: ReturnType<typeof app.listen> | null = null;

  return {
    app,

    async start() {
      return new Promise((resolve) => {
        server = app.listen(port, () => {
          console.log(`AGIdentity server running on port ${port}`);
          console.log(`Agent identity: ${agentIdentity.publicKey}`);
          resolve();
        });
      });
    },

    async stop() {
      if (server) {
        return new Promise((resolve) => {
          server!.close(() => resolve());
        });
      }
    },

    getIdentityKey() {
      return agentIdentity.publicKey;
    },
  };
}
```

---

### 3. MessageBox Integration (TO IMPLEMENT)

**Status:** 🔨 New component

**Location:** `src/messaging/message-client.ts`

**Purpose:** Async agent-to-agent and user-to-agent messaging

**Dependencies:**
- `@bsv/message-box-client`
- `AgentWallet` (done)

**Implementation:**

```typescript
// src/messaging/message-client.ts

import { MessageBoxClient, PeerPayClient } from '@bsv/message-box-client';
import type { AgentWallet } from '../wallet/agent-wallet.js';

export interface AGIDMessageConfig {
  wallet: AgentWallet;
  messageBoxHost?: string;
  enableLogging?: boolean;
  networkPreset?: 'local' | 'mainnet' | 'testnet';
}

export interface AGIDMessage {
  messageId: string;
  sender: string;
  body: string | object;
  createdAt: string;
  messageBox: string;
}

export interface AGIDPayment {
  messageId: string;
  sender: string;
  amount: number;
  token: any;
}

export type MessageHandler = (message: AGIDMessage) => Promise<void>;
export type PaymentHandler = (payment: AGIDPayment) => Promise<boolean>;

export class AGIDMessageClient {
  private messageClient: MessageBoxClient;
  private payClient: PeerPayClient;
  private wallet: AgentWallet;
  private identityKey: string | null = null;
  private messageHandlers = new Map<string, MessageHandler>();
  private paymentHandler: PaymentHandler | null = null;

  constructor(config: AGIDMessageConfig) {
    this.wallet = config.wallet;

    const underlyingWallet = config.wallet.getUnderlyingWallet();
    if (!underlyingWallet) {
      throw new Error('Wallet not initialized');
    }

    // MessageBoxClient auto-encrypts messages using BRC-2 ECDH
    this.messageClient = new MessageBoxClient({
      host: config.messageBoxHost ?? 'https://messagebox.babbage.systems',
      walletClient: underlyingWallet,
      enableLogging: config.enableLogging ?? false,
      networkPreset: config.networkPreset ?? 'mainnet',
    });

    this.payClient = new PeerPayClient({
      messageBoxHost: config.messageBoxHost ?? 'https://messagebox.babbage.systems',
      walletClient: underlyingWallet,
      enableLogging: config.enableLogging ?? false,
    });
  }

  async initialize(): Promise<void> {
    const identity = await this.wallet.getPublicKey({ identityKey: true });
    this.identityKey = identity.publicKey;
    await this.messageClient.init();
  }

  getIdentityKey(): string {
    if (!this.identityKey) {
      throw new Error('Not initialized');
    }
    return this.identityKey;
  }

  // =========================================================================
  // Sending Messages (encryption handled automatically by MessageBoxClient)
  // =========================================================================

  /**
   * Send an encrypted message to a recipient
   * MessageBoxClient auto-encrypts using AES-256-GCM with BRC-2 ECDH
   */
  async sendMessage(
    recipient: string,
    messageBox: string,
    body: string | object,
    options?: { skipEncryption?: boolean; checkPermissions?: boolean }
  ): Promise<{ messageId: string; status: string }> {
    const response = await this.messageClient.sendMessage({
      recipient,
      messageBox,
      body,
      skipEncryption: options?.skipEncryption ?? false,
      checkPermissions: options?.checkPermissions ?? false,
    });

    return { messageId: response.messageId, status: response.status };
  }

  /**
   * Send a live (WebSocket) message with HTTP fallback
   */
  async sendLiveMessage(
    recipient: string,
    messageBox: string,
    body: string | object
  ): Promise<{ messageId: string; status: string }> {
    const response = await this.messageClient.sendLiveMessage({
      recipient,
      messageBox,
      body,
    });

    return { messageId: response.messageId, status: response.status };
  }

  /**
   * Send a notification (with auto quote + payment handling)
   */
  async sendNotification(
    recipient: string | string[],
    body: string | object
  ): Promise<any> {
    return this.messageClient.sendNotification(recipient, body);
  }

  // =========================================================================
  // Receiving Messages (auto-decrypted by MessageBoxClient)
  // =========================================================================

  /**
   * Register a handler for a specific message box
   */
  onMessage(messageBox: string, handler: MessageHandler): void {
    this.messageHandlers.set(messageBox, handler);
  }

  /**
   * Start listening for live messages on a message box
   */
  async listenForMessages(messageBox: string): Promise<void> {
    await this.messageClient.listenForLiveMessages({
      messageBox,
      onMessage: async (rawMessage: any) => {
        const message: AGIDMessage = {
          messageId: rawMessage.messageId,
          sender: rawMessage.sender,
          body: rawMessage.body,
          createdAt: rawMessage.created_at,
          messageBox,
        };
        const handler = this.messageHandlers.get(messageBox);
        if (handler) {
          await handler(message);
        }
      },
    });
  }

  /**
   * List pending messages in a message box (auto-decrypted)
   */
  async listMessages(
    messageBox: string,
    options?: { acceptPayments?: boolean }
  ): Promise<AGIDMessage[]> {
    const rawMessages = await this.messageClient.listMessages({
      messageBox,
      acceptPayments: options?.acceptPayments ?? true,
    });

    return rawMessages.map((raw: any) => ({
      messageId: raw.messageId,
      sender: raw.sender,
      body: raw.body,
      createdAt: raw.created_at,
      messageBox,
    }));
  }

  /**
   * Acknowledge (delete) processed messages
   */
  async acknowledgeMessage(messageIds: string | string[]): Promise<void> {
    const ids = Array.isArray(messageIds) ? messageIds : [messageIds];
    await this.messageClient.acknowledgeMessage({ messageIds: ids });
  }

  // =========================================================================
  // Payments
  // =========================================================================

  /**
   * Register a payment handler
   */
  onPayment(handler: PaymentHandler): void {
    this.paymentHandler = handler;
  }

  /**
   * Send a payment to a recipient
   */
  async sendPayment(recipient: string, amount: number): Promise<void> {
    await this.payClient.sendPayment({ recipient, amount });
  }

  /**
   * Send a live payment (WebSocket with HTTP fallback)
   */
  async sendLivePayment(recipient: string, amount: number): Promise<void> {
    await this.payClient.sendLivePayment({ recipient, amount });
  }

  /**
   * Start listening for incoming payments
   */
  async listenForPayments(): Promise<void> {
    await this.payClient.listenForLivePayments({
      onPayment: async (payment: any) => {
        const agidPayment: AGIDPayment = {
          messageId: payment.messageId,
          sender: payment.sender,
          amount: payment.token?.amount ?? 0,
          token: payment.token,
        };

        let accepted = true;
        if (this.paymentHandler) {
          accepted = await this.paymentHandler(agidPayment);
        }

        if (accepted) {
          await this.payClient.acceptPayment(payment);
        } else {
          await this.payClient.rejectPayment(payment);
        }
      },
    });
  }

  /**
   * Accept an incoming payment
   */
  async acceptPayment(payment: AGIDPayment): Promise<void> {
    await this.payClient.acceptPayment({
      messageId: payment.messageId,
      sender: payment.sender,
      token: payment.token,
    });
  }

  /**
   * Reject an incoming payment (refunds minus fee)
   */
  async rejectPayment(payment: AGIDPayment): Promise<void> {
    await this.payClient.rejectPayment({
      messageId: payment.messageId,
      sender: payment.sender,
      token: payment.token,
    });
  }

  /**
   * List pending incoming payments
   */
  async listIncomingPayments(): Promise<AGIDPayment[]> {
    const payments = await this.payClient.listIncomingPayments();
    return payments.map((p: any) => ({
      messageId: p.messageId,
      sender: p.sender,
      amount: p.token?.amount ?? 0,
      token: p.token,
    }));
  }

  // =========================================================================
  // Permissions
  // =========================================================================

  /**
   * Set permission for a message box (fee or block)
   */
  async setPermission(
    messageBox: string,
    options: { sender?: string; recipientFee: number }
  ): Promise<void> {
    await this.messageClient.setMessageBoxPermission({
      messageBox,
      sender: options.sender,
      recipientFee: options.recipientFee, // -1=block, 0=always allow, >0=satoshi fee
    });
  }

  /**
   * Allow notifications from a peer
   */
  async allowNotificationsFrom(
    peerIdentityKey: string,
    recipientFee?: number
  ): Promise<void> {
    await this.messageClient.allowNotificationsFromPeer(
      peerIdentityKey,
      recipientFee ?? 0
    );
  }

  /**
   * Block notifications from a peer
   */
  async denyNotificationsFrom(peerIdentityKey: string): Promise<void> {
    await this.messageClient.denyNotificationsFromPeer(peerIdentityKey);
  }

  /**
   * Check notification permission for a peer
   */
  async checkPeerPermission(peerIdentityKey: string): Promise<any> {
    return this.messageClient.checkPeerNotificationStatus(peerIdentityKey);
  }

  // =========================================================================
  // WebSocket Room Management
  // =========================================================================

  /**
   * Join a WebSocket room for live updates
   */
  async joinRoom(messageBox: string): Promise<void> {
    await this.messageClient.joinRoom(messageBox);
  }

  /**
   * Leave a WebSocket room
   */
  async leaveRoom(messageBox: string): Promise<void> {
    await this.messageClient.leaveRoom(messageBox);
  }

  /**
   * Disconnect WebSocket
   */
  async disconnect(): Promise<void> {
    await this.messageClient.disconnectWebSocket();
  }

  // =========================================================================
  // Overlay Network (Host Advertisement)
  // =========================================================================

  /**
   * Anoint a MessageBox host for this identity
   * Required for overlay-based message routing
   */
  async anointHost(host: string): Promise<{ txid: string }> {
    return this.messageClient.anointHost(host);
  }

  /**
   * Resolve the MessageBox host for a recipient
   */
  async resolveHostForRecipient(identityKey: string): Promise<string> {
    return this.messageClient.resolveHostForRecipient(identityKey);
  }
}

export function createMessageClient(config: AGIDMessageConfig): AGIDMessageClient {
  return new AGIDMessageClient(config);
}
```

---

### 4. Unified AGIdentity Service (TO IMPLEMENT)

**Status:** 🔨 New component

**Location:** `src/service/agidentity-service.ts`

**Purpose:** Single entry point combining all components

```typescript
// src/service/agidentity-service.ts

import type { AgentWallet } from '../wallet/agent-wallet.js';
import { createAgentWallet, AgentWalletConfig } from '../wallet/agent-wallet.js';
import { AGIdentityStorageManager, StorageManagerConfig } from '../uhrp/storage-manager.js';
import { EncryptedShadVault } from '../shad/encrypted-vault.js';
import { createShadBridge, AGIdentityShadBridge } from '../shad/shad-integration.js';
import { PerInteractionEncryption } from '../encryption/per-interaction.js';
import { IdentityGate, IdentityGateConfig } from '../identity/identity-gate.js';
import { TeamVault, TeamVaultConfig } from '../team/team-vault.js';
import { SecureTeamVault, SecureTeamVaultConfig } from '../team/secure-team-vault.js';
import { createAGIDServer, AGIDServer, AGIDServerConfig } from '../server/auth-server.js';
import { AGIDMessageClient, createMessageClient, AGIDMessageConfig } from '../messaging/message-client.js';
import type { ShadConfig } from '../types/index.js';

export interface AGIdentityServiceConfig {
  // Wallet
  wallet: AgentWalletConfig;

  // Storage
  storageUrl: string;
  network?: 'mainnet' | 'testnet';

  // Server
  server?: {
    enabled?: boolean;
    port?: number;
    trustedCertifiers?: string[];
    allowUnauthenticated?: boolean;
  };

  // Messaging
  messaging?: {
    enabled?: boolean;
    messageBoxHost?: string;
  };

  // Teams
  teams?: {
    requireCertificates?: boolean;
    trustedCertifiers?: string[];
  };

  // Shad
  shad?: ShadConfig;
}

export interface AGIdentityService {
  // Core components
  wallet: AgentWallet;
  storage: AGIdentityStorageManager;
  vault: EncryptedShadVault;
  shad: AGIdentityShadBridge;
  encryption: PerInteractionEncryption;
  identityGate: IdentityGate;
  teamVault: TeamVault | SecureTeamVault;

  // Optional components
  server: AGIDServer | null;
  messaging: AGIDMessageClient | null;

  // Identity
  getIdentityKey(): Promise<string>;

  // Lifecycle
  start(): Promise<void>;
  stop(): Promise<void>;
}

export async function createAGIdentityService(
  config: AGIdentityServiceConfig
): Promise<AGIdentityService> {
  // Initialize wallet
  const { wallet } = await createAgentWallet(config.wallet);
  const identityKey = (await wallet.getPublicKey({ identityKey: true })).publicKey;

  console.log(`AGIdentity initializing with identity: ${identityKey.slice(0, 16)}...`);

  // Initialize storage
  const storage = new AGIdentityStorageManager({
    storageUrl: config.storageUrl,
    wallet,
    network: config.network,
  });

  // Initialize vault
  const vault = new EncryptedShadVault({
    storageManager: storage,
    wallet,
  });

  // Initialize Shad bridge
  const shad = createShadBridge(vault, wallet, config.shad);

  // Initialize encryption
  const encryption = new PerInteractionEncryption(wallet);

  // Initialize identity gate
  const identityGate = new IdentityGate({
    wallet,
    trustedCertifiers: config.server?.trustedCertifiers ?? [],
    requireCertificate: true,
  });
  await identityGate.initialize();

  // Initialize team vault
  let teamVault: TeamVault | SecureTeamVault;
  if (config.teams?.requireCertificates) {
    teamVault = new SecureTeamVault({
      wallet,
      trustedCertifiers: config.teams.trustedCertifiers ?? [],
      requireCertificates: true,
    });
    await (teamVault as SecureTeamVault).initialize();
  } else {
    teamVault = new TeamVault({ wallet });
  }

  // Initialize server (optional)
  let server: AGIDServer | null = null;
  if (config.server?.enabled !== false) {
    server = await createAGIDServer({
      wallet,
      identityGate,
      vault,
      teamVault: teamVault instanceof SecureTeamVault ? teamVault : teamVault as TeamVault,
      port: config.server?.port ?? 3000,
      trustedCertifiers: config.server?.trustedCertifiers ?? [],
      allowUnauthenticated: config.server?.allowUnauthenticated ?? false,
    });
  }

  // Initialize messaging (optional)
  // Note: MessageBoxClient handles encryption internally via BRC-2 ECDH
  let messaging: AGIDMessageClient | null = null;
  if (config.messaging?.enabled !== false) {
    messaging = createMessageClient({
      wallet,
      messageBoxHost: config.messaging?.messageBoxHost,
      enableLogging: config.messaging?.enableLogging ?? false,
      networkPreset: config.network === 'testnet' ? 'testnet' : 'mainnet',
    });
    await messaging.initialize();
  }

  return {
    wallet,
    storage,
    vault,
    shad,
    encryption,
    identityGate,
    teamVault,
    server,
    messaging,

    async getIdentityKey() {
      return identityKey;
    },

    async start() {
      if (server) {
        await server.start();
      }
      console.log(`AGIdentity service started`);
      console.log(`  Identity: ${identityKey}`);
      if (server) {
        console.log(`  Server: http://localhost:${config.server?.port ?? 3000}`);
      }
      if (messaging) {
        console.log(`  Messaging: connected to ${config.messaging?.messageBoxHost ?? 'messagebox.babbage.systems'}`);
      }
    },

    async stop() {
      if (server) {
        await server.stop();
      }
      if (messaging) {
        await messaging.disconnect();
      }
      await wallet.destroy();
      console.log('AGIdentity service stopped');
    },
  };
}
```

---

## Implementation Phases

### Phase 1: Auth Server (Priority: HIGH)

**Files to create:**
- `src/server/auth-server.ts`
- `src/server/index.ts`

**Tasks:**
1. Create Express server with auth middleware
2. Wire up existing IdentityGate for certificate verification
3. Implement identity, vault, team, and signature endpoints
4. Add session tracking
5. Test with authenticated client

**Dependencies:** None (all prerequisites done)

### Phase 2: MessageBox Client (Priority: HIGH)

**Files to create:**
- `src/messaging/message-client.ts`
- `src/messaging/index.ts`

**Tasks:**
1. Create AGIDMessageClient wrapper
2. Integrate per-interaction encryption
3. Implement send/receive with encryption
4. Implement payment handling
5. Add permission management

**Dependencies:** None (all prerequisites done)

### Phase 3: Unified Service (Priority: MEDIUM)

**Files to create:**
- `src/service/agidentity-service.ts`
- `src/service/index.ts`

**Tasks:**
1. Create unified service factory
2. Wire all components together
3. Implement lifecycle management
4. Add configuration validation

**Dependencies:** Phase 1, Phase 2

### Phase 4: Client SDK (Priority: MEDIUM)

**Files to create:**
- `src/client/agidentity-client.ts`
- `src/client/index.ts`

**Tasks:**
1. Create authenticated HTTP client
2. Implement all API methods
3. Add automatic authentication handling
4. Add retry logic and error handling

**Dependencies:** Phase 1

### Phase 5: Overlay Integration (Priority: LOW)

**Files to modify:**
- `src/identity/identity-gate.ts`
- `src/uhrp/storage-manager.ts`

**Tasks:**
1. Implement real RevocationChecker using overlay
2. Implement blockchain timestamp verification
3. Add UTXO monitoring for revocations

**Dependencies:** External overlay service

---

## API Reference

### HTTP Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/identity` | Optional | Get agent and client identity |
| POST | `/identity/register` | Required | Register session |
| POST | `/vault/init` | Required | Initialize user vault |
| POST | `/vault/store` | Required | Store encrypted document |
| GET | `/vault/read/:path` | Required | Read encrypted document |
| GET | `/vault/list` | Required | List all documents |
| POST | `/vault/search` | Required | Search documents |
| POST | `/team/create` | Required | Create team |
| POST | `/team/:id/member` | Required | Add team member |
| POST | `/team/:id/document` | Required | Store team document |
| GET | `/team/:id/document/:path` | Required | Read team document |
| POST | `/sign` | Required | Sign message |
| GET | `/health` | None | Health check |

### MessageBox Operations

| Operation | Description |
|-----------|-------------|
| `sendMessage` | Send encrypted message |
| `sendLiveMessage` | Send via WebSocket |
| `sendNotification` | Send notification |
| `listenForMessages` | Subscribe to message box |
| `listMessages` | List pending messages |
| `acknowledgeMessage` | Delete processed message |
| `sendPayment` | Send BSV payment |
| `listenForPayments` | Subscribe to payments |
| `acceptPayment` | Accept incoming payment |

---

## Security Model

### Authentication Flow

```
1. Client generates keypair (BRC-100 wallet)
2. Client initiates BRC-103 handshake
   - Sends initialRequest with nonce + identity key
3. Server responds with initialResponse
   - Echoes client nonce + sends server nonce
   - Signs response
4. Client verifies server signature
5. Both parties have authenticated sessions
6. All subsequent requests signed with nonces
```

### Encryption Layers

1. **Transport**: HTTPS/TLS (external)
2. **Message Auth**: BRC-103 signatures (auth-express-middleware)
3. **Content Encryption**: AES-256-GCM (per-interaction encryption)
4. **Key Derivation**: BRC-42/43 (wallet-toolbox)
5. **Storage Encryption**: BRC-42 derived keys (encrypted vault)

### Certificate Chain

```
Root Certifier (Organization CA)
    │
    ├── Agent Certificate (issued to agent identity)
    │       │
    │       └── Capabilities: ["memory", "sign", "pay"]
    │
    └── User Certificate (issued to user identity)
            │
            └── Role: "admin" | "member" | "readonly"
```

---

## Testing Strategy

### Unit Tests

- Auth server endpoints (mock wallet)
- Message client encryption/decryption
- Service lifecycle management

### Integration Tests

- Full auth flow with real wallet
- Message send/receive cycle
- Payment flow
- Team operations with certificates

### E2E Tests

- Client connects to server
- Stores and retrieves documents
- Joins team and accesses team documents
- Receives payments and messages

---

## Usage Example

```typescript
import { createAGIdentityService } from 'agidentity';

// Create the service
const agid = await createAGIdentityService({
  wallet: {
    privateKeyHex: process.env.AGENT_PRIVATE_KEY!,
    network: 'mainnet',
  },
  storageUrl: 'https://uhrp.example.com',
  server: {
    enabled: true,
    port: 3000,
    trustedCertifiers: ['03abc...'],
  },
  messaging: {
    enabled: true,
  },
  teams: {
    requireCertificates: true,
    trustedCertifiers: ['03abc...'],
  },
});

// Start the service
await agid.start();

// Listen for messages
agid.messaging?.onMessage('commands', async (msg) => {
  console.log('Received command from', msg.sender);
  console.log('Body:', msg.body);

  // Process command...

  // Acknowledge
  await agid.messaging?.acknowledgeMessage(msg.messageId);
});

await agid.messaging?.listenForMessages('commands');

// Listen for payments
agid.messaging?.onPayment(async (payment) => {
  console.log('Payment from', payment.sender, 'amount', payment.amount);
  return true; // Accept
});

await agid.messaging?.listenForPayments();

// Store user document (via authenticated request)
// This would be called from the server endpoint
await agid.vault.uploadDocument(
  userPublicKey,
  'notes/meeting.md',
  '# Meeting Notes\n...'
);

// Create team
await agid.teamVault.createTeam(
  ownerPublicKey,
  'engineering',
  { maxMembers: 50 }
);

// Graceful shutdown
process.on('SIGINT', async () => {
  await agid.stop();
  process.exit(0);
});
```

---

## Dependencies to Install

```bash
npm install @bsv/auth-express-middleware @bsv/message-box-client
```

Already installed:
- `@bsv/sdk@^2.0.3`
- `@bsv/wallet-toolbox@^2.0.14`
- `express@^5.0.0`
- `curvepoint`

**Package Details:**
- `@bsv/auth-express-middleware` - BRC-103/104 mutual authentication Express middleware
- `@bsv/message-box-client` - MessageBoxClient and PeerPayClient for P2P messaging/payments

---

## File Structure After Implementation

```
src/
├── wallet/
│   └── agent-wallet.ts          [DONE]
├── server/
│   ├── auth-server.ts           [NEW]
│   └── index.ts                 [NEW]
├── messaging/
│   ├── message-client.ts        [NEW]
│   └── index.ts                 [NEW]
├── service/
│   ├── agidentity-service.ts    [NEW]
│   └── index.ts                 [NEW]
├── client/
│   ├── agidentity-client.ts     [NEW]
│   └── index.ts                 [NEW]
├── uhrp/
│   └── storage-manager.ts       [DONE]
├── shad/
│   ├── encrypted-vault.ts       [DONE]
│   └── shad-integration.ts      [DONE]
├── encryption/
│   └── per-interaction.ts       [DONE]
├── identity/
│   ├── certificate-authority.ts [DONE]
│   ├── certificate-verifier.ts  [DONE]
│   └── identity-gate.ts         [DONE]
├── team/
│   ├── team-vault.ts            [DONE]
│   └── secure-team-vault.ts     [DONE]
├── plugin/
│   ├── agidentity-plugin.ts     [DONE]
│   └── secure-plugin.ts         [DONE]
├── audit/
│   └── audit-trail.ts           [DONE]
├── auth/
│   └── session-manager.ts       [DONE]
├── types/
│   ├── index.ts                 [DONE]
│   └── openclaw-plugin.ts       [DONE]
└── index.ts                     [UPDATE]
```

---

## Next Steps

1. **Install dependencies**: `npm install @bsv/auth-express-middleware @bsv/message-box-client`
2. **Implement Phase 1**: Create auth server
3. **Implement Phase 2**: Create message client
4. **Implement Phase 3**: Create unified service
5. **Test**: Full integration testing
6. **Document**: API documentation and examples
