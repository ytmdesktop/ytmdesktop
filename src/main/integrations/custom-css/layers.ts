export interface CSSView {
  isDestroyed(): boolean;
  insertCSS(css: string): Promise<string>;
  removeInsertedCSS(key: string): Promise<void>;
}
export class CSSLayers {
  private queue = Promise.resolve();
  private revision = 0;
  private active: { view: CSSView; keys: string[] } | null = null;
  public set(view: CSSView | null, layers: string[]): Promise<void> {
    const revision = ++this.revision;
    const operation = this.queue.then(async () => {
      if (this.active) {
        const old = this.active;
        this.active = null;
        if (!old.view.isDestroyed())
          for (const key of old.keys) {
            try {
              await old.view.removeInsertedCSS(key);
            } catch {
              /* navigation invalidates keys */
            }
          }
      }
      if (!view || view.isDestroyed() || revision !== this.revision) return;
      this.active = { view, keys: [] };
      for (const css of layers.filter(Boolean)) {
        if (revision !== this.revision || view.isDestroyed()) return;
        const key = await view.insertCSS(css);
        this.active.keys.push(key);
      }
    });
    this.queue = operation.catch(() => {});
    return operation;
  }
}
