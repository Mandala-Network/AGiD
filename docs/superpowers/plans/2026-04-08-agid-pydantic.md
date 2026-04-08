# agid-pydantic Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Python package that exposes 39 AGiD blockchain tools as a Pydantic AI `AbstractToolset`, talking HTTP to any BRC-100 wallet server.

**Architecture:** `AGiDToolset` subclasses `AbstractToolset[Any]`, owns a `BRC100Client` (async httpx to BRC-100 wallet) and `MessageBoxClient` (encrypted messaging). Tools are grouped into 8 modules, registered at import time, and filtered by the `groups` constructor parameter. PushDrop scripts and UHRP URLs are computed client-side using `bsv-sdk`.

**Tech Stack:** Python 3.11+, pydantic-ai, pydantic, httpx, bsv-sdk 1.0.11, base58, pytest, pytest-asyncio

**Spec:** `docs/superpowers/specs/2026-04-07-agid-pydantic-design.md`

---

## File Map

```
/Users/donot/AGiD/agid-pydantic/
├── pyproject.toml                          # Package metadata, deps, build config
├── src/
│   └── agid_pydantic/
│       ├── __init__.py                     # Public exports: AGiDToolset, BRC100Client
│       ├── types.py                        # All Pydantic models for BRC-100 wire types
│       ├── client.py                       # BRC100Client — async HTTP to wallet server
│       ├── pushdrop.py                     # PushDrop script build/decode
│       ├── uhrp.py                         # UHRP URL computation
│       ├── messagebox.py                   # MessageBoxClient — encrypted messaging
│       ├── toolset.py                      # AGiDToolset — AbstractToolset subclass
│       └── tools/
│           ├── __init__.py                 # TOOL_REGISTRY, TOOL_HANDLERS, registration
│           ├── identity.py                 # 5 tools
│           ├── crypto.py                   # 5 tools
│           ├── memory.py                   # 2 tools
│           ├── wallet.py                   # 7 tools
│           ├── certificates.py             # 8 tools
│           ├── zkproof.py                  # 5 tools
│           ├── messaging.py                # 5 tools
│           └── audit.py                    # 2 tools
└── tests/
    ├── conftest.py                         # Shared fixtures, mock BRC-100 transport
    ├── test_types.py                       # Type serialization round-trips
    ├── test_client.py                      # BRC100Client HTTP behavior
    ├── test_pushdrop.py                    # PushDrop script build/decode
    ├── test_uhrp.py                        # UHRP computation
    ├── test_messagebox.py                  # MessageBoxClient behavior
    ├── test_toolset.py                     # AGiDToolset integration
    └── test_tools/
        ├── test_identity.py
        ├── test_crypto.py
        ├── test_memory.py
        ├── test_wallet.py
        ├── test_certificates.py
        ├── test_zkproof.py
        ├── test_messaging.py
        └── test_audit.py
```

---

### Task 1: Project Scaffolding

**Files:**
- Create: `agid-pydantic/pyproject.toml`
- Create: `agid-pydantic/src/agid_pydantic/__init__.py`
- Create: `agid-pydantic/src/agid_pydantic/tools/__init__.py`
- Create: `agid-pydantic/tests/conftest.py`

- [ ] **Step 1: Create project directory**

```bash
mkdir -p /Users/donot/AGiD/agid-pydantic/src/agid_pydantic/tools
mkdir -p /Users/donot/AGiD/agid-pydantic/tests/test_tools
```

- [ ] **Step 2: Write pyproject.toml**

Create `/Users/donot/AGiD/agid-pydantic/pyproject.toml`:

```toml
[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[project]
name = "agid-pydantic"
version = "0.1.0"
description = "AGiD blockchain-native agent toolset for Pydantic AI"
requires-python = ">=3.11"
dependencies = [
    "pydantic-ai>=0.1.0",
    "pydantic>=2.0",
    "httpx>=0.27",
    "bsv-sdk>=1.0.11",
    "base58>=2.1",
]

[project.optional-dependencies]
dev = [
    "pytest>=8.0",
    "pytest-asyncio>=0.24",
    "respx>=0.22",
]

[tool.hatch.build.targets.wheel]
packages = ["src/agid_pydantic"]

[tool.pytest.ini_options]
asyncio_mode = "auto"
testpaths = ["tests"]
```

- [ ] **Step 3: Write __init__.py stubs**

Create `/Users/donot/AGiD/agid-pydantic/src/agid_pydantic/__init__.py`:

```python
"""AGiD blockchain-native agent toolset for Pydantic AI."""

from agid_pydantic.toolset import AGiDToolset
from agid_pydantic.client import BRC100Client

__all__ = ["AGiDToolset", "BRC100Client"]
```

Create `/Users/donot/AGiD/agid-pydantic/src/agid_pydantic/tools/__init__.py`:

```python
"""AGiD tool registry — maps group names to tool definitions and handlers."""

from typing import Any, Callable, Awaitable
from pydantic_ai.tools import ToolDefinition

# Type alias for tool handlers
ToolHandler = Callable[
    [dict[str, Any], Any, Any],  # (tool_args, client, messagebox)
    Awaitable[Any],
]

# group_name -> {tool_name: (ToolDefinition, handler)}
TOOL_REGISTRY: dict[str, dict[str, tuple[ToolDefinition, ToolHandler]]] = {}

# tool_name -> handler (flat lookup for call_tool dispatch)
TOOL_HANDLERS: dict[str, ToolHandler] = {}


def register_group(group: str, tools: dict[str, tuple[ToolDefinition, ToolHandler]]) -> None:
    """Register a group of tools. Called at import time by each tools/*.py module."""
    TOOL_REGISTRY[group] = tools
    TOOL_HANDLERS.update({name: handler for name, (_def, handler) in tools.items()})
```

- [ ] **Step 4: Write conftest.py with mock BRC-100 transport**

Create `/Users/donot/AGiD/agid-pydantic/tests/conftest.py`:

```python
"""Shared test fixtures — mock BRC-100 wallet server."""

import json
import pytest
import httpx
import respx
from agid_pydantic.client import BRC100Client


WALLET_URL = "http://test-wallet:3321"


@pytest.fixture
def mock_wallet():
    """respx mock router for BRC-100 endpoints."""
    with respx.mock(base_url=WALLET_URL) as router:
        # Default: all POST endpoints return empty JSON
        router.post("/getPublicKey").respond(json={"publicKey": "02" + "ab" * 32})
        router.post("/getNetwork").respond(json={"network": "testnet"})
        router.post("/getHeight").respond(json={"height": 850000})
        router.post("/isAuthenticated").respond(json={"authenticated": True})
        router.post("/getVersion").respond(json={"version": "1.0.0"})
        router.post("/createSignature").respond(json={"signature": [48, 69] + [0] * 67})
        router.post("/verifySignature").respond(json={"valid": True})
        router.post("/encrypt").respond(json={"ciphertext": [1, 2, 3, 4, 5]})
        router.post("/decrypt").respond(json={"plaintext": list(b"hello world")})
        router.post("/createHmac").respond(json={"hmac": [0] * 32})
        router.post("/verifyHmac").respond(json={"valid": True})
        router.post("/createAction").respond(json={"txid": "ab" * 32, "rawTx": None})
        router.post("/signAction").respond(json={"txid": "ab" * 32})
        router.post("/abortAction").respond(json={"aborted": True})
        router.post("/listActions").respond(json={"actions": [], "totalActions": 0})
        router.post("/internalizeAction").respond(json={"accepted": True})
        router.post("/listOutputs").respond(json={"outputs": [], "totalOutputs": 0})
        router.post("/relinquishOutput").respond(json={"relinquished": True})
        router.post("/acquireCertificate").respond(json={"certificate": {}})
        router.post("/listCertificates").respond(json={"certificates": []})
        router.post("/proveCertificate").respond(json={"keyForVerifier": ""})
        router.post("/relinquishCertificate").respond(json={"relinquished": True})
        router.post("/discoverByIdentityKey").respond(json={"certificates": []})
        router.post("/discoverByAttributes").respond(json={"certificates": []})
        router.post("/revealCounterpartyKeyLinkage").respond(json={})
        router.post("/revealSpecificKeyLinkage").respond(json={})
        router.post("/getHeaderForHeight").respond(json={"header": [0] * 80})
        router.post("/waitForAuthentication").respond(json={"authenticated": True})
        yield router


@pytest.fixture
async def client(mock_wallet):
    """BRC100Client connected to mock wallet."""
    c = BRC100Client(WALLET_URL)
    await c.connect()
    yield c
    await c.close()
```

- [ ] **Step 5: Install dev dependencies and verify pytest runs**

```bash
cd /Users/donot/AGiD/agid-pydantic
pip install -e ".[dev]"
pytest --co  # collect tests (should find 0, no test files yet)
```

Expected: `no tests ran` (or similar — no test files yet, but pytest should run without errors).

- [ ] **Step 6: Initialize git and commit**

```bash
cd /Users/donot/AGiD/agid-pydantic
git init
git add pyproject.toml src/ tests/conftest.py
git commit -m "feat: scaffold agid-pydantic package with deps and test fixtures"
```

---

### Task 2: Pydantic Types (types.py)

**Files:**
- Create: `src/agid_pydantic/types.py`
- Create: `tests/test_types.py`

- [ ] **Step 1: Write test for camelCase serialization round-trip**

Create `/Users/donot/AGiD/agid-pydantic/tests/test_types.py`:

```python
"""Test BRC-100 Pydantic model serialization."""

from agid_pydantic.types import (
    GetPublicKeyArgs,
    GetPublicKeyResult,
    CreateSignatureArgs,
    EncryptArgs,
    EncryptResult,
    CreateActionArgs,
    ActionOutput,
    ListOutputsArgs,
    ListOutputsResult,
    WalletOutput,
    BRC100Error,
)


def test_get_public_key_args_to_camel():
    args = GetPublicKeyArgs(identity_key=True)
    data = args.model_dump(by_alias=True, exclude_none=True)
    assert data == {"identityKey": True}


def test_get_public_key_args_with_protocol():
    args = GetPublicKeyArgs(
        protocol_id=(2, "agid memory"),
        key_id="1",
        counterparty="02" + "ab" * 32,
    )
    data = args.model_dump(by_alias=True, exclude_none=True)
    assert data["protocolID"] == [2, "agid memory"]
    assert data["keyID"] == "1"
    assert data["counterparty"] == "02" + "ab" * 32


def test_get_public_key_result_from_camel():
    result = GetPublicKeyResult.model_validate({"publicKey": "02" + "ab" * 32})
    assert result.public_key == "02" + "ab" * 32


def test_encrypt_args_serialization():
    args = EncryptArgs(
        data=[72, 101, 108, 108, 111],
        protocol_id=(2, "agid memory"),
        key_id="1",
    )
    data = args.model_dump(by_alias=True, exclude_none=True)
    assert data["plaintext"] == [72, 101, 108, 108, 111]
    assert data["protocolID"] == [2, "agid memory"]
    assert data["keyID"] == "1"


def test_encrypt_result_from_camel():
    result = EncryptResult.model_validate({"ciphertext": [1, 2, 3]})
    assert result.ciphertext == [1, 2, 3]


def test_create_action_args_with_outputs():
    args = CreateActionArgs(
        description="Test action",
        outputs=[
            ActionOutput(
                locking_script="76a914" + "00" * 20 + "88ac",
                satoshis=1,
                basket="test-basket",
                tags=["tag1", "tag2"],
            )
        ],
    )
    data = args.model_dump(by_alias=True, exclude_none=True)
    assert data["description"] == "Test action"
    assert len(data["outputs"]) == 1
    assert data["outputs"][0]["lockingScript"] == "76a914" + "00" * 20 + "88ac"
    assert data["outputs"][0]["basket"] == "test-basket"


def test_list_outputs_result_from_camel():
    result = ListOutputsResult.model_validate({
        "outputs": [
            {
                "outpoint": "ab" * 32 + ":0",
                "satoshis": 1,
                "lockingScript": "76a914",
                "tags": ["agid memory"],
            }
        ],
        "totalOutputs": 1,
    })
    assert len(result.outputs) == 1
    assert result.outputs[0].outpoint == "ab" * 32 + ":0"
    assert result.outputs[0].tags == ["agid memory"]


def test_brc100_error():
    err = BRC100Error(404, "Not found")
    assert err.status_code == 404
    assert err.message == "Not found"
    assert "404" in str(err)
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/donot/AGiD/agid-pydantic
pytest tests/test_types.py -v
```

Expected: FAIL — `ModuleNotFoundError: No module named 'agid_pydantic.types'`

- [ ] **Step 3: Implement types.py**

Create `/Users/donot/AGiD/agid-pydantic/src/agid_pydantic/types.py`:

```python
"""Pydantic models for BRC-100 wallet wire types.

All models serialize to camelCase for the BRC-100 JSON API and
deserialize from camelCase responses.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


def _to_camel(s: str) -> str:
    """Convert snake_case to camelCase. Special cases for BRC-100 field names."""
    special = {
        "protocol_id": "protocolID",
        "key_id": "keyID",
        "identity_key": "identityKey",
        "raw_tx": "rawTx",
        "locking_script": "lockingScript",
        "custom_instructions": "customInstructions",
        "serial_number": "serialNumber",
        "revocation_outpoint": "revocationOutpoint",
        "total_count": "totalOutputs",
        "message_id": "messageId",
        "message_box": "messageBox",
        "public_key": "publicKey",
    }
    if s in special:
        return special[s]
    parts = s.split("_")
    return parts[0] + "".join(p.capitalize() for p in parts[1:])


class _BRC100Model(BaseModel):
    model_config = ConfigDict(
        alias_generator=_to_camel,
        populate_by_name=True,
    )


# --- Info ---

class GetVersionResult(_BRC100Model):
    version: str

class GetNetworkResult(_BRC100Model):
    network: str

class GetHeightResult(_BRC100Model):
    height: int

class GetHeaderForHeightArgs(_BRC100Model):
    height: int

class GetHeaderResult(_BRC100Model):
    header: list[int]

class AuthenticatedResult(_BRC100Model):
    authenticated: bool


# --- Crypto ---

class GetPublicKeyArgs(_BRC100Model):
    identity_key: bool = False
    protocol_id: tuple[int, str] | None = None
    key_id: str | None = None
    counterparty: str | None = None

class GetPublicKeyResult(_BRC100Model):
    public_key: str

class CreateSignatureArgs(_BRC100Model):
    data: list[int]
    protocol_id: tuple[int, str]
    key_id: str
    counterparty: str | None = None

class CreateSignatureResult(_BRC100Model):
    signature: list[int]

class VerifySignatureArgs(_BRC100Model):
    data: list[int]
    signature: list[int]
    public_key: str | None = None

class VerifySignatureResult(_BRC100Model):
    valid: bool

class EncryptArgs(_BRC100Model):
    data: list[int] = Field(alias="plaintext", default=[])
    protocol_id: tuple[int, str]
    key_id: str
    counterparty: str | None = None

class EncryptResult(_BRC100Model):
    ciphertext: list[int]

class DecryptArgs(_BRC100Model):
    ciphertext: list[int]
    protocol_id: tuple[int, str]
    key_id: str
    counterparty: str | None = None

class DecryptResult(_BRC100Model):
    plaintext: list[int]

class CreateHmacArgs(_BRC100Model):
    data: list[int]
    protocol_id: tuple[int, str]
    key_id: str

class CreateHmacResult(_BRC100Model):
    hmac: list[int]

class VerifyHmacArgs(_BRC100Model):
    data: list[int]
    hmac: list[int]
    protocol_id: tuple[int, str]
    key_id: str

class VerifyHmacResult(_BRC100Model):
    valid: bool


# --- Actions ---

class ActionOutput(_BRC100Model):
    locking_script: str
    satoshis: int
    description: str | None = None
    basket: str | None = None
    tags: list[str] | None = None
    custom_instructions: str | None = None

class CreateActionArgs(_BRC100Model):
    description: str
    outputs: list[ActionOutput] | None = None
    labels: list[str] | None = None

class CreateActionResult(_BRC100Model):
    txid: str
    raw_tx: str | None = None

class SignActionArgs(_BRC100Model):
    reference: str

class SignActionResult(_BRC100Model):
    txid: str

class AbortActionArgs(_BRC100Model):
    reference: str

class AbortActionResult(_BRC100Model):
    aborted: bool

class ListActionsArgs(_BRC100Model):
    labels: list[str] | None = None
    limit: int = 25
    offset: int = 0

class ListActionsResult(_BRC100Model):
    actions: list[dict]
    total_actions: int | None = None

class InternalizeActionArgs(_BRC100Model):
    tx: dict
    outputs: list[dict]
    description: str | None = None

class InternalizeActionResult(_BRC100Model):
    accepted: bool


# --- Outputs ---

class WalletOutput(_BRC100Model):
    outpoint: str
    satoshis: int
    locking_script: str | None = None
    tags: list[str] | None = None
    labels: list[str] | None = None
    custom_instructions: str | None = None

class ListOutputsArgs(_BRC100Model):
    basket: str = "default"
    tags: list[str] | None = None
    include: str | None = None
    limit: int = 25
    offset: int = 0

class ListOutputsResult(_BRC100Model):
    outputs: list[WalletOutput]
    total_count: int | None = None


# --- Certificates ---

class Certificate(_BRC100Model):
    serial_number: str
    certifier: str
    subject: str
    type: str
    fields: dict[str, str]
    revocation_outpoint: str | None = None

class AcquireCertificateArgs(_BRC100Model):
    type: str
    certifier: str
    fields: dict[str, str]
    acquisitionProtocol: str = "direct"

class AcquireCertificateResult(_BRC100Model):
    certificate: dict

class ListCertificatesArgs(_BRC100Model):
    certifier: str | None = None
    type: str = "agidentity.identity"

class ListCertificatesResult(_BRC100Model):
    certificates: list[Certificate]

class ProveCertificateArgs(_BRC100Model):
    certificate: dict
    fields_to_reveal: list[str] | None = None
    verifier: str | None = None

class ProveCertificateResult(_BRC100Model):
    key_for_verifier: str | None = None

class RelinquishCertificateArgs(_BRC100Model):
    type: str
    serial_number: str
    certifier: str

class RelinquishCertificateResult(_BRC100Model):
    relinquished: bool


# --- Discovery ---

class DiscoverByIdentityKeyArgs(_BRC100Model):
    identity_key: str
    certifiers: list[str] | None = None

class DiscoverByAttributesArgs(_BRC100Model):
    attributes: dict[str, str]
    certifiers: list[str] | None = None

class DiscoverCertificatesResult(_BRC100Model):
    certificates: list[dict]

class RevealCounterpartyKeyLinkageArgs(_BRC100Model):
    counterparty: str
    verifier: str
    protocol_id: tuple[int, str]
    key_id: str

class RevealCounterpartyKeyLinkageResult(_BRC100Model):
    envelope: dict | None = None

class RevealSpecificKeyLinkageArgs(_BRC100Model):
    counterparty: str
    verifier: str
    protocol_id: tuple[int, str]
    key_id: str

class RevealSpecificKeyLinkageResult(_BRC100Model):
    envelope: dict | None = None


# --- MessageBox ---

class Message(_BRC100Model):
    message_id: str
    sender: str
    body: str
    message_box: str | None = None

class SendMessageResult(_BRC100Model):
    status: str = "sent"

class Payment(_BRC100Model):
    message_id: str
    sender: str
    amount: int

class AcceptPaymentResult(_BRC100Model):
    accepted: bool


# --- Errors ---

class BRC100Error(Exception):
    """Error from a BRC-100 wallet server."""

    def __init__(self, status_code: int, message: str):
        self.status_code = status_code
        self.message = message
        super().__init__(f"BRC-100 error {status_code}: {message}")


class MessageBoxError(Exception):
    """Error from MessageBox communication."""

    def __init__(self, message: str):
        self.message = message
        super().__init__(f"MessageBox error: {message}")
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Users/donot/AGiD/agid-pydantic
pytest tests/test_types.py -v
```

Expected: All tests PASS. If any camelCase alias mismatches, fix the `_to_camel` function or field aliases.

- [ ] **Step 5: Commit**

```bash
git add src/agid_pydantic/types.py tests/test_types.py
git commit -m "feat: add Pydantic models for all BRC-100 wire types"
```

---

### Task 3: BRC100Client (client.py)

**Files:**
- Create: `src/agid_pydantic/client.py`
- Create: `tests/test_client.py`

- [ ] **Step 1: Write tests for BRC100Client**

Create `/Users/donot/AGiD/agid-pydantic/tests/test_client.py`:

```python
"""Test BRC100Client HTTP behavior."""

import pytest
from agid_pydantic.client import BRC100Client
from agid_pydantic.types import (
    GetPublicKeyArgs,
    EncryptArgs,
    CreateActionArgs,
    ActionOutput,
    ListOutputsArgs,
    BRC100Error,
)

WALLET_URL = "http://test-wallet:3321"


async def test_get_public_key_identity(client, mock_wallet):
    result = await client.get_public_key(GetPublicKeyArgs(identity_key=True))
    assert result.public_key == "02" + "ab" * 32


async def test_get_height(client, mock_wallet):
    result = await client.get_height()
    assert result.height == 850000


async def test_get_network(client, mock_wallet):
    result = await client.get_network()
    assert result.network == "testnet"


async def test_encrypt(client, mock_wallet):
    result = await client.encrypt(EncryptArgs(
        data=[72, 101, 108, 108, 111],
        protocol_id=(2, "agid memory"),
        key_id="1",
    ))
    assert isinstance(result.ciphertext, list)
    assert len(result.ciphertext) > 0


async def test_create_action(client, mock_wallet):
    result = await client.create_action(CreateActionArgs(
        description="Test",
        outputs=[ActionOutput(locking_script="00", satoshis=1)],
    ))
    assert result.txid == "ab" * 32


async def test_list_outputs(client, mock_wallet):
    result = await client.list_outputs(ListOutputsArgs(basket="test"))
    assert isinstance(result.outputs, list)


async def test_error_handling(mock_wallet):
    mock_wallet.post("/getHeight").respond(status_code=500, json={"error": "internal"})
    c = BRC100Client(WALLET_URL)
    await c.connect()
    with pytest.raises(BRC100Error) as exc_info:
        await c.get_height()
    assert exc_info.value.status_code == 500
    await c.close()


async def test_auth_token_header(mock_wallet):
    mock_wallet.post("/getHeight").respond(json={"height": 1})
    c = BRC100Client(WALLET_URL, auth_token="test-token-123")
    await c.connect()
    await c.get_height()
    req = mock_wallet.calls[-1].request
    assert req.headers["authorization"] == "Bearer test-token-123"
    await c.close()
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pytest tests/test_client.py -v
```

Expected: FAIL — `ModuleNotFoundError: No module named 'agid_pydantic.client'`

- [ ] **Step 3: Implement client.py**

Create `/Users/donot/AGiD/agid-pydantic/src/agid_pydantic/client.py`:

```python
"""BRC-100 wallet HTTP client.

Async HTTP client that maps 1:1 to the 28 BRC-100 WalletInterface endpoints.
Works with any BRC-100 wallet server (bsv-wallet-cli, mpc-backend, etc.).
"""

from __future__ import annotations

import httpx
from agid_pydantic.types import (
    # Info
    GetVersionResult, GetNetworkResult, GetHeightResult,
    GetHeaderForHeightArgs, GetHeaderResult,
    AuthenticatedResult,
    # Crypto
    GetPublicKeyArgs, GetPublicKeyResult,
    CreateSignatureArgs, CreateSignatureResult,
    VerifySignatureArgs, VerifySignatureResult,
    EncryptArgs, EncryptResult,
    DecryptArgs, DecryptResult,
    CreateHmacArgs, CreateHmacResult,
    VerifyHmacArgs, VerifyHmacResult,
    # Actions
    CreateActionArgs, CreateActionResult,
    SignActionArgs, SignActionResult,
    AbortActionArgs, AbortActionResult,
    ListActionsArgs, ListActionsResult,
    InternalizeActionArgs, InternalizeActionResult,
    # Outputs
    ListOutputsArgs, ListOutputsResult,
    # Certificates
    AcquireCertificateArgs, AcquireCertificateResult,
    ListCertificatesArgs, ListCertificatesResult,
    ProveCertificateArgs, ProveCertificateResult,
    RelinquishCertificateArgs, RelinquishCertificateResult,
    # Discovery
    DiscoverByIdentityKeyArgs, DiscoverByAttributesArgs,
    DiscoverCertificatesResult,
    RevealCounterpartyKeyLinkageArgs, RevealCounterpartyKeyLinkageResult,
    RevealSpecificKeyLinkageArgs, RevealSpecificKeyLinkageResult,
    # Errors
    BRC100Error,
)
from typing import Any, TypeVar
from pydantic import BaseModel

T = TypeVar("T", bound=BaseModel)


class BRC100Client:
    """Async HTTP client for any BRC-100 wallet server."""

    def __init__(self, url: str, auth_token: str | None = None, timeout: float = 30.0):
        self._url = url.rstrip("/")
        self._auth_token = auth_token
        self._timeout = timeout
        self._http: httpx.AsyncClient | None = None

    async def connect(self) -> None:
        headers = {}
        if self._auth_token:
            headers["Authorization"] = f"Bearer {self._auth_token}"
        self._http = httpx.AsyncClient(
            base_url=self._url,
            headers=headers,
            timeout=self._timeout,
        )

    async def close(self) -> None:
        if self._http:
            await self._http.aclose()
            self._http = None

    async def _post(self, endpoint: str, body: dict[str, Any] | None = None, result_type: type[T] | None = None) -> T | dict:
        """POST JSON to a BRC-100 endpoint and parse the response."""
        assert self._http is not None, "Call connect() before making requests"
        resp = await self._http.post(f"/{endpoint}", json=body or {})
        if resp.status_code >= 400:
            try:
                err = resp.json()
                msg = err.get("error", err.get("message", resp.text))
            except Exception:
                msg = resp.text
            raise BRC100Error(resp.status_code, msg)
        data = resp.json()
        if result_type:
            return result_type.model_validate(data)
        return data

    def _dump(self, args: BaseModel) -> dict[str, Any]:
        """Serialize a Pydantic model to camelCase JSON dict."""
        return args.model_dump(by_alias=True, exclude_none=True)

    # --- Info ---

    async def get_version(self) -> GetVersionResult:
        return await self._post("getVersion", result_type=GetVersionResult)

    async def get_network(self) -> GetNetworkResult:
        return await self._post("getNetwork", result_type=GetNetworkResult)

    async def get_height(self) -> GetHeightResult:
        return await self._post("getHeight", result_type=GetHeightResult)

    async def get_header_for_height(self, args: GetHeaderForHeightArgs) -> GetHeaderResult:
        return await self._post("getHeaderForHeight", self._dump(args), GetHeaderResult)

    async def is_authenticated(self) -> AuthenticatedResult:
        return await self._post("isAuthenticated", result_type=AuthenticatedResult)

    async def wait_for_authentication(self) -> AuthenticatedResult:
        return await self._post("waitForAuthentication", result_type=AuthenticatedResult)

    # --- Crypto ---

    async def get_public_key(self, args: GetPublicKeyArgs) -> GetPublicKeyResult:
        return await self._post("getPublicKey", self._dump(args), GetPublicKeyResult)

    async def create_signature(self, args: CreateSignatureArgs) -> CreateSignatureResult:
        return await self._post("createSignature", self._dump(args), CreateSignatureResult)

    async def verify_signature(self, args: VerifySignatureArgs) -> VerifySignatureResult:
        return await self._post("verifySignature", self._dump(args), VerifySignatureResult)

    async def encrypt(self, args: EncryptArgs) -> EncryptResult:
        return await self._post("encrypt", self._dump(args), EncryptResult)

    async def decrypt(self, args: DecryptArgs) -> DecryptResult:
        return await self._post("decrypt", self._dump(args), DecryptResult)

    async def create_hmac(self, args: CreateHmacArgs) -> CreateHmacResult:
        return await self._post("createHmac", self._dump(args), CreateHmacResult)

    async def verify_hmac(self, args: VerifyHmacArgs) -> VerifyHmacResult:
        return await self._post("verifyHmac", self._dump(args), VerifyHmacResult)

    # --- Actions ---

    async def create_action(self, args: CreateActionArgs) -> CreateActionResult:
        return await self._post("createAction", self._dump(args), CreateActionResult)

    async def sign_action(self, args: SignActionArgs) -> SignActionResult:
        return await self._post("signAction", self._dump(args), SignActionResult)

    async def abort_action(self, args: AbortActionArgs) -> AbortActionResult:
        return await self._post("abortAction", self._dump(args), AbortActionResult)

    async def list_actions(self, args: ListActionsArgs) -> ListActionsResult:
        return await self._post("listActions", self._dump(args), ListActionsResult)

    async def internalize_action(self, args: InternalizeActionArgs) -> InternalizeActionResult:
        return await self._post("internalizeAction", self._dump(args), InternalizeActionResult)

    # --- Outputs ---

    async def list_outputs(self, args: ListOutputsArgs) -> ListOutputsResult:
        return await self._post("listOutputs", self._dump(args), ListOutputsResult)

    # --- Certificates ---

    async def acquire_certificate(self, args: AcquireCertificateArgs) -> AcquireCertificateResult:
        return await self._post("acquireCertificate", self._dump(args), AcquireCertificateResult)

    async def list_certificates(self, args: ListCertificatesArgs) -> ListCertificatesResult:
        return await self._post("listCertificates", self._dump(args), ListCertificatesResult)

    async def prove_certificate(self, args: ProveCertificateArgs) -> ProveCertificateResult:
        return await self._post("proveCertificate", self._dump(args), ProveCertificateResult)

    async def relinquish_certificate(self, args: RelinquishCertificateArgs) -> RelinquishCertificateResult:
        return await self._post("relinquishCertificate", self._dump(args), RelinquishCertificateResult)

    # --- Discovery ---

    async def discover_by_identity_key(self, args: DiscoverByIdentityKeyArgs) -> DiscoverCertificatesResult:
        return await self._post("discoverByIdentityKey", self._dump(args), DiscoverCertificatesResult)

    async def discover_by_attributes(self, args: DiscoverByAttributesArgs) -> DiscoverCertificatesResult:
        return await self._post("discoverByAttributes", self._dump(args), DiscoverCertificatesResult)

    async def reveal_counterparty_key_linkage(self, args: RevealCounterpartyKeyLinkageArgs) -> RevealCounterpartyKeyLinkageResult:
        return await self._post("revealCounterpartyKeyLinkage", self._dump(args), RevealCounterpartyKeyLinkageResult)

    async def reveal_specific_key_linkage(self, args: RevealSpecificKeyLinkageArgs) -> RevealSpecificKeyLinkageResult:
        return await self._post("revealSpecificKeyLinkage", self._dump(args), RevealSpecificKeyLinkageResult)
```

- [ ] **Step 4: Run tests**

```bash
pytest tests/test_client.py -v
```

Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add src/agid_pydantic/client.py tests/test_client.py
git commit -m "feat: add BRC100Client — async HTTP client for all 28 endpoints"
```

---

### Task 4: PushDrop + UHRP Utilities

**Files:**
- Create: `src/agid_pydantic/pushdrop.py`
- Create: `src/agid_pydantic/uhrp.py`
- Create: `tests/test_pushdrop.py`
- Create: `tests/test_uhrp.py`

- [ ] **Step 1: Write PushDrop tests**

Create `/Users/donot/AGiD/agid-pydantic/tests/test_pushdrop.py`:

```python
"""Test PushDrop script building and decoding."""

from agid_pydantic.pushdrop import build_pushdrop_locking_script, decode_pushdrop_fields


def test_build_single_field():
    script = build_pushdrop_locking_script([b"hello"])
    script_hex = script.hex() if hasattr(script, 'hex') else script.serialize().hex()
    # Should contain pushdata for "hello" + OP_DROP + OP_TRUE
    assert len(script_hex) > 0


def test_build_two_fields():
    script = build_pushdrop_locking_script([b"field1", b"field2"])
    script_hex = script.hex() if hasattr(script, 'hex') else script.serialize().hex()
    assert len(script_hex) > 0


def test_round_trip():
    fields = [b"uhrp://abc123", b"tag1,tag2,tag3"]
    script = build_pushdrop_locking_script(fields)
    decoded = decode_pushdrop_fields(script)
    assert decoded == fields


def test_empty_field():
    fields = [b"data", b""]
    script = build_pushdrop_locking_script(fields)
    decoded = decode_pushdrop_fields(script)
    assert decoded == fields
```

- [ ] **Step 2: Write UHRP tests**

Create `/Users/donot/AGiD/agid-pydantic/tests/test_uhrp.py`:

```python
"""Test UHRP URL computation."""

from agid_pydantic.uhrp import compute_uhrp, extract_hash_from_uhrp


def test_compute_uhrp_deterministic():
    data = b"hello world"
    url1 = compute_uhrp(data)
    url2 = compute_uhrp(data)
    assert url1 == url2


def test_compute_uhrp_format():
    url = compute_uhrp(b"test data")
    assert url.startswith("uhrp://")
    # base58check encoded, so alphanumeric
    payload = url[len("uhrp://"):]
    assert len(payload) > 0


def test_different_data_different_urls():
    url1 = compute_uhrp(b"data1")
    url2 = compute_uhrp(b"data2")
    assert url1 != url2


def test_round_trip_hash():
    data = b"test content for hash extraction"
    url = compute_uhrp(data)
    extracted = extract_hash_from_uhrp(url)
    import hashlib
    expected = hashlib.sha256(data).digest()
    assert extracted == expected
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
pytest tests/test_pushdrop.py tests/test_uhrp.py -v
```

Expected: FAIL — modules not found.

- [ ] **Step 4: Implement pushdrop.py**

Create `/Users/donot/AGiD/agid-pydantic/src/agid_pydantic/pushdrop.py`:

```python
"""PushDrop script building and decoding (BRC-48).

Uses bsv-sdk Script primitives for script construction. These are
data-carrier scripts used by AGiD for memory tokens and on-chain storage.
"""

from __future__ import annotations


# OpCode constants
OP_DROP = 0x75
OP_2DROP = 0x6d
OP_TRUE = 0x51


def _encode_pushdata(data: bytes) -> bytes:
    """Encode data as a Bitcoin PUSHDATA operation."""
    n = len(data)
    if n == 0:
        return bytes([0x00])  # OP_0
    elif n <= 75:
        return bytes([n]) + data
    elif n <= 255:
        return bytes([0x4c, n]) + data  # OP_PUSHDATA1
    elif n <= 65535:
        return bytes([0x4d]) + n.to_bytes(2, "little") + data  # OP_PUSHDATA2
    else:
        return bytes([0x4e]) + n.to_bytes(4, "little") + data  # OP_PUSHDATA4


def build_pushdrop_locking_script(fields: list[bytes]) -> bytes:
    """Build a PushDrop data-carrier locking script.

    Format: <field1> <field2> ... OP_2DROP* OP_DROP? OP_TRUE

    Fields are pushed onto the stack, then dropped. OP_TRUE makes the
    script always spendable. The wallet's createAction handles signing.
    """
    script = b""
    for field in fields:
        script += _encode_pushdata(field)
    # Drop all fields from stack
    n = len(fields)
    script += bytes([OP_2DROP]) * (n // 2)
    if n % 2 == 1:
        script += bytes([OP_DROP])
    script += bytes([OP_TRUE])
    return script


def decode_pushdrop_fields(script: bytes) -> list[bytes]:
    """Decode PushDrop script back to field byte arrays.

    Reads pushdata operations until we hit OP_DROP/OP_2DROP/OP_TRUE.
    """
    fields = []
    pos = 0
    while pos < len(script):
        opcode = script[pos]
        if opcode in (OP_DROP, OP_2DROP, OP_TRUE):
            break
        if opcode == 0x00:
            fields.append(b"")
            pos += 1
        elif 1 <= opcode <= 75:
            length = opcode
            pos += 1
            fields.append(script[pos : pos + length])
            pos += length
        elif opcode == 0x4c:  # OP_PUSHDATA1
            pos += 1
            length = script[pos]
            pos += 1
            fields.append(script[pos : pos + length])
            pos += length
        elif opcode == 0x4d:  # OP_PUSHDATA2
            pos += 1
            length = int.from_bytes(script[pos : pos + 2], "little")
            pos += 2
            fields.append(script[pos : pos + length])
            pos += length
        elif opcode == 0x4e:  # OP_PUSHDATA4
            pos += 1
            length = int.from_bytes(script[pos : pos + 4], "little")
            pos += 4
            fields.append(script[pos : pos + length])
            pos += length
        else:
            break
    return fields
```

- [ ] **Step 5: Implement uhrp.py**

Create `/Users/donot/AGiD/agid-pydantic/src/agid_pydantic/uhrp.py`:

```python
"""UHRP (Universal Hash Resolution Protocol) URL computation.

Content-addressed URLs for on-chain data references. Format:
    uhrp://{base58check(prefix + sha256(content))}
"""

from __future__ import annotations

import hashlib
import base58

UHRP_PREFIX = b"\xce\x00"


def compute_uhrp(data: bytes) -> str:
    """Compute UHRP URL for content bytes."""
    content_hash = hashlib.sha256(data).digest()
    payload = UHRP_PREFIX + content_hash
    checksum = hashlib.sha256(hashlib.sha256(payload).digest()).digest()[:4]
    return "uhrp://" + base58.b58encode(payload + checksum).decode()


def extract_hash_from_uhrp(url: str) -> bytes:
    """Extract the SHA-256 hash from a UHRP URL."""
    encoded = url.removeprefix("uhrp://")
    decoded = base58.b58decode(encoded)
    # Strip prefix (2 bytes) and checksum (4 bytes)
    return decoded[len(UHRP_PREFIX) : -4]
```

- [ ] **Step 6: Run tests**

```bash
pytest tests/test_pushdrop.py tests/test_uhrp.py -v
```

Expected: All PASS.

- [ ] **Step 7: Commit**

```bash
git add src/agid_pydantic/pushdrop.py src/agid_pydantic/uhrp.py tests/test_pushdrop.py tests/test_uhrp.py
git commit -m "feat: add PushDrop script builder and UHRP URL computation"
```

---

### Task 5: MessageBoxClient

**Files:**
- Create: `src/agid_pydantic/messagebox.py`
- Create: `tests/test_messagebox.py`

- [ ] **Step 1: Write MessageBoxClient tests**

Create `/Users/donot/AGiD/agid-pydantic/tests/test_messagebox.py`:

```python
"""Test MessageBoxClient encrypted messaging."""

import pytest
import respx
from agid_pydantic.messagebox import MessageBoxClient
from agid_pydantic.client import BRC100Client

WALLET_URL = "http://test-wallet:3321"
MB_URL = "http://test-messagebox:3322"


@pytest.fixture
def mock_mb():
    with respx.mock(base_url=MB_URL) as router:
        router.post("/sendMessage").respond(json={"status": "sent"})
        router.post("/listMessages").respond(json={"messages": []})
        router.post("/acknowledgeMessage").respond(json={"status": "ok"})
        router.post("/listPayments").respond(json={"payments": []})
        router.post("/acceptPayment").respond(json={"accepted": True})
        yield router


async def test_get_identity(client, mock_wallet):
    mb = MessageBoxClient(MB_URL, client)
    identity = await mb.get_identity()
    assert identity == "02" + "ab" * 32


async def test_send_message(client, mock_wallet, mock_mb):
    mb = MessageBoxClient(MB_URL, client)
    result = await mb.send_message(
        recipient="02" + "cd" * 32,
        body="Hello, world!",
    )
    assert result.status == "sent"


async def test_list_messages(client, mock_wallet, mock_mb):
    mb = MessageBoxClient(MB_URL, client)
    messages = await mb.list_messages()
    assert isinstance(messages, list)


async def test_acknowledge(client, mock_wallet, mock_mb):
    mb = MessageBoxClient(MB_URL, client)
    await mb.acknowledge(["msg-1", "msg-2"])
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pytest tests/test_messagebox.py -v
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement messagebox.py**

Create `/Users/donot/AGiD/agid-pydantic/src/agid_pydantic/messagebox.py`:

```python
"""MessageBox client for encrypted agent-to-agent messaging.

Uses BRC100Client for all cryptographic operations (encrypt, decrypt,
sign for BRC-31 auth). No private keys in this module.
"""

from __future__ import annotations

import time
import httpx
from agid_pydantic.client import BRC100Client
from agid_pydantic.types import (
    GetPublicKeyArgs,
    EncryptArgs,
    DecryptArgs,
    CreateSignatureArgs,
    Message,
    SendMessageResult,
    Payment,
    AcceptPaymentResult,
    MessageBoxError,
)
from typing import Any


class MessageBoxClient:
    """Async client for MessageBox encrypted messaging."""

    def __init__(self, url: str, wallet: BRC100Client):
        self._url = url.rstrip("/")
        self._wallet = wallet
        self._http: httpx.AsyncClient | None = None
        self._identity: str | None = None

    async def connect(self) -> None:
        self._http = httpx.AsyncClient(base_url=self._url, timeout=30.0)

    async def close(self) -> None:
        if self._http:
            await self._http.aclose()
            self._http = None

    async def get_identity(self) -> str:
        """Get and cache agent's identity public key."""
        if not self._identity:
            result = await self._wallet.get_public_key(
                GetPublicKeyArgs(identity_key=True)
            )
            self._identity = result.public_key
        return self._identity

    async def send_message(
        self,
        recipient: str,
        body: str,
        message_box: str = "general",
    ) -> SendMessageResult:
        """Encrypt body and send via MessageBox."""
        encrypted = await self._wallet.encrypt(EncryptArgs(
            data=list(body.encode("utf-8")),
            protocol_id=(2, "agidentity pfs"),
            key_id=f"msg-{int(time.time())}",
            counterparty=recipient,
        ))
        identity = await self.get_identity()
        resp = await self._post("/sendMessage", {
            "sender": identity,
            "recipient": recipient,
            "messageBox": message_box,
            "body": bytes(encrypted.ciphertext).hex(),
        })
        return SendMessageResult.model_validate(resp)

    async def list_messages(
        self, message_box: str = "general"
    ) -> list[Message]:
        """List and auto-decrypt messages."""
        identity = await self.get_identity()
        resp = await self._post("/listMessages", {
            "recipient": identity,
            "messageBox": message_box,
        })
        messages = resp.get("messages", [])
        decrypted: list[Message] = []
        for msg in messages:
            try:
                plaintext_result = await self._wallet.decrypt(DecryptArgs(
                    ciphertext=list(bytes.fromhex(msg["body"])),
                    protocol_id=(2, "agidentity pfs"),
                    key_id=msg.get("keyId", "1"),
                    counterparty=msg.get("sender"),
                ))
                body = bytes(plaintext_result.plaintext).decode("utf-8")
            except Exception:
                body = f"[decryption failed: {msg.get('body', '')[:40]}...]"
            decrypted.append(Message(
                message_id=msg.get("messageId", ""),
                sender=msg.get("sender", ""),
                body=body,
                message_box=message_box,
            ))
        return decrypted

    async def acknowledge(self, message_ids: list[str]) -> None:
        """Acknowledge (delete) processed messages."""
        await self._post("/acknowledgeMessage", {"messageIds": message_ids})

    async def list_payments(self) -> list[Payment]:
        """List pending incoming payments."""
        identity = await self.get_identity()
        resp = await self._post("/listPayments", {"recipient": identity})
        return [Payment.model_validate(p) for p in resp.get("payments", [])]

    async def accept_payment(
        self, message_id: str, sender: str
    ) -> AcceptPaymentResult:
        """Accept an incoming payment."""
        resp = await self._post("/acceptPayment", {
            "messageId": message_id,
            "sender": sender,
        })
        return AcceptPaymentResult.model_validate(resp)

    async def _post(self, endpoint: str, body: dict[str, Any]) -> dict:
        """POST to MessageBox with error handling."""
        if not self._http:
            self._http = httpx.AsyncClient(base_url=self._url, timeout=30.0)
        resp = await self._http.post(endpoint, json=body)
        if resp.status_code >= 400:
            raise MessageBoxError(f"{resp.status_code}: {resp.text}")
        return resp.json()
```

- [ ] **Step 4: Run tests**

```bash
pytest tests/test_messagebox.py -v
```

Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add src/agid_pydantic/messagebox.py tests/test_messagebox.py
git commit -m "feat: add MessageBoxClient for encrypted agent messaging"
```

---

### Task 6: AGiDToolset

**Files:**
- Create: `src/agid_pydantic/toolset.py`
- Create: `tests/test_toolset.py`

- [ ] **Step 1: Write toolset tests**

Create `/Users/donot/AGiD/agid-pydantic/tests/test_toolset.py`:

```python
"""Test AGiDToolset — AbstractToolset integration."""

import pytest
from unittest.mock import AsyncMock, MagicMock
from agid_pydantic.toolset import AGiDToolset


async def test_default_groups_returns_all_tools():
    toolset = AGiDToolset(wallet_url="http://localhost:3321")
    # Verify all 8 groups are enabled by default
    assert toolset._groups == AGiDToolset.ALL_GROUPS


async def test_filtered_groups():
    toolset = AGiDToolset(
        wallet_url="http://localhost:3321",
        groups=["memory", "crypto"],
    )
    assert toolset._groups == ["memory", "crypto"]


def test_class_attributes():
    assert AGiDToolset.id == "agid"
    assert AGiDToolset.label == "AGiD"
    assert isinstance(AGiDToolset.tool_name_conflict_hint, str)
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pytest tests/test_toolset.py -v
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement toolset.py**

Create `/Users/donot/AGiD/agid-pydantic/src/agid_pydantic/toolset.py`:

```python
"""AGiDToolset — Pydantic AI AbstractToolset for AGiD blockchain tools.

Subclasses AbstractToolset to expose 39 AGiD tools grouped into 8 categories.
Talks HTTP to any BRC-100 wallet server. The wallet does all cryptography.
"""

from __future__ import annotations

from typing import Any

from pydantic_ai.toolsets import AbstractToolset, ToolsetTool
from pydantic_ai.tools import ToolDefinition
from pydantic_ai.agent import RunContext

from agid_pydantic.client import BRC100Client
from agid_pydantic.messagebox import MessageBoxClient
from agid_pydantic.tools import TOOL_REGISTRY, TOOL_HANDLERS


class AGiDToolset(AbstractToolset[Any]):
    """AGiD blockchain-native agent toolset.

    Exposes identity, certificates, memory, crypto, ZK proofs, messaging,
    wallet, and audit tools — all backed by a BRC-100 wallet server.

    Usage:
        agid = AGiDToolset(wallet_url="http://localhost:3321")
        agent = Agent('anthropic:claude-sonnet-4-6', toolsets=[agid])
    """

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
        self._groups = groups or list(self.ALL_GROUPS)
        self._client: BRC100Client | None = None
        self._messagebox: MessageBoxClient | None = None

    # --- Required: AbstractToolset abstract methods ---

    async def get_tools(
        self, ctx: RunContext[Any]
    ) -> dict[str, ToolsetTool[Any]]:
        """Return available tools filtered by enabled groups."""
        tools: dict[str, ToolsetTool[Any]] = {}
        for group in self._groups:
            group_tools = TOOL_REGISTRY.get(group, {})
            for name, (tool_def, _handler) in group_tools.items():
                tools[name] = ToolsetTool(definition=tool_def)
        return tools

    async def call_tool(
        self,
        name: str,
        tool_args: dict[str, Any],
        ctx: RunContext[Any],
        tool: ToolsetTool[Any],
    ) -> Any:
        """Dispatch tool call to the registered handler."""
        handler = TOOL_HANDLERS[name]
        return await handler(tool_args, self._client, self._messagebox)

    # --- Optional: Lifecycle ---

    async def __aenter__(self) -> AGiDToolset:
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

    async def for_run(self, ctx: RunContext[Any]) -> AGiDToolset:
        """Return self — HTTP clients are stateless and safe to share."""
        return self

    # --- Optional: Instructions ---

    async def get_instructions(self, ctx: RunContext[Any]) -> str | None:
        """Inject AGiD usage guidance into the agent's system prompt."""
        return (
            "You have access to AGiD blockchain-native tools for identity, "
            "encrypted memory, zero-knowledge proofs, certificates, messaging, "
            "and wallet operations. All cryptographic operations are performed "
            "by the wallet server — never attempt to handle keys or signing directly."
        )
```

- [ ] **Step 4: Run tests**

```bash
pytest tests/test_toolset.py -v
```

Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add src/agid_pydantic/toolset.py tests/test_toolset.py
git commit -m "feat: add AGiDToolset — AbstractToolset subclass for Pydantic AI"
```

---

### Task 7: Identity Tools (5 tools)

**Files:**
- Create: `src/agid_pydantic/tools/identity.py`
- Create: `tests/test_tools/test_identity.py`

- [ ] **Step 1: Write identity tool tests**

Create `/Users/donot/AGiD/agid-pydantic/tests/test_tools/test_identity.py`:

```python
"""Test identity tool handlers."""

import pytest
from unittest.mock import AsyncMock
from agid_pydantic.tools.identity import (
    handle_agid_identity,
    handle_agid_balance,
    handle_agid_get_public_key,
    handle_agid_get_height,
    handle_agid_lookup_identity,
)
from agid_pydantic.types import (
    GetPublicKeyResult, GetNetworkResult, ListOutputsResult,
    GetHeightResult, DiscoverCertificatesResult,
)


@pytest.fixture
def mock_client():
    client = AsyncMock()
    client.get_public_key.return_value = GetPublicKeyResult(public_key="02" + "ab" * 32)
    client.get_network.return_value = GetNetworkResult(network="mainnet")
    client.list_outputs.return_value = ListOutputsResult(outputs=[], total_count=0)
    client.get_height.return_value = GetHeightResult(height=850000)
    client.discover_by_attributes.return_value = DiscoverCertificatesResult(certificates=[])
    return client


async def test_agid_identity(mock_client):
    result = await handle_agid_identity({}, mock_client, None)
    assert "02" + "ab" * 32 in result
    assert "mainnet" in result


async def test_agid_balance(mock_client):
    result = await handle_agid_balance({}, mock_client, None)
    assert "0" in result  # 0 satoshis from empty outputs


async def test_agid_get_public_key(mock_client):
    result = await handle_agid_get_public_key({
        "identity_key": False,
        "security_level": 2,
        "protocol_name": "agid memory",
        "key_id": "1",
    }, mock_client, None)
    assert "02" + "ab" * 32 in result


async def test_agid_get_height(mock_client):
    result = await handle_agid_get_height({}, mock_client, None)
    assert "850000" in result


async def test_agid_lookup_identity(mock_client):
    result = await handle_agid_lookup_identity({"name": "Alice"}, mock_client, None)
    assert "no results" in result.lower() or "certificates" in result.lower()
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pytest tests/test_tools/test_identity.py -v
```

Expected: FAIL.

- [ ] **Step 3: Implement identity.py**

Create `/Users/donot/AGiD/agid-pydantic/src/agid_pydantic/tools/identity.py`:

```python
"""Identity tools — agent identity, balance, key derivation, blockchain info."""

from __future__ import annotations

from typing import Any
from pydantic import BaseModel
from pydantic_ai.tools import ToolDefinition
from agid_pydantic.client import BRC100Client
from agid_pydantic.messagebox import MessageBoxClient
from agid_pydantic.types import (
    GetPublicKeyArgs, ListOutputsArgs, DiscoverByAttributesArgs,
)
from agid_pydantic.tools import register_group


# --- Arg models ---

class GetPublicKeyToolArgs(BaseModel):
    identity_key: bool = False
    security_level: int = 0
    protocol_name: str = "agent message"
    key_id: str = "1"
    counterparty: str | None = None

class LookupIdentityArgs(BaseModel):
    name: str | None = None
    email: str | None = None
    phone_number: str | None = None


# --- Handlers ---

async def handle_agid_identity(
    tool_args: dict[str, Any], client: BRC100Client, messagebox: MessageBoxClient | None
) -> Any:
    identity = await client.get_public_key(GetPublicKeyArgs(identity_key=True))
    network = await client.get_network()
    outputs = await client.list_outputs(ListOutputsArgs(basket="default", limit=1000))
    balance = sum(o.satoshis for o in outputs.outputs)
    return f"Identity: {identity.public_key}\nNetwork: {network.network}\nBalance: {balance} satoshis"


async def handle_agid_balance(
    tool_args: dict[str, Any], client: BRC100Client, messagebox: MessageBoxClient | None
) -> Any:
    outputs = await client.list_outputs(ListOutputsArgs(basket="default", limit=1000))
    balance = sum(o.satoshis for o in outputs.outputs)
    return f"Balance: {balance} satoshis"


async def handle_agid_get_public_key(
    tool_args: dict[str, Any], client: BRC100Client, messagebox: MessageBoxClient | None
) -> Any:
    parsed = GetPublicKeyToolArgs(**tool_args)
    result = await client.get_public_key(GetPublicKeyArgs(
        identity_key=parsed.identity_key,
        protocol_id=(parsed.security_level, parsed.protocol_name) if not parsed.identity_key else None,
        key_id=parsed.key_id if not parsed.identity_key else None,
        counterparty=parsed.counterparty,
    ))
    return f"Public key: {result.public_key}"


async def handle_agid_get_height(
    tool_args: dict[str, Any], client: BRC100Client, messagebox: MessageBoxClient | None
) -> Any:
    result = await client.get_height()
    return f"Block height: {result.height}"


async def handle_agid_lookup_identity(
    tool_args: dict[str, Any], client: BRC100Client, messagebox: MessageBoxClient | None
) -> Any:
    parsed = LookupIdentityArgs(**tool_args)
    attrs = {}
    if parsed.name:
        attrs["name"] = parsed.name
    if parsed.email:
        attrs["email"] = parsed.email
    if parsed.phone_number:
        attrs["phoneNumber"] = parsed.phone_number
    result = await client.discover_by_attributes(DiscoverByAttributesArgs(attributes=attrs))
    if not result.certificates:
        return "No results found."
    lines = [f"Found {len(result.certificates)} identity certificates:"]
    for cert in result.certificates:
        lines.append(f"  - {cert}")
    return "\n".join(lines)


# --- Registration ---

_TOOLS: dict[str, tuple[ToolDefinition, Any]] = {
    "agid_identity": (
        ToolDefinition(
            name="agid_identity",
            description="Get your cryptographic identity — public key, network, and wallet balance.",
            parameters_json_schema={"type": "object", "properties": {}},
        ),
        handle_agid_identity,
    ),
    "agid_balance": (
        ToolDefinition(
            name="agid_balance",
            description="Check your BSV wallet balance in satoshis.",
            parameters_json_schema={"type": "object", "properties": {}},
        ),
        handle_agid_balance,
    ),
    "agid_get_public_key": (
        ToolDefinition(
            name="agid_get_public_key",
            description="Derive a protocol-specific public key using BRC-42 key derivation. "
                        "Useful for creating shared secrets or protocol-specific identities.",
            parameters_json_schema=GetPublicKeyToolArgs.model_json_schema(),
        ),
        handle_agid_get_public_key,
    ),
    "agid_get_height": (
        ToolDefinition(
            name="agid_get_height",
            description="Get the current BSV blockchain block height.",
            parameters_json_schema={"type": "object", "properties": {}},
        ),
        handle_agid_get_height,
    ),
    "agid_lookup_identity": (
        ToolDefinition(
            name="agid_lookup_identity",
            description="Look up an identity on the BSV overlay network by name, email, or phone number.",
            parameters_json_schema=LookupIdentityArgs.model_json_schema(),
        ),
        handle_agid_lookup_identity,
    ),
}

register_group("identity", _TOOLS)
```

- [ ] **Step 4: Import identity module in tools/__init__.py**

Add to `/Users/donot/AGiD/agid-pydantic/src/agid_pydantic/tools/__init__.py` at the bottom:

```python
# Import tool modules to trigger registration
import agid_pydantic.tools.identity  # noqa: F401
```

- [ ] **Step 5: Run tests**

```bash
pytest tests/test_tools/test_identity.py -v
```

Expected: All PASS.

- [ ] **Step 6: Commit**

```bash
git add src/agid_pydantic/tools/identity.py tests/test_tools/test_identity.py src/agid_pydantic/tools/__init__.py
git commit -m "feat: add identity tool group (5 tools)"
```

---

### Task 8: Memory Tools (2 tools)

**Files:**
- Create: `src/agid_pydantic/tools/memory.py`
- Create: `tests/test_tools/test_memory.py`

This task follows the identical pattern as Task 7. The two tools are:

- `agid_store_memory` — encrypt content, compute UHRP, create PushDrop token in `agid-memory` basket
- `agid_recall_memories` — list memory tokens from `agid-memory` basket, decode PushDrop fields, decrypt content

The handler for `agid_store_memory` is shown in the spec (the `handle_store_memory` example). The handler for `agid_recall_memories` reverses the process: `listOutputs(basket="agid-memory")` → decode PushDrop fields → decrypt each memory → return formatted results.

- [ ] **Step 1: Write memory tool tests** (test store and recall handlers against mock client)
- [ ] **Step 2: Run tests to verify they fail**
- [ ] **Step 3: Implement memory.py** (follow spec example exactly for store; reverse for recall)
- [ ] **Step 4: Add `import agid_pydantic.tools.memory` to tools/__init__.py**
- [ ] **Step 5: Run tests — all PASS**
- [ ] **Step 6: Commit** — `feat: add memory tool group (2 tools)`

---

### Task 9: Crypto Tools (5 tools)

**Files:**
- Create: `src/agid_pydantic/tools/crypto.py`
- Create: `tests/test_tools/test_crypto.py`

Tools: `agid_sign`, `agid_encrypt`, `agid_decrypt`, `agid_wallet_client_request`, `agid_request_user_signature`

Each handler is a thin wrapper around the corresponding `BRC100Client` method. `agid_wallet_client_request` and `agid_request_user_signature` are the two tools that do NOT require the agent's wallet — they make HTTP calls to an external user's wallet client URL.

- [ ] **Step 1-6:** Same TDD pattern as Task 7. Commit: `feat: add crypto tool group (5 tools)`

---

### Task 10: Wallet Tools (7 tools)

**Files:**
- Create: `src/agid_pydantic/tools/wallet.py`
- Create: `tests/test_tools/test_wallet.py`

Tools: `agid_create_action`, `agid_internalize_action`, `agid_list_outputs`, `agid_send_payment`, `agid_token_create`, `agid_token_list`, `agid_token_redeem`

`agid_token_create` uses `build_pushdrop_locking_script()` from `pushdrop.py`. `agid_token_list` uses `decode_pushdrop_fields()` to parse token data. `agid_send_payment` uses both `BRC100Client` and `MessageBoxClient`.

- [ ] **Step 1-6:** Same TDD pattern. Commit: `feat: add wallet tool group (7 tools)`

---

### Task 11: Certificate Tools (8 tools)

**Files:**
- Create: `src/agid_pydantic/tools/certificates.py`
- Create: `tests/test_tools/test_certificates.py`

Tools: `agid_cert_issue`, `agid_cert_receive`, `agid_cert_list`, `agid_cert_verify`, `agid_cert_revoke`, `agid_cert_reveal`, `agid_cert_check_revocation`, `agid_cert_send`

Most are thin wrappers around BRC-100 certificate endpoints. `agid_cert_send` uses `MessageBoxClient`. `agid_cert_revoke` creates a transaction via `createAction`.

- [ ] **Step 1-6:** Same TDD pattern. Commit: `feat: add certificate tool group (8 tools)`

---

### Task 12: ZK Proof Tools (5 tools)

**Files:**
- Create: `src/agid_pydantic/tools/zkproof.py`
- Create: `tests/test_tools/test_zkproof.py`

Tools: `agid_zkproof_privilege`, `agid_zkproof_verify`, `agid_zkproof_selective_reveal`, `agid_zkproof_commitment`, `agid_zkproof_verify_commitment`

These compose multiple BRC-100 calls (getPublicKey + createSignature + optional createAction for on-chain anchoring). See the spec's ZK Proofs table for the exact BRC-100 call sequences.

- [ ] **Step 1-6:** Same TDD pattern. Commit: `feat: add ZK proof tool group (5 tools)`

---

### Task 13: Messaging Tools (5 tools)

**Files:**
- Create: `src/agid_pydantic/tools/messaging.py`
- Create: `tests/test_tools/test_messaging.py`

Tools: `agid_message_send`, `agid_message_list`, `agid_message_ack`, `agid_list_payments`, `agid_accept_payment`

All 5 tools delegate to `MessageBoxClient` methods. Thin wrappers that parse tool args and format results.

- [ ] **Step 1-6:** Same TDD pattern. Commit: `feat: add messaging tool group (5 tools)`

---

### Task 14: Audit Tools (2 tools)

**Files:**
- Create: `src/agid_pydantic/tools/audit.py`
- Create: `tests/test_tools/test_audit.py`

Tools: `agid_verify_workspace`, `agid_verify_session`

Both tools list outputs from the `anchor-chain` basket, decode PushDrop fields to extract Merkle roots, and verify signatures. These are the most complex tools — they compose `listOutputs` + `decode_pushdrop_fields` + `verifySignature`.

- [ ] **Step 1-6:** Same TDD pattern. Commit: `feat: add audit tool group (2 tools)`

---

### Task 15: Final Integration Test + Package Export

**Files:**
- Modify: `src/agid_pydantic/__init__.py`
- Modify: `src/agid_pydantic/tools/__init__.py`
- Create: `tests/test_integration.py`

- [ ] **Step 1: Ensure all tool modules are imported in tools/__init__.py**

Verify `/Users/donot/AGiD/agid-pydantic/src/agid_pydantic/tools/__init__.py` imports all 8 modules:

```python
# Import tool modules to trigger registration
import agid_pydantic.tools.identity      # noqa: F401
import agid_pydantic.tools.crypto        # noqa: F401
import agid_pydantic.tools.memory        # noqa: F401
import agid_pydantic.tools.wallet        # noqa: F401
import agid_pydantic.tools.certificates  # noqa: F401
import agid_pydantic.tools.zkproof       # noqa: F401
import agid_pydantic.tools.messaging     # noqa: F401
import agid_pydantic.tools.audit         # noqa: F401
```

- [ ] **Step 2: Write integration test**

Create `/Users/donot/AGiD/agid-pydantic/tests/test_integration.py`:

```python
"""Integration test — verify AGiDToolset registers all 39 tools correctly."""

from agid_pydantic.tools import TOOL_REGISTRY, TOOL_HANDLERS
from agid_pydantic.toolset import AGiDToolset


def test_all_groups_registered():
    for group in AGiDToolset.ALL_GROUPS:
        assert group in TOOL_REGISTRY, f"Group '{group}' not in TOOL_REGISTRY"


def test_total_tool_count():
    total = sum(len(tools) for tools in TOOL_REGISTRY.values())
    assert total == 39, f"Expected 39 tools, got {total}"


def test_all_handlers_registered():
    for group, tools in TOOL_REGISTRY.items():
        for name in tools:
            assert name in TOOL_HANDLERS, f"Handler missing for '{name}'"


def test_tool_counts_per_group():
    expected = {
        "identity": 5,
        "certificates": 8,
        "memory": 2,
        "crypto": 5,
        "zkproof": 5,
        "messaging": 5,
        "wallet": 7,
        "audit": 2,
    }
    for group, count in expected.items():
        actual = len(TOOL_REGISTRY.get(group, {}))
        assert actual == count, f"Group '{group}': expected {count}, got {actual}"


def test_no_duplicate_tool_names():
    all_names = []
    for tools in TOOL_REGISTRY.values():
        all_names.extend(tools.keys())
    assert len(all_names) == len(set(all_names)), "Duplicate tool names found"


def test_group_filtering():
    toolset = AGiDToolset(groups=["memory", "crypto"])
    assert toolset._groups == ["memory", "crypto"]


def test_public_exports():
    from agid_pydantic import AGiDToolset, BRC100Client
    assert AGiDToolset is not None
    assert BRC100Client is not None
```

- [ ] **Step 3: Run full test suite**

```bash
cd /Users/donot/AGiD/agid-pydantic
pytest -v
```

Expected: All tests PASS across all modules.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: complete agid-pydantic — 39 tools, 8 groups, full test suite"
```

- [ ] **Step 5: Verify package installs cleanly**

```bash
pip install -e .
python -c "from agid_pydantic import AGiDToolset; print('OK:', AGiDToolset.ALL_GROUPS)"
```

Expected: `OK: ['identity', 'certificates', 'memory', 'crypto', 'zkproof', 'messaging', 'wallet', 'audit']`
