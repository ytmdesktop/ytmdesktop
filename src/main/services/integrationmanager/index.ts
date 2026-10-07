import Integration from "../../integrations/integration";
import log from "electron-log";
import { StoreSchema } from "~shared/store/schema";
import { DependencyConstructor, ValueAtPath } from "~shared/types";
import Service, { EventEmitterService } from "../service";
import ConfigStore from "../configstore";
import { ServiceHost } from "../servicehost";

type IntegrationCreator<T> = new (...args: unknown[]) => T;
type IntegrationManagerEventMap = {
  "enable-error": [Integration, Error];
};
export enum IntegrationManagerHook {
  AppBeforeReady,
  AppReady
}

function getProperty<T, Path extends string>(obj: T, path: Path): ValueAtPath<T, Path> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return path.split(".").reduce((prev: any, curr) => prev && prev[curr], obj);
}

export default class IntegrationManager extends EventEmitterService<IntegrationManagerEventMap> {
  static readonly ENABLE = Symbol("IntegrationManager.ENABLE");
  static readonly DISABLE = Symbol("IntegrationManager.DISABLE");
  static readonly SETUP = Symbol("IntegrationManager.SETUP");

  public static override readonly dependencies: DependencyConstructor<Service>[] = [ConfigStore/*, FlagManager*/];

  private integrations: Integration[] = [];
  private enabledIntegrations: Integration[] = [];

  #host!: ServiceHost;

  // Specialty service which is allowed to obtain the ServiceHost directly
  public override [ServiceHost.INJECT](host: ServiceHost) {
    super[ServiceHost.INJECT](host);
    this.#host = host;
  }

  public override onPreInitialized() {}

  public onInitialized() {
    log.info("IntegrationManager initialized");
  }

  public override onPostInitialized() {
    const configStore = this.getDependency(ConfigStore);
    // const flagManager = this.getDependency(FlagManager);

    configStore.onDidAnyChange((newState, oldState) => this.reconcileIntegrationEnableState(newState, oldState));
    // flagManager.on("changed", () => {
    //   this.reconcileIntegrationEnableState();
    // });
  }

  public override onTerminated() {}

  /**
   * Enables an array of integrations in the order provided
   *
   * @param integrations List of integrations to enable
   */
  public createIntegrations(integrations: IntegrationCreator<Integration>[]) {
    for (const integration of integrations) {
      const constructedIntegration = new integration()
      constructedIntegration[ServiceHost.INJECT](this.#host);
      this.integrations.push(constructedIntegration);
    }
  }

  /**
   * Executes a lifecycle hook for the integration manager
   *
   * @param hook The hook to run
   */
  public runHook(hook: IntegrationManagerHook) {
    switch (hook) {
      case IntegrationManagerHook.AppBeforeReady: {
        this.runIntegrationSetups();
        break;
      }

      case IntegrationManagerHook.AppReady: {
        this.reconcileIntegrationEnableState();
        break;
      }
    }
  }

  private runIntegrationSetups() {
    for (const integration of this.integrations) {
      integration[IntegrationManager.SETUP]();
    }
  }

  private async reconcileIntegrationEnableState(newState?: Readonly<StoreSchema>, oldState?: Readonly<StoreSchema>) {
    const configStore = this.getDependency(ConfigStore);
    // const flagManager = this.getDependency(FlagManager);

    for (const integration of this.integrations) {
      // @ts-expect-error TODO: Fix configStore.get() here with correct type
      let shouldBeEnabled = newState ? getProperty(newState, integration.storeEnableProperty) : configStore.get(integration.storeEnableProperty);
      let disabledByFlag = false;
      // for (const flag of integration.disableFlags) {
      //   if (flagManager.getFlag(flag)) {
      //     shouldBeEnabled = false;
      //     disabledByFlag = true;
      //   }
      // }

      if (!integration.isEnabled) {
        if (shouldBeEnabled) {
          if (!this.enabledIntegrations.includes(integration)) {
            log.info(`Enabling integration: ${integration.name}`);

            integration[IntegrationManager.ENABLE]();

            this.enabledIntegrations.push(integration);
            log.info(`Enabled integration: ${integration.name}`);
          }
        }
      } else {
        if (!shouldBeEnabled) {
          if (this.enabledIntegrations.includes(integration)) {
            log.info(`Disabling integration: ${integration.name}` + (disabledByFlag ? ` (flag disabled)` : ``));

            await integration[IntegrationManager.DISABLE]();

            const index = this.enabledIntegrations.indexOf(integration, 0);
            if (index > -1) this.enabledIntegrations.splice(index, 1);
            log.info(`Disabled integration: ${integration.name}`);
          }
        } else {
          if (newState && oldState) {
            for (const dependent of integration.dependentStoreProperties) {
              const newProperty = getProperty(newState, dependent);
              const oldProperty = getProperty(oldState, dependent);

              if (newProperty != oldProperty) {
                log.info(`Restarting enabled integration: ${integration.name} (dependent properties changed)`);
                await integration[IntegrationManager.DISABLE]();
                integration[IntegrationManager.ENABLE]();
                log.info(`Restarted enabled integration: ${integration.name} (dependent properties changed)`);
              }
            }
          }
        }
      }
    }
  }
}
