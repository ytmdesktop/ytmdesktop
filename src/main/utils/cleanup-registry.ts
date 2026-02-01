import log from "electron-log";

/**
 * CleanupRegistry - Professional pattern for managing disposable resources
 *
 * This class provides a centralized way to track and cleanup:
 * - Event listeners
 * - Intervals and timeouts
 * - Custom cleanup functions
 * - Resource disposal
 *
 * Usage:
 *   const registry = new CleanupRegistry()
 *   registry.registerInterval(setInterval(...))
 *   registry.register(() => someObject.dispose())
 *   // Later, when cleaning up:
 *   registry.cleanup()
 */
export default class CleanupRegistry {
  private cleanupFunctions: Set<() => void> = new Set();
  private intervals: Set<NodeJS.Timeout> = new Set();
  private timeouts: Set<NodeJS.Timeout> = new Set();
  private isCleanedUp = false;

  /**
   * Register a custom cleanup function
   * @param cleanup Function to call during cleanup
   */
  register(cleanup: () => void): void {
    if (this.isCleanedUp) {
      log.warn("Attempted to register cleanup on already cleaned registry");
      return;
    }
    this.cleanupFunctions.add(cleanup);
  }

  /**
   * Register an interval to be cleared on cleanup
   * @param interval NodeJS.Timeout from setInterval
   */
  registerInterval(interval: NodeJS.Timeout): void {
    if (this.isCleanedUp) {
      log.warn("Attempted to register interval on already cleaned registry");
      clearInterval(interval);
      return;
    }
    this.intervals.add(interval);
  }

  /**
   * Register a timeout to be cleared on cleanup
   * @param timeout NodeJS.Timeout from setTimeout
   */
  registerTimeout(timeout: NodeJS.Timeout): void {
    if (this.isCleanedUp) {
      log.warn("Attempted to register timeout on already cleaned registry");
      clearTimeout(timeout);
      return;
    }
    this.timeouts.add(timeout);
  }

  /**
   * Unregister a previously registered interval
   * Useful when an interval is cleared before cleanup
   * @param interval NodeJS.Timeout to remove from registry
   */
  unregisterInterval(interval: NodeJS.Timeout): void {
    this.intervals.delete(interval);
  }

  /**
   * Unregister a previously registered timeout
   * @param timeout NodeJS.Timeout to remove from registry
   */
  unregisterTimeout(timeout: NodeJS.Timeout): void {
    this.timeouts.delete(timeout);
  }

  /**
   * Execute all cleanup operations
   * - Clears all intervals
   * - Clears all timeouts
   * - Executes all cleanup functions
   * - Prevents further registrations
   */
  cleanup(): void {
    if (this.isCleanedUp) {
      log.warn("Cleanup called on already cleaned registry");
      return;
    }

    log.info(`Cleaning up registry: ${this.intervals.size} intervals, ${this.timeouts.size} timeouts, ${this.cleanupFunctions.size} functions`);

    // Clear all intervals
    for (const interval of this.intervals) {
      try {
        clearInterval(interval);
      } catch (error) {
        log.error("Error clearing interval:", error);
      }
    }
    this.intervals.clear();

    // Clear all timeouts
    for (const timeout of this.timeouts) {
      try {
        clearTimeout(timeout);
      } catch (error) {
        log.error("Error clearing timeout:", error);
      }
    }
    this.timeouts.clear();

    // Execute all cleanup functions
    for (const cleanupFn of this.cleanupFunctions) {
      try {
        cleanupFn();
      } catch (error) {
        log.error("Error executing cleanup function:", error);
      }
    }
    this.cleanupFunctions.clear();

    this.isCleanedUp = true;
  }

  /**
   * Check if cleanup has been performed
   */
  get cleaned(): boolean {
    return this.isCleanedUp;
  }

  /**
   * Get the current count of registered resources
   */
  getStats(): { intervals: number; timeouts: number; functions: number } {
    return {
      intervals: this.intervals.size,
      timeouts: this.timeouts.size,
      functions: this.cleanupFunctions.size
    };
  }
}
