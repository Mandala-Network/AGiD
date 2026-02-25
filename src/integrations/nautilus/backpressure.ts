/**
 * Per-subscription message rate tracking with 4-stage escalation.
 *
 * Tracks incoming message rates per subscription key using a sliding
 * window and escalates through NORMAL -> WARN -> THROTTLE -> DROP ->
 * DISCONNECT based on configurable thresholds. De-escalates after a
 * cooldown period of low traffic.
 */

import { BackpressureStage } from "./types.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface BackpressureConfig {
  /** Messages per second to trigger WARN (default 100) */
  warnThreshold: number;
  /** Messages per second to trigger THROTTLE (default 200) */
  throttleThreshold: number;
  /** Messages per second to trigger DROP (default 500) */
  dropThreshold: number;
  /** Messages per second to trigger DISCONNECT (default 1000) */
  disconnectThreshold: number;
  /** Sliding window size in milliseconds (default 1000) */
  windowMs: number;
  /** Time in ms to de-escalate one stage (default 5000) */
  cooldownMs: number;
}

const DEFAULT_CONFIG: BackpressureConfig = {
  warnThreshold: 100,
  throttleThreshold: 200,
  dropThreshold: 500,
  disconnectThreshold: 1000,
  windowMs: 1000,
  cooldownMs: 5000,
};

// ---------------------------------------------------------------------------
// Per-subscription state
// ---------------------------------------------------------------------------

interface SubscriptionState {
  stage: BackpressureStage;
  messagesInWindow: number;
  windowStart: number;
  droppedCount: number;
  /** Counter for Nth message processing in THROTTLE stage */
  throttleCounter: number;
  /** Timestamp of the last escalation (for cooldown tracking) */
  lastEscalationTs: number;
}

// ---------------------------------------------------------------------------
// Event emitted on stage transitions
// ---------------------------------------------------------------------------

export interface BackpressureEvent {
  stage: BackpressureStage;
  subscription: string;
  details: {
    messagesPerSecond: number;
    droppedCount?: number;
  };
}

// ---------------------------------------------------------------------------
// Ordered stages for escalation / de-escalation
// ---------------------------------------------------------------------------

const STAGE_ORDER: readonly BackpressureStage[] = [
  BackpressureStage.NORMAL,
  BackpressureStage.WARN,
  BackpressureStage.THROTTLE,
  BackpressureStage.DROP,
  BackpressureStage.DISCONNECT,
];

function stageIndex(stage: BackpressureStage): number {
  return STAGE_ORDER.indexOf(stage);
}

// ---------------------------------------------------------------------------
// BackpressureMonitor
// ---------------------------------------------------------------------------

export class BackpressureMonitor {
  private subscriptions = new Map<string, SubscriptionState>();
  private readonly config: BackpressureConfig;

  constructor(config?: Partial<BackpressureConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Record an incoming message for a subscription key.
   *
   * Returns the action the caller should take (`process`, `drop`, or
   * `disconnect`) and optionally a BackpressureEvent when the stage
   * changes.
   */
  recordMessage(subscriptionKey: string): {
    action: "process" | "drop" | "disconnect";
    event?: BackpressureEvent;
  } {
    const now = Date.now();
    let state = this.subscriptions.get(subscriptionKey);
    if (!state) {
      state = {
        stage: BackpressureStage.NORMAL,
        messagesInWindow: 0,
        windowStart: now,
        droppedCount: 0,
        throttleCounter: 0,
        lastEscalationTs: now,
      };
      this.subscriptions.set(subscriptionKey, state);
    }

    // Slide the window: if the current window has expired, reset
    const elapsed = now - state.windowStart;
    if (elapsed >= this.config.windowMs) {
      // Check for cooldown de-escalation before resetting window
      const timeSinceEscalation = now - state.lastEscalationTs;
      const currentIdx = stageIndex(state.stage);
      if (
        currentIdx > 0 &&
        timeSinceEscalation >= this.config.cooldownMs &&
        state.messagesInWindow <=
          this.stageThreshold(STAGE_ORDER[currentIdx - 1])
      ) {
        const previousStage = state.stage;
        state.stage = STAGE_ORDER[currentIdx - 1];
        state.lastEscalationTs = now;
        // Reset window for the new period
        state.messagesInWindow = 1;
        state.windowStart = now;
        state.throttleCounter = 0;

        const event: BackpressureEvent = {
          stage: state.stage,
          subscription: subscriptionKey,
          details: {
            messagesPerSecond: state.messagesInWindow,
            droppedCount:
              previousStage === BackpressureStage.DROP ||
              previousStage === BackpressureStage.THROTTLE
                ? state.droppedCount
                : undefined,
          },
        };
        return { action: this.actionForStage(state), event };
      }

      state.messagesInWindow = 0;
      state.windowStart = now;
    }

    state.messagesInWindow++;

    // Calculate effective messages per second
    const windowElapsed = Math.max(now - state.windowStart, 1);
    const messagesPerSecond =
      (state.messagesInWindow / windowElapsed) * this.config.windowMs;

    // Determine the target stage based on thresholds
    const targetStage = this.stageForRate(messagesPerSecond);
    const targetIdx = stageIndex(targetStage);
    const currentIdx = stageIndex(state.stage);

    let event: BackpressureEvent | undefined;

    if (targetIdx > currentIdx) {
      // Escalate one stage at a time (never skip stages)
      state.stage = STAGE_ORDER[currentIdx + 1];
      state.lastEscalationTs = now;
      state.throttleCounter = 0;

      event = {
        stage: state.stage,
        subscription: subscriptionKey,
        details: {
          messagesPerSecond,
          droppedCount: state.droppedCount > 0 ? state.droppedCount : undefined,
        },
      };
    }

    // Determine action based on current stage
    const action = this.actionForStage(state);
    if (action === "drop") {
      state.droppedCount++;
    }

    return { action, event };
  }

  /**
   * Reset state for a subscription (e.g. on unsubscribe).
   */
  resetSubscription(subscriptionKey: string): void {
    this.subscriptions.delete(subscriptionKey);
  }

  /**
   * Reset all subscription tracking state.
   */
  resetAll(): void {
    this.subscriptions.clear();
  }

  /**
   * Get the current backpressure stage for a subscription.
   * Returns NORMAL for unknown subscriptions.
   */
  getStage(subscriptionKey: string): BackpressureStage {
    return (
      this.subscriptions.get(subscriptionKey)?.stage ??
      BackpressureStage.NORMAL
    );
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /**
   * Map a message rate to the highest applicable stage.
   */
  private stageForRate(messagesPerSecond: number): BackpressureStage {
    if (messagesPerSecond >= this.config.disconnectThreshold) {
      return BackpressureStage.DISCONNECT;
    }
    if (messagesPerSecond >= this.config.dropThreshold) {
      return BackpressureStage.DROP;
    }
    if (messagesPerSecond >= this.config.throttleThreshold) {
      return BackpressureStage.THROTTLE;
    }
    if (messagesPerSecond >= this.config.warnThreshold) {
      return BackpressureStage.WARN;
    }
    return BackpressureStage.NORMAL;
  }

  /**
   * Get the threshold for a given stage (used for de-escalation check).
   */
  private stageThreshold(stage: BackpressureStage): number {
    switch (stage) {
      case BackpressureStage.NORMAL:
        return this.config.warnThreshold;
      case BackpressureStage.WARN:
        return this.config.throttleThreshold;
      case BackpressureStage.THROTTLE:
        return this.config.dropThreshold;
      case BackpressureStage.DROP:
        return this.config.disconnectThreshold;
      case BackpressureStage.DISCONNECT:
        return Infinity;
    }
  }

  /**
   * Determine the action for the current subscription state.
   * THROTTLE processes every 2nd message (drops alternates).
   */
  private actionForStage(state: SubscriptionState): "process" | "drop" | "disconnect" {
    switch (state.stage) {
      case BackpressureStage.NORMAL:
      case BackpressureStage.WARN:
        return "process";
      case BackpressureStage.THROTTLE: {
        state.throttleCounter++;
        // Process every 2nd message
        return state.throttleCounter % 2 === 0 ? "process" : "drop";
      }
      case BackpressureStage.DROP:
        return "drop";
      case BackpressureStage.DISCONNECT:
        return "disconnect";
    }
  }
}
