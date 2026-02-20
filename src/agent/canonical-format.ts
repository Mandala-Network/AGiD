/**
 * Canonical Message Format
 *
 * Provider-neutral message format for session storage.
 * Any LLM provider converts to/from this at its boundary.
 * Sessions stored in canonical format enable cross-model continuity.
 */

// ============================================================================
// Types
// ============================================================================

export type CanonicalBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; toolUseId: string; content: string; isError?: boolean };

export type CanonicalContent = string | CanonicalBlock[];

export interface CanonicalTurn {
  role: 'user' | 'assistant';
  content: CanonicalContent;
  timestamp: number;
  /** Format version. Absent = legacy Anthropic format, 1 = canonical. */
  v?: 1;
}

// ============================================================================
// Normalization
// ============================================================================

/**
 * Normalize a turn (possibly legacy Anthropic format) to canonical.
 *
 * Handles:
 * - String content: pass through
 * - Array with `{ type: 'text' }` / `{ type: 'tool_use' }`: map directly
 * - `{ type: 'tool_result', tool_use_id }`: rename to `toolUseId`
 * - Absent `v` field: legacy format, triggers normalization
 */
export function normalizeToCanonical(turn: { role: string; content: unknown; timestamp: number; v?: number }): CanonicalTurn {
  const role = turn.role as 'user' | 'assistant';
  const timestamp = turn.timestamp;

  // Already canonical (v: 1)
  if (turn.v === 1) {
    return { role, content: turn.content as CanonicalContent, timestamp, v: 1 };
  }

  // String content — pass through
  if (typeof turn.content === 'string') {
    return { role, content: turn.content, timestamp, v: 1 };
  }

  // Array of content blocks — normalize each
  if (Array.isArray(turn.content)) {
    const blocks: CanonicalBlock[] = [];

    for (const block of turn.content) {
      if (!block || typeof block !== 'object') continue;

      const b = block as Record<string, unknown>;

      if (b.type === 'text' && typeof b.text === 'string') {
        blocks.push({ type: 'text', text: b.text });
      } else if (b.type === 'tool_use') {
        blocks.push({
          type: 'tool_use',
          id: b.id as string,
          name: b.name as string,
          input: (b.input as Record<string, unknown>) ?? {},
        });
      } else if (b.type === 'tool_result') {
        // Legacy Anthropic format uses `tool_use_id`, canonical uses `toolUseId`
        const toolUseId = (b.toolUseId as string) ?? (b.tool_use_id as string) ?? '';
        const content = typeof b.content === 'string' ? b.content : JSON.stringify(b.content ?? '');
        const isError = (b.isError as boolean | undefined) ?? (b.is_error as boolean | undefined);
        blocks.push({ type: 'tool_result', toolUseId, content, ...(isError ? { isError } : {}) });
      }
    }

    return { role, content: blocks, timestamp, v: 1 };
  }

  // Fallback: stringify unknown content
  return { role, content: JSON.stringify(turn.content), timestamp, v: 1 };
}
