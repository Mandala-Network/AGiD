# AGIdentity Source Code Architecture

**Clear layered structure with dependency ordering**

---

## 📊 Folder Structure

```
src/
├── 01-core/              # Core infrastructure (wallet, identity, config)
├── 02-storage/           # Storage backends (vault, uhrp, memory)
├── 03-gateway/           # AGIdentity Gateway (main system)
├── integrations/         # External services (openclaw, shad)
├── 05-interfaces/        # External access (HTTP, CLI, SDK)
├── 06-tools/             # ⭐ OpenClaw AI Tools (AI-callable)
├── 07-shared/            # Shared utilities (types, audit)
│
├── __tests__/            # Test files
├── index.ts              # Main module export
└── start.ts              # Gateway startup script
```

**Numbers indicate dependency order:** Layer 01 has no deps, Layer 02 depends on 01, etc.

---

## 🎯 What's What

### ⭐ OpenClaw Tools (What AI Can Call)

**Only in:** `06-tools/`

```typescript
// These ARE tools - AI calls them:
- agid_sign          → Sign with MPC wallet
- agid_encrypt       → Encrypt data
- agid_balance       → Check wallet
- agid_store_memory  → Save to memory
```

**Everything else is infrastructure, not tools!**

---

### 🏗️ Infrastructure (Background Systems)

**Layers 01-05:**

```
01-core/          → Wallet, identity, config
02-storage/       → Data persistence
03-gateway/       → Main system (wraps OpenClaw)
integrations/     → External service connectors
05-interfaces/    → HTTP/CLI/SDK access
```

**Not callable by AI - they run in background**

---

### 🔗 Helper Code

**Layer 07:**

```
07-shared/        → Types, utilities, audit
```

**Not tools - used internally**

---

## 📋 Quick Reference

| Layer | Purpose | Contains | Is Tool? |
|-------|---------|----------|----------|
| 01-core | Foundation | wallet, identity, config | ❌ NO |
| 02-storage | Data | vault, uhrp, memory | ❌ NO |
| 03-gateway | Main system | gateway, messaging, auth | ❌ NO |
| integrations | External | openclaw, shad, team | ❌ NO |
| 05-interfaces | Access | server, cli, client | ❌ NO |
| **06-tools** | **AI Tools** | **wallet-tools, memory-tools** | **✅ YES** |
| 07-shared | Utilities | types, audit | ❌ NO |

---

## 🎓 Dependency Rules

**Allowed dependencies (top-down only):**

```
07-shared → (no dependencies)
    ↓
01-core → 07-shared
    ↓
02-storage → 01-core, 07-shared
    ↓
03-gateway → 01-core, 02-storage, 07-shared
    ↓
integrations → 01-core, 02-storage, 07-shared
    ↓
05-interfaces → 01-core, 02-storage, 03-gateway, 07-shared
    ↓
06-tools → Everything (tools use all infrastructure)
```

**Never:** Lower layers depending on higher layers

---

## 🎯 Finding Things

**"Where is X?"**

| Looking for | Check folder |
|-------------|--------------|
| MPC wallet code | 01-core/wallet/ |
| Identity verification | 01-core/identity/ |
| Storage interface | 02-storage/vault/ |
| Blockchain storage | 02-storage/uhrp/ |
| Memory system | 02-storage/memory/ |
| Main gateway | 03-gateway/gateway/ |
| MessageBox integration | 03-gateway/messaging/ |
| Encryption helpers | 03-gateway/encryption/ |
| OpenClaw client | integrations/openclaw/ |
| Shad integration | integrations/shad/ |
| HTTP API | 05-interfaces/server/ |
| CLI tool | 05-interfaces/cli/ |
| **OpenClaw tools** | **06-tools/tools/** |
| Type definitions | 07-shared/types/ |
| Audit logging | 07-shared/audit/ |

---

## ⭐ Key Insight

**OpenClaw Tool = Only things in `06-tools/`**

Everything else is either:
- Infrastructure (provides services)
- Storage (persists data)
- Integration (connects to external services)
- Interface (how to access AGIdentity)
- Utility (helper code)

**The AI only calls tools. Tools use everything else.**

---

## 📖 Layer Documentation

Each folder has its own README.md:
- `01-core/README.md`
- `02-storage/README.md`
- `03-gateway/README.md`
- `integrations/README.md`
- `05-interfaces/README.md`
- `06-tools/README.md`
- `07-shared/README.md`

**Read these for details on each layer.**

---

**Structure is now intuitive: Numbers show dependencies, names show purpose!**
