import { describe, it, expect, beforeEach } from 'vitest';
import { loadConfig, resetConfig } from '../config/index.js';

describe('config integrity fields', () => {
  beforeEach(() => {
    resetConfig();
  });

  it('loads shadRetriever defaulting to auto', () => {
    const config = loadConfig();
    expect(config.shadRetriever).toBe('auto');
  });

  it('loads shadRetriever from env', () => {
    process.env.SHAD_RETRIEVER = 'qmd';
    const config = loadConfig();
    expect(config.shadRetriever).toBe('qmd');
    delete process.env.SHAD_RETRIEVER;
  });

  it('loads remoteBackup defaults', () => {
    const config = loadConfig();
    expect(config.remoteBackupEnabled).toBe(false);
    expect(config.remoteBackupIntervalMs).toBe(3600000);
  });

  it('loads integrity defaults', () => {
    const config = loadConfig();
    expect(config.integrityStrict).toBe(false);
    expect(config.integrityVerify).toBe(true);
  });
});
