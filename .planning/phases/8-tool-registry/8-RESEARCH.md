# Phase 8: Tool Registry System - Research

**Researched:** 2026-02-15
**Domain:** LLM tool execution, Claude API integration, agent security
**Confidence:** HIGH

<research_summary>
## Summary

Researched the current ecosystem for building safe, production-ready tool registries for LLM agents with blockchain wallet access. The 2026 landscape has matured significantly with established standards (MCP), production-ready platforms (LangGraph, E2B), and enterprise security tools.

**Key finding:** Don't build core infrastructure yourself. The Claude Messages API provides robust tool use capabilities with strict schema validation. Model Context Protocol (MCP) has emerged as the industry standard for tool discovery (500+ servers, adopted by Claude, ChatGPT, Cursor, Gemini). E2B with Firecracker microVMs provides production-grade sandboxing. Langfuse/Portkey handle observability and cost tracking. For wallet access, MPC-based solutions (Coinbase Agentic Wallets) prevent key exfiltration even under prompt injection.

**Primary recommendation:** Use Claude strict tool mode + MCP Registry for discovery + LangGraph for orchestration + E2B for sandboxing + Langfuse for observability. Focus custom development on domain-specific tools (BSV wallet operations, memory management), not infrastructure.
</research_summary>

<standard_stack>
## Standard Stack

The established libraries/tools for LLM agent tool execution:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @anthropic-ai/sdk | Latest | Claude Messages API client | Official SDK with tool use support, strict mode |
| @modelcontextprotocol/sdk | Latest | MCP protocol implementation | Industry standard (97M downloads/month), first-class Claude support |
| @langchain/langgraph | 1.0+ | Agent orchestration framework | Production-ready (v1.0 in 2025), scoped access, HITL support |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| E2B SDK | Latest | Firecracker-based code sandboxing | Executing untrusted code, agent-generated scripts |
| Langfuse | Latest | LLM observability and cost tracking | Token-level metering, debugging, compliance |
| Portkey | Latest | LLM gateway with rate limiting | Multi-model support, budget enforcement, semantic caching |
| Zod | Latest | TypeScript schema validation | Runtime validation of tool inputs/outputs |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| E2B + Firecracker | Docker containers | Docker shares kernel - inadequate for untrusted AI code |
| MCP Registry | Custom tool registry | MCP is standard protocol with 500+ existing servers |
| Langfuse | Braintrust, Helicone | Langfuse is open-source and self-hostable |
| LangGraph | Custom orchestration | LangGraph has battle-tested patterns for HITL, permissions |

**Installation:**
```bash
npm install @anthropic-ai/sdk @modelcontextprotocol/sdk @langchain/langgraph zod
npm install langfuse  # For observability
npm install @e2b/sdk  # For sandboxing
```
</standard_stack>

<architecture_patterns>
## Architecture Patterns

### Recommended Project Structure
```
src/
├── tools/              # Tool implementations
│   ├── registry.ts     # MCP-compatible tool registry
│   ├── wallet/         # BSV wallet tools (getBalance, createTx, sign)
│   └── memory/         # Memory tools (search, store, retrieve)
├── security/           # Security and sandboxing
│   ├── sandbox.ts      # E2B sandbox wrapper
│   ├── validation.ts   # Input/output validation with Zod
│   └── rate-limit.ts   # Token-aware rate limiting
├── observability/      # Monitoring and cost tracking
│   ├── langfuse.ts     # Langfuse integration
│   └── metrics.ts      # Cost attribution by tool/operation
└── agents/             # Agent orchestration
    ├── openclaw.ts     # OpenClaw client with tool use
    └── workflows.ts    # LangGraph workflows with approval
```

### Pattern 1: Claude Tool Use with Strict Mode
**What:** Define tools with strict JSON schema validation to guarantee parameter correctness
**When to use:** Wallet operations, any operation where type errors would cause failures
**Example:**
```typescript
// Source: Anthropic official docs
import Anthropic from '@anthropic-ai/sdk';

const tools: Anthropic.Tool[] = [
  {
    name: "get_wallet_balance",
    description: "Get the current BSV balance for the agent's wallet. Returns the balance in satoshis. Should be used when the agent needs to check available funds before creating a transaction. Does not require any blockchain network calls - reads from local wallet state.",
    strict: true,  // Enable strict schema validation
    input_schema: {
      type: "object",
      properties: {},  // No parameters needed
      required: [],
      additionalProperties: false
    }
  },
  {
    name: "create_transaction",
    description: "Create a BSV transaction to send satoshis to a recipient. The agent must have sufficient balance (check with get_wallet_balance first). Returns the unsigned transaction hex. Does NOT broadcast - use sign_and_broadcast after approval.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        recipient: {
          type: "string",
          description: "BSV address to send to (P2PKH or script hash)"
        },
        satoshis: {
          type: "integer",
          description: "Amount to send in satoshis (must be positive)"
        }
      },
      required: ["recipient", "satoshis"],
      additionalProperties: false
    }
  }
];

const response = await client.messages.create({
  model: "claude-opus-4-6",
  max_tokens: 4096,
  tools: tools,
  messages: [{ role: "user", content: "Check my balance and send 1000 sats to 1A1zP1..." }]
});
```

### Pattern 2: Tool Result Formatting (CRITICAL)
**What:** Proper ordering of tool results to avoid API errors
**When to use:** Every tool execution response
**Example:**
```typescript
// Source: Anthropic official docs

// ✅ CORRECT - tool_result blocks FIRST, then optional text
{
  role: "user",
  content: [
    {
      type: "tool_result",
      tool_use_id: "toolu_01A09q90qw90lq917835lq9",
      content: JSON.stringify({ balance: 50000 })  // 50,000 satoshis
    },
    {
      type: "text",
      text: "What should I do next?"
    }
  ]
}

// ❌ WRONG - Will cause 400 error
{
  role: "user",
  content: [
    { type: "text", text: "Here's the result:" },
    { type: "tool_result", tool_use_id: "...", content: "..." }
  ]
}
```

### Pattern 3: MCP Tool Registry
**What:** Use Model Context Protocol for tool discovery
**When to use:** Making tools discoverable to Claude without hardcoding
**Example:**
```typescript
// Source: MCP Registry docs
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

const server = new Server({
  name: 'agidentity-tools',
  version: '1.0.0',
}, {
  capabilities: {
    tools: {},
  },
});

// Register available tools
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'get_wallet_balance',
      description: 'Get BSV wallet balance in satoshis',
      inputSchema: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
    {
      name: 'create_transaction',
      description: 'Create unsigned BSV transaction',
      inputSchema: {
        type: 'object',
        properties: {
          recipient: { type: 'string' },
          satoshis: { type: 'number' },
        },
        required: ['recipient', 'satoshis'],
      },
    },
  ],
}));

// Handle tool execution
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case 'get_wallet_balance':
      return {
        content: [{ type: 'text', text: JSON.stringify({ balance: await getBalance() }) }],
      };
    case 'create_transaction':
      return {
        content: [{ type: 'text', text: JSON.stringify(await createTx(args)) }],
      };
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
```

### Pattern 4: E2B Sandbox for Unsafe Operations
**What:** Execute untrusted code in Firecracker microVMs
**When to use:** Any operation that could be exploited via prompt injection
**Example:**
```typescript
// Source: E2B official docs
import { Sandbox } from '@e2b/sdk';

async function executeInSandbox(code: string): Promise<string> {
  const sandbox = await Sandbox.create();

  try {
    const execution = await sandbox.runCode(code);
    return execution.stdout;
  } catch (error) {
    return `Error: ${error.message}`;
  } finally {
    await sandbox.kill();  // Always cleanup
  }
}
```

### Pattern 5: LangGraph Human-in-the-Loop
**What:** Interrupt workflow for human approval before sensitive operations
**When to use:** Wallet transactions, deletions, high-cost operations
**Example:**
```typescript
// Source: LangGraph official docs
import { StateGraph } from "@langchain/langgraph";

const workflow = new StateGraph({
  channels: {
    messages: { value: [] },
    pendingApproval: { value: null },
  }
});

workflow.addNode("create_transaction", async (state) => {
  const tx = await createTransaction(state.recipient, state.satoshis);
  return { pendingApproval: tx };
});

// Interrupt before broadcast for human approval
workflow.addNode("await_approval", async (state) => {
  // This will pause execution - resume externally
  return state;
});

workflow.addNode("broadcast_transaction", async (state) => {
  const result = await broadcastTx(state.pendingApproval);
  return { messages: [...state.messages, result] };
});

workflow.addEdge("create_transaction", "await_approval");
workflow.addConditionalEdges("await_approval",
  (state) => state.approved ? "broadcast_transaction" : "cancel"
);
```

### Anti-Patterns to Avoid
- **Exposing LLM directly to users:** Always use intermediary layer to prevent prompt extraction
- **Using Docker alone for sandboxing:** Shared kernel vulnerable to escapes - use Firecracker/gVisor
- **Building custom observability:** Use Langfuse/Portkey - custom solutions miss edge cases
- **Hardcoding tool list in prompts:** Use MCP for dynamic discovery
- **Skipping strict mode for wallet operations:** Type mismatches ("2" vs 2) cause transaction failures
- **No human approval for wallet operations:** Prompt injection could drain wallet
</architecture_patterns>

<dont_hand_roll>
## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Code sandboxing | Custom VM/container setup | E2B + Firecracker | Boot in 125ms, hardware isolation, proven for AI agents |
| Tool registry | Custom JSON configuration | MCP Registry | Industry standard, 500+ existing servers, first-class Claude support |
| LLM observability | Custom logging | Langfuse or Braintrust | Token-level tracking, cost attribution, compliance audit trails |
| Rate limiting | Request counting | Portkey or token-aware limiter | LLMs are token-based, not request-based - need usage metering |
| Prompt injection detection | Regex filters | Lakera Guard or Thales AI Security Fabric | ML-based detection catches sophisticated attacks |
| Wallet key management | Custom crypto | Coinbase Agentic Wallets or MPC provider | MPC prevents key exfiltration even under prompt injection |
| Schema validation | Manual parsing | Zod or JSON Schema with strict mode | Runtime validation, TypeScript integration, auto-retry |
| Semantic caching | Custom cache logic | Redis LangCache | 40-60% cost savings, handles vector drift, battle-tested |

**Key insight:** LLM agent infrastructure is now mature (2026). The Model Context Protocol standardizes tool discovery. E2B solves sandboxing for AI-specific workloads. Langfuse provides observability that generic APM tools miss (token-level granularity, LLM-specific debugging). Fighting these solutions leads to bugs and security vulnerabilities that look like "edge cases" but are actually solved problems.

**Critical for wallet access:** Never expose private keys to LLM prompts. Use MPC-based wallet solutions where the key is never reconstructable by any single party, including the AI agent. This prevents prompt injection attacks from stealing keys.
</dont_hand_roll>

<common_pitfalls>
## Common Pitfalls

### Pitfall 1: Prompt Injection via Tools
**What goes wrong:** Malicious instructions in user input override intended behavior, exploit tools
**Why it happens:** 73% of production LLM deployments vulnerable (OWASP #1), LLM treats injected instructions as authoritative
**How to avoid:**
- Defense-in-depth: Input validation → structured outputs → sandbox execution → output validation
- Use strict mode (strict: true) to enforce schema
- Never expose tools without intermediary layer
- Implement Lakera Guard or similar for ML-based detection
**Warning signs:** Unexpected tool calls, tools called with unusual parameters, user input appearing in system prompts

### Pitfall 2: Unbounded Costs (Runaway Tool Usage)
**What goes wrong:** Agent makes 3-10x more LLM calls than expected, costs spiral
**Why it happens:** Agents iterate (planning → tool selection → execution → verification), single request triggers cascading calls
**How to avoid:**
- Budget 5x expected token usage for agent workloads
- Implement token-aware rate limiting (not just request counting)
- Use Portkey/Langfuse for real-time spend caps
- Set hard limits per session/user/operation
**Warning signs:** Costs exceeding 3x baseline, high tool call counts in traces, repeated similar calls

### Pitfall 3: Shared Kernel Sandbox Escape
**What goes wrong:** Agent-generated code escapes Docker container, compromises host
**Why it happens:** Docker shares kernel with host - kernel exploits bypass container isolation
**How to avoid:**
- Use Firecracker microVMs (hardware isolation) or gVisor (userspace kernel)
- Never run untrusted code in plain Docker
- E2B platform handles this correctly
**Warning signs:** Security scans flagging kernel vulnerabilities, container escape attempts in logs

### Pitfall 4: Over-Permissioning Tools
**What goes wrong:** Agent has access to more tools/operations than needed, prompt injection exploits this
**Why it happens:** Static permission design before knowing actual usage patterns
**How to avoid:**
- Scoped tool access per workflow (LangGraph supports this)
- Principle of least privilege - start restrictive, expand as needed
- Use MCP's dynamic tool discovery (request tools when needed, not upfront)
- Separate read-only from write operations
**Warning signs:** Agent accessing tools it shouldn't need, permission denied errors indicating overly broad access attempts

### Pitfall 5: Missing Human-in-the-Loop for Wallet Operations
**What goes wrong:** Agent autonomously broadcasts transactions, drains wallet under prompt injection
**Why it happens:** Treating agent as fully autonomous without approval gates
**How to avoid:**
- Always require human approval before broadcasting transactions
- Use LangGraph interrupt() for approval workflows
- Implement two-step: create transaction → human approve → broadcast
- Log all wallet operations to audit trail
**Warning signs:** Unexpected transactions, balance decreases without user knowledge
</common_pitfalls>

<code_examples>
## Code Examples

Verified patterns from official sources:

### Complete Tool Use Flow
```typescript
// Source: Anthropic Claude API documentation
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// 1. Define tools with strict mode
const tools: Anthropic.Tool[] = [
  {
    name: "get_wallet_balance",
    description: "Get current BSV balance in satoshis. No parameters required.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false
    }
  }
];

// 2. Send request with tools
const response = await client.messages.create({
  model: "claude-opus-4-6",
  max_tokens: 4096,
  tools: tools,
  messages: [{ role: "user", content: "What's my wallet balance?" }]
});

// 3. Check if Claude wants to use a tool
if (response.stop_reason === "tool_use") {
  const toolUse = response.content.find(block => block.type === "tool_use");

  // 4. Execute the tool
  let result;
  if (toolUse.name === "get_wallet_balance") {
    result = await walletClient.getBalance();
  }

  // 5. Send tool result back (CRITICAL: tool_result FIRST in content array)
  const continuation = await client.messages.create({
    model: "claude-opus-4-6",
    max_tokens: 4096,
    tools: tools,
    messages: [
      { role: "user", content: "What's my wallet balance?" },
      { role: "assistant", content: response.content },
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: toolUse.id,
            content: JSON.stringify({ balance: result })
          }
        ]
      }
    ]
  });

  console.log(continuation.content[0].text);  // Claude's final response
}
```

### Error Handling with is_error Flag
```typescript
// Source: Anthropic official docs
try {
  const txResult = await walletClient.createTransaction(args.recipient, args.satoshis);

  return {
    role: "user",
    content: [
      {
        type: "tool_result",
        tool_use_id: toolUseId,
        content: JSON.stringify(txResult)
      }
    ]
  };
} catch (error) {
  return {
    role: "user",
    content: [
      {
        type: "tool_result",
        tool_use_id: toolUseId,
        content: `Error creating transaction: ${error.message}`,
        is_error: true  // Signals error to Claude
      }
    ]
  };
}
```

### Zod Schema Validation
```typescript
// Source: Zod official docs + Anthropic best practices
import { z } from 'zod';

// Define schema
const CreateTransactionSchema = z.object({
  recipient: z.string().regex(/^1[a-zA-Z0-9]{25,34}$/, "Invalid P2PKH address"),
  satoshis: z.number().int().positive()
});

// Validate tool input
function executeCreateTransaction(input: unknown) {
  const parsed = CreateTransactionSchema.parse(input);  // Throws on invalid
  return walletClient.createTransaction(parsed.recipient, parsed.satoshis);
}

// Or with safe parsing
function executeCreateTransactionSafe(input: unknown) {
  const result = CreateTransactionSchema.safeParse(input);
  if (!result.success) {
    return {
      is_error: true,
      content: `Invalid parameters: ${result.error.message}`
    };
  }
  return walletClient.createTransaction(result.data.recipient, result.data.satoshis);
}
```

### Langfuse Cost Tracking
```typescript
// Source: Langfuse official docs
import { Langfuse } from 'langfuse';

const langfuse = new Langfuse({
  publicKey: process.env.LANGFUSE_PUBLIC_KEY,
  secretKey: process.env.LANGFUSE_SECRET_KEY,
});

const trace = langfuse.trace({
  name: "wallet-operation",
  userId: "agent-123",
  metadata: { operation: "create_transaction" }
});

const generation = trace.generation({
  name: "claude-tool-call",
  model: "claude-opus-4-6",
  input: messages,
});

const response = await client.messages.create({ ... });

generation.end({
  output: response.content,
  usage: {
    input: response.usage.input_tokens,
    output: response.usage.output_tokens,
    total: response.usage.input_tokens + response.usage.output_tokens,
  },
});

await langfuse.shutdownAsync();  // Flush before exit
```
</code_examples>

<sota_updates>
## State of the Art (2026)

What's changed recently:

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Custom tool registries | Model Context Protocol (MCP) | 2025-2026 | Standardization - 500+ servers, all major LLMs support it |
| Docker for AI sandboxing | Firecracker microVMs (E2B) | 2025-2026 | Hardware isolation prevents kernel exploits from AI-generated code |
| Request-based rate limiting | Token-aware rate limiting | 2025 | Properly accounts for variable LLM cost per request |
| Best-effort schema validation | Strict mode (strict: true) | 2024-2025 | Guaranteed schema compliance, eliminates type errors |
| Manual wallet management | MPC-based agentic wallets | Feb 2026 | Coinbase Agentic Wallets - keys never exposed to LLM |
| Generic observability (Datadog) | LLM-specific (Langfuse, Portkey) | 2025 | Token-level granularity, LLM-specific debugging, cost attribution |

**New tools/patterns to consider:**
- **MCP Registry**: Official registry at registry.modelcontextprotocol.io - discover existing tools before building
- **Claude Opus 4.6 parallel tool use**: Can call multiple tools simultaneously (major performance boost)
- **Coinbase x402 protocol**: Standard for AI agent payments on blockchain
- **Semantic caching (Redis LangCache)**: 40-60% cost savings for conversational AI
- **LangGraph v1.0**: Production-ready orchestration with native HITL support
- **E2B + Docker partnership**: Bringing Firecracker isolation to Docker ecosystem

**Deprecated/outdated:**
- **Custom JSON tool formats**: Use Claude's native tool schema
- **Docker-only sandboxing for AI**: Shared kernel inadequate - use Firecracker/gVisor
- **Manual cost tracking in logs**: Use Langfuse/Portkey for automatic token metering
- **Hardcoded tool lists**: Use MCP for dynamic discovery
</sota_updates>

<open_questions>
## Open Questions

Things that couldn't be fully resolved:

1. **OpenClaw Tool Use Support**
   - What we know: OpenClaw is a separate project we wrap, Claude API supports tool use
   - What's unclear: OpenClaw's current tool use capabilities, whether it exposes native Claude API or abstracts it
   - Recommendation: Investigate OpenClaw's API surface - if it exposes Claude Messages API directly, use that; if it abstracts tool use, we may need to implement at AGIdentity wrapper layer

2. **MPC Wallet Integration with Tool Execution**
   - What we know: MPC wallet prevents key exfiltration, Coinbase provides agentic wallets
   - What's unclear: How to integrate our existing MPC interface (from Phase 3.1) with tool execution flow, whether to use external service or implement locally
   - Recommendation: During planning, decide whether to use Coinbase Agentic Wallets (managed service) or implement MPC tool execution using our existing wallet-toolbox-mpc interface

3. **Cost Budget Enforcement Granularity**
   - What we know: Need token-aware rate limiting, Portkey/Langfuse provide this
   - What's unclear: Appropriate budget levels per user/session/operation for our use case
   - Recommendation: Start conservative (low budgets), monitor actual usage patterns, adjust based on data

4. **Approval Workflow UX**
   - What we know: Need human-in-the-loop for wallet operations, LangGraph supports interrupts
   - What's unclear: How approval requests surface to users (MessageBox notification? Polling? Webhook?)
   - Recommendation: Design approval flow during Phase 9 planning - likely MessageBox-based notification with approval response
</open_questions>

<sources>
## Sources

### Primary (HIGH confidence)
- [Anthropic Claude Tool Use Guide](https://platform.claude.com/docs/en/docs/build-with-claude/tool-use) - Official tool use documentation
- [Anthropic Messages API Reference](https://platform.claude.com/docs/en/api/messages) - Official API specification
- [Model Context Protocol (MCP) Official](https://github.com/modelcontextprotocol) - Protocol specification
- [MCP Registry](https://registry.modelcontextprotocol.io/) - Official tool registry
- [LangGraph v1.0 Docs](https://www.langchain.com/langgraph) - Official orchestration framework
- [E2B Official Docs](https://e2b.dev/) - Sandboxing platform documentation
- [Langfuse Official Docs](https://langfuse.com/docs) - Observability platform documentation

### Secondary (MEDIUM-HIGH confidence)
- [OWASP Top 10 for LLM Applications 2025](https://genai.owasp.org/resource/owasp-top-10-for-llm-applications-2025/) - Industry security standards
- [Coinbase Agentic Wallets Launch](https://www.coinbase.com/developer-platform/discover/launches/agentic-wallets) - Official product announcement (Feb 2026)
- [E2B + Docker Partnership](https://www.docker.com/blog/docker-e2b-building-the-future-of-trusted-ai/) - Firecracker adoption
- [Portkey AI Gateway Docs](https://portkey.ai/features/ai-gateway) - Enterprise gateway documentation
- Industry research on prompt injection defense, rate limiting, semantic caching (multiple converging sources)

### Tertiary (MEDIUM confidence - cross-verified)
- Various 2025-2026 blog posts and guides on LLM agent best practices
- Security research papers on prompt injection (OWASP, Microsoft, academic sources)
- Cost optimization case studies (verified approaches against official platform docs)
</sources>

<metadata>
## Metadata

**Research scope:**
- Core technology: Claude Messages API tool use
- Ecosystem: MCP, LangGraph, E2B, Langfuse, Portkey, Zod
- Patterns: Tool registry, sandboxing, HITL, cost tracking, wallet security
- Pitfalls: Prompt injection, unbounded costs, over-permissioning, sandbox escapes

**Confidence breakdown:**
- Standard stack: HIGH - Official docs, production deployments, industry standards (MCP)
- Architecture: HIGH - From official Anthropic, LangGraph, E2B documentation with code examples
- Pitfalls: HIGH - OWASP standards, documented security research, production incident reports
- Code examples: HIGH - From official Anthropic, LangGraph, Langfuse sources
- Blockchain integration: MEDIUM-HIGH - Recent launches (Coinbase Feb 2026), strong adoption signals, but rapidly evolving
- OpenClaw integration: MEDIUM - Need to verify OpenClaw's current tool use support

**Research date:** 2026-02-15
**Valid until:** 2026-03-15 (30 days - Claude API and MCP are stable, but agent ecosystem evolving rapidly)

**Key uncertainties requiring planning phase investigation:**
1. OpenClaw's native tool use capabilities
2. Integration approach for existing MPC wallet interface
3. MessageBox-based approval workflow design
</metadata>

---

*Phase: 8-tool-registry*
*Research completed: 2026-02-15*
*Ready for planning: yes*
