/**
 * Progress Emitter
 *
 * Emits progress events during agent loop execution via a callback.
 * Uses a sequential send queue to prevent concurrent wallet signing operations
 * (same pattern as MessageBoxGateway's processing guard).
 *
 * Events are summary-level only per user decision:
 *   - tool_start: tool name
 *   - tool_result: tool name + status (completed/failed) + optional error type
 *   - thinking: indicates LLM is reasoning (no additional fields)
 *   - completion: tools_executed count, total_duration, outcome
 *
 * No full input/output payloads. No raw stack traces.
 */

// =============================================================================
// Progress Event Types (discriminated union on eventType)
// =============================================================================

interface ProgressEventBase {
  type: 'progress_event';
  requestId: string;
  timestamp: number;
  sequenceNumber: number;
}

export interface ToolStartEvent extends ProgressEventBase {
  eventType: 'tool_start';
  toolName: string;
}

export interface ToolResultEvent extends ProgressEventBase {
  eventType: 'tool_result';
  toolName: string;
  status: 'completed' | 'failed';
  /** Error type name (e.g. "InsufficientFunds"), no raw stack traces */
  errorType?: string;
}

export interface ThinkingEvent extends ProgressEventBase {
  eventType: 'thinking';
}

export interface CompletionEvent extends ProgressEventBase {
  eventType: 'completion';
  toolsExecuted: number;
  totalDuration: number;
  outcome: 'success' | 'error';
}

export type ProgressEvent = ToolStartEvent | ToolResultEvent | ThinkingEvent | CompletionEvent;

// =============================================================================
// ProgressEmitter Class
// =============================================================================

/**
 * Emits progress events through a callback, serializing sends to prevent
 * concurrent wallet signing operations (MessageBox messages require signing).
 */
export class ProgressEmitter {
  private sendFn: (event: ProgressEvent) => Promise<void>;
  private sequenceNumber = 0;
  private queue: ProgressEvent[] = [];
  private processing = false;

  /**
   * @param sendFn - Callback that sends each event (e.g. via MessageBox).
   *                 Events are sent one at a time; the next event is not sent
   *                 until the previous sendFn resolves.
   */
  constructor(sendFn: (event: ProgressEvent) => Promise<void>) {
    this.sendFn = sendFn;
  }

  // ---------------------------------------------------------------------------
  // Helper Methods (one per event type)
  // ---------------------------------------------------------------------------

  async emitToolStart(requestId: string, toolName: string): Promise<void> {
    const event: ToolStartEvent = {
      type: 'progress_event',
      eventType: 'tool_start',
      requestId,
      timestamp: Date.now(),
      sequenceNumber: this.sequenceNumber++,
      toolName,
    };
    await this.enqueue(event);
  }

  async emitToolResult(
    requestId: string,
    toolName: string,
    status: 'completed' | 'failed',
    errorType?: string
  ): Promise<void> {
    const event: ToolResultEvent = {
      type: 'progress_event',
      eventType: 'tool_result',
      requestId,
      timestamp: Date.now(),
      sequenceNumber: this.sequenceNumber++,
      toolName,
      status,
      ...(errorType !== undefined ? { errorType } : {}),
    };
    await this.enqueue(event);
  }

  async emitThinking(requestId: string): Promise<void> {
    const event: ThinkingEvent = {
      type: 'progress_event',
      eventType: 'thinking',
      requestId,
      timestamp: Date.now(),
      sequenceNumber: this.sequenceNumber++,
    };
    await this.enqueue(event);
  }

  async emitCompletion(
    requestId: string,
    toolsExecuted: number,
    totalDuration: number,
    outcome: 'success' | 'error'
  ): Promise<void> {
    const event: CompletionEvent = {
      type: 'progress_event',
      eventType: 'completion',
      requestId,
      timestamp: Date.now(),
      sequenceNumber: this.sequenceNumber++,
      toolsExecuted,
      totalDuration,
      outcome,
    };
    await this.enqueue(event);
  }

  // ---------------------------------------------------------------------------
  // Sequential Queue
  // ---------------------------------------------------------------------------

  /**
   * Enqueue an event and process the queue.
   * Returns a promise that resolves when THIS event has been sent
   * (not just enqueued).
   */
  private async enqueue(event: ProgressEvent): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      // Store resolve/reject alongside the event so we can notify the caller
      (event as any).__resolve = resolve;
      (event as any).__reject = reject;
      this.queue.push(event);
      this.processQueue();
    });
  }

  private async processQueue(): Promise<void> {
    if (this.processing || this.queue.length === 0) return;
    this.processing = true;
    try {
      while (this.queue.length > 0) {
        const event = this.queue.shift()!;
        const resolveFn = (event as any).__resolve as () => void;
        const rejectFn = (event as any).__reject as (err: unknown) => void;
        // Clean up internal properties before sending
        delete (event as any).__resolve;
        delete (event as any).__reject;
        try {
          await this.sendFn(event);
          resolveFn();
        } catch (err) {
          // Log but do not break the queue -- progress events are best-effort
          console.error('[ProgressEmitter] Failed to send event:', err instanceof Error ? err.message : err);
          rejectFn(err);
        }
      }
    } finally {
      this.processing = false;
    }
  }
}
