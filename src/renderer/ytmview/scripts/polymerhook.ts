export class PolymerHook {
  private _ytmStore;
  private _ytmPlayerBar;
  public get ytmStore(): unknown {
    return this._ytmStore;
  }
  public get ytmPlayerBar(): unknown {
    return this._ytmPlayerBar;
  }

  public init() {
    window.__YTMD_HOOK__ = {};

    // It's OK to alias this here as we're hooking YTMs passed `this`
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    const fakeBaseClass = function () {
      try {
        if (!self._ytmPlayerBar) {
          if (this.hostElement && this.hostElement.nodeName === "YTMUSIC-PLAYER-BAR") {
            window.__YTMD_HOOK__.ytmPlayerBar = this;
            self._ytmPlayerBar = this;
          }
        }

        if (!self._ytmStore) {
          if (this.store && !!this.store.getState && !!this.store.dispatch && !!this.store.subscribe) {
            window.__YTMD_HOOK__.ytmStore = this.store;
            self._ytmStore = this.store;
          }
        }
      } catch {
        /* empty */
      }
    };
    Object.defineProperty(window, "PolymerFakeBaseClassWithoutHtml", {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      set: _value => {},
      get: () => {
        return fakeBaseClass;
      }
    });
  }

  public async ready(): Promise<void> {
    if (this._ytmStore) return Promise.resolve();

    return new Promise<void>(resolve => {
      const interval = setInterval(() => {
        if (this._ytmStore) {
          resolve();
          clearInterval(interval);
        }
      });
    });
  }
}

export default new PolymerHook();
