import { StoreSchema } from "~shared/store/schema";
import { Constructor, Paths } from "~shared/types";
import { ServiceHost } from "../services/servicehost";
import YTMViewManager from "../services/ytmviewmanager";
import Service from "../services/service";

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

  private _isEnabled = false;
  public get isEnabled() {
    return this._isEnabled;
  }

  private host: ServiceHost;

  constructor() {}

  /**
   * Enables the integration
   */
  public enable(): NoOverride {
    this._isEnabled = true;
    this.onEnabled();
    return null;
  }

  /**
   * Disables the integration
   */
  public async disable(): Promise<NoOverride> {
    this._isEnabled = false;
    await this.onDisabled();
    return null;
  }

  public __setServiceHost(host: ServiceHost): NoOverride {
    this.host = host;
    return null;
  }

  protected getService<T extends Service>(service?: Constructor<T>): T {
    return this.host.getService<T>(service);
  }

  protected executeYTMScript(script: string): NoOverride {
    const ytmViewManager = this.host.getService(YTMViewManager);
    ytmViewManager.getView().webContents.send("remoteControl:executeScript", script);
    return null;
  }

  /**
   * This function is run before the app has emitted ready
   *
   * The integration is not enabled at this point
   */
  public abstract onSetup(): void;
  /**
   * The integration ias been enabled
   *
   * This is always run after the app has emitted ready
   */
  public abstract onEnabled(): void;
  /**
   * The integration ias been enabled
   *
   * This is always run after the app has emitted ready
   */
  public abstract onDisabled(): void;
}
