/**
 * Generic fixed-capacity circular buffer.
 *
 * Overwrites the oldest entry when full. Items are stored in insertion
 * order and can be retrieved chronologically via toArray().
 */

export class RingBuffer<T> {
  private buffer: (T | undefined)[];
  private head = 0;
  private count = 0;

  constructor(private readonly capacity: number) {
    if (capacity < 1) {
      throw new Error("RingBuffer capacity must be at least 1");
    }
    this.buffer = new Array<T | undefined>(capacity).fill(undefined);
  }

  /**
   * Add an item to the buffer. If the buffer is full the oldest item
   * is overwritten.
   */
  push(item: T): void {
    this.buffer[this.head] = item;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) {
      this.count++;
    }
  }

  /**
   * Return all items in insertion order (oldest first).
   */
  toArray(): T[] {
    if (this.count === 0) {
      return [];
    }
    if (this.count < this.capacity) {
      // Buffer is not full -- items are at indices 0..count-1
      return this.buffer.slice(0, this.count) as T[];
    }
    // Buffer is full -- head points to the oldest slot
    const tail = this.buffer.slice(this.head) as T[];
    const front = this.buffer.slice(0, this.head) as T[];
    return tail.concat(front);
  }

  /**
   * Current number of items in the buffer.
   */
  get length(): number {
    return this.count;
  }

  /**
   * The most recently pushed item, or undefined if empty.
   */
  get latest(): T | undefined {
    if (this.count === 0) {
      return undefined;
    }
    return this.buffer[(this.head - 1 + this.capacity) % this.capacity];
  }

  /**
   * Reset the buffer, removing all items.
   */
  clear(): void {
    this.buffer.fill(undefined);
    this.head = 0;
    this.count = 0;
  }
}
