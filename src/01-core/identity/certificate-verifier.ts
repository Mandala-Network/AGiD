/**
 * Certificate Verifier
 *
 * Verifies BRC-52/53 identity certificates for access control.
 * Used by TeamVault and other components to ensure only users with
 * valid, non-revoked certificates can access resources.
 */

import type { BRC100Wallet, Certificate } from '../../07-shared/types/index.js';
import type {
  CertificateType,
  CertificateVerificationResult,
} from './certificate-authority.js';

/**
 * Configuration for Certificate Verifier
 */
export interface CertificateVerifierConfig {
  wallet: BRC100Wallet;
  trustedCertifiers: string[];  // Public keys of trusted certificate authorities
  checkRevocationOnChain?: boolean;
  revocationCheckUrl?: string;
  cacheValidationMs?: number;  // How long to cache validation results
}

/**
 * Cached verification result
 */
interface CachedVerification {
  result: CertificateVerificationResult;
  cachedAt: number;
  expiresAt: number;
}

/**
 * Certificate Verifier
 *
 * Standalone verifier for checking certificate validity without needing
 * the full Certificate Authority. Used by services that need to verify
 * user identity before granting access.
 *
 * @example
 * ```typescript
 * const verifier = new CertificateVerifier({
 *   wallet,
 *   trustedCertifiers: [companyCAPublicKey],
 * });
 *
 * // Verify before allowing access
 * const result = await verifier.verify(userCertificate);
 * if (!result.valid) {
 *   throw new Error(`Access denied: ${result.error}`);
 * }
 * ```
 */
export class CertificateVerifier {
  private wallet: BRC100Wallet;
  private trustedCertifiers: Set<string>;
  private checkRevocationOnChain: boolean;
  // revocationCheckUrl reserved for future on-chain revocation checks
  private cacheValidationMs: number;
  private verificationCache: Map<string, CachedVerification> = new Map();
  private knownCertificates: Map<string, Certificate> = new Map();  // publicKey -> certificate
  private revocationList: Set<string> = new Set();  // serial numbers

  constructor(config: CertificateVerifierConfig) {
    this.wallet = config.wallet;
    this.trustedCertifiers = new Set(config.trustedCertifiers);
    this.checkRevocationOnChain = config.checkRevocationOnChain ?? false;
    // config.revocationCheckUrl reserved for future on-chain revocation checks
    this.cacheValidationMs = config.cacheValidationMs ?? 60000; // 1 minute default
  }

  /**
   * Verify a certificate
   */
  async verify(certificate: Certificate): Promise<CertificateVerificationResult> {
    // Check cache first
    const cached = this.getCachedResult(certificate.serialNumber);
    if (cached) {
      return cached;
    }

    // Check if certifier is trusted
    if (!this.trustedCertifiers.has(certificate.certifier)) {
      const result: CertificateVerificationResult = {
        valid: false,
        error: 'Certificate issued by untrusted certifier',
      };
      return result;
    }

    // Check if explicitly revoked
    if (this.revocationList.has(certificate.serialNumber)) {
      const result: CertificateVerificationResult = {
        valid: false,
        certificate,
        revoked: true,
        error: 'Certificate has been revoked',
      };
      this.cacheResult(certificate.serialNumber, result);
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
      const result: CertificateVerificationResult = {
        valid: false,
        certificate,
        notYetValid: true,
        error: 'Certificate not yet valid',
      };
      return result;
    }

    if (now > validUntil) {
      const result: CertificateVerificationResult = {
        valid: false,
        certificate,
        expired: true,
        error: 'Certificate has expired',
      };
      this.cacheResult(certificate.serialNumber, result);
      return result;
    }

    // Verify signature
    const certificateData = this.serializeCertificateForSigning(certificate);
    const signatureBytes = this.hexToBytes(certificate.signature);

    try {
      // Verify with same key derivation as signing (no counterparty)
      // Note: In production, this would verify against the certifier's public key
      const verifyResult = await this.wallet.verifySignature({
        data: Array.from(certificateData),
        signature: Array.from(signatureBytes),
        protocolID: [2, 'certificate-signing'],
        keyID: `cert-${certificate.serialNumber}`,
      });

      if (!verifyResult.valid) {
        const result: CertificateVerificationResult = {
          valid: false,
          certificate,
          error: 'Invalid certificate signature',
        };
        return result;
      }
    } catch (error) {
      const result: CertificateVerificationResult = {
        valid: false,
        certificate,
        error: `Signature verification failed: ${error}`,
      };
      return result;
    }

    // Check on-chain revocation if configured
    if (this.checkRevocationOnChain) {
      const onChainRevoked = await this.checkOnChainRevocation(certificate);
      if (onChainRevoked) {
        this.revocationList.add(certificate.serialNumber);
        const result: CertificateVerificationResult = {
          valid: false,
          certificate,
          revoked: true,
          error: 'Certificate revoked on blockchain',
        };
        this.cacheResult(certificate.serialNumber, result);
        return result;
      }
    }

    // Extract certificate type
    const certType = certificate.fields.certificateType as CertificateType | undefined;

    const result: CertificateVerificationResult = {
      valid: true,
      certificate,
      certificateType: certType,
    };

    this.cacheResult(certificate.serialNumber, result);
    return result;
  }

  /**
   * Verify that a public key has a valid certificate
   */
  async verifyPublicKey(publicKey: string): Promise<CertificateVerificationResult> {
    const certificate = this.knownCertificates.get(publicKey);
    if (!certificate) {
      return {
        valid: false,
        error: 'No certificate found for this public key',
      };
    }
    return this.verify(certificate);
  }

  /**
   * Register a certificate for a public key
   */
  async registerCertificate(certificate: Certificate): Promise<CertificateVerificationResult> {
    // Verify the certificate first
    const result = await this.verify(certificate);

    if (result.valid) {
      // Store mapping from public key to certificate
      this.knownCertificates.set(certificate.subject, certificate);
    }

    return result;
  }

  /**
   * Add a certificate to the revocation list
   */
  revokeCertificate(serialNumber: string): void {
    this.revocationList.add(serialNumber);
    // Invalidate cache for this certificate
    this.verificationCache.delete(serialNumber);
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
    // Invalidate all cached results from this certifier
    this.invalidateCacheForCertifier(publicKey);
  }

  /**
   * Check if a certifier is trusted
   */
  isTrustedCertifier(publicKey: string): boolean {
    return this.trustedCertifiers.has(publicKey);
  }

  /**
   * Get the certificate for a public key (if registered)
   */
  getCertificate(publicKey: string): Certificate | undefined {
    return this.knownCertificates.get(publicKey);
  }

  /**
   * Clear all cached verifications
   */
  clearCache(): void {
    this.verificationCache.clear();
  }

  /**
   * Sync revocation list from a source
   */
  async syncRevocationList(serialNumbers: string[]): Promise<void> {
    for (const serial of serialNumbers) {
      this.revocationList.add(serial);
      this.verificationCache.delete(serial);
    }
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  private getCachedResult(serialNumber: string): CertificateVerificationResult | null {
    const cached = this.verificationCache.get(serialNumber);
    if (!cached) return null;

    if (Date.now() > cached.expiresAt) {
      this.verificationCache.delete(serialNumber);
      return null;
    }

    return cached.result;
  }

  private cacheResult(serialNumber: string, result: CertificateVerificationResult): void {
    const now = Date.now();
    this.verificationCache.set(serialNumber, {
      result,
      cachedAt: now,
      expiresAt: now + this.cacheValidationMs,
    });
  }

  private invalidateCacheForCertifier(certifierPublicKey: string): void {
    for (const [serial, cached] of this.verificationCache.entries()) {
      if (cached.result.certificate?.certifier === certifierPublicKey) {
        this.verificationCache.delete(serial);
      }
    }
  }

  private serializeCertificateForSigning(cert: Certificate): Uint8Array {
    const data = JSON.stringify({
      type: cert.type,
      serialNumber: cert.serialNumber,
      subject: cert.subject,
      certifier: cert.certifier,
      revocationOutpoint: cert.revocationOutpoint,
      fields: Object.keys(cert.fields).sort().reduce((acc, key) => {
        acc[key] = cert.fields[key];
        return acc;
      }, {} as Record<string, string>),
    });
    return new TextEncoder().encode(data);
  }

  private async checkOnChainRevocation(_certificate: Certificate): Promise<boolean> {
    // In production, this would:
    // 1. Look up the revocation outpoint on the blockchain
    // 2. Check if it has been spent (which indicates revocation)
    // 3. Return true if spent, false if unspent

    // For now, rely on local revocation list
    return false;
  }

  private hexToBytes(hex: string): Uint8Array {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
      bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
    }
    return bytes;
  }
}
