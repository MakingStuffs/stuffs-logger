import { describe, expect, it } from "vitest";

import { BoundedQueue } from "./queue";

describe("BoundedQueue", () => {
  it("returns items oldest first", () => {
    const queue = new BoundedQueue<number>(4);
    queue.push(1);
    queue.push(2);

    expect(queue.take(10)).toEqual([1, 2]);
    expect(queue.size).toBe(0);
  });

  it("drops the oldest items once capacity is reached", () => {
    const queue = new BoundedQueue<number>(3);
    for (const value of [1, 2, 3, 4, 5]) queue.push(value);

    expect(queue.take(10)).toEqual([3, 4, 5]);
    expect(queue.droppedCount).toBe(2);
  });

  it("keeps accepting items indefinitely without growing", () => {
    const queue = new BoundedQueue<number>(2);
    for (let index = 0; index < 1000; index += 1) queue.push(index);

    expect(queue.size).toBe(2);
    expect(queue.droppedCount).toBe(998);
    expect(queue.take(10)).toEqual([998, 999]);
  });

  it("takes only the number of items asked for", () => {
    const queue = new BoundedQueue<number>(5);
    for (const value of [1, 2, 3, 4]) queue.push(value);

    expect(queue.take(2)).toEqual([1, 2]);
    expect(queue.take(2)).toEqual([3, 4]);
  });

  it("returns restored items ahead of newer ones", () => {
    const queue = new BoundedQueue<number>(5);
    queue.push(3);
    queue.restore([1, 2]);

    expect(queue.take(10)).toEqual([1, 2, 3]);
  });

  it("counts restored items that no longer fit as dropped", () => {
    const queue = new BoundedQueue<number>(2);
    queue.push(9);
    queue.restore([1, 2]);

    expect(queue.take(10)).toEqual([2, 9]);
    expect(queue.droppedCount).toBe(1);
  });

  it("counts everything discarded by clear", () => {
    const queue = new BoundedQueue<number>(4);
    queue.push(1);
    queue.push(2);
    queue.clear();

    expect(queue.size).toBe(0);
    expect(queue.droppedCount).toBe(2);
  });

  it("treats a nonsensical capacity as one", () => {
    const queue = new BoundedQueue<number>(0);
    queue.push(1);
    queue.push(2);

    expect(queue.take(10)).toEqual([2]);
  });
});
