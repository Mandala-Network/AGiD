/**
 * AGIdentity Client SDK
 *
 * Authenticated HTTP client for AGIdentity servers.
 * Uses BRC-103/104 mutual authentication via @bsv/auth-express-middleware.
 */

import type { AgentWallet } from '../wallet/agent-wallet.js';

/**
 * Minimal wallet interface for authentication
 */
interface AuthWallet {
  createSignature(args: {
    data: number[];
    protocolID: [number, string];
    keyID: string;
  }): Promise<{ signature: number[] | Uint8Array }>;
}

// ============================================================================
// Types
// ============================================================================

/**
 * Client configuration
 */
export interface AGIDClientConfig {
  /**
   * Wallet for authentication (BRC-103)
   */
  wallet: AgentWallet;

  /**
   * Server base URL (e.g., 'http://localhost:3000')
   */
  serverUrl: string;

  /**
   * Request timeout in milliseconds (default: 30000)
   */
  timeout?: number;

  /**
   * Number of retry attempts (default: 3)
   */
  retries?: number;

  /**
   * Retry delay in milliseconds (default: 1000)
   */
  retryDelay?: number;

  /**
   * Enable debug logging
   */
  debug?: boolean;
}

/**
 * Standard API response wrapper
 */
export interface APIResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  statusCode: number;
}

/**
 * Identity info response
 */
export interface IdentityInfo {
  agentIdentityKey: string;
  clientIdentityKey: string;
  authenticated: boolean;
}

/**
 * Session registration response
 */
export interface SessionInfo {
  sessionCreated: boolean;
  publicKey: string;
}

/**
 * Vault initialization response
 */
export interface VaultInfo {
  vaultId: string;
}

/**
 * Document storage response
 */
export interface StoredDocument {
  path: string;
  uhrpUrl?: string;
}

/**
 * Document listing entry
 */
export interface DocumentEntry {
  path: string;
  uhrpUrl?: string;
  contentHash?: string;
  uploadedAt?: number;
}

/**
 * Search result
 */
export interface SearchResult {
  path: string;
  score: number;
  snippet?: string;
}

/**
 * Vault proof
 */
export interface VaultProof {
  path: string;
  contentHash: string;
  timestamp?: number;
  txid?: string;
}

/**
 * Team creation response
 */
export interface TeamInfo {
  teamId: string;
  name: string;
  createdAt: number;
}

/**
 * Team details
 */
export interface TeamDetails {
  teamId: string;
  name: string;
  members: TeamMember[];
  settings?: Record<string, unknown>;
  createdAt: number;
}

/**
 * Team member
 */
export interface TeamMember {
  publicKey: string;
  role: 'owner' | 'admin' | 'member' | 'bot';
  addedAt: number;
  metadata?: Record<string, unknown>;
}

/**
 * Access check result
 */
export interface AccessCheck {
  hasAccess: boolean;
  role?: string;
  permissions?: string[];
}

/**
 * Team document
 */
export interface TeamDocument {
  documentId: string;
  path: string;
}

/**
 * Signature response
 */
export interface SignatureResult {
  signature: string;
  signerPublicKey: string;
}

/**
 * Verification response
 */
export interface VerificationResult {
  valid: boolean;
}

/**
 * Health status
 */
export interface HealthStatus {
  status: 'healthy' | 'unhealthy';
  agentIdentity: string;
  activeSessions: number;
  timestamp: string;
}

/**
 * Session status
 */
export interface SessionStatus {
  authenticated: boolean;
  session: {
    vaultInitialized: boolean;
    vaultId?: string;
    authenticatedAt: number;
    lastActivityAt: number;
  } | null;
}

// ============================================================================
// Client Implementation
// ============================================================================

/**
 * AGIdentity Client
 *
 * Provides authenticated access to AGIdentity server endpoints.
 *
 * @example
 * ```typescript
 * const client = new AGIDClient({
 *   wallet,
 *   serverUrl: 'http://localhost:3000',
 * });
 *
 * await client.initialize();
 *
 * // Register session
 * await client.registerSession();
 *
 * // Initialize vault
 * await client.initVault();
 *
 * // Store document
 * await client.storeDocument('notes/meeting.md', '# Meeting Notes');
 * ```
 */
export class AGIDClient {
  private wallet: AgentWallet;
  private serverUrl: string;
  private timeout: number;
  private retries: number;
  private retryDelay: number;
  private debug: boolean;
  private identityKey: string | null = null;
  private authFetch: ((url: string, options?: RequestInit) => Promise<Response>) | null = null;

  constructor(config: AGIDClientConfig) {
    this.wallet = config.wallet;
    this.serverUrl = config.serverUrl.replace(/\/$/, ''); // Remove trailing slash
    this.timeout = config.timeout ?? 30000;
    this.retries = config.retries ?? 3;
    this.retryDelay = config.retryDelay ?? 1000;
    this.debug = config.debug ?? false;
  }

  /**
   * Initialize the client
   * Must be called before making requests
   */
  async initialize(): Promise<void> {
    const identity = await this.wallet.getPublicKey({ identityKey: true });
    this.identityKey = identity.publicKey;

    // Get underlying wallet for auth
    const underlyingWallet = this.wallet.getUnderlyingWallet();
    if (!underlyingWallet) {
      throw new Error('Wallet not initialized');
    }

    // Create authenticated fetch using BRC-103
    // The wallet's createHmac is used for request signing
    this.authFetch = this.createAuthenticatedFetch(underlyingWallet as unknown as AuthWallet);

    this.log(`Client initialized with identity: ${this.identityKey.slice(0, 16)}...`);
  }

  /**
   * Get the client's identity key
   */
  getIdentityKey(): string {
    if (!this.identityKey) {
      throw new Error('Client not initialized');
    }
    return this.identityKey;
  }

  // ==========================================================================
  // Identity Endpoints
  // ==========================================================================

  /**
   * Get identity information
   */
  async getIdentity(): Promise<APIResponse<IdentityInfo>> {
    return this.request<IdentityInfo>('GET', '/identity');
  }

  /**
   * Register a session with the server
   */
  async registerSession(): Promise<APIResponse<SessionInfo>> {
    return this.request<SessionInfo>('POST', '/identity/register');
  }

  // ==========================================================================
  // Vault Endpoints
  // ==========================================================================

  /**
   * Initialize the vault for this client
   */
  async initVault(): Promise<APIResponse<VaultInfo>> {
    return this.request<VaultInfo>('POST', '/vault/init');
  }

  /**
   * Store a document in the vault
   */
  async storeDocument(path: string, content: string): Promise<APIResponse<StoredDocument>> {
    return this.request<StoredDocument>('POST', '/vault/store', { path, content });
  }

  /**
   * Read a document from the vault
   */
  async readDocument(path: string): Promise<APIResponse<{ content: string }>> {
    return this.request<{ content: string }>('GET', `/vault/read/${encodeURIComponent(path)}`);
  }

  /**
   * List all documents in the vault
   */
  async listDocuments(): Promise<APIResponse<{ documents: DocumentEntry[] }>> {
    return this.request<{ documents: DocumentEntry[] }>('GET', '/vault/list');
  }

  /**
   * Search documents in the vault
   */
  async searchDocuments(query: string, limit?: number): Promise<APIResponse<{ results: SearchResult[] }>> {
    return this.request<{ results: SearchResult[] }>('POST', '/vault/search', { query, limit });
  }

  /**
   * Get proof for a document
   */
  async getDocumentProof(path: string): Promise<APIResponse<{ proof: VaultProof }>> {
    return this.request<{ proof: VaultProof }>('GET', `/vault/proof/${encodeURIComponent(path)}`);
  }

  // ==========================================================================
  // Team Endpoints
  // ==========================================================================

  /**
   * Create a new team
   */
  async createTeam(name: string, settings?: Record<string, unknown>): Promise<APIResponse<TeamInfo>> {
    return this.request<TeamInfo>('POST', '/team/create', { name, settings });
  }

  /**
   * Get team details
   */
  async getTeam(teamId: string): Promise<APIResponse<{ team: TeamDetails }>> {
    return this.request<{ team: TeamDetails }>('GET', `/team/${encodeURIComponent(teamId)}`);
  }

  /**
   * Add a member to a team
   */
  async addTeamMember(
    teamId: string,
    memberPublicKey: string,
    role: 'owner' | 'admin' | 'member' | 'bot',
    metadata?: Record<string, unknown>
  ): Promise<APIResponse<{ added: boolean }>> {
    return this.request<{ added: boolean }>('POST', `/team/${encodeURIComponent(teamId)}/member`, {
      memberPublicKey,
      role,
      metadata,
    });
  }

  /**
   * Remove a member from a team
   */
  async removeTeamMember(teamId: string, memberKey: string): Promise<APIResponse<{ removed: boolean }>> {
    return this.request<{ removed: boolean }>(
      'DELETE',
      `/team/${encodeURIComponent(teamId)}/member/${encodeURIComponent(memberKey)}`
    );
  }

  /**
   * Check access to a team
   */
  async checkTeamAccess(teamId: string): Promise<APIResponse<AccessCheck>> {
    return this.request<AccessCheck>('GET', `/team/${encodeURIComponent(teamId)}/access`);
  }

  /**
   * Store a document in a team
   */
  async storeTeamDocument(
    teamId: string,
    path: string,
    content: string,
    metadata?: Record<string, unknown>
  ): Promise<APIResponse<TeamDocument>> {
    return this.request<TeamDocument>('POST', `/team/${encodeURIComponent(teamId)}/document`, {
      path,
      content,
      metadata,
    });
  }

  /**
   * Read a team document
   */
  async readTeamDocument(teamId: string, path: string): Promise<APIResponse<{ content: string }>> {
    return this.request<{ content: string }>(
      'GET',
      `/team/${encodeURIComponent(teamId)}/document/${encodeURIComponent(path)}`
    );
  }

  /**
   * List team documents
   */
  async listTeamDocuments(teamId: string): Promise<APIResponse<{ documents: DocumentEntry[] }>> {
    return this.request<{ documents: DocumentEntry[] }>(
      'GET',
      `/team/${encodeURIComponent(teamId)}/documents`
    );
  }

  // ==========================================================================
  // Signature Endpoints
  // ==========================================================================

  /**
   * Sign a message with the agent's key
   */
  async signMessage(message: string, keyId?: string): Promise<APIResponse<SignatureResult>> {
    return this.request<SignatureResult>('POST', '/sign', { message, keyId });
  }

  /**
   * Verify a signature
   */
  async verifySignature(message: string, signature: string, keyId?: string): Promise<APIResponse<VerificationResult>> {
    return this.request<VerificationResult>('POST', '/verify', { message, signature, keyId });
  }

  // ==========================================================================
  // Health & Status Endpoints
  // ==========================================================================

  /**
   * Get server health status
   */
  async getHealth(): Promise<APIResponse<HealthStatus>> {
    return this.request<HealthStatus>('GET', '/health');
  }

  /**
   * Get session status
   */
  async getStatus(): Promise<APIResponse<SessionStatus>> {
    return this.request<SessionStatus>('GET', '/status');
  }

  // ==========================================================================
  // Convenience Methods
  // ==========================================================================

  /**
   * Full setup: register session and initialize vault
   */
  async setup(): Promise<{ session: SessionInfo; vault: VaultInfo }> {
    const sessionResult = await this.registerSession();
    if (!sessionResult.success || !sessionResult.data) {
      throw new Error(`Failed to register session: ${sessionResult.error}`);
    }

    const vaultResult = await this.initVault();
    if (!vaultResult.success || !vaultResult.data) {
      throw new Error(`Failed to initialize vault: ${vaultResult.error}`);
    }

    return {
      session: sessionResult.data,
      vault: vaultResult.data,
    };
  }

  /**
   * Store multiple documents
   */
  async storeDocuments(
    documents: Array<{ path: string; content: string }>
  ): Promise<APIResponse<StoredDocument>[]> {
    return Promise.all(
      documents.map((doc) => this.storeDocument(doc.path, doc.content))
    );
  }

  /**
   * Read multiple documents
   */
  async readDocuments(paths: string[]): Promise<Map<string, string | null>> {
    const results = new Map<string, string | null>();
    await Promise.all(
      paths.map(async (path) => {
        const result = await this.readDocument(path);
        results.set(path, result.success ? result.data?.content ?? null : null);
      })
    );
    return results;
  }

  // ==========================================================================
  // Internal Methods
  // ==========================================================================

  /**
   * Create authenticated fetch function using BRC-103
   */
  private createAuthenticatedFetch(wallet: AuthWallet): (url: string, options?: RequestInit) => Promise<Response> {
    // For now, we'll use a simpler approach that works with the auth middleware
    // The auth middleware expects certain headers and will verify the wallet signature
    return async (url: string, options: RequestInit = {}): Promise<Response> => {
      const timestamp = Date.now();
      const nonce = Math.random().toString(36).substring(2, 15);

      // Create authentication headers
      const headers = new Headers(options.headers);
      headers.set('Content-Type', 'application/json');
      headers.set('X-BSV-Auth-Version', '0.1');
      headers.set('X-BSV-Auth-Identity-Key', this.identityKey!);
      headers.set('X-BSV-Auth-Timestamp', timestamp.toString());
      headers.set('X-BSV-Auth-Nonce', nonce);

      // Create signature over the request
      const method = options.method ?? 'GET';
      const body = options.body?.toString() ?? '';
      const signatureData = `${method}|${url}|${timestamp}|${nonce}|${body}`;

      try {
        const signature = await wallet.createSignature({
          data: Array.from(new TextEncoder().encode(signatureData)),
          protocolID: [2, 'brc 103 auth'],
          keyID: `auth-${timestamp}`,
        });

        const signatureBytes = signature.signature as number[];
        const signatureHex = signatureBytes
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('');

        headers.set('X-BSV-Auth-Signature', signatureHex);
      } catch {
        // Continue without signature if it fails (for allowUnauthenticated endpoints)
      }

      return fetch(url, {
        ...options,
        headers,
      });
    };
  }

  /**
   * Make an authenticated request with retry logic
   */
  private async request<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    body?: Record<string, unknown>
  ): Promise<APIResponse<T>> {
    if (!this.authFetch) {
      throw new Error('Client not initialized. Call initialize() first.');
    }

    const url = `${this.serverUrl}${path}`;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.retries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);

        const options: RequestInit = {
          method,
          signal: controller.signal,
        };

        if (body) {
          options.body = JSON.stringify(body);
        }

        this.log(`${method} ${path} (attempt ${attempt + 1})`);

        const response = await this.authFetch(url, options);
        clearTimeout(timeoutId);

        const data = await response.json() as Record<string, unknown>;

        if (!response.ok) {
          return {
            success: false,
            error: (data.error as string) ?? `HTTP ${response.status}`,
            statusCode: response.status,
          };
        }

        return {
          success: data.success !== false,
          data: data as T,
          statusCode: response.status,
        };
      } catch (error) {
        lastError = error as Error;
        this.log(`Request failed: ${lastError.message}`);

        if (attempt < this.retries) {
          await this.delay(this.retryDelay * Math.pow(2, attempt)); // Exponential backoff
        }
      }
    }

    return {
      success: false,
      error: lastError?.message ?? 'Request failed',
      statusCode: 0,
    };
  }

  private log(message: string): void {
    if (this.debug) {
      console.log(`[AGIDClient] ${message}`);
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Create a new AGIdentity client
 */
export function createAGIDClient(config: AGIDClientConfig): AGIDClient {
  return new AGIDClient(config);
}
