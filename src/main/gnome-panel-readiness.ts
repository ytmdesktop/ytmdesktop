import { randomUUID } from "node:crypto";

/** A fresh app/extension session must confirm its loaded UI before replacing the tray. */
export default class GnomePanelReadiness {
  private session = randomUUID();
  private ready = false;
  private deadline = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    readonly version: number,
    private readonly changed: (ready: boolean) => void,
    private readonly timedOut: () => void,
    private readonly timeoutMs = 10000
  ) {}

  get isReady() {
    return this.ready;
  }

  get isPending() {
    return this.timer !== null;
  }

  get description() {
    return { version: this.version, session: this.session };
  }

  requestSession() {
    // The extension can return long after a lock screen or disable interval. Only a fresh
    // handshake renews an expired deadline; late reports for the old session still fail.
    if (!this.ready && (!this.deadline || Date.now() >= this.deadline)) this.begin();
    return this.description;
  }

  begin() {
    this.stop();
    this.session = randomUUID();
    this.deadline = Date.now() + this.timeoutMs;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.deadline = 0;
      this.timedOut();
      this.changed(false);
    }, this.timeoutMs);
  }

  report(version: number, session: string): boolean {
    if (session !== this.session || version !== this.version) return false;
    if (this.ready) return true;
    if (!this.deadline || Date.now() >= this.deadline) return false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.ready = true;
    this.changed(true);
    return true;
  }

  stop() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.deadline = 0;
    if (this.ready) {
      this.ready = false;
      this.changed(false);
    }
  }
}
