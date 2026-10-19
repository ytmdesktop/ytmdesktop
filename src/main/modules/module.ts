/**
 * MModules Interface
 * Defines the required methods used by every module.
 * @author Akiisqt <aki@devours.rocks>
 */
export default interface MModules {
  /**
   * Initializes the module, additional arguments may differ.
   * @param args - Optional, module-specific
   */
  initialize(...args: unknown[]): void;

  /**
   * Provide additional arguments after initialization, additional arguments may differ.
   * @param args - Optional, module-specific
   */
  provide(...args: unknown[]): void;

  /**
   * Stops the module, and used resources are released.
   */
  terminate(): void;
}
