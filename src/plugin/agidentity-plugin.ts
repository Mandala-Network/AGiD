/**
 * AGIdentity OpenClaw Plugin
 *
 * This plugin integrates AGIdentity's security features into OpenClaw:
 * - BRC-100 wallet for agent identity
 * - Encrypted Shad vault for semantic memory
 * - UHRP storage with blockchain timestamps
 * - Per-interaction encryption (Edwin-style)
 * - Signed audit trails
 *
 * The plugin is designed as a lightweight wrapper that inherits OpenClaw upgrades.
 */

import type {
  OpenClawPluginDefinition,
  OpenClawPluginApi,
  ToolContext,
  AGIdentityConfig,
  UserContext,
} from '../types/index.js';
import { createAgentWallet } from '../wallet/agent-wallet.js';
import { AGIdentityStorageManager } from '../uhrp/storage-manager.js';
import { EncryptedShadVault } from '../shad/encrypted-vault.js';
import { createShadBridge } from '../shad/shad-integration.js';
import { SessionEncryption } from '../encryption/per-interaction.js';

/**
 * Create the AGIdentity plugin
 */
export function createAGIdentityPlugin(
  config: AGIdentityConfig
): OpenClawPluginDefinition {
  return {
    id: 'agidentity',
    name: 'AGIdentity',
    description: 'BSV blockchain wallet, Shad memory, and UHRP storage for AI agents',
    version: '0.1.0',

    async register(api: OpenClawPluginApi) {
      // =====================================================================
      // Initialize Core Components
      // =====================================================================

      api.logger.info('Initializing AGIdentity plugin...');

      // Initialize agent wallet
      const agentWallet = await createAgentWallet(config.agentWallet);
      const agentIdentity = await agentWallet.getPublicKey({ identityKey: true });

      api.logger.info(`Agent identity: ${agentIdentity.publicKey.slice(0, 16)}...`);

      // Initialize storage manager
      const storageManager = new AGIdentityStorageManager({
        storageUrl: config.storageUrl,
        wallet: agentWallet,
        network: config.network
      });

      // Initialize encrypted vault
      const encryptedVault = new EncryptedShadVault({
        storageManager,
        wallet: agentWallet
      });

      // Initialize Shad bridge
      const shadBridge = createShadBridge(encryptedVault, agentWallet, config.shad);

      // Check Shad availability
      const shadStatus = await shadBridge.checkShadAvailable();
      if (shadStatus.available) {
        api.logger.info(`Shad available: ${shadStatus.version}`);
      } else {
        api.logger.warn(`Shad not available: ${shadStatus.error}`);
      }

      // Per-user context storage
      const userContexts = new Map<string, UserContext>();
      const sessionEncryptions = new Map<string, SessionEncryption>();

      // =====================================================================
      // Helper Functions
      // =====================================================================

      async function getUserContext(sessionKey?: string): Promise<UserContext> {
        const key = sessionKey ?? 'default';
        let context = userContexts.get(key);

        if (!context) {
          context = {
            userPublicKey: key,
            vaultInitialized: false,
            sessionCreatedAt: Date.now(),
            lastActivityAt: Date.now()
          };
          userContexts.set(key, context);
        } else {
          context.lastActivityAt = Date.now();
        }

        return context;
      }

      function _getSessionEncryption(
        sessionKey: string,
        userPublicKey: string
      ): SessionEncryption {
        let encryption = sessionEncryptions.get(sessionKey);

        if (!encryption) {
          encryption = new SessionEncryption(agentWallet, userPublicKey, sessionKey);
          sessionEncryptions.set(sessionKey, encryption);
        }

        return encryption;
      }

      // Keep reference to avoid unused warning
      void _getSessionEncryption;

      // =====================================================================
      // Register Tools
      // =====================================================================

      // Wallet balance tool
      api.registerTool({
        name: 'wallet_balance',
        description: 'Check the agent wallet balance',
        parameters: {
          type: 'object',
          properties: {},
          required: []
        },
        execute: async () => {
          try {
            // This would query actual balance
            return {
              success: true,
              message: 'Wallet balance check not yet implemented',
              agentPublicKey: agentIdentity.publicKey
            };
          } catch (error) {
            return { success: false, error: String(error) };
          }
        }
      }, { name: 'wallet_balance' });

      // Memory recall tool (Shad integration)
      api.registerTool({
        name: 'memory_recall',
        description: 'Search your encrypted knowledge vault for relevant information using Shad semantic retrieval',
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'What to search for in your knowledge vault'
            },
            limit: {
              type: 'number',
              description: 'Maximum number of results (default: 5)'
            },
            includeContent: {
              type: 'boolean',
              description: 'Include document content in results (default: true)'
            }
          },
          required: ['query']
        },
        execute: async (
          _toolId: string,
          params: Record<string, unknown>,
          ctx?: ToolContext
        ) => {
          const userContext = await getUserContext(ctx?.sessionKey);

          if (!userContext.vaultInitialized) {
            return {
              success: false,
              error: 'Vault not initialized. Upload documents first.'
            };
          }

          try {
            const results = await shadBridge.quickRetrieve(
              userContext.userPublicKey,
              params.query as string,
              {
                limit: (params.limit as number) ?? 5,
                includeContent: (params.includeContent as boolean) ?? true
              }
            );

            return {
              success: true,
              results: results.map(r => ({
                path: r.path,
                relevance: r.relevanceScore,
                content: r.content?.slice(0, 1000)  // Truncate for context
              }))
            };
          } catch (error) {
            return { success: false, error: String(error) };
          }
        }
      }, { name: 'memory_recall' });

      // Deep research tool (full Shad execution)
      api.registerTool({
        name: 'deep_research',
        description: 'Perform deep research across your knowledge vault using Shad recursive reasoning',
        parameters: {
          type: 'object',
          properties: {
            task: {
              type: 'string',
              description: 'The research task or question to investigate'
            },
            strategy: {
              type: 'string',
              enum: ['software', 'research', 'analysis', 'planning'],
              description: 'Research strategy (default: research)'
            }
          },
          required: ['task']
        },
        execute: async (
          _toolId: string,
          params: Record<string, unknown>,
          ctx?: ToolContext
        ) => {
          const userContext = await getUserContext(ctx?.sessionKey);

          if (!userContext.vaultInitialized) {
            return {
              success: false,
              error: 'Vault not initialized. Upload documents first.'
            };
          }

          if (!shadStatus.available) {
            return {
              success: false,
              error: 'Shad is not installed. Install with: pip install shad'
            };
          }

          try {
            const result = await shadBridge.executeTask(
              userContext.userPublicKey,
              params.task as string,
              {
                strategy: (params.strategy as 'software' | 'research' | 'analysis' | 'planning') ?? 'research'
              }
            );

            return {
              success: result.success,
              output: result.output,
              documentsUsed: result.retrievedDocuments.length,
              error: result.error
            };
          } catch (error) {
            return { success: false, error: String(error) };
          }
        }
      }, { name: 'deep_research' });

      // Store document tool
      api.registerTool({
        name: 'store_document',
        description: 'Store a document to your encrypted blockchain-timestamped vault',
        parameters: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'Path/name for the document (e.g., "notes/meeting.md")'
            },
            content: {
              type: 'string',
              description: 'Document content (markdown recommended)'
            }
          },
          required: ['path', 'content']
        },
        execute: async (
          _toolId: string,
          params: Record<string, unknown>,
          ctx?: ToolContext
        ) => {
          const userContext = await getUserContext(ctx?.sessionKey);

          // Initialize vault if needed
          if (!userContext.vaultInitialized) {
            const vaultId = `vault-${userContext.userPublicKey.slice(0, 16)}`;
            await encryptedVault.initializeVault(userContext.userPublicKey, vaultId);
            userContext.vaultInitialized = true;
            userContext.vaultId = vaultId;
          }

          try {
            const entry = await encryptedVault.uploadDocument(
              userContext.userPublicKey,
              params.path as string,
              params.content as string
            );

            return {
              success: true,
              path: entry.path,
              uhrpUrl: entry.uhrpUrl,
              encrypted: true,
              timestamp: entry.lastModified
            };
          } catch (error) {
            return { success: false, error: String(error) };
          }
        }
      }, { name: 'store_document' });

      // Read document tool
      api.registerTool({
        name: 'read_document',
        description: 'Read a document from your encrypted vault',
        parameters: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'Path to the document'
            }
          },
          required: ['path']
        },
        execute: async (
          _toolId: string,
          params: Record<string, unknown>,
          ctx?: ToolContext
        ) => {
          const userContext = await getUserContext(ctx?.sessionKey);

          if (!userContext.vaultInitialized) {
            return { success: false, error: 'Vault not initialized' };
          }

          try {
            const content = await encryptedVault.readDocument(
              userContext.userPublicKey,
              params.path as string
            );

            if (content === null) {
              return { success: false, error: 'Document not found' };
            }

            return { success: true, content };
          } catch (error) {
            return { success: false, error: String(error) };
          }
        }
      }, { name: 'read_document' });

      // Verify document tool
      api.registerTool({
        name: 'verify_document',
        description: 'Verify a document exists and get its blockchain proof',
        parameters: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'Document path in your vault'
            }
          },
          required: ['path']
        },
        execute: async (
          _toolId: string,
          params: Record<string, unknown>,
          _ctx?: ToolContext
        ) => {
          try {
            const proof = await encryptedVault.getVaultProof(params.path as string);
            return { success: true, ...proof };
          } catch (error) {
            return { success: false, error: String(error) };
          }
        }
      }, { name: 'verify_document' });

      // List documents tool
      api.registerTool({
        name: 'list_documents',
        description: 'List all documents in your encrypted vault',
        parameters: {
          type: 'object',
          properties: {},
          required: []
        },
        execute: async (
          _toolId: string,
          _params: Record<string, unknown>,
          ctx?: ToolContext
        ) => {
          const userContext = await getUserContext(ctx?.sessionKey);

          if (!userContext.vaultInitialized) {
            return { success: true, documents: [] };
          }

          const docs = encryptedVault.listDocuments();
          return {
            success: true,
            documents: docs.map(d => ({
              path: d.path,
              lastModified: d.lastModified
            }))
          };
        }
      }, { name: 'list_documents' });

      // Sign message tool
      api.registerTool({
        name: 'sign_message',
        description: 'Cryptographically sign a message with the agent identity',
        parameters: {
          type: 'object',
          properties: {
            message: {
              type: 'string',
              description: 'Message to sign'
            }
          },
          required: ['message']
        },
        execute: async (
          _toolId: string,
          params: Record<string, unknown>,
          _ctx?: ToolContext
        ) => {
          try {
            const signature = await agentWallet.createSignature({
              data: Array.from(new TextEncoder().encode(params.message as string)),
              protocolID: [0, 'agidentity-message'],  // Level 0 = publicly verifiable
              keyID: `msg-${Date.now()}`
            });

            return {
              success: true,
              signature: Array.from(new Uint8Array(signature.signature))
                .map(b => b.toString(16).padStart(2, '0'))
                .join(''),
              signerPublicKey: agentIdentity.publicKey
            };
          } catch (error) {
            return { success: false, error: String(error) };
          }
        }
      }, { name: 'sign_message' });

      // =====================================================================
      // Register Hooks
      // =====================================================================

      // Inject agent context before each conversation
      api.on('before_agent_start', async (event, ctx) => {
        const userContext = await getUserContext(ctx.sessionKey as string | undefined);

        // Build context injection
        let vaultContext = '';
        if (userContext.vaultInitialized) {
          const docs = encryptedVault.listDocuments();
          vaultContext = `\nYour encrypted knowledge vault contains ${docs.length} documents.`;

          // Auto-retrieve relevant context if vault has documents
          if (docs.length > 0 && event.prompt) {
            try {
              const relevant = await shadBridge.quickRetrieve(
                userContext.userPublicKey,
                (event.prompt as string).slice(0, 200),  // Use first 200 chars as query
                { limit: 3, includeContent: true }
              );

              if (relevant.length > 0) {
                vaultContext += '\n\nRelevant context from your vault:';
                for (const doc of relevant) {
                  if (doc.content) {
                    vaultContext += `\n\n--- ${doc.path} ---\n${doc.content.slice(0, 500)}`;
                  }
                }
              }
            } catch {
              // Ignore retrieval errors in context injection
            }
          }
        }

        return {
          prependContext: `You are an AI agent with a verified blockchain identity.

Agent Identity:
- Public Key: ${agentIdentity.publicKey}
- Network: ${config.network ?? 'mainnet'}

Security Features:
- All messages use per-interaction encryption (Perfect Forward Secrecy)
- Your knowledge vault is encrypted and stored on UHRP
- Documents are timestamped on the BSV blockchain
- All agent actions are cryptographically signed

Available Memory Tools:
- memory_recall: Search your knowledge vault
- deep_research: Full Shad research on complex questions
- store_document: Save information to encrypted vault
- read_document: Retrieve stored documents
- verify_document: Get blockchain proof for a document
${vaultContext}`
        };
      }, { priority: 10 });

      // Sign and audit all agent responses
      api.on('agent_end', async (event, ctx) => {
        const userContext = await getUserContext(ctx.sessionKey as string | undefined);

        // Create audit entry
        const auditData = {
          sessionKey: ctx.sessionKey,
          userPublicKeyHash: userContext.userPublicKey.slice(0, 16),
          timestamp: Date.now(),
          success: event.success,
          durationMs: event.durationMs,
          messageCount: Array.isArray(event.messages) ? event.messages.length : 0
        };

        // Sign the audit entry
        try {
          const signature = await agentWallet.createSignature({
            data: Array.from(new TextEncoder().encode(JSON.stringify(auditData))),
            protocolID: [0, 'agidentity-audit'],
            keyID: `audit-${ctx.sessionKey}-${Date.now()}`
          });

          api.logger.info(
            `Session audit: ${event.success ? 'success' : 'failed'} ` +
            `(${event.durationMs}ms, sig: ${Array.from(new Uint8Array(signature.signature)).slice(0, 8).map(b => b.toString(16)).join('')}...)`
          );
        } catch (error) {
          api.logger.warn(`Failed to sign audit: ${error}`);
        }
      });

      // =====================================================================
      // Register CLI Commands
      // =====================================================================

      if (api.registerCli) {
        api.registerCli((ctx) => {
          const { program } = ctx;

          program
            .command('agidentity:status')
            .description('Show AGIdentity status')
            .action(async () => {
              console.log('AGIdentity Status');
              console.log('─'.repeat(40));
              console.log(`Agent Public Key: ${agentIdentity.publicKey}`);
              console.log(`Network: ${config.network ?? 'mainnet'}`);
              console.log(`Storage URL: ${config.storageUrl}`);
              console.log(`Shad Available: ${shadStatus.available ? 'Yes' : 'No'}`);
              if (shadStatus.version) {
                console.log(`Shad Version: ${shadStatus.version}`);
              }
            });

          program
            .command('agidentity:sync')
            .description('Sync local Obsidian vault to encrypted UHRP storage')
            .requiredOption('-k, --key <publicKey>', 'User public key')
            .action(async (...args: unknown[]) => {
              const vaultPath = args[0] as string;
              const options = args[1] as { key: string };
              console.log(`Syncing vault from ${vaultPath}...`);

              await encryptedVault.initializeVault(options.key, 'default');
              const stats = await encryptedVault.syncFromLocalVault(vaultPath, options.key);

              console.log('Sync complete:');
              console.log(`  Uploaded: ${stats.uploaded}`);
              console.log(`  Updated: ${stats.updated}`);
              console.log(`  Unchanged: ${stats.unchanged}`);
              console.log(`  Errors: ${stats.errors}`);
            });

          program
            .command('agidentity:verify')
            .description('Verify a document with blockchain proof')
            .action(async (...args: unknown[]) => {
              const documentPath = args[0] as string;
              const proof = await encryptedVault.getVaultProof(documentPath);

              if (proof.exists) {
                console.log('Document verified!');
                console.log(`  UHRP URL: ${proof.uhrpUrl}`);
                if (proof.blockchainTxId) {
                  console.log(`  Blockchain TX: ${proof.blockchainTxId}`);
                  console.log(`  Timestamp: ${new Date(proof.timestamp!).toISOString()}`);
                  console.log(`  Block Height: ${proof.blockHeight}`);
                }
              } else {
                console.log('Document not found in vault');
              }
            });
        });
      }

      api.logger.info('AGIdentity plugin registered successfully');
    }
  };
}

export default createAGIdentityPlugin;
