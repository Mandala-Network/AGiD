# AGiD OpenClaw Plugin — Setup Guide

This guide walks you through installing and configuring the AGiD plugin for
OpenClaw. By the end, your OpenClaw assistant will have a BSV blockchain
wallet, encrypted messaging, on-chain memory, cryptographic identity, and
audit capabilities.

No blockchain experience is required.

## What You Get

The plugin adds 38 tools to your OpenClaw assistant, organized into 6 groups:

| Group | What it does | Example tools |
|-------|-------------|---------------|
| **Identity** | Your agent gets a unique cryptographic identity on the BSV blockchain. It can look up other identities, issue and verify certificates, and generate zero-knowledge proofs. | `agid_identity`, `agid_cert_issue`, `agid_zkproof_privilege` |
| **Crypto** | Sign messages, encrypt and decrypt data. Prove authorship of anything your agent produces. | `agid_sign`, `agid_encrypt`, `agid_decrypt` |
| **Wallet** | Send and receive BSV payments, create on-chain tokens, manage transaction outputs. | `agid_send_payment`, `agid_token_create`, `agid_list_outputs` |
| **Messaging** | Send and receive end-to-end encrypted messages through a relay server. The relay never sees plaintext. | `agid_message_send`, `agid_message_list` |
| **Memory** | Store memories on the blockchain with encryption. Recall them later, filtered by tags. Every memory has provenance — you can prove when it was stored and that it hasn't been tampered with. | `agid_store_memory`, `agid_recall_memories` |
| **Audit** | Verify that workspace files and session transcripts haven't been altered since they were anchored on-chain. | `agid_verify_workspace`, `agid_verify_session` |

## Prerequisites

- **OpenClaw** installed and working ([openclaw.ai](https://openclaw.ai))
- **Node.js 22 or later** (check with `node --version`)

That's it. You do not need a BSV wallet, blockchain node, or any cryptocurrency
to get started. The plugin creates a local wallet automatically on first use.

## Step 1: Install the Plugin

```bash
openclaw plugin install @agid/openclaw-plugin
```

This downloads the plugin and registers it with OpenClaw. No tools are active
yet — the plugin waits until you configure it.

## Step 2: Choose Your Network

AGiD operates on the BSV blockchain. You must choose which network to use:

| Network | When to use | Real money? |
|---------|------------|-------------|
| `testnet` | Learning, development, testing | No — testnet coins are free |
| `mainnet` | Production use, real identity, real payments | Yes — transactions cost real satoshis |

**If this is your first time, use testnet.**

```bash
openclaw config set agid.network testnet
```

This is the only required configuration. Everything else has sensible defaults.

> If you skip this step, OpenClaw will prompt you to choose a network the first
> time a tool is used. You can also set it later by running the command above.

## Step 3: Start Using It

Restart OpenClaw (or start a new conversation) and the plugin will load
automatically. The first time a tool that needs a wallet is called, the plugin
will:

1. Create a local SQLite database at `~/.agid/wallet.sqlite`
2. Generate a new cryptographic key pair
3. Persist the keys in the database

This happens once. On subsequent runs, the existing wallet is loaded from disk.

Try it out:

```
You: What is my agent identity?
```

Your assistant will call `agid_identity` and return your agent's public key and
network. This public key is your agent's unique identifier on the blockchain.

### More things to try

```
You: Sign the message "hello world" to prove you wrote it.
```

```
You: Encrypt the text "secret plans" and then decrypt it back.
```

```
You: Store a memory that today's meeting discussed the Q3 roadmap.
```

```
You: Recall all my stored memories.
```

## Configuration Reference

All configuration is set through `openclaw config set agid.<key> <value>`.

### Required

| Key | Values | Description |
|-----|--------|-------------|
| `network` | `mainnet` or `testnet` | Which BSV network to use. Determines whether transactions involve real money. |

### Optional

These all have defaults. You only need to change them if you have a specific
reason to.

| Key | Default | Description |
|-----|---------|-------------|
| `storage` | `local` | Wallet storage mode. `local` uses a SQLite file on your machine. `cloud` uses a remote storage service. |
| `storagePath` | `~/.agid/wallet.sqlite` | Where to store the wallet database. Use an absolute path. The `~` character expands to your home directory. |
| `messageboxHost` | `https://messagebox.babbage.systems` | The MessageBox relay server for encrypted messaging. You only need to change this if you run your own relay. |
| `uhrpStorageUrl` | `https://nanostore.babbage.systems` | The UHRP storage endpoint for uploading encrypted memory content to the blockchain. |
| `walletClientUrl` | `http://localhost:3301` | URL for an external wallet client. Used by tools that request the *user's* wallet to perform cryptographic operations (not the agent's wallet). |
| `trustedCertifiers` | `[]` (empty) | Comma-separated list of public keys. Only certificates issued by these keys will be trusted. Leave empty to trust all. |
| `requireCerts` | `false` | If `true`, the agent will reject messages from senders who don't have a trusted certificate. |

### Example: Full configuration

```bash
# Required
openclaw config set agid.network mainnet

# Optional — customize storage location
openclaw config set agid.storagePath /secure/vault/agid-wallet.sqlite

# Optional — use your own MessageBox relay
openclaw config set agid.messageboxHost https://messagebox.mycompany.com

# Optional — only trust certificates from your organization
openclaw config set agid.trustedCertifiers "02abc123def456,03xyz789ghi012"
```

## Wallet and Key Management

### Where are my keys?

Your agent's private keys are stored in the SQLite database at the path
specified by `storagePath` (default: `~/.agid/wallet.sqlite`). This file
contains everything needed to control your agent's identity and funds.

### Backing up your wallet

Copy the SQLite file to a secure location:

```bash
cp ~/.agid/wallet.sqlite /path/to/backup/agid-wallet-backup.sqlite
```

### Restoring from backup

Replace the wallet file and restart OpenClaw:

```bash
cp /path/to/backup/agid-wallet-backup.sqlite ~/.agid/wallet.sqlite
```

Your agent will resume with the same identity and balance.

### Moving to a new machine

1. Copy `~/.agid/wallet.sqlite` to the new machine
2. Install OpenClaw and the AGiD plugin
3. Set the same `agid.network` configuration
4. Your agent's identity, balance, and certificates transfer automatically

### Important security notes

- **Do not share your wallet file.** Anyone with this file can control your
  agent's identity and spend its funds.
- **Do not commit the wallet file to git.** Add `*.sqlite` to your `.gitignore`.
- **Use a secure storage path on production systems.** Consider full-disk
  encryption or a dedicated encrypted volume.

## Testnet vs Mainnet

### Testnet (recommended for getting started)

- Free to use — testnet coins have no monetary value
- Same functionality as mainnet
- Good for learning, development, and testing
- Transactions may be cleared periodically

### Switching to mainnet

When you're ready to use real blockchain transactions:

```bash
openclaw config set agid.network mainnet
```

**This creates a new wallet.** Your testnet wallet and mainnet wallet are
separate. Testnet keys cannot be used on mainnet and vice versa.

On mainnet, your agent will need satoshis to perform on-chain operations like
storing memories, creating tokens, or anchoring audit proofs. You can fund your
agent's wallet by sending BSV to its address (use `agid_identity` to find the
agent's public key).

## Tool Reference

### Identity (18 tools)

| Tool | Description |
|------|-------------|
| `agid_identity` | Get your agent's public key, network, and status |
| `agid_balance` | Check wallet balance in satoshis |
| `agid_get_public_key` | Derive a protocol-specific key |
| `agid_get_height` | Get current blockchain block height |
| `agid_lookup_identity` | Look up a person by name, email, or phone on the identity network |
| `agid_cert_issue` | Issue an identity certificate to another public key |
| `agid_cert_receive` | Receive and store incoming certificates |
| `agid_cert_list` | List certificates in your wallet |
| `agid_cert_verify` | Verify a certificate cryptographically |
| `agid_cert_revoke` | Revoke a certificate on-chain (irreversible) |
| `agid_cert_reveal` | Publicly reveal selected certificate fields |
| `agid_cert_check_revocation` | Check if a certificate has been revoked |
| `agid_cert_send` | Send a certificate to another identity |
| `agid_zkproof_privilege` | Prove privileged communication without revealing content |
| `agid_zkproof_verify` | Verify a zero-knowledge proof |
| `agid_zkproof_selective_reveal` | Reveal one session's key without exposing others |
| `agid_zkproof_commitment` | Create a tamper-evident content commitment on-chain |
| `agid_zkproof_verify_commitment` | Verify content matches a previous commitment |

### Crypto (5 tools)

| Tool | Description |
|------|-------------|
| `agid_sign` | Sign a message to prove your agent created it |
| `agid_encrypt` | Encrypt data for secure storage or communication |
| `agid_decrypt` | Decrypt previously encrypted data |
| `agid_wallet_client_request` | Request the user's wallet to perform a cryptographic operation |
| `agid_request_user_signature` | Request the user to sign data with their own wallet |

### Wallet (7 tools)

| Tool | Description |
|------|-------------|
| `agid_create_action` | Create a BSV transaction |
| `agid_internalize_action` | Accept an incoming transaction |
| `agid_list_outputs` | List wallet outputs (UTXOs) |
| `agid_send_payment` | Send a BSV payment to another identity |
| `agid_token_create` | Create an on-chain token with data fields |
| `agid_token_list` | List tokens from a wallet basket |
| `agid_token_redeem` | Redeem a token to reclaim its satoshis |

### Messaging (5 tools)

| Tool | Description |
|------|-------------|
| `agid_message_send` | Send an encrypted message via MessageBox |
| `agid_message_list` | List messages (auto-decrypted) |
| `agid_message_ack` | Acknowledge processed messages |
| `agid_list_payments` | List pending incoming payments |
| `agid_accept_payment` | Accept an incoming payment |

### Memory (2 tools)

| Tool | Description |
|------|-------------|
| `agid_store_memory` | Encrypt and store a memory on the blockchain |
| `agid_recall_memories` | Recall memories, filtered by tags |

### Audit (2 tools)

| Tool | Description |
|------|-------------|
| `agid_verify_workspace` | Verify workspace files against their on-chain anchor |
| `agid_verify_session` | Verify a session transcript's anchor chain integrity |

## Troubleshooting

### "AGiD requires 'network' to be set"

You haven't configured the network yet. Run:

```bash
openclaw config set agid.network testnet
```

### Plugin loads but no tools appear

Restart OpenClaw after installing the plugin. The plugin registers tools during
startup — if OpenClaw was already running when you installed it, the tools
won't be available until the next restart.

### "Wallet not available" errors

This means a tool that needs the wallet was called before the wallet finished
initializing. This can happen if:

- The `storagePath` directory doesn't exist or isn't writable
- The SQLite file is corrupted or locked by another process

Check that the directory exists:

```bash
mkdir -p ~/.agid
```

If the wallet file is corrupted, delete it and let the plugin create a new one:

```bash
rm ~/.agid/wallet.sqlite
```

Note: this creates a new identity. Your old identity and any funds associated
with it will be lost unless you have a backup.

### "MemoryManager not configured" errors

This should not happen in normal operation. If you see this error, it means the
plugin's internal wiring failed. File an issue at
[github.com/Mandala-Network/AGiD/issues](https://github.com/Mandala-Network/AGiD/issues)
with the full error message.

### Encrypted messages aren't being delivered

Check that the MessageBox host is reachable:

```bash
curl https://messagebox.babbage.systems
```

If you're using a custom MessageBox host, verify the URL is correct:

```bash
openclaw config set agid.messageboxHost https://your-messagebox-host.com
```

## Uninstalling

```bash
openclaw plugin uninstall @agid/openclaw-plugin
```

This removes the plugin but does **not** delete your wallet file. To fully
remove all AGiD data:

```bash
rm -rf ~/.agid
```

## Further Reading

- [AGiD README](https://github.com/Mandala-Network/AGiD) — Full documentation
  for the standalone AGiD runtime
- [BSV blockchain](https://bsvblockchain.org) — Learn about the blockchain
  AGiD uses
- [BRC standards](https://bsv.brc.dev) — Technical standards for BSV
  wallet operations, certificates, and key derivation
