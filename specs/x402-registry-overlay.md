# x402 Service Registry Overlay

## Abstract

This specification defines an overlay network protocol for registering, discovering, and verifying paid HTTP services (x402 services). Service operators publish on-chain registration tokens containing their host URL, pricing, accepted payment methods, and service metadata. Clients query the overlay to discover services, compare pricing, and verify that a host is operated by a known identity — all without relying on a centralized registry.

## Motivation

The x402 payment protocol enables authenticated, paid HTTP requests between clients and services. Today, service discovery depends on centralized registries (e.g., a `/.well-known/agents` endpoint on a single domain). This creates a single point of failure, a trust bottleneck, and a barrier to entry for new service operators.

An overlay-based registry solves these problems:

1. **Decentralized discovery** — any client can query any overlay node to find services. No single registry controls visibility.
2. **Verifiable identity** — each registration is signed by the operator's identity key and anchored on-chain. Clients can verify that a service URL is controlled by a specific identity.
3. **Tamper-evident pricing** — pricing is committed on-chain. Clients can detect if a service changes prices without publishing a new registration.
4. **Permissionless registration** — any identity can register a service by creating a transaction. No approval process. No gatekeepers.
5. **Revocable listings** — spending the registration UTXO removes the service from the overlay. Operators control their own listings.

## Specification

### 1. Registration Token Format

A service registration is a PushDrop token with the following ordered fields:

| Index | Field | Type | Description |
|-------|-------|------|-------------|
| 0 | `protocol` | string | Always `"x402-registry-v1"` |
| 1 | `hostUrl` | string | Base URL of the service (e.g., `"https://api.example.com"`) |
| 2 | `name` | string | Human-readable service name |
| 3 | `description` | string | Service description (max 500 chars) |
| 4 | `category` | string | Service category (e.g., `"ai"`, `"data"`, `"compute"`, `"storage"`, `"search"`) |
| 5 | `pricing` | string | JSON-encoded pricing object (see Section 2) |
| 6 | `capabilities` | string | JSON-encoded array of capability strings |
| 7 | `contactUrl` | string | Support/contact URL (optional, empty string if omitted) |
| 8 | `registeredAt` | string | ISO 8601 timestamp of registration |

The token is locked using PushDrop with:
- `protocolID`: `[1, "x402-registry"]`
- `keyID`: `"registration"`
- `counterparty`: `"self"`
- Stored in basket: `"x402-registrations"`

### 2. Pricing Object

The `pricing` field (index 5) is a JSON-encoded object:

```json
{
  "currency": "satoshis",
  "endpoints": [
    {
      "path": "/search",
      "method": "GET",
      "price": 100,
      "description": "Search query",
      "rateLimit": "100/min"
    },
    {
      "path": "/generate",
      "method": "POST",
      "price": 500,
      "description": "Content generation",
      "rateLimit": "10/min"
    }
  ],
  "defaultPrice": 100,
  "freeEndpoints": [
    "/.well-known/x402-info",
    "/health"
  ]
}
```

Fields:

| Field | Required | Description |
|-------|----------|-------------|
| `currency` | yes | Always `"satoshis"` for this version |
| `endpoints` | no | Array of endpoint-specific pricing |
| `endpoints[].path` | yes | URL path pattern |
| `endpoints[].method` | yes | HTTP method |
| `endpoints[].price` | yes | Price in satoshis per request |
| `endpoints[].description` | no | Endpoint description |
| `endpoints[].rateLimit` | no | Rate limit string (e.g., `"100/min"`) |
| `defaultPrice` | no | Default price for unlisted endpoints |
| `freeEndpoints` | no | Array of paths that require no payment |

### 3. Capabilities Array

The `capabilities` field (index 6) is a JSON-encoded array of standardized capability strings:

```json
["search", "generate", "analyze", "translate", "transcribe", "embed"]
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

### 4. Topic Manager: `tm_x402`

The topic manager validates incoming registration transactions.

**Admittance rules:**

1. The output must be a valid PushDrop token.
2. Field 0 must equal `"x402-registry-v1"`.
3. Field 1 (`hostUrl`) must be a valid HTTPS URL.
4. Field 2 (`name`) must be a non-empty string, max 100 characters.
5. Field 3 (`description`) must be max 500 characters.
6. Field 4 (`category`) must be a non-empty string, max 50 characters.
7. Field 5 (`pricing`) must be valid JSON conforming to the pricing schema.
8. Field 6 (`capabilities`) must be a valid JSON array of strings.
9. Field 8 (`registeredAt`) must be a valid ISO 8601 timestamp.
10. The PushDrop signature must be valid (verified by the PushDrop.decode process).

**Spending rules:**

When a registration UTXO is spent, the service is removed from the overlay. This is how operators de-list a service.

### 5. Lookup Service: `ls_x402`

The lookup service indexes admitted registrations and supports the following query types:

**Query by category:**
```json
{
  "service": "ls_x402",
  "query": { "category": "ai" }
}
```

**Query by capability:**
```json
{
  "service": "ls_x402",
  "query": { "capability": "search" }
}
```

**Query by host URL (exact match):**
```json
{
  "service": "ls_x402",
  "query": { "hostUrl": "https://api.example.com" }
}
```

**Query by operator identity key:**
```json
{
  "service": "ls_x402",
  "query": { "identityKey": "02abc...def" }
}
```

**Query all registrations:**
```json
{
  "service": "ls_x402",
  "query": {}
}
```

**Response format:**

The lookup service returns UTXO references. The client decodes PushDrop fields from the returned outputs to reconstruct registration data.

### 6. Registration Lifecycle

**Create registration:**
1. Operator constructs a PushDrop token with the 9 fields.
2. Operator submits the transaction to the overlay via `overlay-express`.
3. The topic manager validates the token and admits the output.
4. The lookup service indexes the registration.

**Update registration:**
1. Operator spends the existing registration UTXO (triggers removal from overlay).
2. Operator creates a new registration token with updated fields.
3. Both transactions can be in the same atomic action.

**Remove registration:**
1. Operator spends the registration UTXO.
2. The lookup service removes the record on `outputSpent`.

### 7. Client Verification

After discovering a service via the overlay, clients should:

1. Verify the PushDrop signature to confirm the registration was created by the claimed identity key.
2. Optionally fetch `/.well-known/x402-info` from the `hostUrl` and compare the identity key.
3. Use mutual authentication when making paid requests to the service, confirming the server holds the same private key.

This creates a chain of trust: the on-chain registration proves the identity key registered the service, and mutual authentication proves the server holds that key.

### 8. Interaction with x402 Payment Flow

The x402 payment flow is unchanged by this overlay. The overlay provides discovery and trust — the payment mechanics remain:

1. Client discovers service via `ls_x402` overlay query.
2. Client sends authenticated request to service endpoint.
3. Service returns `402 Payment Required` with payment instructions in headers.
4. Client constructs payment transaction per the instructions.
5. Client retries the request with payment proof in headers.
6. Service validates payment and returns the response.

The overlay's pricing data allows clients to estimate costs before making requests, but the authoritative price is always the `402` response from the service itself.

## Security Considerations

- **URL ownership is not proven on-chain.** The overlay proves that an identity key registered a URL, not that the identity controls the server at that URL. Mutual authentication at request time is the verification mechanism.
- **Stale registrations.** A service may go offline without spending its registration UTXO. Clients should handle connection failures gracefully.
- **Price manipulation.** On-chain pricing is informational. The server's `402` response is authoritative. Clients should compare the two and flag discrepancies.
- **Spam registrations.** Each registration costs a transaction fee, providing a natural economic barrier. Overlay operators may apply additional admittance criteria.

## Reference Implementation

See `packages/x402-overlay/` for a complete implementation including:
- `X402TopicManager` — validates registration tokens
- `X402LookupService` — indexes and queries registrations
- `X402Storage` — MongoDB persistence
- Integration with `@bsv/overlay-express`
