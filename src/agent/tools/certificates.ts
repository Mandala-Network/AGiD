/**
 * Certificate Tools
 *
 * 8 tools for issuing, receiving, listing, verifying, revoking,
 * revealing, checking revocation, and sending BRC-52 identity certificates.
 */

import { PeerCert } from 'peercert';
import { Utils } from '@bsv/sdk';
import type { ToolDescriptor } from './types.js';
import { ok } from './types.js';

/** AGIdentity certificate type — base64 of 'agidentity.identity' */
const AGID_CERT_TYPE = Utils.toBase64(Utils.toArray('agidentity.identity', 'utf8'));

export function certTools(): ToolDescriptor[] {
  return [
    // =========================================================================
    // 1. agid_cert_issue — Issue a certificate to another identity
    // =========================================================================
    {
      definition: {
        name: 'agid_cert_issue',
        description: 'Issue an identity certificate to another public key. Creates a BRC-52 certificate with encrypted fields that only the subject can decrypt. Optionally sends it via MessageBox.',
        input_schema: {
          type: 'object',
          properties: {
            subject: { type: 'string', description: 'Public key of the certificate subject (33-byte hex)' },
            name: { type: 'string', description: 'Name to certify (required)' },
            role: { type: 'string', description: 'Role to certify (default: "peer")' },
            organization: { type: 'string', description: 'Organization (optional)' },
            email: { type: 'string', description: 'Email address (optional)' },
            capabilities: { type: 'string', description: 'Comma-separated capabilities (optional)' },
            description: { type: 'string', description: 'Freeform description (optional)' },
            autoSend: { type: 'boolean', description: 'Send certificate to subject via PeerCert MessageBox (default: true)' },
          },
          required: ['subject', 'name'],
        },
      },
      requiresWallet: true,
      execute: async (params, ctx) => {
        const subject = params.subject as string;
        const name = params.name as string;
        const role = (params.role as string) || 'peer';
        const autoSend = params.autoSend !== false;

        const fields: Record<string, string> = { name, role };
        if (params.organization) fields.organization = params.organization as string;
        if (params.email) fields.email = params.email as string;
        if (params.capabilities) fields.capabilities = params.capabilities as string;
        if (params.description) fields.description = params.description as string;

        // `as any` — bundled SDK type mismatch (curvepoint vs top-level @bsv/sdk)
        const peerCert = new PeerCert(ctx.wallet.asWalletInterface() as any);
        const cert = await peerCert.issue({
          certificateType: AGID_CERT_TYPE,
          subjectIdentityKey: subject,
          fields,
          autoSend,
        });

        return ok({
          serialNumber: cert.serialNumber,
          subject: cert.subject,
          certifier: cert.certifier,
          revocationOutpoint: cert.revocationOutpoint,
          fields,
          autoSend,
        });
      },
    },

    // =========================================================================
    // 2. agid_cert_receive — Receive and store incoming certificates
    // =========================================================================
    {
      definition: {
        name: 'agid_cert_receive',
        description: 'Receive and store certificates issued to you. If a serialized certificate is provided, receives it directly. Otherwise checks PeerCert MessageBox for incoming certs.',
        input_schema: {
          type: 'object',
          properties: {
            serializedCertificate: { type: 'string', description: 'Serialized certificate string (if provided directly). If omitted, checks MessageBox for incoming certs.' },
          },
          required: [],
        },
      },
      requiresWallet: true,
      execute: async (params, ctx) => {
        const peerCert = new PeerCert(ctx.wallet.asWalletInterface() as any);

        // Direct receive
        if (params.serializedCertificate) {
          const result = await peerCert.receive(params.serializedCertificate as string);
          return ok({
            success: result.success,
            fields: result.walletCertificate?.fields,
            error: result.error,
          });
        }

        // Check PeerCert's MessageBox for incoming certificates
        const incoming = await peerCert.listIncomingCertificates();
        const received: Array<{ success: boolean; sender: string; issuance: boolean; fields?: Record<string, string>; error?: string }> = [];

        for (const cert of incoming) {
          try {
            if (cert.issuance) {
              const result = await peerCert.receive(cert.serializedCertificate);
              received.push({
                success: result.success,
                sender: cert.sender,
                issuance: true,
                fields: result.walletCertificate?.fields,
                error: result.error,
              });
              if (result.success) {
                await peerCert.acknowledgeCertificate(cert.messageId);
              }
            } else {
              // Shared for inspection — verify but don't store
              const result = await peerCert.verifyVerifiableCertificate(cert.serializedCertificate);
              received.push({
                success: result.verified,
                sender: cert.sender,
                issuance: false,
                fields: result.fields,
                error: result.error,
              });
              await peerCert.acknowledgeCertificate(cert.messageId);
            }
          } catch (err) {
            received.push({
              success: false,
              sender: cert.sender,
              issuance: cert.issuance,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }

        return ok({ received, count: received.length });
      },
    },

    // =========================================================================
    // 3. agid_cert_list — List certificates in wallet
    // =========================================================================
    {
      definition: {
        name: 'agid_cert_list',
        description: 'List certificates stored in your wallet. Can filter by certifier public key and/or certificate type.',
        input_schema: {
          type: 'object',
          properties: {
            certifier: { type: 'string', description: 'Filter by certifier public key (optional)' },
            type: { type: 'string', description: 'Filter by certificate type (optional, default: agidentity.identity)' },
          },
          required: [],
        },
      },
      requiresWallet: false,
      execute: async (params, ctx) => {
        const certifiers = params.certifier ? [params.certifier as string] : undefined;
        const types = params.type
          ? [params.type as string]
          : [AGID_CERT_TYPE];

        const result = await ctx.wallet.listCertificates({
          certifiers,
          types,
        });

        const certs = result.certificates.map(c => ({
          serialNumber: c.serialNumber,
          type: c.type,
          subject: c.subject,
          certifier: c.certifier,
          fields: c.fields,
          revocationOutpoint: c.revocationOutpoint,
        }));

        return ok({ certificates: certs, count: certs.length });
      },
    },

    // =========================================================================
    // 4. agid_cert_verify — Verify a serialized certificate
    // =========================================================================
    {
      definition: {
        name: 'agid_cert_verify',
        description: 'Verify a serialized certificate. For verifiable certificates (shared for inspection), decrypts the revealed fields. For raw certificates, validates structure.',
        input_schema: {
          type: 'object',
          properties: {
            serializedCertificate: { type: 'string', description: 'Serialized certificate JSON string to verify' },
            checkRevocation: { type: 'boolean', description: 'Also check on-chain revocation status (default: false)' },
          },
          required: ['serializedCertificate'],
        },
      },
      requiresWallet: false,
      execute: async (params, ctx) => {
        const serialized = params.serializedCertificate as string;
        const checkRevocation = params.checkRevocation === true;

        // Try verifiable certificate verification first
        try {
          const peerCert = new PeerCert(ctx.wallet.asWalletInterface() as any);
          const result = await peerCert.verifyVerifiableCertificate(serialized, { checkRevocation });
          return ok({
            verified: result.verified,
            fields: result.fields,
            revocationStatus: result.revocationStatus,
            error: result.error,
          });
        } catch {
          // Fall back to structural validation
          try {
            const parsed = JSON.parse(serialized);
            const hasRequiredFields = parsed.type && parsed.serialNumber && parsed.subject &&
              parsed.certifier && parsed.signature && parsed.fields;
            return ok({
              verified: false,
              structurallyValid: !!hasRequiredFields,
              type: parsed.type,
              subject: parsed.subject,
              certifier: parsed.certifier,
              fieldNames: Object.keys(parsed.fields || {}),
              note: 'Could not cryptographically verify — fields may be encrypted. Use agid_cert_receive to store and decrypt.',
            });
          } catch {
            return ok({ verified: false, error: 'Failed to parse certificate' });
          }
        }
      },
    },

    // =========================================================================
    // 5. agid_cert_revoke — Revoke a certificate you issued
    // =========================================================================
    {
      definition: {
        name: 'agid_cert_revoke',
        description: 'Revoke a certificate you previously issued by spending its DID revocation token on-chain. This is irreversible.',
        input_schema: {
          type: 'object',
          properties: {
            serialNumber: { type: 'string', description: 'Serial number of the certificate to revoke' },
            certifier: { type: 'string', description: 'Certifier public key (your key, to find the cert). Defaults to your identity key.' },
          },
          required: ['serialNumber'],
        },
      },
      requiresWallet: true,
      execute: async (params, ctx) => {
        const { publicKey: myKey } = await ctx.wallet.getPublicKey({ identityKey: true });
        const certifier = (params.certifier as string) || myKey;
        const serialNumber = params.serialNumber as string;

        const listResult = await ctx.wallet.listCertificates({
          certifiers: [certifier],
          types: [AGID_CERT_TYPE],
        });

        const cert = listResult.certificates.find(c => c.serialNumber === serialNumber);
        if (!cert) {
          return ok({ success: false, error: `Certificate ${serialNumber} not found` });
        }

        const peerCert = new PeerCert(ctx.wallet.asWalletInterface() as any);
        const result = await peerCert.revoke(cert as any);

        return ok({
          success: result.success,
          serialNumber,
          txid: result.txid,
          revocationOutpoint: result.revocationOutpoint,
          error: result.error,
        });
      },
    },

    // =========================================================================
    // 6. agid_cert_reveal — Publicly reveal certificate fields
    // =========================================================================
    {
      definition: {
        name: 'agid_cert_reveal',
        description: 'Publicly reveal selected fields of a certificate to the overlay network, making it discoverable by others.',
        input_schema: {
          type: 'object',
          properties: {
            serialNumber: { type: 'string', description: 'Serial number of the certificate to reveal' },
            fields: {
              type: 'array',
              items: { type: 'string' },
              description: 'Field names to publicly reveal (e.g. ["name", "role"])',
            },
          },
          required: ['serialNumber', 'fields'],
        },
      },
      requiresWallet: true,
      execute: async (params, ctx) => {
        const serialNumber = params.serialNumber as string;
        const fieldsToReveal = params.fields as string[];

        const listResult = await ctx.wallet.listCertificates({ types: [AGID_CERT_TYPE] });
        const cert = listResult.certificates.find(c => c.serialNumber === serialNumber);
        if (!cert) {
          return ok({ success: false, error: `Certificate ${serialNumber} not found` });
        }

        const peerCert = new PeerCert(ctx.wallet.asWalletInterface() as any);
        const result = await peerCert.reveal({
          certificate: cert as any,
          fieldsToReveal: fieldsToReveal as any[],
        });

        return ok({
          success: true,
          result,
        });
      },
    },

    // =========================================================================
    // 7. agid_cert_check_revocation — Check if a certificate is revoked
    // =========================================================================
    {
      definition: {
        name: 'agid_cert_check_revocation',
        description: 'Check whether a certificate has been revoked on-chain via its DID revocation outpoint.',
        input_schema: {
          type: 'object',
          properties: {
            serialNumber: { type: 'string', description: 'Serial number of the certificate' },
            certifier: { type: 'string', description: 'Certifier public key' },
          },
          required: ['serialNumber', 'certifier'],
        },
      },
      requiresWallet: false,
      execute: async (params, ctx) => {
        const serialNumber = params.serialNumber as string;
        const certifier = params.certifier as string;

        const listResult = await ctx.wallet.listCertificates({
          certifiers: [certifier],
          types: [AGID_CERT_TYPE],
        });

        const cert = listResult.certificates.find(c => c.serialNumber === serialNumber);
        if (!cert) {
          return ok({ found: false, error: `Certificate ${serialNumber} not found in wallet` });
        }

        const peerCert = new PeerCert(ctx.wallet.asWalletInterface() as any);
        const status = await peerCert.checkRevocation(cert as any);

        return ok({
          found: true,
          serialNumber: cert.serialNumber,
          certifier: cert.certifier,
          subject: cert.subject,
          isRevoked: status.isRevoked,
          revocationOutpoint: status.revocationOutpoint,
          message: status.message,
        });
      },
    },

    // =========================================================================
    // 8. agid_cert_send — Send/share a certificate via PeerCert MessageBox
    // =========================================================================
    {
      definition: {
        name: 'agid_cert_send',
        description: 'Send or share a certificate with another identity via PeerCert MessageBox.',
        input_schema: {
          type: 'object',
          properties: {
            serialNumber: { type: 'string', description: 'Serial number of the certificate to send' },
            recipient: { type: 'string', description: 'Recipient public key (33-byte hex)' },
            issuance: { type: 'boolean', description: 'Whether this is an issuance (true) or sharing for inspection (false). Default: true.' },
          },
          required: ['serialNumber', 'recipient'],
        },
      },
      requiresWallet: true,
      execute: async (params, ctx) => {
        const serialNumber = params.serialNumber as string;
        const recipient = params.recipient as string;
        const issuance = params.issuance !== false;

        const listResult = await ctx.wallet.listCertificates({ types: [AGID_CERT_TYPE] });
        const cert = listResult.certificates.find(c => c.serialNumber === serialNumber);
        if (!cert) {
          return ok({ success: false, error: `Certificate ${serialNumber} not found` });
        }

        const peerCert = new PeerCert(ctx.wallet.asWalletInterface() as any);
        await peerCert.send({
          recipient,
          serializedCertificate: JSON.stringify(cert),
          issuance,
        });

        return ok({
          success: true,
          serialNumber,
          recipient,
          issuance,
          sentFields: Object.keys(cert.fields),
        });
      },
    },
  ];
}
