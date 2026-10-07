import { StoreSchema } from "~shared/store/schema";
import { Constructor, Paths } from "~shared/types";
import { ServiceHost } from "../services/servicehost";
import YTMViewManager from "../services/ytmviewmanager";
import Service from "../services/service";
import IntegrationManager from "../services/integrationmanager";

// Enforces TypeScript to not allow overriding a method (MUST NOT BE EXPORTED)
declare const _never: unique symbol;
type NoOverride = { [_never]: typeof _never };

export default abstract class Integration {
  /**
   * The name of the integration
   */
  public abstract readonly name: string;
  /**
   * The store property which enables and disables this integration
   */
  public abstract readonly storeEnableProperty: Paths<StoreSchema>;
  /**
   * A list of dependent store properties which if changed should restart this integration
   */
  public readonly dependentStoreProperties: Paths<StoreSchema>[] = [];
  /**
   * A list of flags that will disable this integration regardless of the {@link storeEnableProperty}
   */
  public readonly disableFlags: string[] = [];

  #isEnabled = false;
  public get isEnabled() {
    return this.#isEnabled;
  }

  #host!: ServiceHost;

  constructor() {}

  /**
   * Setup the integration
   * 
   * @internal IntegrationManager calls this to setup the integration
   */
  public [IntegrationManager.SETUP]() {
    this.onSetup();
  }

  /**
   * Enables the integration
   * 
   * @internal IntegrationManager calls this to enable the integration
   */
  public [IntegrationManager.ENABLE]() {
    this.#isEnabled = true;
    this.onEnabled();
  }

  /**
   * Disables the integration
   * 
   * @internal IntegrationManager calls this to disable the integration
   */
  public async [IntegrationManager.DISABLE](): Promise<void> {
    this.#isEnabled = false;
    await this.onDisabled();
  }

  /**
   * @internal IntegrationManager calls this inject the ServiceHost
   * 
   * @param host 
   * @returns 
   */
  public [ServiceHost.INJECT](host: ServiceHost) {
    this.#host = host;
    return null;
  }

  protected getService<T extends Service>(service: Constructor<T>): T {
    return this.#host.getService<T>(service);
  }

  protected executeYTMScript(script: string) {
    const ytmViewManager = this.#host.getService(YTMViewManager);
    ytmViewManager.getView()?.webContents.send("ytmView:executeScript", script);
  }

  /**
   * The integration has been setup
   * 
   * @remarks This is run before the app has emitted ready
   * @remarks The integration is not enabled yet
   */
  protected abstract onSetup(): void;
  /**
   * The integration has been enabled
   *
   * @remarks This is always run after the app has emitted ready
   */
  protected abstract onEnabled(): void;
  /**
   * The integration has been enabled
   *
   * @remarks This is always run after the app has emitted ready
   */
  protected abstract onDisabled(): void;
}
