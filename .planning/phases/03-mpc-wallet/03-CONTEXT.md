# Phase 3: MPC Wallet - Context

**Gathered:** 2026-02-14
**Status:** Ready for research

<vision>
## How This Should Work

AGIdentity owns and manages an MPCWallet from wallet-toolbox. The AI has its own key slice built into the package, and coordinates with external cosigner servers for signing ceremonies. No single party ever has access to the full private key.

From the AI's perspective, it's just a wallet — call sign(), get a signature back. The MPC complexity is completely abstracted. But under the hood, every signature involves a multi-party computation protocol with the cosigner servers.

The existing mpc-test-app backend already spins up cosigner servers and a working wallet when you run `npm run dev`. AGIdentity connects to that infrastructure, giving us a full working demo of the end-to-end system.

Wherever AGIdentity currently uses a wallet (Certificate Authority, MessageBox signing, audit entries), swap in MPCWallet. Same BRC-100 interface, MPC implementation underneath.

</vision>

<essential>
## What Must Be Nailed

- **Full wallet operations** — AI can sign AND create transactions, manage UTXOs, pay for services. Not just signing, a complete BRC-100 wallet.
- **AGIdentity owns the wallet** — The MPCWallet instance is created and managed by AGIdentity, not connecting to an external wallet service.
- **Works with existing infrastructure** — Integrates with mpc-test-app backend's cosigner servers for a full working demo.

</essential>

<boundaries>
## What's Out of Scope

- Running cosigner servers — cosigners are external infrastructure (mpc-test-app backend handles this)
- Key backup/recovery — disaster recovery, key rotation, share resharing are future work
- Building MPC protocol — wallet-toolbox already has MPCWallet, MPCClient, MPCKeyDeriver, MPCPersistence

</boundaries>

<specifics>
## Specific Ideas

- Swap in MPCWallet wherever AGIdentity uses a wallet today — same interface, MPC implementation
- Use wallet-toolbox's existing MPC infrastructure: `@bsv/wallet-toolbox/out/src/mpc`
- Connect to cosigner endpoints via HTTP (MPCClient handles the protocol)
- Demo should show: Certificate Authority signing, MessageBox message signing, audit entries — all backed by MPC

</specifics>

<notes>
## Additional Context

The MPC wallet implementation already exists in MPC-DEV/mpc-test-app:
- `MPCWallet.create()` handles 5-round DKG automatically
- `MPCClient` communicates with cosigner servers via HTTP + JWT auth
- `MPCKeyDeriver` handles BRC-42/43 key derivation compatible with MPC
- `MPCPersistence` stores encrypted shares and derivations
- Cosigner servers are Express HTTP servers that participate in MPC protocols

This is an integration phase — the hard MPC work is done. Phase 3 wires AGIdentity to use it.

</notes>

---

*Phase: 03-mpc-wallet*
*Context gathered: 2026-02-14*
