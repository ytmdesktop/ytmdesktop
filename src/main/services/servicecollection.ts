import { Constructor, DependencyConstructor } from "~shared/types";
import Service from "./service";

/**
 * A collection of services that a ServiceHost will run.
 *
 * Services are instantiated in the order they are added unless a dependency is involved. If a dependency is involved the dependency will be reordered to come first.
 * @example
 *  // ServiceC depends on ServiceD so the finalized order would be [ServiceA, ServiceB, ServiceD, ServiceC]
 *  ServiceCollection.addServices([ServiceA, ServiceB, ServiceC, ServiceD])
 */
export class ServiceCollection {
  private services = new Map<string, DependencyConstructor<Service>>();

  public addServices(services: DependencyConstructor<Service>[]) {
    for (const service of services) {
      if (this.services.has(service.name)) throw new Error(`Service with name '${service.name}' already exists and cannot be used`);
      this.services.set(service.name, service);
    }
  }

  public getDependencyOrderedServices() {
    const sorted: Constructor<Service>[] = [];
    const visited = new Set();

    const visit = (service: DependencyConstructor<Service>, stack: Set<DependencyConstructor<Service>>) => {
      if (!visited.has(service)) {
        visited.add(service);
        const dependencies = service.dependencies;
        stack.add(service);
        for (const dependency of dependencies) {
          if (!this.services.has(dependency.name))
            throw new Error(`Service '${service.name}' depends on '${dependency.name}' but it is not in the service collection`);
          if (!stack.has(dependency)) {
            visit(dependency, stack);
          } else {
            throw new Error(`Service '${service.name}' depends on '${dependency.name}' but this would result in a circular dependency`);
          }
        }
        stack.delete(service);
        sorted.push(service);
      }
    };

    for (const kvPair of this.services) {
      const service = kvPair[1];
      if (!visited.has(service)) {
        visit(service, new Set());
      }
    }

    return sorted;
  }
}
