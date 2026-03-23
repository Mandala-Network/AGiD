# x402 Service Registry Overlay

## Abstract

This specification defines an overlay network protocol for registering, discovering, and verifying paid HTTP services (x402 services). Service operators publish minimal on-chain registration tokens containing their host URL, category, pricing, and capabilities. Clients query the overlay to discover services, compare pricing, and verify operator identity — without relying on a centralized registry.

## Motivation

The x402 payment protocol enables authenticated, paid HTTP requests between clients and services. Today, service discovery depends on centralized registries (e.g., a `/.well-known/agents` endpoint on a single domain). This creates a single point of failure, a trust bottleneck, and a barrier to entry for new service operators.

An overlay-based registry solves these problems:

1. **Decentralized discovery** — any client can query any overlay node to find services. No single registry controls visibility.
2. **Verifiable identity** — each registration is signed by the operator's identity key and anchored on-chain. Clients can verify that a service URL is controlled by a specific identity.
3. **Tamper-evident pricing** — pricing is committed on-chain. Clients can detect if a service changes prices without publishing a new registration.
4. **Permissionless registration** — any identity can register a service by creating a transaction. No approval process. No gatekeepers.
5. **Revocable listings** — spending the registration UTXO removes the service from the overlay. Operators control their own listings.

## Design Principle: Minimal On-Chain Footprint

Only data required for **discovery queries** and **price comparison** is stored on-chain. Descriptive metadata (service name, description, documentation, contact info) is fetched from the host at `/.well-known/x402-info`. This keeps token size to roughly **100-300 bytes** depending on the number of priced endpoints.

The block timestamp provides registration time. The PushDrop locking key provides operator identity. No need to duplicate either in the token fields.

## Specification

### 1. Registration Token Format

A service registration is a PushDrop token with 5 ordered fields:

| Index | Field | Type | Description |
|-------|-------|------|-------------|
| 0 | `protocol` | string | Always `"x402-registry-v1"` |
| 1 | `hostUrl` | string | Base URL of the service (HTTPS required) |
| 2 | `category` | string | Service category (e.g., `"ai"`, `"data"`, `"compute"`, `"storage"`, `"search"`) |
| 3 | `pricing` | string | JSON-encoded pricing object (see Section 2) |
| 4 | `capabilities` | string | JSON-encoded array of capability strings |

The token is locked using PushDrop with:
- `protocolID`: `[1, "x402-registry"]`
- `keyID`: `"registration"`
- `counterparty`: `"self"`
- Stored in basket: `"x402-registrations"`

**Operator identity** is derived from the PushDrop locking public key — no separate identity field needed.

**Registration timestamp** is derived from the block containing the transaction — no separate timestamp field needed.

**Service name, description, documentation, and contact info** are fetched from `{hostUrl}/.well-known/x402-info` — not stored on-chain.

### 2. Pricing Object

The `pricing` field (index 3) is a JSON-encoded object:

```json
{
  "currency": "satoshis",
  "endpoints": [
    { "path": "/search", "method": "GET", "price": 100 },
    { "path": "/generate", "method": "POST", "price": 500 }
  ],
  "defaultPrice": 100,
  "freeEndpoints": ["/.well-known/x402-info", "/health"]
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `currency` | yes | Always `"satoshis"` for this version |
| `endpoints` | no | Array of endpoint-specific pricing |
| `endpoints[].path` | yes | URL path pattern |
| `endpoints[].method` | yes | HTTP method |
| `endpoints[].price` | yes | Price in satoshis per request |
| `defaultPrice` | no | Default price for unlisted endpoints |
| `freeEndpoints` | no | Array of paths that require no payment |

Operators should keep the pricing object concise. List only priced endpoints — omit descriptions and rate limits here (serve those from `/.well-known/x402-info`).

### 3. Capabilities Array

The `capabilities` field (index 4) is a JSON-encoded array of standardized capability strings:

```json
["search", "generate", "analyze"]
```

Common capability identifiers:

| Capability | Description |
|------------|-------------|
| `search` | Information retrieval |
| `generate` | Content generation |
| `analyze` | Data analysis |
| `translate` | Language translation |
| `transcribe` | Audio/video transcription |
| `embed` | Vector embedding generation |
| `classify` | Content classification |
| `summarize` | Content summarization |
| `execute` | Code/command execution |
| `store` | Data storage |
| `retrieve` | Data retrieval |

Operators may use custom capability strings beyond this list.

### 4. Host Metadata Endpoint

Services should expose `/.well-known/x402-info` returning descriptive metadata not stored on-chain:

```json
{
  "name": "Example AI Service",
  "description": "AI-powered search and content generation",
  "identityKey": "02abc...def",
  "contactUrl": "https://example.com/support",
  "documentationUrl": "https://docs.example.com",
  "pricing": { ... },
  "capabilities": ["search", "generate"]
}
```

This endpoint is unauthenticated and free. Clients fetch it after overlay discovery to get display metadata before making paid requests.

### 5. Topic Manager: `tm_x402`

The topic manager validates incoming registration transactions.

**Admittance rules:**

1. The output must be a valid PushDrop token with at least 5 fields.
2. Field 0 must equal `"x402-registry-v1"`.
3. Field 1 (`hostUrl`) must start with `"https://"`.
4. Field 2 (`category`) must be a non-empty string, max 50 characters.
5. Field 3 (`pricing`) must be valid JSON with a `currency` field.
6. Field 4 (`capabilities`) must be a valid JSON array of strings.
7. The PushDrop signature must be valid (verified by the PushDrop.decode process).

**Spending rules:**

When a registration UTXO is spent, the service is removed from the overlay. This is how operators de-list a service.

### 6. Lookup Service: `ls_x402`

The lookup service indexes admitted registrations and supports the following query types:

**Query by category:**
```json
{ "service": "ls_x402", "query": { "category": "ai" } }
```

**Query by capability:**
```json
{ "service": "ls_x402", "query": { "capability": "search" } }
```

**Query by host URL (exact match):**
```json
{ "service": "ls_x402", "query": { "hostUrl": "https://api.example.com" } }
```

**Query by operator identity key:**
```json
{ "service": "ls_x402", "query": { "identityKey": "02abc...def" } }
```

**Query by max price (agents comparing costs):**
```json
{ "service": "ls_x402", "query": { "category": "ai", "maxDefaultPrice": 200 } }
```

**Query all registrations:**
```json
{ "service": "ls_x402", "query": {} }
```

The lookup service returns UTXO references. The client decodes PushDrop fields from the returned outputs to reconstruct the 5-field registration.

### 7. Registration Lifecycle

**Create:**
1. Operator constructs a PushDrop token with the 5 fields.
2. Operator submits the transaction to the overlay.
3. The topic manager validates and admits the output.
4. The lookup service indexes the registration.

**Update:**
1. Operator spends the existing registration UTXO (removes from overlay).
2. Operator creates a new token with updated fields.
3. Both can be in the same atomic action.

**Remove:**
1. Operator spends the registration UTXO.
2. The lookup service removes the record on `outputSpent`.

### 8. Client Verification

After discovering a service via the overlay, clients should:

1. Verify the PushDrop signature to confirm the registration was created by the claimed identity key.
2. Fetch `/.well-known/x402-info` from the `hostUrl` to get display metadata and compare the identity key.
3. Use mutual authentication when making paid requests, confirming the server holds the same private key.

This creates a chain of trust: the on-chain registration proves the identity key registered the service, and mutual authentication proves the server holds that key.

### 9. Interaction with x402 Payment Flow

The x402 payment flow is unchanged. The overlay provides discovery and trust — payment mechanics remain:

1. Client discovers service via `ls_x402` overlay query.
2. Client compares on-chain pricing across services.
3. Client sends authenticated request to chosen service.
4. Service returns `402 Payment Required` with payment instructions.
5. Client constructs payment transaction per the instructions.
6. Client retries the request with payment proof.
7. Service validates payment and returns the response.

On-chain pricing allows agents to estimate and compare costs before making requests. The authoritative price is always the `402` response from the service itself.

## Security Considerations

- **URL ownership is not proven on-chain.** The overlay proves that an identity key registered a URL, not that the identity controls the server. Mutual authentication at request time is the verification mechanism.
- **Stale registrations.** A service may go offline without spending its registration UTXO. Clients should handle connection failures gracefully.
- **Price discrepancy.** On-chain pricing is informational. The server's `402` response is authoritative. Clients should compare the two and flag mismatches.
- **Spam.** Each registration costs a transaction fee, providing a natural economic barrier. Overlay operators may apply additional admittance criteria.

## Reference Implementation

See `packages/x402-overlay/` for a complete implementation including:
- `X402TopicManager` — validates registration tokens
- `X402LookupService` — indexes and queries registrations
- `X402Storage` — MongoDB persistence
- Integration with `@bsv/overlay-express`
