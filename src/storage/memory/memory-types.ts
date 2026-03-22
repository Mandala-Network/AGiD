/**
 * Memory input for creating new agent memories
 */
export interface MemoryInput {
  content: string;
  tags: string[];
}

/**
 * Memory token representing stored memory on blockchain
 */
export interface MemoryToken {
  txid: string;
  uhrpUrl: string;
  tags: string[];
  createdAt: number;
}
