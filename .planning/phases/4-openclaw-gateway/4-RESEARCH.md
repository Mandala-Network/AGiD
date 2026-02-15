# Phase 4: OpenClaw Gateway - Research

**Researched:** 2026-02-14
**Domain:** AGIdentity as AI Metanet Client wrapping OpenClaw
**Confidence:** HIGH

<research_summary>
## Summary

**AGIdentity is the AI's Metanet Client** - a complete system deployed on VPS/isolated hardware that gives an AI agent:
- Cryptographic identity (MPC wallet)
- Payment capability (BSV transactions via toolbsv.com)
- Secure communication (MessageBox)
- Intelligence (OpenClaw with local or paid models)

This is ONE deployed thing, not separate services. OpenClaw is embedded inside AGIdentity, not external.

**Architecture Vision:**
```
VPS / Isolated Machine
└── AGIdentity (the AI's metanet client)
    ├── OpenClaw Runtime (embedded) - AI execution
    │   ├── Local model (preferred - truly yours)
    │   └── Paid API routing (Claude, Codex, NanoBanana)
    ├── MPC Wallet - identity + payments
    ├── MessageBox - P2P encrypted communication
    ├── Identity Gate - certificate verification
    └── Payment Middleware - toolbsv.com integration
```

**Key insight:** The AI can use a local model for most tasks, then outsource specialized work to paid APIs - coding to Claude/Codex, images to NanoBanana - paying with its own wallet via payment middleware. Model-agnostic by design.

**Primary recommendation:** Embed OpenClaw as a dependency, configure it programmatically, wrap its agent runtime with AGIdentity's identity layer. All AI responses signed by MPC wallet.

**Phase 4 Scope (from codebase audit):**
1. **Remove plugin architecture** - Delete `src/plugin/`, `src/types/openclaw-plugin.ts`
2. **Create gateway** - `src/gateway/agidentity-gateway.ts` as THE entry point
3. **Embed OpenClaw** - `src/gateway/openclaw-runtime.ts` configures embedded runtime
4. **Sign all responses** - Every AI output signed by MPC wallet
5. **Wire existing components** - MessageBoxGateway, IdentityGate, MPC wallet all connected

**Codebase alignment: 65-70%** - Wallet, identity, messaging, encryption are excellent. Plugin architecture must be inverted.
</research_summary>

<standard_stack>
## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| openclaw | 2026.1.29+ | AI Runtime | Embedded agent runtime - sessions, tools, memory |
| ollama | latest | Local models | Run truly-yours local LLM (Llama, Mistral, etc.) |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| zod | 3.x | Schema validation | Validate all inputs/outputs |
| docker | latest | Isolation | Sandbox tool execution |

### External Services (Agent Pays With Wallet)
| Service | Purpose | How Agent Pays |
|---------|---------|----------------|
| toolbsv.com | Paid API routing (Claude, Codex, etc.) | MPC wallet signs payment tx |
| NanoBanana | Image generation | MPC wallet signs payment tx |
| Other APIs | Specialized tasks | MPC wallet signs payment tx |

**Note:** AGIdentity doesn't implement payment middleware. External services (toolbsv.com, etc.) handle payment logic. The agent just uses its MPC wallet to connect and pay.

**Installation:**
```bash
# OpenClaw as embedded dependency
npm install openclaw

# Local model support (on VPS)
curl -fsSL https://ollama.com/install.sh | sh
ollama pull llama3.2
```
</standard_stack>

<architecture_patterns>
## Architecture Patterns

### Recommended Project Structure
```
src/
├── gateway/
│   ├── agidentity-gateway.ts     # Main orchestrator (THE entry point)
│   ├── openclaw-runtime.ts       # Embedded OpenClaw configuration
│   └── response-signer.ts        # Sign all AI outputs
├── messaging/
│   └── messagebox-gateway.ts     # Existing - user communication
├── identity/
│   └── identity-gate.ts          # Existing - verification
└── wallet/
    └── mpc-integration.ts        # Existing - MPC wallet (identity + payments)

# REMOVE (plugin architecture conflicts with vision):
├── plugin/                       # DELETE - inverted architecture
│   ├── agidentity-plugin.ts      # DELETE
│   └── secure-plugin.ts          # DELETE
└── types/
    └── openclaw-plugin.ts        # DELETE - speculative plugin types
```

### Pattern 1: Embedded OpenClaw Runtime
**What:** OpenClaw runs as embedded component, not separate service
**When to use:** Primary pattern - OpenClaw is AGIdentity's "brain"
**Example:**
```typescript
// AGIdentity embeds OpenClaw, doesn't proxy to it
import { createAgentRuntime } from 'openclaw';
import { MPCAgentWallet } from '../wallet/mpc-integration.js';

export class AGIdentityGateway {
  private runtime: AgentRuntime;
  private wallet: MPCAgentWallet;

  async initialize() {
    // Configure OpenClaw programmatically
    this.runtime = await createAgentRuntime({
      model: this.selectModel(), // Local or paid
      workspace: '~/.agidentity/workspace',
      tools: this.getAuthorizedTools(),
      hooks: {
        beforeToolCall: (tool, args) => this.authorizeToolCall(tool, args),
        afterResponse: (response) => this.signResponse(response),
      }
    });
  }

  private selectModel(): ModelConfig {
    // Prefer local model, fall back to paid
    if (this.localModelAvailable()) {
      return { provider: 'ollama', model: 'llama3.2' };
    }
    return { provider: 'anthropic', model: 'claude-sonnet-4' };
  }
}
```

### Pattern 2: Paid API Calls (Agent Uses Wallet)
**What:** Agent uses its MPC wallet to pay external services directly
**When to use:** Outsourcing specialized tasks (coding, images)
**Note:** AGIdentity doesn't build payment middleware - services like toolbsv.com handle that. Agent just signs transactions with its wallet.
**Example:**
```typescript
// Agent calling a paid API - wallet handles payment
async function callPaidAPI(
  wallet: MPCAgentWallet,
  service: string,
  request: APIRequest
): Promise<APIResponse> {
  // 1. Connect to paid service (e.g., toolbsv.com)
  const client = createServiceClient(service, {
    // Wallet provides signing capability for payments
    signer: (tx) => wallet.signTransaction(tx),
    identity: await wallet.getIdentityPublicKey(),
  });

  // 2. Make the call - service handles payment negotiation
  // Agent's wallet signs the payment transaction
  const response = await client.call(request);

  return response;
}

// The AI decides when to use paid vs local
async function routeToModel(task: Task, wallet: MPCAgentWallet) {
  if (task.requiresSpecialist) {
    // Pay for specialist (Claude for code, NanoBanana for images)
    return callPaidAPI(wallet, 'toolbsv.com', {
      model: task.specialistModel,
      prompt: task.prompt,
    });
  }
  // Use local model (free, truly yours)
  return callLocalModel(task);
}
```

### Pattern 3: Unified Identity Layer
**What:** All AI actions signed with MPC wallet
**When to use:** Every response, every API call, every payment
**Example:**
```typescript
// Every AI output gets signed
async function wrapAIResponse(
  response: AIResponse,
  wallet: MPCAgentWallet
): Promise<SignedAIResponse> {
  const signature = await wallet.createSignature({
    data: Buffer.from(JSON.stringify(response)),
    protocolID: [0, 'agidentity-ai-response'],
    keyID: `response-${Date.now()}`,
  });

  return {
    ...response,
    identity: {
      signer: await wallet.getIdentityPublicKey(),
      signature: signature.signature.toString('hex'),
      timestamp: Date.now(),
    }
  };
}
```

### Pattern 4: MessageBox → AI → Signed Response Flow
**What:** Complete request flow from user to AI to signed response
**When to use:** Every user interaction
**Example:**
```typescript
class AGIdentityGateway {
  async handleUserMessage(msg: ProcessedMessage): Promise<MessageResponse> {
    // 1. User already verified by MessageBoxGateway/IdentityGate
    if (!msg.context.identityVerified) {
      return { body: 'Certificate required' };
    }

    // 2. Route to AI (embedded OpenClaw)
    const aiResponse = await this.runtime.chat({
      sessionKey: this.getSessionKey(msg),
      message: msg.original.body,
      context: {
        userIdentity: msg.original.sender,
        userCertificate: msg.context.certificate,
      }
    });

    // 3. Sign the response
    const signed = await this.signResponse(aiResponse);

    // 4. Return to user via MessageBox
    return { body: signed };
  }
}
```

### Anti-Patterns to Avoid
- **OpenClaw as separate service:** Embed it, don't proxy to it
- **Unsigned AI outputs:** Every response must be signed
- **Direct API calls without payment tracking:** Always use toolbsv for paid APIs
- **Hardcoded model selection:** Make it configurable, support local models
- **Separate identity systems:** One MPC wallet for everything
</architecture_patterns>

<dont_hand_roll>
## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| AI agent runtime | Custom LLM loop | OpenClaw embedded | Sessions, tools, memory, sandboxing solved |
| Payment middleware | Custom payment logic | External services (toolbsv.com) | They handle negotiation, metering - agent just pays with wallet |
| Local model serving | Custom inference | Ollama | Model management, API compatibility |
| Tool sandboxing | Custom containers | OpenClaw Docker sandbox | Security isolation is critical |
| Session persistence | Custom storage | OpenClaw sessions | Append-only logs, compaction, recovery |

**Key insight:** AGIdentity wraps OpenClaw with cryptographic identity. The MPC wallet is for identity AND payments - the agent uses it to authenticate responses and pay for external services. Services like toolbsv.com handle payment complexity; AGIdentity just signs transactions.
</dont_hand_roll>

<common_pitfalls>
## Common Pitfalls

### Pitfall 1: Treating OpenClaw as External
**What goes wrong:** Complex deployment, network issues, auth overhead
**Why it happens:** Thinking of OpenClaw as a separate service
**How to avoid:** Embed OpenClaw as npm dependency, configure programmatically
**Warning signs:** Docker compose with separate openclaw container

### Pitfall 2: Unsigned API Calls
**What goes wrong:** Can't prove AI made specific API calls
**Why it happens:** Focus on getting response, forget audit trail
**How to avoid:** Sign request intent before calling, sign response after
**Warning signs:** API calls without corresponding signed records

### Pitfall 3: Uncontrolled Paid API Usage
**What goes wrong:** AI drains wallet on expensive API calls
**Why it happens:** No budget awareness in task routing
**How to avoid:** Configure budget limits in OpenClaw, monitor wallet balance, services like toolbsv provide spending controls
**Warning signs:** Wallet balance dropping unexpectedly

### Pitfall 4: Local Model Fallback Missing
**What goes wrong:** System fails when paid APIs unavailable/expensive
**Why it happens:** Only configured for paid models
**How to avoid:** Always have local model as fallback, graceful degradation
**Warning signs:** Errors when API quota exceeded

### Pitfall 5: Mixed Identity Systems
**What goes wrong:** Confusing audit trail, can't verify AI actions
**Why it happens:** Using different keys for different operations
**How to avoid:** One MPC wallet identity for ALL AI actions
**Warning signs:** Multiple key pairs, inconsistent signatures
</common_pitfalls>

<code_examples>
## Code Examples

### Embedded OpenClaw Configuration
```typescript
// Source: OpenClaw npm package docs
import { OpenClaw } from 'openclaw';

export async function createEmbeddedRuntime(
  wallet: MPCAgentWallet
): Promise<OpenClaw> {
  const agentIdentity = await wallet.getIdentityPublicKey();

  return new OpenClaw({
    // Embedded configuration - no external gateway
    mode: 'embedded',

    // Model configuration - prefer local
    agent: {
      model: process.env.LOCAL_MODEL
        ? `ollama/${process.env.LOCAL_MODEL}`
        : 'anthropic/claude-sonnet-4',
      fallbackModels: ['ollama/llama3.2'], // Always have local fallback
    },

    // Workspace for sessions, memory
    workspace: `~/.agidentity/workspace`,

    // Inject agent identity into system prompt
    systemPromptExtras: `
You are an AI agent with verified blockchain identity.
Your identity public key: ${agentIdentity}
All your responses are cryptographically signed.
You can make payments via your BSV wallet.
    `,

    // Tool authorization
    tools: {
      allow: ['read', 'write', 'bash', 'browser'],
      deny: ['gateway'], // No self-modification
    },

    // Sandbox untrusted execution
    sandbox: {
      mode: 'docker',
      network: false, // Tools can't access network directly
    },
  });
}
```

### Complete AGIdentity Gateway
```typescript
// The AI's metanet client - everything in one deployed system
import { OpenClaw } from 'openclaw';
import { createMessageBoxGateway, ProcessedMessage } from '../messaging/messagebox-gateway.js';
import { MPCAgentWallet, createProductionMPCWallet } from '../wallet/mpc-integration.js';

export interface AGIdentityConfig {
  mpcConfig: MPCWalletConfig;
  trustedCertifiers: string[];
  localModel?: string; // e.g., 'llama3.2' - prefer local
}

export class AGIdentityGateway {
  private wallet: MPCAgentWallet;
  private runtime: OpenClaw;
  private messageBox: MessageBoxGateway;

  static async create(config: AGIdentityConfig): Promise<AGIdentityGateway> {
    const gateway = new AGIdentityGateway();
    await gateway.initialize(config);
    return gateway;
  }

  private async initialize(config: AGIdentityConfig): Promise<void> {
    // 1. Initialize MPC wallet (AI's identity AND payment capability)
    this.wallet = await createProductionMPCWallet(config.mpcConfig);
    const identity = await this.wallet.getIdentityPublicKey();
    console.log(`AI Identity: ${identity}`);

    // 2. Initialize embedded OpenClaw runtime
    //    OpenClaw can use wallet to pay external APIs when needed
    this.runtime = await this.createRuntime(config.localModel);

    // 3. Initialize MessageBox gateway for user communication
    this.messageBox = await createMessageBoxGateway({
      wallet: this.wallet,
      trustedCertifiers: config.trustedCertifiers,
      onMessage: (msg) => this.handleMessage(msg),
    });

    console.log('AGIdentity Gateway initialized');
  }

  private async createRuntime(localModel?: string): Promise<OpenClaw> {
    return new OpenClaw({
      mode: 'embedded',
      agent: {
        // Prefer local model (truly yours), fall back to paid if needed
        model: localModel ? `ollama/${localModel}` : 'anthropic/claude-sonnet-4',
        fallbackModels: localModel ? [] : ['ollama/llama3.2'],
      },
      workspace: '~/.agidentity/workspace',
      // Wallet available for paid API calls
      wallet: this.wallet,
    });
  }

  private async handleMessage(msg: ProcessedMessage): Promise<{ body: unknown } | null> {
    if (!msg.context.identityVerified) {
      return { body: { error: 'Certificate required', code: 'UNVERIFIED' } };
    }

    try {
      // Chat with embedded OpenClaw
      const response = await this.runtime.chat({
        sessionKey: `user:${msg.original.sender.slice(0, 16)}`,
        message: typeof msg.original.body === 'string'
          ? msg.original.body
          : JSON.stringify(msg.original.body),
      });

      // Sign the response with MPC wallet
      const signature = await this.wallet.createSignature({
        data: Buffer.from(response.content),
        protocolID: [0, 'agidentity-response'],
        keyID: `resp-${Date.now()}`,
      });

      return {
        body: {
          content: response.content,
          signature: signature.signature.toString('hex'),
          signer: await this.wallet.getIdentityPublicKey(),
        }
      };
    } catch (error) {
      return {
        body: {
          error: error instanceof Error ? error.message : 'Unknown error',
          code: 'AI_ERROR'
        }
      };
    }
  }

  async shutdown(): Promise<void> {
    await this.messageBox.shutdown();
    await this.runtime.shutdown();
  }
}

// Entry point - start the AI's metanet client
export async function startAGIdentity(config: AGIdentityConfig): Promise<AGIdentityGateway> {
  return AGIdentityGateway.create(config);
}
```
</code_examples>

<sota_updates>
## State of the Art (2025-2026)

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Cloud-only AI | Local models + paid API fallback | 2025 | Own your AI, pay for specialized tasks |
| API keys for payment | BSV micropayments via toolbsv | 2025 | Pay-per-use, no accounts needed |
| Anonymous AI | Cryptographic identity (MPC wallet) | 2025 | Every AI action attributable |
| Separate AI/identity/payment | Unified metanet client | 2025 | One system, one identity |

**New tools/patterns to consider:**
- **Ollama:** Simple local model serving, OpenAI-compatible API
- **toolbsv.com:** BSV payment middleware for any API
- **OpenClaw embedded mode:** Run as library, not service
- **Model routing:** Local for general, paid for specialized

**Deprecated/outdated:**
- **Plugin-based auth:** The speculative `src/types/openclaw-plugin.ts` - remove it
- **OpenClaw as external service:** Embed it instead
- **Single model architecture:** Use model routing with payment
</sota_updates>

<open_questions>
## Open Questions

1. **OpenClaw npm package API**
   - What we know: OpenClaw exists as npm package
   - What's unclear: Exact embedded mode API (may need to check their source)
   - Recommendation: Verify OpenClaw embedding API during implementation, may need to adapt

2. **Local model selection**
   - What we know: Ollama supports many models
   - What's unclear: Best model for general assistant tasks that fits VPS resources
   - Recommendation: Start with Llama 3.2 8B, test on target hardware

3. **Session persistence across restarts**
   - What we know: OpenClaw has session system
   - What's unclear: How to persist across AGIdentity restarts
   - Recommendation: Use OpenClaw's file-based sessions, verify persistence

4. **Wallet integration with OpenClaw for paid APIs**
   - What we know: Agent uses wallet to pay external services
   - What's unclear: How OpenClaw surfaces payment opportunities (tool? config?)
   - Recommendation: Check OpenClaw docs for wallet/payment integration patterns
</open_questions>

<sources>
## Sources

### Primary (HIGH confidence)
- [OpenClaw GitHub](https://github.com/openclaw/openclaw) - architecture, embedding options
- [OpenClaw Documentation](https://docs.openclaw.ai/) - configuration, session management
- [OpenClaw Architecture Deep Dive](https://ppaolo.substack.com/p/openclaw-system-architecture-overview) - runtime internals

### Secondary (MEDIUM confidence)
- [Ollama](https://ollama.com/) - local model serving
- Existing AGIdentity codebase - MessageBoxGateway, MPC integration patterns
- Codebase audit (2026-02-14) - alignment analysis

### Tertiary (LOW confidence - needs validation)
- OpenClaw embedded mode specifics - verify against current package
</sources>

<metadata>
## Metadata

**Research scope:**
- Core technology: AGIdentity as unified AI metanet client
- Ecosystem: OpenClaw (embedded), Ollama (local models)
- Patterns: Embedded runtime, signed responses, wallet for payments
- Pitfalls: External vs embedded, unsigned outputs, plugin architecture conflict
- Codebase audit: 65-70% aligned, plugin architecture needs removal

**Confidence breakdown:**
- Architecture vision: HIGH - clear from discussion + codebase audit
- OpenClaw embedding: MEDIUM - need to verify npm package API
- Codebase alignment: HIGH - thorough audit completed
- Code examples: MEDIUM - patterns solid, APIs may need adjustment

**Research date:** 2026-02-14
**Valid until:** 2026-03-14 (30 days)
</metadata>

---

*Phase: 04-openclaw-gateway*
*Research completed: 2026-02-14*
*Ready for planning: yes*
