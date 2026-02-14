# AGIdentity (AGID)

**The Identity Layer for AI Agents**

AGIdentity is the cryptographic identity infrastructure that makes AI agents deployable in enterprises. Every agent action is verified, every user's data is isolated, and every decision is auditable.

## Key Features

- **Verified Agent Identity**: Every action cryptographically signed and attributable
- **Isolated Memory**: User A's data invisible to User B, same infrastructure
- **Blockchain-Anchored Audit Trails**: Immutable, tamper-proof, timestamped
- **Per-Interaction Encryption**: Perfect Forward Secrecy for all communications
- **Team Collaboration**: CurvePoint group encryption for shared documents
- **BRC-103/104 Mutual Auth**: Enterprise-grade HTTP authentication
- **Revocable Certificates**: When someone leaves, access dies instantly

## Table of Contents

- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Running the Server](#running-the-server)
- [Client SDK](#client-sdk)
- [API Reference](#api-reference)
- [Messaging](#messaging)
- [Certificate Identity](#certificate-identity)
- [Team Vault](#team-vault)
- [Security Model](#security-model)
- [Configuration](#configuration)
- [OpenClaw Integration](#openclaw-integration)
- [Running Tests](#running-tests)
- [BRC Standards](#brc-standards-used)
- [License](#license)

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              AGIdentity System                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────┐    ┌──────────────────┐    ┌────────────────────────┐  │
│  │  AgentWallet    │    │  Auth Server     │    │   MessageBox Client    │  │
│  │  (BRC-100)      │◄──►│  (BRC-103/104)   │◄──►│   (Async Messaging)    │  │
│  └────────┬────────┘    └────────┬─────────┘    └───────────┬────────────┘  │
│           │                      │                          │               │
│           ▼                      ▼                          ▼               │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                        AGIdentity Core                                  │ │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌───────────────┐  │ │
│  │  │  Identity   │  │  Encrypted  │  │    Team     │  │    Audit      │  │ │
│  │  │    Gate     │  │    Vault    │  │    Vault    │  │    Trail      │  │ │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  └───────────────┘  │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                          Storage Layer                                  │ │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌───────────────┐  │ │
│  │  │   Local     │  │    UHRP     │  │    Shad     │  │  BSV          │  │ │
│  │  │  Vault      │  │   Storage   │  │  Integration│  │  Blockchain   │  │ │
│  │  │  (Fast)     │  │  (Cloud)    │  │  (RLM)      │  │  (Timestamps) │  │ │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  └───────────────┘  │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Prerequisites

- **Node.js** >= 22.0.0
- **npm** >= 9.0.0
- **Python 3** (optional, for Shad RLM integration)
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
cd AGIdentity/agidentity

# Install dependencies
npm install

# Build the project
npm run build

# Run tests
npm test
```

## Quick Start

### 1. Set Up Environment

Create a `.env` file (copy from `.env.example`):

```bash
cp .env.example .env
```

Edit `.env` with your configuration:

```bash
# Agent private key (generate with: openssl rand -hex 32)
AGENT_PRIVATE_KEY=your-private-key-hex

# Network
BSV_NETWORK=mainnet

# Storage
UHRP_STORAGE_URL=https://uhrp.babbage.systems
OBSIDIAN_VAULT_PATH=~/Documents/ObsidianVault

# Server
AGID_SERVER_PORT=3000

# Messaging
MESSAGEBOX_HOST=https://messagebox.babbage.systems
```

### 2. Standalone Usage

```typescript
import { createAGIdentity } from 'agidentity';

// Initialize AGIdentity
const agidentity = await createAGIdentity({
  storageUrl: process.env.UHRP_STORAGE_URL!,
  network: 'mainnet',
  agentWallet: {
    type: 'privateKey',
    privateKeyHex: process.env.AGENT_PRIVATE_KEY!
  }
});

// Get agent's public identity
const identity = await agidentity.wallet.getPublicKey({ identityKey: true });
console.log('Agent Public Key:', identity.publicKey);

// Initialize a user's encrypted vault
const userPublicKey = '02abc123...';
await agidentity.vault.initializeVault(userPublicKey, 'user-vault-id');

// Store an encrypted document
await agidentity.vault.uploadDocument(
  userPublicKey,
  'notes/meeting.md',
  '# Meeting Notes\n\nDiscussed project timeline.'
);

// Search with Shad semantic retrieval
const results = await agidentity.shad.quickRetrieve(
  'project timeline',
  { limit: 5, includeContent: true }
);
```

### 3. Full Service with Server and Messaging

```typescript
import { createAGIdentityService } from 'agidentity';

// Create the unified service
const agid = await createAGIdentityService({
  wallet: {
    type: 'privateKey',
    privateKeyHex: process.env.AGENT_PRIVATE_KEY!,
    network: 'mainnet',
  },
  storageUrl: process.env.UHRP_STORAGE_URL!,
  server: {
    enabled: true,
    port: 3000,
    trustedCertifiers: ['03abc...'],
  },
  messaging: {
    enabled: true,
    messageBoxHost: process.env.MESSAGEBOX_HOST,
  },
});

// Start the service
await agid.start();

// Listen for messages
agid.messaging?.onMessage('commands', async (msg) => {
  console.log('Received:', msg.body);
  await agid.messaging?.acknowledgeMessage(msg.messageId);
});

await agid.messaging?.listenForMessages('commands');

// Graceful shutdown
process.on('SIGINT', () => agid.stop());
```

## Running the Server

### Development

```bash
# Start the server
npm run start

# Or with ts-node for development
npx ts-node src/examples/server.ts
```

### Production

```typescript
import { createAGIdentityService } from 'agidentity';
import { loadConfig } from 'agidentity';

const config = loadConfig();

const agid = await createAGIdentityService({
  wallet: {
    type: 'privateKey',
    privateKeyHex: config.agentPrivateKey,
    network: config.network,
  },
  storageUrl: config.uhrpStorageUrl,
  server: {
    enabled: true,
    port: config.serverPort,
    trustedCertifiers: config.trustedCertifiers,
    allowUnauthenticated: false,
  },
  messaging: {
    enabled: true,
    messageBoxHost: config.messageBoxHost,
  },
});

await agid.start();
console.log(`AGIdentity server running on port ${config.serverPort}`);
console.log(`Agent identity: ${await agid.getIdentityKey()}`);
```

### Server Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/identity` | Optional | Get agent and client identity |
| POST | `/identity/register` | Required | Register session |
| POST | `/vault/init` | Required | Initialize user vault |
| POST | `/vault/store` | Required | Store encrypted document |
| GET | `/vault/read/:path` | Required | Read encrypted document |
| GET | `/vault/list` | Required | List all documents |
| POST | `/vault/search` | Required | Search documents |
| GET | `/vault/proof/:path` | Required | Get blockchain proof |
| POST | `/team/create` | Required | Create team |
| GET | `/team/:id` | Required | Get team details |
| POST | `/team/:id/member` | Required | Add team member |
| DELETE | `/team/:id/member/:key` | Required | Remove member |
| GET | `/team/:id/access` | Required | Check access |
| POST | `/team/:id/document` | Required | Store team document |
| GET | `/team/:id/document/:path` | Required | Read team document |
| GET | `/team/:id/documents` | Required | List team documents |
| POST | `/sign` | Required | Sign message |
| POST | `/verify` | Required | Verify signature |
| GET | `/health` | None | Health check |
| GET | `/status` | Optional | Session status |

## Client SDK

The Client SDK provides authenticated access to AGIdentity servers.

### Installation

The client is included in the main package:

```typescript
import { createAGIDClient } from 'agidentity';
```

### Basic Usage

```typescript
import { createAGIDClient, createAgentWallet } from 'agidentity';

// Create wallet for authentication
const { wallet } = await createAgentWallet({
  type: 'privateKey',
  privateKeyHex: process.env.CLIENT_PRIVATE_KEY!,
  network: 'mainnet',
});

// Create client
const client = createAGIDClient({
  wallet,
  serverUrl: 'http://localhost:3000',
  timeout: 30000,
  retries: 3,
});

// Initialize
await client.initialize();

// Full setup (register session + init vault)
const { session, vault } = await client.setup();
console.log('Session created:', session.publicKey);
console.log('Vault initialized:', vault.vaultId);

// Store document
await client.storeDocument('notes/meeting.md', '# Meeting Notes');

// Read document
const doc = await client.readDocument('notes/meeting.md');
console.log('Content:', doc.data?.content);

// Search
const results = await client.searchDocuments('meeting', 5);

// Create team
const team = await client.createTeam('Engineering');

// Add team member
await client.addTeamMember(team.data!.teamId, memberPublicKey, 'member');

// Sign message
const sig = await client.signMessage('Important message');
console.log('Signature:', sig.data?.signature);
```

### Batch Operations

```typescript
// Store multiple documents
const results = await client.storeDocuments([
  { path: 'doc1.md', content: 'Content 1' },
  { path: 'doc2.md', content: 'Content 2' },
  { path: 'doc3.md', content: 'Content 3' },
]);

// Read multiple documents
const docs = await client.readDocuments(['doc1.md', 'doc2.md', 'doc3.md']);
docs.forEach((content, path) => {
  console.log(`${path}: ${content}`);
});
```

### Error Handling

```typescript
const result = await client.storeDocument('path.md', 'content');

if (!result.success) {
  console.error('Error:', result.error);
  console.error('Status:', result.statusCode);
} else {
  console.log('Stored:', result.data?.path);
}
```

## API Reference

### createAGIdentityService(config)

Creates a unified AGIdentity service with all components.

```typescript
const agid = await createAGIdentityService({
  wallet: {
    type: 'privateKey',
    privateKeyHex: '...',
    network: 'mainnet',
  },
  storageUrl: 'https://uhrp.example.com',
  server: {
    enabled: true,
    port: 3000,
    trustedCertifiers: ['03abc...'],
    allowUnauthenticated: false,
  },
  messaging: {
    enabled: true,
    messageBoxHost: 'https://messagebox.babbage.systems',
  },
  teams: {
    requireCertificates: false,
  },
  shad: {
    strategy: 'research',
    maxDepth: 3,
  },
});
```

**Returns**: `AGIdentityService` with:

| Property | Type | Description |
|----------|------|-------------|
| `wallet` | `AgentWallet` | BRC-100 wallet |
| `storage` | `AGIdentityStorageManager` | UHRP storage |
| `vault` | `EncryptedShadVault` | Encrypted vault |
| `shad` | `AGIdentityShadBridge` | Shad integration |
| `encryption` | `PerInteractionEncryption` | PFS encryption |
| `identityGate` | `IdentityGate` | Certificate verification |
| `teamVault` | `TeamVault` | Team collaboration |
| `server` | `AGIDServer \| null` | HTTP server |
| `messaging` | `AGIDMessageClient \| null` | Messaging client |

### Wallet Methods

```typescript
// Get identity key
const { publicKey } = await wallet.getPublicKey({ identityKey: true });

// Encrypt data
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
  data: Array.from(new TextEncoder().encode('message')),
  protocolID: [1, 'signing'],
  keyID: 'sig-key'
});

// Verify signature
const { valid } = await wallet.verifySignature({
  data: Array.from(new TextEncoder().encode('message')),
  signature: signature.signature,
  protocolID: [1, 'signing'],
  keyID: 'sig-key'
});
```

### Vault Methods

```typescript
// Initialize vault
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

### Per-Interaction Encryption

```typescript
import { PerInteractionEncryption, SessionEncryption } from 'agidentity';

const encryption = new PerInteractionEncryption(wallet);

// Encrypt with unique key
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

// Session-based (auto message index)
const session = new SessionEncryption(wallet, userPublicKey);
const enc1 = await session.encryptOutbound('Message 1');
const enc2 = await session.encryptOutbound('Message 2');
```

## Messaging

AGIdentity includes a MessageBox client for encrypted P2P messaging.

```typescript
// Get messaging client from service
const messaging = agid.messaging!;

// Send encrypted message
await messaging.sendMessage(
  recipientPublicKey,
  'inbox',
  { type: 'greeting', text: 'Hello!' }
);

// Send live message (WebSocket with HTTP fallback)
await messaging.sendLiveMessage(recipientPublicKey, 'inbox', 'Live message');

// Listen for messages
messaging.onMessage('inbox', async (msg) => {
  console.log('From:', msg.sender);
  console.log('Body:', msg.body);
  await messaging.acknowledgeMessage(msg.messageId);
});

await messaging.listenForMessages('inbox');

// Send payment
await messaging.sendPayment(recipientPublicKey, 1000); // satoshis

// Listen for payments
messaging.onPayment(async (payment) => {
  console.log('Payment:', payment.amount, 'from', payment.sender);
  return true; // Accept
});

await messaging.listenForPayments();

// Set permissions
await messaging.setPermission('inbox', { recipientFee: 100 }); // Require fee
await messaging.allowNotificationsFrom(peerPublicKey);
await messaging.denyNotificationsFrom(spammerPublicKey);
```

## Certificate Identity

AGIdentity implements BRC-52/53 certificate-based identity for enterprise access control.

### Certificate Authority

```typescript
import { CertificateAuthority } from 'agidentity';

const ca = new CertificateAuthority({
  wallet: adminWallet,
  organizationName: 'Acme Corp',
});
await ca.initialize();

// Issue employee certificate
const cert = await ca.issueCertificate({
  subjectPublicKey: employeePublicKey,
  certificateType: 'employee',
  fields: {
    name: 'Alice Smith',
    email: 'alice@acme.com',
    department: 'Engineering',
    validFrom: new Date().toISOString(),
    validUntil: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
  },
});

// Revoke on offboarding
await ca.revokeCertificate(cert.serialNumber, 'Employment terminated');
```

### Identity Gate

```typescript
import { IdentityGate } from 'agidentity';

const gate = new IdentityGate({
  wallet,
  trustedCertifiers: [caPublicKey],
  requireCertificate: true,
});
await gate.initialize();

// Verify identity
const result = await gate.verifyIdentity(certificate);
if (!result.verified) {
  throw new Error(`Access denied: ${result.error}`);
}

// Gated operation
const data = await gate.gatedOperation(certificate, async () => {
  return await sensitiveOperation();
});
```

## Team Vault

Team collaboration with CurvePoint group encryption.

```typescript
import { TeamVault } from 'agidentity';

const teamVault = new TeamVault({ wallet });

// Create team
const team = await teamVault.createTeam('Engineering', ownerPublicKey);

// Add members
await teamVault.addMember(team.teamId, memberPublicKey, 'member', ownerPublicKey);
await teamVault.addBot(team.teamId, botPublicKey, ownerPublicKey);

// Store team document (encrypted for all members)
await teamVault.storeDocument(
  team.teamId,
  '/docs/api-spec.md',
  'API specification...',
  authorPublicKey
);

// Read document
const content = await teamVault.readDocumentText(team.teamId, '/docs/api-spec.md');

// Check access
const access = await teamVault.checkAccess(team.teamId, userPublicKey);

// Remove member (re-encrypts all documents)
await teamVault.removeMember(team.teamId, exMemberPublicKey, ownerPublicKey);
```

### Team Roles

| Role | Add Members | Remove Members | Write Docs | Delete Docs |
|------|-------------|----------------|------------|-------------|
| owner | Yes | Yes | Yes | Yes |
| admin | Yes | Members only | Yes | Yes |
| member | No | No | Yes | No |
| bot | No | No | Yes | No |

## Security Model

### 1. Cryptographic Isolation

The AI agent never has access to user private keys:

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

### 3. Per-User Data Isolation

Each user's vault is encrypted with their own derived keys.

### 4. Timing Anomaly Detection

Sessions are protected against replay and timing attacks.

### 5. Signed Audit Trails

Every action creates a tamper-evident, blockchain-anchored record.

## Configuration

### Environment Variables

```bash
# Required
AGENT_PRIVATE_KEY=your-64-char-hex-private-key

# Network
BSV_NETWORK=mainnet

# Storage
UHRP_STORAGE_URL=https://uhrp.babbage.systems
OBSIDIAN_VAULT_PATH=~/Documents/ObsidianVault
VAULT_AUTO_WARMUP=true
VAULT_CACHE_DIR=./.vault-cache

# Server
AGID_SERVER_PORT=3000
AGID_SERVER_LOGGING=true
AGID_SERVER_LOG_LEVEL=info
ALLOW_UNAUTHENTICATED=false

# Messaging
MESSAGEBOX_HOST=https://messagebox.babbage.systems
MESSAGEBOX_LOGGING=false

# Shad
SHAD_PATH=~/.shad
SHAD_PYTHON_PATH=python3
SHAD_STRATEGY=research
SHAD_MAX_DEPTH=3
SHAD_MAX_NODES=50
SHAD_MAX_TIME=300

# Security
TRUSTED_CERTIFIERS=03abc...,03def...
```

### Programmatic Configuration

```typescript
import { getConfig, loadConfig } from 'agidentity';

// Load from environment
loadConfig();

// Get current config
const config = getConfig();
console.log(config.serverPort); // 3000
```

## OpenClaw Integration

### Plugin Usage

```typescript
import { createAGIdentityPlugin } from 'agidentity';
import { createGateway } from 'openclaw';

const plugin = createAGIdentityPlugin({
  storageUrl: process.env.UHRP_STORAGE_URL!,
  network: 'mainnet',
  agentWallet: {
    type: 'privateKey',
    privateKeyHex: process.env.AGENT_PRIVATE_KEY!
  },
  shad: {
    strategy: 'research',
    maxDepth: 3,
  }
});

const gateway = createGateway({
  plugins: [plugin]
});

await gateway.start();
```

### Registered Tools

| Tool | Description |
|------|-------------|
| `wallet_info` | Get wallet and session info |
| `memory_recall` | Search encrypted vault with Shad |
| `deep_research` | Full Shad RLM execution |
| `store_document` | Save encrypted document |
| `read_document` | Retrieve encrypted document |
| `verify_document` | Get blockchain proof |
| `list_documents` | List all documents |
| `sign_message` | Sign with agent identity |

### Hooks

- `before_agent_start`: Injects context and auto-retrieves relevant vault content
- `agent_end`: Signs audit entry for the interaction

## Running Tests

AGIdentity includes 235 comprehensive security tests:

```bash
# Run all tests
npm test

# Run with coverage
npm run test -- --coverage

# Run specific test
npm run test -- src/__tests__/client-sdk.test.ts

# Watch mode
npm run test:watch
```

### Test Coverage

| Category | Tests | Description |
|----------|-------|-------------|
| Client SDK | 25 | HTTP client, auth, batching |
| Per-Interaction Encryption | 26 | PFS, unique keys, envelopes |
| Cryptographic Security | 22 | Key derivation, signatures |
| Certificate Identity | 29 | Certificates, verification |
| Team Vault | 44 | Group encryption, RBAC |
| Vault Isolation | 18 | Per-user encryption |
| Enterprise Compliance | 18 | Attack vectors, performance |
| Audit Trail | 25 | Hash chains, tamper detection |
| Session Security | 28 | Timing, expiration, replay |

## Project Structure

```
agidentity/
├── src/
│   ├── index.ts              # Main exports
│   ├── wallet/
│   │   └── agent-wallet.ts   # BRC-100 wallet
│   ├── client/
│   │   └── agidentity-client.ts # Client SDK
│   ├── server/
│   │   └── auth-server.ts    # HTTP server with BRC-103
│   ├── messaging/
│   │   └── message-client.ts # MessageBox client
│   ├── service/
│   │   └── agidentity-service.ts # Unified service
│   ├── encryption/
│   │   └── per-interaction.ts # PFS encryption
│   ├── identity/
│   │   └── identity-gate.ts  # Certificate verification
│   ├── team/
│   │   └── team-vault.ts     # CurvePoint group encryption
│   ├── shad/
│   │   ├── encrypted-vault.ts # Encrypted vault
│   │   └── shad-integration.ts # Shad RLM bridge
│   ├── vault/
│   │   └── local-encrypted-vault.ts # Fast local vault
│   ├── uhrp/
│   │   └── storage-manager.ts # UHRP storage
│   ├── audit/
│   │   └── signed-audit.ts   # Hash chain audit
│   ├── auth/
│   │   └── session-manager.ts # Session management
│   ├── config/
│   │   └── index.ts          # Configuration
│   ├── plugin/
│   │   └── agidentity-plugin.ts # OpenClaw plugin
│   ├── types/
│   │   └── index.ts          # TypeScript types
│   └── __tests__/            # 235 tests
├── dist/                     # Compiled output
├── .env.example              # Environment template
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

## BRC Standards Used

| Standard | Purpose |
|----------|---------|
| [BRC-42](https://brc.dev/42) | Key derivation (ECDH + HMAC) |
| [BRC-43](https://brc.dev/43) | Security levels |
| [BRC-52](https://brc.dev/52) | Identity certificates |
| [BRC-53](https://brc.dev/53) | Certificate fields |
| [BRC-100](https://brc.dev/100) | Wallet interface |
| [BRC-103](https://brc.dev/103) | Mutual authentication |
| [BRC-104](https://brc.dev/104) | HTTP transport |

## Dependencies

| Package | Purpose |
|---------|---------|
| @bsv/sdk | BSV blockchain operations |
| @bsv/wallet-toolbox | BRC-100 wallet |
| @bsv/auth-express-middleware | BRC-103/104 auth |
| @bsv/message-box-client | P2P messaging |
| curvepoint | Group encryption |
| express | HTTP server |
| dotenv | Environment config |

## License

MIT

## Contributing

```bash
npm test        # Run tests (all must pass)
npm run build   # Build TypeScript
npm run lint    # Check code style
```

---

**SSL unlocked e-commerce. AGIdentity unlocks enterprise AI.**
