/**
 * Reasoning Hash
 *
 * Computes a SHA-256 hash from the LLM's assistant text concatenated with
 * tool call parameters. This hash is included in order submissions for
 * post-hoc auditability -- it cryptographically ties the LLM's reasoning
 * to the action it took.
 *
 * The full reasoning text + params are stored locally in JSONL; only the
 * hash goes on-chain via the PushDrop audit trail (Plan 03).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Context captured alongside the reasoning hash for local JSONL storage.
 */
export interface ReasoningContext {
  /** SHA-256 hex hash of assistantText + JSON.stringify(params) */
  hash: string;
  /** The assistant's reasoning text from the current turn */
  text: string;
  /** The tool call parameters that were hashed */
  params: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Hash computation
// ---------------------------------------------------------------------------

/**
 * Compute a SHA-256 hash from the assistant's reasoning text and tool call
 * parameters. The hash input is the concatenation of `assistantText` and
 * `JSON.stringify(toolParams)`.
 *
 * Uses the same `crypto.subtle.digest` pattern as `sha256()` in anchor-chain.ts.
 *
 * @param assistantText - The LLM's assistant text from the current turn
 * @param toolParams - The tool call parameters being submitted
 * @returns Hex-encoded SHA-256 hash string (64 characters)
 */
export async function computeReasoningHash(
  assistantText: string,
  toolParams: Record<string, unknown>,
): Promise<string> {
  const input = assistantText + JSON.stringify(toolParams);
  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoder.encode(input));
  return bufferToHex(new Uint8Array(hashBuffer));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function bufferToHex(buffer: Uint8Array): string {
  return Array.from(buffer)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
