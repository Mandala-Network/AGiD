/**
 * Trading Audit Trail
 *
 * Anchors trade-specific events to BSV via PushDrop token chain with
 * Merkle batch commits. Every entry is also immediately written to a
 * local JSONL file (full evidence store including reasoning text).
 *
 * Features:
 *   - In-memory buffer batches at configurable size (default 50) or timer interval (default 5 min)
 *   - Chained PushDrop token commit: genesis for first batch, spend+lock for subsequent
 *   - JSONL disk fallback writes every entry immediately
 *   - Circuit breaker opens after 3 consecutive BSV failures, auto-resets after 5-min cooldown
 *   - Commit mutex prevents concurrent PushDrop transactions
 *   - recordEvent is synchronous (fire-and-forget for BSV commit) -- trading never blocks
 */

import * as fs from "node:fs";
import { PushDrop, Utils, Beef } from "@bsv/sdk";
import type { BRC100Wallet } from "../../types/index.js";
import { sha256, computeMerkleRoot } from "../../audit/anchor-chain.js";
import { lockPushDropToken } from "../../wallet/pushdrop-ops.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TradeEventType =
  | "trade_submitted"
  | "trade_filled"
  | "trade_denied"
  | "position_opened"
  | "position_closed"
  | "risk_event"
  | "emergency_halt";

export interface AuditLogEntry {
  timestamp: number;
  eventType: TradeEventType;
  data: Record<string, unknown>;
  reasoningHash?: string;
  reasoningText?: string;
  batchSeq?: number;
  merkleRoot?: string;
  bsvTxid?: string;
}

export interface TradingAuditConfig {
  wallet: BRC100Wallet;
  jsonlPath: string;
  batchSize?: number;
  batchIntervalMs?: number;
  protocolID?: [number, string];
  keyID?: string;
}

// ---------------------------------------------------------------------------
// CircuitBreaker (module-private)
// ---------------------------------------------------------------------------

class CircuitBreaker {
  private failures = 0;
  private state: "closed" | "open" = "closed";
  private openedAt = 0;
  private readonly maxFailures: number;
  private readonly cooldownMs: number;

  constructor(maxFailures = 3, cooldownMs = 5 * 60 * 1000) {
    this.maxFailures = maxFailures;
    this.cooldownMs = cooldownMs;
  }

  /**
   * Returns true if the circuit is open AND cooldown has NOT expired.
   * If cooldown has expired, returns false (half-open -- allows a retry).
   */
  isOpen(): boolean {
    if (this.state !== "open") return false;
    if (Date.now() - this.openedAt >= this.cooldownMs) {
      // Cooldown expired -- half-open, allow retry
      return false;
    }
    return true;
  }

  recordSuccess(): void {
    this.failures = 0;
    this.state = "closed";
  }

  recordFailure(): void {
    this.failures++;
    if (this.failures >= this.maxFailures) {
      this.state = "open";
      this.openedAt = Date.now();
    }
  }

  /** Expose internal state for testing. */
  getState(): "closed" | "open" {
    return this.state;
  }

  getFailures(): number {
    return this.failures;
  }
}

// ---------------------------------------------------------------------------
// TradingAuditTrail
// ---------------------------------------------------------------------------

export class TradingAuditTrail {
  private buffer: AuditLogEntry[] = [];
  private batchSeq = 0;
  private lastOutpoint: { txid: string; vout: number } | null = null;
  private readonly circuitBreaker: CircuitBreaker;
  private batchTimer: ReturnType<typeof setInterval> | null = null;
  private commitInProgress = false;
  private pendingCommit: (() => void) | null = null;

  private readonly wallet: BRC100Wallet;
  private readonly jsonlPath: string;
  private readonly batchSize: number;
  private readonly batchIntervalMs: number;
  private readonly protocolID: [number, string];
  private readonly keyID: string;

  constructor(config: TradingAuditConfig) {
    this.wallet = config.wallet;
    this.jsonlPath = config.jsonlPath;
    this.batchSize = config.batchSize ?? 50;
    this.batchIntervalMs = config.batchIntervalMs ?? 5 * 60 * 1000;
    this.protocolID = config.protocolID ?? [2, "tradingaudit"];
    this.keyID = config.keyID ?? "audit-chain-1";

    this.circuitBreaker = new CircuitBreaker();

    // Load persisted outpoint from disk (if exists)
    this.loadOutpoint();

    // Start batch timer
    this.batchTimer = setInterval(() => {
      this.tryCommitBatch().catch(() => {
        // Silent -- LLM is never informed about BSV unavailability
      });
    }, this.batchIntervalMs);
  }

  // -------------------------------------------------------------------------
  // Public methods
  // -------------------------------------------------------------------------

  /**
   * Record a trade event. Immediately writes to JSONL and buffers for
   * batched BSV commit. NEVER blocks -- BSV commit is fire-and-forget.
   */
  recordEvent(entry: Omit<AuditLogEntry, "timestamp">): void {
    const fullEntry: AuditLogEntry = {
      ...entry,
      timestamp: Date.now(),
    };

    // Always write to JSONL immediately (full evidence store)
    this.writeToJsonl(fullEntry);

    // Buffer for batch BSV commit
    this.buffer.push(fullEntry);

    // Trigger batch if buffer threshold reached (fire-and-forget)
    if (this.buffer.length >= this.batchSize) {
      this.tryCommitBatch().catch(() => {
        // Silent -- trading never blocks on BSV anchoring
      });
    }
  }

  /**
   * Attempt to commit the current buffer as a batched PushDrop token.
   * Respects circuit breaker and commit mutex.
   */
  async tryCommitBatch(): Promise<void> {
    if (this.buffer.length === 0) return;

    // Mutex: if a commit is already in progress, queue one pending commit
    if (this.commitInProgress) {
      return new Promise<void>((resolve) => {
        this.pendingCommit = resolve;
      });
    }

    this.commitInProgress = true;

    try {
      // Circuit breaker: skip BSV commit if open (entries stay in buffer)
      if (this.circuitBreaker.isOpen()) {
        return;
      }

      // Take snapshot of current buffer, clear it
      const entries = [...this.buffer];
      this.buffer = [];

      // Compute entry hashes (exclude reasoningText from on-chain hashes)
      const entryHashes = await Promise.all(
        entries.map((e) =>
          sha256(JSON.stringify({ ...e, reasoningText: undefined }))
        )
      );

      // Compute Merkle root
      const merkleRoot = await computeMerkleRoot(entryHashes);

      // Build PushDrop token fields
      const fields = [
        merkleRoot,
        String(this.batchSeq),
        String(Date.now()),
        String(entries.length),
        ...entryHashes,
      ];

      try {
        // Attempt chained PushDrop commit
        const result = await this.commitChainedToken(fields);

        // Success: update state
        this.lastOutpoint = result;
        this.persistOutpoint();
        this.circuitBreaker.recordSuccess();

        // Update entries with commit metadata
        for (const entry of entries) {
          entry.batchSeq = this.batchSeq;
          entry.merkleRoot = merkleRoot;
          entry.bsvTxid = result.txid;
        }

        this.batchSeq++;
      } catch (err) {
        // BSV failure: circuit breaker records failure, entries go back to buffer
        this.circuitBreaker.recordFailure();
        this.buffer = [...entries, ...this.buffer];
        // Silent -- LLM is never informed
        console.error(
          "TradingAuditTrail: BSV commit failed:",
          err instanceof Error ? err.message : String(err)
        );
      }
    } finally {
      this.commitInProgress = false;

      // If a pending commit was queued, invoke it
      if (this.pendingCommit) {
        const pending = this.pendingCommit;
        this.pendingCommit = null;
        pending();
      }
    }
  }

  /**
   * Stop the audit trail. Clears the batch timer and triggers a final
   * batch commit for any remaining entries.
   */
  stop(): void {
    if (this.batchTimer) {
      clearInterval(this.batchTimer);
      this.batchTimer = null;
    }
    // Fire final commit (fire-and-forget)
    this.tryCommitBatch().catch(() => {
      // Silent
    });
  }

  /** Return current buffer size (for monitoring). */
  getBufferSize(): number {
    return this.buffer.length;
  }

  /** Return last outpoint (for state inspection). */
  getLastOutpoint(): { txid: string; vout: number } | null {
    return this.lastOutpoint;
  }

  /** Expose circuit breaker state for testing. */
  getCircuitBreakerState(): { state: "closed" | "open"; failures: number } {
    return {
      state: this.circuitBreaker.getState(),
      failures: this.circuitBreaker.getFailures(),
    };
  }

  // -------------------------------------------------------------------------
  // Private: Chained PushDrop token commit
  // -------------------------------------------------------------------------

  private async commitChainedToken(
    fields: string[]
  ): Promise<{ txid: string; vout: number }> {
    if (this.lastOutpoint === null) {
      // Genesis: create first PushDrop token
      return this.commitGenesisToken(fields);
    }

    // Chained: spend previous token AND create new one
    return this.commitChainToken(fields);
  }

  private async commitGenesisToken(
    fields: string[]
  ): Promise<{ txid: string; vout: number }> {
    const result = await lockPushDropToken(this.wallet, {
      fields,
      protocolID: this.protocolID,
      keyID: this.keyID,
      satoshis: 1,
      basket: "trading-audit-chain",
      description: "Trading audit trail genesis token",
    });

    return { txid: result.txid, vout: result.vout };
  }

  private async commitChainToken(
    fields: string[]
  ): Promise<{ txid: string; vout: number }> {
    const underlyingWallet = (this.wallet as any).getUnderlyingWallet?.() as any;
    if (!underlyingWallet) {
      throw new Error("TradingAuditTrail: underlying wallet not available for chained commit");
    }

    const pushDrop = new PushDrop(underlyingWallet);

    // Build field byte arrays
    const fieldArrays: number[][] = fields.map((f) => Utils.toArray(f, "utf8"));

    // Build lock script for new token
    const lockingScript = await pushDrop.lock(
      fieldArrays,
      this.protocolID as [0 | 1 | 2, string],
      this.keyID,
      "self",
      true,  // forSelf
      true   // includeSignature
    );

    const lockingScriptHex = lockingScript.toHex();

    // Build unlock template for previous token
    const unlockTemplate = pushDrop.unlock(
      this.protocolID as [0 | 1 | 2, string],
      this.keyID,
      "self"
    );

    const estimatedLength = await unlockTemplate.estimateLength();

    // Resolve inputBEEF from wallet storage
    let inputBEEF: number[] | undefined;
    try {
      const storageManager = underlyingWallet.storage;
      if (storageManager) {
        const storageProvider = storageManager.getActiveProvider();
        if (storageProvider) {
          const beefResult = await storageProvider.getBeefForTransaction(
            this.lastOutpoint!.txid,
            {}
          );
          inputBEEF = beefResult.toBinary();
        }
      }
    } catch {
      // inputBEEF resolution is optional
    }

    // Create action with BOTH input (spend previous) and output (new token)
    const createActionArgs: any = {
      description: "Trading audit trail chained token",
      inputs: [
        {
          outpoint: `${this.lastOutpoint!.txid}.${this.lastOutpoint!.vout}`,
          inputDescription: "Spend previous audit token",
          unlockingScriptLength: estimatedLength,
        },
      ],
      outputs: [
        {
          lockingScript: lockingScriptHex,
          satoshis: 1,
          outputDescription: "New audit token",
          basket: "trading-audit-chain",
          tags: ["pushdrop", "proto:trading-audit"],
        },
      ],
      options: {
        acceptDelayedBroadcast: false,
        trustSelf: "known",
        randomizeOutputs: false,
      },
    };

    if (inputBEEF) {
      createActionArgs.inputBEEF = inputBEEF;
    }

    const result = await underlyingWallet.createAction(createActionArgs);

    // Handle signableTransaction flow (same pattern as unlockPushDropToken)
    if (result.signableTransaction) {
      const beef = Beef.fromBinary(result.signableTransaction.tx);
      const atomicTxid = beef.atomicTxid;
      if (!atomicTxid) {
        throw new Error("TradingAuditTrail: no atomic txid in signable BEEF");
      }

      const btx = beef.findTxid(atomicTxid);
      if (!btx || !btx.tx) {
        throw new Error("TradingAuditTrail: transaction not found in BEEF");
      }

      const tx = btx.tx;

      // Attach source transactions for each input
      for (const input of tx.inputs) {
        const sourceTxid = input.sourceTXID;
        if (sourceTxid && !input.sourceTransaction) {
          const sourceBtx = beef.findTxid(sourceTxid);
          if (sourceBtx && sourceBtx.tx) {
            input.sourceTransaction = sourceBtx.tx;
          }
        }
      }

      // Find token input
      let tokenInputIndex = -1;
      for (let i = 0; i < tx.inputs.length; i++) {
        const inp = tx.inputs[i];
        const inputTxid = inp.sourceTXID ?? inp.sourceTransaction?.id("hex");
        if (inputTxid === this.lastOutpoint!.txid && inp.sourceOutputIndex === this.lastOutpoint!.vout) {
          tokenInputIndex = i;
          break;
        }
      }

      if (tokenInputIndex < 0) {
        throw new Error("TradingAuditTrail: token input not found in transaction");
      }

      // Sign with PushDrop template
      const unlockingScript = await unlockTemplate.sign(tx, tokenInputIndex);
      tx.inputs[tokenInputIndex].unlockingScript = unlockingScript;

      // Complete signing via signAction
      const signResult = await underlyingWallet.signAction({
        reference: result.signableTransaction.reference,
        spends: {
          [tokenInputIndex]: {
            unlockingScript: unlockingScript.toHex(),
          },
        },
      });

      if (!signResult.txid) {
        throw new Error("TradingAuditTrail: no txid returned from signAction");
      }

      return { txid: signResult.txid, vout: 0 };
    }

    // Direct completion (createAction returned txid)
    if (!result.txid) {
      throw new Error("TradingAuditTrail: no txid or signableTransaction returned");
    }

    return { txid: result.txid, vout: 0 };
  }

  // -------------------------------------------------------------------------
  // Private: JSONL writing
  // -------------------------------------------------------------------------

  private writeToJsonl(entry: AuditLogEntry): void {
    try {
      fs.appendFileSync(this.jsonlPath, JSON.stringify(entry) + "\n", "utf8");
    } catch (err) {
      console.error(
        "TradingAuditTrail: JSONL write failed:",
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  // -------------------------------------------------------------------------
  // Private: Outpoint persistence
  // -------------------------------------------------------------------------

  private persistOutpoint(): void {
    try {
      const statePath = `${this.jsonlPath}.state.json`;
      fs.writeFileSync(statePath, JSON.stringify(this.lastOutpoint), "utf8");
    } catch (err) {
      console.error(
        "TradingAuditTrail: outpoint persist failed:",
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  private loadOutpoint(): void {
    try {
      const statePath = `${this.jsonlPath}.state.json`;
      if (fs.existsSync(statePath)) {
        const data = fs.readFileSync(statePath, "utf8");
        this.lastOutpoint = JSON.parse(data);
      }
    } catch {
      // Start fresh (genesis)
      this.lastOutpoint = null;
    }
  }
}
