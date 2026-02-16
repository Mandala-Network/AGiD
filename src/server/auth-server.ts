/**
 * AGIdentity Auth Server
 *
 * HTTP API server with BRC-103/104 mutual authentication using auth-express-middleware.
 * Provides authenticated endpoints for vault, team, and identity operations.
 */

import express, { Application, Response, NextFunction } from 'express';
import { createAuthMiddleware, AuthRequest } from '@bsv/auth-express-middleware';
import type { AgentWallet } from '../wallet/agent-wallet.js';
import type { IdentityGate } from '../identity/identity-gate.js';
import type { EncryptedShadVault } from '../shad/encrypted-vault.js';
import type { TeamVault } from '../team/team-vault.js';
import type { AGIdentityMemoryServer } from '../memory/agidentity-memory-server.js';
import { getConfig } from '../config/index.js';

/**
 * Server configuration
 */
export interface AGIDServerConfig {
  wallet: AgentWallet;
  identityGate: IdentityGate;
  vault?: EncryptedShadVault;
  teamVault?: TeamVault;
  memoryServer?: AGIdentityMemoryServer;
  port?: number;
  trustedCertifiers: string[];
  allowUnauthenticated?: boolean;
  enableLogging?: boolean;
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
}

/**
 * Active session information
 */
interface ActiveSession {
  publicKey: string;
  vaultInitialized: boolean;
  vaultId?: string;
  authenticatedAt: number;
  lastActivityAt: number;
}

/**
 * AGIdentity Server interface
 */
export interface AGIDServer {
  app: Application;
  start(): Promise<void>;
  stop(): Promise<void>;
  getIdentityKey(): string;
  getActiveSessions(): Map<string, ActiveSession>;
}

/**
 * Create an AGIdentity server with BRC-103/104 mutual authentication
 */
export async function createAGIDServer(config: AGIDServerConfig): Promise<AGIDServer> {
  const app = express();

  // Get defaults from environment config
  const envConfig = getConfig();
  const port = config.port ?? envConfig.serverPort;

  // Get underlying wallet-toolbox wallet for auth middleware
  const underlyingWallet = config.wallet.getUnderlyingWallet();
  if (!underlyingWallet) {
    throw new Error('Wallet not initialized');
  }

  const agentIdentity = await config.wallet.getPublicKey({ identityKey: true });

  // Session tracking
  const activeSessions = new Map<string, ActiveSession>();

  // Create auth middleware with BRC-103/104 mutual authentication
  const authMiddleware = createAuthMiddleware({
    wallet: underlyingWallet,
    allowUnauthenticated: config.allowUnauthenticated ?? false,
    logger: config.enableLogging ? console : undefined,
    logLevel: config.logLevel ?? 'info',
    certificatesToRequest: config.trustedCertifiers.length > 0 ? {
      certifiers: config.trustedCertifiers,
      types: {
        // Request agent capability certificates (base64-encoded type IDs)
        [Buffer.from('agidentity.agent').toString('base64')]: ['capabilities', 'trustLevel'],
        [Buffer.from('agidentity.employee').toString('base64')]: ['department', 'role'],
      }
    } : undefined,
    onCertificatesReceived: async (_senderPublicKey, certs, _req, res, next) => {
      // Verify certificates with identity gate
      for (const cert of certs) {
        const result = await config.identityGate.verifyIdentity({
          type: cert.type,
          serialNumber: cert.serialNumber,
          subject: cert.subject,
          certifier: cert.certifier,
          revocationOutpoint: cert.revocationOutpoint ?? '',
          fields: cert.fields as Record<string, string>,
          signature: cert.signature ?? '',
        });

        if (!result.verified) {
          res.status(403).json({
            error: 'Certificate verification failed',
            reason: result.error
          });
          return;
        }
      }
      next();
    },
  });

  // Middleware stack
  app.use(express.json());
  app.use(authMiddleware);

  // Helper to get client identity key
  const getClientKey = (req: AuthRequest): string | null => {
    const key = req.auth?.identityKey;
    if (!key || key === 'unknown') return null;
    return key;
  };

  // Helper to get a param as string (Express 5 can return string | string[])
  const getParam = (param: string | string[] | undefined): string => {
    if (Array.isArray(param)) return param[0] ?? '';
    return param ?? '';
  };

  // Update session activity
  const updateSession = (clientKey: string) => {
    const session = activeSessions.get(clientKey);
    if (session) {
      session.lastActivityAt = Date.now();
    }
  };

  // =========================================================================
  // Identity Endpoints
  // =========================================================================

  app.get('/identity', (req: AuthRequest, res: Response) => {
    const clientKey = getClientKey(req);
    if (clientKey) updateSession(clientKey);

    res.json({
      agentIdentityKey: agentIdentity.publicKey,
      clientIdentityKey: clientKey ?? 'unknown',
      authenticated: clientKey !== null,
    });
  });

  app.post('/identity/register', async (req: AuthRequest, res: Response) => {
    const clientKey = getClientKey(req);
    if (!clientKey) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const now = Date.now();
    activeSessions.set(clientKey, {
      publicKey: clientKey,
      vaultInitialized: false,
      authenticatedAt: now,
      lastActivityAt: now,
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

  app.post('/vault/init', async (req: AuthRequest, res: Response) => {
    const clientKey = getClientKey(req);
    if (!clientKey) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    if (!config.vault) {
      res.status(503).json({ error: 'Vault not configured' });
      return;
    }

    const session = activeSessions.get(clientKey);
    if (!session) {
      res.status(403).json({ error: 'Session not registered. Call /identity/register first.' });
      return;
    }

    try {
      const vaultId = `vault-${clientKey.slice(0, 16)}-${Date.now().toString(36)}`;
      await config.vault!.initializeVault(clientKey, vaultId);

      session.vaultInitialized = true;
      session.vaultId = vaultId;
      session.lastActivityAt = Date.now();

      res.json({ success: true, vaultId });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.post('/vault/store', async (req: AuthRequest, res: Response) => {
    const clientKey = getClientKey(req);
    if (!clientKey) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    if (!config.vault) {
      res.status(503).json({ error: 'Vault not configured' });
      return;
    }

    const session = activeSessions.get(clientKey);
    if (!session?.vaultInitialized) {
      res.status(403).json({ error: 'Vault not initialized' });
      return;
    }

    const { path, content } = req.body;
    if (!path || !content) {
      res.status(400).json({ error: 'Missing path or content' });
      return;
    }

    try {
      const entry = await config.vault!.uploadDocument(clientKey, path, content);
      updateSession(clientKey);
      res.json({ success: true, path: entry.path, uhrpUrl: entry.uhrpUrl });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.get(/^\/vault\/read\/(.+)$/, async (req: AuthRequest, res: Response) => {
    const clientKey = getClientKey(req);
    if (!clientKey) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    if (!config.vault) {
      res.status(503).json({ error: 'Vault not configured' });
      return;
    }

    const session = activeSessions.get(clientKey);
    if (!session?.vaultInitialized) {
      res.status(403).json({ error: 'Vault not initialized' });
      return;
    }

    try {
      const path = getParam(req.params[0]); // First regex capture group
      const content = await config.vault!.readDocument(clientKey, path);
      updateSession(clientKey);
      if (content === null) {
        res.status(404).json({ error: 'Document not found' });
        return;
      }
      res.json({ success: true, content });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.get('/vault/list', async (req: AuthRequest, res: Response) => {
    const clientKey = getClientKey(req);
    if (!clientKey) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    if (!config.vault) {
      res.status(503).json({ error: 'Vault not configured' });
      return;
    }

    const session = activeSessions.get(clientKey);
    if (!session?.vaultInitialized) {
      res.status(403).json({ error: 'Vault not initialized' });
      return;
    }

    const docs = config.vault!.listDocuments();
    updateSession(clientKey);
    res.json({ success: true, documents: docs });
  });

  app.post('/vault/search', async (req: AuthRequest, res: Response) => {
    const clientKey = getClientKey(req);
    if (!clientKey) {
      res.status(401).json({ error: 'Authentication required' });
      return;

    if (!config.vault) {
      res.status(503).json({ error: 'Vault not configured' });
      return;
    }
    }

    const session = activeSessions.get(clientKey);
    if (!session?.vaultInitialized) {
      res.status(403).json({ error: 'Vault not initialized' });
      return;
    }

    const { query, limit } = req.body;
    if (!query) {
      res.status(400).json({ error: 'Missing query' });
      return;
    }

    try {
      const results = await config.vault!.searchDocuments(clientKey, query, { limit: limit ?? 10 });
      updateSession(clientKey);
      res.json({ success: true, results });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.get(/^\/vault\/proof\/(.+)$/, async (req: AuthRequest, res: Response) => {
    const clientKey = getClientKey(req);
    if (!clientKey) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    try {
      const proof = await config.vault!.getVaultProof(req.params[0] || req.path.replace('/vault/proof/', ''));
      updateSession(clientKey);
      res.json({ success: true, proof });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // =========================================================================
  // Team Endpoints
  // =========================================================================

  app.post('/team/create', async (req: AuthRequest, res: Response) => {
    const clientKey = getClientKey(req);
    if (!clientKey) {
      res.status(401).json({ error: 'Authentication required' });
      return;

    if (!config.teamVault) {
      res.status(503).json({ error: 'Team vault not configured' });
      return;
    }
    }

    const { name, settings } = req.body;
    if (!name) {
      res.status(400).json({ error: 'Missing team name' });
      return;
    }

    try {
      const result = await config.teamVault!.createTeam(name, clientKey, settings);
      updateSession(clientKey);
      res.json({
        success: true,
        teamId: result.teamId,
        name: result.name,
        createdAt: result.createdAt,
      });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.get('/team/:teamId', async (req: AuthRequest, res: Response) => {
    const clientKey = getClientKey(req);
    if (!clientKey) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    try {
      const team = await config.teamVault!.getTeam(getParam(req.params.teamId));
      if (!team) {
        res.status(404).json({ error: 'Team not found' });
        return;
      }
      updateSession(clientKey);
      res.json({ success: true, team });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.post('/team/:teamId/member', async (req: AuthRequest, res: Response) => {
    const clientKey = getClientKey(req);
    if (!clientKey) {
      res.status(401).json({ error: 'Authentication required' });
      return;

    if (!config.teamVault) {
      res.status(503).json({ error: 'Team vault not configured' });
      return;
    }
    }

    const { memberPublicKey, role, metadata } = req.body;
    if (!memberPublicKey || !role) {
      res.status(400).json({ error: 'Missing memberPublicKey or role' });
      return;
    }

    try {
      const result = await config.teamVault!.addMember(
        getParam(req.params.teamId),
        memberPublicKey,
        role,
        clientKey,
        metadata
      );
      updateSession(clientKey);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.delete('/team/:teamId/member/:memberKey', async (req: AuthRequest, res: Response) => {
    const clientKey = getClientKey(req);
    if (!clientKey) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    try {
      const result = await config.teamVault!.removeMember(
        getParam(req.params.teamId),
        getParam(req.params.memberKey),
        clientKey
      );
      updateSession(clientKey);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.get('/team/:teamId/access', async (req: AuthRequest, res: Response) => {
    const clientKey = getClientKey(req);
    if (!clientKey) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    try {
      const result = await config.teamVault!.checkAccess(getParam(req.params.teamId), clientKey);
      updateSession(clientKey);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.post('/team/:teamId/document', async (req: AuthRequest, res: Response) => {
    const clientKey = getClientKey(req);
    if (!clientKey) {
      res.status(401).json({ error: 'Authentication required' });
      return;

    if (!config.teamVault) {
      res.status(503).json({ error: 'Team vault not configured' });
      return;
    }
    }

    const { path, content, metadata } = req.body;
    if (!path || !content) {
      res.status(400).json({ error: 'Missing path or content' });
      return;
    }

    try {
      const doc = await config.teamVault!.storeDocument(
        getParam(req.params.teamId),
        path,
        content,
        clientKey,
        metadata
      );
      updateSession(clientKey);
      res.json({ success: true, documentId: doc.documentId, path: doc.path });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.get(/^\/team\/([^\/]+)\/document\/(.+)$/, async (req: AuthRequest, res: Response) => {
    const clientKey = getClientKey(req);
    if (!clientKey) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    try {
      const teamId = getParam(req.params[0]); // First regex capture group
      const path = getParam(req.params[1]); // Second regex capture group
      const content = await config.teamVault!.readDocumentText(teamId, path);
      updateSession(clientKey);
      res.json({ success: true, content });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.get('/team/:teamId/documents', async (req: AuthRequest, res: Response) => {
    const clientKey = getClientKey(req);
    if (!clientKey) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    try {
      const documents = await config.teamVault!.listDocuments(getParam(req.params.teamId));
      updateSession(clientKey);
      res.json({ success: true, documents });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // =========================================================================
  // Signature Endpoints
  // =========================================================================

  app.post('/sign', async (req: AuthRequest, res: Response) => {
    const clientKey = getClientKey(req);
    if (!clientKey) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const { message, keyId } = req.body;
    if (!message) {
      res.status(400).json({ error: 'Missing message' });
      return;
    }

    try {
      const signature = await config.wallet.createSignature({
        data: Array.from(new TextEncoder().encode(message)),
        protocolID: [2, 'agidentity-sign'],
        keyID: keyId ?? `sign-${Date.now()}`,
        counterparty: clientKey,
      });

      const signatureHex = signature.signature
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');

      updateSession(clientKey);
      res.json({
        success: true,
        signature: signatureHex,
        signerPublicKey: agentIdentity.publicKey,
      });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.post('/verify', async (req: AuthRequest, res: Response) => {
    const clientKey = getClientKey(req);
    if (!clientKey) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const { message, signature, keyId } = req.body;
    if (!message || !signature) {
      res.status(400).json({ error: 'Missing message or signature' });
      return;
    }

    try {
      const signatureBytes = signature.match(/.{2}/g)?.map((b: string) => parseInt(b, 16)) ?? [];

      const result = await config.wallet.verifySignature({
        data: Array.from(new TextEncoder().encode(message)),
        signature: signatureBytes,
        protocolID: [2, 'agidentity-sign'],
        keyID: keyId ?? 'verify',
        counterparty: clientKey,
      });

      updateSession(clientKey);
      res.json({ success: true, valid: result.valid });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // =========================================================================
  // Memory Endpoints
  // =========================================================================

  app.post('/memory/search', async (req: AuthRequest, res: Response) => {
    const clientKey = getClientKey(req);
    if (!clientKey) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    if (!config.memoryServer) {
      res.status(503).json({ error: 'Memory server not configured' });
      return;
    }

    const { query, limit } = req.body;
    if (!query) {
      res.status(400).json({ error: 'Missing query' });
      return;
    }

    try {
      const response = await config.memoryServer.memory_search(query, limit ?? 10);
      const data = JSON.parse(response.content[0].text);

      updateSession(clientKey);
      res.json({
        success: true,
        results: data.results,
        count: data.count,
        query: data.query,
      });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.get(/^\/memory\/get\/(.+)$/, async (req: AuthRequest, res: Response) => {
    const clientKey = getClientKey(req);
    if (!clientKey) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    if (!config.memoryServer) {
      res.status(503).json({ error: 'Memory server not configured' });
      return;
    }

    try {
      const path = req.params[0] || req.path.replace('/vault/read/', '');
      const response = await config.memoryServer.memory_get(path);
      const data = JSON.parse(response.content[0].text);

      if (data.error) {
        res.status(404).json({ error: data.error, path: data.path });
        return;
      }

      updateSession(clientKey);
      res.json({
        success: true,
        path: data.path,
        content: data.content,
        length: data.length,
      });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // =========================================================================
  // Wallet Endpoints
  // =========================================================================

  app.get('/wallet/balance', async (req: AuthRequest, res: Response) => {
    const clientKey = getClientKey(req);
    if (!clientKey) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    try {
      const balanceInfo = await config.wallet.getBalanceAndUtxos();
      updateSession(clientKey);
      res.json({
        success: true,
        satoshis: balanceInfo.total,
        utxoCount: balanceInfo.utxos.length,
      });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.post('/wallet/create-transaction', async (req: AuthRequest, res: Response) => {
    const clientKey = getClientKey(req);
    if (!clientKey) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const { recipient, satoshis, data } = req.body;
    if (!recipient || !satoshis) {
      res.status(400).json({ error: 'Missing recipient or satoshis' });
      return;
    }

    if (satoshis <= 0) {
      res.status(400).json({ error: 'satoshis must be greater than 0' });
      return;
    }

    try {
      const outputs = [{
        script: recipient,
        satoshis,
        description: 'Payment output',
      }];

      if (data) {
        outputs.push({
          script: `OP_FALSE OP_RETURN ${Buffer.from(data).toString('hex')}`,
          satoshis: 0,
          description: 'Data output',
        });
      }

      const result = await config.wallet.createAction({
        description: 'Create transaction',
        outputs,
        options: {
          acceptDelayedBroadcast: false, // Force immediate broadcast to blockchain
        },
      });

      updateSession(clientKey);
      res.json({
        success: true,
        txid: result.txid,
        rawTx: result.rawTx,
      });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.post('/wallet/sign-message', async (req: AuthRequest, res: Response) => {
    const clientKey = getClientKey(req);
    if (!clientKey) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const { message, keyId } = req.body;
    if (!message) {
      res.status(400).json({ error: 'Missing message' });
      return;
    }

    try {
      const signature = await config.wallet.createSignature({
        data: Array.from(new TextEncoder().encode(message)),
        protocolID: [2, 'agidentity-plugin-sign'],
        keyID: keyId ?? `plugin-sign-${Date.now()}`,
        counterparty: clientKey,
      });

      const signatureHex = signature.signature
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');

      const signerKey = await config.wallet.getPublicKey({ identityKey: true });

      updateSession(clientKey);
      res.json({
        success: true,
        signature: signatureHex,
        signerPublicKey: signerKey.publicKey,
      });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.get('/wallet/network', async (req: AuthRequest, res: Response) => {
    const clientKey = getClientKey(req);
    if (!clientKey) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    try {
      const network = await config.wallet.getNetwork();
      updateSession(clientKey);
      res.json({
        success: true,
        network,
      });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // =========================================================================
  // Universal API - Framework-Agnostic Endpoints
  // =========================================================================
  // These endpoints provide simple HTTP access to AGIdentity capabilities
  // for ANY agent framework (OpenClaw, ZeroClaw, PicoClaw, custom agents, etc.)

  /**
   * GET /api/identity
   * Get agent's cryptographic identity and status
   * Public endpoint - no authentication required
   */
  app.get('/api/identity', async (_req: AuthRequest, res: Response) => {
    try {
      const identity = await config.wallet.getPublicKey({ identityKey: true });
      const balance = await config.wallet.getBalanceAndUtxos();
      const network = await config.wallet.getNetwork();

      res.json({
        success: true,
        publicKey: identity.publicKey,
        network,
        balance: balance.total,
        utxos: balance.utxos?.length || 0,
        status: 'active',
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  /**
   * POST /api/sign
   * Sign a message with agent's private key
   * Body: { message: string, protocol?: string }
   */
  app.post('/api/sign', async (req: AuthRequest, res: Response) => {
    try {
      const { message, protocol = 'agent message' } = req.body;

      if (!message) {
        res.status(400).json({ success: false, error: 'Missing message parameter' });
        return;
      }

      // Convert message to byte array
      const data = Array.from(Buffer.from(message, 'utf8'));

      // Create signature
      const result = await config.wallet.createSignature({
        data,
        protocolID: [0, protocol],
        keyID: '1',
        counterparty: 'self'
      });

      // Convert signature to hex
      const signatureHex = Buffer.from(result.signature).toString('hex');

      res.json({
        success: true,
        message,
        signature: signatureHex,
        protocol,
        signed: true,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  /**
   * POST /api/encrypt
   * Encrypt data for secure storage or communication
   * Body: { data: string, protocol?: string, keyId?: string, counterparty?: string }
   */
  app.post('/api/encrypt', async (req: AuthRequest, res: Response) => {
    try {
      const {
        data,
        protocol = 'agent memory',
        keyId = 'default',
        counterparty = 'self'
      } = req.body;

      if (!data) {
        res.status(400).json({ success: false, error: 'Missing data parameter' });
        return;
      }

      // Convert data to byte array
      const plaintext = Array.from(Buffer.from(data, 'utf8'));

      // Encrypt
      const result = await config.wallet.encrypt({
        plaintext,
        protocolID: [0, protocol],
        keyID: keyId,
        counterparty
      });

      // Convert ciphertext to hex
      const ciphertextHex = Buffer.from(result.ciphertext as number[]).toString('hex');

      res.json({
        success: true,
        ciphertext: ciphertextHex,
        encrypted: true,
        protocol,
        keyId,
        counterparty,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  /**
   * POST /api/decrypt
   * Decrypt previously encrypted data
   * Body: { ciphertext: string (hex), protocol?: string, keyId?: string, counterparty?: string }
   */
  app.post('/api/decrypt', async (req: AuthRequest, res: Response) => {
    try {
      const {
        ciphertext,
        protocol = 'agent memory',
        keyId = 'default',
        counterparty = 'self'
      } = req.body;

      if (!ciphertext) {
        res.status(400).json({ success: false, error: 'Missing ciphertext parameter' });
        return;
      }

      // Convert hex ciphertext to byte array
      const ciphertextBytes = Array.from(Buffer.from(ciphertext, 'hex'));

      // Decrypt
      const result = await config.wallet.decrypt({
        ciphertext: ciphertextBytes,
        protocolID: [0, protocol],
        keyID: keyId,
        counterparty
      });

      // Convert plaintext bytes to string
      const plaintextStr = Buffer.from(result.plaintext as number[]).toString('utf8');

      res.json({
        success: true,
        plaintext: plaintextStr,
        decrypted: true,
        protocol,
        keyId,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  /**
   * GET /api/balance
   * Check BSV wallet balance
   * Public endpoint - no authentication required
   */
  app.get('/api/balance', async (_req: AuthRequest, res: Response) => {
    try {
      const balance = await config.wallet.getBalanceAndUtxos();

      res.json({
        success: true,
        balance: balance.total,
        satoshis: balance.total,
        utxos: balance.utxos?.length || 0,
        network: await config.wallet.getNetwork(),
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  // =========================================================================
  // Health & Status
  // =========================================================================

  app.get('/health', (_req: AuthRequest, res: Response) => {
    res.json({
      status: 'healthy',
      agentIdentity: agentIdentity.publicKey,
      activeSessions: activeSessions.size,
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/status', (req: AuthRequest, res: Response) => {
    const clientKey = getClientKey(req);
    const session = clientKey ? activeSessions.get(clientKey) : null;

    res.json({
      authenticated: clientKey !== null,
      session: session ? {
        vaultInitialized: session.vaultInitialized,
        vaultId: session.vaultId,
        authenticatedAt: session.authenticatedAt,
        lastActivityAt: session.lastActivityAt,
      } : null,
    });
  });

  // =========================================================================
  // Error Handling
  // =========================================================================

  app.use((err: Error, _req: AuthRequest, res: Response, _next: NextFunction) => {
    console.error('Server error:', err);
    res.status(500).json({ error: 'Internal server error', message: err.message });
  });

  // =========================================================================
  // Server Lifecycle
  // =========================================================================

  let server: ReturnType<typeof app.listen> | null = null;

  return {
    app,

    async start() {
      return new Promise<void>((resolve) => {
        server = app.listen(port, () => {
          console.log(`AGIdentity server running on port ${port}`);
          console.log(`Agent identity: ${agentIdentity.publicKey}`);
          resolve();
        });
      });
    },

    async stop() {
      if (server) {
        return new Promise<void>((resolve) => {
          server!.close(() => {
            console.log('AGIdentity server stopped');
            resolve();
          });
        });
      }
    },

    getIdentityKey() {
      return agentIdentity.publicKey;
    },

    getActiveSessions() {
      return activeSessions;
    },
  };
}
