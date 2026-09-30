export class YTMHook {
  private _ytmStateStore;
  private _ytmPlayerController;
  public get ytmStateStore(): unknown {
    return this._ytmStateStore;
  }
  public get ytmPlayerController(): unknown {
    return this._ytmPlayerController;
  }

  public init() {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;

    // This hook is designed to capture addProvider calls which contain the dependency injection into elements within YTM
    const mapSet = Map.prototype.set;
    Object.defineProperty(Map.prototype, "set", {
      value: function (key, value) {
        if (key.name && key.name === "PLAYER_CONTROLLER_TOKEN") {
          if (value.useClass) {
            const OriginalClass = value.useClass;

            value.useClass = new Proxy(OriginalClass, {
              construct(target, args, newTarget) {
                const instance = Reflect.construct(target, args, newTarget);
                self._ytmPlayerController = instance;
                return instance;
              },
              get(target, prop, receiver) {
                return Reflect.get(target, prop, receiver);
              }
            });
          }
        }

        if (key.name && key.name === "STATE_STORE_TOKEN") {
          if (value.useFactory) {
            const originalFactory = value.useFactory;

            value.useFactory = new Proxy(originalFactory, {
              apply(target, thisArg, args) {
                const instance = Reflect.apply(target, thisArg, args);
                self._ytmStateStore = instance;
                return instance;
              }
            });
          }
        }
        return mapSet.call(this, key, value);
      }
    });
  }

  public async ready(): Promise<void> {
    if (this._ytmStateStore && this._ytmPlayerController) return Promise.resolve();

    return new Promise<void>(resolve => {
      const interval = setInterval(() => {
        if (this._ytmStateStore && this._ytmPlayerController) {
          resolve();
          clearInterval(interval);
        }
      });
    });
  }
}

export default new YTMHook();
