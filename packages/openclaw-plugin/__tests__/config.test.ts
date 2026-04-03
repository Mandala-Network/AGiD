import { describe, it, expect, vi } from 'vitest';
import { resolveConfig } from '../src/config.js';

describe('resolveConfig', () => {
  it('returns full config when all fields provided', async () => {
    const input = {
      network: 'testnet',
      storage: 'local',
      storagePath: '/custom/path.sqlite',
      messageboxHost: 'https://custom.messagebox.com',
      uhrpStorageUrl: 'https://custom.uhrp.com',
      walletClientUrl: 'http://localhost:9999',
      trustedCertifiers: ['02abc123'],
      requireCerts: true,
    };
    const result = await resolveConfig(input);
    expect(result).toEqual(input);
  });

  it('applies defaults for optional fields', async () => {
    const result = await resolveConfig({ network: 'testnet' });
    expect(result.network).toBe('testnet');
    expect(result.storage).toBe('local');
    expect(result.storagePath).toBe('~/.agid/wallet.sqlite');
    expect(result.messageboxHost).toBe('https://messagebox.babbage.systems');
    expect(result.uhrpStorageUrl).toBe('https://nanostore.babbage.systems');
    expect(result.walletClientUrl).toBe('http://localhost:3301');
    expect(result.trustedCertifiers).toEqual([]);
    expect(result.requireCerts).toBe(false);
  });

  it('prompts for network when missing and prompt function available', async () => {
    const promptFn = vi.fn().mockResolvedValue('mainnet');
    const result = await resolveConfig({}, promptFn);
    expect(promptFn).toHaveBeenCalledWith('AGiD network (mainnet/testnet):');
    expect(result.network).toBe('mainnet');
  });

  it('throws when network missing and no prompt function', async () => {
    await expect(resolveConfig({})).rejects.toThrow(
      "AGiD requires 'network' to be set"
    );
  });

  it('rejects invalid network value', async () => {
    await expect(resolveConfig({ network: 'devnet' })).rejects.toThrow();
  });

  it('rejects invalid network from prompt', async () => {
    const promptFn = vi.fn().mockResolvedValue('devnet');
    await expect(resolveConfig({}, promptFn)).rejects.toThrow();
  });

  it('logs warnings for fields using defaults', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await resolveConfig({ network: 'testnet' });
    expect(warnSpy).toHaveBeenCalled();
    const warnings = warnSpy.mock.calls.map(c => c[0]);
    expect(warnings.some((w: string) => w.includes('storage'))).toBe(true);
    warnSpy.mockRestore();
  });
});
