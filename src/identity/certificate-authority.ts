/**
 * Certificate Authority
 *
 * BRC-52/53 compliant certificate issuance and management for enterprise identity.
 * Enables admins to issue identity certificates to employees and revoke them
 * when employees leave the organization.
 */

import type {
  BRC100Wallet,
  Certificate,
} from '../types/index.js';

/**
 * Certificate types for enterprise identity
 */
export type CertificateType =
  | 'employee'      // Standard employee certificate
  | 'admin'         // Admin with elevated privileges
  | 'contractor'    // Temporary contractor access
  | 'bot'           // AI agent/bot identity
  | 'service';      // Service account

/**
 * Certificate field definitions
 */
export interface EmployeeCertificateFields {
  name: string;
  email: string;
  department?: string;
  title?: string;
  employeeId?: string;
  validFrom: string;   // ISO date
  validUntil: string;  // ISO date
  permissions?: string; // JSON-encoded permissions
}

/**
 * Certificate issuance request
 */
export interface CertificateIssuanceRequest {
  subjectPublicKey: string;
  certificateType: CertificateType;
  fields: EmployeeCertificateFields;
  expiresInDays?: number;
}

/**
 * Issued certificate with metadata
 */
export interface IssuedCertificate {
  certificate: Certificate;
  issuedAt: number;
  issuedBy: string;
  subjectPublicKey: string;
  certificateType: CertificateType;
  revoked: boolean;
  revokedAt?: number;
  revokedBy?: string;
  revocationReason?: string;
}

/**
 * Certificate verification result
 */
export interface CertificateVerificationResult {
  valid: boolean;
  certificate?: Certificate;
  certificateType?: CertificateType;
  error?: string;
  revoked?: boolean;
  expired?: boolean;
  notYetValid?: boolean;
}

/**
 * Configuration for Certificate Authority
 */
export interface CertificateAuthorityConfig {
  wallet: BRC100Wallet;
  organizationName: string;
  organizationId?: string;
  trustedCertifiers?: string[];  // Additional trusted certifier public keys
  checkRevocationOnChain?: boolean;
  revocationCheckUrl?: string;
}

/**
 * Certificate Authority for Enterprise Identity Management
 *
 * Implements BRC-52/53 certificate issuance and revocation.
 *
 * @example
 * ```typescript
 * const ca = new CertificateAuthority({
 *   wallet: adminWallet,
 *   organizationName: 'Acme Corp'
 * });
 *
 * // Issue certificate to employee
 * const cert = await ca.issueCertificate({
 *   subjectPublicKey: employeePublicKey,
 *   certificateType: 'employee',
 *   fields: {
 *     name: 'Alice Smith',
 *     email: 'alice@acme.com',
 *     department: 'Engineering',
 *     validFrom: '2024-01-01',
 *     validUntil: '2025-01-01'
 *   }
 * });
 *
 * // Revoke when employee leaves
 * await ca.revokeCertificate(cert.certificate.serialNumber, 'Employment terminated');
 * ```
 */
export class CertificateAuthority {
  private wallet: BRC100Wallet;
  private organizationName: string;
  private organizationId: string;
  private certifierPublicKey: string | null = null;
  private trustedCertifiers: Set<string>;
  private issuedCertificates: Map<string, IssuedCertificate> = new Map();
  private revocationList: Map<string, { revokedAt: number; reason: string }> = new Map();
  private checkRevocationOnChain: boolean;
  private revocationCheckUrl?: string;

  constructor(config: CertificateAuthorityConfig) {
    this.wallet = config.wallet;
    this.organizationName = config.organizationName;
    this.organizationId = config.organizationId ?? this.generateOrganizationId();
    this.trustedCertifiers = new Set(config.trustedCertifiers ?? []);
    this.checkRevocationOnChain = config.checkRevocationOnChain ?? false;
    this.revocationCheckUrl = config.revocationCheckUrl;
  }

  /**
   * Initialize the CA (must be called before issuing certificates)
   */
  async initialize(): Promise<void> {
    const result = await this.wallet.getPublicKey({ identityKey: true });
    this.certifierPublicKey = result.publicKey;
    // Add self to trusted certifiers
    this.trustedCertifiers.add(this.certifierPublicKey);
  }

  /**
   * Get the certifier's public key
   */
  getCertifierPublicKey(): string {
    if (!this.certifierPublicKey) {
      throw new Error('Certificate Authority not initialized. Call initialize() first.');
    }
    return this.certifierPublicKey;
  }

  /**
   * Issue a certificate to a subject
   */
  async issueCertificate(request: CertificateIssuanceRequest): Promise<IssuedCertificate> {
    if (!this.certifierPublicKey) {
      throw new Error('Certificate Authority not initialized. Call initialize() first.');
    }

    const now = Date.now();
    const serialNumber = await this.generateSerialNumber();

    // Calculate validity dates
    const validFrom = request.fields.validFrom
      ? new Date(request.fields.validFrom).getTime()
      : now;

    const expiresInMs = (request.expiresInDays ?? 365) * 24 * 60 * 60 * 1000;
    const validUntil = request.fields.validUntil
      ? new Date(request.fields.validUntil).getTime()
      : now + expiresInMs;

    // Build certificate fields
    const fields: Record<string, string> = {
      organizationName: this.organizationName,
      organizationId: this.organizationId,
      certificateType: request.certificateType,
      name: request.fields.name,
      email: request.fields.email,
      validFrom: new Date(validFrom).toISOString(),
      validUntil: new Date(validUntil).toISOString(),
    };

    if (request.fields.department) fields.department = request.fields.department;
    if (request.fields.title) fields.title = request.fields.title;
    if (request.fields.employeeId) fields.employeeId = request.fields.employeeId;
    if (request.fields.permissions) fields.permissions = request.fields.permissions;

    // Create revocation outpoint (placeholder - would be actual UTXO in production)
    const revocationOutpoint = await this.createRevocationOutpoint(serialNumber);

    // Sign the certificate
    const certificateData = this.serializeCertificateForSigning({
      type: `${this.organizationId}.${request.certificateType}`,
      serialNumber,
      subject: request.subjectPublicKey,
      certifier: this.certifierPublicKey,
      revocationOutpoint,
      fields,
    });

    const signatureResult = await this.wallet.createSignature({
      data: Array.from(certificateData),
      protocolID: [2, 'certificate signing'],
      keyID: `cert-${serialNumber}`,
    });

    const signature = Array.from(signatureResult.signature)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    const certificate: Certificate = {
      type: `${this.organizationId}.${request.certificateType}`,
      serialNumber,
      subject: request.subjectPublicKey,
      certifier: this.certifierPublicKey,
      revocationOutpoint,
      fields,
      signature,
    };

    const issuedCert: IssuedCertificate = {
      certificate,
      issuedAt: now,
      issuedBy: this.certifierPublicKey,
      subjectPublicKey: request.subjectPublicKey,
      certificateType: request.certificateType,
      revoked: false,
    };

    // Store issued certificate
    this.issuedCertificates.set(serialNumber, issuedCert);

    return issuedCert;
  }

  /**
   * Revoke a certificate
   */
  async revokeCertificate(
    serialNumber: string,
    reason: string,
    revokedBy?: string
  ): Promise<boolean> {
    const issuedCert = this.issuedCertificates.get(serialNumber);
    if (!issuedCert) {
      throw new Error('Certificate not found');
    }

    if (issuedCert.revoked) {
      return true; // Already revoked
    }

    const now = Date.now();

    // Update local state
    issuedCert.revoked = true;
    issuedCert.revokedAt = now;
    issuedCert.revokedBy = revokedBy ?? this.certifierPublicKey ?? 'unknown';
    issuedCert.revocationReason = reason;

    // Add to revocation list
    this.revocationList.set(serialNumber, {
      revokedAt: now,
      reason,
    });

    // In production, this would spend the revocation UTXO on-chain
    // to provide cryptographic proof of revocation
    if (this.checkRevocationOnChain) {
      await this.publishRevocationOnChain(serialNumber, reason);
    }

    return true;
  }

  /**
   * Verify a certificate
   */
  async verifyCertificate(certificate: Certificate): Promise<CertificateVerificationResult> {
    // Check if certifier is trusted
    if (!this.trustedCertifiers.has(certificate.certifier)) {
      return {
        valid: false,
        error: 'Certificate issued by untrusted certifier',
      };
    }

    // Check revocation status
    const revocationStatus = await this.checkRevocationStatus(certificate.serialNumber);
    if (revocationStatus.revoked) {
      return {
        valid: false,
        certificate,
        revoked: true,
        error: `Certificate revoked: ${revocationStatus.reason}`,
      };
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
        valid: false,
        certificate,
        notYetValid: true,
        error: 'Certificate not yet valid',
      };
    }

    if (now > validUntil) {
      return {
        valid: false,
        certificate,
        expired: true,
        error: 'Certificate has expired',
      };
    }

    // Verify signature
    const certificateData = this.serializeCertificateForSigning({
      type: certificate.type,
      serialNumber: certificate.serialNumber,
      subject: certificate.subject,
      certifier: certificate.certifier,
      revocationOutpoint: certificate.revocationOutpoint,
      fields: certificate.fields,
    });

    const signatureBytes = this.hexToBytes(certificate.signature);

    // Verify with same key derivation as signing (no counterparty, self-signed)
    const verifyResult = await this.wallet.verifySignature({
      data: Array.from(certificateData),
      signature: Array.from(signatureBytes),
      protocolID: [2, 'certificate signing'],
      keyID: `cert-${certificate.serialNumber}`,
    });

    if (!verifyResult.valid) {
      return {
        valid: false,
        certificate,
        error: 'Invalid certificate signature',
      };
    }

    // Extract certificate type
    const certType = certificate.fields.certificateType as CertificateType | undefined;

    return {
      valid: true,
      certificate,
      certificateType: certType,
    };
  }

  /**
   * Check if a public key has a valid certificate
   */
  async hasValidCertificate(publicKey: string): Promise<CertificateVerificationResult> {
    // Find certificates for this public key
    for (const issuedCert of this.issuedCertificates.values()) {
      if (issuedCert.subjectPublicKey === publicKey) {
        const result = await this.verifyCertificate(issuedCert.certificate);
        if (result.valid) {
          return result;
        }
      }
    }

    return {
      valid: false,
      error: 'No valid certificate found for this public key',
    };
  }

  /**
   * Get all certificates issued to a public key
   */
  getCertificatesForSubject(publicKey: string): IssuedCertificate[] {
    const certs: IssuedCertificate[] = [];
    for (const cert of this.issuedCertificates.values()) {
      if (cert.subjectPublicKey === publicKey) {
        certs.push(cert);
      }
    }
    return certs;
  }

  /**
   * Get all issued certificates
   */
  getAllCertificates(): IssuedCertificate[] {
    return Array.from(this.issuedCertificates.values());
  }

  /**
   * Get all revoked certificates
   */
  getRevokedCertificates(): IssuedCertificate[] {
    return Array.from(this.issuedCertificates.values()).filter(c => c.revoked);
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
    // Cannot remove self
    if (publicKey === this.certifierPublicKey) {
      throw new Error('Cannot remove self from trusted certifiers');
    }
    this.trustedCertifiers.delete(publicKey);
  }

  /**
   * Get list of trusted certifiers
   */
  getTrustedCertifiers(): string[] {
    return Array.from(this.trustedCertifiers);
  }

  /**
   * Import a certificate (for certificates issued by other trusted CAs)
   */
  async importCertificate(certificate: Certificate): Promise<CertificateVerificationResult> {
    // Verify the certificate first
    const result = await this.verifyCertificate(certificate);

    if (result.valid) {
      // Store it
      const issuedCert: IssuedCertificate = {
        certificate,
        issuedAt: certificate.fields.validFrom
          ? new Date(certificate.fields.validFrom).getTime()
          : Date.now(),
        issuedBy: certificate.certifier,
        subjectPublicKey: certificate.subject,
        certificateType: (certificate.fields.certificateType as CertificateType) ?? 'employee',
        revoked: false,
      };
      this.issuedCertificates.set(certificate.serialNumber, issuedCert);
    }

    return result;
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  private generateOrganizationId(): string {
    const random = crypto.getRandomValues(new Uint8Array(8));
    return Array.from(random).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  private async generateSerialNumber(): Promise<string> {
    const timestamp = Date.now().toString(36);
    const random = crypto.getRandomValues(new Uint8Array(12));
    const randomHex = Array.from(random).map(b => b.toString(16).padStart(2, '0')).join('');
    return `${timestamp}-${randomHex}`;
  }

  private async createRevocationOutpoint(serialNumber: string): Promise<string> {
    // In production, this would create an actual UTXO that can be spent to revoke
    // For now, return a placeholder that represents the revocation mechanism
    const hash = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(`revocation:${serialNumber}:${Date.now()}`)
    );
    const hashHex = Array.from(new Uint8Array(hash))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    return `${hashHex}:0`;
  }

  private serializeCertificateForSigning(cert: {
    type: string;
    serialNumber: string;
    subject: string;
    certifier: string;
    revocationOutpoint: string;
    fields: Record<string, string>;
  }): Uint8Array {
    // Deterministic serialization for signing
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

  private async checkRevocationStatus(serialNumber: string): Promise<{
    revoked: boolean;
    reason?: string;
  }> {
    // Check local revocation list first
    const localRevocation = this.revocationList.get(serialNumber);
    if (localRevocation) {
      return { revoked: true, reason: localRevocation.reason };
    }

    // Check issued certificates
    const issuedCert = this.issuedCertificates.get(serialNumber);
    if (issuedCert?.revoked) {
      return { revoked: true, reason: issuedCert.revocationReason };
    }

    // In production, would also check on-chain revocation status
    if (this.checkRevocationOnChain && this.revocationCheckUrl) {
      // Would make HTTP request to check blockchain for spent revocation UTXO
    }

    return { revoked: false };
  }

  private async publishRevocationOnChain(
    _serialNumber: string,
    _reason: string
  ): Promise<void> {
    // In production, this would:
    // 1. Create a transaction spending the revocation UTXO
    // 2. Include the revocation reason in OP_RETURN
    // 3. Broadcast to the blockchain
    // This provides cryptographic proof of revocation timestamp
  }

  private hexToBytes(hex: string): Uint8Array {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
      bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
    }
    return bytes;
  }
}
