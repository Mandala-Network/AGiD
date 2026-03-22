import { describe, it, expect } from 'vitest';
import {
  adaptOldResult,
  adaptNewResult,
  isOldFormat,
} from '../../plugins/result-adapter.js';

describe('result-adapter', () => {
  it('converts old format { content: string } to new format', () => {
    const old = { content: '{"key":"value"}' };
    const result = adaptOldResult(old);
    expect(result.content).toEqual([{ type: 'text', text: '{"key":"value"}' }]);
    expect(result.isError).toBeUndefined();
  });

  it('preserves isError flag in conversion', () => {
    const old = { content: 'error message', isError: true };
    const result = adaptOldResult(old);
    expect(result.content).toEqual([{ type: 'text', text: 'error message' }]);
    expect(result.isError).toBe(true);
  });

  it('converts new format back to old format for legacy consumers', () => {
    const newResult = { content: [{ type: 'text' as const, text: 'hello' }] };
    const old = adaptNewResult(newResult);
    expect(old.content).toBe('hello');
  });

  it('concatenates multiple content blocks when converting to old', () => {
    const newResult = {
      content: [
        { type: 'text' as const, text: 'line1' },
        { type: 'text' as const, text: 'line2' },
      ],
    };
    const old = adaptNewResult(newResult);
    expect(old.content).toBe('line1\nline2');
  });

  it('detects old format correctly', () => {
    expect(isOldFormat({ content: 'string' })).toBe(true);
    expect(isOldFormat({ content: [{ type: 'text', text: 'x' }] })).toBe(false);
  });
});
