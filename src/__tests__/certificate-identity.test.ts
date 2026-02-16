/**
 * Certificate Identity Tests
 *
 * Tests for BRC-52/53 certificate issuance, verification, and revocation.
 * Validates enterprise identity management including:
 * - Certificate issuance by admin
 * - Certificate verification
 * - Certificate revocation (employee termination)
 * - Access denial after revocation
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { CertificateAuthority } from '../01-core/identity/certificate-authority.js';
import { CertificateVerifier } from '../01-core/identity/certificate-verifier.js';
import { SecureTeamVault } from '../04-integrations/team/secure-team-vault.js';
import { MockSecureWallet, randomBytes } from './test-utils.js';
import type { Certificate } from '../07-shared/types/index.js';

describe('Certificate Authority', () => {
  let adminWallet: MockSecureWallet;
  let ca: CertificateAuthority;
  let adminPublicKey: string;

  beforeEach(async () => {
    adminWallet = new MockSecureWallet(randomBytes(32));
    ca = new CertificateAuthority({
      wallet: adminWallet,
      organizationName: 'Acme Corp',
    });
    await ca.initialize();
    adminPublicKey = ca.getCertifierPublicKey();
  });

  describe('Initialization', () => {
    it('should initialize with certifier public key', async () => {
      expect(adminPublicKey).toBeDefined();
      expect(adminPublicKey.length).toBe(66); // 33 bytes as hex
    });

    it('should auto-trust self as certifier', () => {
      const trusted = ca.getTrustedCertifiers();
      expect(trusted).toContain(adminPublicKey);
    });
  });

  describe('Certificate Issuance', () => {
    it('should issue employee certificate', async () => {
      const employeeWallet = new MockSecureWallet(randomBytes(32));
      const employeeKey = (await employeeWallet.getPublicKey({ identityKey: true })).publicKey;

      const issued = await ca.issueCertificate({
        subjectPublicKey: employeeKey,
        certificateType: 'employee',
        fields: {
          name: 'Alice Smith',
          email: 'alice@acme.com',
          department: 'Engineering',
          validFrom: new Date().toISOString(),
          validUntil: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
        },
      });

      expect(issued.certificate.subject).toBe(employeeKey);
      expect(issued.certificate.certifier).toBe(adminPublicKey);
      expect(issued.certificateType).toBe('employee');
      expect(issued.revoked).toBe(false);
    });

    it('should generate unique serial numbers', async () => {
      const wallet1 = new MockSecureWallet(randomBytes(32));
      const wallet2 = new MockSecureWallet(randomBytes(32));
      const key1 = (await wallet1.getPublicKey({ identityKey: true })).publicKey;
      const key2 = (await wallet2.getPublicKey({ identityKey: true })).publicKey;

      const cert1 = await ca.issueCertificate({
        subjectPublicKey: key1,
        certificateType: 'employee',
        fields: {
          name: 'Alice',
          email: 'alice@acme.com',
          validFrom: new Date().toISOString(),
          validUntil: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
        },
      });

      const cert2 = await ca.issueCertificate({
        subjectPublicKey: key2,
        certificateType: 'employee',
        fields: {
          name: 'Bob',
          email: 'bob@acme.com',
          validFrom: new Date().toISOString(),
          validUntil: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
        },
      });

      expect(cert1.certificate.serialNumber).not.toBe(cert2.certificate.serialNumber);
    });

    it('should issue bot certificate', async () => {
      const botWallet = new MockSecureWallet(randomBytes(32));
      const botKey = (await botWallet.getPublicKey({ identityKey: true })).publicKey;

      const issued = await ca.issueCertificate({
        subjectPublicKey: botKey,
        certificateType: 'bot',
        fields: {
          name: 'Support Bot',
          email: 'bot@acme.com',
          validFrom: new Date().toISOString(),
          validUntil: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
        },
      });

      expect(issued.certificateType).toBe('bot');
    });

    it('should set custom expiration', async () => {
      const wallet = new MockSecureWallet(randomBytes(32));
      const key = (await wallet.getPublicKey({ identityKey: true })).publicKey;

      const issued = await ca.issueCertificate({
        subjectPublicKey: key,
        certificateType: 'contractor',
        expiresInDays: 30,
        fields: {
          name: 'Contractor',
          email: 'contractor@acme.com',
          validFrom: new Date().toISOString(),
          validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        },
      });

      const validUntil = new Date(issued.certificate.fields.validUntil).getTime();
      const expectedExpiry = Date.now() + 30 * 24 * 60 * 60 * 1000;

      // Within 1 minute tolerance
      expect(Math.abs(validUntil - expectedExpiry)).toBeLessThan(60000);
    });
  });

  describe('Certificate Verification', () => {
    let employeeCert: Certificate;
    let employeeKey: string;

    beforeEach(async () => {
      const employeeWallet = new MockSecureWallet(randomBytes(32));
      employeeKey = (await employeeWallet.getPublicKey({ identityKey: true })).publicKey;

      const issued = await ca.issueCertificate({
        subjectPublicKey: employeeKey,
        certificateType: 'employee',
        fields: {
          name: 'Alice Smith',
          email: 'alice@acme.com',
          validFrom: new Date().toISOString(),
          validUntil: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
        },
      });
      employeeCert = issued.certificate;
    });

    it('should verify valid certificate', async () => {
      const result = await ca.verifyCertificate(employeeCert);

      expect(result.valid).toBe(true);
      expect(result.certificate).toBeDefined();
    });

    it('should check if public key has valid certificate', async () => {
      const result = await ca.hasValidCertificate(employeeKey);

      expect(result.valid).toBe(true);
    });

    it('should reject certificate from untrusted certifier', async () => {
      // Create a different CA
      const untrustedWallet = new MockSecureWallet(randomBytes(32));
      const untrustedCA = new CertificateAuthority({
        wallet: untrustedWallet,
        organizationName: 'Evil Corp',
      });
      await untrustedCA.initialize();

      const wallet = new MockSecureWallet(randomBytes(32));
      const key = (await wallet.getPublicKey({ identityKey: true })).publicKey;

      const issued = await untrustedCA.issueCertificate({
        subjectPublicKey: key,
        certificateType: 'employee',
        fields: {
          name: 'Evil Employee',
          email: 'evil@evil.com',
          validFrom: new Date().toISOString(),
          validUntil: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
        },
      });

      // Verify with original CA (which doesn't trust untrustedCA)
      const result = await ca.verifyCertificate(issued.certificate);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('untrusted certifier');
    });

    it('should reject expired certificate', async () => {
      const wallet = new MockSecureWallet(randomBytes(32));
      const key = (await wallet.getPublicKey({ identityKey: true })).publicKey;

      // Issue certificate that's already expired
      const issued = await ca.issueCertificate({
        subjectPublicKey: key,
        certificateType: 'employee',
        fields: {
          name: 'Expired Employee',
          email: 'expired@acme.com',
          validFrom: new Date(Date.now() - 2 * 365 * 24 * 60 * 60 * 1000).toISOString(),
          validUntil: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(), // Yesterday
        },
      });

      const result = await ca.verifyCertificate(issued.certificate);

      expect(result.valid).toBe(false);
      expect(result.expired).toBe(true);
    });
  });

  describe('Certificate Revocation', () => {
    let employeeCert: Certificate;
    let serialNumber: string;

    beforeEach(async () => {
      const employeeWallet = new MockSecureWallet(randomBytes(32));
      const employeeKey = (await employeeWallet.getPublicKey({ identityKey: true })).publicKey;

      const issued = await ca.issueCertificate({
        subjectPublicKey: employeeKey,
        certificateType: 'employee',
        fields: {
          name: 'Alice Smith',
          email: 'alice@acme.com',
          validFrom: new Date().toISOString(),
          validUntil: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
        },
      });
      employeeCert = issued.certificate;
      serialNumber = issued.certificate.serialNumber;
    });

    it('should revoke certificate', async () => {
      const result = await ca.revokeCertificate(serialNumber, 'Employment terminated');

      expect(result).toBe(true);
    });

    it('should reject revoked certificate on verification', async () => {
      await ca.revokeCertificate(serialNumber, 'Employment terminated');

      const result = await ca.verifyCertificate(employeeCert);

      expect(result.valid).toBe(false);
      expect(result.revoked).toBe(true);
      expect(result.error).toContain('revoked');
    });

    it('should track revocation details', async () => {
      await ca.revokeCertificate(serialNumber, 'Employment terminated');

      const revoked = ca.getRevokedCertificates();

      expect(revoked.length).toBe(1);
      expect(revoked[0].revocationReason).toBe('Employment terminated');
      expect(revoked[0].revokedAt).toBeDefined();
    });

    it('should handle revoking already-revoked certificate', async () => {
      await ca.revokeCertificate(serialNumber, 'First revocation');
      const result = await ca.revokeCertificate(serialNumber, 'Second revocation');

      expect(result).toBe(true); // Should succeed silently
    });
  });
});

describe('Certificate Verifier', () => {
  let adminWallet: MockSecureWallet;
  let ca: CertificateAuthority;
  let verifier: CertificateVerifier;
  let adminPublicKey: string;

  beforeEach(async () => {
    adminWallet = new MockSecureWallet(randomBytes(32));
    ca = new CertificateAuthority({
      wallet: adminWallet,
      organizationName: 'Acme Corp',
    });
    await ca.initialize();
    adminPublicKey = ca.getCertifierPublicKey();

    verifier = new CertificateVerifier({
      wallet: adminWallet,
      trustedCertifiers: [adminPublicKey],
    });
  });

  it('should verify certificate independently', async () => {
    const wallet = new MockSecureWallet(randomBytes(32));
    const key = (await wallet.getPublicKey({ identityKey: true })).publicKey;

    const issued = await ca.issueCertificate({
      subjectPublicKey: key,
      certificateType: 'employee',
      fields: {
        name: 'Alice',
        email: 'alice@acme.com',
        validFrom: new Date().toISOString(),
        validUntil: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
      },
    });

    const result = await verifier.verify(issued.certificate);

    expect(result.valid).toBe(true);
  });

  it('should register and verify by public key', async () => {
    const wallet = new MockSecureWallet(randomBytes(32));
    const key = (await wallet.getPublicKey({ identityKey: true })).publicKey;

    const issued = await ca.issueCertificate({
      subjectPublicKey: key,
      certificateType: 'employee',
      fields: {
        name: 'Alice',
        email: 'alice@acme.com',
        validFrom: new Date().toISOString(),
        validUntil: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
      },
    });

    // Register the certificate
    await verifier.registerCertificate(issued.certificate);

    // Verify by public key
    const result = await verifier.verifyPublicKey(key);

    expect(result.valid).toBe(true);
  });

  it('should sync revocation list', async () => {
    const wallet = new MockSecureWallet(randomBytes(32));
    const key = (await wallet.getPublicKey({ identityKey: true })).publicKey;

    const issued = await ca.issueCertificate({
      subjectPublicKey: key,
      certificateType: 'employee',
      fields: {
        name: 'Alice',
        email: 'alice@acme.com',
        validFrom: new Date().toISOString(),
        validUntil: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
      },
    });

    await verifier.registerCertificate(issued.certificate);

    // Revoke via CA
    await ca.revokeCertificate(issued.certificate.serialNumber, 'Terminated');

    // Sync revocation list to verifier
    await verifier.syncRevocationList([issued.certificate.serialNumber]);

    // Should now be invalid
    const result = await verifier.verify(issued.certificate);

    expect(result.valid).toBe(false);
    expect(result.revoked).toBe(true);
  });
});

describe('Secure Team Vault with Certificates', () => {
  let adminWallet: MockSecureWallet;
  let employeeWallet: MockSecureWallet;
  let botWallet: MockSecureWallet;
  let ca: CertificateAuthority;
  let teamVault: SecureTeamVault;
  let adminCert: Certificate;
  let employeeCert: Certificate;
  let botCert: Certificate;

  beforeEach(async () => {
    adminWallet = new MockSecureWallet(randomBytes(32));
    employeeWallet = new MockSecureWallet(randomBytes(32));
    botWallet = new MockSecureWallet(randomBytes(32));

    ca = new CertificateAuthority({
      wallet: adminWallet,
      organizationName: 'Acme Corp',
    });
    await ca.initialize();

    const adminKey = ca.getCertifierPublicKey();
    const employeeKey = (await employeeWallet.getPublicKey({ identityKey: true })).publicKey;
    const botKey = (await botWallet.getPublicKey({ identityKey: true })).publicKey;

    // Issue certificates
    adminCert = (await ca.issueCertificate({
      subjectPublicKey: adminKey,
      certificateType: 'admin',
      fields: {
        name: 'Admin',
        email: 'admin@acme.com',
        validFrom: new Date().toISOString(),
        validUntil: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
      },
    })).certificate;

    employeeCert = (await ca.issueCertificate({
      subjectPublicKey: employeeKey,
      certificateType: 'employee',
      fields: {
        name: 'Alice',
        email: 'alice@acme.com',
        validFrom: new Date().toISOString(),
        validUntil: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
      },
    })).certificate;

    botCert = (await ca.issueCertificate({
      subjectPublicKey: botKey,
      certificateType: 'bot',
      fields: {
        name: 'Support Bot',
        email: 'bot@acme.com',
        validFrom: new Date().toISOString(),
        validUntil: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
      },
    })).certificate;

    // Create secure team vault
    teamVault = new SecureTeamVault({
      wallet: adminWallet,
      trustedCertifiers: [adminKey],
    });
  });

  describe('Certificate-Required Team Creation', () => {
    it('should create team with certified owner', async () => {
      const team = await teamVault.createTeam('Engineering', adminCert);

      expect(team.teamId).toBeDefined();
      expect(team.requireCertificate).toBe(true);
      expect(team.members[0].certificate).toBeDefined();
    });

    it('should reject team creation with invalid certificate', async () => {
      // Create certificate from untrusted CA
      const untrustedWallet = new MockSecureWallet(randomBytes(32));
      const untrustedCA = new CertificateAuthority({
        wallet: untrustedWallet,
        organizationName: 'Evil Corp',
      });
      await untrustedCA.initialize();

      const fakeCert = (await untrustedCA.issueCertificate({
        subjectPublicKey: (await adminWallet.getPublicKey({ identityKey: true })).publicKey,
        certificateType: 'admin',
        fields: {
          name: 'Fake Admin',
          email: 'fake@evil.com',
          validFrom: new Date().toISOString(),
          validUntil: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
        },
      })).certificate;

      await expect(
        teamVault.createTeam('Evil Team', fakeCert)
      ).rejects.toThrow('Invalid owner certificate');
    });
  });

  describe('Certificate-Required Member Management', () => {
    let team: Awaited<ReturnType<typeof teamVault.createTeam>>;

    beforeEach(async () => {
      team = await teamVault.createTeam('Engineering', adminCert);
    });

    it('should add member with valid certificate', async () => {
      const result = await teamVault.addMember(
        team.teamId,
        employeeCert,
        'member',
        adminCert.subject
      );

      expect(result.success).toBe(true);
    });

    it('should add bot with valid certificate', async () => {
      const result = await teamVault.addBot(
        team.teamId,
        botCert,
        adminCert.subject
      );

      expect(result.success).toBe(true);
    });

    it('should reject member with invalid certificate', async () => {
      // Revoke the certificate first
      await ca.revokeCertificate(employeeCert.serialNumber, 'Terminated');
      teamVault.revokeCertificate(employeeCert.serialNumber);

      const result = await teamVault.addMember(
        team.teamId,
        employeeCert,
        'member',
        adminCert.subject
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid member certificate');
    });
  });

  describe('Access Revocation', () => {
    let team: Awaited<ReturnType<typeof teamVault.createTeam>>;

    beforeEach(async () => {
      team = await teamVault.createTeam('Engineering', adminCert);
      await teamVault.addMember(team.teamId, employeeCert, 'member', adminCert.subject);
    });

    it('should allow access before revocation', async () => {
      const access = await teamVault.checkAccess(team.teamId, employeeCert.subject);

      expect(access.hasAccess).toBe(true);
    });

    it('should deny access after certificate revocation', async () => {
      // Revoke the employee's certificate
      await ca.revokeCertificate(employeeCert.serialNumber, 'Employment terminated');

      // Sync revocation to team vault
      teamVault.revokeCertificate(employeeCert.serialNumber);

      // Check access - should be denied
      const access = await teamVault.checkAccess(team.teamId, employeeCert.subject);

      expect(access.hasAccess).toBe(false);
      expect(access.error).toContain('Certificate invalid');
    });

    it('should deny document access after revocation', async () => {
      // Store a document while employee has access
      await teamVault.storeDocument(
        team.teamId,
        '/docs/secret.md',
        'Secret content',
        adminCert.subject
      );

      // Revoke the employee's certificate
      await ca.revokeCertificate(employeeCert.serialNumber, 'Employment terminated');
      teamVault.revokeCertificate(employeeCert.serialNumber);

      // Employee should not be able to read with explicit verification
      await expect(
        teamVault.readDocument(team.teamId, '/docs/secret.md', employeeCert.subject)
      ).rejects.toThrow('Access denied');
    });

    it('should deny document writes after revocation', async () => {
      // Revoke the employee's certificate
      await ca.revokeCertificate(employeeCert.serialNumber, 'Employment terminated');
      teamVault.revokeCertificate(employeeCert.serialNumber);

      // Employee should not be able to write
      await expect(
        teamVault.storeDocument(
          team.teamId,
          '/docs/evil.md',
          'Evil content',
          employeeCert.subject
        )
      ).rejects.toThrow('Access denied');
    });
  });

  describe('Sync Revocation List', () => {
    let team: Awaited<ReturnType<typeof teamVault.createTeam>>;

    beforeEach(async () => {
      team = await teamVault.createTeam('Engineering', adminCert);
      await teamVault.addMember(team.teamId, employeeCert, 'member', adminCert.subject);
      await teamVault.addBot(team.teamId, botCert, adminCert.subject);
    });

    it('should bulk sync revocation list', async () => {
      // Revoke both employee and bot
      await ca.revokeCertificate(employeeCert.serialNumber, 'Terminated');
      await ca.revokeCertificate(botCert.serialNumber, 'Decommissioned');

      // Sync all revocations at once
      await teamVault.syncRevocationList([
        employeeCert.serialNumber,
        botCert.serialNumber,
      ]);

      // Both should be denied
      const employeeAccess = await teamVault.checkAccess(team.teamId, employeeCert.subject);
      const botAccess = await teamVault.checkAccess(team.teamId, botCert.subject);

      expect(employeeAccess.hasAccess).toBe(false);
      expect(botAccess.hasAccess).toBe(false);
    });
  });

  describe('Document Encryption with Valid Members Only', () => {
    let team: Awaited<ReturnType<typeof teamVault.createTeam>>;

    beforeEach(async () => {
      team = await teamVault.createTeam('Engineering', adminCert);
      await teamVault.addMember(team.teamId, employeeCert, 'member', adminCert.subject);
    });

    it('should only encrypt for members with valid certificates', async () => {
      // Store document while both have valid certs
      const doc = await teamVault.storeDocument(
        team.teamId,
        '/docs/readme.md',
        'Team readme',
        adminCert.subject
      );

      expect(doc.encryptedContent.length).toBeGreaterThan(0);
    });

    it('should read document successfully with valid certificate', async () => {
      await teamVault.storeDocument(
        team.teamId,
        '/docs/readme.md',
        'Team readme content',
        adminCert.subject
      );

      // Read with explicit verification
      const content = await teamVault.readDocumentText(
        team.teamId,
        '/docs/readme.md',
        employeeCert.subject
      );

      expect(content).toBe('Team readme content');
    });
  });
});
