# AGIdentity OpenClaw Plugin

OpenClaw plugin that provides wallet and memory tools for AI agents with cryptographic identity.

## Features

- **Wallet Tools**: Interact with MPC-protected BSV wallet
- **Memory Tools**: Store and retrieve encrypted memories on BSV blockchain
- **TypeBox Validation**: All parameters validated with TypeBox schemas
- **Secure by Default**: Wallet tools require explicit allowlist

## Installation

1. Copy this directory to your OpenClaw installation:

```bash
cp -r extensions/agidentity-tools /path/to/openclaw/extensions/
```

2. Install dependencies:

```bash
cd /path/to/openclaw/extensions/agidentity-tools
npm install
```

3. OpenClaw will automatically discover and load the plugin.

## Configuration

Add configuration to your OpenClaw `config.json5`:

```json5
{
  "plugins": {
    "agidentity-tools": {
      "gatewayUrl": "http://localhost:3000",
      "authToken": "optional-bearer-token"
    }
  }
}
```

### Configuration Options

- **gatewayUrl** (optional): AGIdentity gateway HTTP endpoint. Default: `http://localhost:3000`
- **authToken** (optional): Bearer token for authenticated requests (if required by gateway)

## Tools

### Wallet Tools (Require Allowlist)

#### `agid_get_balance`

Get current BSV wallet balance in satoshis and UTXO count.

**Parameters**: None

**Example**:
```typescript
const result = await agid_get_balance();
// Returns: "Balance: 100000 satoshis (5 UTXOs)"
```

#### `agid_create_transaction`

Create an unsigned BSV transaction to send satoshis.

**Parameters**:
- `recipient` (string, required): BSV address (P2PKH starting with 1)
- `satoshis` (integer, required): Amount in satoshis (1 BSV = 100,000,000 sats)
- `data` (string, optional): Optional OP_RETURN data (hex, max 100KB)

**Example**:
```typescript
const result = await agid_create_transaction({
  recipient: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa",
  satoshis: 10000,
  data: "48656c6c6f" // "Hello" in hex
});
// Returns: Transaction hex, TXID, size, fee
```

**Note**: This creates but does NOT broadcast the transaction. Use separate broadcast tool or service.

### Memory Tools (Available by Default)

#### `agid_store_memory`

Store information in agent's long-term encrypted memory on BSV blockchain.

**Parameters**:
- `content` (string, required): Information to remember
- `tags` (string[], optional): Tags for categorization (e.g., ["meeting", "todo"])

**Example**:
```typescript
const result = await agid_store_memory({
  content: "User prefers dark mode and sans-serif fonts",
  tags: ["preferences", "ui"]
});
// Returns: Path and UHRP URL for stored memory
```

#### `agid_recall_memory`

Search agent's long-term memory for relevant information.

**Parameters**:
- `query` (string, required): What to search for
- `limit` (integer, optional): Max results (default: 3, max: 10)

**Example**:
```typescript
const result = await agid_recall_memory({
  query: "user interface preferences",
  limit: 5
});
// Returns: Ranked list of relevant memories
```

## Security

### Wallet Tool Allowlist

Wallet tools (`agid_get_balance`, `agid_create_transaction`) are marked as **optional** and require explicit allowlist in OpenClaw configuration:

```json5
{
  "tools": {
    "allowlist": [
      "agid_get_balance",
      "agid_create_transaction"
    ]
  }
}
```

Without explicit allowlist, these tools will not be available to the agent.

### Sandbox Mode

Wallet tools are automatically disabled when OpenClaw runs in sandbox mode, preventing unauthorized financial operations.

Memory tools are available in all modes (safe for general use).

## Development

### Build

```bash
npm run build
```

### TypeScript

The plugin uses TypeScript with ESM modules. TypeScript configuration extends from the root AGIdentity project.

## License

Part of the AGIdentity project.
