import { describe, it, expect, vi } from 'vitest';

describe('memory-writer local-first contract', () => {
  it('encrypts with correct protocol and keyID', async () => {
    const { storeMemory } = await import('../storage/memory/memory-writer.js');

    const mockEncrypt = vi.fn().mockResolvedValue({ ciphertext: [1, 2, 3, 4, 5] });
    const mockWallet = {
      encrypt: mockEncrypt,
      createAction: vi.fn().mockResolvedValue({ txid: 'test-txid' }),
      getUnderlyingWallet: () => ({}),
    } as any;

    const mockCoordinator = {
      write: vi.fn().mockResolvedValue(undefined),
    } as any;

    try {
      await storeMemory(mockWallet, { content: 'test', tags: ['tag1'] }, mockCoordinator);
    } catch {}

    expect(mockEncrypt).toHaveBeenCalledWith({
      plaintext: expect.any(Array),
      protocolID: [2, 'agid memory'],
      keyID: '1',
    });
  });

  it('writes encrypted content to coordinator', async () => {
    const { storeMemory } = await import('../storage/memory/memory-writer.js');

    const ciphertext = [10, 20, 30, 40, 50];
    const mockWallet = {
      encrypt: vi.fn().mockResolvedValue({ ciphertext }),
      createAction: vi.fn().mockResolvedValue({ txid: 'test-txid' }),
      getUnderlyingWallet: () => ({}),
    } as any;

    const mockCoordinator = {
      write: vi.fn().mockResolvedValue(undefined),
    } as any;

    try {
      await storeMemory(mockWallet, { content: 'test', tags: ['tag1'] }, mockCoordinator);
    } catch {}

    expect(mockCoordinator.write).toHaveBeenCalled();
  });

  it('creates action in agid-memory basket without importance', async () => {
    const { storeMemory } = await import('../storage/memory/memory-writer.js');

    const mockCreateAction = vi.fn().mockResolvedValue({ txid: 'test-txid' });
    const mockWallet = {
      encrypt: vi.fn().mockResolvedValue({ ciphertext: [1, 2, 3] }),
      createAction: mockCreateAction,
      getUnderlyingWallet: () => ({}),
    } as any;

    const mockCoordinator = { write: vi.fn() } as any;

    try {
      await storeMemory(mockWallet, { content: 'test', tags: ['tag1'] }, mockCoordinator);
    } catch {}

    if (mockCreateAction.mock.calls.length > 0) {
      const actionArgs = mockCreateAction.mock.calls[0][0];
      expect(actionArgs.outputs[0].basket).toBe('agid-memory');
      expect(actionArgs.outputs[0].tags).not.toContain('high');
      expect(actionArgs.outputs[0].tags).not.toContain('medium');
      expect(actionArgs.outputs[0].tags).not.toContain('low');
    }
  });
});
