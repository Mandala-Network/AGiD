# x402 Service Registry Overlay

Decentralized discovery and verification for x402 paid HTTP services. Service operators publish minimal 5-field registration tokens on-chain. Clients query the overlay to find services by category, capability, or operator identity — and compare pricing — without relying on a centralized registry.

## How It Works

1. **Register** — Operator creates a PushDrop token: host URL, category, pricing, capabilities. Signed by their identity key.
2. **Discover** — Clients query `ls_x402` by category, capability, host URL, identity key, or max price.
3. **Verify** — PushDrop signature proves operator identity. Mutual authentication at request time proves the server holds the key.
4. **De-list** — Spending the registration UTXO removes the service from the overlay.

## Token Format (5 fields)

| Index | Field | Example |
|-------|-------|---------|
| 0 | protocol | `"x402-registry-v1"` |
| 1 | hostUrl | `"https://api.example.com"` |
| 2 | category | `"ai"` |
| 3 | pricing | `{"currency":"satoshis","defaultPrice":100,...}` |
| 4 | capabilities | `["search","generate"]` |

Name, description, docs, and contact info are fetched from `{hostUrl}/.well-known/x402-info`. Operator identity comes from the PushDrop locking key. Timestamp comes from the block.

## Quick Start

```bash
cp .env.example .env
# Edit .env with your private key, database URLs, and hosting domain

npm install
npm run dev
```

Requires MySQL and MongoDB. See `.env.example` for configuration.

## Querying

```typescript
import { LookupResolver } from '@bsv/sdk'

const resolver = new LookupResolver({ networkPreset: 'mainnet' })

// Find AI services
await resolver.query({ service: 'ls_x402', query: { category: 'ai' } })

// Find services with search capability
await resolver.query({ service: 'ls_x402', query: { capability: 'search' } })

// Agent price comparison — AI services under 200 sats default
await resolver.query({ service: 'ls_x402', query: { category: 'ai', maxDefaultPrice: 200 } })

// Look up a specific host
await resolver.query({ service: 'ls_x402', query: { hostUrl: 'https://api.example.com' } })

// All services by an operator
await resolver.query({ service: 'ls_x402', query: { identityKey: '02abc...def' } })
```

## Registering a Service

```typescript
import { PushDrop, WalletClient } from '@bsv/sdk'

const wallet = new WalletClient()
const pushDrop = new PushDrop(wallet)

const fields = [
  'x402-registry-v1',
  'https://api.example.com',
  'ai',
  JSON.stringify({
    currency: 'satoshis',
    endpoints: [
      { path: '/search', method: 'GET', price: 100 },
      { path: '/generate', method: 'POST', price: 500 }
    ],
    defaultPrice: 100,
    freeEndpoints: ['/.well-known/x402-info', '/health']
  }),
  JSON.stringify(['search', 'generate']),
]

const lockingScript = await pushDrop.lock(
  fields.map(f => Array.from(Buffer.from(f, 'utf8'))),
  [1, 'x402-registry'],
  'registration',
  'self',
  true,
  true
)

await wallet.createAction({
  description: 'Register x402 service',
  outputs: [{
    lockingScript: lockingScript.toHex(),
    satoshis: 1,
    basket: 'x402-registrations',
    tags: ['x402', 'registration']
  }]
})
```

## Specification

See `specs/x402-registry-overlay.md` for the full technical specification.

## License

Open BSV License
