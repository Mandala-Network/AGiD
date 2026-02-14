# AGIdentity

**BSV Blockchain Identity & Encrypted Memory for AI Agents**

AGIdentity is a lightweight wrapper around [OpenClaw](https://github.com/openclaw) that adds Edwin-style security features:

- **BRC-100 Wallet Identity**: Each agent has its own blockchain wallet and verifiable identity
- **Encrypted Shad Memory**: Semantic knowledge vault with per-user encryption
- **UHRP Cloud Storage**: Blockchain-timestamped document storage
- **Per-Interaction Encryption**: Perfect Forward Secrecy for all communications
- **Signed Audit Trails**: Cryptographically signed, tamper-evident logs

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

## Installation

```bash
npm install agidentity openclaw
```

## Quick Start

### Standalone Usage

```typescript
import { createAGIdentity } from 'agidentity';

const agidentity = await createAGIdentity({
  storageUrl: 'https://uhrp.example.com',
  network: 'mainnet',
  agentWallet: {
    type: 'privateKey',
    privateKeyWif: 'your-agent-wif-here'
  }
});

// Get agent identity
const identity = await agidentity.wallet.getPublicKey({ identityKey: true });
console.log('Agent Public Key:', identity.publicKey);

// Initialize user's encrypted vault
await agidentity.vault.initializeVault(userPublicKey, 'my-vault');

// Store encrypted document
await agidentity.vault.uploadDocument(
  userPublicKey,
  'notes/meeting.md',
  '# Meeting Notes\n\nDiscussed project timeline...'
);

// Search with Shad
const results = await agidentity.shad.quickRetrieve(
  userPublicKey,
  'project timeline',
  { limit: 5, includeContent: true }
);
```

### With OpenClaw

```typescript
import { createAGIdentityPlugin } from 'agidentity';
import { createGateway } from 'openclaw';

const plugin = createAGIdentityPlugin({
  storageUrl: 'https://uhrp.example.com',
  agentWallet: {
    type: 'privateKey',
    privateKeyWif: 'your-agent-wif-here'
  }
});

const gateway = createGateway({
  plugins: [plugin]
});

await gateway.start();
```

## Security Model

AGIdentity implements the Edwin security model:

### 1. Cryptographic Isolation

The AI agent **never has access to user private keys**. All encryption/decryption happens using BRC-42 derived keys where:
- User's private key stays on their device
- Agent derives shared secrets using ECDH
- Each interaction uses a unique derived key

### 2. Per-Interaction Encryption

Every message uses a unique encryption key:

```typescript
Key = ECDH(user_priv, agent_pub) + HMAC(session-id + message-index + timestamp)
```

Compromising one key reveals nothing about past or future messages.

### 3. User Data Isolation

Each user's vault is encrypted with their own keys:

```
User A's documents → Encrypted with K_A → UHRP Storage
User B's documents → Encrypted with K_B → UHRP Storage

User A CANNOT decrypt User B's documents
```

### 4. Blockchain Timestamps

All documents are timestamped on the BSV blockchain:
- UHRP URL recorded in OP_RETURN transaction
- Cryptographic proof of document existence at time T
- Tamper-evident (changing document changes hash)

### 5. Signed Audit Trails

Every agent action is:
- Signed with the agent's key
- Linked in a hash chain
- Periodically anchored to blockchain

## Agent Tools

AGIdentity registers these tools with OpenClaw:

| Tool | Description |
|------|-------------|
| `memory_recall` | Search encrypted knowledge vault using Shad |
| `deep_research` | Full Shad research with recursive reasoning |
| `store_document` | Save document to encrypted vault |
| `read_document` | Retrieve document from vault |
| `verify_document` | Get blockchain proof for document |
| `list_documents` | List all documents in vault |
| `sign_message` | Cryptographically sign a message |
| `wallet_balance` | Check agent wallet balance |

## CLI Commands

```bash
# Show AGIdentity status
openclaw agidentity:status

# Sync local Obsidian vault to encrypted storage
openclaw agidentity:sync ~/MyVault -k <user-public-key>

# Verify document with blockchain proof
openclaw agidentity:verify notes/meeting.md
```

## Configuration

```typescript
interface AGIdentityConfig {
  // UHRP storage provider URL
  storageUrl: string;

  // BSV network
  network?: 'mainnet' | 'testnet';

  // Agent wallet configuration
  agentWallet: {
    type: 'privateKey' | 'mnemonic' | 'external';
    privateKeyWif?: string;
    mnemonic?: string;
    externalWallet?: BRC100Wallet;
  };

  // Shad configuration
  shad?: {
    pythonPath?: string;
    maxDepth?: number;
    maxTime?: number;
    strategy?: 'software' | 'research' | 'analysis' | 'planning';
  };

  // Payment configuration
  payment?: {
    enabled?: boolean;
    pricePerRequest?: number;
  };

  // Security configuration
  security?: {
    requireAuth?: boolean;
    maxSessionDurationMs?: number;
    timingAnomalyThresholdMs?: number;
  };
}
```

## BRC Standards Used

| Standard | Purpose |
|----------|---------|
| [BRC-42](https://bsv.brc.dev/key-derivation/0042) | Key derivation using ECDH |
| [BRC-43](https://bsv.brc.dev/key-derivation/0043) | Security levels and permissions |
| [BRC-100](https://bsv.brc.dev/wallet/0100) | Wallet interface standard |
| [BRC-103](https://bsv.brc.dev/peer-to-peer/0103) | Mutual authentication |
| [BRC-104](https://bsv.brc.dev/peer-to-peer/0104) | HTTP transport for auth |

## Dependencies

- [OpenClaw](https://github.com/openclaw) - Multi-channel AI gateway
- [Shad](https://github.com/jonesj38/shad) - Semantic memory system
- [@bsv/sdk](https://github.com/bsv-blockchain/ts-sdk) - BSV blockchain SDK
- [@bsv/wallet-toolbox](https://github.com/bsv-blockchain/wallet-toolbox) - BRC-100 wallet tools

## License

MIT
