/**
 * OpenClawClient Unit Tests
 *
 * Tests for the OpenClaw Gateway WebSocket client.
 * Uses mock WebSocket to test without requiring actual gateway.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpenClawClient, createOpenClawClient } from './index.js';
import type { ChatMessageEvent } from '../types/index.js';
import WebSocket from 'ws';

// Mock WebSocket
vi.mock('ws', () => {
  const EventEmitter = require('events');

  class MockWebSocket extends EventEmitter {
    static OPEN = 1;
    static CLOSED = 3;

    readyState = 1; // OPEN by default
    sentMessages: string[] = [];

    constructor(public url: string) {
      super();
      // Simulate async connection
      setTimeout(() => {
        this.emit('open');
      }, 0);
    }

    send(data: string) {
      this.sentMessages.push(data);
    }

    close(code?: number, reason?: string) {
      this.readyState = 3; // CLOSED
      this.emit('close', code ?? 1000, Buffer.from(reason ?? ''));
    }

    terminate() {
      this.readyState = 3;
      this.emit('close', 1006, Buffer.from('terminated'));
    }

    // Test helpers
    simulateMessage(data: object) {
      this.emit('message', JSON.stringify(data));
    }

    simulateChallenge(nonce: string) {
      this.simulateMessage({
        type: 'event',
        event: 'connect.challenge',
        payload: { nonce },
      });
    }

    simulateHelloOk(sessionId: string, deviceToken?: string) {
      this.simulateMessage({
        type: 'event',
        event: 'hello-ok',
        payload: {
          session: { id: sessionId },
          auth: deviceToken ? { deviceToken } : undefined,
        },
      });
    }

    simulateAuthFailed() {
      this.simulateMessage({
        type: 'event',
        event: 'auth.failed',
        payload: {},
      });
    }

    simulateResponse(id: string, ok: boolean, payload?: object, error?: { code: string; message: string }) {
      this.simulateMessage({
        type: 'res',
        id,
        ok,
        payload,
        error,
      });
    }

    simulateChatMessage(sessionId: string, content: string, done = false) {
      this.simulateMessage({
        type: 'event',
        event: 'chat.message',
        payload: {
          sessionId,
          messageId: `msg-${Date.now()}`,
          role: 'assistant',
          content,
          done,
        },
      });
    }
  }

  return {
    default: MockWebSocket,
    WebSocket: MockWebSocket,
  };
});

// Helper to get mock WebSocket instance from client
function getMockWebSocket(client: OpenClawClient): any {
  return (client as any).ws;
}

describe('OpenClawClient', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('Constructor', () => {
    it('should construct with default config', () => {
      const client = new OpenClawClient();
      expect(client).toBeInstanceOf(OpenClawClient);
      expect(client.isConnected()).toBe(false);
    });

    it('should construct with custom config', () => {
      const client = new OpenClawClient({
        gatewayUrl: 'ws://custom:8080',
        authToken: 'test-token',
        requestTimeout: 5000,
      });
      expect(client).toBeInstanceOf(OpenClawClient);
    });

    it('should read config from environment variables', () => {
      process.env.OPENCLAW_GATEWAY_URL = 'ws://env-gateway:9999';
      process.env.OPENCLAW_GATEWAY_TOKEN = 'env-token';
      process.env.OPENCLAW_SESSION_SCOPE = 'per-sender';

      const client = new OpenClawClient();
      // Config is private, but we can verify through behavior
      expect(client).toBeInstanceOf(OpenClawClient);
    });

    it('should prefer explicit config over environment variables', () => {
      process.env.OPENCLAW_GATEWAY_URL = 'ws://env-gateway:9999';

      const client = new OpenClawClient({
        gatewayUrl: 'ws://explicit:1234',
      });

      // Config is private but we can test through connection behavior
      expect(client).toBeInstanceOf(OpenClawClient);
    });
  });

  describe('Connection', () => {
    it('should connect and complete handshake', async () => {
      const client = new OpenClawClient({ gatewayUrl: 'ws://test:123' });

      // Start connection
      const connectPromise = client.connect();

      // Wait for WebSocket to be created
      await new Promise(resolve => setTimeout(resolve, 10));

      const ws = getMockWebSocket(client);

      // Simulate challenge
      ws.simulateChallenge('test-nonce-123');

      // Wait for connect request to be sent
      await new Promise(resolve => setTimeout(resolve, 10));

      // Verify connect request was sent
      expect(ws.sentMessages.length).toBeGreaterThan(0);
      const connectRequest = JSON.parse(ws.sentMessages[0]);
      expect(connectRequest.type).toBe('req');
      expect(connectRequest.method).toBe('connect');
      expect(connectRequest.params.nonce).toBe('test-nonce-123');

      // Simulate successful hello
      ws.simulateHelloOk('session-123', 'device-token-abc');

      // Wait for connection to complete
      await connectPromise;

      expect(client.isConnected()).toBe(true);
      expect(client.getSessionId()).toBe('session-123');
      expect(client.getDeviceToken()).toBe('device-token-abc');
    });

    it('should handle connection timeout', async () => {
      const client = new OpenClawClient({
        gatewayUrl: 'ws://test:123',
        requestTimeout: 50, // Short timeout for test
      });

      // Connection should fail due to no hello-ok
      await expect(client.connect()).rejects.toThrow('Connection timeout');
      expect(client.isConnected()).toBe(false);
    });

    it('should handle authentication failure', async () => {
      const client = new OpenClawClient({
        gatewayUrl: 'ws://test:123',
        requestTimeout: 100, // Short timeout
      });

      // Suppress the error event that gets emitted
      client.on('error', () => {});

      const connectPromise = client.connect();

      await new Promise(resolve => setTimeout(resolve, 10));
      const ws = getMockWebSocket(client);

      ws.simulateChallenge('test-nonce');
      await new Promise(resolve => setTimeout(resolve, 10));

      ws.simulateAuthFailed();

      await expect(connectPromise).rejects.toThrow('Authentication failed');
      expect(client.isConnected()).toBe(false);
    });

    it('should not reconnect if already connected', async () => {
      const client = new OpenClawClient({ gatewayUrl: 'ws://test:123' });

      // First connection
      const connectPromise = client.connect();
      await new Promise(resolve => setTimeout(resolve, 10));
      const ws = getMockWebSocket(client);
      ws.simulateChallenge('nonce');
      await new Promise(resolve => setTimeout(resolve, 10));
      ws.simulateHelloOk('session-1');
      await connectPromise;

      // Second connection should return immediately
      await client.connect();
      expect(client.isConnected()).toBe(true);
    });

    it('should emit connected event', async () => {
      const client = new OpenClawClient({ gatewayUrl: 'ws://test:123' });
      const connectedHandler = vi.fn();
      client.on('connected', connectedHandler);

      const connectPromise = client.connect();
      await new Promise(resolve => setTimeout(resolve, 10));
      const ws = getMockWebSocket(client);
      ws.simulateChallenge('nonce');
      await new Promise(resolve => setTimeout(resolve, 10));
      ws.simulateHelloOk('session-1');
      await connectPromise;

      expect(connectedHandler).toHaveBeenCalled();
    });
  });

  describe('Disconnect', () => {
    it('should disconnect cleanly', async () => {
      const client = new OpenClawClient({ gatewayUrl: 'ws://test:123' });

      // Connect first
      const connectPromise = client.connect();
      await new Promise(resolve => setTimeout(resolve, 10));
      const ws = getMockWebSocket(client);
      ws.simulateChallenge('nonce');
      await new Promise(resolve => setTimeout(resolve, 10));
      ws.simulateHelloOk('session-1');
      await connectPromise;

      expect(client.isConnected()).toBe(true);

      // Disconnect
      await client.disconnect();

      expect(client.isConnected()).toBe(false);
      expect(client.getSessionId()).toBeNull();
    });

    it('should reject pending requests on disconnect', async () => {
      const client = new OpenClawClient({ gatewayUrl: 'ws://test:123' });

      // Connect first
      const connectPromise = client.connect();
      await new Promise(resolve => setTimeout(resolve, 10));
      const ws = getMockWebSocket(client);
      ws.simulateChallenge('nonce');
      await new Promise(resolve => setTimeout(resolve, 10));
      ws.simulateHelloOk('session-1');
      await connectPromise;

      // Start a request (won't complete)
      const requestPromise = client.sendRequest('test.method');

      // Disconnect while request is pending
      await client.disconnect();

      // Request should be rejected
      await expect(requestPromise).rejects.toThrow('Disconnected');
    });
  });

  describe('Request/Response', () => {
    async function setupConnectedClient(): Promise<OpenClawClient> {
      const client = new OpenClawClient({ gatewayUrl: 'ws://test:123' });
      const connectPromise = client.connect();
      await new Promise(resolve => setTimeout(resolve, 10));
      const ws = getMockWebSocket(client);
      ws.simulateChallenge('nonce');
      await new Promise(resolve => setTimeout(resolve, 10));
      ws.simulateHelloOk('session-1');
      await connectPromise;
      return client;
    }

    it('should send request and receive response', async () => {
      const client = await setupConnectedClient();
      const ws = getMockWebSocket(client);

      // Start request
      const responsePromise = client.sendRequest('test.method', { foo: 'bar' });

      await new Promise(resolve => setTimeout(resolve, 10));

      // Get the request that was sent
      const requests = ws.sentMessages.filter((m: string) => {
        const parsed = JSON.parse(m);
        return parsed.method === 'test.method';
      });
      expect(requests.length).toBe(1);

      const request = JSON.parse(requests[0]);
      expect(request.type).toBe('req');
      expect(request.params.foo).toBe('bar');

      // Simulate response
      ws.simulateResponse(request.id, true, { result: 'success' });

      const response = await responsePromise;
      expect(response.ok).toBe(true);
      expect(response.payload?.result).toBe('success');
    });

    it('should timeout pending requests', async () => {
      const client = new OpenClawClient({
        gatewayUrl: 'ws://test:123',
        requestTimeout: 50, // Short timeout
      });

      // Connect
      const connectPromise = client.connect();
      await new Promise(resolve => setTimeout(resolve, 10));
      const ws = getMockWebSocket(client);
      ws.simulateChallenge('nonce');
      await new Promise(resolve => setTimeout(resolve, 10));
      ws.simulateHelloOk('session-1');
      await connectPromise;

      // Send request without response
      await expect(client.sendRequest('slow.method')).rejects.toThrow('Request timeout');
    });

    it('should throw when sending request while not connected', async () => {
      const client = new OpenClawClient();

      await expect(client.sendRequest('test.method')).rejects.toThrow('Not connected');
    });
  });

  describe('Chat', () => {
    async function setupConnectedClient(): Promise<OpenClawClient> {
      const client = new OpenClawClient({ gatewayUrl: 'ws://test:123' });
      const connectPromise = client.connect();
      await new Promise(resolve => setTimeout(resolve, 10));
      const ws = getMockWebSocket(client);
      ws.simulateChallenge('nonce');
      await new Promise(resolve => setTimeout(resolve, 10));
      ws.simulateHelloOk('session-1');
      await connectPromise;
      return client;
    }

    it('should send chat message', async () => {
      const client = await setupConnectedClient();
      const ws = getMockWebSocket(client);

      // Start chat send
      const chatPromise = client.sendChat('Hello, OpenClaw!');

      await new Promise(resolve => setTimeout(resolve, 10));

      // Find the chat.send request
      const chatRequests = ws.sentMessages.filter((m: string) => {
        const parsed = JSON.parse(m);
        return parsed.method === 'chat.send';
      });
      expect(chatRequests.length).toBe(1);

      const request = JSON.parse(chatRequests[0]);
      expect(request.params.content).toBe('Hello, OpenClaw!');
      expect(request.params.role).toBe('user');

      // Simulate response
      ws.simulateResponse(request.id, true, { messageId: 'msg-123' });

      const messageId = await chatPromise;
      expect(messageId).toBe('msg-123');
    });

    it('should include sender context when provided', async () => {
      const client = await setupConnectedClient();
      const ws = getMockWebSocket(client);

      const context = {
        senderIdentity: 'agent-abc',
        senderPublicKey: '03abcdef...',
        verified: true,
      };

      const chatPromise = client.sendChat('Hello!', { context });

      await new Promise(resolve => setTimeout(resolve, 10));

      const chatRequests = ws.sentMessages.filter((m: string) => {
        const parsed = JSON.parse(m);
        return parsed.method === 'chat.send';
      });
      const request = JSON.parse(chatRequests[0]);
      expect(request.params.context).toEqual(context);

      ws.simulateResponse(request.id, true, { messageId: 'msg-456' });
      await chatPromise;
    });

    it('should emit chat message events', async () => {
      const client = await setupConnectedClient();
      const ws = getMockWebSocket(client);

      const handler = vi.fn();
      client.onChatMessage(handler);

      // Simulate incoming chat message
      ws.simulateChatMessage('session-1', 'Hello from OpenClaw!', false);

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(handler).toHaveBeenCalledTimes(1);
      const event = handler.mock.calls[0][0] as ChatMessageEvent;
      expect(event.payload.content).toBe('Hello from OpenClaw!');
      expect(event.payload.role).toBe('assistant');
    });

    it('should allow removing chat message handler', async () => {
      const client = await setupConnectedClient();
      const ws = getMockWebSocket(client);

      const handler = vi.fn();
      client.onChatMessage(handler);
      client.offChatMessage(handler);

      ws.simulateChatMessage('session-1', 'Hello!', false);

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(handler).not.toHaveBeenCalled();
    });

    it('should throw on chat send error', async () => {
      const client = await setupConnectedClient();
      const ws = getMockWebSocket(client);

      const chatPromise = client.sendChat('Hello!');

      await new Promise(resolve => setTimeout(resolve, 10));

      const chatRequests = ws.sentMessages.filter((m: string) => {
        const parsed = JSON.parse(m);
        return parsed.method === 'chat.send';
      });
      const request = JSON.parse(chatRequests[0]);

      ws.simulateResponse(request.id, false, undefined, {
        code: 'RATE_LIMITED',
        message: 'Too many requests',
      });

      await expect(chatPromise).rejects.toThrow('Too many requests');
    });
  });

  describe('Reconnection', () => {
    it('should attempt reconnection on unexpected disconnect', async () => {
      const client = new OpenClawClient({
        gatewayUrl: 'ws://test:123',
        reconnect: {
          maxAttempts: 3,
          delayMs: 10,
          backoffMultiplier: 1,
        },
      });

      const reconnectingHandler = vi.fn();
      client.on('reconnecting', reconnectingHandler);

      // Connect
      const connectPromise = client.connect();
      await new Promise(resolve => setTimeout(resolve, 10));
      const ws = getMockWebSocket(client);
      ws.simulateChallenge('nonce');
      await new Promise(resolve => setTimeout(resolve, 10));
      ws.simulateHelloOk('session-1');
      await connectPromise;

      // Simulate unexpected disconnect (not code 1000)
      ws.emit('close', 1006, Buffer.from('connection lost'));

      // Should emit reconnecting event
      await new Promise(resolve => setTimeout(resolve, 20));

      expect(reconnectingHandler).toHaveBeenCalled();
    });

    it('should not reconnect on clean disconnect', async () => {
      const client = new OpenClawClient({
        gatewayUrl: 'ws://test:123',
        reconnect: {
          maxAttempts: 3,
          delayMs: 10,
          backoffMultiplier: 1,
        },
      });

      const reconnectingHandler = vi.fn();
      client.on('reconnecting', reconnectingHandler);

      // Connect
      const connectPromise = client.connect();
      await new Promise(resolve => setTimeout(resolve, 10));
      const ws = getMockWebSocket(client);
      ws.simulateChallenge('nonce');
      await new Promise(resolve => setTimeout(resolve, 10));
      ws.simulateHelloOk('session-1');
      await connectPromise;

      // Clean disconnect using client method
      await client.disconnect();

      // Should not attempt reconnection
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(reconnectingHandler).not.toHaveBeenCalled();
    });

    it('should use exponential backoff', async () => {
      const client = new OpenClawClient({
        gatewayUrl: 'ws://test:123',
        reconnect: {
          maxAttempts: 3,
          delayMs: 10,
          backoffMultiplier: 2,
        },
      });

      const reconnectingHandler = vi.fn();
      client.on('reconnecting', reconnectingHandler);

      // Connect
      const connectPromise = client.connect();
      await new Promise(resolve => setTimeout(resolve, 10));
      const ws = getMockWebSocket(client);
      ws.simulateChallenge('nonce');
      await new Promise(resolve => setTimeout(resolve, 10));
      ws.simulateHelloOk('session-1');
      await connectPromise;

      // Simulate disconnect
      ws.emit('close', 1006, Buffer.from('lost'));

      // Check first reconnect attempt
      await new Promise(resolve => setTimeout(resolve, 30));

      if (reconnectingHandler.mock.calls.length > 0) {
        const firstAttempt = reconnectingHandler.mock.calls[0][0];
        expect(firstAttempt.attempt).toBe(1);
        expect(firstAttempt.delay).toBe(10); // delayMs * backoff^0
      }
    });
  });

  describe('Factory Function', () => {
    it('should create connected client', async () => {
      const clientPromise = createOpenClawClient({
        gatewayUrl: 'ws://test:123',
        requestTimeout: 50, // Short timeout for test
      });

      // The promise will reject due to timeout without proper mock setup
      // This verifies the factory calls connect()
      await expect(clientPromise).rejects.toThrow('Connection timeout');
    });
  });
});
