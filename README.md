# AGIdentity

**BSV Blockchain Identity & Encrypted Memory for AI Agents**

AGIdentity is a lightweight wrapper around [OpenClaw](https://github.com/openclaw) that adds Edwin-style security features for enterprise AI deployments:

- **BRC-100 Wallet Identity**: Each agent has its own blockchain wallet and verifiable identity
- **Encrypted Shad Memory**: Semantic knowledge vault with per-user encryption
- **UHRP Cloud Storage**: Blockchain-timestamped document storage
- **Per-Interaction Encryption**: Perfect Forward Secrecy for all communications
- **Signed Audit Trails**: Cryptographically signed, tamper-evident logs

## Table of Contents

- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Running Tests](#running-tests)
- [API Reference](#api-reference)
- [Security Model](#security-model)
- [Configuration](#configuration)
- [OpenClaw Integration](#openclaw-integration)
- [CLI Commands](#cli-commands)
- [BRC Standards](#brc-standards-used)
- [License](#license)

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         AGIDENTITY ARCHITECTURE                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   USER DEVICE                              AGIDENTITY SERVER            │
│   ───────────                              ─────────────────            │
│   ┌─────────────┐                          ┌─────────────────────────┐  │
│   │  BRC-100    │◄───── Mutual Auth ──────►│  AUTH LAYER (BRC-103)   │  │
│   │  WALLET     │      (BRC-103/104)       │                         │  │
│   │             │                          │  ENCRYPTION LAYER       │  │
│   │  Private    │◄─── Per-Interaction ────►│  (BRC-42 derived keys)  │  │
│   │  Keys       │      Encryption          │                         │  │
│   └─────────────┘                          │  SHAD ENGINE            │  │
│                                            │  (Encrypted retrieval)  │  │
│   ┌─────────────┐                          │                         │  │
│   │  OBSIDIAN   │◄───── Sync ─────────────►│  UHRP STORAGE           │  │
│   │  VAULT      │      (Encrypted)         │  (Blockchain timestamps)│  │
│   └─────────────┘                          └─────────────────────────┘  │
│                                                        │                │
│                                                        ▼                │
│                                            ┌─────────────────────────┐  │
│                                            │    BSV BLOCKCHAIN       │  │
│                                            │  • Document timestamps  │  │
│                                            │  • Audit anchors        │  │
│                                            │  • Identity proofs      │  │
│                                            └─────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

## Prerequisites

- **Node.js** >= 22.0.0
- **npm** or **yarn**
- **Python 3** (optional, for Shad integration)
- **Shad** (optional, `pip install shad`)

## Installation

### From npm (when published)

```bash
npm install agidentity
```

### From Source

```bash
# Clone the repository
git clone https://github.com/b1narydt/AGIdentity.git
cd AGIdentity

# Install dependencies
npm install

# Build the project
npm run build

# Run tests
npm test
```

## Quick Start

### 1. Create an Agent Wallet

First, generate a BSV private key for your agent:

```bash
# Using OpenSSL to generate a random key (for development only)
openssl rand -hex 32
```

Convert this to WIF format using the BSV SDK, or use an existing wallet.

### 2. Standalone Usage

```typescript
import { createAGIdentity } from 'agidentity';

// Initialize AGIdentity
const agidentity = await createAGIdentity({
  storageUrl: 'https://uhrp.example.com',
  network: 'mainnet',
  agentWallet: {
    type: 'privateKey',
    privateKeyWif: 'L1234...' // Your agent's WIF private key
  }
});

// Get agent's public identity
const identity = await agidentity.wallet.getPublicKey({ identityKey: true });
console.log('Agent Public Key:', identity.publicKey);

// Initialize a user's encrypted vault
const userPublicKey = '02abc123...'; // User's BRC-100 public key
await agidentity.vault.initializeVault(userPublicKey, 'user-vault-id');

// Store an encrypted document
const entry = await agidentity.vault.uploadDocument(
  userPublicKey,
  'notes/meeting.md',
  '# Meeting Notes\n\nDiscussed project timeline and deliverables.'
);
console.log('Document stored at:', entry.uhrpUrl);

// Read the document back
const content = await agidentity.vault.readDocument(userPublicKey, 'notes/meeting.md');
console.log('Document content:', content);

// Search with Shad semantic retrieval
const results = await agidentity.shad.quickRetrieve(
  userPublicKey,
  'project timeline',
  { limit: 5, includeContent: true }
);
console.log('Search results:', results);

// Get blockchain proof for a document
const proof = await agidentity.vault.getVaultProof('notes/meeting.md');
console.log('Blockchain TX:', proof.blockchainTxId);
```

### 3. With OpenClaw Plugin

```typescript
import { createAGIdentityPlugin } from 'agidentity';
import { createGateway } from 'openclaw';

// Create the plugin
const plugin = createAGIdentityPlugin({
  storageUrl: 'https://uhrp.example.com',
  network: 'mainnet',
  agentWallet: {
    type: 'privateKey',
    privateKeyWif: process.env.AGENT_PRIVATE_KEY
  },
  shad: {
    pythonPath: 'python3',
    maxDepth: 3,
    strategy: 'research'
  }
});

// Create OpenClaw gateway with the plugin
const gateway = createGateway({
  plugins: [plugin]
});

// Start the gateway
await gateway.start();
```

## Running Tests

AGIdentity includes 137 comprehensive security tests:

```bash
# Run all tests
npm test

# Run tests with coverage
npm run test -- --coverage

# Run specific test file
npm run test -- src/__tests__/cryptographic-security.test.ts

# Run tests in watch mode
npm run test:watch
```

### Test Categories

| Category | Tests | Description |
|----------|-------|-------------|
| Cryptographic Security | 22 | Key derivation, encryption, signatures, HMAC |
| Per-Interaction Encryption | 26 | PFS, unique keys, signed envelopes |
| Session Security | 28 | Timing anomalies, expiration, replay prevention |
| Audit Trail | 25 | Hash chains, tamper detection, anchoring |
| Vault Isolation | 18 | Per-user encryption, content integrity |
| Enterprise Compliance | 18 | Attack vectors, performance, compliance |

## API Reference

### createAGIdentity(config)

Creates a fully initialized AGIdentity instance.

```typescript
const agidentity = await createAGIdentity({
  storageUrl: 'https://uhrp.example.com',
  network: 'mainnet',
  agentWallet: {
    type: 'privateKey',
    privateKeyWif: 'L1234...'
  }
});
```

**Returns**: `AGIdentityInstance` with the following properties:

| Property | Type | Description |
|----------|------|-------------|
| `wallet` | `BRC100Wallet` | Agent's wallet for signing and encryption |
| `storage` | `AGIdentityStorageManager` | UHRP storage manager |
| `vault` | `EncryptedShadVault` | Encrypted document vault |
| `shad` | `AGIdentityShadBridge` | Shad semantic search integration |
| `config` | `AGIdentityConfig` | Configuration used |

### Wallet Methods

```typescript
// Get public key
const { publicKey } = await wallet.getPublicKey({ identityKey: true });

// Encrypt data for a user
const encrypted = await wallet.encrypt({
  plaintext: new TextEncoder().encode('secret'),
  protocolID: [2, 'my-protocol'],
  keyID: 'unique-key-id',
  counterparty: userPublicKey
});

// Decrypt data
const decrypted = await wallet.decrypt({
  ciphertext: encrypted.ciphertext,
  protocolID: [2, 'my-protocol'],
  keyID: 'unique-key-id',
  counterparty: userPublicKey
});

// Create signature
const signature = await wallet.createSignature({
  data: new TextEncoder().encode('message'),
  protocolID: [1, 'signing'],
  keyID: 'sig-key'
});

// Verify signature
const { valid } = await wallet.verifySignature({
  data: new TextEncoder().encode('message'),
  signature: signature.signature,
  protocolID: [1, 'signing'],
  keyID: 'sig-key'
});
```

### Vault Methods

```typescript
// Initialize vault for a user
await vault.initializeVault(userPublicKey, 'vault-id');

// Upload document
const entry = await vault.uploadDocument(userPublicKey, 'path/doc.md', 'content');

// Read document
const content = await vault.readDocument(userPublicKey, 'path/doc.md');

// Search documents
const results = await vault.searchDocuments(userPublicKey, 'query', { limit: 10 });

// List all documents
const docs = vault.listDocuments();

// Get blockchain proof
const proof = await vault.getVaultProof('path/doc.md');

// Sync from local Obsidian vault
const stats = await vault.syncFromLocalVault('/path/to/vault', userPublicKey);
```

### Shad Integration

```typescript
// Quick retrieval (search + optional content)
const results = await shad.quickRetrieve(
  userPublicKey,
  'search query',
  { limit: 5, includeContent: true }
);

// Full Shad task execution
const result = await shad.executeTask(
  userPublicKey,
  'Research how authentication works in the codebase',
  { strategy: 'software', maxDepth: 3, maxTime: 300 }
);

// Check Shad availability
const status = await shad.checkShadAvailable();
```

### Per-Interaction Encryption

```typescript
import { PerInteractionEncryption, SessionEncryption } from 'agidentity';

// Create encryption instance
const encryption = new PerInteractionEncryption(wallet);

// Encrypt a message with unique key
const encrypted = await encryption.encryptMessage(
  userPublicKey,
  'Hello, secure world!',
  {
    sessionId: 'session-123',
    messageIndex: 0,
    timestamp: Date.now(),
    direction: 'outbound'
  }
);

// Decrypt
const decrypted = await encryption.decryptMessage(userPublicKey, encrypted);

// Create signed envelope (encryption + authentication)
const envelope = await encryption.createSignedEnvelope(
  userPublicKey,
  'Authenticated message',
  context
);

// Verify and decrypt
const result = await encryption.verifyAndDecrypt(userPublicKey, envelope);
console.log(result.plaintext, result.signatureValid);

// Session-based encryption (auto-increments message index)
const session = new SessionEncryption(wallet, userPublicKey);
const enc1 = await session.encryptOutbound('Message 1');
const enc2 = await session.encryptOutbound('Message 2');
```

### Audit Trail

```typescript
import { SignedAuditTrail } from 'agidentity';

const audit = new SignedAuditTrail({
  wallet,
  anchorToBlockchain: true,
  anchorIntervalEntries: 100
});

// Create audit entry
const entry = await audit.createEntry({
  action: 'document.access',
  userPublicKey: 'user-key',
  agentPublicKey: 'agent-key',
  input: 'document path',
  output: 'document content hash',
  metadata: { endpoint: '/api/docs' }
});

// Verify entry
const verification = await audit.verifyEntry(entry);

// Verify entire chain
const chainVerification = await audit.verifyChain();

// Query entries
const userEntries = await audit.getEntriesForUser(userPublicKey);
const actionEntries = audit.getEntriesByAction('document.access');
const rangeEntries = audit.getEntriesInRange(startTime, endTime);

// Export/import
const json = audit.exportToJson();
await audit.importFromJson(json);
```

### Session Management

```typescript
import { SessionManager } from 'agidentity';

const sessions = new SessionManager({
  wallet,
  maxSessionDurationMs: 24 * 60 * 60 * 1000, // 24 hours
  timingAnomalyThresholdMs: 500
});

// Create session
const session = await sessions.createSession(userPublicKey);

// Verify session (with timing anomaly detection)
const result = await sessions.verifySession(
  session.sessionId,
  signature,
  clientTimestamp
);

// Get/refresh/invalidate
const active = sessions.getSession(sessionId);
sessions.refreshSession(sessionId);
sessions.invalidateSession(sessionId);
sessions.invalidateUserSessions(userPublicKey);

// Statistics
const stats = sessions.getStats();
```

## Security Model

AGIdentity implements the Edwin security model with multiple layers of protection:

### 1. Cryptographic Isolation

The AI agent **never has access to user private keys**:

```
User Device                         Agent Server
┌──────────────┐                   ┌──────────────┐
│ Private Key  │                   │ Agent Key    │
│ (never sent) │                   │              │
└──────┬───────┘                   └──────┬───────┘
       │                                  │
       └────────► ECDH Shared Secret ◄────┘
                         │
                   Derived Keys
                   (per-interaction)
```

### 2. Per-Interaction Encryption (Perfect Forward Secrecy)

Every message uses a unique derived key:

```
Key_i = HMAC(SharedSecret, session_id || message_index || timestamp || direction)
```

**Security Properties**:
- Compromising key K_i reveals nothing about K_j (i ≠ j)
- Past messages remain secure even if current key is compromised
- Unique key for each direction (inbound vs outbound)

### 3. Per-User Data Isolation

Each user's vault is encrypted with their own derived keys:

```
User A: Document → Encrypt(K_A) → UHRP → Blockchain Timestamp
User B: Document → Encrypt(K_B) → UHRP → Blockchain Timestamp

K_A ≠ K_B → User A cannot decrypt User B's documents
```

### 4. Timing Anomaly Detection

Sessions are protected against replay and timing attacks:

- Clock drift detection (configurable threshold)
- Future timestamp rejection
- Old timestamp rejection (replay protection)
- Constant-time secret comparison

### 5. Signed Audit Trails

Every action creates a tamper-evident record:

```
Entry_n:
  - action, timestamp, hashes
  - previous_entry_hash (chain linkage)
  - signature (agent's key)

Tampering Entry_n → Breaks chain at Entry_n+1
```

Periodic blockchain anchoring provides irrefutable timestamps.

## Configuration

```typescript
interface AGIdentityConfig {
  // Required: UHRP storage provider URL
  storageUrl: string;

  // BSV network (default: 'mainnet')
  network?: 'mainnet' | 'testnet';

  // Agent wallet configuration
  agentWallet: {
    type: 'privateKey' | 'mnemonic' | 'external';
    privateKeyWif?: string;      // For 'privateKey' type
    mnemonic?: string;           // For 'mnemonic' type
    externalWallet?: BRC100Wallet; // For 'external' type
    storagePath?: string;        // Wallet storage location
  };

  // Shad configuration (optional)
  shad?: {
    pythonPath?: string;         // Path to Python (default: 'python3')
    shadPath?: string;           // Shad installation path
    maxDepth?: number;           // Max search depth (default: 3)
    maxNodes?: number;           // Max nodes to explore (default: 50)
    maxTime?: number;            // Timeout in seconds (default: 300)
    strategy?: 'software' | 'research' | 'analysis' | 'planning';
    retriever?: 'auto' | 'qmd' | 'filesystem' | 'api';
  };

  // Payment configuration (optional)
  payment?: {
    enabled?: boolean;
    pricePerRequest?: number;    // Satoshis per request
    freeRequestsPerDay?: number;
    premiumFeatures?: string[];
  };

  // Security configuration (optional)
  security?: {
    requireAuth?: boolean;
    allowUnauthenticated?: boolean;
    maxSessionDurationMs?: number;      // Default: 24 hours
    timingAnomalyThresholdMs?: number;  // Default: 500ms
    auditToBlockchain?: boolean;
  };
}
```

## OpenClaw Integration

### Registered Tools

| Tool | Description |
|------|-------------|
| `memory_recall` | Search encrypted knowledge vault using Shad semantic retrieval |
| `deep_research` | Full Shad research with recursive reasoning |
| `store_document` | Save document to encrypted vault with blockchain timestamp |
| `read_document` | Retrieve and decrypt document from vault |
| `verify_document` | Get blockchain proof for document existence |
| `list_documents` | List all documents in user's vault |
| `sign_message` | Cryptographically sign a message with agent identity |
| `wallet_balance` | Check agent wallet balance |

### Hooks

- `before_agent_start`: Injects agent context and auto-retrieves relevant vault content
- `agent_end`: Signs audit entry for the interaction

## CLI Commands

When using with OpenClaw:

```bash
# Show AGIdentity status
openclaw agidentity:status

# Sync local Obsidian vault to encrypted UHRP storage
openclaw agidentity:sync /path/to/vault -k <user-public-key>

# Verify document with blockchain proof
openclaw agidentity:verify notes/meeting.md
```

## BRC Standards Used

| Standard | Purpose |
|----------|---------|
| [BRC-42](https://brc.dev/42) | Key derivation using ECDH + HMAC |
| [BRC-43](https://brc.dev/43) | Security levels (0=public, 1=app, 2=counterparty) |
| [BRC-100](https://brc.dev/100) | Wallet interface standard |
| [BRC-103](https://brc.dev/103) | Mutual authentication protocol |
| [BRC-104](https://brc.dev/104) | HTTP transport for authentication |

## Project Structure

```
agidentity/
├── src/
│   ├── index.ts              # Main exports and factory functions
│   ├── wallet/
│   │   └── agent-wallet.ts   # BRC-100 wallet implementation
│   ├── encryption/
│   │   └── per-interaction.ts # PFS encryption
│   ├── shad/
│   │   ├── encrypted-vault.ts # Encrypted document vault
│   │   └── shad-integration.ts # Shad CLI bridge
│   ├── uhrp/
│   │   └── storage-manager.ts # UHRP upload/download
│   ├── audit/
│   │   └── signed-audit.ts   # Hash chain audit trail
│   ├── auth/
│   │   └── session-manager.ts # Session management
│   ├── plugin/
│   │   └── agidentity-plugin.ts # OpenClaw plugin
│   ├── types/
│   │   ├── index.ts          # Core type definitions
│   │   └── openclaw-plugin.ts # Plugin types
│   └── __tests__/            # 137 security tests
├── dist/                     # Compiled output
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

## Dependencies

| Package | Purpose |
|---------|---------|
| [@bsv/sdk](https://github.com/bsv-blockchain/ts-sdk) | BSV blockchain operations |
| [@bsv/wallet-toolbox](https://github.com/bsv-blockchain/wallet-toolbox) | BRC-100 wallet utilities |
| [express](https://expressjs.com/) | HTTP server for Shad retrieval |
| [zod](https://zod.dev/) | Runtime type validation |
| [openclaw](https://github.com/openclaw) | AI gateway (peer dependency) |
| [shad](https://github.com/jonesj38/shad) | Semantic memory (optional) |

## Environment Variables

```bash
# Agent private key (WIF format)
AGENT_PRIVATE_KEY=L1234...

# UHRP storage provider
UHRP_STORAGE_URL=https://uhrp.example.com

# Network (mainnet or testnet)
BSV_NETWORK=mainnet

# Python path for Shad
PYTHON_PATH=/usr/bin/python3
```

## License

MIT

## Contributing

Contributions are welcome! Please ensure all tests pass before submitting PRs:

```bash
npm test        # Run tests
npm run build   # Build TypeScript
npm run lint    # Check code style
```
