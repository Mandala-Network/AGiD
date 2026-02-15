# Phase 5: Shad Semantic Memory - Research

**Researched:** 2026-02-14
**Domain:** AI Agent Semantic Memory with Encrypted Vault Integration
**Confidence:** HIGH

<research_summary>
## Summary

Researched how to connect AGIdentity's encrypted vault to AI long-term memory. Two distinct systems were evaluated:

1. **Shad (Shannon's Daemon)** - A recursive language model (RLM) engine for complex multi-step reasoning across knowledge bases
2. **OpenClaw Memory** - Built-in semantic memory with hybrid search for chat context

**Critical Finding:** The existing `AGIdentityShadBridge` code is **speculative and non-functional**. It uses `--retriever api` and `--retriever-url` flags that **don't exist in Shad**. Shad only supports `auto`, `qmd`, and `filesystem` retrievers - all expect local vault access, not HTTP APIs.

**Recommendation:**

| Use Case | Solution | Why |
|----------|----------|-----|
| Simple retrieval (90% of cases) | OpenClaw MCP memory tools | Native integration, simpler, sufficient for RAG |
| Complex multi-step reasoning | Shad with temp decrypted vault | Unique RLM capabilities, but requires temp files |

**Primary recommendation:** Implement OpenClaw-native memory as MCP server for standard retrieval. Shad integration should be optional/secondary, using a secure temp vault approach rather than the non-functional HTTP API pattern.
</research_summary>

<shad_analysis>
## Shad Assessment: Value-Add or Unnecessary?

### What Shad Actually Is

Shad is **not** a simple retrieval system. It's a **Recursive Language Model (RLM) engine** with five stages:

1. **Decompose** - Break complex tasks into subtasks using strategy templates
2. **Retrieve** - LLM writes Python scripts to search vault (Code Mode)
3. **Generate** - Produce outputs with type-consistency contracts
4. **Verify** - Check syntax, types, tests with configurable strictness
5. **Assemble** - Synthesize subtask results into coherent outputs

### Shad IS a Value-Add For:
- Complex research tasks: "Analyze all patterns in my vault and synthesize recommendations"
- Multi-step code generation: "Generate OAuth implementation based on examples in my notes"
- Large-scale analysis: Reasoning across 100+ documents that won't fit in context window
- Tasks needing verification: Code that must pass tests before acceptance

### Shad is Unnecessary For:
- Simple Q&A: "What's the API key format?" → OpenClaw memory_search handles this
- Chat context: "What did we discuss yesterday?" → OpenClaw session memory
- Basic RAG: "Find relevant docs about X" → Standard hybrid search

### Existing Code Problem

```typescript
// Current AGIdentityShadBridge code (NON-FUNCTIONAL)
const args = [
  '--retriever', 'api',           // ❌ DOES NOT EXIST
  '--retriever-url', `http://...`, // ❌ DOES NOT EXIST
];
```

**Actual Shad retriever options:** `auto`, `qmd`, `filesystem` only

### Viable Integration Options

| Option | Approach | Security | Complexity | Recommended |
|--------|----------|----------|------------|-------------|
| 1. Temp Vault | Decrypt to temp dir, run Shad, cleanup | Medium (temp files) | Medium | ✅ Yes |
| 2. Fork Shad | Add API retriever mode | High | High (maintenance) | ❌ No |
| 3. Skip Shad | OpenClaw memory only | High | Low | ✅ For most cases |
| 4. Hybrid | OpenClaw primary, Shad optional | High | Medium | ✅ Best overall |

### Decision: Hybrid Approach

- **Primary:** OpenClaw MCP memory tools for 90% of retrieval needs
- **Secondary:** Optional Shad integration via temp vault for complex reasoning tasks
- **Remove:** Current speculative `AGIdentityShadBridge` HTTP API approach
</shad_analysis>

<standard_stack>
## Standard Stack

### For OpenClaw Memory Integration (Primary)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| OpenClaw Memory | Built-in | Semantic memory search | Native, hybrid search |
| sqlite-vec | 0.1.x | Vector storage | SQLite extension for similarity |
| FTS5 | SQLite | Keyword search | BM25 built into SQLite |
| node-llama-cpp | Latest | Local embeddings | Privacy-preserving |
| MCP SDK | Latest | Tool exposure | Standard protocol |

### For Shad Integration (Secondary/Optional)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Shad CLI | Latest | RLM execution | Complex reasoning tasks |
| qmd | Latest | Hybrid search | Shad's native retriever |
| Redis | 7.x | Cross-run caching | Shad's cache backend |

### Installation
```bash
# Primary (OpenClaw memory)
npm install better-sqlite3 @anthropic-ai/sdk

# Secondary (Shad - optional)
curl -fsSL https://raw.githubusercontent.com/jonesj38/shad/main/install.sh | bash
```
</standard_stack>

<architecture_patterns>
## Architecture Patterns

### Recommended Architecture
```
┌─────────────────────────────────────────────────────────────────┐
│                    AGIdentity Gateway                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────────────┐    ┌──────────────────────────────┐  │
│  │ OpenClaw Memory MCP  │    │  Shad RLM (Optional)         │  │
│  │                      │    │                              │  │
│  │ - memory_search()    │    │  For complex tasks only:     │  │
│  │ - memory_get()       │    │  1. Decrypt to temp vault    │  │
│  │ - verify_document()  │    │  2. Run Shad --retriever qmd │  │
│  │                      │    │  3. Cleanup temp vault       │  │
│  │ Use for: Simple RAG  │    │                              │  │
│  │ 90% of use cases     │    │  Use for: Research, analysis │  │
│  └──────────┬───────────┘    │  10% of complex cases        │  │
│             │                └───────────────┬──────────────┘  │
│             │                                │                  │
│             ▼                                ▼                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │              AGIdentity Encrypted Vault                   │  │
│  │              (UHRP + BRC-2 encryption)                    │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### Pattern 1: OpenClaw MCP Memory Server (Primary)
**What:** Expose encrypted vault as MCP tools matching OpenClaw's interface
**When to use:** All standard retrieval use cases
**Example:**
```typescript
// MCP server exposing memory tools
class AGIdentityMemoryServer {
  async memory_search(query: string, limit = 6) {
    // 1. Embed query locally (never send to external API)
    const embedding = await this.embedLocally(query);

    // 2. Hybrid search (vector + BM25)
    const results = await this.hybridSearch(embedding, query, limit);

    // 3. Decrypt matching documents on-demand
    return results.map(r => ({
      path: r.path,
      snippet: r.snippet,
      score: r.score,
    }));
  }

  async memory_get(path: string) {
    // Decrypt single document
    return await this.vault.readDocument(this.userPublicKey, path);
  }
}
```

### Pattern 2: Shad Temp Vault Integration (Secondary)
**What:** Decrypt vault to temp dir, run Shad, cleanup
**When to use:** Complex multi-step reasoning tasks
**Example:**
```typescript
// Secure Shad execution with temp vault
async function executeShadTask(
  vault: EncryptedShadVault,
  userPublicKey: string,
  task: string,
  strategy: ShadStrategy
): Promise<ShadResult> {
  // 1. Create secure temp directory
  const tempVault = await createSecureTempDir();

  try {
    // 2. Decrypt relevant documents to temp vault
    const docs = await vault.listDocuments();
    for (const doc of docs) {
      const content = await vault.readDocument(userPublicKey, doc.path);
      await writeToTempVault(tempVault, doc.path, content);
    }

    // 3. Run Shad with filesystem retriever
    const result = await runShad({
      task,
      vault: tempVault,
      retriever: 'qmd',  // Or 'filesystem' if qmd unavailable
      strategy,
    });

    return result;
  } finally {
    // 4. ALWAYS cleanup temp vault (security critical)
    await secureDelete(tempVault);
  }
}
```

### Pattern 3: On-Demand Decryption Cache
**What:** Memory-only cache for decrypted content
**When to use:** Always - never persist plaintext to disk
**Example:**
```typescript
class DecryptionCache {
  private cache = new Map<string, { content: string; expiry: number }>();
  private readonly TTL = 30 * 60 * 1000; // 30 minutes

  async getOrDecrypt(path: string): Promise<string> {
    const cached = this.cache.get(path);
    if (cached && cached.expiry > Date.now()) {
      return cached.content;
    }

    const content = await this.vault.readDocument(this.userPublicKey, path);
    this.cache.set(path, { content, expiry: Date.now() + this.TTL });
    return content;
  }

  clearSession(): void {
    this.cache.clear();
  }
}
```

### Anti-Patterns to Avoid
- **Using `--retriever api`:** Does not exist in Shad - code will fail
- **Sending decrypted content to external APIs:** Privacy breach
- **Persisting decrypted cache to disk:** Security violation
- **Running Shad for simple queries:** Overkill - use OpenClaw memory
- **Skipping temp vault cleanup:** Leaves plaintext accessible
</architecture_patterns>

<dont_hand_roll>
## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Vector similarity | Custom cosine | sqlite-vec | Optimized SIMD |
| Keyword ranking | Manual TF-IDF | SQLite FTS5 | BM25 is standard |
| Text chunking | Split by chars | OpenClaw chunker | Preserves structure |
| Local embeddings | Custom model | node-llama-cpp | Handles GGUF |
| RLM reasoning | Custom decomposition | Shad | Years of development |
| HTTP retriever for Shad | Custom API mode | Temp vault | API mode doesn't exist |

**Key insight:** The existing `AGIdentityShadBridge` HTTP server pattern **cannot work** with actual Shad. Either use temp vault approach or skip Shad for simple retrieval.
</dont_hand_roll>

<common_pitfalls>
## Common Pitfalls

### Pitfall 1: Using Non-Existent Shad Features
**What goes wrong:** Code uses `--retriever api` which doesn't exist
**Why it happens:** Speculative code written without testing against actual Shad
**How to avoid:** Test with actual Shad CLI; use only `auto`, `qmd`, `filesystem`
**Warning signs:** "unrecognized arguments" errors from Shad

### Pitfall 2: Using Shad for Simple Queries
**What goes wrong:** 30-second task execution for a 100ms query
**Why it happens:** Not understanding that Shad is for complex multi-step tasks
**How to avoid:** Use OpenClaw memory for simple retrieval; Shad for research/analysis
**Warning signs:** High latency for basic questions

### Pitfall 3: Leaving Temp Vault After Shad Execution
**What goes wrong:** Decrypted documents persist on disk
**Why it happens:** Error handling doesn't cleanup, or cleanup not in finally block
**How to avoid:** Always use try/finally with secure delete
**Warning signs:** Temp files found after crashes

### Pitfall 4: Sending Content to External Embedding APIs
**What goes wrong:** Privacy breach - embeddings can be inverted
**Why it happens:** Convenience of OpenAI/Anthropic APIs
**How to avoid:** Use node-llama-cpp for local embedding
**Warning signs:** Network calls during indexing

### Pitfall 5: Only Vector OR Only Keyword Search
**What goes wrong:** Poor recall - misses relevant documents
**Why it happens:** Oversimplification
**How to avoid:** Hybrid search (70% vector, 30% BM25)
**Warning signs:** "I know the document exists but search doesn't find it"

### Pitfall 6: Not Verifying Blockchain Timestamps
**What goes wrong:** Lose provenance guarantees
**Why it happens:** Seen as optional
**How to avoid:** Include verify_document tool returning VaultProof
**Warning signs:** Missing blockchainTxId in results
</common_pitfalls>

<code_examples>
## Code Examples

### Correct Shad CLI Invocation
```typescript
// Source: Actual Shad CLI --help
const args = [
  '-m', 'shad.cli',
  'run', task,
  '--vault', tempVaultPath,        // Point to temp decrypted vault
  '--retriever', 'qmd',            // Or 'filesystem' - NOT 'api'
  '--strategy', 'research',
  '--max-depth', '3',
  '--max-time', '300',
  '--json',
];

const shadProcess = spawn('python3', args);
```

### OpenClaw MCP Memory Tools
```typescript
// Source: MCP SDK + OpenClaw memory tool patterns
import { Server } from '@modelcontextprotocol/sdk/server/index.js';

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === 'memory_search') {
    const { query, limit = 6 } = request.params.arguments;

    // Hybrid search against encrypted vault
    const results = await memoryIndex.search(query, { limit });

    return {
      content: [{ type: 'text', text: JSON.stringify(results) }],
    };
  }

  if (request.params.name === 'memory_get') {
    const { path } = request.params.arguments;

    // Decrypt document on-demand
    const content = await vault.readDocument(userPublicKey, path);

    return {
      content: [{ type: 'text', text: content ?? 'Document not found' }],
    };
  }
});
```

### Secure Temp Vault Creation
```typescript
// Source: Security best practices
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

async function createSecureTempVault(): Promise<string> {
  // Create temp dir with restricted permissions
  const tempDir = await mkdtemp(join(tmpdir(), 'agid-vault-'));

  // Set restrictive permissions (owner only)
  await chmod(tempDir, 0o700);

  return tempDir;
}

async function secureDelete(path: string): Promise<void> {
  // Remove directory and all contents
  await rm(path, { recursive: true, force: true });

  // Note: For high-security, consider secure wipe utilities
}
```
</code_examples>

<sota_updates>
## State of the Art (2025-2026)

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| HTTP API retriever | Not supported in Shad | - | Use temp vault or OpenClaw memory |
| Single retrieval | Hybrid BM25 + Vector | 2024-2025 | 20-30% better recall |
| External embeddings | Local GGUF models | 2025 | Privacy-preserving |
| Flat vector search | HNSW indexing | 2024 | 100x faster |
| Simple RAG | RLM (Shad) for complex tasks | 2025 | Multi-step reasoning |

**New tools to consider:**
- **Shad RLM:** For complex research/analysis tasks (not simple retrieval)
- **sqlite-vec:** In-process vector search
- **node-llama-cpp:** Local embeddings

**Deprecated/outdated:**
- **AGIdentityShadBridge HTTP approach:** Never worked - Shad doesn't support API retriever
- **External embeddings for private data:** Security concern
- **Shad for simple queries:** Overkill - use OpenClaw memory
</sota_updates>

<open_questions>
## Open Questions

1. **Shad qmd vs filesystem retriever**
   - What we know: qmd requires setup but provides better search
   - What's unclear: Whether qmd is worth the setup complexity for temp vault use
   - Recommendation: Start with filesystem, add qmd if search quality insufficient

2. **Temp vault security**
   - What we know: Temp files are security risk
   - What's unclear: Whether ramfs/tmpfs mount is better than disk temp
   - Recommendation: Use tmpdir for now; evaluate ramfs for high-security deployments

3. **When to use Shad vs OpenClaw memory**
   - What we know: Shad for complex tasks, OpenClaw for simple RAG
   - What's unclear: Exact boundary criteria
   - Recommendation: Heuristic - if task needs decomposition or multi-step reasoning, use Shad

4. **Existing AGIdentityShadBridge code**
   - What we know: Uses non-existent `--retriever api` mode
   - What's unclear: Whether to fix or remove entirely
   - Recommendation: Remove and replace with temp vault approach or OpenClaw-native
</open_questions>

<sources>
## Sources

### Primary (HIGH confidence)
- [Shad GitHub Repository](https://github.com/jonesj38/shad) - Actual CLI options and architecture
- [OpenClaw Memory Documentation](https://docs.openclaw.ai/concepts/memory) - Memory system details
- [OpenClaw Memory Search](https://deepwiki.com/openclaw/openclaw/7.3-memory-search) - Implementation

### Secondary (MEDIUM confidence)
- [Shad README](https://github.com/jonesj38/shad) - RLM architecture and strategies
- [OpenClaw MCP Integration](https://github.com/lunarpulse/openclaw-mcp-plugin) - MCP patterns

### Corrections Made
- **Previous research** incorrectly assumed Shad supports HTTP/API retriever
- **Verified:** Shad only supports `auto`, `qmd`, `filesystem` retrievers
- **Existing code** (`AGIdentityShadBridge`) is speculative and non-functional
</sources>

<metadata>
## Metadata

**Research scope:**
- Core technology: Shad RLM + OpenClaw memory integration
- Ecosystem: sqlite-vec, FTS5, node-llama-cpp, qmd
- Patterns: MCP tools, temp vault, hybrid search
- Pitfalls: Non-existent features, security, complexity

**Confidence breakdown:**
- Shad capabilities: HIGH - verified against actual repo
- OpenClaw memory: HIGH - official documentation
- Existing code status: HIGH - verified as non-functional
- Integration patterns: MEDIUM - proposed solutions not yet tested

**Critical findings:**
- Existing `AGIdentityShadBridge` uses non-existent Shad features
- Must use temp vault approach OR OpenClaw-native memory
- Shad is value-add for complex tasks, overkill for simple RAG

**Research date:** 2026-02-14
**Valid until:** 2026-03-14
</metadata>

---

*Phase: 05-shad-semantic-memory*
*Research completed: 2026-02-14*
*Ready for planning: yes*
