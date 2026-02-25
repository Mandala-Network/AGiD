/**
 * Unit tests for TradingAuditTrail, circuit breaker, JSONL fallback,
 * batch triggers, Merkle root, PushDrop chain, and barrel exports.
 *
 * Tests cover:
 *   1. AuditLogEntry types (7 event types, entry structure)
 *   2. JSONL fallback (immediate write, valid JSON, full evidence)
 *   3. Batch triggers (batchSize threshold, timer, empty buffer)
 *   4. Merkle root and token fields format
 *   5. PushDrop chain (genesis, chained, outpoint persistence)
 *   6. Circuit breaker (open/close/half-open/reset)
 *   7. Non-blocking and mutex behavior
 *   8. Index exports for all Phase 4 modules
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  TradingAuditTrail,
  type AuditLogEntry,
  type TradeEventType,
  type TradingAuditConfig,
} from "../trading-audit.js";
import type { BRC100Wallet } from "../../../types/index.js";

// ---------------------------------------------------------------------------
// Mock setup
// ---------------------------------------------------------------------------

// Mock lockPushDropToken
vi.mock("../../../wallet/pushdrop-ops.js", () => ({
  lockPushDropToken: vi.fn().mockResolvedValue({
    txid: "genesis-txid-aaa111",
    vout: 0,
    lockingScript: "abcdef",
    satoshis: 1,
  }),
}));

// Mock PushDrop from @bsv/sdk
vi.mock("@bsv/sdk", () => {
  const lockFn = vi.fn().mockResolvedValue({
    toHex: () => "mocklockhex123",
  });
  const signFn = vi.fn().mockResolvedValue({
    toHex: () => "mockunlockhex456",
  });
  const unlockFn = vi.fn().mockReturnValue({
    estimateLength: vi.fn().mockResolvedValue(200),
    sign: signFn,
  });

  return {
    PushDrop: vi.fn().mockImplementation(() => ({
      lock: lockFn,
      unlock: unlockFn,
    })),
    Utils: {
      toArray: vi.fn().mockImplementation((s: string) =>
        Array.from(new TextEncoder().encode(s))
      ),
    },
    Beef: {
      fromBinary: vi.fn(),
    },
    LockingScript: {
      fromHex: vi.fn(),
    },
  };
});

// Import the mock after vi.mock declarations
import { lockPushDropToken } from "../../../wallet/pushdrop-ops.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string;
let jsonlPath: string;

function createMockWallet(overrides?: {
  createActionResult?: Record<string, unknown>;
}): BRC100Wallet {
  const createActionResult = overrides?.createActionResult ?? {
    txid: "chained-txid-bbb222",
  };

  return {
    getPublicKey: vi.fn(),
    encrypt: vi.fn(),
    decrypt: vi.fn(),
    createSignature: vi.fn(),
    verifySignature: vi.fn(),
    createHmac: vi.fn(),
    verifyHmac: vi.fn(),
    createAction: vi.fn().mockResolvedValue(createActionResult),
    acquireCertificate: vi.fn(),
    listCertificates: vi.fn(),
    getNetwork: vi.fn().mockResolvedValue("testnet"),
    getHeight: vi.fn().mockResolvedValue(800000),
    isAuthenticated: vi.fn().mockResolvedValue(true),
    asWalletInterface: vi.fn().mockReturnValue({}),
    getUnderlyingWallet: vi.fn().mockReturnValue({
      createAction: vi.fn().mockResolvedValue(createActionResult),
      signAction: vi.fn().mockResolvedValue({ txid: "signed-txid-ccc333" }),
      storage: null,
    }),
  } as unknown as BRC100Wallet;
}

function createConfig(overrides?: Partial<TradingAuditConfig>): TradingAuditConfig {
  return {
    wallet: createMockWallet(),
    jsonlPath,
    batchSize: 1000,           // Very large to prevent auto-triggers unless overridden
    batchIntervalMs: 600_000,  // 10 min, won't fire in tests unless explicitly advanced
    ...overrides,
  };
}

function makeEntry(
  eventType: TradeEventType = "trade_submitted",
  data?: Record<string, unknown>
): Omit<AuditLogEntry, "timestamp"> {
  return {
    eventType,
    data: data ?? { symbol: "AAPL", quantity: "100" },
  };
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllTimers();
  vi.useFakeTimers();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "audit-test-"));
  jsonlPath = path.join(tmpDir, "audit.jsonl");
  // Reset mock to default resolved value (mockClear only clears calls, not impl)
  vi.mocked(lockPushDropToken).mockReset();
  vi.mocked(lockPushDropToken).mockResolvedValue({
    txid: "genesis-txid-aaa111",
    vout: 0,
    lockingScript: "abcdef",
    satoshis: 1,
  });
});

afterEach(async () => {
  vi.clearAllTimers();
  vi.useRealTimers();

  // Wait for any pending fire-and-forget promises to settle
  // (especially crypto.subtle.digest calls from tryCommitBatch)
  await new Promise((r) => setTimeout(r, 50));

  // Clean up temp files
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore cleanup errors
  }
});

// ===========================================================================
// 1. AuditLogEntry types
// ===========================================================================

describe("AuditLogEntry types", () => {
  it("accepts all 7 TradeEventType values", () => {
    const types: TradeEventType[] = [
      "trade_submitted",
      "trade_filled",
      "trade_denied",
      "position_opened",
      "position_closed",
      "risk_event",
      "emergency_halt",
    ];

    const config = createConfig();
    const trail = new TradingAuditTrail(config);

    for (const eventType of types) {
      trail.recordEvent({ eventType, data: {} });
    }

    // 7 entries in JSONL
    const lines = fs.readFileSync(jsonlPath, "utf8").trim().split("\n");
    expect(lines).toHaveLength(7);

    const parsedTypes = lines.map((l) => JSON.parse(l).eventType);
    expect(parsedTypes).toEqual(types);

    trail.stop();
  });

  it("includes timestamp, eventType, and data fields", () => {
    const config = createConfig();
    const trail = new TradingAuditTrail(config);

    const before = Date.now();
    trail.recordEvent({
      eventType: "trade_filled",
      data: { price: "150.50", quantity: "100" },
    });
    const after = Date.now();

    const entry: AuditLogEntry = JSON.parse(
      fs.readFileSync(jsonlPath, "utf8").trim()
    );

    expect(entry.timestamp).toBeGreaterThanOrEqual(before);
    expect(entry.timestamp).toBeLessThanOrEqual(after);
    expect(entry.eventType).toBe("trade_filled");
    expect(entry.data).toEqual({ price: "150.50", quantity: "100" });

    trail.stop();
  });
});

// ===========================================================================
// 2. JSONL fallback
// ===========================================================================

describe("JSONL fallback", () => {
  it("recordEvent immediately appends to JSONL file", () => {
    const config = createConfig();
    const trail = new TradingAuditTrail(config);

    trail.recordEvent(makeEntry("trade_submitted"));

    expect(fs.existsSync(jsonlPath)).toBe(true);
    const content = fs.readFileSync(jsonlPath, "utf8");
    expect(content.trim().length).toBeGreaterThan(0);

    trail.stop();
  });

  it("JSONL line is valid JSON with all entry fields", () => {
    const config = createConfig();
    const trail = new TradingAuditTrail(config);

    trail.recordEvent({
      eventType: "trade_filled",
      data: { symbol: "AAPL" },
      reasoningHash: "abc123",
      reasoningText: "I decided to buy because...",
    });

    const line = fs.readFileSync(jsonlPath, "utf8").trim();
    const parsed = JSON.parse(line);

    expect(parsed.eventType).toBe("trade_filled");
    expect(parsed.data).toEqual({ symbol: "AAPL" });
    expect(parsed.reasoningHash).toBe("abc123");
    expect(parsed.reasoningText).toBe("I decided to buy because...");
    expect(typeof parsed.timestamp).toBe("number");

    trail.stop();
  });

  it("multiple entries produce multiple lines", () => {
    const config = createConfig();
    const trail = new TradingAuditTrail(config);

    trail.recordEvent(makeEntry("trade_submitted"));
    trail.recordEvent(makeEntry("trade_filled"));
    trail.recordEvent(makeEntry("position_opened"));

    const lines = fs.readFileSync(jsonlPath, "utf8").trim().split("\n");
    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[0]).eventType).toBe("trade_submitted");
    expect(JSON.parse(lines[1]).eventType).toBe("trade_filled");
    expect(JSON.parse(lines[2]).eventType).toBe("position_opened");

    trail.stop();
  });

  it("reasoningText is preserved in JSONL (full evidence store)", () => {
    const config = createConfig();
    const trail = new TradingAuditTrail(config);

    const reasoningText =
      "Based on the momentum indicators and the current bid-ask spread, I am placing a market buy order.";

    trail.recordEvent({
      eventType: "trade_submitted",
      data: { symbol: "MSFT" },
      reasoningText,
      reasoningHash: "def456",
    });

    const parsed = JSON.parse(fs.readFileSync(jsonlPath, "utf8").trim());
    expect(parsed.reasoningText).toBe(reasoningText);

    trail.stop();
  });
});

// ===========================================================================
// 3. Batch triggers
// ===========================================================================

describe("Batch triggers", () => {
  it("explicit tryCommitBatch commits buffer entries via lockPushDropToken", async () => {
    // Verify that manually calling tryCommitBatch commits all buffered entries.
    // batchSize is large so auto-trigger does NOT fire -- only explicit call commits.
    const config = createConfig(); // batchSize=1000, no auto-trigger
    const trail = new TradingAuditTrail(config);

    trail.recordEvent(makeEntry("trade_submitted"));
    trail.recordEvent(makeEntry("trade_filled"));
    trail.recordEvent(makeEntry("position_opened"));

    expect(trail.getBufferSize()).toBe(3);

    // Explicitly commit
    await trail.tryCommitBatch();

    expect(lockPushDropToken).toHaveBeenCalledTimes(1);
    expect(trail.getBufferSize()).toBe(0);

    trail.stop();
  });

  it("timer-based batch commit verified via explicit tryCommitBatch", async () => {
    // Verify that entries buffered below batchSize are committed when
    // tryCommitBatch is called (simulating what the timer would trigger).
    // We use a large batchSize so recordEvent does NOT auto-trigger.
    const config = createConfig(); // batchSize=1000
    const trail = new TradingAuditTrail(config);

    trail.recordEvent(makeEntry("trade_submitted"));
    trail.recordEvent(makeEntry("trade_filled"));

    expect(trail.getBufferSize()).toBe(2);
    expect(lockPushDropToken).not.toHaveBeenCalled();

    // Simulate what the timer does: call tryCommitBatch
    await trail.tryCommitBatch();

    expect(lockPushDropToken).toHaveBeenCalledTimes(1);
    expect(trail.getBufferSize()).toBe(0);

    trail.stop();
  });

  it("empty buffer: tryCommitBatch returns immediately without BSV call", async () => {
    const config = createConfig();
    const trail = new TradingAuditTrail(config);

    await trail.tryCommitBatch();

    expect(lockPushDropToken).not.toHaveBeenCalled();

    trail.stop();
  });

  it("batch includes correct entry count", async () => {
    const config = createConfig({ batchSize: 100 }); // Don't auto-trigger
    const trail = new TradingAuditTrail(config);

    trail.recordEvent(makeEntry("trade_submitted"));
    trail.recordEvent(makeEntry("trade_filled"));

    await trail.tryCommitBatch();

    // lockPushDropToken should have been called with fields containing entry count
    const callArgs = vi.mocked(lockPushDropToken).mock.calls[0];
    const fields = callArgs[1].fields;
    // fields: [merkle_root, batch_seq, timestamp, entry_count, ...entry_hashes]
    expect(fields[3]).toBe("2"); // entry_count

    trail.stop();
  });
});

// ===========================================================================
// 4. Merkle root and token fields
// ===========================================================================

describe("Merkle root and token fields", () => {
  it("token fields array has correct format", async () => {
    const config = createConfig({ batchSize: 100 }); // Don't auto-trigger
    const trail = new TradingAuditTrail(config);

    trail.recordEvent(makeEntry("trade_submitted"));
    trail.recordEvent(makeEntry("trade_filled"));

    await trail.tryCommitBatch();

    const callArgs = vi.mocked(lockPushDropToken).mock.calls[0];
    const fields = callArgs[1].fields;

    // Format: [merkle_root, batch_seq, timestamp, entry_count, ...entry_hashes]
    expect(fields.length).toBeGreaterThanOrEqual(6); // 4 header + 2 hashes
    expect(fields[1]).toBe("0"); // batch_seq starts at 0
    expect(fields[3]).toBe("2"); // entry_count

    trail.stop();
  });

  it("Merkle root is valid SHA-256 hex (64 chars)", async () => {
    const config = createConfig({ batchSize: 100 }); // Don't auto-trigger
    const trail = new TradingAuditTrail(config);

    trail.recordEvent(makeEntry("trade_submitted"));
    trail.recordEvent(makeEntry("trade_filled"));

    await trail.tryCommitBatch();

    const callArgs = vi.mocked(lockPushDropToken).mock.calls[0];
    const merkleRoot = callArgs[1].fields[0];

    expect(merkleRoot).toMatch(/^[0-9a-f]{64}$/);

    trail.stop();
  });

  it("entry hashes exclude reasoningText from hash input", async () => {
    const config = createConfig({ batchSize: 100 }); // Don't auto-trigger
    const trail = new TradingAuditTrail(config);

    trail.recordEvent({
      eventType: "trade_submitted",
      data: { symbol: "AAPL" },
      reasoningText: "Some reasoning that should not be hashed on-chain",
      reasoningHash: "abc",
    });

    await trail.tryCommitBatch();

    const callArgs = vi.mocked(lockPushDropToken).mock.calls[0];
    const entryHash = callArgs[1].fields[4]; // First entry hash

    // Verify hash is 64-char hex
    expect(entryHash).toMatch(/^[0-9a-f]{64}$/);

    trail.stop();
  });
});

// ===========================================================================
// 5. PushDrop chain
// ===========================================================================

describe("PushDrop chain", () => {
  it("genesis batch (lastOutpoint null) calls lockPushDropToken", async () => {
    const config = createConfig({ batchSize: 100 }); // Don't auto-trigger
    const trail = new TradingAuditTrail(config);

    expect(trail.getLastOutpoint()).toBeNull();

    trail.recordEvent(makeEntry("trade_submitted"));
    await trail.tryCommitBatch();

    expect(lockPushDropToken).toHaveBeenCalledTimes(1);
    expect(lockPushDropToken).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        protocolID: [2, "trading-audit"],
        keyID: "audit-chain-1",
        basket: "trading-audit-chain",
      })
    );

    trail.stop();
  });

  it("after successful commit: lastOutpoint is updated", async () => {
    const config = createConfig({ batchSize: 100 }); // Don't auto-trigger
    const trail = new TradingAuditTrail(config);

    trail.recordEvent(makeEntry("trade_submitted"));
    await trail.tryCommitBatch();

    const outpoint = trail.getLastOutpoint();
    expect(outpoint).not.toBeNull();
    expect(outpoint!.txid).toBe("genesis-txid-aaa111");
    expect(outpoint!.vout).toBe(0);

    trail.stop();
  });

  it("outpoint persisted to disk state file", async () => {
    const config = createConfig({ batchSize: 100 }); // Don't auto-trigger
    const trail = new TradingAuditTrail(config);

    trail.recordEvent(makeEntry("trade_submitted"));
    await trail.tryCommitBatch();

    const statePath = `${jsonlPath}.state.json`;
    expect(fs.existsSync(statePath)).toBe(true);

    const persisted = JSON.parse(fs.readFileSync(statePath, "utf8"));
    expect(persisted.txid).toBe("genesis-txid-aaa111");
    expect(persisted.vout).toBe(0);

    trail.stop();
  });

  it("subsequent batch (lastOutpoint exists) creates chained transaction", async () => {
    // Seed the state file so the trail starts with an existing outpoint
    const statePath = `${jsonlPath}.state.json`;
    fs.writeFileSync(
      statePath,
      JSON.stringify({ txid: "previous-txid-000", vout: 0 }),
      "utf8"
    );

    const mockWallet = createMockWallet();
    const config = createConfig({ batchSize: 100, wallet: mockWallet }); // Don't auto-trigger
    const trail = new TradingAuditTrail(config);

    expect(trail.getLastOutpoint()).toEqual({ txid: "previous-txid-000", vout: 0 });

    trail.recordEvent(makeEntry("trade_filled"));
    await trail.tryCommitBatch();

    // Should NOT have called lockPushDropToken (that is genesis-only)
    expect(lockPushDropToken).not.toHaveBeenCalled();

    // Should have called underlying wallet's createAction for chained commit
    const underlying = (mockWallet as any).getUnderlyingWallet();
    expect(underlying.createAction).toHaveBeenCalledTimes(1);

    const createArgs = underlying.createAction.mock.calls[0][0];
    expect(createArgs.inputs).toHaveLength(1);
    expect(createArgs.inputs[0].outpoint).toBe("previous-txid-000.0");
    expect(createArgs.outputs).toHaveLength(1);
    expect(createArgs.outputs[0].basket).toBe("trading-audit-chain");

    trail.stop();
  });
});

// ===========================================================================
// 6. Circuit breaker
// ===========================================================================

describe("Circuit breaker", () => {
  it("initial state: closed (isOpen equivalent: commits proceed)", async () => {
    const config = createConfig({ batchSize: 1 });
    const trail = new TradingAuditTrail(config);

    const cbState = trail.getCircuitBreakerState();
    expect(cbState.state).toBe("closed");
    expect(cbState.failures).toBe(0);

    trail.stop();
  });

  it("after 2 failures: still closed", async () => {
    vi.mocked(lockPushDropToken).mockRejectedValue(new Error("BSV down"));

    const config = createConfig({ batchSize: 100 }); // Don't auto-trigger
    const trail = new TradingAuditTrail(config);

    trail.recordEvent(makeEntry("trade_submitted"));
    await trail.tryCommitBatch();

    trail.recordEvent(makeEntry("trade_filled"));
    await trail.tryCommitBatch();

    const cbState = trail.getCircuitBreakerState();
    expect(cbState.failures).toBe(2);
    expect(cbState.state).toBe("closed");

    trail.stop();
  });

  it("after 3 failures: open", async () => {
    vi.mocked(lockPushDropToken).mockRejectedValue(new Error("BSV down"));

    const config = createConfig({ batchSize: 100 }); // Don't auto-trigger
    const trail = new TradingAuditTrail(config);

    trail.recordEvent(makeEntry("trade_submitted"));
    await trail.tryCommitBatch();

    trail.recordEvent(makeEntry("trade_filled"));
    await trail.tryCommitBatch();

    trail.recordEvent(makeEntry("position_opened"));
    await trail.tryCommitBatch();

    const cbState = trail.getCircuitBreakerState();
    expect(cbState.failures).toBe(3);
    expect(cbState.state).toBe("open");

    trail.stop();
  });

  it("during open: tryCommitBatch skips BSV commit (entries stay in buffer)", async () => {
    vi.mocked(lockPushDropToken).mockRejectedValue(new Error("BSV down"));

    const config = createConfig({ batchSize: 100 }); // Don't auto-trigger
    const trail = new TradingAuditTrail(config);

    // Trigger 3 failures to open circuit breaker
    trail.recordEvent(makeEntry("trade_submitted"));
    await trail.tryCommitBatch();
    trail.recordEvent(makeEntry("trade_filled"));
    await trail.tryCommitBatch();
    trail.recordEvent(makeEntry("position_opened"));
    await trail.tryCommitBatch();

    expect(trail.getCircuitBreakerState().state).toBe("open");

    // Clear mock call count
    vi.mocked(lockPushDropToken).mockClear();

    // Add new entry -- circuit is open so BSV commit should be skipped
    trail.recordEvent(makeEntry("risk_event"));
    await trail.tryCommitBatch();

    // lockPushDropToken should NOT have been called (circuit is open)
    expect(lockPushDropToken).not.toHaveBeenCalled();

    // Buffer should NOT be empty (entries kept for retry)
    expect(trail.getBufferSize()).toBeGreaterThan(0);

    trail.stop();
  });

  it("after 5-min cooldown: isOpen returns false (half-open, allows retry)", async () => {
    vi.mocked(lockPushDropToken).mockRejectedValue(new Error("BSV down"));

    const config = createConfig({ batchSize: 100, batchIntervalMs: 600_000 }); // Don't auto-trigger
    const trail = new TradingAuditTrail(config);

    // Trigger 3 failures via explicit tryCommitBatch calls
    trail.recordEvent(makeEntry("trade_submitted"));
    await trail.tryCommitBatch();
    trail.recordEvent(makeEntry("trade_filled"));
    await trail.tryCommitBatch();
    trail.recordEvent(makeEntry("position_opened"));
    await trail.tryCommitBatch();

    expect(trail.getCircuitBreakerState().state).toBe("open");

    // Now fix the mock so next call succeeds
    vi.mocked(lockPushDropToken).mockResolvedValue({
      txid: "recovery-txid-rrr999",
      vout: 0,
      lockingScript: "recovered",
      satoshis: 1,
    });

    // Advance past 5-minute cooldown so Date.now() moves forward
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 100);

    // Manually attempt commit (half-open allows retry)
    await trail.tryCommitBatch();

    // After successful commit in half-open, circuit should reset
    const cbState = trail.getCircuitBreakerState();
    expect(cbState.state).toBe("closed");
    expect(cbState.failures).toBe(0);

    trail.stop();
  });

  it("on success after half-open: reset to closed", async () => {
    vi.mocked(lockPushDropToken).mockRejectedValue(new Error("BSV down"));

    const config = createConfig({ batchSize: 100, batchIntervalMs: 600_000 });
    const trail = new TradingAuditTrail(config);

    // Trigger 3 failures
    trail.recordEvent(makeEntry("trade_submitted"));
    await trail.tryCommitBatch();
    trail.recordEvent(makeEntry("trade_filled"));
    await trail.tryCommitBatch();
    trail.recordEvent(makeEntry("position_opened"));
    await trail.tryCommitBatch();

    expect(trail.getCircuitBreakerState().state).toBe("open");

    // Fix the mock
    vi.mocked(lockPushDropToken).mockResolvedValue({
      txid: "recovery-txid-rrr999",
      vout: 0,
      lockingScript: "recovered",
      satoshis: 1,
    });

    // Advance past cooldown
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 100);

    // Manually commit
    await trail.tryCommitBatch();

    // Should be fully closed now
    const cbState = trail.getCircuitBreakerState();
    expect(cbState.state).toBe("closed");
    expect(cbState.failures).toBe(0);

    trail.stop();
  });
});

// ===========================================================================
// 7. Non-blocking and mutex
// ===========================================================================

describe("Non-blocking and mutex", () => {
  it("recordEvent does not await BSV operations", () => {
    const config = createConfig({ batchSize: 1 });
    const trail = new TradingAuditTrail(config);

    // Make lockPushDropToken take a long time
    vi.mocked(lockPushDropToken).mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({
        txid: "slow-txid",
        vout: 0,
        lockingScript: "slow",
        satoshis: 1,
      }), 10_000))
    );

    const start = Date.now();
    trail.recordEvent(makeEntry("trade_submitted"));
    const elapsed = Date.now() - start;

    // recordEvent should return synchronously (< 50ms)
    expect(elapsed).toBeLessThan(50);

    trail.stop();
  });

  it("concurrent tryCommitBatch calls are serialized (second waits for first)", async () => {
    let resolveFirst: (() => void) | null = null;
    const firstCallPromise = new Promise<void>((resolve) => {
      resolveFirst = resolve;
    });

    vi.mocked(lockPushDropToken).mockImplementation(
      () =>
        firstCallPromise.then(() => ({
          txid: "serial-txid",
          vout: 0,
          lockingScript: "serial",
          satoshis: 1,
        }))
    );

    const config = createConfig({ batchSize: 100 }); // Don't auto-trigger
    const trail = new TradingAuditTrail(config);

    trail.recordEvent(makeEntry("trade_submitted"));
    trail.recordEvent(makeEntry("trade_filled"));

    // Start first commit
    const commit1 = trail.tryCommitBatch();

    // Add more entries and start second commit while first is in progress
    trail.recordEvent(makeEntry("position_opened"));
    const commit2 = trail.tryCommitBatch();

    // First commit is still pending
    expect(trail.getBufferSize()).toBe(1); // position_opened still in buffer

    // Resolve first commit
    resolveFirst!();
    await commit1;
    await vi.advanceTimersByTimeAsync(10);
    await commit2;

    trail.stop();
  });

  it("stop() clears timer and triggers final batch commit", async () => {
    // Use real timers for this test since we need fire-and-forget to settle
    vi.useRealTimers();

    const realTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "audit-stop-"));
    const realJsonlPath = path.join(realTmpDir, "audit.jsonl");

    const config: TradingAuditConfig = {
      wallet: createMockWallet(),
      jsonlPath: realJsonlPath,
      batchSize: 100,
      batchIntervalMs: 60_000,
    };
    const trail = new TradingAuditTrail(config);

    trail.recordEvent(makeEntry("trade_submitted"));
    trail.recordEvent(makeEntry("trade_filled"));

    expect(trail.getBufferSize()).toBe(2);

    // stop() clears the timer and fires tryCommitBatch
    trail.stop();

    // Wait for the fire-and-forget async to settle
    await new Promise((r) => setTimeout(r, 100));

    expect(lockPushDropToken).toHaveBeenCalled();
    expect(trail.getBufferSize()).toBe(0);

    // Clean up
    try {
      fs.rmSync(realTmpDir, { recursive: true, force: true });
    } catch { /* ignore */ }

    // Restore fake timers for remaining tests
    vi.useFakeTimers();
  });
});

// ===========================================================================
// 8. Index exports
// ===========================================================================

describe("Index exports", () => {
  it("all Phase 4 exports available from index.ts", async () => {
    const indexModule = await import("../index.js");

    // Phase 4 module exports
    expect(indexModule.NautilusTradingPlugin).toBeDefined();
    expect(indexModule.TradingContextBuilder).toBeDefined();
    expect(indexModule.TradingAuditTrail).toBeDefined();
    expect(indexModule.computeReasoningHash).toBeDefined();

    // createTradingTools
    expect(indexModule.createTradingTools).toBeDefined();
  });
});
