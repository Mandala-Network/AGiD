# Codebase Concerns

**Analysis Date:** 2026-02-14

## Tech Debt

**Stub Implementations (Production Blockers):**
- Issue: LocalCertificateIssuer uses local wallet instead of MPC for certificate signing
- Files: `src/identity/identity-gate.ts` (lines 96-164)
- Why: Development convenience - production requires threshold cryptography
- Impact: Cannot deploy with real certificates - single party can forge certs
- Fix approach: Implement MPC wallet integration or use external certificate authority

**Stub Revocation Checker:**
- Issue: LocalRevocationChecker maintains in-memory revocation list only
- Files: `src/identity/identity-gate.ts` (lines 177-209)
- Why: Overlay service integration not implemented
- Impact: Cannot detect real-time certificate revocation on-chain
- Fix approach: Implement overlay-based revocation lookup

**Missing Blockchain Query:**
- Issue: `queryTimestampTransaction()` returns null stub
- Files: `src/uhrp/storage-manager.ts` (line 362)
- Why: Blockchain indexer integration pending
- Impact: Cannot verify document timestamps exist on-chain
- Fix approach: Integrate with blockchain indexer service

## Known Bugs

**Silent CurvePoint Failures:**
- Symptoms: New team members cannot decrypt documents after being added
- Trigger: CurvePoint participant addition fails silently
- Files: `src/team/team-vault.ts` (lines 752-758, 787-793), `src/team/secure-team-vault.ts` (lines 843-851, 874-882)
- Workaround: None - state becomes inconsistent
- Root cause: Empty catch blocks with console.warn only
- Fix: Add retry mechanism, proper error propagation, or transaction rollback

**Potential Double-Resolve in Shad:**
- Symptoms: Promise resolves twice in edge cases
- Trigger: Process closes immediately before timeout handler executes
- Files: `src/shad/shad-integration.ts` (lines 356-360)
- Workaround: Usually doesn't cause issues in practice
- Root cause: Race between close event and timeout
- Fix: Use resolved flag or AbortController pattern

## Security Considerations

**Unsigned Audit Trail Entries:**
- Risk: Audit logs cannot prove who made changes
- Files: `src/team/team-vault.ts` (line 722), `src/team/secure-team-vault.ts` (line 898)
- Current mitigation: None - signature field is empty string
- Recommendations: Implement audit entry signing, required for HIPAA/SOC2 compliance

**Hash Truncation Vulnerability:**
- Risk: Content hash truncated to 64 bits instead of 256 bits
- Files: `src/vault/local-encrypted-vault.ts` (line 479)
- Current mitigation: None
- Recommendations: Use full SHA-256 hash (2^256 vs 2^64 collision resistance)

**Unvalidated Shad Server Access:**
- Risk: Anyone knowing temp server port can read all decrypted documents
- Files: `src/shad/shad-integration.ts` (lines 251-278)
- Current mitigation: Random port, localhost only
- Recommendations: Add request origin verification, API key, or Unix socket

**Unvalidated Python Path:**
- Risk: SHAD_PYTHON_PATH could execute arbitrary code
- Files: `src/shad/shad-integration.ts` (lines 318-348)
- Current mitigation: None
- Recommendations: Validate against whitelist or use absolute paths only

## Performance Bottlenecks

**Unbounded Memory Cache:**
- Problem: Document cache has no eviction policy
- Files: `src/vault/local-encrypted-vault.ts` (lines 79-80)
- Measurement: With autoWarmup=true and 10GB vault, loads all to memory
- Cause: Map with no TTL, LRU, or size limits
- Improvement path: Add cache eviction (LRU with max size or TTL)

**Session Map Memory Leak:**
- Problem: userContexts and sessionEncryptions maps never cleared
- Files: `src/plugin/agidentity-plugin.ts` (lines 101-102), `src/plugin/secure-plugin.ts` (lines 119-120)
- Measurement: Grows indefinitely with user count
- Cause: No cleanup for abandoned sessions
- Improvement path: Add session timeout and cleanup routine

## Fragile Areas

**JSON Parsing Without Validation:**
- Files: `src/vault/local-encrypted-vault.ts` (lines 454, 470), `src/shad/shad-integration.ts` (line 253), `src/encryption/per-interaction.ts` (line 213)
- Why fragile: Parses JSON but doesn't validate structure with schemas
- Common failures: Corrupted JSON or wrong schema causes property access errors
- Safe modification: Add Zod validation (already a dependency)
- Test coverage: No tests for malformed input handling

**Vault Decryption Error Handling:**
- Files: `src/vault/local-encrypted-vault.ts` (lines 303-320)
- Why fragile: Broad catch block doesn't distinguish error types
- Common failures: Corrupted encrypted files silently treated as "not encrypted"
- Safe modification: Distinguish ENOENT, EACCES, decryption errors
- Test coverage: No tests for corrupted file scenarios

## Scaling Limits

**Not Assessed:**
- No load testing or benchmarks documented
- Likely bottlenecks: SQLite wallet, in-memory caches, synchronous operations

## Dependencies at Risk

**Express 5.0.0:**
- Risk: Express 5 was pre-release, may have breaking changes
- Impact: HTTP server functionality
- Migration plan: Monitor Express 5 GA, test on upgrade

**CurvePoint (GitHub):**
- Risk: GitHub dependency without version lock
- Impact: Team encryption could break on upstream changes
- Migration plan: Pin to specific commit or fork

**Unpinned Auth Middleware:**
- Risk: @bsv/auth-express-middleware shows `*` version
- Impact: Auth could break on major version bump
- Migration plan: Pin to specific version

## Missing Critical Features

**Production MPC Integration:**
- Problem: No MPC wallet for certificate signing
- Current workaround: Local wallet (insecure for production)
- Blocks: Production deployment with real certificates
- Implementation complexity: High (requires MPC service integration)

**Overlay Revocation Checking:**
- Problem: Cannot check real-time certificate revocation
- Current workaround: In-memory list (doesn't scale)
- Blocks: Certificate revocation in distributed systems
- Implementation complexity: Medium (requires overlay service)

**Blockchain Indexer Integration:**
- Problem: Cannot verify blockchain timestamps
- Current workaround: Stub returns null
- Blocks: Document timestamp verification
- Implementation complexity: Medium

## Test Coverage Gaps

**Auth Server HTTP Endpoints:**
- What's not tested: Actual HTTP request/response cycle
- Risk: Auth middleware integration issues undetected
- Priority: High
- Difficulty: Requires test server setup

**MessageBox Client:**
- What's not tested: Live messaging features
- Risk: P2P messaging could fail in production
- Priority: Medium
- Difficulty: Requires mock MessageBox service

**Shad Subprocess:**
- What's not tested: Python process spawning and communication
- Risk: Shad integration could fail silently
- Priority: Medium
- Difficulty: Requires Python environment in tests

**Service Lifecycle:**
- What's not tested: Graceful shutdown, component cleanup
- Risk: Resource leaks on restart
- Priority: Low
- Difficulty: Low (add lifecycle tests)

---

*Concerns audit: 2026-02-14*
*Update as issues are fixed or new ones discovered*
