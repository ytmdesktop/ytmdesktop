import { Constructor, DependencyConstructor } from "~shared/types";
import { ServiceHost } from "./servicehost";
import EventEmitter from "node:events";

// Enforces TypeScript to not allow overriding a method (MUST NOT BE EXPORTED)
declare const _never: unique symbol;
type NoOverride = { [_never]: typeof _never };

export default abstract class Service {
  public static readonly dependencies: DependencyConstructor<Service>[] = [];

  public abstract onPreInitialized(): void;
  public abstract onInitialized(): void;
  public abstract onPostInitialized(): void;
  public abstract onTerminated(): void;

  private host: ServiceHost;

  /**
   * Gets a service dependency from the host for this service
   *
   * @param service The dependency service to get
   * @returns
   */
  public getDependency<T extends Service>(service?: Constructor<T>): T {
    const dependencies = (this.constructor as DependencyConstructor<Service>).dependencies;
    if (!dependencies.includes(service as DependencyConstructor<T>))
      throw new Error(`Attempt to get dependency service '${service.name}' but '${this.constructor.name}' does not depend on it`);

    return this.host.getService<T>(service);
  }

  /**
   * INTERNAL TO SERVICEHOST -- DO NOT USE
   *
   * This function sets the ServiceHost which this service is a part of
   *
   * @param host
   * @returns
   */
  public __setServiceHost(host: ServiceHost): NoOverride {
    this.host = host;
    return null;
  }

  /**
   * INTERNAL -- DO NOT USE
   *
   * This function gets the ServiceHost this service is a part of
   *
   * @returns The service host
   */
  protected __getServiceHost() {
    return this.host;
  }
}

export abstract class EventEmitterService<T extends Record<keyof T, unknown[]>> extends Service {
  private eventEmitter = new EventEmitter();

  public on<E extends Extract<keyof T, string>>(event: E, listener: (...args: T[E]) => void): this {
    this.eventEmitter.on(event, listener);
    return this;
  }

  public once<E extends Extract<keyof T, string>>(event: E, listener: (...args: T[E]) => void): this {
    this.eventEmitter.once(event, listener);
    return this;
  }

  public off<E extends Extract<keyof T, string>>(event: E, listener: (...args: T[E]) => void): this {
    this.eventEmitter.off(event, listener);
    return this;
  }

  protected emit<E extends Extract<keyof T, string>>(event: E, ...args: T[E]): boolean {
    return this.eventEmitter.emit(event, args);
  }
}
