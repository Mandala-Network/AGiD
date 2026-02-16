/**
 * OpenClaw Gateway WebSocket Protocol Types
 * Based on actual OpenClaw Gateway protocol at ws://127.0.0.1:18789
 */

// Message types following OpenClaw protocol
export interface OpenClawRequest {
  type: 'req';
  id: string;
  method: string;
  params?: Record<string, unknown>;
}

export interface OpenClawResponse {
  type: 'res';
  id: string;
  ok: boolean;
  payload?: Record<string, unknown>;
  error?: {
    code: string;
    message: string;
  };
}

export interface OpenClawEvent {
  type: 'event';
  event: string;
  payload: Record<string, unknown>;
  seq?: number;
  stateVersion?: number;
}

export type OpenClawMessage = OpenClawRequest | OpenClawResponse | OpenClawEvent;

// Connection handshake types
export interface ConnectParams {
  minProtocol: number;
  maxProtocol: number;
  client: {
    id: 'gateway-client' | 'cli' | 'test' | string;
    displayName?: string;
    version: string;
    platform: string;
    deviceFamily?: string;
    modelIdentifier?: string;
    mode: 'cli' | 'node' | 'test' | 'webchat' | 'ui' | 'backend' | 'probe';
    instanceId?: string;
  };
  auth?: {
    token?: string;
    password?: string;
  };
  device?: {
    id: string;
    publicKey: string;
    signature: string;
    signedAt: number;
    nonce?: string;
  };
  role?: string;
  caps?: string[];
  scopes?: string[];
}

export interface ConnectChallengeEvent {
  type: 'event';
  event: 'connect.challenge';
  payload: {
    nonce: string;
  };
}

export interface HelloOkEvent {
  type: 'event';
  event: 'hello-ok';
  payload: {
    auth?: {
      deviceToken?: string;
    };
    session?: {
      id: string;
    };
  };
}

// Chat/messaging types
export interface ChatSendParams {
  sessionId?: string;
  content: string;
  role?: 'user' | 'assistant';
  context?: {
    senderIdentity?: string;
    senderPublicKey?: string;
    verified?: boolean;
    certificateSubject?: string;
  };
}

export interface ChatMessageEvent {
  type: 'event';
  event: 'chat.message';
  payload: {
    sessionId: string;
    messageId: string;
    role: 'user' | 'assistant';
    content: string;
    toolCalls?: ToolCall[];
    done?: boolean;
  };
}

export interface ToolCall {
  id: string;
  name: string;
  params: Record<string, unknown>;
  result?: {
    success: boolean;
    output?: unknown;
    error?: string;
  };
}

// Session types
export interface SessionInfo {
  id: string;
  agentId?: string;
  channel?: string;
  peerId?: string;
  createdAt: number;
  lastActivity: number;
}

// Gateway configuration for AGIdentity
export interface OpenClawGatewayConfig {
  /** WebSocket URL (default: ws://127.0.0.1:18789) */
  gatewayUrl?: string;
  /** Authentication token */
  authToken?: string;
  /** Session scope strategy */
  sessionScope?: 'shared' | 'per-sender' | 'per-conversation';
  /** Reconnection settings */
  reconnect?: {
    maxAttempts?: number;
    delayMs?: number;
    backoffMultiplier?: number;
  };
}
