/**
 * Identity Gate
 *
 * Central identity verification that gates ALL agent operations.
 * Every tool call, inference, and data access must pass through this gate.
 *
 * STUB INTERFACES:
 * - CertificateIssuer: Interface for certificate issuance
 * - RevocationChecker: Interface for on-chain revocation checking
 *
 * These stubs define the interfaces that production implementations must follow.
 */

import type { Certificate, BRC100Wallet } from '../types/index.js';

// =============================================================================
// STUB INTERFACES
// =============================================================================

/**
 * STUB: Certificate Issuer Interface
 *
 * Production implementation will use the wallet for certificate signing.
 */
export interface CertificateIssuer {
  /** Issue a certificate to a subject */
  issueCertificate(
    subjectPublicKey: string,
    certificateType: string,
    fields: Record<string, string>,
    expiresInDays: number
  ): Promise<Certificate>;

  /** Get the certifier's public key */
  getCertifierPublicKey(): Promise<string>;

  /** Check if the issuer is properly initialized */
  isInitialized(): Promise<boolean>;
}

/**
 * STUB: Revocation Checker Interface
 *
 * Production implementation will use a custom overlay service that monitors
 * the blockchain for spent revocation outpoints. When a certificate's
 * revocation UTXO is spent, the certificate is considered revoked.
 *
 * @stub This interface defines what the overlay implementation must provide
 */
export interface RevocationChecker {
  /**
   * Check if a certificate has been revoked by checking the revocation outpoint
   * @stub Overlay implementation will query UTXO status on the blockchain
   */
  isRevoked(certificate: Certificate): Promise<{
    revoked: boolean;
    revokedAt?: number;
    revokedInBlock?: number;
    reason?: string;
  }>;

  /**
   * Subscribe to revocation events for a certificate
   * @stub Overlay implementation will monitor the outpoint for spends
   */
  subscribeToRevocation(
    certificate: Certificate,
    callback: (revoked: boolean) => void
  ): Promise<{ unsubscribe: () => void }>;

  /**
   * Batch check multiple certificates
   * @stub Overlay implementation will efficiently batch blockchain queries
   */
  batchCheckRevocations(certificates: Certificate[]): Promise<Map<string, boolean>>;
}

// =============================================================================
// LOCAL STUB IMPLEMENTATIONS (For development/testing)
// =============================================================================

/**
 * Local stub implementation of CertificateIssuer
 * Uses wallet-toolbox for certificate issuance.
 */
export class LocalCertificateIssuer implements CertificateIssuer {
  private wallet: BRC100Wallet;
  private certifierPublicKey: string | null = null;
  private initialized = false;

  constructor(wallet: BRC100Wallet) {
    this.wallet = wallet;
  }

  async initialize(): Promise<void> {
    const result = await this.wallet.getPublicKey({ identityKey: true });
    this.certifierPublicKey = result.publicKey;
    this.initialized = true;
  }

  async issueCertificate(
    subjectPublicKey: string,
    certificateType: string,
    fields: Record<string, string>,
    expiresInDays: number
  ): Promise<Certificate> {
    if (!this.initialized || !this.certifierPublicKey) {
      throw new Error('CertificateIssuer not initialized');
    }

    const serialNumber = `${Date.now().toString(36)}-${crypto.getRandomValues(new Uint8Array(8)).reduce((s, b) => s + b.toString(16).padStart(2, '0'), '')}`;
    const now = Date.now();
    const validUntil = new Date(now + expiresInDays * 24 * 60 * 60 * 1000);

    const certFields = {
      ...fields,
      certificateType,
      validFrom: new Date(now).toISOString(),
      validUntil: validUntil.toISOString(),
    };

    const certData = JSON.stringify({
      type: certificateType,
      serialNumber,
      subject: subjectPublicKey,
      certifier: this.certifierPublicKey,
      fields: certFields,
    });

    const signature = await this.wallet.createSignature({
      data: Array.from(new TextEncoder().encode(certData)),
      protocolID: [2, 'certificate signing'],
      keyID: `cert-${serialNumber}`,
    });

    const signatureHex = signature.signature
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    return {
      type: certificateType,
      serialNumber,
      subject: subjectPublicKey,
      certifier: this.certifierPublicKey,
      revocationOutpoint: `stub-revocation:${serialNumber}`,
      fields: certFields,
      signature: signatureHex,
    };
  }

  async getCertifierPublicKey(): Promise<string> {
    if (!this.certifierPublicKey) {
      throw new Error('CertificateIssuer not initialized');
    }
    return this.certifierPublicKey;
  }

  async isInitialized(): Promise<boolean> {
    return this.initialized;
  }
}

/**
 * Local stub implementation of RevocationChecker
 * Uses in-memory revocation list. Replace with overlay implementation in production.
 */
export class LocalRevocationChecker implements RevocationChecker {
  private revokedSerials = new Set<string>();
  private revocationDetails = new Map<string, { revokedAt: number; reason?: string }>();

  async isRevoked(certificate: Certificate): Promise<{
    revoked: boolean;
    revokedAt?: number;
    reason?: string;
  }> {
    const revoked = this.revokedSerials.has(certificate.serialNumber);
    if (revoked) {
      const details = this.revocationDetails.get(certificate.serialNumber);
      return {
        revoked: true,
        revokedAt: details?.revokedAt,
        reason: details?.reason,
      };
    }
    return { revoked: false };
  }

  async subscribeToRevocation(
    certificate: Certificate,
    callback: (revoked: boolean) => void
  ): Promise<{ unsubscribe: () => void }> {
    // In production, this would set up a websocket/SSE connection to the overlay
    // For now, just check immediately
    const revoked = this.revokedSerials.has(certificate.serialNumber);
    if (revoked) {
      callback(true);
    }
    return { unsubscribe: () => {} };
  }

  async batchCheckRevocations(certificates: Certificate[]): Promise<Map<string, boolean>> {
    const results = new Map<string, boolean>();
    for (const cert of certificates) {
      results.set(cert.serialNumber, this.revokedSerials.has(cert.serialNumber));
    }
    return results;
  }

  // Local methods for testing
  revoke(serialNumber: string, reason?: string): void {
    this.revokedSerials.add(serialNumber);
    this.revocationDetails.set(serialNumber, {
      revokedAt: Date.now(),
      reason,
    });
  }

  unrevoke(serialNumber: string): void {
    this.revokedSerials.delete(serialNumber);
    this.revocationDetails.delete(serialNumber);
  }
}

// =============================================================================
// IDENTITY GATE (Gates ALL operations)
// =============================================================================

/**
 * Identity verification result
 */
export interface IdentityVerificationResult {
  verified: boolean;
  publicKey?: string;
  certificateType?: string;
  error?: string;
  certificate?: Certificate;
}

/**
 * Identity Gate Configuration
 */
export interface IdentityGateConfig {
  wallet: BRC100Wallet;
  trustedCertifiers: string[];
  certificateIssuer?: CertificateIssuer;
  revocationChecker?: RevocationChecker;
  requireCertificate?: boolean;  // Default: true
  cacheVerificationMs?: number;  // Default: 60000 (1 minute)
}

/**
 * Identity Gate
 *
 * Central identity verification that MUST be called before:
 * - Any tool execution
 * - Any agent inference
 * - Any data access
 * - Any message encryption/decryption
 *
 * @example
 * ```typescript
 * const gate = new IdentityGate({
 *   wallet,
 *   trustedCertifiers: [caPublicKey],
 * });
 *
 * // Before ANY operation:
 * const identity = await gate.verifyIdentity(certificate);
 * if (!identity.verified) {
 *   throw new Error(`Access denied: ${identity.error}`);
 * }
 *
 * // Now safe to proceed with operation
 * ```
 */
export class IdentityGate {
  private wallet: BRC100Wallet;
  private trustedCertifiers: Set<string>;
  private certificateIssuer: CertificateIssuer;
  private revocationChecker: RevocationChecker;
  private requireCertificate: boolean;
  private cacheVerificationMs: number;

  // Caches
  private verificationCache = new Map<string, {
    result: IdentityVerificationResult;
    expiresAt: number;
  }>();
  private registeredCertificates = new Map<string, Certificate>();

  constructor(config: IdentityGateConfig) {
    this.wallet = config.wallet;
    this.trustedCertifiers = new Set(config.trustedCertifiers);
    this.certificateIssuer = config.certificateIssuer ?? new LocalCertificateIssuer(config.wallet);
    this.revocationChecker = config.revocationChecker ?? new LocalRevocationChecker();
    this.requireCertificate = config.requireCertificate ?? true;
    this.cacheVerificationMs = config.cacheVerificationMs ?? 60000;
  }

  /**
   * Initialize the gate (call once at startup)
   */
  async initialize(): Promise<void> {
    if (this.certificateIssuer instanceof LocalCertificateIssuer) {
      await this.certificateIssuer.initialize();
    }
    // Add self as trusted certifier
    const certifierKey = await this.certificateIssuer.getCertifierPublicKey();
    this.trustedCertifiers.add(certifierKey);
  }

  /**
   * GATE: Verify identity before ANY operation
   *
   * This method MUST be called before:
   * - Tool execution
   * - Agent inference
   * - Data read/write
   * - Message encryption/decryption
   */
  async verifyIdentity(
    certificate: Certificate
  ): Promise<IdentityVerificationResult> {
    // Check cache first
    const cached = this.getCachedVerification(certificate.serialNumber);
    if (cached) {
      return cached;
    }

    // Verify certifier is trusted
    if (!this.trustedCertifiers.has(certificate.certifier)) {
      const result: IdentityVerificationResult = {
        verified: false,
        error: 'Certificate issued by untrusted certifier',
      };
      return result;
    }

    // Check validity dates
    const now = Date.now();
    const validFrom = certificate.fields.validFrom
      ? new Date(certificate.fields.validFrom).getTime()
      : 0;
    const validUntil = certificate.fields.validUntil
      ? new Date(certificate.fields.validUntil).getTime()
      : Infinity;

    if (now < validFrom) {
      return {
        verified: false,
        error: 'Certificate not yet valid',
      };
    }

    if (now > validUntil) {
      return {
        verified: false,
        error: 'Certificate has expired',
      };
    }

    // CRITICAL: Check revocation status
    const revocationStatus = await this.revocationChecker.isRevoked(certificate);
    if (revocationStatus.revoked) {
      const result: IdentityVerificationResult = {
        verified: false,
        error: `Certificate revoked: ${revocationStatus.reason ?? 'No reason provided'}`,
      };
      this.cacheVerification(certificate.serialNumber, result);
      return result;
    }

    // Verify signature
    const certData = JSON.stringify({
      type: certificate.type,
      serialNumber: certificate.serialNumber,
      subject: certificate.subject,
      certifier: certificate.certifier,
      fields: Object.keys(certificate.fields).sort().reduce((acc, key) => {
        acc[key] = certificate.fields[key];
        return acc;
      }, {} as Record<string, string>),
    });

    const signatureBytes = new Uint8Array(
      certificate.signature.match(/.{2}/g)!.map(b => parseInt(b, 16))
    );

    const verifyResult = await this.wallet.verifySignature({
      data: Array.from(new TextEncoder().encode(certData)),
      signature: Array.from(signatureBytes),
      protocolID: [2, 'certificate signing'],
      keyID: `cert-${certificate.serialNumber}`,
    });

    if (!verifyResult.valid) {
      return {
        verified: false,
        error: 'Invalid certificate signature',
      };
    }

    // SUCCESS: Identity verified
    const result: IdentityVerificationResult = {
      verified: true,
      publicKey: certificate.subject,
      certificateType: certificate.fields.certificateType,
      certificate,
    };

    this.cacheVerification(certificate.serialNumber, result);
    this.registeredCertificates.set(certificate.subject, certificate);

    return result;
  }

  /**
   * GATE: Verify identity by public key (requires prior registration)
   */
  async verifyByPublicKey(publicKey: string): Promise<IdentityVerificationResult> {
    const certificate = this.registeredCertificates.get(publicKey);
    if (!certificate) {
      if (this.requireCertificate) {
        return {
          verified: false,
          error: 'No certificate registered for this public key',
        };
      }
      // Allow without certificate if not required (dev mode)
      return {
        verified: true,
        publicKey,
        certificateType: 'unverified',
      };
    }
    return this.verifyIdentity(certificate);
  }

  /**
   * Register a certificate for a public key
   */
  async registerCertificate(certificate: Certificate): Promise<IdentityVerificationResult> {
    const result = await this.verifyIdentity(certificate);
    if (result.verified) {
      this.registeredCertificates.set(certificate.subject, certificate);
    }
    return result;
  }

  /**
   * Revoke a certificate (sync with revocation checker)
   */
  async revokeCertificate(serialNumber: string, reason?: string): Promise<void> {
    if (this.revocationChecker instanceof LocalRevocationChecker) {
      this.revocationChecker.revoke(serialNumber, reason);
    }
    // Clear from cache
    this.verificationCache.delete(serialNumber);

    // Remove from registered certificates
    for (const [pubKey, cert] of this.registeredCertificates) {
      if (cert.serialNumber === serialNumber) {
        this.registeredCertificates.delete(pubKey);
        break;
      }
    }
  }

  /**
   * Sync revocation list (call periodically or on notification)
   */
  async syncRevocations(revokedSerialNumbers: string[]): Promise<void> {
    for (const serial of revokedSerialNumbers) {
      await this.revokeCertificate(serial, 'Synced from revocation list');
    }
  }

  /**
   * Add a trusted certifier
   */
  addTrustedCertifier(publicKey: string): void {
    this.trustedCertifiers.add(publicKey);
  }

  /**
   * Remove a trusted certifier
   */
  removeTrustedCertifier(publicKey: string): void {
    this.trustedCertifiers.delete(publicKey);
    // Invalidate all certificates from this certifier
    for (const [serial, cached] of this.verificationCache) {
      if (cached.result.certificate?.certifier === publicKey) {
        this.verificationCache.delete(serial);
      }
    }
  }

  /**
   * Get the certificate issuer (for admin operations)
   */
  getCertificateIssuer(): CertificateIssuer {
    return this.certificateIssuer;
  }

  /**
   * Get the revocation checker
   */
  getRevocationChecker(): RevocationChecker {
    return this.revocationChecker;
  }

  /**
   * Clear verification cache
   */
  clearCache(): void {
    this.verificationCache.clear();
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  private getCachedVerification(serialNumber: string): IdentityVerificationResult | null {
    const cached = this.verificationCache.get(serialNumber);
    if (!cached) return null;

    if (Date.now() > cached.expiresAt) {
      this.verificationCache.delete(serialNumber);
      return null;
    }

    return cached.result;
  }

  private cacheVerification(serialNumber: string, result: IdentityVerificationResult): void {
    // Don't cache failures for too long
    const cacheTime = result.verified ? this.cacheVerificationMs : 10000;

    this.verificationCache.set(serialNumber, {
      result,
      expiresAt: Date.now() + cacheTime,
    });
  }
}

// =============================================================================
// GATED OPERATION WRAPPERS
// =============================================================================

/**
 * Wrapper to gate any async operation with identity verification
 */
export async function gatedOperation<T>(
  gate: IdentityGate,
  certificate: Certificate,
  operation: () => Promise<T>,
  operationName: string
): Promise<T> {
  const identity = await gate.verifyIdentity(certificate);
  if (!identity.verified) {
    throw new Error(`[${operationName}] Access denied: ${identity.error}`);
  }
  return operation();
}

/**
 * Wrapper to gate operation by public key
 */
export async function gatedOperationByKey<T>(
  gate: IdentityGate,
  publicKey: string,
  operation: () => Promise<T>,
  operationName: string
): Promise<T> {
  const identity = await gate.verifyByPublicKey(publicKey);
  if (!identity.verified) {
    throw new Error(`[${operationName}] Access denied: ${identity.error}`);
  }
  return operation();
}
