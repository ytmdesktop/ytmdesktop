import log from "electron-log";
import { MessageBus, sessionBus, toPlain } from "dbus-native";

export const MINI_PLAYER_EXTENSION_UUID = "ytmdesktop-miniplayer@ytmdesktop";

const SHELL_SERVICE = "org.gnome.Shell";
const SHELL_PATH = "/org/gnome/Shell";
const SHELL_EXTENSIONS_INTERFACE = "org.gnome.Shell.Extensions";
const DBUS_SERVICE = "org.freedesktop.DBus";
const DBUS_PATH = "/org/freedesktop/DBus";
const DBUS_INTERFACE = "org.freedesktop.DBus";

// org.gnome.Shell.Extensions reports ExtensionState.ENABLED as 1.
const EXTENSION_STATE_ENABLED = 1;
const QUERY_TIMEOUT_MS = 5000;

// GNOME Shell answers GetExtensionInfo for an unknown extension with an empty dictionary.
type ExtensionInfo = {
  enabled?: boolean;
  state?: number;
};

/**
 * Whether this session is GNOME Shell, and therefore able to host the mini-player extension.
 *
 * Distributions prepend their own name, so `XDG_CURRENT_DESKTOP` is a colon separated list such
 * as `ubuntu:GNOME` or `pop:GNOME`, and GNOME's own variants are named `GNOME-Classic` and
 * `GNOME-Flashback`.
 */
export function isGnomeSession() {
  return [process.env.XDG_CURRENT_DESKTOP, process.env.XDG_SESSION_DESKTOP, process.env.DESKTOP_SESSION]
    .filter((value): value is string => !!value)
    .flatMap(value => value.toLowerCase().split(":"))
    .some(name => name === "gnome" || name.startsWith("gnome-"));
}

/**
 * Tracks whether the GNOME mini-player extension is currently enabled.
 *
 * The extension is installed separately from the application, so it can be added, removed, or
 * disabled while the app is running, and GNOME Shell itself can start after the app or be
 * restarted underneath it. Callers use this to decide whether a fallback tray icon is needed.
 */
export default class GnomeShellExtensionWatcher {
  private bus: MessageBus | null = null;
  private enabled = false;
  private stopped = false;

  constructor(private readonly onEnabledChanged: (enabled: boolean) => void) {}

  get isEnabled() {
    return this.enabled;
  }

  async start() {
    if (this.bus || this.stopped) return;

    const bus = sessionBus({ reconnect: true });
    bus.connection.on("error", error => log.error("GNOME extension watcher D-Bus error", error));
    // Signals that fired while the connection was down were missed, so re-read the current state.
    bus.on("reconnected", () => void this.refresh());
    this.bus = bus;

    await this.watchSignal(
      `type='signal',sender='${SHELL_SERVICE}',interface='${SHELL_EXTENSIONS_INTERFACE}',member='ExtensionStateChanged'`,
      bus.mangle(SHELL_PATH, SHELL_EXTENSIONS_INTERFACE, "ExtensionStateChanged"),
      uuid => uuid === MINI_PLAYER_EXTENSION_UUID
    );

    // GNOME Shell may claim its bus name after this app starts, and it survives its own restarts.
    await this.watchSignal(
      `type='signal',sender='${DBUS_SERVICE}',interface='${DBUS_INTERFACE}',member='NameOwnerChanged',arg0='${SHELL_SERVICE}'`,
      bus.mangle(DBUS_PATH, DBUS_INTERFACE, "NameOwnerChanged"),
      name => name === SHELL_SERVICE
    );

    await this.refresh();
  }

  async stop() {
    this.stopped = true;

    const bus = this.bus;
    this.bus = null;
    if (!bus) return;

    try {
      await bus.close();
    } catch (error) {
      log.error("Failed to close the GNOME extension watcher D-Bus connection", error);
    }
  }

  /**
   * Subscribe to one signal, keyed on its first argument.
   *
   * A rejected match rule only costs live updates, so it is logged rather than thrown: the initial
   * query still decides whether the extension is serving this session.
   */
  private async watchSignal(matchRule: string, signalKey: string, matches: (firstArgument: unknown) => boolean) {
    const bus = this.bus;
    if (!bus) return;

    try {
      await bus.addMatch(matchRule);
    } catch (error) {
      log.error("Failed to watch a GNOME extension D-Bus signal", matchRule, error);
      return;
    }

    bus.signals.on(signalKey, (body: unknown[]) => {
      if (!matches(body?.[0])) return;
      void this.refresh();
    });
  }

  private async refresh() {
    const enabled = await this.queryEnabled();
    if (this.stopped || enabled === this.enabled) return;

    this.enabled = enabled;
    log.info(`GNOME mini-player extension is ${enabled ? "enabled" : "unavailable"}`);
    this.onEnabledChanged(enabled);
  }

  private async queryEnabled() {
    const bus = this.bus;
    if (!bus) return false;

    try {
      const info = toPlain<ExtensionInfo>(
        await bus.invoke(
          {
            destination: SHELL_SERVICE,
            path: SHELL_PATH,
            interface: SHELL_EXTENSIONS_INTERFACE,
            member: "GetExtensionInfo",
            signature: "s",
            body: [MINI_PLAYER_EXTENSION_UUID]
          },
          { timeout: QUERY_TIMEOUT_MS }
        )
      );
      return info?.enabled === true && info?.state === EXTENSION_STATE_ENABLED;
    } catch {
      // GNOME Shell is not on the bus, or is not answering. Either way the extension cannot be running.
      return false;
    }
  }
}
