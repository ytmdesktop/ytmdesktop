/**
 * WeakCache - Professional WeakMap-based caching utility
 *
 * Uses WeakMap to store temporary references that don't prevent garbage collection.
 * Perfect for caching computed values or temporary associations.
 *
 * Benefits:
 * - Objects can be garbage collected when no longer referenced elsewhere
 * - No memory leaks from forgotten cache entries
 * - Automatic cleanup
 *
 * Usage:
 *   const cache = new WeakCache<MyObject, ComputedValue>()
 *   cache.set(object, computedValue)
 *   const value = cache.get(object)
 */
export default class WeakCache<K extends object, V> {
  private cache: WeakMap<K, V> = new WeakMap();

  /**
   * Store a value in the cache
   * @param key Object to use as key (must be an object, not a primitive)
   * @param value Value to cache
   */
  set(key: K, value: V): void {
    this.cache.set(key, value);
  }

  /**
   * Retrieve a value from the cache
   * @param key Object key
   * @returns Cached value or undefined if not found
   */
  get(key: K): V | undefined {
    return this.cache.get(key);
  }

  /**
   * Check if a key exists in the cache
   * @param key Object key
   * @returns true if key exists
   */
  has(key: K): boolean {
    return this.cache.has(key);
  }

  /**
   * Remove a key from the cache
   * @param key Object key
   * @returns true if key was present and removed
   */
  delete(key: K): boolean {
    return this.cache.delete(key);
  }

  /**
   * Get or compute a value
   * If the value exists in cache, return it.
   * Otherwise, compute it, cache it, and return it.
   *
   * @param key Object key
   * @param compute Function to compute the value if not cached
   * @returns The cached or computed value
   */
  getOrCompute(key: K, compute: (key: K) => V): V {
    if (this.has(key)) {
      return this.get(key)!;
    }

    const value = compute(key);
    this.set(key, value);
    return value;
  }
}

/**
 * Example usage patterns:
 *
 * // Cache window bounds
 * const windowBoundsCache = new WeakCache<BrowserWindow, Electron.Rectangle>()
 * windowBoundsCache.set(window, window.getBounds())
 *
 * // Cache computed component data
 * const componentCache = new WeakCache<Component, ComputedData>()
 * const data = componentCache.getOrCompute(component, (c) => expensiveComputation(c))
 *
 * // Store temporary associations
 * const viewToWindowMap = new WeakCache<BrowserView, BrowserWindow>()
 * viewToWindowMap.set(view, window)
 */
