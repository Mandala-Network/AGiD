# @agid/x402-client

Register, update, remove, and discover x402 paid services on the overlay. One class, four methods.

## Install

```bash
npm install @agid/x402-client @bsv/sdk
```

## Register a Service

```typescript
import { X402RegistryClient } from '@agid/x402-client'

const client = new X402RegistryClient()

const result = await client.register({
  hostUrl: 'https://api.example.com',
  category: 'ai',
  pricing: {
    currency: 'satoshis',
    defaultPrice: 100,
    endpoints: [
      { path: '/search', method: 'GET', price: 100 },
      { path: '/generate', method: 'POST', price: 500 },
    ],
    freeEndpoints: ['/.well-known/x402-info', '/health'],
  },
  capabilities: ['search', 'generate'],
})

console.log(result.txid)         // on-chain registration
console.log(result.identityKey)  // operator identity
```

## Discover Services

```typescript
// All AI services
const services = await client.discover({ category: 'ai' })

// Services with search capability
const services = await client.discover({ capability: 'search' })

// AI services under 200 sats
const services = await client.discover({ category: 'ai', maxDefaultPrice: 200 })

// Specific host
const services = await client.discover({ hostUrl: 'https://api.example.com' })

// All services by an operator
const services = await client.discover({ identityKey: '02abc...def' })

// Everything
const services = await client.discover()
```

Each result includes `hostUrl`, `category`, `pricing`, `capabilities`, `identityKey`, `txid`, and `outputIndex`.

## Update a Registration

Spends the old token and creates a new one in a single atomic action.

```typescript
await client.update(result.txid, result.outputIndex, {
  hostUrl: 'https://api.example.com',
  category: 'ai',
  pricing: {
    currency: 'satoshis',
    defaultPrice: 150,  // price changed
    endpoints: [
      { path: '/search', method: 'GET', price: 150 },
      { path: '/generate', method: 'POST', price: 600 },
    ],
  },
  capabilities: ['search', 'generate', 'summarize'],  // added capability
})
```

## Remove a Registration

Spends the registration UTXO. The overlay removes the listing.

```typescript
await client.remove(result.txid, result.outputIndex)
```

## Fetch Host Metadata

Get name, description, docs — the info not stored on-chain.

```typescript
const info = await client.fetchServiceInfo('https://api.example.com')
// { name: '...', description: '...', contactUrl: '...', ... }
```

## How It Works

1. **Register** creates a PushDrop token with 5 fields (`protocol`, `hostUrl`, `category`, `pricing`, `capabilities`), broadcasts via `TopicBroadcaster` to `tm_x402`.
2. **Discover** queries `ls_x402` via `LookupResolver`, decodes PushDrop fields from returned UTXOs.
3. **Update** atomically spends old token + creates new token in one `createAction`.
4. **Remove** spends the token UTXO, triggering overlay removal.

Identity key is derived from the PushDrop locking key. Timestamp from the block. Name/description fetched from the host.

## License

Open BSV License
