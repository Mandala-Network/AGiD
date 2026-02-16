# 07-shared: Shared Utilities

**Purpose:** Code used across multiple layers (no dependencies on other layers)

## Folders

### `types/`
**What:** TypeScript type definitions
**Is Tool:** ❌ NO - Type system only
**Contains:**
- BRC-100 wallet interfaces
- Certificate types
- Message types
- Memory types
- All shared type definitions

**Used By:** Everything

### `audit/`
**What:** Signed audit trail
**Is Tool:** ❌ NO - Background logging
**Purpose:** Enterprise compliance, immutable audit log
**Features:**
- Signs all agent interactions
- Blockchain-backed audit trail
- Compliance reporting

**Used By:** Gateway, tools (for logging)

---

## Dependency Rules

**Shared code should:**
- ✅ Have NO dependencies on other src/ folders
- ✅ Be pure utilities/types
- ✅ Be usable by any layer

**Shared code should NOT:**
- ❌ Import from 01-core, 02-storage, etc.
- ❌ Have business logic
- ❌ Be stateful

**These are the FOUNDATION** that everything else builds on.

---

**Key Point:** If you need it everywhere and it has no dependencies, it goes here.
