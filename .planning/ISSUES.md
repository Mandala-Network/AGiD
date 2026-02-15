# Project Issues Log

Enhancements discovered during execution. Not critical - address in future phases.

## Open Enhancements

[No open enhancements]

## Closed Enhancements

### ISS-001: Add creation timestamp to memory PushDrop tokens for age-based GC ✅

- **Discovered:** Phase 7 Task 2 (2026-02-15)
- **Type:** Enhancement / GC functionality
- **Description:** Initially identified need for timestamp field in PushDrop tokens. Resolved by using TAAL ARC API to fetch block timestamps instead.
- **Resolution:** Updated listMemories and applyGarbageCollection to use ARC API (`/tx/{txid}`) for block timestamps. No token format change needed.
- **Resolved:** Phase 7 Task 2 (2026-02-15)
- **Impact:** Full age-based GC enforcement now working with existing token format
