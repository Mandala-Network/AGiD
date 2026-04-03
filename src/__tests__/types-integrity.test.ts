import { describe, it, expect } from 'vitest';
import type {
  ShadRetrievedDocument,
  IntegrityConfig,
  RemoteBackupConfig,
} from '../types/index.js';

describe('integrity types', () => {
  it('ShadRetrievedDocument supports integrity proof fields', () => {
    const doc: ShadRetrievedDocument = {
      path: 'test.md',
      content: 'hello',
      confidence: 0.9,
      source: 'qmd',
      contentHash: 'abc123',
      tokenTxid: 'txid123',
      verified: true,
    };
    expect(doc.verified).toBe(true);
    expect(doc.contentHash).toBe('abc123');
    expect(doc.tokenTxid).toBe('txid123');
  });

  it('IntegrityConfig has strict and verifyOnRetrieval', () => {
    const config: IntegrityConfig = {
      strict: false,
      verifyOnRetrieval: true,
    };
    expect(config.strict).toBe(false);
  });

  it('RemoteBackupConfig has enabled and intervalMs', () => {
    const config: RemoteBackupConfig = {
      enabled: true,
      intervalMs: 3600000,
    };
    expect(config.enabled).toBe(true);
  });
});
