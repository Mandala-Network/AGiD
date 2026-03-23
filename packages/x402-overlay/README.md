# x402 Service Registry Overlay

Decentralized discovery and verification for x402 paid HTTP services. Service operators publish registration tokens on-chain. Clients query the overlay to find services by category, capability, or operator identity — without relying on a centralized registry.

## How It Works

1. **Register** — An operator creates a PushDrop token containing their host URL, pricing, capabilities, and service metadata. The token is signed by their identity key and submitted to the overlay.

2. **Discover** — Clients query `ls_x402` to find services by category (`"ai"`, `"data"`, `"compute"`), capability (`"search"`, `"generate"`), host URL, or operator identity key.

3. **Verify** — Each registration is signed by the operator's identity key and anchored on-chain. Clients verify the signature, then use mutual authentication when making paid requests to confirm the server holds the same key.

4. **De-list** — Spending the registration UTXO removes the service from the overlay. Operators control their own listings.

## Quick Start

```bash
cp .env.example .env
# Edit .env with your private key, database URLs, and hosting domain

npm install
npm run dev
```

Requires MySQL and MongoDB. See `.env.example` for all configuration options.

## Querying the Registry

```typescript
import { LookupResolver } from '@bsv/sdk'

const resolver = new LookupResolver({ networkPreset: 'mainnet' })

// Find all AI services
const result = await resolver.query({
  service: 'ls_x402',
  query: { category: 'ai' }
})

// Find services with search capability
const result = await resolver.query({
  service: 'ls_x402',
  query: { capability: 'search' }
})

// Look up a specific host
const result = await resolver.query({
  service: 'ls_x402',
  query: { hostUrl: 'https://api.example.com' }
})

// Find all services by an operator
const result = await resolver.query({
  service: 'ls_x402',
  query: { identityKey: '02abc...def' }
})
```

## Registering a Service

```typescript
import { PushDrop, WalletClient } from '@bsv/sdk'

const wallet = new WalletClient()

const fields = [
  'x402-registry-v1',                          // protocol
  'https://api.example.com',                    // hostUrl
  'Example AI Service',                         // name
  'AI-powered search and generation',           // description
  'ai',                                         // category
  JSON.stringify({                              // pricing
    currency: 'satoshis',
    endpoints: [
      { path: '/search', method: 'GET', price: 100 },
      { path: '/generate', method: 'POST', price: 500 }
    ],
    defaultPrice: 100,
    freeEndpoints: ['/.well-known/x402-info', '/health']
  }),
  JSON.stringify(['search', 'generate']),       // capabilities
  'https://example.com/support',                // contactUrl
  new Date().toISOString(),                     // registeredAt
]

const pushDrop = new PushDrop(wallet)
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

## Registration Token Format

| Index | Field | Description |
|-------|-------|-------------|
| 0 | protocol | `"x402-registry-v1"` |
| 1 | hostUrl | Service base URL (HTTPS required) |
| 2 | name | Service name (max 100 chars) |
| 3 | description | Description (max 500 chars) |
| 4 | category | Category identifier (max 50 chars) |
| 5 | pricing | JSON pricing object |
| 6 | capabilities | JSON array of capability strings |
| 7 | contactUrl | Support URL (optional) |
| 8 | registeredAt | ISO 8601 timestamp |

## Architecture

```
src/
├── index.ts                           # Server entry point
└── services/
    └── x402/
        ├── X402TopicManager.ts        # Validates registration tokens
        ├── X402LookupService.ts       # Indexes and queries registrations
        ├── X402LookupServiceFactory.ts # MongoDB factory
        ├── X402Storage.ts             # Persistence layer
        ├── X402Types.ts               # Type definitions
        └── index.ts                   # Barrel exports
```

## Specification

See `specs/x402-registry-overlay.md` for the full technical specification including protocol format, validation rules, pricing schema, query types, and security considerations.

## License

Open BSV License
