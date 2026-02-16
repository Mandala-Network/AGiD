/**
 * Session Manager
 *
 * Manages authenticated sessions using BRC-103/104 mutual authentication.
 * Implements Edwin-style security features:
 * - Nonce-based authentication
 * - Timing anomaly detection
 * - Session expiration
 * - Per-user context isolation
 */

import type {
  BRC100Wallet,
  AuthSession,
} from '../../07-shared/types/index.js';

export interface SessionManagerConfig {
  wallet: BRC100Wallet;
  maxSessionDurationMs?: number;
  timingAnomalyThresholdMs?: number;
  cleanupIntervalMs?: number;
}

export class SessionManager {
  private wallet: BRC100Wallet;
  private sessions: Map<string, AuthSession> = new Map();
  private config: Required<SessionManagerConfig>;
  private cleanupTimer?: ReturnType<typeof setInterval>;

  constructor(config: SessionManagerConfig) {
    this.wallet = config.wallet;
    this.config = {
      wallet: config.wallet,
      maxSessionDurationMs: config.maxSessionDurationMs ?? 24 * 60 * 60 * 1000,  // 24 hours
      timingAnomalyThresholdMs: config.timingAnomalyThresholdMs ?? 500,
      cleanupIntervalMs: config.cleanupIntervalMs ?? 60 * 1000  // 1 minute
    };

    // Start cleanup timer
    this.startCleanupTimer();
  }

  /**
   * Create a new session for a user
   */
  async createSession(userPublicKey: string): Promise<AuthSession> {
    const sessionId = await this.generateSessionId();
    const nonce = await this.generateNonce();
    const now = Date.now();

    const session: AuthSession = {
      sessionId,
      userPublicKey,
      createdAt: now,
      expiresAt: now + this.config.maxSessionDurationMs,
      nonce,
      verified: false
    };

    this.sessions.set(sessionId, session);

    return session;
  }

  /**
   * Verify a session and mark as authenticated
   */
  async verifySession(
    sessionId: string,
    signature: Uint8Array,
    timestamp: number
  ): Promise<{
    valid: boolean;
    session?: AuthSession;
    error?: string;
  }> {
    const session = this.sessions.get(sessionId);

    if (!session) {
      return { valid: false, error: 'Session not found' };
    }

    // Check expiration
    if (Date.now() > session.expiresAt) {
      this.sessions.delete(sessionId);
      return { valid: false, error: 'Session expired' };
    }

    // Timing anomaly detection (Edwin-style)
    const timingAnomaly = this.detectTimingAnomaly(timestamp);
    if (timingAnomaly) {
      return {
        valid: false,
        error: `Timing anomaly detected: ${timingAnomaly}`
      };
    }

    // Verify signature over nonce
    const nonceData = new TextEncoder().encode(session.nonce);
    const verifyResult = await this.wallet.verifySignature({
      data: Array.from(nonceData),
      signature: Array.from(signature),
      protocolID: [2, 'agidentity-auth'],
      keyID: `session-${sessionId}`,
      counterparty: session.userPublicKey
    });

    if (!verifyResult.valid) {
      return { valid: false, error: 'Invalid signature' };
    }

    // Mark session as verified
    session.verified = true;

    return { valid: true, session };
  }

  /**
   * Get a session by ID
   */
  getSession(sessionId: string): AuthSession | null {
    const session = this.sessions.get(sessionId);

    if (!session) {
      return null;
    }

    // Check expiration
    if (Date.now() > session.expiresAt) {
      this.sessions.delete(sessionId);
      return null;
    }

    return session;
  }

  /**
   * Get session by user public key
   */
  getSessionByUser(userPublicKey: string): AuthSession | null {
    for (const session of this.sessions.values()) {
      if (
        session.userPublicKey === userPublicKey &&
        session.verified &&
        Date.now() <= session.expiresAt
      ) {
        return session;
      }
    }
    return null;
  }

  /**
   * Invalidate a session
   */
  invalidateSession(sessionId: string): boolean {
    return this.sessions.delete(sessionId);
  }

  /**
   * Invalidate all sessions for a user
   */
  invalidateUserSessions(userPublicKey: string): number {
    let count = 0;
    for (const [sessionId, session] of this.sessions) {
      if (session.userPublicKey === userPublicKey) {
        this.sessions.delete(sessionId);
        count++;
      }
    }
    return count;
  }

  /**
   * Refresh a session (extend expiration)
   */
  refreshSession(sessionId: string): AuthSession | null {
    const session = this.sessions.get(sessionId);

    if (!session || !session.verified) {
      return null;
    }

    if (Date.now() > session.expiresAt) {
      this.sessions.delete(sessionId);
      return null;
    }

    // Extend expiration
    session.expiresAt = Date.now() + this.config.maxSessionDurationMs;

    return session;
  }

  /**
   * Get all active sessions
   */
  getActiveSessions(): AuthSession[] {
    const now = Date.now();
    const active: AuthSession[] = [];

    for (const session of this.sessions.values()) {
      if (session.verified && now <= session.expiresAt) {
        active.push(session);
      }
    }

    return active;
  }

  /**
   * Get session statistics
   */
  getStats(): {
    totalSessions: number;
    activeSessions: number;
    verifiedSessions: number;
    expiredSessions: number;
  } {
    const now = Date.now();
    let active = 0;
    let verified = 0;
    let expired = 0;

    for (const session of this.sessions.values()) {
      if (now > session.expiresAt) {
        expired++;
      } else {
        active++;
        if (session.verified) {
          verified++;
        }
      }
    }

    return {
      totalSessions: this.sessions.size,
      activeSessions: active,
      verifiedSessions: verified,
      expiredSessions: expired
    };
  }

  /**
   * Stop the session manager
   */
  stop(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
  }

  // =========================================================================
  // Private Helper Methods
  // =========================================================================

  private async generateSessionId(): Promise<string> {
    const random = crypto.getRandomValues(new Uint8Array(32));
    return Array.from(random)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  private async generateNonce(): Promise<string> {
    const random = crypto.getRandomValues(new Uint8Array(32));
    return Array.from(random)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  /**
   * Detect timing anomalies (Edwin-style security)
   *
   * Checks for suspicious timing patterns that could indicate:
   * - Replay attacks
   * - Man-in-the-middle attacks
   * - Automated/bot access
   */
  private detectTimingAnomaly(clientTimestamp: number): string | null {
    const serverTime = Date.now();
    const drift = Math.abs(serverTime - clientTimestamp);

    // Check for excessive clock drift
    if (drift > this.config.timingAnomalyThresholdMs) {
      return `Clock drift too large: ${drift}ms`;
    }

    // Check for timestamps in the future
    if (clientTimestamp > serverTime + 1000) {
      return 'Timestamp in the future';
    }

    // Check for very old timestamps (potential replay)
    if (clientTimestamp < serverTime - 60000) {
      return 'Timestamp too old';
    }

    return null;
  }

  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanupExpiredSessions();
    }, this.config.cleanupIntervalMs);
  }

  private cleanupExpiredSessions(): void {
    const now = Date.now();
    const toDelete: string[] = [];

    for (const [sessionId, session] of this.sessions) {
      if (now > session.expiresAt) {
        toDelete.push(sessionId);
      }
    }

    for (const sessionId of toDelete) {
      this.sessions.delete(sessionId);
    }
  }
}

/**
 * Create session manager with default configuration
 */
export function createSessionManager(
  wallet: BRC100Wallet,
  config?: Partial<SessionManagerConfig>
): SessionManager {
  return new SessionManager({
    wallet,
    ...config
  });
}
