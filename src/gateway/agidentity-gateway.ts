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
import { ProgressEmitter } from '../messaging/progress-emitter.js';
import type { ProgressEvent } from '../messaging/progress-emitter.js';
import type { ToolRequest, ToolResponse } from '../types/agent-types.js';
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
  private toolRegistry: ToolRegistry | null = null;
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
    this.toolRegistry = toolRegistry;
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
    console.log(`[AGIdentityGateway] Message from ${senderKey.substring(0, 12)}... (box: ${message.original.messageBox ?? 'unknown'}) ${ts()}`);

    // -----------------------------------------------------------------------
    // 1. Parse raw body to determine message type
    // -----------------------------------------------------------------------
    const rawBody = message.original.body;
    let parsed: Record<string, unknown> | null = null;

    if (typeof rawBody === 'object' && rawBody !== null) {
      parsed = rawBody as Record<string, unknown>;
    } else if (typeof rawBody === 'string') {
      try {
        parsed = JSON.parse(rawBody);
      } catch {
        // Not JSON -- treat as plain text chat
      }
    }

    const messageType = parsed?.type as string | undefined;

    // -----------------------------------------------------------------------
    // 2. Audit incoming message
    // -----------------------------------------------------------------------
    const contentSummary = typeof rawBody === 'string' ? rawBody : JSON.stringify(rawBody);
    console.log(`[AGIdentityGateway]    Audit incoming... ${ts()}`);
    if (this.auditTrail) {
      await this.auditTrail.createEntry({
        action: 'message.received',
        userPublicKey: senderKey,
        agentPublicKey: this.agentPublicKey!,
        input: contentSummary,
        metadata: {
          conversationId: message.context.conversationId,
          verified: message.context.identityVerified,
          certificateType: message.context.certificate?.type,
          messageType,
        },
      });
      console.log(`[AGIdentityGateway]    Audit done ${ts()}`);
    }

    // -----------------------------------------------------------------------
    // 3. Certificate enforcement (when AGID_REQUIRE_CERTS=true)
    // -----------------------------------------------------------------------
    if (process.env.AGID_REQUIRE_CERTS === 'true') {
      if (!message.context.identityVerified || !message.context.certificate) {
        console.log(`[AGIdentityGateway] Rejected uncertified sender: ${senderKey.substring(0, 12)}...`);
        return {
          body: {
            type: messageType === 'tool_request' ? 'tool_response' : 'chat_response',
            id: crypto.randomUUID(),
            requestId: parsed?.id as string | undefined,
            timestamp: Date.now(),
            content: 'Access denied: a valid certificate from a trusted certifier is required to communicate with this agent.',
            agent: this.agentPublicKey,
            signed: false,
          },
        };
      }
    }

    // -----------------------------------------------------------------------
    // 4. Route by message type
    // -----------------------------------------------------------------------
    if (messageType === 'tool_request') {
      return this.handleToolRequest(message, parsed as unknown as ToolRequest, ts);
    }

    // Default: chat_request or plain text
    return this.handleChatRequest(message, parsed, rawBody, ts);
  }

  // ===========================================================================
  // Tool Request Handler (direct tool invocation via MessageBox)
  // ===========================================================================

  private async handleToolRequest(
    message: ProcessedMessage,
    request: ToolRequest,
    ts: () => string,
  ): Promise<MessageResponse | null> {
    const senderKey = message.original.sender;
    const senderMessageBox = message.original.messageBox ?? 'inbox';
    const requestId = request.id ?? crypto.randomUUID();
    const toolName = request.toolName;
    const parameters = request.parameters;

    console.log(`[AGIdentityGateway] Tool request: ${toolName} (id: ${requestId}) ${ts()}`);

    // Validate toolName exists in the registry
    const definitions = this.toolRegistry!.getDefinitions();
    const toolExists = definitions.some((d) => d.name === toolName);
    if (!toolExists) {
      console.log(`[AGIdentityGateway] Unknown tool: ${toolName} ${ts()}`);
      const errorResponse = await this.buildToolResponse(requestId, toolName, `Unknown tool: ${toolName}`, true);
      return { body: { ...errorResponse } };
    }

    // Validate parameters is a non-null, non-array object
    if (parameters === null || parameters === undefined || typeof parameters !== 'object' || Array.isArray(parameters)) {
      console.log(`[AGIdentityGateway] Invalid parameters for ${toolName} ${ts()}`);
      const errorResponse = await this.buildToolResponse(requestId, toolName, 'Invalid parameters: expected a non-null object', true);
      return { body: { ...errorResponse } };
    }

    // Create ProgressEmitter for tool execution events (same pattern as chat_request)
    const onEvent = async (event: ProgressEvent) => {
      try {
        await this.messageBoxGateway!.getMessageClient().sendMessage(
          senderKey,
          senderMessageBox,
          JSON.stringify(event),
        );
      } catch (eventError) {
        // Progress events are best-effort
        console.error('[AGIdentityGateway] Failed to send progress event:', eventError instanceof Error ? eventError.message : eventError);
      }
    };
    const emitter = new ProgressEmitter(onEvent);

    // Emit tool_start
    try {
      await emitter.emitToolStart(requestId, toolName);
    } catch {
      // best-effort
    }

    // Execute the tool
    let resultContent: string;
    let isError = false;
    try {
      const toolResult = await this.toolRegistry!.execute(toolName, parameters);
      resultContent = toolResult.content;
      isError = toolResult.isError ?? false;
      console.log(`[AGIdentityGateway] Tool ${toolName} ${isError ? 'failed' : 'completed'} (${resultContent.length} chars) ${ts()}`);
    } catch (error) {
      resultContent = error instanceof Error ? error.message : String(error);
      isError = true;
      console.error(`[AGIdentityGateway] Tool ${toolName} threw:`, resultContent, ts());
    }

    // Emit tool_result
    try {
      const errorType = isError ? this.extractErrorType(resultContent) : undefined;
      await emitter.emitToolResult(requestId, toolName, isError ? 'failed' : 'completed', errorType);
    } catch {
      // best-effort
    }

    // Build signed ToolResponse
    const toolResponse = await this.buildToolResponse(requestId, toolName, resultContent, isError);

    // Audit outgoing tool response
    if (this.auditTrail) {
      await this.auditTrail.createEntry({
        action: 'tool_response.sent',
        userPublicKey: senderKey,
        agentPublicKey: this.agentPublicKey!,
        output: resultContent,
        metadata: {
          conversationId: message.context.conversationId,
          toolName,
          isError,
          signed: toolResponse.signed,
        },
      });
    }

    return { body: { ...toolResponse } };
  }

  /**
   * Build a signed ToolResponse message.
   */
  private async buildToolResponse(
    requestId: string,
    toolName: string,
    result: string,
    isError: boolean,
  ): Promise<ToolResponse> {
    let signature = '';
    let signed = false;

    if (this.config.signResponses !== false) {
      try {
        const signedResult = await this.signResponse(result);
        signature = signedResult.signature;
        signed = signedResult.signed;
      } catch {
        // Signing failed -- return unsigned response
      }
    }

    return {
      type: 'tool_response',
      id: crypto.randomUUID(),
      requestId,
      toolName,
      result,
      isError,
      timestamp: Date.now(),
      agent: this.agentPublicKey!,
      signature,
      signed,
    };
  }

  /**
   * Extract a PascalCase error type name from an error string.
   * Same approach as the extractErrorType() in agent-loop -- provides summary-level
   * error transparency without exposing stack traces.
   */
  private extractErrorType(errorStr: string): string | undefined {
    // Try to extract from JSON-wrapped errors
    try {
      const parsed = JSON.parse(errorStr);
      if (parsed.error && typeof parsed.error === 'string') {
        errorStr = parsed.error;
      }
    } catch {
      // Not JSON
    }
    // Match PascalCase error class names (e.g. "InsufficientFunds", "TypeError")
    const match = errorStr.match(/\b([A-Z][a-zA-Z]*(?:Error|Exception|Fault))\b/);
    return match?.[1];
  }

  // ===========================================================================
  // Chat Request Handler (LLM-driven agent loop)
  // ===========================================================================

  private async handleChatRequest(
    message: ProcessedMessage,
    parsed: Record<string, unknown> | null,
    rawBody: string | Record<string, unknown>,
    ts: () => string,
  ): Promise<MessageResponse | null> {
    const senderKey = message.original.sender;

    // Extract content and requestId from chat_request or plain text
    let content: string;
    let requestId: string | undefined;

    if (parsed && parsed.type === 'chat_request') {
      content = (parsed.content as string) ?? JSON.stringify(rawBody);
      requestId = parsed.id as string | undefined;
    } else if (typeof rawBody === 'string') {
      content = rawBody;
    } else {
      content = JSON.stringify(rawBody);
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
        // Compare combined hashes -- we only have the combined hash from on-chain
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

    // Run agent loop with progress event emission
    console.log(`[AGIdentityGateway] Running agent loop with events (session: ${identityContext.conversationId}) ${ts()}`);
    let aiResponse: string;
    let toolCallCount = 0;

    // Progress event callback: send each event as a MessageBox message to the original sender
    const senderMessageBox = message.original.messageBox ?? 'inbox';
    const onEvent = async (event: ProgressEvent) => {
      try {
        await this.messageBoxGateway!.getMessageClient().sendMessage(
          senderKey,
          senderMessageBox,
          JSON.stringify(event),
        );
      } catch (eventError) {
        // Progress events are best-effort; do not fail the agent loop
        console.error('[AGIdentityGateway] Failed to send progress event:', eventError instanceof Error ? eventError.message : eventError);
      }
    };

    try {
      const result = await this.agentLoop!.runWithEvents(content, identityContext.conversationId, onEvent, identityContext, anchorChain);
      aiResponse = result.response;
      toolCallCount = result.toolCalls.length;
      console.log(`[AGIdentityGateway] Agent responded (${aiResponse.length} chars, ${result.iterations} iterations, ${result.toolCalls.length} tool calls, ${result.usage.totalTokens} tokens) ${ts()}`);
    } catch (error) {
      console.error('[AGIdentityGateway] Agent loop error:', error instanceof Error ? error.message : error);
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
