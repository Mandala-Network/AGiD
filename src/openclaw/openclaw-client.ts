/**
 * OpenClaw Gateway WebSocket Client
 *
 * Provides WebSocket-based communication with the OpenClaw Gateway for AI agent interactions.
 * Follows the AGIDMessageClient pattern with EventEmitter-based event handling.
 */

import WebSocket from 'ws';
import { EventEmitter } from 'events';
import type { AgentWallet } from '../wallet/agent-wallet.js';
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
} from '../types/index.js';

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
  private wallet: AgentWallet | null = null;
  private ws: WebSocket | null = null;
  private connected = false;
  private connecting = false;
  private pendingRequests = new Map<string, PendingRequest>();
  private requestId = 0;
  private sessionId: string | null = null;
  private deviceToken: string | null = null;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private chatMessageHandlers = new Set<(event: ChatMessageEvent) => void>();

  constructor(config: OpenClawClientConfig = {}) {
    super();

    // Store wallet for device identity
    this.wallet = config.wallet ?? null;

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

        this.ws.on('open', async () => {
          // Send connect request immediately (OpenClaw v3 protocol)
          try {
            await this.sendConnectRequest();
          } catch (err) {
            this.emit('error', new Error(`Failed to send connect request: ${err}`));
          }
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
   * @returns Message ID
   */
  async sendChat(content: string, options?: Partial<ChatSendParams>): Promise<string> {
    const params: ChatSendParams = {
      content,
      sessionId: options?.sessionId ?? this.sessionId ?? undefined,
      role: options?.role ?? 'user',
      context: options?.context,
    };

    const response = await this.sendRequest('chat.send', params as unknown as Record<string, unknown>);

    if (!response.ok) {
      throw new Error(response.error?.message ?? 'Failed to send chat message');
    }

    return (response.payload?.messageId as string) ?? '';
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

      case 'res':
        this.handleResponse(message as OpenClawResponse);
        break;

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
        // Legacy protocol - OpenClaw v3 doesn't use challenge-response
        // Keeping for backwards compatibility
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

      case 'chat.message': {
        // Chat message from agent
        const chatEvent = event as unknown as ChatMessageEvent;
        for (const handler of this.chatMessageHandlers) {
          try {
            handler(chatEvent);
          } catch (err) {
            this.emit('error', new Error(`Chat handler error: ${err}`));
          }
        }
        this.emit('chat.message', chatEvent);
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

    const signedAt = Date.now();
    const instanceId = `agidentity-${signedAt}`;

    const connectParams: ConnectParams = {
      minProtocol: 3,
      maxProtocol: 3,
      client: {
        id: 'cli',
        version: '0.1.0',
        platform: process.platform,
        mode: 'cli',
        instanceId,
      },
      auth: {
        token: this.config.authToken || undefined,
      },
      caps: [],
    };

    // If wallet is available, use it for device identity
    if (this.wallet) {
      try {
        // Get wallet's identity public key
        const { publicKey } = await this.wallet.getPublicKey({ identityKey: true });

        // Create message to sign: deviceId + timestamp
        const messageToSign = `${instanceId}:${signedAt}`;

        // Sign with wallet (data must be number[] or Uint8Array)
        const messageBytes = Array.from(Buffer.from(messageToSign, 'utf8'));
        const signatureResult = await this.wallet.createSignature({
          data: messageBytes,
          protocolID: [2, 'openclaw device identity'],
          keyID: '1',
        });

        // Convert signature from number[] to hex string
        const signatureHex = Buffer.from(signatureResult.signature).toString('hex');

        // Add device identity to connect params
        connectParams.device = {
          id: instanceId,
          publicKey,
          signature: signatureHex,
          signedAt,
        };
      } catch (err) {
        // Log warning but continue - OpenClaw might allow connection without device
        console.warn('[OpenClaw] Failed to create device signature:', err);
      }
    }

    const request: OpenClawRequest = {
      type: 'req',
      id: this.generateRequestId(),
      method: 'connect',
      params: connectParams as unknown as Record<string, unknown>,
    };

    this.ws.send(JSON.stringify(request));
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
