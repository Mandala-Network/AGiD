# agid-pydantic: Design Spec

**Date:** 2026-04-07
**Location:** `/Users/donot/AGiD/agid-pydantic/`
**Status:** Draft

## Overview

`agid-pydantic` is a Python package that exposes AGiD's blockchain-native agent capabilities as a Pydantic AI toolset. It gives any Python AI agent access to cryptographic identity, encrypted on-chain memory, zero-knowledge proofs, encrypted messaging, certificate management, and wallet operations — by talking HTTP to any BRC-100 wallet server.

The package is designed for enterprise consumers (e.g., SentinelOne) who build AI agents with Pydantic AI and want AGiD's trust infrastructure without learning TypeScript, BSV internals, or running AGiD directly.

## Design Principles

1. **The wallet does all cryptography.** Python never touches private keys. Every signing, encryption, and key derivation operation is an HTTP call to the BRC-100 wallet server.
2. **BRC-100 is the only interface.** The package works with any BRC-100 wallet — `bsv-wallet-cli` (single key, dev), `mpc-backend` (threshold MPC, production), or anything else.
3. **Tools are the API.** The developer registers an `AGiDToolset` with their Pydantic AI agent. The LLM decides when to call tools. The developer never calls BRC-100 endpoints directly.
4. **Primitives, not opinions.** The package provides building blocks (store memory, encrypt, sign, prove). Higher-level patterns (wiki knowledge bases, investigation workflows, SOC playbooks) are the consumer's domain.

## Dependencies

| Package | Purpose |
|---------|---------|
| `pydantic-ai` | Agent framework — Toolset interface |
| `pydantic` | Request/response models for all BRC-100 types |
| `httpx` | Async HTTP client for BRC-100 wallet and MessageBox |
| `bsv-sdk` (1.0.11) | Script building (PushDrop), hashing (SHA-256, UHRP) |
| `base58` | Base58Check encoding for UHRP URL computation |

No Node.js. No BSV wallet-toolbox. No private keys in process.

## Package Structure

```
agid-pydantic/
├── pyproject.toml
├── src/
│   └── agid_pydantic/
│       ├── __init__.py              # exports: AGiDToolset, BRC100Client
│       ├── toolset.py               # AGiDToolset (Pydantic AI Toolset interface)
│       ├── client.py                # BRC100Client (async HTTP to wallet server)
│       ├── messagebox.py            # MessageBoxClient (encrypted messaging)
│       ├── types.py                 # Pydantic models for BRC-100 request/response
│       ├── pushdrop.py              # PushDrop script building (using bsv-sdk Script)
│       ├── uhrp.py                  # UHRP URL computation (SHA-256 + base58check)
│       └── tools/
│           ├── __init__.py          # TOOL_REGISTRY, TOOL_HANDLERS
│           ├── identity.py          # 5 tools
│           ├── certificates.py      # 8 tools
│           ├── memory.py            # 2 tools
│           ├── crypto.py            # 5 tools
│           ├── zkproof.py           # 5 tools
│           ├── messaging.py         # 5 tools
│           ├── wallet.py            # 7 tools
│           └── audit.py             # 2 tools
└── tests/
    ├── test_client.py
    ├── test_toolset.py
    ├── test_pushdrop.py
    ├── test_tools/
    │   ├── test_identity.py
    │   ├── test_memory.py
    │   ├── test_crypto.py
    │   ├── test_zkproof.py
    │   ├── test_messaging.py
    │   ├── test_certificates.py
    │   ├── test_wallet.py
    │   └── test_audit.py
    └── conftest.py              # shared fixtures, mock BRC-100 server
```

## Usage

### Basic — all 39 tools

```python
from agid_pydantic import AGiDToolset
from pydantic_ai import Agent

agid = AGiDToolset(
    wallet_url="http://localhost:3321",
    messagebox_url="https://messagebox.babbage.systems",
)

agent = Agent('anthropic:claude-sonnet-4-6', toolsets=[agid])
result = await agent.run("Store this threat analysis as an encrypted memory tagged 'apt28'")
```

### Scoped — specific groups only

```python
agid = AGiDToolset(
    wallet_url="http://localhost:3321",
    messagebox_url="https://messagebox.babbage.systems",
    groups=["memory", "crypto", "identity"],
)
```

### With approval gates

```python
# Use Pydantic AI's built-in .approval_required() composition
agid = AGiDToolset(
    wallet_url="http://localhost:3321",
    messagebox_url="https://messagebox.babbage.systems",
)

dangerous = {"agid_send_payment", "agid_create_action", "agid_cert_revoke"}
gated_agid = agid.approval_required(
    lambda ctx, tool_def, tool_args: tool_def.name in dangerous
)

agent = Agent('anthropic:claude-sonnet-4-6', toolsets=[gated_agid])
```

### Multi-agent — different agents, different capabilities

```python
# Full investigation agent with approval on spending
investigator_agid = AGiDToolset(
    wallet_url="http://localhost:3321",
    messagebox_url="https://mb.internal",
).approval_required(
    lambda ctx, td, ta: td.name == "agid_send_payment"
)

# Read-only memory agent — scoped to memory + crypto tools only
librarian_agid = AGiDToolset(
    wallet_url="http://localhost:3321",
    messagebox_url="https://mb.internal",
    groups=["memory", "crypto"],
)

investigator = Agent('anthropic:claude-sonnet-4-6', toolsets=[investigator_agid])
librarian = Agent('anthropic:claude-sonnet-4-6', toolsets=[librarian_agid])
```

### Works with any BRC-100 wallet

```python
# Dev: single-key wallet (bsv-wallet-cli)
agid = AGiDToolset(wallet_url="http://localhost:3321")

# Production: MPC threshold wallet (mpc-backend)
agid = AGiDToolset(wallet_url="http://mpc-backend:3321")

# Same code. Same tools. Different security model.
```

## Component Design

### AGiDToolset

Main entry point. Subclasses Pydantic AI's `AbstractToolset`.

```python
from pydantic_ai.toolsets import AbstractToolset, ToolsetTool
from pydantic_ai.tools import ToolDefinition
from pydantic_ai.agent import RunContext
from typing import Any

class AGiDToolset(AbstractToolset[Any]):
    id = "agid"
    label = "AGiD"
    tool_name_conflict_hint = "Prefix with 'agid_' or filter by group"

    ALL_GROUPS = [
        "identity", "certificates", "memory", "crypto",
        "zkproof", "messaging", "wallet", "audit",
    ]

    def __init__(
        self,
        wallet_url: str = "http://localhost:3321",
        messagebox_url: str = "https://messagebox.babbage.systems",
        auth_token: str | None = None,
        groups: list[str] | None = None,
    ):
        self._wallet_url = wallet_url
        self._messagebox_url = messagebox_url
        self._auth_token = auth_token
        self._groups = groups or self.ALL_GROUPS
        self._client: BRC100Client | None = None
        self._messagebox: MessageBoxClient | None = None

    # --- Required: AbstractToolset abstract methods ---

    async def get_tools(
        self, ctx: RunContext[Any]
    ) -> dict[str, ToolsetTool[Any]]:
        """Return available tools filtered by groups."""
        tools: dict[str, ToolsetTool[Any]] = {}
        for group in self._groups:
            for name, (tool_def, handler) in TOOL_REGISTRY[group].items():
                tools[name] = ToolsetTool(definition=tool_def)
        return tools

    async def call_tool(
        self,
        name: str,
        tool_args: dict[str, Any],
        ctx: RunContext[Any],
        tool: ToolsetTool[Any],
    ) -> Any:
        """Dispatch tool call to the correct handler."""
        handler = TOOL_HANDLERS[name]
        return await handler(tool_args, self._client, self._messagebox)

    # --- Optional: Lifecycle ---

    async def __aenter__(self) -> "AGiDToolset":
        self._client = BRC100Client(self._wallet_url, self._auth_token)
        await self._client.connect()
        self._messagebox = MessageBoxClient(self._messagebox_url, self._client)
        await self._messagebox.connect()
        return self

    async def __aexit__(self, *exc: Any) -> None:
        if self._messagebox:
            await self._messagebox.close()
        if self._client:
            await self._client.close()

    async def for_run(self, ctx: RunContext[Any]) -> "AGiDToolset":
        """Return self — HTTP clients are stateless and safe to share across runs."""
        return self

    # --- Optional: Instructions ---

    async def get_instructions(self, ctx: RunContext[Any]) -> str | None:
        """Inject AGiD tool usage guidance into the system prompt."""
        return (
            "You have access to AGiD blockchain-native tools for identity, "
            "encrypted memory, zero-knowledge proofs, certificates, messaging, "
            "and wallet operations. All cryptographic operations are performed "
            "by the wallet server — never attempt to handle keys or signing directly."
        )
```

**Responsibilities:**
- Creates and owns `BRC100Client` and `MessageBoxClient` instances
- Filters tools by `groups` parameter via `get_tools()`
- Dispatches tool calls to the correct handler via `TOOL_HANDLERS` dict
- Manages async lifecycle (httpx client open/close)
- Injects usage instructions into the agent's system prompt

**Approval gating** is handled via Pydantic AI's built-in composition, not a custom parameter:

```python
# Apply approval gates using the standard .approval_required() chain method
dangerous_tools = {"agid_send_payment", "agid_create_action", "agid_cert_revoke"}

agid = AGiDToolset(wallet_url="http://localhost:3321")
gated_agid = agid.approval_required(
    lambda ctx, tool_def, tool_args: tool_def.name in dangerous_tools
)

agent = Agent('anthropic:claude-sonnet-4-6', toolsets=[gated_agid])
```

**`TOOL_REGISTRY`**: dict mapping group name to dict of `{tool_name: (ToolDefinition, handler_fn)}`. Built at import time from each `tools/*.py` module.

**`TOOL_HANDLERS`**: flat dict mapping tool name to async handler function. Each handler signature: `async def handler(tool_args: dict[str, Any], client: BRC100Client, messagebox: MessageBoxClient) -> Any`.

### BRC100Client

Async HTTP client for any BRC-100 wallet server. 1:1 mapping to the 28 BRC-100 endpoints.

```python
class BRC100Client:
    def __init__(self, url: str, auth_token: str | None = None): ...

    # Info
    async def get_version(self) -> GetVersionResult: ...
    async def get_network(self) -> GetNetworkResult: ...
    async def get_height(self) -> GetHeightResult: ...
    async def get_header_for_height(self, args: GetHeaderForHeightArgs) -> GetHeaderResult: ...
    async def is_authenticated(self) -> AuthenticatedResult: ...
    async def wait_for_authentication(self) -> AuthenticatedResult: ...

    # Crypto
    async def get_public_key(self, args: GetPublicKeyArgs) -> GetPublicKeyResult: ...
    async def create_signature(self, args: CreateSignatureArgs) -> CreateSignatureResult: ...
    async def verify_signature(self, args: VerifySignatureArgs) -> VerifySignatureResult: ...
    async def encrypt(self, args: EncryptArgs) -> EncryptResult: ...
    async def decrypt(self, args: DecryptArgs) -> DecryptResult: ...
    async def create_hmac(self, args: CreateHmacArgs) -> CreateHmacResult: ...
    async def verify_hmac(self, args: VerifyHmacArgs) -> VerifyHmacResult: ...

    # Actions
    async def create_action(self, args: CreateActionArgs) -> CreateActionResult: ...
    async def sign_action(self, args: SignActionArgs) -> SignActionResult: ...
    async def abort_action(self, args: AbortActionArgs) -> AbortActionResult: ...
    async def list_actions(self, args: ListActionsArgs) -> ListActionsResult: ...
    async def internalize_action(self, args: InternalizeActionArgs) -> InternalizeActionResult: ...

    # Outputs
    async def list_outputs(self, args: ListOutputsArgs) -> ListOutputsResult: ...
    async def relinquish_output(self, args: RelinquishOutputArgs) -> RelinquishOutputResult: ...

    # Certificates
    async def acquire_certificate(self, args: AcquireCertificateArgs) -> AcquireCertificateResult: ...
    async def list_certificates(self, args: ListCertificatesArgs) -> ListCertificatesResult: ...
    async def prove_certificate(self, args: ProveCertificateArgs) -> ProveCertificateResult: ...
    async def relinquish_certificate(self, args: RelinquishCertificateArgs) -> RelinquishCertificateResult: ...

    # Discovery
    async def discover_by_identity_key(self, args: DiscoverByIdentityKeyArgs) -> DiscoverCertificatesResult: ...
    async def discover_by_attributes(self, args: DiscoverByAttributesArgs) -> DiscoverCertificatesResult: ...
    async def reveal_counterparty_key_linkage(self, args: RevealCounterpartyKeyLinkageArgs) -> RevealCounterpartyKeyLinkageResult: ...
    async def reveal_specific_key_linkage(self, args: RevealSpecificKeyLinkageArgs) -> RevealSpecificKeyLinkageResult: ...

    # Lifecycle
    async def connect(self) -> None: ...
    async def close(self) -> None: ...
```

**Internal behavior:**
- All methods POST JSON to `{base_url}/{endpoint_name}`
- Snake_case args are converted to camelCase for the wire format
- CamelCase responses are converted to snake_case Pydantic models
- Auth token (if provided) sent as `Authorization: Bearer {token}` header
- Errors from the wallet server are raised as `BRC100Error(status_code, message)`
- `httpx.AsyncClient` with connection pooling, configurable timeout (default 30s)

### MessageBoxClient

Handles encrypted messaging. Uses `BRC100Client` for all cryptographic operations (encrypt, decrypt, sign for auth).

```python
class MessageBoxClient:
    def __init__(self, url: str, wallet: BRC100Client): ...

    async def get_identity(self) -> str: ...
    async def send_message(self, recipient: str, body: str, message_box: str = "general") -> SendMessageResult: ...
    async def list_messages(self, message_box: str = "general") -> list[Message]: ...
    async def acknowledge(self, message_ids: list[str]) -> None: ...
    async def list_payments(self) -> list[Payment]: ...
    async def accept_payment(self, message_id: str, sender: str) -> AcceptPaymentResult: ...

    async def connect(self) -> None: ...
    async def close(self) -> None: ...
```

**Internal behavior:**
- Caches the agent's identity key (fetched once from wallet via `get_public_key(identity_key=True)`)
- Outgoing messages encrypted with BRC-2 ECDH via wallet's `encrypt` endpoint
- Incoming messages auto-decrypted via wallet's `decrypt` endpoint
- BRC-31 request authentication: each HTTP request signed using wallet's `create_signature`
- Messages sent/received as hex-encoded ciphertext

### Pydantic Types (types.py)

All BRC-100 request/response pairs as Pydantic `BaseModel` classes. Key types:

```python
# Crypto args/results
class GetPublicKeyArgs(BaseModel):
    identity_key: bool = False
    protocol_id: tuple[int, str] | None = None
    key_id: str | None = None
    counterparty: str | None = None

class GetPublicKeyResult(BaseModel):
    public_key: str

class CreateSignatureArgs(BaseModel):
    data: list[int]
    protocol_id: tuple[int, str]
    key_id: str
    counterparty: str | None = None

class CreateSignatureResult(BaseModel):
    signature: list[int]

class EncryptArgs(BaseModel):
    data: list[int]
    protocol_id: tuple[int, str]
    key_id: str
    counterparty: str | None = None

class EncryptResult(BaseModel):
    ciphertext: list[int]

class DecryptArgs(BaseModel):
    ciphertext: list[int]
    protocol_id: tuple[int, str]
    key_id: str
    counterparty: str | None = None

class DecryptResult(BaseModel):
    plaintext: list[int]

# Action args/results
class ActionOutput(BaseModel):
    locking_script: str          # hex
    satoshis: int
    description: str | None = None
    basket: str | None = None
    tags: list[str] | None = None
    custom_instructions: str | None = None

class CreateActionArgs(BaseModel):
    description: str
    outputs: list[ActionOutput] | None = None
    labels: list[str] | None = None

class CreateActionResult(BaseModel):
    txid: str
    raw_tx: str | None = None

# Output listing
class WalletOutput(BaseModel):
    outpoint: str
    satoshis: int
    locking_script: str | None = None
    tags: list[str] | None = None
    labels: list[str] | None = None
    custom_instructions: str | None = None

class ListOutputsArgs(BaseModel):
    basket: str = "default"
    tags: list[str] | None = None
    include: str | None = None
    limit: int = 25
    offset: int = 0

class ListOutputsResult(BaseModel):
    outputs: list[WalletOutput]
    total_count: int | None = None

# Certificate types
class Certificate(BaseModel):
    serial_number: str
    certifier: str
    subject: str
    type: str
    fields: dict[str, str]
    revocation_outpoint: str | None = None

class ListCertificatesArgs(BaseModel):
    certifier: str | None = None
    type: str = "agidentity.identity"

class ListCertificatesResult(BaseModel):
    certificates: list[Certificate]

# MessageBox types
class Message(BaseModel):
    message_id: str
    sender: str
    body: str
    message_box: str | None = None

class Payment(BaseModel):
    message_id: str
    sender: str
    amount: int

# Error
class BRC100Error(Exception):
    def __init__(self, status_code: int, message: str): ...
```

All models use `model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)` to handle snake_case ↔ camelCase conversion automatically.

### PushDrop Script Building (pushdrop.py)

Builds BRC-48 PushDrop locking scripts using `bsv-sdk`'s `Script` class. Used by memory tools and token tools.

```python
from bsv.script.script import Script
from bsv.utils import encode_pushdata

def build_pushdrop_locking_script(fields: list[bytes]) -> Script:
    """
    Build a PushDrop data-carrier script: <field1> <field2> ... OP_DROP ... OP_2DROP OP_TRUE

    This matches the AGiD TypeScript PushDrop format. The fields are pushed
    onto the stack, then dropped. OP_TRUE makes the script always spendable.
    The wallet's createAction handles signing and UTXO management.
    """
    script_bytes = b""
    for field in fields:
        script_bytes += encode_pushdata(field)
    # Drop all fields: use OP_2DROP for pairs, OP_DROP for remainder
    n = len(fields)
    script_bytes += bytes([0x6d]) * (n // 2)  # OP_2DROP
    if n % 2 == 1:
        script_bytes += bytes([0x75])          # OP_DROP
    script_bytes += bytes([0x51])              # OP_TRUE (always spendable)
    return Script(script_bytes)

def decode_pushdrop_fields(script: Script) -> list[bytes]:
    """Decode PushDrop script back to field byte arrays."""
    ...
```

Note: The exact PushDrop script format will be verified against the AGiD TypeScript `PushDrop.lock()` output during implementation to ensure on-chain compatibility.

Used by tools to construct token outputs before passing to `BRC100Client.create_action()`.

### UHRP Computation (uhrp.py)

Content-addressed URL computation for on-chain memory references.

```python
from bsv import sha256
import hashlib, base58  # base58 is a lightweight dependency

UHRP_PREFIX = b'\xce\x00'

def compute_uhrp(data: bytes) -> str:
    """Compute UHRP URL: uhrp://{base58check(sha256(data))}"""
    content_hash = sha256(data)
    payload = UHRP_PREFIX + content_hash
    checksum = hashlib.sha256(hashlib.sha256(payload).digest()).digest()[:4]
    return "uhrp://" + base58.b58encode(payload + checksum).decode()

def extract_hash_from_uhrp(url: str) -> bytes:
    """Extract the SHA-256 hash from a UHRP URL."""
    ...
```

Note: `base58` is a lightweight additional dependency (~2KB, pure Python).

## Tool Catalog

### Identity Group (5 tools)

| Tool | Description | Wallet Required | BRC-100 Calls |
|------|-------------|-----------------|---------------|
| `agid_identity` | Get agent's public key, network, and balance | Yes | `getPublicKey`, `getNetwork`, `listOutputs` |
| `agid_balance` | Check wallet balance in satoshis | Yes | `listOutputs` |
| `agid_get_public_key` | Derive a protocol-specific public key (BRC-42) | Yes | `getPublicKey` |
| `agid_get_height` | Get current blockchain block height | Yes | `getHeight` |
| `agid_lookup_identity` | Look up identity on BSV overlay by name/email | Yes | `discoverByAttributes` |

### Certificates Group (8 tools)

| Tool | Description | Wallet Required | BRC-100 Calls |
|------|-------------|-----------------|---------------|
| `agid_cert_issue` | Issue BRC-52 identity certificate to another key | Yes | `acquireCertificate`, `getPublicKey` |
| `agid_cert_receive` | Receive and store certificates issued to you | Yes | `acquireCertificate` |
| `agid_cert_list` | List certificates in wallet | Yes | `listCertificates` |
| `agid_cert_verify` | Verify a serialized certificate | Yes | `listCertificates`, `verifySignature` |
| `agid_cert_revoke` | Revoke a previously issued certificate | Yes | `createAction` |
| `agid_cert_reveal` | Reveal selected fields to overlay network | Yes | `proveCertificate` |
| `agid_cert_check_revocation` | Check if certificate is revoked on-chain | Yes | `listOutputs` |
| `agid_cert_send` | Send certificate to another identity via MessageBox | Yes | `proveCertificate` + MessageBox |

### Memory Group (2 tools)

| Tool | Description | Wallet Required | BRC-100 Calls |
|------|-------------|-----------------|---------------|
| `agid_store_memory` | Encrypt content, compute UHRP, create PushDrop token in `agid-memory` basket | Yes | `encrypt`, `createAction` |
| `agid_recall_memories` | List memory tokens, decode PushDrop fields, decrypt content | Yes | `listOutputs`, `decrypt` |

### Crypto Group (5 tools)

| Tool | Description | Wallet Required | BRC-100 Calls |
|------|-------------|-----------------|---------------|
| `agid_sign` | Sign a message with agent wallet | Yes | `createSignature` |
| `agid_encrypt` | Encrypt data with BRC-42 derived key | Yes | `encrypt` |
| `agid_decrypt` | Decrypt previously encrypted data | Yes | `decrypt` |
| `agid_wallet_client_request` | Pass-through to an external user's wallet client | No | External HTTP |
| `agid_request_user_signature` | Request user to sign data with their wallet | No | External HTTP |

### ZK Proofs Group (5 tools)

| Tool | Description | Wallet Required | BRC-100 Calls |
|------|-------------|-----------------|---------------|
| `agid_zkproof_privilege` | Generate BRC-94 Schnorr proof of privileged communication | Yes | `getPublicKey`, `createSignature`, `createAction` (optional anchor) |
| `agid_zkproof_verify` | Verify a BRC-94 Schnorr proof | No | `verifySignature` |
| `agid_zkproof_selective_reveal` | Reveal decryption key for one session without exposing others | Yes | `getPublicKey`, `createSignature` |
| `agid_zkproof_commitment` | Create cryptographic commitment to content | Yes | `createSignature`, `createAction` (optional anchor) |
| `agid_zkproof_verify_commitment` | Verify content matches a commitment | No | `verifySignature` |

### Messaging Group (5 tools)

| Tool | Description | Wallet Required | BRC-100 Calls |
|------|-------------|-----------------|---------------|
| `agid_message_send` | Send E2E encrypted message via MessageBox | Yes | `encrypt`, `getPublicKey` + MessageBox |
| `agid_message_list` | List and auto-decrypt messages | Yes | `decrypt` + MessageBox |
| `agid_message_ack` | Acknowledge (delete) processed messages | Yes | MessageBox |
| `agid_list_payments` | List pending incoming payments | Yes | MessageBox |
| `agid_accept_payment` | Accept incoming payment by messageId | Yes | `internalizeAction` + MessageBox |

### Wallet/Tokens Group (7 tools)

| Tool | Description | Wallet Required | BRC-100 Calls |
|------|-------------|-----------------|---------------|
| `agid_create_action` | Create a BSV transaction | Yes | `createAction` |
| `agid_internalize_action` | Accept incoming transaction (BEEF) | Yes | `internalizeAction` |
| `agid_list_outputs` | List wallet UTXOs by basket/tags | Yes | `listOutputs` |
| `agid_send_payment` | Send BSV payment to another identity | Yes | `createAction` + MessageBox |
| `agid_token_create` | Create PushDrop token with arbitrary fields | Yes | `createAction` |
| `agid_token_list` | List PushDrop tokens from a basket | Yes | `listOutputs` |
| `agid_token_redeem` | Spend a PushDrop token to reclaim satoshis | Yes | `createAction` |

### Audit Group (2 tools)

| Tool | Description | Wallet Required | BRC-100 Calls |
|------|-------------|-----------------|---------------|
| `agid_verify_workspace` | Verify workspace integrity against on-chain anchor | Yes | `listOutputs`, `verifySignature` |
| `agid_verify_session` | Verify session anchor chain Merkle root | Yes | `listOutputs`, `verifySignature` |

## Tool Implementation Pattern

Every tool follows the same structure:

```python
# tools/memory.py

from agid_pydantic.types import EncryptArgs, CreateActionArgs, ActionOutput
from agid_pydantic.pushdrop import build_pushdrop_locking_script
from agid_pydantic.uhrp import compute_uhrp

# 1. Define the tool's arg model
class StoreMemoryArgs(BaseModel):
    content: str
    tags: list[str] | None = None

# 2. Define the tool metadata
STORE_MEMORY_DEF = ToolDefinition(
    name="agid_store_memory",
    description="Store a memory on the blockchain. Encrypts content with your wallet key, "
                "computes a content-addressed UHRP URL, and creates a PushDrop token in the "
                "agid-memory basket. Use tags to categorize memories for later retrieval.",
    parameters_json_schema=StoreMemoryArgs.model_json_schema(),
)

# 3. Implement the handler
async def handle_store_memory(
    tool_args: dict[str, Any],
    client: BRC100Client,
    messagebox: MessageBoxClient,
) -> Any:
    parsed = StoreMemoryArgs(**tool_args)

    # Encrypt content via wallet
    encrypted = await client.encrypt(EncryptArgs(
        data=list(parsed.content.encode("utf-8")),
        protocol_id=(2, "agid memory"),
        key_id="1",
    ))

    # Compute content-addressed URL
    ciphertext_bytes = bytes(encrypted.ciphertext)
    uhrp_url = compute_uhrp(ciphertext_bytes)

    # Build PushDrop token
    tags_str = ",".join(parsed.tags) if parsed.tags else ""
    script = build_pushdrop_locking_script([
        uhrp_url.encode(),
        tags_str.encode(),
    ])

    # Create on-chain token
    result = await client.create_action(CreateActionArgs(
        description=f"Memory: {parsed.tags[0] if parsed.tags else 'untitled'}",
        outputs=[ActionOutput(
            locking_script=script.hex(),
            satoshis=1,
            basket="agid-memory",
            tags=["agid memory", *(parsed.tags or [])],
        )],
    ))

    return f"Stored memory: txid {result.txid}, uhrp: {uhrp_url}, tags: {tags_str}"
```

**Pattern for all 39 tools:**
1. Pydantic `BaseModel` for arg validation
2. `ToolDefinition` with name, description, `parameters_json_schema`
3. Async handler `(tool_args, client, messagebox) -> Any` that calls `BRC100Client` / `MessageBoxClient`
4. Returns any serializable value (Pydantic AI handles serialization for the LLM)

## Error Handling

- `BRC100Error` raised for wallet server errors (HTTP 4xx/5xx). Contains status code and message.
- `MessageBoxError` raised for MessageBox communication failures.
- Tool handlers catch these and return error strings to the LLM (not exceptions), so the agent can reason about failures and retry or adapt.
- `httpx.TimeoutException` wrapped as a descriptive error string.
- Connection failures on startup raise immediately (fail fast).

## Testing Strategy

- **Unit tests per tool module**: Mock `BRC100Client` and `MessageBoxClient`, verify each handler produces correct BRC-100 calls and returns expected strings.
- **Unit tests for BRC100Client**: Mock `httpx` responses, verify JSON serialization, camelCase conversion, error handling.
- **Unit tests for PushDrop/UHRP**: Known test vectors from the TypeScript AGiD implementation.
- **Integration test fixture**: `conftest.py` provides a mock BRC-100 server (httpx mock transport) that returns canned responses for all 28 endpoints.
- **No live wallet tests in CI.** Integration tests against real `bsv-wallet-cli` or `mpc-backend` are manual/local only.

## What This Package Does NOT Do

- **No wiki/knowledge-base logic.** The consumer builds their own Karpathy-style wiki on top of `store_memory` / `recall_memories`.
- **No semantic search.** No Shad, no embeddings, no RAG. The LLM reads index files it maintains.
- **No MPC coordination.** The wallet server handles threshold signing. This package is unaware of MPC.
- **No prompt optimization.** No GEPA integration.
- **No deployment/runtime/filesystem/browser tools.** Infrastructure is AGiD-internal.
- **No private keys in process.** All cryptography delegated to the BRC-100 wallet server.
