# Project Issues Log

Enhancements discovered during execution. Not critical - address in future phases.

## Open Enhancements

### ISS-001: Add creation timestamp to memory PushDrop tokens for age-based GC

- **Discovered:** Phase 7 Task 2 (2026-02-15)
- **Type:** Enhancement / GC functionality
- **Description:** Currently, memory PushDrop tokens store [uhrpUrl, tags, importance] in 3 fields, but lack a creation timestamp. This prevents garbage collection from enforcing age-based retention policies (high=3yr, medium=1yr, low=90d). Adding timestamp as a 4th field would enable automatic cleanup of old memories.
- **Impact:** Medium (GC framework exists but can't enforce time policies without timestamps)
- **Effort:** Medium (requires updating storeMemory to add 4th field, listMemories to parse it, and GC to use it)
- **Suggested phase:** Phase 8 or 9 (after tool registry, before production use)

## Closed Enhancements

[Moved here when addressed]
