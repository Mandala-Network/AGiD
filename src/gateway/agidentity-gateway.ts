/**
 * AGIdentity Gateway
 *
 * Bridges MessageBox → IdentityGate → Native Agent Loop → Wallet Sign.
 * Replaces the OpenClaw gateway with a native Anthropic API integration.
 * Same external behavior: every interaction is authenticated, signed, and audited.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { AgentWallet } from '../wallet/agent-wallet.js';
import type { ProcessedMessage, MessageResponse } from '../messaging/messagebox-gateway.js';
import type { IdentityContext } from '../agent/prompt-builder.js';
import { MessageBoxGateway, createMessageBoxGateway } from '../messaging/messagebox-gateway.js';
import { IdentityGate } from '../identity/identity-gate.js';
import { SignedAuditTrail } from '../audit/signed-audit.js';
import { AnchorChain } from '../audit/anchor-chain.js';
import { WorkspaceIntegrity } from '../audit/workspace-integrity.js';
import { lockPushDropToken } from '../wallet/pushdrop-ops.js';
import { ToolRegistry } from '../agent/tool-registry.js';
import type { ToolPlugin } from '../agent/tools/types.js';
import { PromptBuilder } from '../agent/prompt-builder.js';
import { SessionStore } from '../agent/session-store.js';
import { AgentLoop } from '../agent/agent-loop.js';
import { createProvider } from '../agent/providers/index.js';
import type { LLMProvider } from '../agent/llm-provider.js';
import { MemoryManager } from '../storage/memory/memory-manager.js';
import { GepaOptimizer } from '../integrations/gepa/gepa-optimizer.js';

// =============================================================================
// Types
// =============================================================================

export interface AGIdentityGatewayConfig {
  /** Agent wallet for identity and signing */
  wallet: AgentWallet;
  /** Trusted certificate authorities */
  trustedCertifiers: string[];
  /** LLM provider (default: creates AnthropicProvider from apiKey) */
  provider?: LLMProvider;
  /** Anthropic API key — used to create default AnthropicProvider if no provider given */
  apiKey?: string;
  /** Model for agent loop (default: claude-sonnet-4-5-20250929) */
  model?: string;
  /** Path to workspace files (default: ~/.agidentity/workspace/) */
  workspacePath?: string;
  /** Path to session files (default: ~/.agidentity/sessions/) */
  sessionsPath?: string;
  /** Max tool-use iterations per request (default: 25) */
  maxIterations?: number;
  /** Max tokens per LLM response (default: 8192) */
  maxTokens?: number;
  /** MessageBox configuration */
  messageBoxes?: string[];
  /** Whether to sign all AI responses (default: true) */
  signResponses?: boolean;
  /** Audit trail configuration */
  audit?: { enabled?: boolean };
  /** External tool plugins to register */
  plugins?: ToolPlugin[];
}

export interface SignedResponse {
  content: string;
  signature: string;
  signerPublicKey: string;
  signed: boolean;
}

// =============================================================================
// AGIdentityGateway Class
// =============================================================================

export class AGIdentityGateway {
  private config: AGIdentityGatewayConfig;
  private wallet: AgentWallet;
  private messageBoxGateway: MessageBoxGateway | null = null;
  private identityGate: IdentityGate | null = null;
  private auditTrail: SignedAuditTrail | null = null;
  private agentLoop: AgentLoop | null = null;
  private running = false;
  private agentPublicKey: string | null = null;
  private workspacePath: string = '';
  private sessionsPath: string = '';

  constructor(config: AGIdentityGatewayConfig) {
    this.config = config;
    this.wallet = config.wallet;
  }

  async initialize(): Promise<void> {
    if (this.running) return;

    // Get agent's public key
    const { publicKey } = await this.wallet.getPublicKey({ identityKey: true });
    this.agentPublicKey = publicKey;

    const home = process.env.HOME || '/tmp';
    this.workspacePath = this.config.workspacePath ?? path.join(home, '.agidentity', 'workspace');
    this.sessionsPath = this.config.sessionsPath ?? path.join(home, '.agidentity', 'sessions');
    const workspacePath = this.workspacePath;
    const sessionsPath = this.sessionsPath;
    const model = this.config.model ?? 'claude-sonnet-4-5-20250929';
    const maxIterations = this.config.maxIterations ?? 25;
    const maxTokens = this.config.maxTokens ?? 8192;

    // 1. Create IdentityGate
    this.identityGate = new IdentityGate({
      wallet: this.wallet,
      trustedCertifiers: this.config.trustedCertifiers,
    });
    await this.identityGate.initialize();

    // 2. Initialize GEPA optimizer (optional, graceful fallback)
    const gepaOptimizer = new GepaOptimizer();
    await gepaOptimizer.initialize();
    if (gepaOptimizer.available) {
      console.log(`[AGIdentityGateway] 🧬 GEPA available (v${gepaOptimizer.version}) — optimizing prompts, tools, and memories`);
    } else {
      console.log('[AGIdentityGateway] GEPA not available — using unoptimized prompts. Install with: pip install gepa');
    }

    // 3. Set up agent components
    const memoryManager = new MemoryManager(this.wallet, { workspacePath, gepaOptimizer });
    const toolRegistry = new ToolRegistry();
    toolRegistry.registerBuiltinTools(this.wallet, workspacePath, sessionsPath, memoryManager);

    // Register external plugins
    if (this.config.plugins?.length) {
      const ctx = { wallet: this.wallet, workspacePath, sessionsPath, memoryManager };
      toolRegistry.registerPlugins(this.config.plugins, ctx);
    }

    // GEPA-optimize tool descriptions at registration time
    if (gepaOptimizer.available) {
      const optimizedCount = await toolRegistry.optimizeDescriptions(gepaOptimizer);
      console.log(`[AGIdentityGateway] 🧬 GEPA optimized ${optimizedCount} tool descriptions`);
    }

    const network = await this.wallet.getNetwork();
    const promptBuilder = new PromptBuilder({
      workspacePath,
      agentPublicKey: this.agentPublicKey,
      network,
      gepaOptimizer,
    });

    const sessionStore = new SessionStore({ sessionsPath });

    // Create or use provided LLM provider
    const provider = this.config.provider ?? (() => {
      if (this.config.apiKey) {
        return createProvider({ type: 'anthropic', anthropicApiKey: this.config.apiKey });
      }
      // Auto-detect from environment
      return createProvider();
    })();

    this.agentLoop = new AgentLoop({
      toolRegistry,
      sessionStore,
      promptBuilder,
      model,
      provider,
      maxIterations,
      maxTokens,
    });

    console.log('[AGIdentityGateway] ✅ Agent loop initialized');
    console.log(`[AGIdentityGateway]    Model: ${model}`);
    console.log(`[AGIdentityGateway]    Workspace: ${workspacePath}`);
    console.log(`[AGIdentityGateway]    Tools: ${toolRegistry.getDefinitions().length}`);

    // 3. Create MessageBoxGateway
    this.messageBoxGateway = await createMessageBoxGateway({
      wallet: this.wallet,
      trustedCertifiers: this.config.trustedCertifiers,
      onMessage: async (message) => this.handleMessage(message),
      options: {
        messageBoxes: this.config.messageBoxes ?? ['inbox', 'chat'],
        onError: (error) => {
          console.error('[AGIdentityGateway] MessageBox error:', error.type, error.message);
        },
      },
    });

    // 4. Auto-receive certificates from trusted certifiers
    this.startCertListener();

    // 5. Create SignedAuditTrail if enabled
    if (this.config.audit?.enabled !== false) {
      this.auditTrail = new SignedAuditTrail({ wallet: this.wallet });
    }

    // 6. Start message polling AFTER all initialization
    this.messageBoxGateway.startMessagePolling();

    this.running = true;
  }

  // ===========================================================================
  // Certificate Listener
  // ===========================================================================

  private startCertListener(): void {
    const mbClient = (this.wallet as any).getMessageBoxClient?.();
    if (!mbClient) return;

    const trustedSet = new Set(this.config.trustedCertifiers);
    const checkInterval = 60_000; // Check every 60 seconds

    const poll = async () => {
      if (!this.running) return;
      try {
        const messages = await mbClient.listMessages({ messageBox: 'certificate_inbox' });
        for (const msg of messages) {
          try {
            const body = typeof msg.body === 'string' ? JSON.parse(msg.body) : msg.body;
            if (body?.type === 'certificate_issuance' && body.serializedCertificate) {
              // Only auto-receive from trusted certifiers
              if (!trustedSet.has(msg.sender)) {
                console.log(`[AGIdentityGateway] Ignoring cert from untrusted sender: ${msg.sender.substring(0, 12)}...`);
                continue;
              }

              const { PeerCert } = await import('peercert');
              const peerCert = new PeerCert(this.wallet.asWalletInterface() as any);
              const result = await peerCert.receive(body.serializedCertificate);
              if (result.success) {
                console.log(`[AGIdentityGateway] Auto-received certificate from ${msg.sender.substring(0, 12)}... (fields: ${Object.keys(result.walletCertificate?.fields ?? {}).join(', ')})`);
              }
              await mbClient.acknowledgeMessage({ messageIds: [msg.messageId] });
            }
          } catch {
            // Skip malformed cert messages
          }
        }
      } catch {
        // MessageBox polling error — will retry
      }
      if (this.running) {
        setTimeout(poll, checkInterval);
      }
    };

    // Start after a short delay to let other initialization complete
    setTimeout(poll, 5_000);
  }

  // ===========================================================================
  // Message Handling
  // ===========================================================================

  private async handleMessage(message: ProcessedMessage): Promise<MessageResponse | null> {
    const t0 = Date.now();
    const ts = () => `[t=${Date.now() - t0}ms]`;
    const senderKey = message.original.sender;
    console.log(`[AGIdentityGateway] 📨 Message from ${senderKey.substring(0, 12)}... (box: ${message.original.messageBox ?? 'unknown'}) ${ts()}`);

    // Parse ChatRequest protocol
    let content: string;
    let requestId: string | undefined;
    const rawBody = message.original.body;

    if (typeof rawBody === 'object' && rawBody !== null && 'type' in rawBody && (rawBody as any).type === 'chat_request') {
      content = (rawBody as any).content ?? JSON.stringify(rawBody);
      requestId = (rawBody as any).id;
    } else if (typeof rawBody === 'string') {
      try {
        const parsed = JSON.parse(rawBody);
        if (parsed.type === 'chat_request') {
          content = parsed.content ?? rawBody;
          requestId = parsed.id;
        } else {
          content = rawBody;
        }
      } catch {
        content = rawBody;
      }
    } else {
      content = JSON.stringify(rawBody);
    }

    // Audit incoming message
    console.log(`[AGIdentityGateway]    Audit incoming... ${ts()}`);
    if (this.auditTrail) {
      await this.auditTrail.createEntry({
        action: 'message.received',
        userPublicKey: senderKey,
        agentPublicKey: this.agentPublicKey!,
        input: content,
        metadata: {
          conversationId: message.context.conversationId,
          verified: message.context.identityVerified,
          certificateType: message.context.certificate?.type,
        },
      });
      console.log(`[AGIdentityGateway]    Audit done ${ts()}`);
    }

    // Certificate enforcement (when AGID_REQUIRE_CERTS=true)
    if (process.env.AGID_REQUIRE_CERTS === 'true') {
      if (!message.context.identityVerified || !message.context.certificate) {
        console.log(`[AGIdentityGateway] Rejected uncertified sender: ${senderKey.substring(0, 12)}...`);
        return {
          body: {
            type: 'chat_response',
            id: crypto.randomUUID(),
            requestId,
            timestamp: Date.now(),
            content: 'Access denied: a valid certificate from a trusted certifier is required to communicate with this agent.',
            agent: this.agentPublicKey,
            signed: false,
          },
        };
      }
    }

    // Build identity context
    const identityContext: IdentityContext = {
      senderPublicKey: senderKey,
      verified: message.context.identityVerified,
      conversationId: message.context.conversationId,
    };
    if (message.context.certificate) {
      identityContext.certificateSubject =
        message.context.certificate.fields.name ??
        message.context.certificate.fields.employeeId ??
        message.context.certificate.subject;
      identityContext.certificateType = message.context.certificate.type;
      identityContext.certificateRole = message.context.certificate.fields.role;
    }

    // Create anchor chain for this session
    const anchorChain = new AnchorChain(identityContext.conversationId, this.agentPublicKey!);

    // Check workspace integrity
    console.log(`[AGIdentityGateway]    Workspace integrity check... ${ts()}`);
    let workspaceHash: { combinedHash: string } | undefined;
    try {
      const wsIntegrity = new WorkspaceIntegrity(this.workspacePath);
      const currentHash = await wsIntegrity.hashWorkspace();
      workspaceHash = currentHash;
      console.log(`[AGIdentityGateway]    Workspace hashed ${ts()}`);
      const lastAnchor = await wsIntegrity.getLastAnchor(this.wallet);
      console.log(`[AGIdentityGateway]    Last anchor retrieved ${ts()}`);

      if (lastAnchor) {
        // Compare combined hashes — we only have the combined hash from on-chain
        if (currentHash.combinedHash !== lastAnchor.workspaceHash) {
          identityContext.workspaceIntegrity = {
            verified: false,
            lastAnchorTxid: lastAnchor.txid,
            modifiedFiles: ['(workspace changed since last anchor)'],
            missingFiles: [],
            newFiles: [],
          };
        } else {
          identityContext.workspaceIntegrity = {
            verified: true,
            lastAnchorTxid: lastAnchor.txid,
            modifiedFiles: [],
            missingFiles: [],
            newFiles: [],
          };
        }
      }

      await anchorChain.addAnchor({
        type: 'session_start',
        data: { workspaceHash: currentHash.combinedHash, files: currentHash.files },
        summary: `Session start (workspace: ${currentHash.combinedHash.substring(0, 12)}...)`,
        metadata: identityContext.workspaceIntegrity ? { integrity: identityContext.workspaceIntegrity } : undefined,
      });
    } catch (error) {
      console.error('[AGIdentityGateway] Workspace integrity check failed:', error instanceof Error ? error.message : error);
    }

    // Run agent loop
    console.log(`[AGIdentityGateway] 🤖 Running agent loop (session: ${identityContext.conversationId}) ${ts()}`);
    let aiResponse: string;
    let toolCallCount = 0;
    try {
      const result = await this.agentLoop!.run(content, identityContext.conversationId, identityContext, anchorChain);
      aiResponse = result.response;
      toolCallCount = result.toolCalls.length;
      console.log(`[AGIdentityGateway] ✅ Agent responded (${aiResponse.length} chars, ${result.iterations} iterations, ${result.toolCalls.length} tool calls, ${result.usage.totalTokens} tokens) ${ts()}`);
    } catch (error) {
      console.error('[AGIdentityGateway] ❌ Agent loop error:', error instanceof Error ? error.message : error);
      aiResponse = 'Sorry, I encountered an error processing your request. Please try again.';
    }

    // Finalize anchor chain
    console.log(`[AGIdentityGateway]    Finalizing anchor chain... ${ts()}`);
    try {
      await anchorChain.addAnchor({
        type: 'session_end',
        data: { responseLength: aiResponse.length, toolCallCount },
        summary: `Session end (${toolCallCount} tool calls)`,
      });

      // Persist anchor chain to disk
      await this.persistAnchorChain(anchorChain);
      console.log(`[AGIdentityGateway]    Anchor persisted ${ts()}`);

      // Commit on-chain
      await this.commitAnchorOnChain(anchorChain, workspaceHash?.combinedHash ?? '0'.repeat(64));
      console.log(`[AGIdentityGateway]    Anchor committed on-chain ${ts()}`);
    } catch (error) {
      console.error('[AGIdentityGateway] Anchor chain finalization failed:', error instanceof Error ? error.message : error);
    }

    // Sign response
    console.log(`[AGIdentityGateway]    Signing response... ${ts()}`);
    let signedResponse: SignedResponse;
    if (this.config.signResponses !== false) {
      signedResponse = await this.signResponse(aiResponse);
      console.log(`[AGIdentityGateway]    Response signed ${ts()}`);
    } else {
      signedResponse = {
        content: aiResponse,
        signature: '',
        signerPublicKey: this.agentPublicKey!,
        signed: false,
      };
    }

    // Audit outgoing message
    if (this.auditTrail) {
      await this.auditTrail.createEntry({
        action: 'message.sent',
        userPublicKey: senderKey,
        agentPublicKey: this.agentPublicKey!,
        output: aiResponse,
        metadata: {
          conversationId: message.context.conversationId,
          signed: signedResponse.signed,
        },
      });
    }

    // Return ChatResponse protocol
    return {
      body: {
        type: 'chat_response',
        id: crypto.randomUUID(),
        requestId,
        timestamp: Date.now(),
        content: signedResponse.content,
        agent: this.agentPublicKey,
        signature: signedResponse.signature,
        signerPublicKey: signedResponse.signerPublicKey,
        signed: signedResponse.signed,
      },
    };
  }

  // ===========================================================================
  // Anchor Chain Persistence & On-Chain Commit
  // ===========================================================================

  private async persistAnchorChain(chain: AnchorChain): Promise<void> {
    const data = await chain.serializeWithMerkle();
    const safe = chain.getSessionId().replace(/[^a-zA-Z0-9_-]/g, '_');
    const anchorPath = path.join(this.sessionsPath, `${safe}.anchor.json`);
    fs.writeFileSync(anchorPath, JSON.stringify(data, null, 2), 'utf8');
    console.log(`[AGIdentityGateway] 📎 Anchor chain persisted (${chain.getAnchorCount()} anchors → ${anchorPath})`);
  }

  private async commitAnchorOnChain(chain: AnchorChain, workspaceCombinedHash: string): Promise<void> {
    try {
      const merkleRoot = await chain.getMerkleRoot();
      const result = await lockPushDropToken(this.wallet, {
        fields: [
          'agidentity-anchor-v1',
          chain.getSessionId(),
          merkleRoot,
          chain.getHeadHash(),
          workspaceCombinedHash,
          String(chain.getAnchorCount()),
        ],
        protocolID: [2, 'agidentity anchor'],
        keyID: `anchor-${chain.getSessionId()}`,
        basket: 'anchor-chain',
        description: `Anchor chain: ${chain.getSessionId()} (${chain.getAnchorCount()} anchors)`,
      });
      console.log(`[AGIdentityGateway] ⚓ Anchor chain committed on-chain (txid: ${result.txid})`);
    } catch (error) {
      console.error('[AGIdentityGateway] On-chain anchor commit failed:', error instanceof Error ? error.message : error);
    }
  }

  // ===========================================================================
  // Response Signing
  // ===========================================================================

  private async signResponse(response: string): Promise<SignedResponse> {
    try {
      const data = Array.from(new TextEncoder().encode(response));
      const keyId = `response-${Date.now()}`;

      const signature = await this.wallet.createSignature({
        data,
        protocolID: [0, 'agidentity response'],
        keyID: keyId,
      });

      const signatureHex = Array.from(signature.signature)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');

      return {
        content: response,
        signature: signatureHex,
        signerPublicKey: this.agentPublicKey!,
        signed: true,
      };
    } catch (error) {
      console.error('[AGIdentityGateway] Signing failed:', error);
      return {
        content: response,
        signature: '',
        signerPublicKey: this.agentPublicKey!,
        signed: false,
      };
    }
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  async shutdown(): Promise<void> {
    if (!this.running) return;
    this.running = false;

    if (this.messageBoxGateway) {
      await this.messageBoxGateway.shutdown();
      this.messageBoxGateway = null;
    }

    this.identityGate = null;
    this.auditTrail = null;
  }

  isRunning(): boolean {
    return this.running;
  }

  getIdentityGate(): IdentityGate | null {
    return this.identityGate;
  }

  getMessageBoxGateway(): MessageBoxGateway | null {
    return this.messageBoxGateway;
  }

  getAuditTrail(): SignedAuditTrail | null {
    return this.auditTrail;
  }

  getAgentPublicKey(): string | null {
    return this.agentPublicKey;
  }

}
