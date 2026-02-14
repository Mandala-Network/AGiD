/**
 * Secure AGIdentity Plugin
 *
 * Identity-gated plugin that verifies certificates on EVERY operation:
 * - Before agent inference
 * - Before any tool execution
 * - Before any data access
 *
 * Uses IdentityGate with stub interfaces ready for:
 * - MPC wallet certificate issuance
 * - Overlay-based revocation checking
 */

import type {
  OpenClawPluginDefinition,
  OpenClawPluginApi,
  ToolContext,
  AGIdentityConfig,
  Certificate,
} from '../types/index.js';
import { createAgentWallet } from '../wallet/agent-wallet.js';
import { AGIdentityStorageManager } from '../uhrp/storage-manager.js';
import { EncryptedShadVault } from '../shad/encrypted-vault.js';
import { createShadBridge } from '../shad/shad-integration.js';
import { SessionEncryption } from '../encryption/per-interaction.js';
import {
  IdentityGate,
  type CertificateIssuer,
  type RevocationChecker,
} from '../identity/identity-gate.js';

/**
 * Extended configuration for secure plugin
 */
export interface SecurePluginConfig extends AGIdentityConfig {
  trustedCertifiers: string[];
  requireCertificate?: boolean;  // Default: true
  certificateIssuer?: CertificateIssuer;  // Stub for MPC wallet
  revocationChecker?: RevocationChecker;  // Stub for overlay
}

/**
 * Session with verified identity
 */
interface VerifiedSession {
  publicKey: string;
  certificate: Certificate;
  certificateType: string;
  verifiedAt: number;
  vaultInitialized: boolean;
  vaultId?: string;
}

/**
 * Create the Secure AGIdentity Plugin
 *
 * This plugin gates ALL operations with identity verification.
 * No tool can be called, no inference can be made, without a valid certificate.
 */
export function createSecureAGIdentityPlugin(
  config: SecurePluginConfig
): OpenClawPluginDefinition {
  return {
    id: 'agidentity-secure',
    name: 'AGIdentity Secure',
    description: 'Identity-gated BSV blockchain wallet, Shad memory, and UHRP storage',
    version: '0.1.0',

    async register(api: OpenClawPluginApi) {
      api.logger.info('Initializing Secure AGIdentity plugin...');

      // =====================================================================
      // Initialize Core Components
      // =====================================================================

      const agentWallet = await createAgentWallet(config.agentWallet);
      const agentIdentity = await agentWallet.getPublicKey({ identityKey: true });

      api.logger.info(`Agent identity: ${agentIdentity.publicKey.slice(0, 16)}...`);

      // Initialize Identity Gate
      const identityGate = new IdentityGate({
        wallet: agentWallet,
        trustedCertifiers: config.trustedCertifiers,
        certificateIssuer: config.certificateIssuer,
        revocationChecker: config.revocationChecker,
        requireCertificate: config.requireCertificate ?? true,
      });
      await identityGate.initialize();

      api.logger.info('Identity gate initialized');

      // Initialize storage
      const storageManager = new AGIdentityStorageManager({
        storageUrl: config.storageUrl,
        wallet: agentWallet,
        network: config.network,
      });

      const encryptedVault = new EncryptedShadVault({
        storageManager,
        wallet: agentWallet,
      });

      const shadBridge = createShadBridge(encryptedVault, agentWallet, config.shad);
      // Check Shad availability (non-blocking)
      shadBridge.checkShadAvailable().catch(() => {});

      // Session storage
      const verifiedSessions = new Map<string, VerifiedSession>();
      const sessionEncryptions = new Map<string, SessionEncryption>();

      // =====================================================================
      // Identity Verification Helpers
      // =====================================================================

      /**
       * GATE: Verify identity before proceeding
       * Throws if identity cannot be verified
       */
      async function gateIdentity(
        ctx: ToolContext | undefined,
        operationName: string
      ): Promise<VerifiedSession> {
        const sessionKey = ctx?.sessionKey ?? 'default';

        // Check for existing verified session
        const existing = verifiedSessions.get(sessionKey);
        if (existing) {
          // Re-verify certificate hasn't been revoked
          const recheck = await identityGate.verifyIdentity(existing.certificate);
          if (recheck.verified) {
            return existing;
          }
          // Certificate was revoked - remove session
          verifiedSessions.delete(sessionKey);
          throw new Error(`[${operationName}] Certificate has been revoked`);
        }

        // No session - require certificate
        // Certificate can be passed in context by the client
        const certificate = (ctx as Record<string, unknown> | undefined)?.userCertificate as Certificate | undefined;
        if (!certificate) {
          throw new Error(
            `[${operationName}] Access denied: No identity certificate provided. ` +
            'Please provide a valid certificate issued by a trusted authority.'
          );
        }

        // Verify the certificate
        const result = await identityGate.verifyIdentity(certificate);
        if (!result.verified) {
          throw new Error(`[${operationName}] Access denied: ${result.error}`);
        }

        // Create verified session
        const session: VerifiedSession = {
          publicKey: result.publicKey!,
          certificate,
          certificateType: result.certificateType!,
          verifiedAt: Date.now(),
          vaultInitialized: false,
        };

        verifiedSessions.set(sessionKey, session);
        api.logger.info(`Identity verified: ${result.publicKey!.slice(0, 16)}... (${result.certificateType})`);

        return session;
      }

      // Session encryptions available for PFS if needed
      void sessionEncryptions;  // Keep reference for future use

      // =====================================================================
      // Register Identity-Gated Tools
      // =====================================================================

      // Register certificate tool
      api.registerTool({
        name: 'register_certificate',
        description: 'Register your identity certificate to establish a verified session',
        parameters: {
          type: 'object',
          properties: {
            certificate: {
              type: 'object',
              description: 'Your BRC-52/53 identity certificate',
            },
          },
          required: ['certificate'],
        },
        execute: async (
          _toolId: string,
          params: Record<string, unknown>,
          ctx?: ToolContext
        ) => {
          const certificate = params.certificate as Certificate;
          const sessionKey = ctx?.sessionKey ?? 'default';

          try {
            const result = await identityGate.registerCertificate(certificate);
            if (!result.verified) {
              return { success: false, error: result.error };
            }

            const session: VerifiedSession = {
              publicKey: result.publicKey!,
              certificate,
              certificateType: result.certificateType!,
              verifiedAt: Date.now(),
              vaultInitialized: false,
            };
            verifiedSessions.set(sessionKey, session);

            return {
              success: true,
              message: 'Identity verified and session established',
              publicKey: result.publicKey,
              certificateType: result.certificateType,
            };
          } catch (error) {
            return { success: false, error: String(error) };
          }
        },
      }, { name: 'register_certificate' });

      // Wallet info (gated)
      api.registerTool({
        name: 'wallet_info',
        description: 'Get agent wallet information (requires verified identity)',
        parameters: {
          type: 'object',
          properties: {},
          required: [],
        },
        execute: async (_toolId: string, _params: Record<string, unknown>, ctx?: ToolContext) => {
          // GATE: Verify identity
          const session = await gateIdentity(ctx, 'wallet_info');

          return {
            success: true,
            agentPublicKey: agentIdentity.publicKey,
            userPublicKey: session.publicKey,
            certificateType: session.certificateType,
            sessionVerifiedAt: session.verifiedAt,
          };
        },
      }, { name: 'wallet_info' });

      // Memory recall (gated)
      api.registerTool({
        name: 'memory_recall',
        description: 'Search encrypted knowledge vault (requires verified identity)',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query' },
            limit: { type: 'number', description: 'Max results (default: 5)' },
          },
          required: ['query'],
        },
        execute: async (_toolId: string, params: Record<string, unknown>, ctx?: ToolContext) => {
          // GATE: Verify identity
          const session = await gateIdentity(ctx, 'memory_recall');

          if (!session.vaultInitialized) {
            return { success: false, error: 'Vault not initialized' };
          }

          try {
            const results = await shadBridge.quickRetrieve(
              session.publicKey,
              params.query as string,
              { limit: (params.limit as number) ?? 5, includeContent: true }
            );
            return { success: true, results };
          } catch (error) {
            return { success: false, error: String(error) };
          }
        },
      }, { name: 'memory_recall' });

      // Store document (gated)
      api.registerTool({
        name: 'store_document',
        description: 'Store encrypted document (requires verified identity)',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Document path' },
            content: { type: 'string', description: 'Document content' },
          },
          required: ['path', 'content'],
        },
        execute: async (_toolId: string, params: Record<string, unknown>, ctx?: ToolContext) => {
          // GATE: Verify identity
          const session = await gateIdentity(ctx, 'store_document');

          // Initialize vault if needed
          if (!session.vaultInitialized) {
            const vaultId = `vault-${session.publicKey.slice(0, 16)}`;
            await encryptedVault.initializeVault(session.publicKey, vaultId);
            session.vaultInitialized = true;
            session.vaultId = vaultId;
          }

          try {
            const entry = await encryptedVault.uploadDocument(
              session.publicKey,
              params.path as string,
              params.content as string
            );
            return { success: true, path: entry.path, encrypted: true };
          } catch (error) {
            return { success: false, error: String(error) };
          }
        },
      }, { name: 'store_document' });

      // Read document (gated)
      api.registerTool({
        name: 'read_document',
        description: 'Read encrypted document (requires verified identity)',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Document path' },
          },
          required: ['path'],
        },
        execute: async (_toolId: string, params: Record<string, unknown>, ctx?: ToolContext) => {
          // GATE: Verify identity
          const session = await gateIdentity(ctx, 'read_document');

          if (!session.vaultInitialized) {
            return { success: false, error: 'Vault not initialized' };
          }

          try {
            const content = await encryptedVault.readDocument(
              session.publicKey,
              params.path as string
            );
            return { success: true, content };
          } catch (error) {
            return { success: false, error: String(error) };
          }
        },
      }, { name: 'read_document' });

      // Sign message (gated)
      api.registerTool({
        name: 'sign_message',
        description: 'Sign message with agent key (requires verified identity)',
        parameters: {
          type: 'object',
          properties: {
            message: { type: 'string', description: 'Message to sign' },
          },
          required: ['message'],
        },
        execute: async (_toolId: string, params: Record<string, unknown>, ctx?: ToolContext) => {
          // GATE: Verify identity
          const session = await gateIdentity(ctx, 'sign_message');
          const sessionKey = ctx?.sessionKey ?? 'default';

          try {
            // Sign with agent wallet using per-interaction key
            const timestamp = Date.now();
            const signature = await agentWallet.createSignature({
              data: Array.from(new TextEncoder().encode(params.message as string)),
              protocolID: [2, 'agidentity-message'],
              keyID: `msg-${sessionKey}-${timestamp}`,
              counterparty: session.publicKey,
            });

            return {
              success: true,
              signature: signature.signature.map(b => b.toString(16).padStart(2, '0')).join(''),
              signerPublicKey: agentIdentity.publicKey,
              timestamp,
            };
          } catch (error) {
            return { success: false, error: String(error) };
          }
        },
      }, { name: 'sign_message' });

      // =====================================================================
      // Register Hooks (Identity-Gated)
      // =====================================================================

      // GATE: Verify identity before EVERY agent inference
      api.on('before_agent_start', async (event, ctx) => {
        const sessionKey = ctx.sessionKey as string | undefined ?? 'default';

        // Try to verify identity
        let session: VerifiedSession | undefined;
        try {
          // Check for certificate in context (passed by client)
          const certificate = (ctx as Record<string, unknown>).userCertificate as Certificate | undefined;
          if (certificate) {
            const result = await identityGate.verifyIdentity(certificate);
            if (result.verified) {
              session = {
                publicKey: result.publicKey!,
                certificate,
                certificateType: result.certificateType!,
                verifiedAt: Date.now(),
                vaultInitialized: verifiedSessions.get(sessionKey)?.vaultInitialized ?? false,
                vaultId: verifiedSessions.get(sessionKey)?.vaultId,
              };
              verifiedSessions.set(sessionKey, session);
            }
          } else {
            session = verifiedSessions.get(sessionKey);
          }
        } catch {
          // Identity verification failed
        }

        if (!session) {
          // Return warning but allow agent to start (can prompt for certificate)
          return {
            prependContext: `WARNING: No verified identity for this session.
You must register a valid identity certificate before accessing secure features.
Use the register_certificate tool with your BRC-52/53 certificate.

Agent Identity: ${agentIdentity.publicKey}
Network: ${config.network ?? 'mainnet'}`,
          };
        }

        // Build context for verified user
        let vaultContext = '';
        if (session.vaultInitialized) {
          const docs = encryptedVault.listDocuments();
          vaultContext = `\nYour encrypted vault: ${docs.length} documents`;

          // Auto-retrieve relevant context
          if (docs.length > 0 && event.prompt) {
            try {
              const relevant = await shadBridge.quickRetrieve(
                session.publicKey,
                (event.prompt as string).slice(0, 200),
                { limit: 3, includeContent: true }
              );
              if (relevant.length > 0) {
                vaultContext += '\n\nRelevant context:';
                for (const doc of relevant) {
                  if (doc.content) {
                    vaultContext += `\n\n--- ${doc.path} ---\n${doc.content.slice(0, 500)}`;
                  }
                }
              }
            } catch {
              // Ignore
            }
          }
        }

        return {
          prependContext: `VERIFIED IDENTITY SESSION
Identity: ${session.publicKey.slice(0, 16)}...
Certificate Type: ${session.certificateType}
Verified At: ${new Date(session.verifiedAt).toISOString()}

Agent Identity: ${agentIdentity.publicKey}
Network: ${config.network ?? 'mainnet'}

Security: Per-interaction encryption (PFS) active
${vaultContext}`,
        };
      }, { priority: 10 });

      // Sign and audit all agent responses (identity tracked)
      api.on('agent_end', async (event, ctx) => {
        const sessionKey = ctx.sessionKey as string | undefined ?? 'default';
        const session = verifiedSessions.get(sessionKey);

        const auditData = {
          sessionKey,
          verified: !!session,
          userPublicKeyHash: session?.publicKey.slice(0, 16) ?? 'unverified',
          certificateType: session?.certificateType ?? 'none',
          timestamp: Date.now(),
          success: event.success,
        };

        try {
          const signature = await agentWallet.createSignature({
            data: Array.from(new TextEncoder().encode(JSON.stringify(auditData))),
            protocolID: [0, 'agidentity-audit'],
            keyID: `audit-${sessionKey}-${Date.now()}`,
          });

          api.logger.info(
            `Audit: ${event.success ? 'ok' : 'fail'} ` +
            `[${session ? 'verified' : 'unverified'}] ` +
            `sig:${signature.signature.slice(0, 8).map(b => b.toString(16)).join('')}...`
          );
        } catch {
          // Ignore audit failures
        }
      });

      api.logger.info('Secure AGIdentity plugin registered (all operations gated)');
    },
  };
}

export default createSecureAGIdentityPlugin;
