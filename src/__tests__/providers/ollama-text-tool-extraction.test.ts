/**
 * Tests for text-based tool call extraction in OllamaProvider.
 *
 * Some models (e.g. MiniMax-M2.7) output tool calls as text markers
 * instead of structured tool_use blocks. The provider must detect
 * and extract these from the response text.
 */

import { describe, it, expect } from 'vitest';

// We test the extraction logic by accessing the private method via prototype.
// This is a unit test of the parsing logic, not an integration test.
import { OllamaProvider } from '../../agent/providers/ollama-provider.js';

function extract(text: string) {
  const provider = new OllamaProvider({ baseUrl: 'http://localhost:11434' });
  // Access private method for testing
  return (provider as any).extractToolCallsFromText(text);
}

describe('OllamaProvider text-based tool call extraction', () => {
  describe('[TOOL_CALL] bracket format', () => {
    it('extracts tool call with loose arrow syntax', () => {
      const text = `I'll check your balance now.

[TOOL_CALL] {tool => "agid_balance", args => {

}} [/TOOL_CALL]`;

      const result = extract(text);
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].name).toBe('agid_balance');
      expect(result.toolCalls[0].input).toEqual({});
      expect(result.cleanedText).toBe("I'll check your balance now.");
    });

    it('extracts tool call with JSON args', () => {
      const text = `[TOOL_CALL] {tool => "agid_store_memory", args => {"content": "User likes coffee", "tags": ["preference"]}} [/TOOL_CALL]`;

      const result = extract(text);
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].name).toBe('agid_store_memory');
      expect(result.toolCalls[0].input).toEqual({ content: 'User likes coffee', tags: ['preference'] });
    });

    it('extracts multiple tool calls', () => {
      const text = `[TOOL_CALL] {tool => "agid_identity", args => {}} [/TOOL_CALL]
Some text between calls.
[TOOL_CALL] {tool => "agid_balance", args => {}} [/TOOL_CALL]`;

      const result = extract(text);
      expect(result.toolCalls).toHaveLength(2);
      expect(result.toolCalls[0].name).toBe('agid_identity');
      expect(result.toolCalls[1].name).toBe('agid_balance');
      expect(result.cleanedText).toBe('Some text between calls.');
    });
  });

  describe('<tool_call> XML format', () => {
    it('extracts JSON tool call', () => {
      const text = `Let me check. <tool_call> {"name": "agid_balance", "arguments": {}} </tool_call>`;

      const result = extract(text);
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].name).toBe('agid_balance');
      expect(result.toolCalls[0].input).toEqual({});
      expect(result.cleanedText).toBe('Let me check.');
    });

    it('extracts tool call with arguments', () => {
      const text = `<tool_call> {"name": "agid_store_memory", "arguments": {"content": "hello"}} </tool_call>`;

      const result = extract(text);
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].name).toBe('agid_store_memory');
      expect(result.toolCalls[0].input).toEqual({ content: 'hello' });
    });
  });

  describe('```tool_call fenced format', () => {
    it('extracts fenced JSON tool call', () => {
      const text = "Here:\n```tool_call\n{\"name\": \"agid_balance\", \"arguments\": {}}\n```";

      const result = extract(text);
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].name).toBe('agid_balance');
    });
  });

  describe('no tool calls in text', () => {
    it('returns empty when no patterns found', () => {
      const text = 'Just a normal response with no tool calls.';
      const result = extract(text);
      expect(result.toolCalls).toHaveLength(0);
      expect(result.cleanedText).toBe(text);
    });
  });

  describe('parseLooseToolCall edge cases', () => {
    it('handles colon syntax (tool: "name")', () => {
      const text = `[TOOL_CALL] {tool: "agid_balance", args: {}} [/TOOL_CALL]`;
      const result = extract(text);
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].name).toBe('agid_balance');
    });

    it('handles "tool" key in JSON format', () => {
      const text = `<tool_call> {"tool": "agid_balance", "args": {}} </tool_call>`;
      const result = extract(text);
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].name).toBe('agid_balance');
    });
  });
});
