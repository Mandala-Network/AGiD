# Phase 8: Tool Registry System - Research

**Researched:** 2026-02-15
**Domain:** OpenClaw Plugin SDK, AgentTool interface, BSV wallet tool integration
**Confidence:** HIGH

<research_summary>
## Summary

Researched how to create an OpenClaw plugin that exposes AGIdentity's wallet and memory tools to the AI agent. OpenClaw uses a Plugin SDK with `AgentTool` interfaces from `@mariozechner/pi-agent-core`. Tools are registered via `api.registerTool()` in plugin entry points and use TypeBox schemas (not JSON Schema) for parameters.

**Key finding:** Our current AGIdentity gateway uses OpenClaw as a WebSocket client for chat messaging, but tools CANNOT be registered via WebSocket - they require a proper plugin installed in OpenClaw's extensions directory. The WebSocket protocol only handles chat messages and events, not tool registration.

**Primary recommendation:** Create an OpenClaw plugin (`extensions/agidentity-tools/`) that registers wallet and memory tools. The plugin calls back to AGIdentity gateway via HTTP API to execute the actual operations while leveraging OpenClaw's tool discovery, parameter validation, and LLM integration.
</research_summary>

<standard_stack>
## Standard Stack

The established libraries/tools for OpenClaw plugin development:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @mariozechner/pi-agent-core | 0.52.12 | Agent tool interface (AgentTool) | Core dependency of OpenClaw, defines tool contract |
| @mariozechner/pi-ai | 0.52.12 | Base AI types (Tool, Message, Model) | Foundation for pi-agent-core |
| @sinclair/typebox | 0.34.48 | Schema definition for tool parameters | OpenClaw's standard for parameter validation |
| openclaw/plugin-sdk | 2026.2.14 | Plugin API (OpenClawPluginApi) | Official SDK for extending OpenClaw |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| zod | 4.3.6 | Alternative schema validation | If TypeBox is insufficient (rare) |
| tslog | 4.10.2 | Logging | Via api.runtime.logging |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Plugin SDK | WebSocket tool registration | WebSocket protocol doesn't support tool registration |
| TypeBox | JSON Schema directly | OpenClaw ecosystem standardized on TypeBox |
| Plugin | MCP server | MCP not integrated with OpenClaw, separate ecosystem |

**Plugin Installation:**
```bash
# Create plugin directory
mkdir -p extensions/agidentity-tools
cd extensions/agidentity-tools

# Initialize package.json
npm init -y

# Install dependencies
npm install @sinclair/typebox
```
</standard_stack>

<architecture_patterns>
## Architecture Patterns

### Recommended Project Structure
```
extensions/agidentity-tools/
├── package.json           # Plugin manifest with openclaw.extensions field
├── index.ts              # Plugin entry point (register function)
├── src/
│   ├── wallet-tools.ts   # Wallet tool implementations
│   ├── memory-tools.ts   # Memory tool implementations
│   ├── identity-tools.ts # Identity tool implementations
│   └── api-client.ts     # HTTP client to AGIdentity gateway
└── tsconfig.json         # TypeScript config
```

### Pattern 1: Plugin Entry Point
**What:** Register tools via api.registerTool() in the default export function
**When to use:** Every OpenClaw plugin
**Example:**
```typescript
// Source: OpenClaw plugin SDK pattern
import type { OpenClawPluginApi } from 'openclaw/plugin-sdk';
import { createWalletTools } from './src/wallet-tools.js';
import { createMemoryTools } from './src/memory-tools.js';

export default function register(api: OpenClawPluginApi) {
  // Register wallet tools with tool factory (context-aware)
  api.registerTool(
    (ctx) => {
      // Disable in sandbox mode (wallet operations need real access)
      if (ctx.sandboxed) return null;

      return createWalletTools(api);
    },
    {
      names: ['agid_get_balance', 'agid_create_transaction', 'agid_sign_message'],
      optional: true  // Requires explicit allowlist
    }
  );

  // Register memory tools
  api.registerTool(
    createMemoryTools(api),
    {
      names: ['agid_store_memory', 'agid_recall_memory'],
      optional: false  // Available by default
    }
  );
}
```

### Pattern 2: AgentTool Implementation with TypeBox
**What:** Define tool with name, label, description, parameters (TypeBox schema), and execute function
**When to use:** Every tool implementation
**Example:**
```typescript
// Source: @mariozechner/pi-agent-core types + OpenClaw extensions
import { Type } from '@sinclair/typebox';
import type { AnyAgentTool, OpenClawPluginApi } from 'openclaw/plugin-sdk';

export function createGetBalanceTool(api: OpenClawPluginApi): AnyAgentTool {
  return {
    name: 'agid_get_balance',
    label: 'Get Wallet Balance',
    description: 'Get the current BSV wallet balance and UTXO count. Returns balance in satoshis. This tool checks the agent\'s MPC wallet balance. Use this before creating transactions to ensure sufficient funds.',

    // TypeBox schema for parameters
    parameters: Type.Object({
      // No parameters needed for balance check
    }),

    // Execute function
    async execute(toolCallId, params, signal, onUpdate) {
      // Call AGIdentity Gateway API
      const response = await fetch('http://localhost:3000/api/wallet/balance', {
        signal,  // Pass abort signal
      });

      if (!response.ok) {
        throw new Error(`Balance check failed: ${response.statusText}`);
      }

      const data = await response.json();

      return {
        content: [{
          type: 'text',
          text: `Balance: ${data.satoshis} satoshis (${data.utxoCount} UTXOs)`
        }],
        details: data,  // Full response for debugging
      };
    },
  };
}
```

### Pattern 3: TypeBox Parameter Schemas
**What:** Use Type.Object, Type.String, Type.Optional, etc. to define tool parameters
**When to use:** Any tool with parameters
**Example:**
```typescript
// Source: TypeBox documentation + OpenClaw extension patterns
import { Type } from '@sinclair/typebox';

// Simple string parameter
const SimpleSchema = Type.Object({
  message: Type.String({
    description: 'The message to sign'
  })
});

// Complex schema with optional fields
const TransactionSchema = Type.Object({
  recipient: Type.String({
    description: 'BSV address (P2PKH or script hash)'
  }),
  satoshis: Type.Integer({
    description: 'Amount to send in satoshis (must be positive)'
  }),
  data: Type.Optional(Type.String({
    description: 'Optional OP_RETURN data (hex encoded)'
  })),
  feeRate: Type.Optional(Type.Number({
    description: 'Fee rate in satoshis per byte (default: 1)'
  }))
});

// Enum/union type
const NetworkSchema = Type.Object({
  network: Type.Union([
    Type.Literal('mainnet'),
    Type.Literal('testnet')
  ], {
    description: 'BSV network to use'
  })
});

// Array parameter
const BatchSchema = Type.Object({
  operations: Type.Array(Type.Object({
    type: Type.Union([Type.Literal('send'), Type.Literal('store')]),
    params: Type.Unknown()
  }), {
    description: 'Batch of operations to execute'
  })
});
```

### Pattern 4: Tool Result Formatting
**What:** Return AgentToolResult with content array and optional details
**When to use:** Every tool execute function
**Example:**
```typescript
// Source: @mariozechner/pi-agent-core AgentToolResult interface
async execute(toolCallId, params) {
  const result = await doOperation(params);

  // Text-only result
  return {
    content: [{
      type: 'text',
      text: JSON.stringify(result, null, 2)
    }],
    details: result
  };

  // OR: Multiple content blocks
  return {
    content: [
      { type: 'text', text: 'Transaction created successfully' },
      { type: 'text', text: `TXID: ${result.txid}` },
      { type: 'text', text: `Fee: ${result.fee} satoshis` }
    ],
    details: result
  };

  // OR: Include images (for QR codes, etc.)
  return {
    content: [
      { type: 'text', text: 'Payment request created' },
      {
        type: 'image',
        source: {
          base64: qrCodeBase64,
          mimeType: 'image/png'
        }
      }
    ],
    details: { paymentUrl: result.url }
  };
}
```

### Pattern 5: Plugin Configuration
**What:** Access plugin-specific config via api.pluginConfig
**When to use:** Plugins with configurable settings
**Example:**
```typescript
// Source: OpenClaw plugin patterns
// In plugin entry point
export default function register(api: OpenClawPluginApi) {
  const config = api.pluginConfig as AGIdentityPluginConfig | undefined;

  // Validate required config
  if (!config?.gatewayUrl) {
    api.logger.warn('AGIdentity gateway URL not configured, using default');
  }

  const gatewayUrl = config?.gatewayUrl ?? 'http://localhost:3000';
  const authToken = config?.authToken;

  // Pass config to tool factories
  api.registerTool(
    (ctx) => createWalletTools(api, { gatewayUrl, authToken }),
    { optional: true }
  );
}

// In OpenClaw config file (config.json5)
{
  "plugins": {
    "agidentity-tools": {
      "gatewayUrl": "http://localhost:3000",
      "authToken": "your-secure-token"
    }
  }
}
```

### Pattern 6: HTTP Client to AGIdentity Gateway
**What:** Plugin tools call back to AGIdentity Gateway HTTP API
**When to use:** When tools need to execute operations in AGIdentity (wallet, memory, identity)
**Example:**
```typescript
// Source: Best practice for plugin-gateway integration
export class AGIdentityClient {
  constructor(
    private baseUrl: string,
    private authToken?: string
  ) {}

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      ...(this.authToken && { 'Authorization': `Bearer ${this.authToken}` }),
      ...options.headers,
    };

    const response = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers,
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  async getBalance(): Promise<{ satoshis: number; utxoCount: number }> {
    return this.request('/api/wallet/balance');
  }

  async createTransaction(params: {
    recipient: string;
    satoshis: number;
    data?: string;
  }): Promise<{ txHex: string; txid: string }> {
    return this.request('/api/wallet/create-transaction', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }

  async storeMemory(params: {
    content: string;
    tags?: string[];
  }): Promise<{ path: string; txid: string }> {
    return this.request('/api/memory/store', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }
}
```

### Anti-Patterns to Avoid
- **Registering tools via WebSocket:** WebSocket protocol only supports chat messages, not tool registration
- **Using JSON Schema instead of TypeBox:** OpenClaw ecosystem standardized on TypeBox
- **Hardcoding gateway URL:** Use plugin config for flexibility
- **Not marking wallet tools as optional:** Wallet operations should require explicit allowlist
- **Ignoring abort signals:** Tools should respect cancellation via AbortSignal
- **Not handling errors gracefully:** Throw descriptive errors, don't return error strings as success
</architecture_patterns>

<dont_hand_roll>
## Don't Hand-Roll

Problems that have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Parameter validation | Manual parsing and validation | TypeBox schemas | Automatic type checking, LLM-friendly descriptions |
| Plugin loading | Custom module loader | OpenClaw plugin discovery | Automatic discovery from extensions/ directory |
| Logging | console.log | api.runtime.logging | Structured logging, log levels, context |
| Tool execution context | Global state | Tool factory pattern | Context-aware tools (sandbox mode, agent ID, session) |
| HTTP client | fetch directly | Abstracted API client | Auth token handling, error handling, retries |
| Configuration | Environment variables only | api.pluginConfig | Per-plugin config in OpenClaw config.json5 |

**Key insight:** OpenClaw's plugin SDK handles tool discovery, parameter validation, LLM integration, and lifecycle management. Don't reimplement these - focus on the tool logic itself. The SDK automatically converts TypeBox schemas to LLM-compatible function calling formats.

**Critical for wallet access:** Don't implement wallet operations in the plugin - keep all cryptographic operations (signing, key management) in AGIdentity Gateway. The plugin should be a thin adapter that calls the gateway API. This maintains security isolation and prevents key material exposure.
</dont_hand_roll>

<common_pitfalls>
## Common Pitfalls

### Pitfall 1: Trying to Register Tools via WebSocket
**What goes wrong:** Tools aren't available to the AI agent, no error messages
**Why it happens:** Assuming WebSocket protocol supports tool registration (it doesn't)
**How to avoid:**
- Understand that WebSocket is for chat messages and events only
- Tools MUST be registered via plugin SDK at OpenClaw startup
- Create a proper plugin in extensions/ directory
**Warning signs:** Tools not showing up in agent capabilities, no tool calls in conversations

### Pitfall 2: Using JSON Schema Instead of TypeBox
**What goes wrong:** Type errors, schema validation failures, incompatible with OpenClaw
**Why it happens:** Assuming standard JSON Schema works (OpenClaw uses TypeBox)
**How to avoid:**
- Always use `import { Type } from '@sinclair/typebox'`
- Use Type.Object, Type.String, Type.Optional, etc.
- Check OpenClaw extensions for schema examples
**Warning signs:** TypeScript errors on Static<TParameters>, schema not recognized

### Pitfall 3: Not Marking Wallet Tools as Optional
**What goes wrong:** Wallet tools available to all users without authorization
**Why it happens:** Default tools are available to all agents
**How to avoid:**
- Use `{ optional: true }` when registering wallet tools
- Require explicit allowlist in agent config: `tools.allow: ["agid_create_transaction"]`
- This provides defense-in-depth (plugin + config authorization)
**Warning signs:** Unauthorized users can call wallet tools

### Pitfall 4: Embedding Secrets in Plugin Code
**What goes wrong:** Wallet seeds, API tokens exposed in source code
**Why it happens:** Hardcoding configuration for convenience
**How to avoid:**
- Use `api.pluginConfig` for all sensitive configuration
- Store config in OpenClaw's config.json5 (gitignored)
- Never commit secrets to version control
**Warning signs:** Wallet seeds visible in git history, tokens in source files

### Pitfall 5: Not Handling AbortSignal
**What goes wrong:** Tools continue running after user cancels, resources leak
**Why it happens:** Ignoring the optional signal parameter
**How to avoid:**
- Accept signal parameter: `async execute(id, params, signal)`
- Pass signal to fetch calls: `fetch(url, { signal })`
- Check signal.aborted before long operations
- Clean up resources on abort
**Warning signs:** Tools running indefinitely, memory leaks, can't cancel operations
</common_pitfalls>

<code_examples>
## Code Examples

Verified patterns from OpenClaw extensions and SDK:

### Complete Plugin Structure
```typescript
// Source: OpenClaw plugin SDK + extensions/llm-task pattern
// extensions/agidentity-tools/package.json
{
  "name": "@agidentity/openclaw-plugin",
  "version": "1.0.0",
  "private": true,
  "description": "AGIdentity wallet and memory tools for OpenClaw",
  "type": "module",
  "main": "index.ts",
  "dependencies": {
    "@sinclair/typebox": "^0.34.48"
  },
  "openclaw": {
    "extensions": ["./index.ts"]
  }
}

// extensions/agidentity-tools/index.ts
import type { OpenClawPluginApi, AnyAgentTool } from 'openclaw/plugin-sdk';
import { createWalletTools } from './src/wallet-tools.js';
import { createMemoryTools } from './src/memory-tools.js';

export default function register(api: OpenClawPluginApi) {
  const logger = api.runtime.logging.getChildLogger({ plugin: 'agidentity' });

  // Get plugin configuration
  const config = api.pluginConfig as {
    gatewayUrl?: string;
    authToken?: string;
  } | undefined;

  const gatewayUrl = config?.gatewayUrl ?? 'http://localhost:3000';
  const authToken = config?.authToken;

  logger.info('Registering AGIdentity tools', { gatewayUrl });

  // Register wallet tools (optional - requires allowlist)
  api.registerTool(
    (ctx) => {
      if (ctx.sandboxed) {
        logger.debug('Wallet tools disabled in sandbox mode');
        return null;
      }
      return createWalletTools({ gatewayUrl, authToken, logger });
    },
    {
      names: ['agid_get_balance', 'agid_create_transaction'],
      optional: true
    }
  );

  // Register memory tools (available by default)
  api.registerTool(
    createMemoryTools({ gatewayUrl, authToken, logger }),
    {
      names: ['agid_store_memory', 'agid_recall_memory'],
      optional: false
    }
  );
}
```

### Wallet Balance Tool
```typescript
// Source: AgentTool interface + best practices
// extensions/agidentity-tools/src/wallet-tools.ts
import { Type } from '@sinclair/typebox';
import type { AnyAgentTool } from 'openclaw/plugin-sdk';

export function createWalletTools(config: {
  gatewayUrl: string;
  authToken?: string;
  logger: any;
}): AnyAgentTool[] {
  return [
    {
      name: 'agid_get_balance',
      label: 'Get Wallet Balance',
      description: 'Get the current BSV wallet balance in satoshis and UTXO count. Use this before creating transactions to ensure sufficient funds. This checks the agent\'s MPC-protected wallet.',

      parameters: Type.Object({}),  // No parameters

      async execute(toolCallId, params, signal) {
        config.logger.info('Getting wallet balance');

        const response = await fetch(`${config.gatewayUrl}/api/wallet/balance`, {
          headers: config.authToken ? {
            'Authorization': `Bearer ${config.authToken}`
          } : {},
          signal,
        });

        if (!response.ok) {
          throw new Error(`Balance check failed: ${response.statusText}`);
        }

        const data = await response.json();

        return {
          content: [{
            type: 'text',
            text: `Current balance: ${data.satoshis} satoshis (${data.utxoCount} UTXOs available)`
          }],
          details: data,
        };
      },
    },

    {
      name: 'agid_create_transaction',
      label: 'Create BSV Transaction',
      description: 'Create an unsigned BSV transaction. Returns transaction hex. This does NOT broadcast the transaction - it only creates it. The transaction must be signed and broadcast separately.',

      parameters: Type.Object({
        recipient: Type.String({
          description: 'BSV address to send to (P2PKH address starting with 1)'
        }),
        satoshis: Type.Integer({
          description: 'Amount to send in satoshis (1 BSV = 100,000,000 satoshis)'
        }),
        data: Type.Optional(Type.String({
          description: 'Optional OP_RETURN data (hex encoded, max 100KB)'
        }))
      }),

      async execute(toolCallId, params, signal) {
        config.logger.info('Creating transaction', {
          recipient: params.recipient,
          satoshis: params.satoshis
        });

        const response = await fetch(`${config.gatewayUrl}/api/wallet/create-transaction`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(config.authToken && { 'Authorization': `Bearer ${config.authToken}` }),
          },
          body: JSON.stringify(params),
          signal,
        });

        if (!response.ok) {
          const error = await response.text();
          throw new Error(`Transaction creation failed: ${error}`);
        }

        const data = await response.json();

        return {
          content: [{
            type: 'text',
            text: `Transaction created:\nTXID: ${data.txid}\nSize: ${data.size} bytes\nFee: ${data.fee} satoshis`
          }],
          details: data,
        };
      },
    },
  ];
}
```

### Memory Tools with Streaming Updates
```typescript
// Source: AgentToolUpdateCallback pattern
// extensions/agidentity-tools/src/memory-tools.ts
import { Type } from '@sinclair/typebox';
import type { AnyAgentTool } from 'openclaw/plugin-sdk';

export function createMemoryTools(config: {
  gatewayUrl: string;
  authToken?: string;
  logger: any;
}): AnyAgentTool[] {
  return [
    {
      name: 'agid_store_memory',
      label: 'Store Memory',
      description: 'Store information in the agent\'s long-term encrypted memory. Memories are stored on the BSV blockchain via UHRP (encrypted). Use this to remember important information across conversations.',

      parameters: Type.Object({
        content: Type.String({
          description: 'The information to remember'
        }),
        tags: Type.Optional(Type.Array(Type.String(), {
          description: 'Optional tags for categorization (e.g., ["meeting", "todo"])'
        }))
      }),

      async execute(toolCallId, params, signal, onUpdate) {
        config.logger.info('Storing memory', { tags: params.tags });

        // Send progress update
        onUpdate?.({
          content: [{ type: 'text', text: 'Encrypting memory...' }],
          details: { progress: 25 }
        });

        const response = await fetch(`${config.gatewayUrl}/api/memory/store`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(config.authToken && { 'Authorization': `Bearer ${config.authToken}` }),
          },
          body: JSON.stringify(params),
          signal,
        });

        if (!response.ok) {
          throw new Error(`Memory storage failed: ${await response.text()}`);
        }

        onUpdate?.({
          content: [{ type: 'text', text: 'Uploading to blockchain...' }],
          details: { progress: 75 }
        });

        const data = await response.json();

        return {
          content: [{
            type: 'text',
            text: `Memory stored successfully\nPath: ${data.path}\nTXID: ${data.txid}`
          }],
          details: data,
        };
      },
    },

    {
      name: 'agid_recall_memory',
      label: 'Recall Memory',
      description: 'Search the agent\'s long-term memory for relevant information. Returns the most relevant memories based on semantic similarity. Use this to retrieve information from past conversations.',

      parameters: Type.Object({
        query: Type.String({
          description: 'What to search for in memory'
        }),
        limit: Type.Optional(Type.Integer({
          description: 'Maximum number of results to return (default: 3, max: 10)'
        }))
      }),

      async execute(toolCallId, params, signal) {
        config.logger.info('Searching memory', { query: params.query });

        const response = await fetch(`${config.gatewayUrl}/api/memory/search`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(config.authToken && { 'Authorization': `Bearer ${config.authToken}` }),
          },
          body: JSON.stringify({
            query: params.query,
            limit: params.limit ?? 3,
          }),
          signal,
        });

        if (!response.ok) {
          throw new Error(`Memory search failed: ${await response.text()}`);
        }

        const data = await response.json();

        if (data.results.length === 0) {
          return {
            content: [{ type: 'text', text: 'No relevant memories found.' }],
            details: data,
          };
        }

        const resultText = data.results.map((r: any, i: number) =>
          `${i + 1}. ${r.content}\n   Tags: ${r.tags?.join(', ') ?? 'none'}\n   Stored: ${r.timestamp}`
        ).join('\n\n');

        return {
          content: [{
            type: 'text',
            text: `Found ${data.results.length} relevant memories:\n\n${resultText}`
          }],
          details: data,
        };
      },
    },
  ];
}
```
</code_examples>

<sota_updates>
## State of the Art (2026)

What's changed recently:

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Custom tool formats per LLM | AgentTool standard interface | 2025 | Unified tool interface across pi-agent ecosystem |
| JSON Schema for parameters | TypeBox schemas | 2024-2025 | Better TypeScript integration, type safety |
| Global plugin config | Per-plugin api.pluginConfig | 2025 | Cleaner config, no namespace collisions |
| Manual tool discovery | Automatic from extensions/ | 2025 | Zero-config plugin loading |
| OpenClaw plugin API v1 | Plugin SDK v2 with runtime utilities | 2026 | Richer API (logging, state, media, tools) |

**New patterns to consider:**
- **Tool factories:** Return tools dynamically based on context (sandbox mode, agent ID)
- **Optional tools:** Mark sensitive tools as opt-in via `{ optional: true }`
- **Streaming updates:** Use onUpdate callback for long-running operations
- **Abort signals:** Respect cancellation for responsive UX
- **Runtime utilities:** Leverage api.runtime for logging, state, media processing

**Deprecated/outdated:**
- **Direct tool registration:** Old plugins registered tools globally - now use api.registerTool
- **JSON Schema:** Use TypeBox for all parameter schemas
- **Environment variables only:** Use api.pluginConfig for plugin settings
</sota_updates>

<open_questions>
## Open Questions

Things that couldn't be fully resolved:

1. **AGIdentity Gateway HTTP API Design**
   - What we know: Plugin needs HTTP endpoints to call wallet/memory operations
   - What's unclear: Should we add HTTP server to existing gateway or run separately?
   - Recommendation: Add Express HTTP server to AGIdentityOpenClawGateway alongside WebSocket client

2. **Authentication Between Plugin and Gateway**
   - What we know: Plugin calls gateway API, needs auth to prevent unauthorized access
   - What's unclear: Best auth mechanism (JWT, API key, mTLS)?
   - Recommendation: Simple Bearer token in config.json5, validated by gateway

3. **Tool Approval Workflow**
   - What we know: Wallet operations should have human approval (Phase 9)
   - What's unclear: Should approval happen in plugin or in gateway?
   - Recommendation: Implement approval in gateway (Phase 9), plugin just calls the API

4. **Plugin Distribution**
   - What we know: Plugin lives in extensions/agidentity-tools/
   - What's unclear: How users install the plugin (manual copy, npm package, automated?)
   - Recommendation: Document manual installation for v1.0, consider npm package later
</open_questions>

<sources>
## Sources

### Primary (HIGH confidence)
- OpenClaw Plugin SDK: `/Users/donot/AGIdentity/agidentity/node_modules/openclaw/dist/plugin-sdk/` - Official SDK types and interfaces
- pi-agent-core: `/Users/donot/AGIdentity/agidentity/node_modules/@mariozechner/pi-agent-core/dist/types.d.ts` - AgentTool interface definition
- TypeBox: `/Users/donot/AGIdentity/agidentity/node_modules/@sinclair/typebox/` - Schema definition library
- OpenClaw extensions: `/Users/donot/AGIdentity/agidentity/node_modules/openclaw/extensions/` - Real-world plugin examples
- Phase 4 DISCOVERY.md: `.planning/phases/04-openclaw-gateway/DISCOVERY.md` - Architecture decisions

### Secondary (MEDIUM-HIGH confidence)
- OpenClaw package.json: Plugin SDK exports and version
- Existing AGIdentity gateway: `src/gateway/agidentity-openclaw-gateway.ts` - Current WebSocket integration
- Existing tools: `src/tools/identity-tools.ts`, `src/memory/` - Tool implementations to expose

### Verified Code Examples
- llm-task plugin: Example of simple tool registration
- memory-core plugin: Example of multiple tools with factory pattern
- lobster plugin: Example of context-aware tools (sandbox detection)
- zalouser plugin: Example of TypeBox schemas and error handling
</sources>

<metadata>
## Metadata

**Research scope:**
- Core technology: OpenClaw Plugin SDK, AgentTool interface
- Ecosystem: pi-agent-core, TypeBox, OpenClaw runtime utilities
- Patterns: Plugin structure, tool registration, parameter schemas, HTTP client
- Pitfalls: WebSocket tool registration, schema format, security, secrets management

**Confidence breakdown:**
- Standard stack: HIGH - Official SDK, documented APIs, stable versions
- Architecture: HIGH - Verified with existing OpenClaw extensions, clear plugin pattern
- Pitfalls: HIGH - Documented in extension examples, common mistakes identified
- Code examples: HIGH - From OpenClaw source code and working extensions
- AGIdentity integration: MEDIUM - Need to implement HTTP API and test integration

**Research date:** 2026-02-15
**Valid until:** 2026-03-15 (30 days - OpenClaw plugin SDK is stable)

**Key findings:**
1. Tools cannot be registered via WebSocket - plugin SDK required
2. TypeBox schemas (not JSON Schema) for parameters
3. Plugin calls AGIdentity gateway HTTP API for actual operations
4. Tool factory pattern enables context-aware tools
5. Mark wallet tools as optional for security

**Implementation priorities:**
1. Create AGIdentity Gateway HTTP API endpoints (wallet, memory)
2. Create OpenClaw plugin with tool definitions
3. Implement HTTP client for plugin-gateway communication
4. Add plugin configuration support
5. Test tool execution end-to-end
</metadata>

---

*Phase: 8-tool-registry*
*Research completed: 2026-02-15*
*Ready for planning: yes*
