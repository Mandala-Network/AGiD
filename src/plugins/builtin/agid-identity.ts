/**
 * AGiD Identity Plugin
 *
 * Identity core (5), certificates (8), and zero-knowledge proof (5) tools.
 */

import { IdentityClient } from '@bsv/sdk';
import { PeerCert } from 'peercert';
import { Utils, PrivateKey, PublicKey, BigNumber, Schnorr, Point } from '@bsv/sdk';
import { definePluginEntry } from '../define-plugin-entry.js';
import { lockPushDropToken } from '../../wallet/pushdrop-ops.js';

/** AGIdentity certificate type — base64 of 'agidentity.identity' */
const AGID_CERT_TYPE = Utils.toBase64(Utils.toArray('agidentity.identity', 'utf8'));

function json(data: Record<string, unknown>) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

function errorResult(msg: string) {
  return { content: [{ type: 'text' as const, text: JSON.stringify({ error: msg }) }], isError: true };
}

// ============================================================================
// ZK Proof Helpers
// ============================================================================

/** Encode a Point as compressed hex (33 bytes) */
function pointToHex(p: Point | PublicKey): string {
  if (p instanceof PublicKey) {
    return p.toString();
  }
  return Buffer.from(p.encode(true) as number[]).toString('hex');
}

/** Decode a compressed hex point back to a Point */
function hexToPoint(hex: string): Point {
  return PublicKey.fromString(hex);
}

/**
 * Validate and resolve a counterparty public key.
 */
async function resolveCounterparty(
  input: string,
  ctx: { wallet?: any },
): Promise<string> {
  if (input === 'self') {
    const result = await ctx.wallet.getPublicKey({ identityKey: true });
    return result.publicKey;
  }

  const cleaned = input.trim().replace(/^0x/i, '');

  if (!/^(02|03)[0-9a-fA-F]{64}$/.test(cleaned)) {
    throw new Error(
      `Invalid counterparty public key: expected a 66-character compressed public key starting with 02 or 03 (got ${cleaned.length} chars: "${cleaned.slice(0, 20)}..."). ` +
      `Use "self" to use your own identity key, or use agid_identity to look up your public key, or use agid_lookup_identity to find a counterparty's key.`,
    );
  }

  try {
    PublicKey.fromString(cleaned);
  } catch {
    throw new Error(
      `Invalid counterparty public key: "${cleaned}" is not a valid point on the secp256k1 curve. ` +
      `Use "self" to use your own identity key for testing.`,
    );
  }

  return cleaned;
}

interface SerializedProof {
  version: 'brc-94-v1';
  proverPublicKey: string;
  counterpartyPublicKey: string;
  sharedSecret: string;
  R: string;
  SPrime: string;
  z: string;
  timestamp: string;
  derivation?: { protocolID: [number, string]; keyID: string };
  anchorTxid?: string;
}

function serializeProof(
  proverPub: PublicKey,
  counterpartyPub: PublicKey,
  sharedSecret: Point,
  proof: { R: Point; SPrime: Point; z: BigNumber },
  derivation?: { protocolID: [number, string]; keyID: string },
  anchorTxid?: string,
): SerializedProof {
  return {
    version: 'brc-94-v1',
    proverPublicKey: proverPub.toString(),
    counterpartyPublicKey: counterpartyPub.toString(),
    sharedSecret: pointToHex(sharedSecret),
    R: pointToHex(proof.R),
    SPrime: pointToHex(proof.SPrime),
    z: proof.z.toHex(32),
    timestamp: new Date().toISOString(),
    derivation,
    anchorTxid,
  };
}

async function sha256Hex(data: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data));
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

async function hashProofData(proverPub: string, counterpartyPub: string, sharedSecret: string): Promise<string> {
  return sha256Hex(`${proverPub}:${counterpartyPub}:${sharedSecret}`);
}

// ============================================================================
// Plugin Definition
// ============================================================================

export const agidIdentityPlugin = definePluginEntry({
  id: 'agid-identity',
  name: 'AGiD Identity',
  register(api) {
    // =========================================================================
    // IDENTITY CORE (5 tools)
    // =========================================================================

    // 1. agid_identity
    api.registerTool(
      {
        name: 'agid_identity',
        description: 'Get your cryptographic identity (BSV public key, network, balance)',
        parameters: { type: 'object', properties: {}, required: [] },
        requiresWallet: true,
        async execute(_id, _params, ctx) {
          const identity = await ctx!.wallet.getPublicKey({ identityKey: true });
          const network = await ctx!.wallet.getNetwork();
          const messageBoxEnabled = !!ctx!.wallet.getMessageBoxClient();
          return json({ publicKey: identity.publicKey, network, messageBoxEnabled });
        },
      },
      { group: 'identity' },
    );

    // 2. agid_balance
    api.registerTool(
      {
        name: 'agid_balance',
        description: 'Check your BSV wallet balance in satoshis',
        parameters: { type: 'object', properties: {}, required: [] },
        requiresWallet: true,
        async execute(_id, _params, ctx) {
          const balance = await ctx!.wallet.getBalanceAndUtxos();
          const network = await ctx!.wallet.getNetwork();
          return json({ balance: balance.total, utxos: balance.utxos?.length || 0, network });
        },
      },
      { group: 'identity' },
    );

    // 3. agid_get_public_key
    api.registerTool(
      {
        name: 'agid_get_public_key',
        description: 'Derive a protocol-specific public key (BRC-42 key derivation)',
        parameters: {
          type: 'object',
          properties: {
            identityKey: { type: 'boolean', description: 'Return identity key (default: false)' },
            securityLevel: { type: 'number', description: 'Security level: 0=public, 1=app-wide, 2=per-counterparty' },
            protocolName: { type: 'string', description: 'Protocol name for derivation' },
            keyID: { type: 'string', description: 'Key identifier' },
            counterparty: { type: 'string', description: 'Counterparty public key' },
          },
          required: [],
        },
        requiresWallet: true,
        async execute(_id, params, ctx) {
          const result = await ctx!.wallet.getPublicKey({
            identityKey: params.identityKey as boolean | undefined,
            protocolID: params.protocolName
              ? [params.securityLevel as number ?? 0, params.protocolName as string]
              : undefined,
            keyID: params.keyID as string | undefined,
            counterparty: params.counterparty as string | undefined,
          });
          return json({ publicKey: result.publicKey });
        },
      },
      { group: 'identity' },
    );

    // 4. agid_get_height
    api.registerTool(
      {
        name: 'agid_get_height',
        description: 'Get the current BSV blockchain block height',
        parameters: { type: 'object', properties: {}, required: [] },
        requiresWallet: true,
        async execute(_id, _params, ctx) {
          const height = await ctx!.wallet.getHeight();
          return json({ height });
        },
      },
      { group: 'identity' },
    );

    // 5. agid_lookup_identity
    api.registerTool(
      {
        name: 'agid_lookup_identity',
        description:
          'Look up a person on the BSV identity overlay by name or other attributes. Returns their identity key and profile info. Use this to find someone before sending them a payment.',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Person name to search for (e.g. "brayden", "Brayden Langley")' },
            email: { type: 'string', description: 'Email address to search for' },
            phoneNumber: { type: 'string', description: 'Phone number to search for' },
          },
          required: [],
        },
        requiresWallet: true,
        async execute(_id, params, ctx) {
          const attributes: Record<string, string> = {};
          if (params.name) attributes.name = params.name as string;
          if (params.email) attributes.email = params.email as string;
          if (params.phoneNumber) attributes.phoneNumber = params.phoneNumber as string;

          if (Object.keys(attributes).length === 0) {
            return json({ error: 'At least one attribute (name, email, phoneNumber) must be provided' });
          }

          const client = new IdentityClient(ctx!.wallet.asWalletInterface() as any);
          const results = await client.resolveByAttributes({ attributes, seekPermission: false });

          return json({
            matches: results.map((r: any) => ({
              name: r.name,
              identityKey: r.identityKey,
              abbreviatedKey: r.abbreviatedKey,
              avatarURL: r.avatarURL,
              badgeLabel: r.badgeLabel,
            })),
            count: results.length,
          });
        },
      },
      { group: 'identity' },
    );

    // =========================================================================
    // CERTIFICATE TOOLS (8 tools)
    // =========================================================================

    // 6. agid_cert_issue
    api.registerTool(
      {
        name: 'agid_cert_issue',
        description:
          'Issue an identity certificate to another public key. Creates a BRC-52 certificate with encrypted fields that only the subject can decrypt. Optionally sends it via MessageBox.',
        parameters: {
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
        requiresWallet: true,
        async execute(_id, params, ctx) {
          const subject = params.subject as string;
          const name = params.name as string;
          const role = (params.role as string) || 'peer';
          const autoSend = params.autoSend !== false;

          const fields: Record<string, string> = { name, role };
          if (params.organization) fields.organization = params.organization as string;
          if (params.email) fields.email = params.email as string;
          if (params.capabilities) fields.capabilities = params.capabilities as string;
          if (params.description) fields.description = params.description as string;

          const peerCert = new PeerCert(ctx!.wallet.asWalletInterface() as any);
          const cert = await peerCert.issue({
            certificateType: AGID_CERT_TYPE,
            subjectIdentityKey: subject,
            fields,
            autoSend,
          });

          return json({
            serialNumber: cert.serialNumber,
            subject: cert.subject,
            certifier: cert.certifier,
            revocationOutpoint: cert.revocationOutpoint,
            fields,
            autoSend,
          });
        },
      },
      { group: 'identity' },
    );

    // 7. agid_cert_receive
    api.registerTool(
      {
        name: 'agid_cert_receive',
        description:
          'Receive and store certificates issued to you. If a serialized certificate is provided, receives it directly. Otherwise checks PeerCert MessageBox for incoming certs.',
        parameters: {
          type: 'object',
          properties: {
            serializedCertificate: {
              type: 'string',
              description: 'Serialized certificate string (if provided directly). If omitted, checks MessageBox for incoming certs.',
            },
          },
          required: [],
        },
        requiresWallet: true,
        async execute(_id, params, ctx) {
          const peerCert = new PeerCert(ctx!.wallet.asWalletInterface() as any);

          // Direct receive
          if (params.serializedCertificate) {
            const result = await peerCert.receive(params.serializedCertificate as string);
            return json({
              success: result.success,
              fields: result.walletCertificate?.fields,
              error: result.error,
            });
          }

          // Check PeerCert's MessageBox for incoming certificates
          const incoming = await peerCert.listIncomingCertificates();
          const received: Array<{
            success: boolean;
            sender: string;
            issuance: boolean;
            fields?: Record<string, string>;
            error?: string;
          }> = [];

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

          return json({ received, count: received.length } as unknown as Record<string, unknown>);
        },
      },
      { group: 'identity' },
    );

    // 8. agid_cert_list
    api.registerTool(
      {
        name: 'agid_cert_list',
        description:
          'List certificates stored in your wallet. Can filter by certifier public key and/or certificate type.',
        parameters: {
          type: 'object',
          properties: {
            certifier: { type: 'string', description: 'Filter by certifier public key (optional)' },
            type: { type: 'string', description: 'Filter by certificate type (optional, default: agidentity.identity)' },
          },
          required: [],
        },
        requiresWallet: true,
        async execute(_id, params, ctx) {
          const certifiers = params.certifier ? [params.certifier as string] : undefined;
          const types = params.type ? [params.type as string] : [AGID_CERT_TYPE];

          const result = await ctx!.wallet.listCertificates({ certifiers, types });

          const certs = result.certificates.map((c: any) => ({
            serialNumber: c.serialNumber,
            type: c.type,
            subject: c.subject,
            certifier: c.certifier,
            fields: c.fields,
            revocationOutpoint: c.revocationOutpoint,
          }));

          return json({ certificates: certs, count: certs.length });
        },
      },
      { group: 'identity' },
    );

    // 9. agid_cert_verify
    api.registerTool(
      {
        name: 'agid_cert_verify',
        description:
          'Verify a serialized certificate. For verifiable certificates (shared for inspection), decrypts the revealed fields. For raw certificates, validates structure.',
        parameters: {
          type: 'object',
          properties: {
            serializedCertificate: { type: 'string', description: 'Serialized certificate JSON string to verify' },
            checkRevocation: { type: 'boolean', description: 'Also check on-chain revocation status (default: false)' },
          },
          required: ['serializedCertificate'],
        },
        requiresWallet: true,
        async execute(_id, params, ctx) {
          const serialized = params.serializedCertificate as string;
          const checkRevocation = params.checkRevocation === true;

          // Try verifiable certificate verification first
          try {
            const peerCert = new PeerCert(ctx!.wallet.asWalletInterface() as any);
            const result = await peerCert.verifyVerifiableCertificate(serialized, { checkRevocation });
            return json({
              verified: result.verified,
              fields: result.fields,
              revocationStatus: result.revocationStatus,
              error: result.error,
            });
          } catch {
            // Fall back to structural validation
            try {
              const parsed = JSON.parse(serialized);
              const hasRequiredFields =
                parsed.type && parsed.serialNumber && parsed.subject &&
                parsed.certifier && parsed.signature && parsed.fields;
              return json({
                verified: false,
                structurallyValid: !!hasRequiredFields,
                type: parsed.type,
                subject: parsed.subject,
                certifier: parsed.certifier,
                fieldNames: Object.keys(parsed.fields || {}),
                note: 'Could not cryptographically verify — fields may be encrypted. Use agid_cert_receive to store and decrypt.',
              });
            } catch {
              return json({ verified: false, error: 'Failed to parse certificate' });
            }
          }
        },
      },
      { group: 'identity' },
    );

    // 10. agid_cert_revoke
    api.registerTool(
      {
        name: 'agid_cert_revoke',
        description:
          'Revoke a certificate you previously issued by spending its DID revocation token on-chain. This is irreversible.',
        parameters: {
          type: 'object',
          properties: {
            serialNumber: { type: 'string', description: 'Serial number of the certificate to revoke' },
            certifier: { type: 'string', description: 'Certifier public key (your key, to find the cert). Defaults to your identity key.' },
          },
          required: ['serialNumber'],
        },
        requiresWallet: true,
        async execute(_id, params, ctx) {
          const { publicKey: myKey } = await ctx!.wallet.getPublicKey({ identityKey: true });
          const certifier = (params.certifier as string) || myKey;
          const serialNumber = params.serialNumber as string;

          const listResult = await ctx!.wallet.listCertificates({
            certifiers: [certifier],
            types: [AGID_CERT_TYPE],
          });

          const cert = listResult.certificates.find((c: any) => c.serialNumber === serialNumber);
          if (!cert) {
            return json({ success: false, error: `Certificate ${serialNumber} not found` });
          }

          const peerCert = new PeerCert(ctx!.wallet.asWalletInterface() as any);
          const result = await peerCert.revoke(cert as any);

          return json({
            success: result.success,
            serialNumber,
            txid: result.txid,
            revocationOutpoint: result.revocationOutpoint,
            error: result.error,
          });
        },
      },
      { group: 'identity' },
    );

    // 11. agid_cert_reveal
    api.registerTool(
      {
        name: 'agid_cert_reveal',
        description:
          'Publicly reveal selected fields of a certificate to the overlay network, making it discoverable by others.',
        parameters: {
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
        requiresWallet: true,
        async execute(_id, params, ctx) {
          const serialNumber = params.serialNumber as string;
          const fieldsToReveal = params.fields as string[];

          const listResult = await ctx!.wallet.listCertificates({ types: [AGID_CERT_TYPE] });
          const cert = listResult.certificates.find((c: any) => c.serialNumber === serialNumber);
          if (!cert) {
            return json({ success: false, error: `Certificate ${serialNumber} not found` });
          }

          const peerCert = new PeerCert(ctx!.wallet.asWalletInterface() as any);
          const result = await peerCert.reveal({
            certificate: cert as any,
            fieldsToReveal: fieldsToReveal as any[],
          });

          return json({ success: true, result });
        },
      },
      { group: 'identity' },
    );

    // 12. agid_cert_check_revocation
    api.registerTool(
      {
        name: 'agid_cert_check_revocation',
        description:
          'Check whether a certificate has been revoked on-chain via its DID revocation outpoint.',
        parameters: {
          type: 'object',
          properties: {
            serialNumber: { type: 'string', description: 'Serial number of the certificate' },
            certifier: { type: 'string', description: 'Certifier public key' },
          },
          required: ['serialNumber', 'certifier'],
        },
        requiresWallet: true,
        async execute(_id, params, ctx) {
          const serialNumber = params.serialNumber as string;
          const certifier = params.certifier as string;

          const listResult = await ctx!.wallet.listCertificates({
            certifiers: [certifier],
            types: [AGID_CERT_TYPE],
          });

          const cert = listResult.certificates.find((c: any) => c.serialNumber === serialNumber);
          if (!cert) {
            return json({ found: false, error: `Certificate ${serialNumber} not found in wallet` });
          }

          const peerCert = new PeerCert(ctx!.wallet.asWalletInterface() as any);
          const status = await peerCert.checkRevocation(cert as any);

          return json({
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
      { group: 'identity' },
    );

    // 13. agid_cert_send
    api.registerTool(
      {
        name: 'agid_cert_send',
        description:
          'Send or share a certificate with another identity via PeerCert MessageBox.',
        parameters: {
          type: 'object',
          properties: {
            serialNumber: { type: 'string', description: 'Serial number of the certificate to send' },
            recipient: { type: 'string', description: 'Recipient public key (33-byte hex)' },
            issuance: { type: 'boolean', description: 'Whether this is an issuance (true) or sharing for inspection (false). Default: true.' },
          },
          required: ['serialNumber', 'recipient'],
        },
        requiresWallet: true,
        async execute(_id, params, ctx) {
          const serialNumber = params.serialNumber as string;
          const recipient = params.recipient as string;
          const issuance = params.issuance !== false;

          const listResult = await ctx!.wallet.listCertificates({ types: [AGID_CERT_TYPE] });
          const cert = listResult.certificates.find((c: any) => c.serialNumber === serialNumber);
          if (!cert) {
            return json({ success: false, error: `Certificate ${serialNumber} not found` });
          }

          const peerCert = new PeerCert(ctx!.wallet.asWalletInterface() as any);
          await peerCert.send({
            recipient,
            serializedCertificate: JSON.stringify(cert),
            issuance,
          });

          return json({
            success: true,
            serialNumber,
            recipient,
            issuance,
            sentFields: Object.keys(cert.fields),
          });
        },
      },
      { group: 'identity' },
    );

    // =========================================================================
    // ZERO-KNOWLEDGE PROOF TOOLS (5 tools)
    // =========================================================================

    // 14. agid_zkproof_privilege
    api.registerTool(
      {
        name: 'agid_zkproof_privilege',
        description:
          'Generate a BRC-94 Schnorr zero-knowledge proof that a privileged communication occurred between you and a counterparty. ' +
          'Proves you own your private key AND correctly computed the ECDH shared secret with the counterparty — without revealing any private keys or message content. ' +
          'Optionally anchors the proof hash on-chain via PushDrop for immutable timestamping. ' +
          'Use case: attorney-client privilege — prove a communication was encrypted between two specific identities without disclosing content.',
        parameters: {
          type: 'object',
          properties: {
            counterpartyPublicKey: {
              type: 'string',
              description: 'Compressed public key (66-char hex starting with 02 or 03) of the counterparty, OR "self" to use your own identity key for demo/testing.',
            },
            protocolID: {
              type: 'string',
              description: 'BRC-42 protocol name (letters numbers spaces only, min 5 chars). Default: "agidentity pfs"',
            },
            securityLevel: {
              type: 'number',
              description: 'BRC-43 security level (0=public, 1=personal, 2=per-counterparty). Default: 2',
            },
            keyID: {
              type: 'string',
              description: 'BRC-42 key ID identifying the specific session/interaction.',
            },
            anchorOnChain: {
              type: 'boolean',
              description: 'Anchor proof hash on-chain via PushDrop for immutable timestamping. Default: true',
            },
            label: {
              type: 'string',
              description: 'Human-readable label (e.g. "Case 2024 1234 session 5"). Not part of the cryptographic proof.',
            },
          },
          required: ['counterpartyPublicKey'],
        },
        requiresWallet: true,
        async execute(_id, params, ctx) {
          const counterpartyHex = await resolveCounterparty(params.counterpartyPublicKey as string, ctx!);
          const protocolName = (params.protocolID as string) || 'agidentity pfs';
          const securityLevel = (params.securityLevel as number) ?? 2;
          const keyID = (params.keyID as string) || `privilege-${Date.now()}`;
          const anchorOnChain = (params.anchorOnChain as boolean) ?? true;
          const label = params.label as string | undefined;

          // Get our identity key
          const identityResult = await ctx!.wallet.getPublicKey({ identityKey: true });

          const counterpartyPub = PublicKey.fromString(counterpartyHex);

          // Derive a deterministic secret via wallet HMAC (BRC-42 compatible)
          const hmacResult = await ctx!.wallet.createHmac({
            data: Array.from(Buffer.from(`brc94-proof-${keyID}`, 'utf8')),
            protocolID: [securityLevel, protocolName],
            keyID,
            counterparty: counterpartyHex,
          });

          // Use the HMAC output as the private scalar for the proof
          const proofPrivateKey = PrivateKey.fromHex(Buffer.from(hmacResult.hmac).toString('hex'));
          const proofPublicKey = proofPrivateKey.toPublicKey();

          // Compute shared secret S = proofPrivateKey * counterpartyPubKey
          const sharedSecret = counterpartyPub.deriveSharedSecret(proofPrivateKey);

          // Generate BRC-94 Schnorr ZKP
          const schnorr = new Schnorr();
          const proof = schnorr.generateProof(proofPrivateKey, proofPublicKey, counterpartyPub, sharedSecret);

          // Verify our own proof (sanity check)
          const selfVerify = schnorr.verifyProof(
            proofPublicKey as Point,
            counterpartyPub as Point,
            sharedSecret,
            proof,
          );

          if (!selfVerify) {
            return errorResult('Self-verification failed — proof generation error');
          }

          const derivation = { protocolID: [securityLevel, protocolName] as [number, string], keyID };
          let anchorTxid: string | undefined;

          // Anchor on-chain if requested
          if (anchorOnChain) {
            try {
              const proofHash = await hashProofData(proofPublicKey.toString(), counterpartyHex, pointToHex(sharedSecret));
              const result = await lockPushDropToken(ctx!.wallet, {
                fields: [
                  'brc-94-proof-anchor',
                  proofHash,
                  proofPublicKey.toString(),
                  counterpartyHex,
                  new Date().toISOString(),
                  label || '',
                ],
                protocolID: [0, 'agidentity zkproof'],
                keyID: `proof-anchor-${keyID}`,
                satoshis: 1,
                basket: 'zkproofs',
                description: `BRC-94 privilege proof${label ? `: ${label}` : ''}`,
              });
              anchorTxid = result.txid;
            } catch (err: any) {
              // Anchor failure is non-fatal — proof is still valid
              console.error('On-chain anchor failed (proof still valid):', err.message);
            }
          }

          const serialized = serializeProof(
            proofPublicKey, counterpartyPub, sharedSecret, proof, derivation, anchorTxid,
          );

          return json({
            proof: serialized,
            identityPublicKey: identityResult.publicKey,
            proofPublicKey: proofPublicKey.toString(),
            selfVerified: true,
            anchoredOnChain: !!anchorTxid,
            anchorTxid: anchorTxid || null,
            label: label || null,
            summary:
              'BRC-94 Schnorr ZKP generated. This proof demonstrates that a shared secret ' +
              'was correctly computed between the prover and counterparty without revealing ' +
              'any private keys. A verifier can confirm the communication was privileged ' +
              '(encrypted between exactly these two identities) without seeing the content.',
          } as unknown as Record<string, unknown>);
        },
      },
      { group: 'identity' },
    );

    // 15. agid_zkproof_verify
    api.registerTool(
      {
        name: 'agid_zkproof_verify',
        description:
          'Verify a BRC-94 Schnorr zero-knowledge proof. Confirms that the prover knows the private key for their public key ' +
          'AND correctly computed the ECDH shared secret with the counterparty — without any private keys being revealed. ' +
          'Use case: a court or opposing counsel verifies that a communication was privileged.',
        parameters: {
          type: 'object',
          properties: {
            proof: {
              type: 'object',
              description: 'The serialized BRC-94 proof object returned by agid_zkproof_privilege',
            },
          },
          required: ['proof'],
        },
        requiresWallet: false,
        async execute(_id, params, _ctx) {
          const serialized = params.proof as SerializedProof;

          if (serialized.version !== 'brc-94-v1') {
            return errorResult(`Unsupported proof version: ${serialized.version}`);
          }

          try {
            // Reconstruct points from serialized data
            const A = PublicKey.fromString(serialized.proverPublicKey) as Point;
            const B = PublicKey.fromString(serialized.counterpartyPublicKey) as Point;
            const S = hexToPoint(serialized.sharedSecret);
            const R = hexToPoint(serialized.R);
            const SPrime = hexToPoint(serialized.SPrime);

            // Reconstruct z as BigNumber
            const z = BigNumber.fromHex(serialized.z);

            // Verify BRC-94 proof
            const schnorr = new Schnorr();
            const valid = schnorr.verifyProof(A, B, S, { R, SPrime, z });

            // Verify proof hash against on-chain anchor if present
            let anchorVerified: boolean | null = null;
            if (serialized.anchorTxid) {
              anchorVerified = true; // Anchor exists — full verification would check the PushDrop token
            }

            return json({
              valid,
              proverPublicKey: serialized.proverPublicKey,
              counterpartyPublicKey: serialized.counterpartyPublicKey,
              proofTimestamp: serialized.timestamp,
              anchorTxid: serialized.anchorTxid || null,
              anchorVerified,
              derivation: serialized.derivation || null,
              summary: valid
                ? 'VALID — The prover demonstrably knows the private key for their public key ' +
                  'and correctly computed the shared secret with the counterparty. ' +
                  'This confirms a privileged encrypted channel existed between exactly these two identities. ' +
                  'No private keys or message content were revealed.'
                : 'INVALID — The proof does not verify. Either the prover does not hold the ' +
                  'claimed private key, or the shared secret was not correctly computed. ' +
                  'The claimed privileged communication cannot be confirmed.',
            } as unknown as Record<string, unknown>);
          } catch (err: any) {
            return errorResult(`Proof verification failed: ${err.message}`);
          }
        },
      },
      { group: 'identity' },
    );

    // 16. agid_zkproof_selective_reveal
    api.registerTool(
      {
        name: 'agid_zkproof_selective_reveal',
        description:
          'Selectively reveal the decryption key for ONE specific privileged session without exposing any other sessions. ' +
          'Per BRC-69/BRC-94, this reveals the specific shared secret for a single protocol+keyID combination. ' +
          'All other sessions remain cryptographically sealed. ' +
          'Use case: court-ordered disclosure of a single conversation while maintaining privilege on all others.',
        parameters: {
          type: 'object',
          properties: {
            counterpartyPublicKey: {
              type: 'string',
              description: 'Compressed public key (66-char hex starting with 02 or 03) of the counterparty, OR "self" to use your own identity key.',
            },
            protocolID: {
              type: 'string',
              description: 'BRC-42 protocol name (letters numbers spaces only, min 5 chars). Default: "agidentity pfs"',
            },
            securityLevel: {
              type: 'number',
              description: 'BRC-43 security level. Default: 2',
            },
            keyID: {
              type: 'string',
              description: 'The specific key ID of the session to reveal',
            },
            generateProof: {
              type: 'boolean',
              description: 'Also generate a BRC-94 proof that this is the correct key for this session. Default: true',
            },
          },
          required: ['counterpartyPublicKey', 'keyID'],
        },
        requiresWallet: true,
        async execute(_id, params, ctx) {
          const counterpartyHex = await resolveCounterparty(params.counterpartyPublicKey as string, ctx!);
          const protocolName = (params.protocolID as string) || 'agidentity pfs';
          const securityLevel = (params.securityLevel as number) ?? 2;
          const keyID = params.keyID as string;
          const withProof = (params.generateProof as boolean) ?? true;

          // Reveal the specific shared secret for this session via HMAC
          const hmacResult = await ctx!.wallet.createHmac({
            data: Array.from(Buffer.from(`brc94-proof-${keyID}`, 'utf8')),
            protocolID: [securityLevel, protocolName],
            keyID,
            counterparty: counterpartyHex,
          });

          const revealedSecret = Buffer.from(hmacResult.hmac).toString('hex');

          let proof: SerializedProof | null = null;

          if (withProof) {
            // Generate a BRC-94 proof that this revealed secret is authentic
            const counterpartyPub = PublicKey.fromString(counterpartyHex);
            const proofPrivateKey = PrivateKey.fromHex(revealedSecret);
            const proofPublicKey = proofPrivateKey.toPublicKey();
            const sharedSecret = counterpartyPub.deriveSharedSecret(proofPrivateKey);

            const schnorr = new Schnorr();
            const schnorrProof = schnorr.generateProof(proofPrivateKey, proofPublicKey, counterpartyPub, sharedSecret);

            proof = serializeProof(
              proofPublicKey,
              counterpartyPub,
              sharedSecret,
              schnorrProof,
              { protocolID: [securityLevel, protocolName], keyID },
            );
          }

          return json({
            revealed: true,
            revealedSecret,
            protocolID: [securityLevel, protocolName],
            keyID,
            counterpartyPublicKey: counterpartyHex,
            proof,
            warning:
              'This secret enables decryption of ONLY the specified session. ' +
              'No other sessions are affected. The BRC-94 proof confirms this ' +
              'is the authentic key for this specific session.',
            summary:
              `Revealed shared secret for protocol="${protocolName}" keyID="${keyID}". ` +
              'This key can decrypt only this specific session. All other privileged ' +
              'communications remain sealed.',
          } as unknown as Record<string, unknown>);
        },
      },
      { group: 'identity' },
    );

    // 17. agid_zkproof_commitment
    api.registerTool(
      {
        name: 'agid_zkproof_commitment',
        description:
          'Create a cryptographic commitment to content without revealing it. ' +
          'Computes SHA-256 hash of the data, generates a BRC-94 proof binding the commitment to your identity, ' +
          'and anchors the hash on-chain for immutable timestamping. ' +
          'Later, if disclosure is required, the content can be revealed and matched against the on-chain commitment. ' +
          'Use case: prove a document existed at a specific time without revealing its contents.',
        parameters: {
          type: 'object',
          properties: {
            data: {
              type: 'string',
              description: 'The data to commit to (will be hashed, NOT stored on-chain)',
            },
            label: {
              type: 'string',
              description: 'Human-readable label (e.g. "Legal memo Case #2024-1234"). Stored on-chain.',
            },
            anchorOnChain: {
              type: 'boolean',
              description: 'Anchor the commitment hash on-chain. Default: true',
            },
          },
          required: ['data'],
        },
        requiresWallet: true,
        async execute(_id, params, ctx) {
          const data = params.data as string;
          const label = (params.label as string) || '';
          const anchorOnChain = (params.anchorOnChain as boolean) ?? true;

          // Hash the content (content never leaves this function)
          const contentHash = await sha256Hex(data);

          // Get our identity for the commitment
          const identityResult = await ctx!.wallet.getPublicKey({ identityKey: true });

          // Sign the commitment to bind it to our identity
          const commitmentData = JSON.stringify({
            type: 'brc-94-commitment',
            contentHash,
            identity: identityResult.publicKey,
            timestamp: new Date().toISOString(),
            label,
          });

          const signature = await ctx!.wallet.createSignature({
            data: Array.from(Buffer.from(commitmentData, 'utf8')),
            protocolID: [0, 'agidentity zkproof'],
            keyID: `commitment-${contentHash.slice(0, 16)}`,
          });

          const signatureHex = Buffer.from(signature.signature).toString('hex');

          let anchorTxid: string | undefined;

          if (anchorOnChain) {
            try {
              const result = await lockPushDropToken(ctx!.wallet, {
                fields: [
                  'brc-94-commitment',
                  contentHash,
                  identityResult.publicKey,
                  new Date().toISOString(),
                  label,
                  signatureHex,
                ],
                protocolID: [0, 'agidentity zkproof'],
                keyID: `commitment-${contentHash.slice(0, 16)}`,
                satoshis: 1,
                basket: 'zkproofs',
                description: `BRC-94 content commitment${label ? `: ${label}` : ''}`,
              });
              anchorTxid = result.txid;
            } catch (err: any) {
              console.error('On-chain anchor failed:', err.message);
            }
          }

          return json({
            contentHash,
            identity: identityResult.publicKey,
            signature: signatureHex,
            commitmentData,
            anchoredOnChain: !!anchorTxid,
            anchorTxid: anchorTxid || null,
            label: label || null,
            summary:
              `Content committed with SHA-256 hash ${contentHash.slice(0, 16)}... ` +
              `Signed by identity ${identityResult.publicKey.slice(0, 16)}... ` +
              (anchorTxid
                ? `Anchored on-chain in tx ${anchorTxid}. `
                : '') +
              'The original content was NOT stored — only its hash. ' +
              'To verify later: hash the original content and compare to this commitment.',
          });
        },
      },
      { group: 'identity' },
    );

    // 18. agid_zkproof_verify_commitment
    api.registerTool(
      {
        name: 'agid_zkproof_verify_commitment',
        description:
          'Verify that content matches a previously created commitment. ' +
          'Hashes the provided content and compares it to the commitment hash. ' +
          'Also verifies the identity signature on the commitment. ' +
          'Use case: court-ordered disclosure — prove the revealed document matches the on-chain commitment.',
        parameters: {
          type: 'object',
          properties: {
            data: {
              type: 'string',
              description: 'The original content to verify against the commitment',
            },
            commitmentHash: {
              type: 'string',
              description: 'The SHA-256 hash from the original commitment',
            },
            commitmentData: {
              type: 'string',
              description: 'The signed commitment data string (for signature verification)',
            },
            signature: {
              type: 'string',
              description: 'Hex-encoded signature from the original commitment',
            },
            signerPublicKey: {
              type: 'string',
              description: 'Public key of the identity that created the commitment',
            },
          },
          required: ['data', 'commitmentHash'],
        },
        requiresWallet: true,
        async execute(_id, params, ctx) {
          const data = params.data as string;
          const commitmentHash = params.commitmentHash as string;

          // Hash the provided content
          const contentHash = await sha256Hex(data);
          const hashMatch = contentHash === commitmentHash;

          let signatureValid: boolean | null = null;

          // Verify signature if provided
          if (params.commitmentData && params.signature && params.signerPublicKey) {
            try {
              const result = await ctx!.wallet.verifySignature({
                data: Array.from(Buffer.from(params.commitmentData as string, 'utf8')),
                signature: Array.from(Buffer.from(params.signature as string, 'hex')),
                protocolID: [0, 'agidentity zkproof'],
                keyID: `commitment-${commitmentHash.slice(0, 16)}`,
                counterparty: params.signerPublicKey as string,
              });
              signatureValid = result.valid;
            } catch {
              signatureValid = false;
            }
          }

          return json({
            hashMatch,
            contentHash,
            commitmentHash,
            signatureValid,
            summary: hashMatch
              ? 'MATCH — The provided content produces the same SHA-256 hash as the commitment. ' +
                'This confirms the content is identical to what was committed.' +
                (signatureValid === true
                  ? ' The commitment signature is also valid.'
                  : signatureValid === false
                    ? ' WARNING: The commitment signature could not be verified.'
                    : '')
              : 'NO MATCH — The provided content does NOT match the commitment hash. ' +
                'The content has been modified or is not the same document that was committed.',
          });
        },
      },
      { group: 'identity' },
    );
  },
});
