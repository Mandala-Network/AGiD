---
phase: 7-memory-write-path
plan: 02
subsystem: memory
tags: [pushdrop, uhrp, basket-query, garbage-collection, lifecycle]

# Dependency graph
requires:
  - phase: 7-01-memory-write
    provides: storeMemory with PushDrop tokenization, basket storage
provides:
  - listMemories function with basket query and UHRP download
  - applyGarbageCollection with importance-based retention policy framework
  - Complete memory lifecycle (write, read, cleanup)
affects: [8-tool-registry]

# Tech tracking
tech-stack:
  added: []
  patterns: ['Basket query for owned tokens', 'PushDrop.decode for field extraction', 'StorageDownloader for UHRP retrieval', 'GC retention policies']

key-files:
  created: ['src/memory/memory-reader.ts', 'src/memory/memory-gc.ts', '.planning/ISSUES.md']
  modified: ['src/memory/index.ts']

key-decisions:
  - "Use PushDrop.decode() static method to extract token fields"
  - "StorageDownloader class for UHRP downloads (not function)"
  - "GC queries basket with include: 'locking scripts' for field access"
  - "ISS-001: Timestamp enhancement deferred (need 4th PushDrop field)"

patterns-established:
  - "Basket query pattern: listOutputs({ basket, tags, include, spendable })"
  - "Field extraction: PushDrop.decode(LockingScript.fromHex(script))"
  - "UHRP download: new StorageDownloader({ networkPreset }).download(url)"

issues-created: [ISS-001]

# Metrics
duration: 3m 33s
completed: 2026-02-15
---

# Phase 7 Plan 2: Memory Retrieval & Lifecycle Summary

**Agent can list/search owned memories from basket with UHRP download and GC retention policy framework (timestamp enhancement deferred to ISS-001)**

## Performance

- **Duration:** 3m 33s
- **Started:** 2026-02-15T21:54:27Z
- **Completed:** 2026-02-15T21:58:00Z
- **Tasks:** 2/2
- **Files modified:** 4

## Accomplishments

- Implemented listMemories with basket query, PushDrop field extraction, and UHRP download
- Agent can retrieve and decrypt owned memories from 'agent-memories' basket
- Implemented GC framework with importance-based retention policies (high=3yr, medium=1yr, low=90d)
- Phase 7 complete: autonomous memory write/read/lifecycle management
- Logged ISS-001 for timestamp enhancement to enable age-based GC enforcement

## Task Commits

Each task was committed atomically:

1. **Task 1: Implement listMemories** - `de47310` (feat)
2. **Task 2: Implement garbage collection** - `05b0fb1` (feat)

## Files Created/Modified

- `src/memory/memory-reader.ts` - listMemories function with basket query and UHRP retrieval
- `src/memory/memory-gc.ts` - applyGarbageCollection function with retention policies
- `src/memory/index.ts` - Updated exports for reader and GC
- `.planning/ISSUES.md` - Created with ISS-001 for timestamp enhancement

## Decisions Made

**API adaptation for BSV SDK 2.0.3:**
- Used `PushDrop.decode(LockingScript.fromHex(script), 'before')` static method instead of `fromScript()`
- Used `StorageDownloader` class with `download()` method instead of function-style `storageDownloader()`
- Used `wallet.listOutputs()` with `tags` parameter instead of `labels`
- Rationale: Actual BSV SDK API differs from RESEARCH.md pseudocode

**GC timestamp deferral:**
- Deferred age-based GC enforcement to future enhancement (ISS-001)
- GC framework implemented with retention policies, but can't enforce without timestamps
- Requires adding 4th field to PushDrop tokens in storeMemory
- Rationale: Proper solution needs backwards-incompatible change to token structure

## Deviations from Plan

### Auto-fixed Issues

**None** - Plan executed as specified with documented limitations.

### Deferred Enhancements

Logged to .planning/ISSUES.md for future consideration:

- **ISS-001:** Add creation timestamp to memory PushDrop tokens for age-based GC
  - Discovered in Task 2 (GC implementation)
  - Current tokens lack timestamp field needed to calculate age
  - Enhancement: Add 4th field to PushDrop tokens for creation timestamp
  - Enables proper enforcement of retention policies
  - Effort: Medium (update storeMemory, listMemories, and GC)
  - Suggested for Phase 8 or 9

---

**Total deviations:** 0 auto-fixed, 1 deferred enhancement
**Impact on plan:** GC framework complete and functional, timestamp-based enforcement deferred as documented enhancement. No scope creep.

## Issues Encountered

None - plan executed smoothly with proper API adaptation

## Next Phase Readiness

**Phase 7 complete!** Agent can now:
- ✅ Write memories with PushDrop ownership proof (7-01)
- ✅ List/search memories from wallet basket with UHRP download (7-02)
- ✅ GC framework with retention policies (7-02)
- ⏳ Age-based GC enforcement pending ISS-001 (timestamp field)

**Ready for Phase 8 (Tool Registry):**
- Memory write/read/GC functions ready to expose as callable tools
- OpenClaw agent can use storeMemory and listMemories for autonomous memory
- GC can be scheduled periodically (returns kept/spent stats even without age enforcement)

**Prerequisites addressed:**
- ✅ Basket query pattern established for token retrieval
- ✅ PushDrop.decode() for field extraction
- ✅ StorageDownloader for UHRP operations
- ✅ Proper API adaptation to BSV SDK 2.0.3

---
*Phase: 7-memory-write-path*
*Completed: 2026-02-15*
