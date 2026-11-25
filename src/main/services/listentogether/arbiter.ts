import {
  type ListenTogetherLogger,
  noopLogger,
} from "~shared/listentogether/logger";
import type ProtectedAPIManager from "../protectedapimanager";

export const LOCAL_ALLOWED_COMMANDS = new Set<string>([
  "volumeUp",
  "volumeDown",
  "setVolume",
  "mute",
  "unmute",
  "toggleMute",
  "toggleLike",
  "toggleDislike",
]);

export type HostTransportCommand =
  | "play"
  | "pause"
  | "playPause"
  | "next"
  | "seekTo";

export const HOST_TRANSPORT_COMMANDS = new Set<HostTransportCommand>([
  "play",
  "pause",
  "playPause",
  "next",
  "seekTo",
]);

export type PlaybackArbiterSessionState = {
  active: boolean;
  isHost: boolean;
  listeningMode?: "room" | "local";
};

export interface PlaybackArbiterOptions {
  onHostTransport?: (command: HostTransportCommand, ...args: unknown[]) => void;
  onGuestBlockedCommand?: (command: string, ...args: unknown[]) => void;
  onHostBlockedCommand?: (command: string, ...args: unknown[]) => void;
  logger?: ListenTogetherLogger;
}

/**
 * Central command gate for RemoteControl ProtectedAPI messages during Listen Together sessions.
 */
export class PlaybackArbiter {
  private session: PlaybackArbiterSessionState = {
    active: false,
    isHost: false,
    listeningMode: "room",
  };
  private onHostTransport?: (
    command: HostTransportCommand,
    ...args: unknown[]
  ) => void;
  private onGuestBlockedCommand?: (command: string, ...args: unknown[]) => void;
  private onHostBlockedCommand?: (command: string, ...args: unknown[]) => void;
  private logger: ListenTogetherLogger;
  private attachedApiManager: Pick<
    ProtectedAPIManager,
    "setCommandInterceptor"
  > | null = null;
  private readonly boundInterceptor = (command: string, ...args: unknown[]) =>
    this.evaluateCommand(command, ...args);

  constructor(options: PlaybackArbiterOptions = {}) {
    this.onHostTransport = options.onHostTransport;
    this.onGuestBlockedCommand = options.onGuestBlockedCommand;
    this.onHostBlockedCommand = options.onHostBlockedCommand;
    this.logger = options.logger ?? noopLogger;
  }

  public setSessionState(state: PlaybackArbiterSessionState): void {
    const prev = this.session;
    const nextActive = Boolean(state.active);
    const next: PlaybackArbiterSessionState = {
      active: nextActive,
      isHost: Boolean(nextActive && state.isHost),
      listeningMode: nextActive ? (state.listeningMode ?? "room") : "room",
    };
    this.session = next;
    if (
      prev.active !== next.active ||
      prev.isHost !== next.isHost ||
      prev.listeningMode !== next.listeningMode
    ) {
      this.logger.info?.("PlaybackArbiter session state changed", {
        active: next.active,
        isHost: next.isHost,
        listeningMode: next.listeningMode,
        role: next.active ? (next.isHost ? "host" : "guest") : "inactive",
      });
    }
  }

  public getSessionState(): PlaybackArbiterSessionState {
    return { ...this.session };
  }

  public attach(
    protectedApiManager: Pick<ProtectedAPIManager, "setCommandInterceptor">,
  ): void {
    if (
      this.attachedApiManager &&
      this.attachedApiManager !== protectedApiManager
    ) {
      this.attachedApiManager.setCommandInterceptor("RemoteControl", null);
    }
    this.attachedApiManager = protectedApiManager;
    protectedApiManager.setCommandInterceptor(
      "RemoteControl",
      this.boundInterceptor,
    );
    this.logger.debug?.(
      "PlaybackArbiter attached to RemoteControl interceptor",
    );
  }

  public detach(): void {
    if (this.attachedApiManager) {
      this.attachedApiManager.setCommandInterceptor("RemoteControl", null);
      this.attachedApiManager = null;
      this.logger.debug?.(
        "PlaybackArbiter detached from RemoteControl interceptor",
      );
    }
  }

  public evaluateCommand(command: string, ...args: unknown[]): boolean {
    if (!this.session.active || this.session.listeningMode === "local") {
      return true;
    }

    const role = this.session.isHost ? "host" : "guest";

    if (LOCAL_ALLOWED_COMMANDS.has(command)) {
      this.logger.debug?.("PlaybackArbiter allowed local command", {
        role,
        command,
      });
      return true;
    }

    if (this.session.isHost) {
      if (HOST_TRANSPORT_COMMANDS.has(command as HostTransportCommand)) {
        this.logger.info?.("PlaybackArbiter forwarded host transport command", {
          role,
          command,
        });
        this.onHostTransport?.(command as HostTransportCommand, ...args);
        return false;
      }

      this.logger.warn?.("PlaybackArbiter blocked disallowed host command", {
        role,
        command,
      });
      this.onHostBlockedCommand?.(command, ...args);
      return false;
    }

    this.logger.warn?.("PlaybackArbiter blocked guest command", {
      role,
      command,
    });
    this.onGuestBlockedCommand?.(command, ...args);
    return false;
  }
}

export default PlaybackArbiter;
