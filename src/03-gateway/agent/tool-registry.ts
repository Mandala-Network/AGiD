/**
 * Tool Registry
 *
 * Registers all AGIdentity tools in Anthropic tool_use format.
 * Tools execute in-process against the wallet — no HTTP roundtrip.
 */

import * as fs from 'fs';
import * as path from 'path';
import { mkdtemp, chmod, writeFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { lockPushDropToken, decodePushDropToken, unlockPushDropToken } from '../../01-core/wallet/pushdrop-ops.js';
import { storeMemory } from '../../02-storage/memory/memory-writer.js';
import { listMemories } from '../../02-storage/memory/memory-reader.js';
import type { Memory } from '../../02-storage/memory/memory-reader.js';
import { ShadTempVaultExecutor } from '../../04-integrations/shad/shad-temp-executor.js';
import { GepaExecutor } from '../../04-integrations/gepa/index.js';
import { X402Client } from '../../04-integrations/x402/index.js';
import { OverlayClient } from '../../04-integrations/overlay/index.js';
import { WorkspaceIntegrity } from '../../07-shared/audit/workspace-integrity.js';
import { AnchorChain } from '../../07-shared/audit/anchor-chain.js';
import type { AnchorChainData } from '../../07-shared/audit/anchor-chain.js';
import type { AgentWallet } from '../../01-core/wallet/agent-wallet.js';
import type { AgentToolDefinition, RegisteredTool, ToolResult } from '../../07-shared/types/agent-types.js';

export class ToolRegistry {
  private tools = new Map<string, RegisteredTool>();

  register(tool: RegisteredTool): void {
    this.tools.set(tool.definition.name, tool);
  }

  getDefinitions(): AgentToolDefinition[] {
    return Array.from(this.tools.values()).map((t) => t.definition);
  }

  async execute(name: string, params: Record<string, unknown>): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return { content: JSON.stringify({ error: `Unknown tool: ${name}` }), isError: true };
    }
    try {
      return await tool.execute(params);
    } catch (error) {
      return {
        content: JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
        isError: true,
      };
    }
  }

  registerBuiltinTools(wallet: AgentWallet, workspacePath?: string, sessionsPath?: string): void {
    this.registerIdentityTool(wallet);
    this.registerBalanceTool(wallet);
    this.registerSignTool(wallet);
    this.registerEncryptTool(wallet);
    this.registerDecryptTool(wallet);
    this.registerGetPublicKeyTool(wallet);
    this.registerGetHeightTool(wallet);
    this.registerCreateActionTool(wallet);
    this.registerInternalizeActionTool(wallet);
    this.registerListOutputsTool(wallet);
    this.registerSendPaymentTool(wallet);
    this.registerTokenCreateTool(wallet);
    this.registerTokenListTool(wallet);
    this.registerTokenRedeemTool(wallet);
    this.registerMessageSendTool(wallet);
    this.registerMessageListTool(wallet);
    this.registerMessageAckTool(wallet);
    this.registerStoreMemoryTool(wallet);
    this.registerRecallMemoriesTool(wallet);
    this.registerSemanticSearchTool(wallet, workspacePath);
    this.registerOptimizePromptTool(wallet);
    this.registerDiscoverServicesTool(wallet);
    this.registerX402RequestTool(wallet);
    this.registerOverlayLookupTool();
    if (workspacePath) this.registerVerifyWorkspaceTool(wallet, workspacePath);
    if (sessionsPath) this.registerVerifySessionTool(sessionsPath);
  }

  // ===========================================================================
  // Identity & Wallet Tools
  // ===========================================================================

  private registerIdentityTool(wallet: AgentWallet): void {
    this.register({
      definition: {
        name: 'agid_identity',
        description: 'Get your cryptographic identity (BSV public key, network, balance)',
        input_schema: { type: 'object', properties: {}, required: [] },
      },
      execute: async () => {
        const identity = await wallet.getPublicKey({ identityKey: true });
        const network = await wallet.getNetwork();
        const messageBoxEnabled = !!wallet.getMessageBoxClient();
        return ok({ publicKey: identity.publicKey, network, messageBoxEnabled });
      },
    });
  }

  private registerBalanceTool(wallet: AgentWallet): void {
    this.register({
      definition: {
        name: 'agid_balance',
        description: 'Check your BSV wallet balance in satoshis',
        input_schema: { type: 'object', properties: {}, required: [] },
      },
      execute: async () => {
        const balance = await wallet.getBalanceAndUtxos();
        const network = await wallet.getNetwork();
        return ok({ balance: balance.total, utxos: balance.utxos?.length || 0, network });
      },
    });
  }

  private registerSignTool(wallet: AgentWallet): void {
    this.register({
      definition: {
        name: 'agid_sign',
        description: 'Sign a message with your wallet to prove you created it',
        input_schema: {
          type: 'object',
          properties: {
            message: { type: 'string', description: 'Message to sign' },
            protocol: { type: 'string', description: 'Protocol identifier (default: agent message)' },
          },
          required: ['message'],
        },
      },
      execute: async (params) => {
        const message = params.message as string;
        const protocol = (params.protocol as string) || 'agent message';
        const data = Array.from(Buffer.from(message, 'utf8'));
        const result = await wallet.createSignature({
          data,
          protocolID: [0, protocol],
          keyID: '1',
          counterparty: 'self',
        });
        const signature = Buffer.from(result.signature).toString('hex');
        return ok({ message, signature, signed: true });
      },
    });
  }

  private registerEncryptTool(wallet: AgentWallet): void {
    this.register({
      definition: {
        name: 'agid_encrypt',
        description: 'Encrypt data for secure storage or communication',
        input_schema: {
          type: 'object',
          properties: {
            data: { type: 'string', description: 'Data to encrypt' },
            protocol: { type: 'string', description: 'Protocol identifier (default: agent memory)' },
            keyId: { type: 'string', description: 'Key identifier (default: default)' },
            counterparty: { type: 'string', description: 'Counterparty public key or "self" (default: self)' },
          },
          required: ['data'],
        },
      },
      execute: async (params) => {
        const { data, protocol = 'agent memory', keyId = 'default', counterparty = 'self' } = params as Record<string, string>;
        const plaintext = Array.from(Buffer.from(data, 'utf8'));
        const result = await wallet.encrypt({
          plaintext,
          protocolID: [0, protocol],
          keyID: keyId,
          counterparty,
        });
        const ciphertext = Buffer.from(result.ciphertext as number[]).toString('hex');
        return ok({ ciphertext, encrypted: true });
      },
    });
  }

  private registerDecryptTool(wallet: AgentWallet): void {
    this.register({
      definition: {
        name: 'agid_decrypt',
        description: 'Decrypt previously encrypted data',
        input_schema: {
          type: 'object',
          properties: {
            ciphertext: { type: 'string', description: 'Hex-encoded ciphertext' },
            protocol: { type: 'string', description: 'Protocol identifier (default: agent memory)' },
            keyId: { type: 'string', description: 'Key identifier (default: default)' },
            counterparty: { type: 'string', description: 'Counterparty public key or "self" (default: self)' },
          },
          required: ['ciphertext'],
        },
      },
      execute: async (params) => {
        const { ciphertext, protocol = 'agent memory', keyId = 'default', counterparty = 'self' } = params as Record<string, string>;
        const ciphertextBytes = Array.from(Buffer.from(ciphertext, 'hex'));
        const result = await wallet.decrypt({
          ciphertext: ciphertextBytes,
          protocolID: [0, protocol],
          keyID: keyId,
          counterparty,
        });
        const plaintext = Buffer.from(result.plaintext as number[]).toString('utf8');
        return ok({ plaintext, decrypted: true });
      },
    });
  }

  private registerGetPublicKeyTool(wallet: AgentWallet): void {
    this.register({
      definition: {
        name: 'agid_get_public_key',
        description: 'Derive a protocol-specific public key (BRC-42 key derivation)',
        input_schema: {
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
      },
      execute: async (params) => {
        const result = await wallet.getPublicKey({
          identityKey: params.identityKey as boolean | undefined,
          protocolID: params.protocolName
            ? [params.securityLevel as number ?? 0, params.protocolName as string]
            : undefined,
          keyID: params.keyID as string | undefined,
          counterparty: params.counterparty as string | undefined,
        });
        return ok({ publicKey: result.publicKey });
      },
    });
  }

  private registerGetHeightTool(wallet: AgentWallet): void {
    this.register({
      definition: {
        name: 'agid_get_height',
        description: 'Get the current BSV blockchain block height',
        input_schema: { type: 'object', properties: {}, required: [] },
      },
      execute: async () => {
        const height = await wallet.getHeight();
        return ok({ height });
      },
    });
  }

  // ===========================================================================
  // BRC-100 Transaction Tools
  // ===========================================================================

  private registerCreateActionTool(wallet: AgentWallet): void {
    this.register({
      definition: {
        name: 'agid_create_action',
        description: 'Create a BSV transaction (BRC-100 createAction). Supports outputs with baskets and tags.',
        input_schema: {
          type: 'object',
          properties: {
            description: { type: 'string', description: 'Transaction description' },
            outputs: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  lockingScript: { type: 'string' },
                  satoshis: { type: 'number' },
                  description: { type: 'string' },
                  basket: { type: 'string' },
                  tags: { type: 'array', items: { type: 'string' } },
                },
              },
              description: 'Transaction outputs',
            },
            labels: { type: 'array', items: { type: 'string' }, description: 'Transaction labels' },
          },
          required: ['description'],
        },
      },
      execute: async (params) => {
        const underlyingWallet = wallet.getUnderlyingWallet();
        if (!underlyingWallet) throw new Error('Wallet not available');
        const result = await underlyingWallet.createAction({
          description: params.description as string,
          outputs: (params.outputs as any[])?.map((o) => ({
            lockingScript: o.lockingScript,
            satoshis: o.satoshis,
            outputDescription: o.description ?? '',
            basket: o.basket,
            tags: o.tags,
          })),
          labels: params.labels as string[] | undefined,
          options: { acceptDelayedBroadcast: false },
        });
        return ok({ txid: result.txid });
      },
    });
  }

  private registerInternalizeActionTool(wallet: AgentWallet): void {
    this.register({
      definition: {
        name: 'agid_internalize_action',
        description: 'Accept an incoming transaction (BEEF format) into the wallet',
        input_schema: {
          type: 'object',
          properties: {
            tx: { type: 'object', description: 'Transaction object with rawTx (hex) and optional txid' },
            outputs: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  outputIndex: { type: 'number' },
                  protocol: { type: 'string' },
                  paymentRemittance: { type: 'object' },
                  insertionRemittance: { type: 'object' },
                },
              },
            },
            description: { type: 'string' },
          },
          required: ['tx', 'outputs'],
        },
      },
      execute: async (params) => {
        const underlyingWallet = wallet.getUnderlyingWallet();
        if (!underlyingWallet) throw new Error('Wallet not available');
        const result = await (underlyingWallet as any).internalizeAction({
          tx: params.tx,
          outputs: params.outputs,
          description: (params.description as string) ?? 'Internalize action',
        });
        return ok({ accepted: result?.accepted ?? true, txid: result?.txid });
      },
    });
  }

  private registerListOutputsTool(wallet: AgentWallet): void {
    this.register({
      definition: {
        name: 'agid_list_outputs',
        description: 'List wallet outputs (UTXOs), optionally filtered by basket and tags',
        input_schema: {
          type: 'object',
          properties: {
            basket: { type: 'string', description: 'Basket name (default: default)' },
            tags: { type: 'array', items: { type: 'string' }, description: 'Filter by tags' },
            include: { type: 'string', description: '"locking scripts" or "entire transactions"' },
            limit: { type: 'number', description: 'Max results (default: 25)' },
            offset: { type: 'number', description: 'Skip results (default: 0)' },
          },
          required: [],
        },
      },
      execute: async (params) => {
        const underlyingWallet = wallet.getUnderlyingWallet();
        if (!underlyingWallet) throw new Error('Wallet not available');
        const result = await (underlyingWallet as any).listOutputs({
          basket: (params.basket as string) ?? 'default',
          tags: params.tags as string[] | undefined,
          include: (params.include as string) ?? 'locking scripts',
          limit: (params.limit as number) ?? 25,
          offset: (params.offset as number) ?? 0,
        });
        return ok({ totalOutputs: result?.totalOutputs ?? 0, outputs: result?.outputs ?? [] });
      },
    });
  }

  private registerSendPaymentTool(wallet: AgentWallet): void {
    this.register({
      definition: {
        name: 'agid_send_payment',
        description: 'Send a BSV payment to another identity via PeerPay',
        input_schema: {
          type: 'object',
          properties: {
            recipient: { type: 'string', description: 'Recipient public key (33-byte hex)' },
            amount: { type: 'number', description: 'Amount in satoshis' },
          },
          required: ['recipient', 'amount'],
        },
      },
      execute: async (params) => {
        const ppClient = wallet.getPeerPayClient();
        if (!ppClient) throw new Error('PeerPay not initialized');
        await ppClient.sendPayment({
          recipient: params.recipient as string,
          amount: params.amount as number,
        });
        return ok({ recipient: params.recipient, amount: params.amount, sent: true });
      },
    });
  }

  // ===========================================================================
  // PushDrop Token Tools
  // ===========================================================================

  private registerTokenCreateTool(wallet: AgentWallet): void {
    this.register({
      definition: {
        name: 'agid_token_create',
        description: 'Create an on-chain PushDrop identity token with data fields',
        input_schema: {
          type: 'object',
          properties: {
            fields: { type: 'array', items: { type: 'string' }, description: 'Data fields to store in the token' },
            protocol: { type: 'string', description: 'Protocol name (default: agidentity-token)' },
            keyId: { type: 'string', description: 'Key identifier (default: default)' },
            basket: { type: 'string', description: 'Wallet basket name (default: tokens)' },
          },
          required: ['fields'],
        },
      },
      execute: async (params) => {
        const fields = params.fields as string[];
        const protocol = (params.protocol as string) || 'agidentity-token';
        const keyId = (params.keyId as string) || 'default';
        const basket = (params.basket as string) || 'tokens';
        const result = await lockPushDropToken(wallet, {
          fields,
          protocolID: [2, protocol],
          keyID: keyId,
          basket,
          description: `Token: ${fields[0]?.substring(0, 30) || 'unnamed'}`,
        });
        return ok({ txid: result.txid, vout: result.vout, satoshis: result.satoshis, fields, basket, created: true });
      },
    });
  }

  private registerTokenListTool(wallet: AgentWallet): void {
    this.register({
      definition: {
        name: 'agid_token_list',
        description: 'List PushDrop tokens from a wallet basket',
        input_schema: {
          type: 'object',
          properties: {
            basket: { type: 'string', description: 'Basket name to query (default: tokens)' },
          },
          required: [],
        },
      },
      execute: async (params) => {
        const basket = (params.basket as string) || 'tokens';
        const underlyingWallet = wallet.getUnderlyingWallet();
        if (!underlyingWallet) throw new Error('Wallet not initialized');
        const result = await underlyingWallet.listOutputs({
          basket,
          tags: ['pushdrop'],
          include: 'locking scripts',
        });
        const tokens = (result.outputs as any[])
          .filter((o: any) => o.spendable && o.lockingScript)
          .map((o: any) => {
            try {
              const decoded = decodePushDropToken(o.lockingScript);
              return { outpoint: o.outpoint, satoshis: o.satoshis, fields: decoded.fields };
            } catch {
              return { outpoint: o.outpoint, satoshis: o.satoshis, fields: ['[decode error]'] };
            }
          });
        return ok({ tokens, total: tokens.length, basket });
      },
    });
  }

  private registerTokenRedeemTool(wallet: AgentWallet): void {
    this.register({
      definition: {
        name: 'agid_token_redeem',
        description: 'Redeem (spend) a PushDrop token to reclaim its satoshis',
        input_schema: {
          type: 'object',
          properties: {
            txid: { type: 'string', description: 'Transaction ID of the token' },
            vout: { type: 'number', description: 'Output index (default: 0)' },
            protocol: { type: 'string', description: 'Protocol name (default: agidentity-token)' },
            keyId: { type: 'string', description: 'Key identifier (default: default)' },
          },
          required: ['txid'],
        },
      },
      execute: async (params) => {
        const underlyingWallet = wallet.getUnderlyingWallet();
        if (!underlyingWallet) throw new Error('Wallet not initialized');
        const result = await unlockPushDropToken(underlyingWallet, {
          txid: params.txid as string,
          vout: (params.vout as number) ?? 0,
          protocolID: [2, (params.protocol as string) || 'agidentity-token'],
          keyID: (params.keyId as string) || 'default',
        });
        return ok({ txid: result.txid, satoshis: result.satoshis, redeemed: true });
      },
    });
  }

  // ===========================================================================
  // MessageBox Tools
  // ===========================================================================

  private registerMessageSendTool(wallet: AgentWallet): void {
    this.register({
      definition: {
        name: 'agid_message_send',
        description: 'Send an encrypted message to a recipient via MessageBox',
        input_schema: {
          type: 'object',
          properties: {
            recipient: { type: 'string', description: 'Recipient public key (33-byte hex)' },
            messageBox: { type: 'string', description: 'MessageBox name (default: general)' },
            body: { type: 'string', description: 'Message content (auto-encrypted via BRC-2 ECDH)' },
          },
          required: ['recipient', 'body'],
        },
      },
      execute: async (params) => {
        const recipient = params.recipient as string;
        const messageBox = (params.messageBox as string) || 'general';
        const body = params.body as string;
        const result = await wallet.sendMessage({ recipient, messageBox, body });
        return ok({
          messageId: result.messageId,
          status: result.status,
          recipient: recipient.substring(0, 16) + '...',
          messageBox,
          sent: true,
        });
      },
    });
  }

  private registerMessageListTool(wallet: AgentWallet): void {
    this.register({
      definition: {
        name: 'agid_message_list',
        description: 'List encrypted messages in a MessageBox (auto-decrypted)',
        input_schema: {
          type: 'object',
          properties: {
            messageBox: { type: 'string', description: 'MessageBox name (default: general)' },
          },
          required: [],
        },
      },
      execute: async (params) => {
        const messageBox = (params.messageBox as string) || 'general';
        const messages = await wallet.listMessages({ messageBox });
        return ok({
          messages: messages.map((m: any) => ({
            messageId: m.messageId,
            sender: m.sender,
            body: m.body,
            createdAt: m.created_at ?? m.createdAt,
          })),
          total: messages.length,
          messageBox,
        });
      },
    });
  }

  private registerMessageAckTool(wallet: AgentWallet): void {
    this.register({
      definition: {
        name: 'agid_message_ack',
        description: 'Acknowledge (delete) processed messages from MessageBox',
        input_schema: {
          type: 'object',
          properties: {
            messageIds: {
              type: 'array',
              items: { type: 'string' },
              description: 'Message IDs to acknowledge',
            },
          },
          required: ['messageIds'],
        },
      },
      execute: async (params) => {
        const messageIds = params.messageIds as string[];
        await wallet.acknowledgeMessages({ messageIds });
        return ok({ acknowledged: messageIds.length, success: true });
      },
    });
  }

  // ===========================================================================
  // Memory Tool
  // ===========================================================================

  private registerStoreMemoryTool(wallet: AgentWallet): void {
    this.register({
      definition: {
        name: 'agid_store_memory',
        description: 'Store a memory on the blockchain with tags for later retrieval',
        input_schema: {
          type: 'object',
          properties: {
            content: { type: 'string', description: 'Memory content to store' },
            tags: { type: 'array', items: { type: 'string' }, description: 'Tags for categorization' },
            importance: { type: 'string', description: '"high", "medium", or "low" (default: medium)' },
          },
          required: ['content'],
        },
      },
      execute: async (params) => {
        const content = params.content as string;
        const tags = (params.tags as string[]) || [];
        const importance = (params.importance as 'high' | 'medium' | 'low') || 'medium';
        const result = await storeMemory(wallet, { content, tags, importance });
        return ok({ txid: result.txid, uhrpUrl: result.uhrpUrl, tags: result.tags, stored: true });
      },
    });
  }
  // ===========================================================================
  // Memory Recall & Search Tools
  // ===========================================================================

  private registerRecallMemoriesTool(wallet: AgentWallet): void {
    this.register({
      definition: {
        name: 'agid_recall_memories',
        description: 'Recall memories from your on-chain memory vault with full blockchain provenance (txid, timestamp, UHRP hash). Lightweight — no Shad dependency.',
        input_schema: {
          type: 'object',
          properties: {
            tags: { type: 'array', items: { type: 'string' }, description: 'Filter by tags' },
            importance: { type: 'string', description: '"high", "medium", or "low"' },
            limit: { type: 'number', description: 'Max memories to return (default: 20)' },
          },
          required: [],
        },
      },
      execute: async (params) => {
        const tags = params.tags as string[] | undefined;
        const importance = params.importance as string | undefined;
        const limit = (params.limit as number) || 20;

        const memories = await listMemories(wallet, { tags, importance });
        const limited = memories.slice(0, limit);

        return ok({
          memories: limited.map((m: Memory) => ({
            content: m.content,
            tags: m.tags,
            importance: m.importance,
            txid: m.txid,
            blockTimestamp: m.createdAt,
            uhrpUrl: m.uhrpUrl,
            outpoint: m.outpoint,
          })),
          total: memories.length,
          returned: limited.length,
        });
      },
    });
  }

  private registerSemanticSearchTool(wallet: AgentWallet, workspacePath?: string): void {
    this.register({
      definition: {
        name: 'agid_semantic_search',
        description: 'Semantic search over your on-chain memory vault using Shad RLM. Returns results with blockchain provenance. Falls back gracefully if Shad is not installed.',
        input_schema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query for semantic matching' },
            strategy: { type: 'string', description: 'Shad strategy: research, analyze, summarize (default: research)' },
            maxDepth: { type: 'number', description: 'Max recursion depth (default: 3)' },
            maxTime: { type: 'number', description: 'Max execution time in seconds (default: 120)' },
            importance: { type: 'string', description: 'Filter by importance: high, medium, low' },
          },
          required: ['query'],
        },
      },
      execute: async (params) => {
        const query = params.query as string;
        const strategy = (params.strategy as string) || 'research';
        const maxDepth = (params.maxDepth as number) || 3;
        const maxTime = (params.maxTime as number) || 120;
        const importance = params.importance as string | undefined;

        // 1. Fetch all on-chain memories (decrypted)
        let memories: Memory[];
        try {
          memories = await listMemories(wallet, { importance });
        } catch (error) {
          return ok({
            error: 'Failed to retrieve memories from on-chain vault',
            details: error instanceof Error ? error.message : String(error),
            suggestion: 'Use agid_recall_memories for direct memory access without Shad',
          });
        }

        if (memories.length === 0 && !workspacePath) {
          return ok({ results: [], total: 0, message: 'No memories found in on-chain vault' });
        }

        // 2. Create secure temp directory
        const tempDir = await mkdtemp(path.join(tmpdir(), 'agid-search-'));
        await chmod(tempDir, 0o700);

        try {
          // 3. Write decrypted memories as files
          const provenanceMap = new Map<string, Memory>();
          for (const memory of memories) {
            const safeName = `${memory.tags.join('-') || 'memory'}-${memory.txid.substring(0, 8)}.md`;
            const filePath = path.join(tempDir, safeName);
            await writeFile(filePath, memory.content, { encoding: 'utf-8', mode: 0o600 });
            provenanceMap.set(safeName, memory);
          }

          // 4. Include workspace MEMORY.md if present
          if (workspacePath) {
            const memoryMdPath = path.join(workspacePath, 'MEMORY.md');
            if (fs.existsSync(memoryMdPath)) {
              const content = fs.readFileSync(memoryMdPath, 'utf8');
              await writeFile(path.join(tempDir, 'workspace-MEMORY.md'), content, { encoding: 'utf-8', mode: 0o600 });
            }
          }

          // 5. Check Shad availability and run
          const executor = new ShadTempVaultExecutor({
            vault: { read: async (p: string) => fs.readFileSync(path.join(tempDir, p), 'utf8'), list: async () => fs.readdirSync(tempDir) } as any,
            shadConfig: { strategy: strategy as any, maxDepth, maxTime },
          });

          const availability = await executor.checkShadAvailable();
          if (!availability.available) {
            // Graceful fallback: return memories without semantic ranking
            return ok({
              results: memories.slice(0, 10).map((m: Memory) => ({
                content: m.content,
                tags: m.tags,
                importance: m.importance,
                txid: m.txid,
                blockTimestamp: m.createdAt,
                uhrpUrl: m.uhrpUrl,
              })),
              total: memories.length,
              shadAvailable: false,
              message: 'Shad not installed — returning unranked memories. Install Shad for semantic search: pip install shad',
            });
          }

          // Run Shad search
          const result = await executor.execute(query, { strategy: strategy as any, maxDepth, maxTime });

          if (!result.success) {
            return ok({
              error: 'Shad search failed',
              details: result.error,
              fallbackResults: memories.slice(0, 5).map((m: Memory) => ({
                content: m.content.substring(0, 200),
                txid: m.txid,
                tags: m.tags,
              })),
            });
          }

          // 6. Attach on-chain provenance to results
          const enrichedResults = (result.retrievedDocuments ?? []).map((doc: any) => {
            const fileName = typeof doc === 'string' ? path.basename(doc) : doc.path ? path.basename(doc.path) : '';
            const provenance = provenanceMap.get(fileName);
            return {
              content: typeof doc === 'string' ? doc : doc.content ?? doc,
              ...(provenance ? {
                txid: provenance.txid,
                blockTimestamp: provenance.createdAt,
                uhrpUrl: provenance.uhrpUrl,
                tags: provenance.tags,
                importance: provenance.importance,
              } : {}),
            };
          });

          return ok({
            output: result.output,
            results: enrichedResults,
            total: enrichedResults.length,
            shadAvailable: true,
            strategy,
          });
        } finally {
          // 7. Secure cleanup
          try {
            await rm(tempDir, { recursive: true, force: true });
          } catch {
            // Cleanup errors shouldn't break execution
          }
        }
      },
    });
  }

  // ===========================================================================
  // GEPA Prompt Optimization Tool
  // ===========================================================================

  private registerOptimizePromptTool(wallet: AgentWallet): void {
    this.register({
      definition: {
        name: 'agid_optimize_prompt',
        description: 'Optimize any text or prompt using GEPA evolutionary optimization. Useful for improving system prompts, user prompts, or any text against a stated objective.',
        input_schema: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'The text or prompt to optimize' },
            objective: { type: 'string', description: 'What the optimized text should achieve (e.g. "be more concise and persuasive")' },
            mode: { type: 'string', description: '"fast" (10 iterations) or "thorough" (30 iterations). Default: fast' },
            storeOnChain: { type: 'boolean', description: 'Store the optimized result on-chain for later recall (default: false)' },
          },
          required: ['text', 'objective'],
        },
      },
      execute: async (params) => {
        const text = params.text as string;
        const objective = params.objective as string;
        const mode = (params.mode as string) || 'fast';
        const storeOnChainFlag = params.storeOnChain as boolean ?? false;
        const maxIterations = mode === 'thorough' ? 30 : 10;

        const executor = new GepaExecutor();
        const availability = await executor.checkGepaAvailable();

        if (!availability.available) {
          return ok({
            original: text,
            optimized: null,
            gepaAvailable: false,
            error: availability.error ?? 'gepa not installed. Install with: pip install gepa',
          });
        }

        const result = await executor.optimize({ text, objective, maxIterations });

        if (!result.success) {
          return ok({
            original: text,
            optimized: null,
            gepaAvailable: true,
            error: result.error,
          });
        }

        let stored = false;
        if (storeOnChainFlag && result.optimizedText) {
          try {
            await storeMemory(wallet, {
              content: result.optimizedText,
              tags: ['gepa-optimized'],
              importance: 'medium',
            });
            stored = true;
          } catch (error) {
            // Store failure shouldn't break the optimization result
            console.error('Failed to store optimized prompt on-chain:', error);
          }
        }

        return ok({
          original: text,
          optimized: result.optimizedText,
          reasoning: result.reasoning,
          iterations: result.iterations,
          stored,
          gepaAvailable: true,
        });
      },
    });
  }

  // ===========================================================================
  // x402 Authenticated Payment Request Tools
  // ===========================================================================

  private registerDiscoverServicesTool(wallet: AgentWallet): void {
    this.register({
      definition: {
        name: 'agid_discover_services',
        description: 'Discover available x402 AI services from the registry (x402agency.com). Returns service names, URLs, and descriptions.',
        input_schema: { type: 'object', properties: {}, required: [] },
      },
      execute: async () => {
        const client = new X402Client(wallet);
        const services = await client.discoverServices();
        return ok({ services, total: services.length });
      },
    });
  }

  private registerX402RequestTool(wallet: AgentWallet): void {
    this.register({
      definition: {
        name: 'agid_x402_request',
        description: 'Make an authenticated HTTP request to an x402 service with automatic payment handling. Uses BRC-31 mutual auth and pays 402 responses automatically from wallet.',
        input_schema: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'Full URL to request (e.g. https://service.x402agency.com/api/chat)' },
            method: { type: 'string', description: 'HTTP method (default: GET)' },
            body: { type: 'string', description: 'Request body (for POST/PUT)' },
            headers: {
              type: 'object',
              description: 'Additional headers (content-type, authorization, or x-bsv-* only)',
              additionalProperties: { type: 'string' },
            },
          },
          required: ['url'],
        },
      },
      execute: async (params) => {
        const url = params.url as string;
        const method = (params.method as string) || 'GET';
        const body = params.body as string | undefined;
        const headers = params.headers as Record<string, string> | undefined;

        const client = new X402Client(wallet);
        const result = await client.request(url, { method, body, headers });
        return ok({ status: result.status, headers: result.headers, body: result.body, paid: result.paid });
      },
    });
  }

  // ===========================================================================
  // Overlay Lookup Tool
  // ===========================================================================

  private registerOverlayLookupTool(): void {
    this.register({
      definition: {
        name: 'agid_overlay_lookup',
        description: 'Query any BSV overlay network via SHIP/SLAP. Automatically discovers reputable hosts, queries in parallel, and decodes PushDrop token outputs. Use service "ls_slap" with empty query to list all available services. Common services: ls_identity, ls_basketmap, ls_protomap, ls_certmap.',
        input_schema: {
          type: 'object',
          properties: {
            service: { type: 'string', description: 'Lookup service name (e.g. "ls_identity", "ls_slap", "ls_basketmap")' },
            query: {
              type: 'object',
              description: 'Service-specific query object (e.g. { "identityKey": "02abc..." } for ls_identity)',
              additionalProperties: true,
            },
          },
          required: ['service'],
        },
      },
      execute: async (params) => {
        const service = params.service as string;
        const query = (params.query as Record<string, unknown>) ?? {};

        const client = new OverlayClient();
        const outputs = await client.query(service, query);
        return ok({ service, outputs, total: outputs.length });
      },
    });
  }

  // ===========================================================================
  // Verification Tools
  // ===========================================================================

  private registerVerifyWorkspaceTool(wallet: AgentWallet, workspacePath: string): void {
    this.register({
      definition: {
        name: 'agid_verify_workspace',
        description: 'Verify workspace file integrity against the last on-chain anchor. Reports modified, missing, or new files.',
        input_schema: { type: 'object', properties: {}, required: [] },
      },
      execute: async () => {
        const integrity = new WorkspaceIntegrity(workspacePath);
        const currentHash = await integrity.hashWorkspace();
        const lastAnchor = await integrity.getLastAnchor(wallet);

        if (!lastAnchor) {
          return ok({
            verified: false,
            message: 'No previous on-chain anchor found. This may be a first session.',
            currentFiles: Object.keys(currentHash.files),
            combinedHash: currentHash.combinedHash,
          });
        }

        // Compare current combined hash against on-chain workspace hash
        const matched = currentHash.combinedHash === lastAnchor.workspaceHash;
        return ok({
          verified: matched,
          lastAnchorTxid: lastAnchor.txid,
          currentCombinedHash: currentHash.combinedHash,
          anchoredCombinedHash: lastAnchor.workspaceHash,
          files: currentHash.files,
          message: matched
            ? 'Workspace integrity verified against on-chain anchor.'
            : 'Workspace has changed since last on-chain anchor.',
        });
      },
    });
  }

  private registerVerifySessionTool(sessionsPath: string): void {
    this.register({
      definition: {
        name: 'agid_verify_session',
        description: 'Verify the anchor chain integrity for a past session. Walks the hash chain and confirms all links.',
        input_schema: {
          type: 'object',
          properties: {
            sessionId: { type: 'string', description: 'Session ID to verify' },
          },
          required: ['sessionId'],
        },
      },
      execute: async (params) => {
        const sessionId = params.sessionId as string;
        const safe = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_');
        const anchorPath = path.join(sessionsPath, `${safe}.anchor.json`);

        if (!fs.existsSync(anchorPath)) {
          return ok({ verified: false, error: `No anchor chain found for session: ${sessionId}` });
        }

        const data: AnchorChainData = JSON.parse(fs.readFileSync(anchorPath, 'utf8'));
        const chain = AnchorChain.fromSerialized(data);
        const verification = await chain.verify();
        const merkleRoot = await chain.getMerkleRoot();

        return ok({
          verified: verification.valid,
          sessionId: data.sessionId,
          anchorCount: data.anchors.length,
          headHash: data.headHash,
          merkleRoot,
          errors: verification.errors,
        });
      },
    });
  }
}

function ok(data: Record<string, unknown>): ToolResult {
  return { content: JSON.stringify(data, null, 2) };
}
