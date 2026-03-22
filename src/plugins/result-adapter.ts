/**
 * Result Adapter
 *
 * Converts between AGiD's old ToolResult format ({ content: string })
 * and the new OpenClaw-compatible format ({ content: [{ type, text }] }).
 */

import type { PluginToolResult } from './types.js';

interface OldToolResult {
  content: string;
  isError?: boolean;
}

export function isOldFormat(result: any): result is OldToolResult {
  return typeof result?.content === 'string';
}

export function adaptOldResult(old: OldToolResult): PluginToolResult {
  return {
    content: [{ type: 'text', text: old.content }],
    isError: old.isError,
  };
}

export function adaptNewResult(newResult: PluginToolResult): OldToolResult {
  const text = newResult.content
    .map(block => block.text)
    .join('\n');
  return {
    content: text,
    isError: newResult.isError,
  };
}
