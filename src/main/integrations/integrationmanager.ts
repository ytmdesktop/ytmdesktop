import EventEmitter from "node:events";
import Integration from "./integration";
import configStore from "../config-store";
import log from "electron-log";
import { StoreSchema } from "~shared/store/schema";
import { ValueAtPath } from "~shared/types";

type IntegrationCreator<T> = new (...args: unknown[]) => T;
type IntegrationManagerEventMap = {
  "enable-error": [Integration, Error];
};
export enum IntegrationManagerHook {
  AppReady
}

function getProperty<T, Path extends string>(obj: T, path: Path): ValueAtPath<T, Path> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return path.split(".").reduce((prev: any, curr) => prev && prev[curr], obj);
}

class IntegrationManager extends EventEmitter<IntegrationManagerEventMap> {
  private integrations: Integration[] = [];
  private enabledIntegrations: Integration[] = [];

  public initialize() {
    configStore.onDidAnyChange((newState, oldState) => this.reconcileIntegrationEnableState(newState, oldState));

    log.info("IntegrationManager initialized");
  }

  /**
   * Enables an array of integrations in the order provided
   *
   * @param integrations List of integrations to enable
   */
  public createIntegrations(integrations: IntegrationCreator<Integration>[]) {
    for (const integration of integrations) {
      const constructedIntegration = new integration();
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
      case IntegrationManagerHook.AppReady: {
        this.reconcileIntegrationEnableState();
        break;
      }
    }
  }

  private async reconcileIntegrationEnableState(newState?: Readonly<StoreSchema>, oldState?: Readonly<StoreSchema>) {
    for (const integration of this.integrations) {
      const shouldBeEnabled = newState ? getProperty(newState, integration.storeEnableProperty) : configStore.get(integration.storeEnableProperty);
      if (!integration.isEnabled) {
        if (shouldBeEnabled) {
          if (!this.enabledIntegrations.includes(integration)) {
            log.info(`Enabling integration: ${integration.name}`);

            integration.enable();

            this.enabledIntegrations.push(integration);
            log.info(`Enabled integration: ${integration.name}`);
          }
        }
      } else {
        if (!shouldBeEnabled) {
          if (this.enabledIntegrations.includes(integration)) {
            log.info(`Disabling integration: ${integration.name}`);

            await integration.disable();

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
                await integration.disable();
                integration.enable();
                log.info(`Restarted enabled integration: ${integration.name} (dependent properties changed)`);
              }
            }
          }
        }
      }
    }
  }
}

export default new IntegrationManager();
