import { Constructor } from "~shared/types";
import Service from "./service";
import { ServiceCollection } from "./servicecollection";

export enum ServiceHostLifecycle {
  NotInitialized,
  PreInitialized,
  Initialized,
  PostInitialized,
  Terminated
}

export class ServiceHost {
  private services = new Map<string, Service>();
  private lifecycle = ServiceHostLifecycle.NotInitialized;

  public get initialized() {
    return this.lifecycle === ServiceHostLifecycle.Initialized || this.lifecycle === ServiceHostLifecycle.PostInitialized;
  }

  public constructor(collection: ServiceCollection) {
    const services = collection.getDependencyOrderedServices();
    for (const service of services) {
      const constructedService = new service();
      constructedService.__setServiceHost(this);
      this.services.set(service.name, constructedService);
    }
  }

  public getService<T>(service?: Constructor<T>): T {
    return this.services.get(service.name) as T;
  }

  /**
   * Executes the next lifecycle for the service host
   */
  public runNextLifecycle() {
    const nextLifecycle: ServiceHostLifecycle = ++this.lifecycle;
    switch (nextLifecycle) {
      case ServiceHostLifecycle.PreInitialized: {
        for (const service of this.services.values()) {
          service.onPreInitialized();
        }
        break;
      }

      case ServiceHostLifecycle.Initialized: {
        for (const service of this.services.values()) {
          service.onInitialized();
        }
        break;
      }

      case ServiceHostLifecycle.PostInitialized: {
        for (const service of this.services.values()) {
          service.onPostInitialized();
        }
        break;
      }

      case ServiceHostLifecycle.Terminated: {
        for (const service of this.services.values()) {
          service.onTerminated();
        }
        break;
      }
    }
  }
}
