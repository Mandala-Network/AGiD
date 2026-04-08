# AGiD + SentinelOne Demo: Accountable Investigation

**Date:** 2026-04-08
**Location:** `/Users/donot/AGiD/agid-s1-demo/`
**Status:** Draft

## Overview

A CLI demo showing an AI agent that investigates a security threat using SentinelOne data and AGiD blockchain tools — then produces a zero-knowledge proof that the investigation was conducted correctly, without revealing any of the underlying data.

The core deliverable is the **`proof-of-work` skill** — a reusable AGiD skill that teaches any agent to wrap any workflow in a provable hash chain. The SentinelOne investigation scenario is the vehicle to demonstrate it.

## What This Proves to SentinelOne

Purple AI can investigate threats autonomously. What it cannot do today:

- **Prove** the investigation followed procedure — to an auditor, court, or regulator
- **Prove** the agent had authorization — cryptographically, not just RBAC logs
- **Prove** remediation was human-approved — with a real cryptographic co-signature
- **Do all of the above** without revealing customer data, threat details, or investigation content

This demo does all four.

## Architecture

```
Demo CLI (demo.py)
  └── Pydantic AI Agent
        │
        ├── MCP: AGiD Server (real)
        │     ├── proof-of-work skill (loaded from on-chain)
        │     ├── 39 AGiD tools (identity, memory, ZK proofs, etc.)
        │     └── BRC-100 wallet (bsv-wallet-cli or mpc-backend)
        │
        └── MCP: SentinelOne Mock Server (s1_mock_server.py)
              ├── 10 tools (alerts, events, hosts, quarantine, etc.)
              └── Seeded OCSF dataset (s1_data.py)
```

The agent loads the `proof-of-work` skill from AGiD's on-chain skill store. This skill instructs the agent to open a proof envelope at the start, chain every action during the workflow, and seal the envelope at the end. The agent follows these instructions naturally alongside its investigation work.

## Deliverables

### 1. `proof-of-work` Skill

An AGiD skill stored on-chain via `agid_create_skill`. It teaches the agent a three-phase proof pattern that works for any domain.

**Phase 1 — Open the envelope**

At the start of any workflow that needs provability, the agent creates an initial commitment:

```
agid_zkproof_commitment(
    data="workflow:{workflow_id}:started:{timestamp}",
    label="envelope-open",
    anchor_on_chain=true
)
→ Returns: commitment_hash, txid (this is the chain head)
```

The agent stores the commitment hash as the chain head. This anchors the start time on-chain immutably.

**Phase 2 — Chain each action**

For every meaningful action during the workflow, the agent creates a new commitment that links to the previous one:

```
# After querying for threat data:
agid_zkproof_commitment(
    data=hash(prev_commitment_hash + "action:query_alerts:completed"),
    label="chain-step-1",
    anchor_on_chain=false  # only anchor start and end to save fees
)

# After storing investigation findings:
agid_store_memory(content="...", tags=["investigation", workflow_id])
→ Returns: memory_txid
agid_zkproof_commitment(
    data=hash(prev_commitment_hash + "action:store_findings:" + memory_txid),
    label="chain-step-2",
    anchor_on_chain=false
)

# After human co-signs remediation:
agid_zkproof_commitment(
    data=hash(prev_commitment_hash + "action:remediate:quarantine:dual_signed"),
    label="chain-step-3",
    anchor_on_chain=false
)
```

Each commitment hashes in the previous commitment, forming a Merkle chain. The chain is append-only — you can't insert, remove, or reorder steps without breaking the hashes.

**Phase 3 — Seal the envelope**

At the end of the workflow, the agent:

1. Creates a final commitment anchored on-chain (the Merkle root):

```
agid_zkproof_commitment(
    data=hash(prev_commitment_hash + "workflow:{workflow_id}:sealed:steps:{N}"),
    label="envelope-seal",
    anchor_on_chain=true
)
→ Returns: merkle_root_hash, seal_txid
```

2. Generates a ZK proof of agent identity/authorization:

```
agid_zkproof_privilege(
    counterparty="self",
    protocol_id="agidentity pfs",
    security_level=2,
    anchor_on_chain=true,
    label="investigation-auth-proof"
)
→ Returns: zk_proof object
```

3. Assembles the proof artifact:

```json
{
    "version": 1,
    "workflow_id": "investigation:ALT-78432",
    "chain_length": 6,
    "envelope_open_txid": "abc123...",
    "envelope_seal_txid": "fed987...",
    "merkle_root": "9f3a...",
    "agent_identity_proof": { ... },
    "procedure_hash": "hash of the 6-step policy used",
    "timestamps": {
        "started": "2026-04-08T14:23:07Z",
        "sealed": "2026-04-08T14:24:01Z"
    },
    "chain_hashes": [
        "hash0...", "hash1...", "hash2...",
        "hash3...", "hash4...", "hash5..."
    ],
    "content_revealed": "NONE"
}
```

This artifact contains hashes, proofs, and on-chain references — zero content from the investigation.

**Skill trigger keywords:** "prove", "proof", "accountable", "audit trail", "compliance proof"

**Skill body:** Markdown instructions that the agent follows. Approximately 50-80 lines telling the agent when and how to call the three phases. The agent reads this as part of its system prompt when trigger keywords match.

### 2. SentinelOne Mock MCP Server

Single-file Python FastMCP server. Returns realistic OCSF-formatted threat data for a pre-seeded scenario.

**Dataset (`s1_data.py`):**

Hosts:
```python
HOSTS = {
    "host-40": {"hostname": "ws-eng-040", "ip": "10.1.2.40", "os": "Windows 11", "status": "healthy", "user": "jsmith", "group": "engineering"},
    "host-41": {"hostname": "ws-eng-041", "ip": "10.1.2.41", "os": "Windows 11", "status": "healthy", "user": "jsmith", "group": "engineering"},
    "host-42": {"hostname": "ws-fin-042", "ip": "10.1.3.42", "os": "Windows Server 2022", "status": "compromised", "user": "lateral-actor", "group": "finance"},
    "host-43": {"hostname": "srv-dc-043", "ip": "10.1.1.43", "os": "Windows Server 2022", "status": "healthy", "user": "admin-svc", "group": "domain-controllers"},
    "host-44": {"hostname": "srv-db-044", "ip": "10.1.4.44", "os": "Ubuntu 22.04", "status": "healthy", "user": "admin-svc", "group": "databases"},
}
```

Users:
```python
USERS = {
    "jsmith": {"name": "John Smith", "role": "engineer", "department": "engineering", "auth_method": "sso+mfa", "last_login": "2026-04-08T08:00:00Z", "status": "active"},
    "admin-svc": {"name": "Admin Service Account", "role": "admin", "department": "IT", "auth_method": "certificate", "last_login": "2026-04-08T06:00:00Z", "status": "active"},
    "lateral-actor": {"name": "Unknown Actor", "role": "none", "department": "none", "auth_method": "stolen_credential", "last_login": "2026-04-07T22:15:00Z", "status": "suspicious"},
}
```

Alerts:
```python
ALERTS = {
    "ALT-78432": {
        "id": "ALT-78432",
        "title": "Lateral Movement Detected",
        "severity": "critical",
        "status": "active",
        "host": "host-42",
        "user": "lateral-actor",
        "technique": "T1021.002 - SMB/Windows Admin Shares",
        "first_seen": "2026-04-07T22:15:00Z",
        "last_seen": "2026-04-08T03:42:00Z",
        "related_alerts": ["ALT-78430", "ALT-78431"],
        "description": "Suspicious lateral movement via SMB from host-42 to domain controller srv-dc-043 using compromised credentials.",
    },
}
```

Events (12 OCSF-formatted):
```python
EVENTS = [
    {"time": "2026-04-07T22:15:00Z", "type": "authentication", "host": "host-42", "user": "lateral-actor", "action": "login", "outcome": "success", "method": "ntlm", "src_ip": "10.1.3.42", "dst_ip": "10.1.1.43", "detail": "NTLM authentication from finance workstation to domain controller"},
    {"time": "2026-04-07T22:17:00Z", "type": "process", "host": "host-42", "user": "lateral-actor", "action": "exec", "outcome": "success", "process": "cmd.exe", "parent": "explorer.exe", "cmdline": "net use \\\\srv-dc-043\\admin$ /user:admin-svc", "detail": "Mapped admin share on domain controller"},
    {"time": "2026-04-07T22:19:00Z", "type": "network", "host": "host-42", "user": "lateral-actor", "action": "connect", "outcome": "success", "src_ip": "10.1.3.42", "dst_ip": "10.1.1.43", "dst_port": 445, "protocol": "smb", "detail": "SMB connection to domain controller"},
    {"time": "2026-04-07T22:25:00Z", "type": "file", "host": "host-43", "user": "lateral-actor", "action": "write", "outcome": "success", "path": "C:\\Windows\\Temp\\svc_update.exe", "hash": "a1b2c3d4e5f6...", "detail": "Suspicious binary dropped on domain controller"},
    {"time": "2026-04-07T22:30:00Z", "type": "process", "host": "host-43", "user": "lateral-actor", "action": "exec", "outcome": "success", "process": "svc_update.exe", "parent": "services.exe", "cmdline": "svc_update.exe -install -quiet", "detail": "Execution of dropped binary as service"},
    {"time": "2026-04-07T23:00:00Z", "type": "network", "host": "host-43", "user": "SYSTEM", "action": "connect", "outcome": "success", "src_ip": "10.1.1.43", "dst_ip": "45.33.32.156", "dst_port": 443, "protocol": "https", "detail": "Outbound connection to known C2 infrastructure"},
    {"time": "2026-04-07T23:15:00Z", "type": "network", "host": "host-43", "user": "SYSTEM", "action": "connect", "outcome": "success", "src_ip": "10.1.1.43", "dst_ip": "185.220.101.42", "dst_port": 8443, "protocol": "https", "detail": "Outbound connection to secondary C2 node"},
    {"time": "2026-04-08T01:00:00Z", "type": "authentication", "host": "host-44", "user": "admin-svc", "action": "login", "outcome": "success", "method": "kerberos", "src_ip": "10.1.1.43", "dst_ip": "10.1.4.44", "detail": "Kerberos auth from DC to database server using service account"},
    {"time": "2026-04-08T01:05:00Z", "type": "network", "host": "host-44", "user": "admin-svc", "action": "connect", "outcome": "success", "src_ip": "10.1.1.43", "dst_ip": "10.1.4.44", "dst_port": 5432, "protocol": "postgresql", "detail": "Database connection from compromised DC"},
    {"time": "2026-04-08T01:10:00Z", "type": "file", "host": "host-44", "user": "admin-svc", "action": "read", "outcome": "success", "path": "/var/lib/postgresql/data/customers.db", "detail": "Bulk read of customer database"},
    {"time": "2026-04-08T02:00:00Z", "type": "network", "host": "host-43", "user": "SYSTEM", "action": "transfer", "outcome": "success", "src_ip": "10.1.1.43", "dst_ip": "45.33.32.156", "dst_port": 443, "bytes_sent": 52428800, "detail": "50MB data exfiltration to C2"},
    {"time": "2026-04-08T03:42:00Z", "type": "process", "host": "host-42", "user": "lateral-actor", "action": "exec", "outcome": "success", "process": "wevtutil.exe", "cmdline": "wevtutil cl Security", "detail": "Security event log cleared — anti-forensics"},
]
```

Threat intel:
```python
THREAT_INTEL = {
    "c2_ips": ["45.33.32.156", "185.220.101.42"],
    "malicious_hashes": ["a1b2c3d4e5f6..."],
    "ioc_tags": ["apt-lateral", "credential-theft", "data-exfil"],
}
```

Investigation policy:
```python
INVESTIGATION_POLICY = {
    "name": "Standard Threat Investigation Procedure",
    "version": "2.1",
    "steps": [
        "1. Retrieve and review the triggering alert",
        "2. Gather host and user context for affected systems",
        "3. Pull event timeline (72h window) and identify attack chain",
        "4. Check network connections against threat intelligence",
        "5. Assess blast radius — which systems and data were accessed",
        "6. Recommend and execute remediation with analyst approval",
    ],
}
```

**Tools (`s1_mock_server.py`):**

| Tool | Parameters | Returns |
|---|---|---|
| `s1_get_alert(alert_id: str)` | Alert ID | Alert dict or "not found" |
| `s1_list_alerts(host: str \| None, severity: str \| None)` | Optional filters | List of matching alerts |
| `s1_get_host(host_id: str)` | Host ID | Host dict or "not found" |
| `s1_get_events(host: str \| None, hours: int = 72)` | Host filter, time window | List of OCSF events |
| `s1_get_user(username: str)` | Username | User dict or "not found" |
| `s1_check_threat_intel(ip: str \| None, hash: str \| None)` | IP or hash to check | Match result with IOC tags |
| `s1_get_network_connections(host: str)` | Host ID | Network events for that host |
| `s1_quarantine_host(host_id: str, reason: str)` | Host + reason | Confirmation ID + status |
| `s1_get_policy()` | None | Investigation procedure steps |
| `s1_get_investigation_status(alert_id: str)` | Alert ID | Current investigation state |

Transport: FastMCP over stdio. Started as a subprocess by the demo script.

### 3. Demo CLI Script

**File:** `demo.py`

```python
from pydantic_ai import Agent
from pydantic_ai.mcp import MCPServerStdio

agid = MCPServerStdio(...)     # AGiD MCP server
s1   = MCPServerStdio(...)     # SentinelOne mock

agent = Agent(
    'anthropic:claude-sonnet-4-6',
    instructions="""You are a SOC analyst. You investigate threats using
    SentinelOne data and record all findings using AGiD blockchain tools.

    You have loaded the proof-of-work skill. For every investigation:
    1. Open a proof envelope at the start
    2. Chain every action (query, finding, decision) to the proof
    3. Store all findings as encrypted AGiD memories
    4. Seal the proof envelope when done
    5. Output the proof artifact""",
    toolsets=[agid, s1],
)
```

**Execution flow:**

1. Script starts both MCP servers
2. Agent receives: `"Investigate alert ALT-78432: suspicious lateral movement from host-42"`
3. Agent loads `proof-of-work` skill from AGiD (trigger: "investigate")
4. Agent opens proof envelope → on-chain commitment
5. Agent calls `s1_get_policy` → learns the 6-step procedure
6. Agent follows each step, using S1 tools for data and AGiD tools for storage/proofs
7. At step 6 (remediation), agent calls `s1_quarantine_host` — if MPC wallet is configured, this blocks until human cosigner approves
8. Agent seals the proof envelope → on-chain anchor
9. Script prints the proof artifact
10. Script runs verification and prints pass/fail

**Output format:** Step-by-step terminal output as shown in the design section above. Each step prints what the agent is doing, which tools it called, and the resulting txid/hash. Final output is the proof artifact JSON and verification result.

### 4. Proof Verifier

**File:** `verify.py`

Standalone script that takes a proof artifact JSON file and verifies it.

```bash
python verify.py proof-ALT-78432.json --wallet-url http://localhost:3321
```

**Verification steps:**

1. Load proof artifact from JSON file
2. Connect to BRC-100 wallet
3. Verify chain integrity: re-hash each `chain_hashes[i]` against `chain_hashes[i-1]` — must produce `chain_hashes[i+1]`
4. Verify Merkle root matches final chain hash
5. Verify on-chain anchors exist: `envelope_open_txid` and `envelope_seal_txid` via `listOutputs`
6. Verify agent identity proof: `agid_zkproof_verify(proof.agent_identity_proof)`
7. Verify timestamps: seal timestamp > open timestamp, both match on-chain block times
8. Verify procedure hash: hash of policy steps matches `procedure_hash` in artifact
9. Print results: each check as pass/fail, final verdict

**Output:**
```
Verifying proof-ALT-78432.json...
  ✓ Chain integrity: 6/6 hashes valid
  ✓ Merkle root: matches sealed commitment
  ✓ On-chain anchor (open): txid abc123 at block 850,141
  ✓ On-chain anchor (seal): txid fed987 at block 850,142
  ✓ Agent authorization: ZK proof valid
  ✓ Procedure compliance: hash matches standard policy v2.1
  ✓ Temporal ordering: all timestamps sequential

  Content revealed: NONE

VERDICT: Investigation is cryptographically proven valid.
```

## Dependencies

| Package | Purpose |
|---|---|
| `pydantic-ai` | Agent framework |
| `fastmcp` | SentinelOne mock MCP server |
| `httpx` | HTTP client (for verification against BRC-100 wallet) |

AGiD MCP server and BRC-100 wallet are external services, not Python dependencies.

## File Structure

```
/Users/donot/AGiD/agid-s1-demo/
├── demo.py                     # Main CLI — Pydantic AI agent orchestration
├── s1_mock_server.py           # SentinelOne mock MCP server (FastMCP, 10 tools)
├── s1_data.py                  # Seeded dataset (hosts, alerts, events, IOCs, policy)
├── verify.py                   # Standalone proof verifier
├── requirements.txt            # pydantic-ai, fastmcp, httpx
└── README.md                   # 3-command setup instructions
```

The `proof-of-work` skill is not a file in this repo. It is created via `agid_create_skill` and stored on-chain in the AGiD skill store. The demo script can create it on first run if it doesn't exist.

## What This Package Does NOT Do

- **No real SentinelOne API access.** The mock returns hardcoded data. SentinelOne swaps in their real API later — zero code changes on the agent or AGiD side.
- **No frontend/UI.** Terminal output only.
- **No MPC setup.** Demo works with `bsv-wallet-cli` (single key). MPC cosigning is an optional enhancement if `mpc-backend` is running.
- **No persistent state between runs.** Each run is a fresh investigation. On-chain data persists on the blockchain.

## Success Criteria

The demo is successful when:

1. The agent completes a 6-step investigation using SentinelOne data
2. Every step is committed to a hash chain using AGiD ZK tools
3. A proof artifact is produced containing zero investigation content
4. The verifier confirms the proof is valid using only hashes and on-chain anchors
5. The entire flow runs in under 60 seconds
6. A non-technical viewer understands: "The AI proved it did the right thing without showing what it found"
