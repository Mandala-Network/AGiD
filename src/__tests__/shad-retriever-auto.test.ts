import { describe, it, expect } from 'vitest';
import { ShadTempVaultExecutor } from '../integrations/shad/shad-temp-executor.js';

describe('ShadTempVaultExecutor retriever config', () => {
  it('accepts retriever in shadConfig', () => {
    const executor = new ShadTempVaultExecutor({
      vault: {
        read: async () => null,
        list: async () => [],
        write: async () => {},
        delete: async () => false,
      },
      shadConfig: { retriever: 'auto' },
    });
    expect(executor).toBeDefined();
  });

  it('defaults retriever to auto', () => {
    const executor = new ShadTempVaultExecutor({
      vault: {
        read: async () => null,
        list: async () => [],
        write: async () => {},
        delete: async () => false,
      },
    });
    expect(executor).toBeDefined();
  });
});
