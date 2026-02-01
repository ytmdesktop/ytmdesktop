import { describe, expect, it, vi } from "vitest";
import WeakCache from "./weak-cache";

describe("WeakCache", () => {
  it("sets/gets/has/deletes values by object key", () => {
    const cache = new WeakCache<object, number>();
    const key = {};

    expect(cache.has(key)).toBe(false);
    expect(cache.get(key)).toBeUndefined();

    cache.set(key, 123);
    expect(cache.has(key)).toBe(true);
    expect(cache.get(key)).toBe(123);

    expect(cache.delete(key)).toBe(true);
    expect(cache.has(key)).toBe(false);
    expect(cache.get(key)).toBeUndefined();
  });

  it("getOrCompute caches the computed value and only computes once per key", () => {
    const cache = new WeakCache<object, string>();
    const key = {};
    const compute = vi.fn(() => "value");

    expect(cache.getOrCompute(key, compute)).toBe("value");
    expect(cache.getOrCompute(key, compute)).toBe("value");

    expect(compute).toHaveBeenCalledTimes(1);
  });
});
