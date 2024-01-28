export default interface IIntegration {
  // For integration makers, ensure provide() is always called before enable() is called
  // It is expected to call provide() before enable() on an integration for the first time
  // It is OK to call provide at any point in time to update the integration with new or different data should it have changed
  provide(...args: unknown[]): void;
  enable(): void;
  disable(): void;
  getYTMScripts(): { name: string; script: string }[];
}
