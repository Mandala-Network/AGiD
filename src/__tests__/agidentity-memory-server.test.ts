/**
 * AGIdentityMemoryServer Tests
 *
 * Tests for the MCP-compatible memory server that exposes
 * encrypted vault as AI memory tools.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  AGIdentityMemoryServer,
  createAGIdentityMemoryServer,
  type MCPToolResponse,
} from '../02-storage/memory/agidentity-memory-server.js';
import type { VaultProof } from '../07-shared/types/index.js';

// ===========================================================================
// Mock Vault Implementations
// ===========================================================================

/**
 * Mock LocalEncryptedVault for testing
 */
class MockLocalEncryptedVault {
  private documents: Map<string, string> = new Map();

  constructor(initialDocs?: Record<string, string>) {
    if (initialDocs) {
      for (const [path, content] of Object.entries(initialDocs)) {
        this.documents.set(path, content);
      }
    }
  }

  async read(path: string): Promise<string | null> {
    return this.documents.get(path) ?? null;
  }

  async search(
    query: string,
    options?: { limit?: number }
  ): Promise<Array<{ path: string; score: number; snippet?: string }>> {
    const limit = options?.limit ?? 10;
    const lowerQuery = query.toLowerCase();
    const results: Array<{ path: string; score: number; snippet?: string }> = [];

    for (const [docPath, content] of this.documents) {
      const lowerContent = content.toLowerCase();
      const lowerPath = docPath.toLowerCase();

      let score = 0;
      let snippet: string | undefined;

      if (lowerPath.includes(lowerQuery)) {
        score += 0.5;
      }

      const index = lowerContent.indexOf(lowerQuery);
      if (index >= 0) {
        score += 0.3;
        const start = Math.max(0, index - 50);
        const end = Math.min(content.length, index + query.length + 50);
        snippet = '...' + content.slice(start, end) + '...';
      }

      if (score > 0) {
        results.push({ path: docPath, score, snippet });
      }
    }

    return results.sort((a, b) => b.score - a.score).slice(0, limit);
  }
}

/**
 * Mock EncryptedShadVault for testing
 */
class MockEncryptedShadVault {
  private documents: Map<string, string> = new Map();
  private proofs: Map<string, VaultProof> = new Map();

  constructor(
    initialDocs?: Record<string, string>,
    initialProofs?: Record<string, VaultProof>
  ) {
    if (initialDocs) {
      for (const [path, content] of Object.entries(initialDocs)) {
        this.documents.set(path, content);
      }
    }
    if (initialProofs) {
      for (const [path, proof] of Object.entries(initialProofs)) {
        this.proofs.set(path, proof);
      }
    }
  }

  async readDocument(
    _userPublicKey: string,
    path: string
  ): Promise<string | null> {
    return this.documents.get(path) ?? null;
  }

  async searchDocumentsWithContent(
    _userPublicKey: string,
    query: string,
    options?: { limit?: number }
  ): Promise<Array<{ path: string; relevanceScore: number; snippet?: string; uhrpUrl: string }>> {
    const limit = options?.limit ?? 10;
    const lowerQuery = query.toLowerCase();
    const results: Array<{
      path: string;
      relevanceScore: number;
      snippet?: string;
      uhrpUrl: string;
    }> = [];

    for (const [docPath, content] of this.documents) {
      const lowerContent = content.toLowerCase();
      const lowerPath = docPath.toLowerCase();

      let score = 0;
      let snippet: string | undefined;

      if (lowerPath.includes(lowerQuery)) {
        score += 0.5;
      }

      const index = lowerContent.indexOf(lowerQuery);
      if (index >= 0) {
        score += 0.3;
        const start = Math.max(0, index - 50);
        const end = Math.min(content.length, index + query.length + 50);
        snippet = '...' + content.slice(start, end) + '...';
      }

      if (score > 0) {
        results.push({
          path: docPath,
          relevanceScore: score,
          snippet,
          uhrpUrl: `uhrp://test/${docPath}`,
        });
      }
    }

    return results.sort((a, b) => b.relevanceScore - a.relevanceScore).slice(0, limit);
  }

  async getVaultProof(documentPath: string): Promise<VaultProof> {
    const proof = this.proofs.get(documentPath);
    if (proof) {
      return proof;
    }

    // Document exists but no blockchain proof
    if (this.documents.has(documentPath)) {
      return { exists: true, uhrpUrl: `uhrp://test/${documentPath}` };
    }

    return { exists: false };
  }
}

// ===========================================================================
// Tests
// ===========================================================================

describe('AGIdentityMemoryServer', () => {
  describe('with LocalEncryptedVault', () => {
    let server: AGIdentityMemoryServer;
    let mockVault: MockLocalEncryptedVault;

    beforeEach(() => {
      mockVault = new MockLocalEncryptedVault({
        'notes/authentication.md': '# Authentication\n\nThis document covers authentication patterns and security.',
        'notes/api-design.md': '# API Design\n\nRESTful API design principles.',
        'meetings/standup-2024-01.md': '# Standup Notes\n\nDiscussed authentication improvements.',
      });

      // Cast to any to satisfy type checker with mock
      server = new AGIdentityMemoryServer({
        vault: mockVault as any,
      });
    });

    describe('memory_search', () => {
      it('should return search results in MCP format', async () => {
        const response = await server.memory_search('authentication', 10);

        expect(response).toHaveProperty('content');
        expect(Array.isArray(response.content)).toBe(true);
        expect(response.content.length).toBe(1);
        expect(response.content[0].type).toBe('text');

        const parsed = JSON.parse(response.content[0].text);
        expect(parsed).toHaveProperty('results');
        expect(parsed).toHaveProperty('count');
        expect(parsed).toHaveProperty('query');
        expect(parsed.query).toBe('authentication');
        expect(parsed.count).toBeGreaterThan(0);
      });

      it('should return results with path, score, and snippet', async () => {
        const response = await server.memory_search('authentication');
        const parsed = JSON.parse(response.content[0].text);

        expect(parsed.results.length).toBeGreaterThan(0);

        const result = parsed.results[0];
        expect(result).toHaveProperty('path');
        expect(result).toHaveProperty('score');
        expect(typeof result.score).toBe('number');
      });

      it('should respect limit parameter', async () => {
        const response = await server.memory_search('notes', 1);
        const parsed = JSON.parse(response.content[0].text);

        expect(parsed.results.length).toBeLessThanOrEqual(1);
      });

      it('should return empty results for non-matching query', async () => {
        const response = await server.memory_search('xyz-nonexistent-query');
        const parsed = JSON.parse(response.content[0].text);

        expect(parsed.results).toEqual([]);
        expect(parsed.count).toBe(0);
      });
    });

    describe('memory_get', () => {
      it('should return document content in MCP format', async () => {
        const response = await server.memory_get('notes/authentication.md');

        expect(response).toHaveProperty('content');
        expect(response.content[0].type).toBe('text');

        const parsed = JSON.parse(response.content[0].text);
        expect(parsed).toHaveProperty('path');
        expect(parsed).toHaveProperty('content');
        expect(parsed).toHaveProperty('length');
        expect(parsed.path).toBe('notes/authentication.md');
        expect(parsed.content).toContain('Authentication');
      });

      it('should return error for non-existent document', async () => {
        const response = await server.memory_get('nonexistent/file.md');

        const parsed = JSON.parse(response.content[0].text);
        expect(parsed).toHaveProperty('error');
        expect(parsed.error).toBe('Document not found');
        expect(parsed.path).toBe('nonexistent/file.md');
      });
    });

    describe('verify_document', () => {
      it('should return exists: true for existing document', async () => {
        const response = await server.verify_document('notes/authentication.md');

        const parsed = JSON.parse(response.content[0].text);
        expect(parsed).toHaveProperty('exists');
        expect(parsed.exists).toBe(true);
      });

      it('should return exists: false for non-existent document', async () => {
        const response = await server.verify_document('nonexistent/file.md');

        const parsed = JSON.parse(response.content[0].text);
        expect(parsed.exists).toBe(false);
      });

      it('should NOT include blockchain fields for LocalEncryptedVault', async () => {
        const response = await server.verify_document('notes/authentication.md');

        const parsed = JSON.parse(response.content[0].text);
        expect(parsed.blockchainTxId).toBeUndefined();
        expect(parsed.uhrpUrl).toBeUndefined();
      });
    });
  });

  describe('with EncryptedShadVault', () => {
    let server: AGIdentityMemoryServer;
    let mockVault: MockEncryptedShadVault;

    beforeEach(() => {
      mockVault = new MockEncryptedShadVault(
        {
          'notes/design.md': '# Design Document\n\nSystem architecture overview.',
          'notes/security.md': '# Security\n\nEncryption and authentication.',
        },
        {
          'notes/design.md': {
            exists: true,
            uhrpUrl: 'uhrp://abc123',
            blockchainTxId: 'tx_abc123def456',
            timestamp: 1700000000,
            blockHeight: 800000,
          },
        }
      );

      server = new AGIdentityMemoryServer({
        vault: mockVault as any,
        userPublicKey: '03abc123',
      });
    });

    describe('memory_search', () => {
      it('should search using EncryptedShadVault', async () => {
        const response = await server.memory_search('design');
        const parsed = JSON.parse(response.content[0].text);

        expect(parsed.results.length).toBeGreaterThan(0);
        expect(parsed.results[0].path).toContain('design');
      });
    });

    describe('memory_get', () => {
      it('should get document from EncryptedShadVault', async () => {
        const response = await server.memory_get('notes/design.md');
        const parsed = JSON.parse(response.content[0].text);

        expect(parsed.path).toBe('notes/design.md');
        expect(parsed.content).toContain('Design Document');
      });
    });

    describe('verify_document', () => {
      it('should return full VaultProof with blockchain data', async () => {
        const response = await server.verify_document('notes/design.md');
        const parsed = JSON.parse(response.content[0].text);

        expect(parsed.exists).toBe(true);
        expect(parsed.uhrpUrl).toBe('uhrp://abc123');
        expect(parsed.blockchainTxId).toBe('tx_abc123def456');
        expect(parsed.timestamp).toBe(1700000000);
        expect(parsed.blockHeight).toBe(800000);
      });

      it('should return exists: false for non-existent document', async () => {
        const response = await server.verify_document('nonexistent.md');
        const parsed = JSON.parse(response.content[0].text);

        expect(parsed.exists).toBe(false);
      });
    });
  });

  describe('createAGIdentityMemoryServer factory', () => {
    it('should create server instance with LocalEncryptedVault', () => {
      const mockVault = new MockLocalEncryptedVault({
        'test.md': '# Test',
      });

      const server = createAGIdentityMemoryServer({
        vault: mockVault as any,
      });

      expect(server).toBeInstanceOf(AGIdentityMemoryServer);
    });

    it('should create server instance with EncryptedShadVault', () => {
      const mockVault = new MockEncryptedShadVault({
        'test.md': '# Test',
      });

      const server = createAGIdentityMemoryServer({
        vault: mockVault as any,
        userPublicKey: '03abc',
      });

      expect(server).toBeInstanceOf(AGIdentityMemoryServer);
    });

    it('should create working server that can search', async () => {
      const mockVault = new MockLocalEncryptedVault({
        'notes/test.md': '# Test content with keyword',
      });

      const server = createAGIdentityMemoryServer({
        vault: mockVault as any,
      });

      const response = await server.memory_search('keyword');
      const parsed = JSON.parse(response.content[0].text);

      expect(parsed.count).toBe(1);
    });
  });

  describe('MCP format compliance', () => {
    let server: AGIdentityMemoryServer;

    beforeEach(() => {
      const mockVault = new MockLocalEncryptedVault({
        'test.md': '# Test',
      });
      server = new AGIdentityMemoryServer({
        vault: mockVault as any,
      });
    });

    it('should return content array with type text', async () => {
      const response = await server.memory_search('test');

      expect(response.content).toBeDefined();
      expect(Array.isArray(response.content)).toBe(true);
      expect(response.content.length).toBeGreaterThan(0);
      expect(response.content[0].type).toBe('text');
      expect(typeof response.content[0].text).toBe('string');
    });

    it('should return valid JSON in text field', async () => {
      const response = await server.memory_search('test');

      expect(() => {
        JSON.parse(response.content[0].text);
      }).not.toThrow();
    });

    it('should follow MCP tool response interface', async () => {
      const response: MCPToolResponse = await server.memory_get('test.md');

      // Type check: ensure response matches MCPToolResponse
      const typeCheck: MCPToolResponse = response;
      expect(typeCheck.content).toBeDefined();
    });
  });
});
