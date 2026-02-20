/**
 * Memory management for AGIdentity agent
 * Provides encrypted blockchain-backed storage with cryptographic ownership
 */

export * from './memory-types.js';
export { storeMemory } from './memory-writer.js';
export { listMemories, type Memory } from './memory-reader.js';
export { applyGarbageCollection, RETENTION_POLICY, type GCStats } from './memory-gc.js';
