import { StoreSchema } from "~shared/store/schema";
import { Paths } from "~shared/types";
import ytmviewmanager from "../ytmviewmanager";

// Enforces TypeScript to not allow overriding a method
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

  protected executeYTMScript(script: string): NoOverride {
    ytmviewmanager.getView().webContents.send("remoteControl:executeScript", script);
    return null;
  }

  public abstract onEnabled(): void;
  public abstract onDisabled(): void;
}
