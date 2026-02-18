/**
 * OpenClaw Gateway WebSocket Client
 *
 * Provides WebSocket-based communication with the OpenClaw Gateway for AI agent interactions.
 * Follows the AGIDMessageClient pattern with EventEmitter-based event handling.
 */

import WebSocket from 'ws';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';
import type { AgentWallet } from '../../01-core/wallet/agent-wallet.js';
import type {
  OpenClawRequest,
  OpenClawResponse,
  OpenClawEvent,
  OpenClawMessage,
  OpenClawGatewayConfig,
  ChatSendParams,
  ChatMessageEvent,
  ConnectParams,
  HelloOkEvent,
} from '../../07-shared/types/index.js';

/**
 * Configuration for OpenClawClient
 */
export interface OpenClawClientConfig extends OpenClawGatewayConfig {
  /** Agent wallet for device identity (optional - uses wallet key as device key) */
  wallet?: AgentWallet;
  /** Timeout for requests in ms (default: 30000) */
  requestTimeout?: number;
}

interface PendingRequest {
  resolve: (r: OpenClawResponse) => void;
  reject: (e: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

interface ResolvedReconnectConfig {
  maxAttempts: number;
  delayMs: number;
  backoffMultiplier: number;
}

interface ResolvedOpenClawClientConfig {
  gatewayUrl: string;
  authToken: string;
  sessionScope: 'shared' | 'per-sender' | 'per-conversation';
  reconnect: ResolvedReconnectConfig;
  requestTimeout: number;
}

/**
 * OpenClaw Gateway WebSocket Client
 *
 * Provides secure communication with the OpenClaw Gateway using WebSocket protocol.
 * Implements request/response pattern with timeout handling and automatic reconnection.
 *
 * @example
 * ```typescript
 * import { createOpenClawClient } from 'agidentity';
 *
 * const client = await createOpenClawClient({
 *   gatewayUrl: 'ws://127.0.0.1:18789',
 *   authToken: 'your-token',
 * });
 *
 * // Send a chat message
 * const messageId = await client.sendChat('Hello, OpenClaw!');
 *
 * // Listen for chat responses
 * client.onChatMessage((event) => {
 *   console.log('Response:', event.payload.content);
 * });
 *
 * // Disconnect when done
 * await client.disconnect();
 * ```
 */
export class OpenClawClient extends EventEmitter {
  private config: ResolvedOpenClawClientConfig;
  // private _wallet: AgentWallet | null = null; // Reserved for future device identity support
  private ws: WebSocket | null = null;
  private connected = false;
  private connecting = false;
  private pendingRequests = new Map<string, PendingRequest>();
  private requestId = 0;
  private sessionId: string | null = null;
  private deviceToken: string | null = null;
  private connectNonce: string | null = null;
  private deviceKeyPair: { publicKey: crypto.KeyObject; privateKey: crypto.KeyObject } | null = null;
  private deviceId: string | null = null;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private chatMessageHandlers = new Set<(event: ChatMessageEvent) => void>();

  constructor(config: OpenClawClientConfig = {}) {
    super();

    // config.wallet reserved for future device identity support

    // Apply defaults with environment variable support
    const defaultReconnect = {
      maxAttempts: 10,
      delayMs: 1000,
      backoffMultiplier: 2,
    };

    this.config = {
      gatewayUrl: config.gatewayUrl ?? process.env.OPENCLAW_GATEWAY_URL ?? 'ws://127.0.0.1:18789',
      authToken: config.authToken ?? process.env.OPENCLAW_GATEWAY_TOKEN ?? '',
      sessionScope: config.sessionScope ?? (process.env.OPENCLAW_SESSION_SCOPE as 'shared' | 'per-sender' | 'per-conversation') ?? 'shared',
      reconnect: {
        ...defaultReconnect,
        ...config.reconnect,
      },
      requestTimeout: config.requestTimeout ?? 30000,
    };
  }

  /**
   * Connect to the OpenClaw Gateway
   * Performs the challenge-response handshake
   */
  async connect(): Promise<void> {
    if (this.connected) {
      return;
    }

    if (this.connecting) {
      // Wait for existing connection attempt
      return new Promise((resolve, reject) => {
        const onConnect = () => {
          this.off('error', onError);
          resolve();
        };
        const onError = (err: Error) => {
          this.off('connected', onConnect);
          reject(err);
        };
        this.once('connected', onConnect);
        this.once('error', onError);
      });
    }

    this.connecting = true;

    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.config.gatewayUrl);

        const connectionTimeout = setTimeout(() => {
          if (this.ws && !this.connected) {
            this.ws.terminate();
            const error = new Error('Connection timeout');
            this.connecting = false;
            reject(error);
          }
        }, this.config.requestTimeout);

        this.ws.on('open', () => {
          // Wait for connect.challenge from server before sending connect
          // The server sends a nonce that must be included in our connect request
        });

        this.ws.on('message', async (data: WebSocket.Data) => {
          try {
            const message: OpenClawMessage = JSON.parse(data.toString());
            await this.handleMessage(message, resolve, reject, connectionTimeout);
          } catch (err) {
            this.emit('error', new Error(`Failed to parse message: ${err}`));
          }
        });

        this.ws.on('close', (code: number, reason: Buffer) => {
          clearTimeout(connectionTimeout);
          this.handleDisconnect(code, reason.toString());
        });

        this.ws.on('error', (err: Error) => {
          clearTimeout(connectionTimeout);
          this.connecting = false;
          if (!this.connected) {
            reject(err);
          } else {
            this.emit('error', err);
          }
        });
      } catch (err) {
        this.connecting = false;
        reject(err);
      }
    });
  }

  /**
   * Disconnect from the OpenClaw Gateway
   */
  async disconnect(): Promise<void> {
    // Clear reconnect timer
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    // Reject all pending requests
    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Disconnected'));
    }
    this.pendingRequests.clear();

    // Close WebSocket
    if (this.ws) {
      this.ws.removeAllListeners();
      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.close(1000, 'Client disconnect');
      }
      this.ws = null;
    }

    this.connected = false;
    this.connecting = false;
    this.sessionId = null;
    this.reconnectAttempt = 0;
  }

  /**
   * Send a request to the OpenClaw Gateway
   */
  async sendRequest(method: string, params?: Record<string, unknown>): Promise<OpenClawResponse> {
    if (!this.connected || !this.ws) {
      throw new Error('Not connected');
    }

    const id = this.generateRequestId();
    const request: OpenClawRequest = {
      type: 'req',
      id,
      method,
      params,
    };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request timeout: ${method}`));
      }, this.config.requestTimeout);

      this.pendingRequests.set(id, { resolve, reject, timeout });
      this.ws!.send(JSON.stringify(request));
    });
  }

  /**
   * Send a chat message to the OpenClaw agent
   * @param message - The message content
   * @param options - Additional options (sessionKey, idempotencyKey auto-generated if not provided)
   * @returns Run ID from the response
   */
  async sendChat(message: string, options?: {
    sessionKey?: string;
    idempotencyKey?: string;
    thinking?: string;
    deliver?: boolean;
    timeoutMs?: number;
    context?: Record<string, unknown>;
  }): Promise<string> {
    const sessionKey = options?.sessionKey ?? this.sessionId ?? `session-${Date.now()}`;
    const idempotencyKey = options?.idempotencyKey ?? `${Date.now()}-${Math.random().toString(36).substring(2)}`;

    // If context is provided, prepend it to the message as identity metadata
    let fullMessage = message;
    if (options?.context) {
      const contextStr = Object.entries(options.context)
        .map(([k, v]) => `${k}: ${v}`)
        .join(', ');
      fullMessage = `[Identity: ${contextStr}]\n\n${message}`;
    }

    const params: ChatSendParams = {
      sessionKey,
      message: fullMessage,
      idempotencyKey,
      thinking: options?.thinking,
      deliver: options?.deliver,
      timeoutMs: options?.timeoutMs,
    };

    const response = await this.sendRequest('chat.send', params as unknown as Record<string, unknown>);

    if (!response.ok) {
      throw new Error(response.error?.message ?? 'Failed to send chat message');
    }

    return (response.payload?.runId as string) ?? '';
  }

  /**
   * Register a handler for chat message events
   */
  onChatMessage(handler: (event: ChatMessageEvent) => void): void {
    this.chatMessageHandlers.add(handler);
  }

  /**
   * Remove a chat message handler
   */
  offChatMessage(handler: (event: ChatMessageEvent) => void): void {
    this.chatMessageHandlers.delete(handler);
  }

  /**
   * Check if connected to the gateway
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Get the current session ID
   */
  getSessionId(): string | null {
    return this.sessionId;
  }

  /**
   * Get the device token (received after authentication)
   */
  getDeviceToken(): string | null {
    return this.deviceToken;
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  private async handleMessage(
    message: OpenClawMessage,
    connectResolve?: (value: void) => void,
    connectReject?: (reason: Error) => void,
    connectionTimeout?: ReturnType<typeof setTimeout>
  ): Promise<void> {
    switch (message.type) {
      case 'event':
        await this.handleEvent(message as OpenClawEvent, connectResolve, connectReject, connectionTimeout);
        break;

      case 'res': {
        const response = message as OpenClawResponse;
        // Check if this is the connect response (during handshake)
        if (!this.connected && this.connecting) {
          const payload = (response as any).payload;
          if (response.ok && payload?.type === 'hello-ok') {
            // Connection successful
            this.deviceToken = payload.auth?.deviceToken ?? null;
            this.sessionId = payload.session?.id ?? null;
            this.connected = true;
            this.connecting = false;
            this.reconnectAttempt = 0;
            if (connectionTimeout) clearTimeout(connectionTimeout);
            this.emit('connected');
            if (connectResolve) connectResolve();
          } else if (!response.ok) {
            // Connect failed
            const errorMsg = (response as any).error?.message ?? 'Connection rejected';
            this.connected = false;
            this.connecting = false;
            if (connectionTimeout) clearTimeout(connectionTimeout);
            const error = new Error(errorMsg);
            this.emit('error', error);
            if (connectReject) connectReject(error);
          }
        } else {
          this.handleResponse(response);
        }
        break;
      }

      case 'req':
        // Server-initiated requests (not typical in this protocol)
        this.emit('request', message);
        break;
    }
  }

  private async handleEvent(
    event: OpenClawEvent,
    connectResolve?: (value: void) => void,
    connectReject?: (reason: Error) => void,
    connectionTimeout?: ReturnType<typeof setTimeout>
  ): Promise<void> {
    switch (event.event) {
      case 'connect.challenge': {
        // Server sends nonce that must be included in connect request
        const challengePayload = event.payload as { nonce?: string };
        this.connectNonce = challengePayload?.nonce ?? null;
        await this.sendConnectRequest();
        break;
      }

      case 'hello-ok': {
        // Connection successful
        const helloEvent = event as unknown as HelloOkEvent;
        this.deviceToken = helloEvent.payload.auth?.deviceToken ?? null;
        this.sessionId = helloEvent.payload.session?.id ?? null;
        this.connected = true;
        this.connecting = false;
        this.reconnectAttempt = 0;

        if (connectionTimeout) {
          clearTimeout(connectionTimeout);
        }

        this.emit('connected');
        if (connectResolve) {
          connectResolve();
        }
        break;
      }

      case 'auth.failed': {
        // Authentication failed
        this.connected = false;
        this.connecting = false;
        const error = new Error('Authentication failed');

        if (connectionTimeout) {
          clearTimeout(connectionTimeout);
        }

        this.emit('error', error);
        if (connectReject) {
          connectReject(error);
        }
        break;
      }

      case 'chat.message':
      case 'chat': {
        // Chat message from agent (OpenClaw broadcasts as "chat" event)
        const chatEvent = event as unknown as ChatMessageEvent;
        for (const handler of this.chatMessageHandlers) {
          try {
            handler(chatEvent);
          } catch (err) {
            this.emit('error', new Error(`Chat handler error: ${err}`));
          }
        }
        this.emit('chat', chatEvent);
        break;
      }

      default:
        // Emit generic event
        this.emit('event', event);
        this.emit(event.event, event);
    }
  }

  private handleResponse(response: OpenClawResponse): void {
    const pending = this.pendingRequests.get(response.id);
    if (pending) {
      clearTimeout(pending.timeout);
      this.pendingRequests.delete(response.id);
      pending.resolve(response);
    }
  }

  private async sendConnectRequest(): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket not open');
    }

    // Ensure we have a device key pair for Ed25519 device identity
    this.ensureDeviceKeyPair();

    const signedAt = Date.now();
    const instanceId = `agidentity-${signedAt}`;
    const role = 'operator';
    const scopes = ['operator.admin', 'operator.write'];
    const clientId = 'gateway-client';
    const clientMode = 'backend';

    // Build the device auth payload (matches OpenClaw's buildDeviceAuthPayload)
    const nonce = this.connectNonce ?? '';
    const version = nonce ? 'v2' : 'v1';
    const payloadParts = [
      version,
      this.deviceId!,
      clientId,
      clientMode,
      role,
      scopes.join(','),
      String(signedAt),
      this.config.authToken || '',
    ];
    if (version === 'v2') payloadParts.push(nonce);
    const payload = payloadParts.join('|');

    // Sign with Ed25519 private key
    const signature = crypto.sign(null, Buffer.from(payload, 'utf8'), this.deviceKeyPair!.privateKey);
    const signatureBase64Url = signature.toString('base64url');

    // Get raw public key bytes in base64url
    const publicKeyRaw = this.deviceKeyPair!.publicKey.export({ type: 'spki', format: 'der' });
    // Ed25519 SPKI DER is 44 bytes: 12 byte prefix + 32 byte raw key
    const rawKeyBytes = publicKeyRaw.subarray(12);
    const publicKeyBase64Url = rawKeyBytes.toString('base64url');

    const connectParams: ConnectParams = {
      minProtocol: 3,
      maxProtocol: 3,
      client: {
        id: clientId,
        version: '0.1.0',
        platform: process.platform,
        mode: clientMode,
        instanceId,
      },
      auth: {
        token: this.config.authToken || undefined,
      },
      device: {
        id: this.deviceId!,
        publicKey: publicKeyBase64Url,
        signature: signatureBase64Url,
        signedAt,
        nonce: nonce || undefined,
      },
      role,
      scopes,
      caps: [],
    };

    const request: OpenClawRequest = {
      type: 'req',
      id: this.generateRequestId(),
      method: 'connect',
      params: connectParams as unknown as Record<string, unknown>,
    };

    this.ws.send(JSON.stringify(request));
  }

  /**
   * Ensure we have an Ed25519 key pair for device identity.
   * Persists to ~/.agidentity/device-key.json for stable device ID across restarts.
   */
  private ensureDeviceKeyPair(): void {
    if (this.deviceKeyPair && this.deviceId) return;

    const keyDir = path.join(process.env.HOME || '/tmp', '.agidentity');
    const keyFile = path.join(keyDir, 'device-key.json');

    try {
      // Try to load existing key
      const saved = JSON.parse(fs.readFileSync(keyFile, 'utf8'));
      this.deviceKeyPair = {
        privateKey: crypto.createPrivateKey({
          key: Buffer.from(saved.privateKey, 'base64'),
          type: 'pkcs8',
          format: 'der',
        }),
        publicKey: crypto.createPublicKey({
          key: Buffer.from(saved.publicKey, 'base64'),
          type: 'spki',
          format: 'der',
        }),
      };
    } catch {
      // Generate new Ed25519 key pair
      const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
      this.deviceKeyPair = { publicKey, privateKey };

      // Persist
      fs.mkdirSync(keyDir, { recursive: true });
      fs.writeFileSync(keyFile, JSON.stringify({
        privateKey: privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'),
        publicKey: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
      }), 'utf8');
    }

    // Derive device ID from public key (SHA-256 of raw bytes)
    const spki = this.deviceKeyPair.publicKey.export({ type: 'spki', format: 'der' });
    const rawKey = spki.subarray(12); // Strip Ed25519 SPKI prefix
    this.deviceId = crypto.createHash('sha256').update(rawKey).digest('hex');
  }

  private handleDisconnect(code: number, reason: string): void {
    const wasConnected = this.connected;
    this.connected = false;
    this.connecting = false;

    // Reject pending requests
    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error(`Disconnected: ${code} ${reason}`));
    }
    this.pendingRequests.clear();

    this.emit('disconnected', { code, reason });

    // Attempt reconnection if was previously connected and not a clean close
    if (wasConnected && code !== 1000 && this.reconnectAttempt < this.config.reconnect.maxAttempts) {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    const delay = Math.min(
      this.config.reconnect.delayMs * Math.pow(this.config.reconnect.backoffMultiplier, this.reconnectAttempt),
      30000 // Max 30 seconds
    );

    this.reconnectAttempt++;
    this.emit('reconnecting', { attempt: this.reconnectAttempt, delay });

    this.reconnectTimer = setTimeout(async () => {
      try {
        await this.connect();
        this.emit('reconnected');
      } catch (err) {
        // handleDisconnect will schedule next attempt if needed
        if (this.reconnectAttempt < this.config.reconnect.maxAttempts) {
          this.scheduleReconnect();
        } else {
          this.emit('error', new Error(`Max reconnection attempts reached`));
        }
      }
    }, delay);
  }

  private generateRequestId(): string {
    return `${Date.now()}-${++this.requestId}`;
  }
}
