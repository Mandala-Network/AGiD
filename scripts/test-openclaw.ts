#!/usr/bin/env npx tsx
/**
 * Quick test: connect to OpenClaw with device identity and send chat.send
 */
import WebSocket from 'ws';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

const WS_URL = 'ws://127.0.0.1:18789';
const AUTH_TOKEN = 'test-token-123';

// Generate or load Ed25519 key pair for device identity
const keyDir = path.join(process.env.HOME || '/tmp', '.agidentity');
const keyFile = path.join(keyDir, 'device-key.json');
let privateKey: crypto.KeyObject;
let publicKey: crypto.KeyObject;

try {
  const saved = JSON.parse(fs.readFileSync(keyFile, 'utf8'));
  privateKey = crypto.createPrivateKey({ key: Buffer.from(saved.privateKey, 'base64'), type: 'pkcs8', format: 'der' });
  publicKey = crypto.createPublicKey({ key: Buffer.from(saved.publicKey, 'base64'), type: 'spki', format: 'der' });
  console.log('[device] loaded existing key pair');
} catch {
  const kp = crypto.generateKeyPairSync('ed25519');
  privateKey = kp.privateKey;
  publicKey = kp.publicKey;
  fs.mkdirSync(keyDir, { recursive: true });
  fs.writeFileSync(keyFile, JSON.stringify({
    privateKey: kp.privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'),
    publicKey: kp.publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
  }));
  console.log('[device] generated new key pair');
}

const spki = publicKey.export({ type: 'spki', format: 'der' });
const rawKey = spki.subarray(12);
const deviceId = crypto.createHash('sha256').update(rawKey).digest('hex');
const publicKeyBase64Url = rawKey.toString('base64url');
console.log('[device] ID:', deviceId);

const ws = new WebSocket(WS_URL);
let connected = false;
let connectNonce = '';

ws.on('open', () => {
  console.log('[ws] connected to', WS_URL);
});

ws.on('message', (data: WebSocket.Data) => {
  const msg = JSON.parse(data.toString());
  console.log('[ws] received:', JSON.stringify(msg, null, 2).substring(0, 500));

  if (msg.type === 'event' && msg.event === 'connect.challenge') {
    connectNonce = msg.payload?.nonce ?? '';
    console.log('[ws] got challenge (nonce:', connectNonce.substring(0, 8) + '...), sending connect request...');

    const signedAt = Date.now();
    const role = 'operator';
    const scopes = ['operator.admin', 'operator.write'];
    const clientId = 'gateway-client';
    const clientMode = 'backend';
    const version = connectNonce ? 'v2' : 'v1';

    const payloadParts = [version, deviceId, clientId, clientMode, role, scopes.join(','), String(signedAt), AUTH_TOKEN];
    if (version === 'v2') payloadParts.push(connectNonce);
    const payload = payloadParts.join('|');

    const signature = crypto.sign(null, Buffer.from(payload, 'utf8'), privateKey);
    const signatureBase64Url = signature.toString('base64url');

    const connectReq = {
      type: 'req',
      id: 'connect-1',
      method: 'connect',
      params: {
        minProtocol: 3,
        maxProtocol: 3,
        client: {
          id: clientId,
          version: '0.1.0',
          platform: process.platform,
          mode: clientMode,
          instanceId: `test-${Date.now()}`,
        },
        auth: { token: AUTH_TOKEN },
        device: {
          id: deviceId,
          publicKey: publicKeyBase64Url,
          signature: signatureBase64Url,
          signedAt,
          nonce: connectNonce || undefined,
        },
        role,
        scopes,
        caps: [],
      },
    };
    ws.send(JSON.stringify(connectReq));
  }

  // Handle hello-ok or connect response
  if (msg.type === 'res' && msg.id === 'connect-1') {
    if (msg.ok) {
      console.log('[ws] connected! scopes:', msg.payload?.auth?.scopes);
      connected = true;

      // Now try chat.send with correct params
      console.log('[ws] sending chat.send...');
      const chatReq = {
        type: 'req',
        id: 'chat-1',
        method: 'chat.send',
        params: {
          sessionKey: `test-session-${Date.now()}`,
          message: 'Hello from test script! Say "test successful" and nothing else.',
          idempotencyKey: `idem-${Date.now()}`,
        },
      };
      ws.send(JSON.stringify(chatReq));
    } else {
      console.error('[ws] connect FAILED:', msg.error);
      process.exit(1);
    }
  }

  if (msg.type === 'event' && msg.event === 'hello-ok') {
    console.log('[ws] hello-ok received! scopes:', msg.payload?.auth?.scopes);
    connected = true;

    // Now try chat.send with correct params
    console.log('[ws] sending chat.send...');
    const chatReq = {
      type: 'req',
      id: 'chat-1',
      method: 'chat.send',
      params: {
        sessionKey: `test-session-${Date.now()}`,
        message: 'Hello from test script! Say "test successful" and nothing else.',
        idempotencyKey: `idem-${Date.now()}`,
      },
    };
    ws.send(JSON.stringify(chatReq));
  }

  // Handle chat.send response
  if (msg.type === 'res' && msg.id === 'chat-1') {
    if (msg.ok) {
      console.log('[ws] chat.send SUCCESS! runId:', msg.payload?.runId);
    } else {
      console.error('[ws] chat.send FAILED:', msg.error);
    }
  }

  // Handle chat events (OpenClaw broadcasts as "chat" event)
  if (msg.type === 'event' && msg.event === 'chat') {
    const state = msg.payload?.state;
    const message = msg.payload?.message;
    const text = typeof message === 'string' ? message
      : message?.content ?? message?.text ?? '';
    if (text) process.stdout.write(text);
    if (state === 'final') {
      console.log('\n[ws] chat response complete. Test PASSED!');
      ws.close();
      process.exit(0);
    } else if (state === 'error') {
      console.error('\n[ws] chat error:', msg.payload?.errorMessage);
      ws.close();
      process.exit(1);
    }
  }
});

ws.on('error', (err: Error) => {
  console.error('[ws] error:', err.message);
  process.exit(1);
});

ws.on('close', (code: number, reason: Buffer) => {
  console.log('[ws] closed:', code, reason.toString());
});

// Timeout
setTimeout(() => {
  console.error('[ws] timeout after 60s');
  ws.close();
  process.exit(1);
}, 60000);
