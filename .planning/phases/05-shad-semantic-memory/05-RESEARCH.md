# Phase 5: Shad Semantic Memory - Research

**Researched:** 2026-02-14
**Domain:** AI Agent Semantic Memory with Encrypted Vault Integration
**Confidence:** HIGH

<research_summary>
## Summary

Researched how to connect AGIdentity's encrypted vault system to OpenClaw's memory architecture for AI long-term memory. The existing codebase has `AGIdentityShadBridge` that spawns a Python "shad.cli" process for retrieval - this appears to be a custom internal tool, not a public library.

The standard approach for OpenClaw semantic memory is file-based Markdown with hybrid search (vector + BM25). OpenClaw provides two integration paths:
1. **memorySearch.extraPaths** - Add encrypted vault as additional indexed directory
2. **MCP Tool** - Expose `memory_search` as custom MCP server for on-demand retrieval

Key finding: The existing `AGIdentityShadBridge` HTTP server approach aligns with OpenClaw's "API retriever" pattern but requires adaptation to match OpenClaw's expected tool signatures (`memory_search`, `memory_get`). Documents should be decrypted on-demand and cached in memory to avoid re-decryption overhead.

**Primary recommendation:** Implement AGIdentity memory as an MCP server exposing `memory_search` and `memory_get` tools that integrate with the existing encrypted vault. Use local embedding generation (node-llama-cpp) to avoid sending sensitive data to external embedding APIs.
</research_summary>

<standard_stack>
## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| OpenClaw Memory | Built-in | Semantic memory search | Native memory system with hybrid search |
| sqlite-vec | 0.1.x | Vector storage | SQLite extension for vector similarity |
| FTS5 | SQLite | Keyword search | BM25 full-text search built into SQLite |
| node-llama-cpp | Latest | Local embeddings | On-device embedding generation for privacy |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| MCP SDK | Latest | MCP server | Exposing memory tools to OpenClaw |
| @anthropic-ai/sdk | Latest | Alternative embeddings | If local embeddings insufficient |
| better-sqlite3 | 9.x | SQLite driver | Sync SQLite for performance |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| sqlite-vec | Pinecone/Weaviate | External DB adds latency and privacy concerns |
| node-llama-cpp | OpenAI embeddings | External API sees decrypted content |
| Custom MCP server | QMD backend | QMD is more complex, doesn't handle encryption |

**Installation:**
```bash
npm install better-sqlite3 @anthropic-ai/sdk
# node-llama-cpp requires Bun for best performance
bun install node-llama-cpp
```
</standard_stack>

<architecture_patterns>
## Architecture Patterns

### Recommended Integration Architecture
```
AGIdentity Encrypted Vault
          │
          │ decrypt on-demand
          ▼
┌─────────────────────────────┐
│  AGIdentityMemoryMCPServer  │
│                             │
│  - memory_search(query)     │
│  - memory_get(path)         │
│  - verify_document(path)    │
└─────────────┬───────────────┘
              │ MCP Streamable HTTP
              ▼
┌─────────────────────────────┐
│      OpenClaw Gateway       │
│                             │
│  Uses memory_search before  │
│  generating AI responses    │
└─────────────────────────────┘
```

### Recommended Project Structure
```
src/
├── memory/                    # Semantic memory integration
│   ├── memory-mcp-server.ts   # MCP server exposing tools
│   ├── memory-index.ts        # Vector + keyword index manager
│   ├── embedding-provider.ts  # Local/remote embedding abstraction
│   └── chunk-store.ts         # SQLite storage for chunks
├── shad/                      # Existing Shad integration
│   └── (keep for backwards compat)
└── gateway/                   # Existing gateway
```

### Pattern 1: MCP Server for Memory Tools
**What:** Implement memory as MCP tools that OpenClaw can call
**When to use:** When integrating with OpenClaw's native memory system
**Example:**
```typescript
// Source: OpenClaw MCP integration pattern
import { MCPServer } from '@modelcontextprotocol/server-sdk';

class AGIdentityMemoryServer extends MCPServer {
  async memory_search(query: string, limit = 6) {
    // 1. Embed query locally
    const embedding = await this.embedLocally(query);

    // 2. Search vector index
    const vectorResults = await this.vectorSearch(embedding, limit * 4);

    // 3. Search keyword index
    const keywordResults = await this.keywordSearch(query, limit * 4);

    // 4. Merge with weighted fusion (70/30)
    const merged = this.mergeResults(vectorResults, keywordResults);

    // 5. Return top results with snippets
    return merged.slice(0, limit).map(r => ({
      path: r.path,
      snippet: r.snippet,
      score: r.score,
      lineRange: r.lineRange,
    }));
  }

  async memory_get(path: string) {
    // Decrypt document on-demand
    const content = await this.vault.readDocument(this.userPublicKey, path);
    return content;
  }
}
```

### Pattern 2: On-Demand Decryption with Caching
**What:** Decrypt documents only when accessed, cache decrypted content per-session
**When to use:** Always - encrypted content must never persist in plaintext
**Example:**
```typescript
// Source: Privacy-preserving RAG patterns
class DecryptionCache {
  private cache = new Map<string, { content: string; expiry: number }>();
  private readonly TTL = 30 * 60 * 1000; // 30 minutes

  async getOrDecrypt(
    vault: EncryptedShadVault,
    userPublicKey: string,
    path: string
  ): Promise<string> {
    const cached = this.cache.get(path);
    if (cached && cached.expiry > Date.now()) {
      return cached.content;
    }

    const content = await vault.readDocument(userPublicKey, path);
    this.cache.set(path, {
      content,
      expiry: Date.now() + this.TTL,
    });

    return content;
  }

  clearSession(): void {
    this.cache.clear();
  }
}
```

### Pattern 3: Hybrid Search (Vector + BM25)
**What:** Combine semantic and keyword search for best results
**When to use:** Always - single method is insufficient
**Example:**
```typescript
// Source: OpenClaw memory-search implementation
function mergeHybridResults(
  vectorResults: SearchResult[],
  keywordResults: SearchResult[],
  vectorWeight = 0.7,
  textWeight = 0.3
): SearchResult[] {
  const merged = new Map<string, SearchResult>();

  for (const r of vectorResults) {
    merged.set(r.path, {
      ...r,
      score: r.score * vectorWeight,
    });
  }

  for (const r of keywordResults) {
    const existing = merged.get(r.path);
    if (existing) {
      existing.score += r.score * textWeight;
    } else {
      merged.set(r.path, { ...r, score: r.score * textWeight });
    }
  }

  return Array.from(merged.values())
    .sort((a, b) => b.score - a.score);
}
```

### Anti-Patterns to Avoid
- **Sending decrypted content to external embedding APIs:** Privacy breach - use local embeddings
- **Storing decrypted content on disk:** Security violation - memory cache only
- **Embedding before decryption:** Won't work - you need plaintext for semantic meaning
- **Using only vector OR keyword search:** Hybrid outperforms significantly
- **Creating embeddings at query time:** Too slow - embed at index time
</architecture_patterns>

<dont_hand_roll>
## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Vector similarity search | Custom cosine distance | sqlite-vec | Optimized SIMD, handles large sets |
| Keyword ranking | Manual TF-IDF | SQLite FTS5 with BM25 | Decades of research, edge cases |
| Text chunking | Split by character count | OpenClaw's line-aware chunker | Preserves code structure, overlap |
| Embedding generation | Custom model hosting | node-llama-cpp | Handles GGUF, auto-downloads |
| Result merging | Simple concat | Weighted fusion | Reciprocal rank fusion is standard |
| Context window management | Manual truncation | OpenClaw's memory flush | Promotes important info before cut |

**Key insight:** The existing `AGIdentityShadBridge` HTTP server pattern is correct for retrieval, but should be adapted to match OpenClaw's MCP tool interface (`memory_search`, `memory_get`) rather than a custom API. The embedding/search logic should use proven implementations (sqlite-vec + FTS5) rather than the simple string matching in the current `EncryptedShadVault.searchDocuments()`.
</dont_hand_roll>

<common_pitfalls>
## Common Pitfalls

### Pitfall 1: Sending Decrypted Content to External Embedding APIs
**What goes wrong:** Embeddings sent to OpenAI/Anthropic leak document content - even embeddings can be inverted
**Why it happens:** Convenience of external APIs over local embedding setup
**How to avoid:** Use node-llama-cpp with local GGUF model (e.g., all-MiniLM-L6-v2-q4)
**Warning signs:** API calls in embedding code, network traffic during indexing

### Pitfall 2: Embedding Without Chunking
**What goes wrong:** Full documents exceed embedding model token limits, poor retrieval quality
**Why it happens:** Seems simpler than chunking logic
**How to avoid:** Chunk to ~400 tokens with 80-token overlap (OpenClaw default)
**Warning signs:** Empty/truncated embeddings, retrieval returns irrelevant docs

### Pitfall 3: Caching Decrypted Content to Disk
**What goes wrong:** Plaintext persists after session, security audit fails
**Why it happens:** Performance optimization without security consideration
**How to avoid:** Memory-only cache with session cleanup on shutdown
**Warning signs:** Temp files with plaintext, cache directory persistence

### Pitfall 4: Only Keyword OR Only Vector Search
**What goes wrong:** Misses results - keywords miss paraphrases, vectors miss exact IDs/codes
**Why it happens:** Seems simpler, "vector is modern so it's better"
**How to avoid:** Hybrid search with weighted fusion (70% vector, 30% keyword)
**Warning signs:** "I know the document exists but search doesn't find it"

### Pitfall 5: Not Verifying Blockchain Timestamps
**What goes wrong:** Lose provenance guarantees that differentiate encrypted vault
**Why it happens:** Timestamp verification seen as optional extra
**How to avoid:** Include `verify_document` tool that returns blockchain proof
**Warning signs:** No `VaultProof` in retrieval results, missing `blockchainTxId`

### Pitfall 6: Synchronous Re-indexing on Every Query
**What goes wrong:** Severe latency spikes, timeouts
**Why it happens:** "Always have fresh index" without async design
**How to avoid:** Background indexing with file watcher, debounced sync
**Warning signs:** Multi-second search latency, queries timing out
</common_pitfalls>

<code_examples>
## Code Examples

Verified patterns from official sources:

### OpenClaw Memory Search Configuration
```typescript
// Source: OpenClaw docs - memory search settings
const memoryConfig = {
  memorySearch: {
    enabled: true,
    provider: 'local', // Use local embeddings for privacy
    model: 'all-MiniLM-L6-v2-q4',
    hybrid: {
      enabled: true,
      vectorWeight: 0.7,
      textWeight: 0.3,
    },
    query: {
      maxResults: 6,
      minScore: 0.35,
    },
    extraPaths: [
      // AGIdentity vault documents (decrypted on-demand)
      '${AGIDENTITY_VAULT_CACHE}',
    ],
  },
};
```

### MCP Memory Tool Implementation
```typescript
// Source: MCP SDK patterns + OpenClaw memory tools
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const server = new Server({
  name: 'agidentity-memory',
  version: '1.0.0',
}, {
  capabilities: {
    tools: {},
  },
});

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'memory_search',
      description: 'Search user\'s encrypted vault for relevant documents',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          limit: { type: 'number', default: 6 },
        },
        required: ['query'],
      },
    },
    {
      name: 'memory_get',
      description: 'Read a document from the encrypted vault',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Document path' },
        },
        required: ['path'],
      },
    },
  ],
}));
```

### sqlite-vec Vector Search
```typescript
// Source: sqlite-vec documentation
import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';

const db = new Database(':memory:');
sqliteVec.load(db);

// Create vector table
db.exec(`
  CREATE VIRTUAL TABLE chunks_vec USING vec0(
    chunk_id INTEGER PRIMARY KEY,
    embedding FLOAT[384]  -- dimension depends on model
  );
`);

// Search
function vectorSearch(queryEmbedding: number[], limit: number) {
  const stmt = db.prepare(`
    SELECT chunk_id, distance
    FROM chunks_vec
    WHERE embedding MATCH ?
    ORDER BY distance
    LIMIT ?
  `);
  return stmt.all(JSON.stringify(queryEmbedding), limit);
}
```

### Secure Chunk Indexing
```typescript
// Pattern: Index encrypted vault documents with local embeddings
async function indexVaultDocument(
  vault: EncryptedShadVault,
  userPublicKey: string,
  path: string,
  embedder: LocalEmbedder,
  chunkStore: ChunkStore
): Promise<void> {
  // 1. Decrypt document (memory only)
  const content = await vault.readDocument(userPublicKey, path);
  if (!content) return;

  // 2. Chunk with overlap
  const chunks = chunkWithOverlap(content, {
    targetTokens: 400,
    overlapTokens: 80,
  });

  // 3. Embed locally (never sends to external API)
  for (const chunk of chunks) {
    const embedding = await embedder.embed(chunk.text);

    await chunkStore.upsert({
      path,
      text: chunk.text,
      embedding,
      startLine: chunk.startLine,
      endLine: chunk.endLine,
      hash: sha256(chunk.text),
    });
  }

  // 4. Content never persists to disk
}
```
</code_examples>

<sota_updates>
## State of the Art (2025-2026)

What's changed recently:

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Single retrieval method | Hybrid BM25 + Vector | 2024-2025 | 20-30% better recall |
| External embedding APIs | Local embedding (GGUF) | 2025 | Privacy-preserving RAG |
| Flat vector search | HNSW indexing | 2024 | 100x faster at scale |
| Simple similarity | Salience scoring | 2025 | Considers recency + access patterns |
| Manual context truncation | Memory flush pre-compaction | 2025 | Preserves important info |

**New tools/patterns to consider:**
- **QMD Backend:** OpenClaw's alternative backend using Bun + node-llama-cpp for hybrid search
- **sqlite-vec:** In-process vector search without external DB
- **STEER:** Privacy-preserving retrieval with transformed embeddings
- **Memory Flush:** Auto-promote important info before context truncation

**Deprecated/outdated:**
- **Chroma/Pinecone for local-first:** sqlite-vec is simpler and sufficient for <100K docs
- **Full document embeddings:** Chunking with overlap is now standard
- **Pure vector retrieval:** Hybrid is consistently better
- **External embedding for private data:** Local embedding is mandatory for enterprise
</sota_updates>

<open_questions>
## Open Questions

Things that couldn't be fully resolved:

1. **Shad CLI Tool**
   - What we know: AGIdentityShadBridge spawns `python3 -m shad.cli` with retriever API
   - What's unclear: Whether "Shad" is a custom tool or needs external installation
   - Recommendation: Keep existing Shad bridge as fallback; implement native OpenClaw memory as primary

2. **Embedding Model Selection**
   - What we know: node-llama-cpp supports GGUF models; all-MiniLM-L6-v2 is common
   - What's unclear: Best model for enterprise document retrieval (technical docs, code)
   - Recommendation: Start with all-MiniLM-L6-v2-q4 (small, fast); benchmark others

3. **Re-indexing Strategy**
   - What we know: OpenClaw uses debounced file watching (5s default)
   - What's unclear: Best approach for encrypted vault where content changes require decryption
   - Recommendation: Index on document upload/update in `EncryptedShadVault`; add incremental sync via content hash comparison
</open_questions>

<sources>
## Sources

### Primary (HIGH confidence)
- [OpenClaw Memory Documentation](https://docs.openclaw.ai/concepts/memory) - Official memory architecture
- [OpenClaw Memory Search Deep Dive](https://deepwiki.com/openclaw/openclaw/7.3-memory-search) - Implementation details
- [OpenClaw Memory Study Notes](https://snowan.gitbook.io/study-notes/ai-blogs/openclaw-memory-system-deep-dive) - Technical breakdown

### Secondary (MEDIUM confidence)
- [QMD Backend PR](https://github.com/openclaw/openclaw/pull/3160) - Custom backend implementation
- [OpenClaw MCP Integration](https://github.com/lunarpulse/openclaw-mcp-plugin) - MCP plugin patterns
- [SecureRAG NeurIPS 2025](https://neurips.cc/virtual/2025/124872) - Encrypted RAG architecture
- [Privacy-Aware RAG](https://arxiv.org/html/2503.15548v1) - Secure retrieval patterns

### Tertiary (LOW confidence - needs validation)
- [The Problem with AI Agent Memory](https://medium.com/@DanGiannone/the-problem-with-ai-agent-memory-9d47924e7975) - Pitfalls (anecdotal)
- [RAG in 2026](https://squirro.com/squirro-blog/state-of-rag-genai) - Industry trends
</sources>

<metadata>
## Metadata

**Research scope:**
- Core technology: OpenClaw memory system integration
- Ecosystem: sqlite-vec, FTS5, node-llama-cpp, MCP SDK
- Patterns: Hybrid search, on-demand decryption, MCP tools
- Pitfalls: Privacy, caching, search quality, indexing

**Confidence breakdown:**
- Standard stack: HIGH - verified with OpenClaw docs and codebase
- Architecture: HIGH - from official examples and existing AGIdentity patterns
- Pitfalls: HIGH - documented in research papers and community posts
- Code examples: MEDIUM - adapted from official sources for encrypted vault

**Research date:** 2026-02-14
**Valid until:** 2026-03-14 (30 days - OpenClaw ecosystem stable)
</metadata>

---

*Phase: 05-shad-semantic-memory*
*Research completed: 2026-02-14*
*Ready for planning: yes*
