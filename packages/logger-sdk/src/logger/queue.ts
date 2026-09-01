/**
 * A fixed-capacity FIFO buffer with drop-oldest overflow.
 *
 * Bounded memory is the whole point: a browser tab that goes offline, or a
 * Node process whose ingest host is unreachable, keeps logging. An unbounded
 * queue would turn a logging library into the reason the tab dies.
 *
 * Drop-oldest rather than drop-newest because the events that explain a
 * failure are the ones nearest to it, and a ring buffer rather than an array
 * because `Array.prototype.shift` on a full 1000-event queue would move a
 * thousand slots on every single log call once saturated.
 */
export class BoundedQueue<T> {
  private readonly slots: (T | undefined)[];
  private head = 0;
  private count = 0;
  private dropped = 0;

  /**
   * @param capacity - Maximum retained items. Coerced to at least 1.
   */
  constructor(capacity: number) {
    const usable = Number.isFinite(capacity) ? Math.floor(capacity) : 1;
    this.slots = new Array<T | undefined>(Math.max(1, usable));
  }

  /** Items currently buffered. */
  get size(): number {
    return this.count;
  }

  /** Items discarded to stay within capacity, for the lifetime of the queue. */
  get droppedCount(): number {
    return this.dropped;
  }

  /** Appends an item, evicting the oldest when full. */
  push(item: T): void {
    const capacity = this.slots.length;

    if (this.count === capacity) {
      this.slots[this.head] = undefined;
      this.head = (this.head + 1) % capacity;
      this.count -= 1;
      this.dropped += 1;
    }

    this.slots[(this.head + this.count) % capacity] = item;
    this.count += 1;
  }

  /**
   * Removes and returns up to `limit` items, oldest first.
   *
   * @param limit - Maximum number of items to take.
   * @returns The taken items, in insertion order.
   */
  take(limit: number): T[] {
    const wanted = Math.max(0, Math.min(limit, this.count));
    const taken: T[] = [];
    const capacity = this.slots.length;

    for (let index = 0; index < wanted; index += 1) {
      const slot = (this.head + index) % capacity;
      const item = this.slots[slot];
      this.slots[slot] = undefined;
      if (item !== undefined) taken.push(item);
    }

    this.head = (this.head + wanted) % capacity;
    this.count -= wanted;
    return taken;
  }

  /**
   * Returns items to the FRONT of the queue, preserving their order.
   *
   * Used when a batch could not be sent: the failed events keep their place
   * ahead of anything logged since. Items that no longer fit are counted as
   * dropped, exactly as an overflowing `push` would.
   *
   * @param items - The items to restore, oldest first.
   */
  restore(items: readonly T[]): void {
    const capacity = this.slots.length;

    for (let index = items.length - 1; index >= 0; index -= 1) {
      const item = items[index];
      if (item === undefined) continue;

      if (this.count === capacity) {
        this.dropped += 1;
        continue;
      }

      this.head = (this.head - 1 + capacity) % capacity;
      this.slots[this.head] = item;
      this.count += 1;
    }
  }

  /** Discards everything buffered, counting it as dropped. */
  clear(): void {
    this.dropped += this.count;
    this.slots.fill(undefined);
    this.head = 0;
    this.count = 0;
  }
}
