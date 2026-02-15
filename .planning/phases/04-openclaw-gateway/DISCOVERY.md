# Phase 4 Discovery: OpenClaw Gateway

**Date:** 2026-02-14
**Level:** 3 (Deep Dive)

## Research Summary

### What is OpenClaw?

OpenClaw (formerly Clawdbot/Moltbot) is a free and open-source autonomous AI agent developed by Peter Steinberger. It uses large language models and messaging platforms as its interface.

**Source:** [OpenClaw Wikipedia](https://en.wikipedia.org/wiki/OpenClaw), [DigitalOcean Guide](https://www.digitalocean.com/resources/articles/what-is-openclaw)

### Gateway Architecture

OpenClaw uses a **WebSocket control plane** operating at `ws://127.0.0.1:18789`:

- Single WebSocket server per host (Node.js 22+)
- Hub-and-spoke architecture connecting CLI, web UI, apps, and channels
- JSON frames validated against TypeBox schemas
- Event-driven, not poll-based

**Protocol Format:**
- Requests: `{type:"req", id, method, params}`
- Responses: `{type:"res", id, ok, payload|error}`
- Events: `{type:"event", event, payload, seq?, stateVersion?}`

**Source:** [Gateway Protocol Docs](https://docs.openclaw.ai/gateway/protocol), [Architecture Overview](https://ppaolo.substack.com/p/openclaw-system-architecture-overview)

### Message Flow (Channels → AI)

1. **Ingestion:** Channel adapters normalize messages
2. **Access Control:** Allowlists and pairing status checked
3. **Context Assembly:** Session history, system prompt, skills, memory search
4. **Model Invocation:** Stream to LLM provider
5. **Tool Execution:** Commands run on host or in Docker sandbox
6. **Response Delivery:** Formatted chunks back to user, session persisted

### Extension Points

OpenClaw extends via:
1. **Channel plugins** in `extensions/` directory
2. **Skill definitions** in `skills/<skill>/SKILL.md`
3. **Tool registration** via `api.registerTool()`
4. **Trusted proxy headers** for authenticated identity

**No formal plugin SDK exists.** Extension occurs through configuration, skill registration, and channel adapter development.

### Authentication Options

1. **Token-based:** `gateway.auth.mode: "token"`, `OPENCLAW_GATEWAY_TOKEN`
2. **Password-based:** `OPENCLAW_GATEWAY_PASSWORD`
3. **Trusted proxy headers:** For reverse-proxy scenarios with identity-aware proxies
4. **Tailscale identity:** `tailscale-user-login` headers accepted when `allowTailscale: true`

**Source:** [Security Docs](https://docs.openclaw.ai/gateway/security)

### Security Considerations (CVE-2026-25253)

A high-severity vulnerability enabling one-click RCE through WebSocket token hijacking was patched on January 30, 2026. Over 1,800 exposed instances were found leaking credentials.

**Implication:** Our gateway wrapping approach is actually MORE secure than running OpenClaw directly exposed.

## Architecture Decision

### Original Assumption (WRONG)
The speculative types in `src/types/openclaw-plugin.ts` assumed an OpenClaw plugin SDK where we register tools and hooks. This doesn't exist.

### Reality
OpenClaw is a standalone WebSocket server. To integrate:
1. AGIdentity Gateway acts as a **channel adapter** (like WhatsApp/Telegram adapters)
2. We connect to OpenClaw's Gateway WebSocket as a client
3. MessageBox messages flow: `MessageBox → AGIdentity Gateway → Identity Verify → OpenClaw WS → Response → MPC Sign → MessageBox`

### Recommended Approach

```
┌──────────────────────────────────────────────────────────────┐
│                    AGIdentity Gateway                         │
│                                                               │
│  ┌───────────────┐    ┌──────────────┐    ┌───────────────┐  │
│  │ MessageBox    │───►│ Identity     │───►│ OpenClaw      │  │
│  │ Gateway       │    │ Gate         │    │ WS Client     │  │
│  │ (existing)    │◄───│ (existing)   │◄───│ (new)         │  │
│  └───────────────┘    └──────────────┘    └───────────────┘  │
│         │                    │                    │           │
│         │                    │                    │           │
│         ▼                    ▼                    ▼           │
│  ┌───────────────┐    ┌──────────────┐    ┌───────────────┐  │
│  │ MPC Wallet    │    │ Audit Trail  │    │ OpenClaw      │  │
│  │ (sign resp)   │    │ (signed)     │    │ Gateway       │  │
│  │               │    │              │    │ (ws:18789)    │  │
│  └───────────────┘    └──────────────┘    └───────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

## Work Items

### Must Do
1. **Remove speculative plugin code** - `src/plugin/`, `src/types/openclaw-plugin.ts`
2. **Create OpenClaw WebSocket client** - Connect, authenticate, send messages, handle events
3. **Create AGIdentityOpenClawGateway** - Bridge MessageBox → OpenClaw with identity verification
4. **Sign responses with MPC wallet** - Every AI response gets signed before delivery
5. **Inject identity context** - Include verified sender info in OpenClaw session

### Won't Do (Scope Control)
- Full channel adapter implementation (we're a proxy, not a channel)
- OpenClaw configuration management (user configures OpenClaw separately)
- OpenClaw lifecycle management (user starts/stops OpenClaw separately)

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| OpenClaw protocol changes | Medium | High | Version pin, schema validation |
| WebSocket connection failures | Medium | Medium | Reconnection with backoff |
| Auth token exposure | Low | High | Token never logged, env-only storage |
| Context injection overhead | Medium | Low | Lazy context assembly, caching |

## Environment Variables (New)

- `OPENCLAW_GATEWAY_URL` - WebSocket URL (default: `ws://127.0.0.1:18789`)
- `OPENCLAW_GATEWAY_TOKEN` - Authentication token for OpenClaw
- `OPENCLAW_SESSION_SCOPE` - Session isolation strategy (default: `per-sender`)

---

*Discovery completed: 2026-02-14*
