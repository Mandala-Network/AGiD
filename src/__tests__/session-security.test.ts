/**
 * Session Security Tests
 *
 * These tests validate enterprise session security:
 * - Timing anomaly detection (Edwin-style)
 * - Session expiration
 * - Replay attack prevention
 * - Session invalidation
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SessionManager } from '../auth/session-manager.js';
import { MockSecureWallet, sleep } from './test-utils.js';

describe('Session Security', () => {
  let wallet: MockSecureWallet;
  let sessionManager: SessionManager;

  beforeEach(() => {
    wallet = new MockSecureWallet();
    sessionManager = new SessionManager({
      wallet,
      maxSessionDurationMs: 1000, // 1 second for testing
      timingAnomalyThresholdMs: 100, // 100ms threshold
      cleanupIntervalMs: 500 // Cleanup every 500ms
    });
  });

  afterEach(() => {
    sessionManager.stop();
  });

  describe('Session Creation', () => {
    it('should create sessions with unique IDs', async () => {
      const session1 = await sessionManager.createSession('user-1');
      const session2 = await sessionManager.createSession('user-2');

      expect(session1.sessionId).toBeDefined();
      expect(session2.sessionId).toBeDefined();
      expect(session1.sessionId).not.toBe(session2.sessionId);
    });

    it('should create sessions with secure nonces', async () => {
      const session = await sessionManager.createSession('user-1');

      expect(session.nonce).toBeDefined();
      expect(session.nonce.length).toBe(64); // 32 bytes as hex
    });

    it('should set correct expiration time', async () => {
      const beforeCreate = Date.now();
      const session = await sessionManager.createSession('user-1');
      const afterCreate = Date.now();

      // Expiration should be ~1 second from creation
      expect(session.expiresAt).toBeGreaterThanOrEqual(beforeCreate + 1000);
      expect(session.expiresAt).toBeLessThanOrEqual(afterCreate + 1000);
    });

    it('should start sessions as unverified', async () => {
      const session = await sessionManager.createSession('user-1');

      expect(session.verified).toBe(false);
    });
  });

  describe('Session Verification', () => {
    it('should verify valid session with correct signature', async () => {
      const session = await sessionManager.createSession('user-1');

      // Create signature over nonce
      const nonceData = new TextEncoder().encode(session.nonce);
      const signature = await wallet.createSignature({
        data: Array.from(nonceData),
        protocolID: [2, 'agidentity-auth'],
        keyID: `session-${session.sessionId}`,
        counterparty: session.userPublicKey
      });

      const result = await sessionManager.verifySession(
        session.sessionId,
        new Uint8Array(signature.signature),
        Date.now()
      );

      expect(result.valid).toBe(true);
      expect(result.session?.verified).toBe(true);
    });

    it('should reject invalid signature', async () => {
      const session = await sessionManager.createSession('user-1');

      // Create invalid signature
      const invalidSignature = new Uint8Array(32);
      crypto.getRandomValues(invalidSignature);

      const result = await sessionManager.verifySession(
        session.sessionId,
        invalidSignature,
        Date.now()
      );

      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid signature');
    });

    it('should reject non-existent session', async () => {
      const result = await sessionManager.verifySession(
        'non-existent-session-id',
        new Uint8Array(32),
        Date.now()
      );

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Session not found');
    });
  });

  describe('Timing Anomaly Detection', () => {
    it('should reject requests with excessive clock drift', async () => {
      const session = await sessionManager.createSession('user-1');

      // Create valid signature
      const nonceData = new TextEncoder().encode(session.nonce);
      const signature = await wallet.createSignature({
        data: Array.from(nonceData),
        protocolID: [2, 'agidentity-auth'],
        keyID: `session-${session.sessionId}`,
        counterparty: session.userPublicKey
      });

      // Timestamp with excessive drift (200ms, threshold is 100ms)
      const driftedTimestamp = Date.now() - 200;

      const result = await sessionManager.verifySession(
        session.sessionId,
        new Uint8Array(signature.signature),
        driftedTimestamp
      );

      expect(result.valid).toBe(false);
      expect(result.error).toContain('Clock drift too large');
    });

    it('should reject future timestamps', async () => {
      const session = await sessionManager.createSession('user-1');

      const nonceData = new TextEncoder().encode(session.nonce);
      const signature = await wallet.createSignature({
        data: Array.from(nonceData),
        protocolID: [2, 'agidentity-auth'],
        keyID: `session-${session.sessionId}`,
        counterparty: session.userPublicKey
      });

      // Timestamp in the future (2 seconds ahead)
      const futureTimestamp = Date.now() + 2000;

      const result = await sessionManager.verifySession(
        session.sessionId,
        new Uint8Array(signature.signature),
        futureTimestamp
      );

      expect(result.valid).toBe(false);
      // Could be "Timestamp in the future" or "Clock drift too large"
      expect(result.error).toBeDefined();
    });

    it('should reject old timestamps (replay protection)', async () => {
      const session = await sessionManager.createSession('user-1');

      const nonceData = new TextEncoder().encode(session.nonce);
      const signature = await wallet.createSignature({
        data: Array.from(nonceData),
        protocolID: [2, 'agidentity-auth'],
        keyID: `session-${session.sessionId}`,
        counterparty: session.userPublicKey
      });

      // Timestamp from 2 minutes ago (potential replay)
      const oldTimestamp = Date.now() - 120000;

      const result = await sessionManager.verifySession(
        session.sessionId,
        new Uint8Array(signature.signature),
        oldTimestamp
      );

      expect(result.valid).toBe(false);
      // Could be "Timestamp too old" or "Clock drift too large" depending on threshold
      expect(result.error).toBeDefined();
    });

    it('should accept timestamps within threshold', async () => {
      const session = await sessionManager.createSession('user-1');

      const nonceData = new TextEncoder().encode(session.nonce);
      const signature = await wallet.createSignature({
        data: Array.from(nonceData),
        protocolID: [2, 'agidentity-auth'],
        keyID: `session-${session.sessionId}`,
        counterparty: session.userPublicKey
      });

      // Timestamp with acceptable drift (50ms, threshold is 100ms)
      const acceptableTimestamp = Date.now() - 50;

      const result = await sessionManager.verifySession(
        session.sessionId,
        new Uint8Array(signature.signature),
        acceptableTimestamp
      );

      expect(result.valid).toBe(true);
    });
  });

  describe('Session Expiration', () => {
    it('should reject expired sessions', async () => {
      const session = await sessionManager.createSession('user-1');

      // Wait for session to expire (1 second + buffer)
      await sleep(1100);

      const nonceData = new TextEncoder().encode(session.nonce);
      const signature = await wallet.createSignature({
        data: Array.from(nonceData),
        protocolID: [2, 'agidentity-auth'],
        keyID: `session-${session.sessionId}`,
        counterparty: session.userPublicKey
      });

      const result = await sessionManager.verifySession(
        session.sessionId,
        new Uint8Array(signature.signature),
        Date.now()
      );

      expect(result.valid).toBe(false);
      // Session could be expired or already cleaned up
      expect(['Session expired', 'Session not found']).toContain(result.error);
    });

    it('should return null for expired session lookups', async () => {
      const session = await sessionManager.createSession('user-1');

      // Wait for expiration
      await sleep(1100);

      const retrieved = sessionManager.getSession(session.sessionId);
      expect(retrieved).toBeNull();
    });

    it('should cleanup expired sessions automatically', async () => {
      await sessionManager.createSession('user-1');
      await sessionManager.createSession('user-2');

      const statsBefore = sessionManager.getStats();
      expect(statsBefore.totalSessions).toBe(2);

      // Wait for expiration + cleanup interval
      await sleep(1600);

      const statsAfter = sessionManager.getStats();
      expect(statsAfter.totalSessions).toBe(0);
    });
  });

  describe('Session Invalidation', () => {
    it('should invalidate specific session', async () => {
      const session = await sessionManager.createSession('user-1');

      const invalidated = sessionManager.invalidateSession(session.sessionId);
      expect(invalidated).toBe(true);

      const retrieved = sessionManager.getSession(session.sessionId);
      expect(retrieved).toBeNull();
    });

    it('should invalidate all user sessions', async () => {
      await sessionManager.createSession('user-1');
      await sessionManager.createSession('user-1');
      await sessionManager.createSession('user-2');

      const count = sessionManager.invalidateUserSessions('user-1');
      expect(count).toBe(2);

      const stats = sessionManager.getStats();
      expect(stats.totalSessions).toBe(1);
    });

    it('should return false for non-existent session invalidation', () => {
      const invalidated = sessionManager.invalidateSession('non-existent');
      expect(invalidated).toBe(false);
    });
  });

  describe('Session Refresh', () => {
    it('should extend verified session expiration', async () => {
      const session = await sessionManager.createSession('user-1');

      // Verify the session
      const nonceData = new TextEncoder().encode(session.nonce);
      const signature = await wallet.createSignature({
        data: Array.from(nonceData),
        protocolID: [2, 'agidentity-auth'],
        keyID: `session-${session.sessionId}`,
        counterparty: session.userPublicKey
      });

      await sessionManager.verifySession(
        session.sessionId,
        new Uint8Array(signature.signature),
        Date.now()
      );

      // Wait a bit
      await sleep(100);

      // Refresh should extend expiration
      const originalExpiry = session.expiresAt;
      const refreshed = sessionManager.refreshSession(session.sessionId);

      expect(refreshed).not.toBeNull();
      expect(refreshed!.expiresAt).toBeGreaterThan(originalExpiry);
    });

    it('should not refresh unverified sessions', async () => {
      const session = await sessionManager.createSession('user-1');

      const refreshed = sessionManager.refreshSession(session.sessionId);
      expect(refreshed).toBeNull();
    });

    it('should not refresh expired sessions', async () => {
      const session = await sessionManager.createSession('user-1');

      // Verify the session
      const nonceData = new TextEncoder().encode(session.nonce);
      const signature = await wallet.createSignature({
        data: Array.from(nonceData),
        protocolID: [2, 'agidentity-auth'],
        keyID: `session-${session.sessionId}`,
        counterparty: session.userPublicKey
      });

      await sessionManager.verifySession(
        session.sessionId,
        new Uint8Array(signature.signature),
        Date.now()
      );

      // Wait for expiration
      await sleep(1100);

      const refreshed = sessionManager.refreshSession(session.sessionId);
      expect(refreshed).toBeNull();
    });
  });

  describe('Session Lookup', () => {
    it('should get session by ID', async () => {
      const created = await sessionManager.createSession('user-1');

      const retrieved = sessionManager.getSession(created.sessionId);

      expect(retrieved).not.toBeNull();
      expect(retrieved?.sessionId).toBe(created.sessionId);
      expect(retrieved?.userPublicKey).toBe('user-1');
    });

    it('should get session by user public key', async () => {
      const session = await sessionManager.createSession('user-1');

      // Verify the session first
      const nonceData = new TextEncoder().encode(session.nonce);
      const signature = await wallet.createSignature({
        data: Array.from(nonceData),
        protocolID: [2, 'agidentity-auth'],
        keyID: `session-${session.sessionId}`,
        counterparty: session.userPublicKey
      });

      await sessionManager.verifySession(
        session.sessionId,
        new Uint8Array(signature.signature),
        Date.now()
      );

      const retrieved = sessionManager.getSessionByUser('user-1');

      expect(retrieved).not.toBeNull();
      expect(retrieved?.userPublicKey).toBe('user-1');
    });

    it('should return null for unverified user session lookup', async () => {
      await sessionManager.createSession('user-1');

      // Session exists but is not verified
      const retrieved = sessionManager.getSessionByUser('user-1');
      expect(retrieved).toBeNull();
    });

    it('should get active sessions list', async () => {
      const session1 = await sessionManager.createSession('user-1');
      await sessionManager.createSession('user-2');

      // Verify one session
      const nonceData = new TextEncoder().encode(session1.nonce);
      const signature = await wallet.createSignature({
        data: Array.from(nonceData),
        protocolID: [2, 'agidentity-auth'],
        keyID: `session-${session1.sessionId}`,
        counterparty: session1.userPublicKey
      });

      await sessionManager.verifySession(
        session1.sessionId,
        new Uint8Array(signature.signature),
        Date.now()
      );

      const active = sessionManager.getActiveSessions();

      expect(active.length).toBe(1);
      expect(active[0].userPublicKey).toBe('user-1');
    });
  });

  describe('Session Statistics', () => {
    it('should track session statistics', async () => {
      const session1 = await sessionManager.createSession('user-1');
      await sessionManager.createSession('user-2');
      await sessionManager.createSession('user-3');

      // Verify one session
      const nonceData = new TextEncoder().encode(session1.nonce);
      const signature = await wallet.createSignature({
        data: Array.from(nonceData),
        protocolID: [2, 'agidentity-auth'],
        keyID: `session-${session1.sessionId}`,
        counterparty: session1.userPublicKey
      });

      await sessionManager.verifySession(
        session1.sessionId,
        new Uint8Array(signature.signature),
        Date.now()
      );

      const stats = sessionManager.getStats();

      expect(stats.totalSessions).toBe(3);
      expect(stats.activeSessions).toBe(3);
      expect(stats.verifiedSessions).toBe(1);
      expect(stats.expiredSessions).toBe(0);
    });

    it('should track expired sessions in stats', async () => {
      // Create manager with longer cleanup interval to observe expired state
      const testManager = new SessionManager({
        wallet,
        maxSessionDurationMs: 500, // 500ms expiry
        timingAnomalyThresholdMs: 100,
        cleanupIntervalMs: 10000 // Long cleanup interval
      });

      await testManager.createSession('user-1');
      await testManager.createSession('user-2');

      // Wait for expiration but before cleanup
      await sleep(600);

      const stats = testManager.getStats();

      // Sessions should be expired but still tracked
      expect(stats.totalSessions).toBe(2);
      expect(stats.expiredSessions).toBe(2);
      expect(stats.activeSessions).toBe(0);

      testManager.stop();
    });
  });

  describe('Nonce Uniqueness', () => {
    it('should generate unique nonces for each session', async () => {
      const nonces = new Set<string>();

      // Create 100 sessions and collect nonces
      for (let i = 0; i < 100; i++) {
        const session = await sessionManager.createSession(`user-${i}`);
        nonces.add(session.nonce);
      }

      // All nonces should be unique
      expect(nonces.size).toBe(100);
    });

    it('should generate cryptographically random nonces', async () => {
      const session1 = await sessionManager.createSession('user-1');
      const session2 = await sessionManager.createSession('user-1');

      // Same user should still get different nonces
      expect(session1.nonce).not.toBe(session2.nonce);

      // Nonces should have good randomness (different first bytes)
      expect(session1.nonce.slice(0, 8)).not.toBe(session2.nonce.slice(0, 8));
    });
  });
});
