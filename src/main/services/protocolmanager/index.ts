import { app, net, protocol } from "electron";
import Service, { type ServiceLogger } from "../service";
import log from "electron-log";
import YTMViewManager from "../ytmviewmanager";
import { DependencyConstructor } from "~shared/types";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ProtectedAPIManager from "../protectedapimanager";
import { redactInviteUrl, redactLogUrl } from "~shared/listentogether/logger";
import type PlaybackArbiter from "../listentogether/arbiter";

export const MAX_YTMD_PROTOCOL_URL_LENGTH = 4096;

export type ParsedYtmdProtocolUrl =
  | {
      kind: "play";
      videoId: string;
      playlistId?: string;
    }
  | {
      kind: "listen";
      rawUrl: string;
    };

export type ListenInviteHandler = (rawUrl: string) => void;

export type ProtocolManagerLogger = ServiceLogger;

export interface ProtocolManagerDeps {
  ytmViewManager?: Pick<YTMViewManager, "isInitialized" | "ready">;
  protectedApiManager?: Pick<ProtectedAPIManager, "createOrGetAPI">;
  logger?: ServiceLogger;
}

/**
 * Scans CLI/argv arrays for the last bounded `ytmd://` deep link.
 */
export function extractYtmdProtocolUrl(args: readonly string[]): string | null {
  for (let i = args.length - 1; i >= 0; i--) {
    const candidate = args[i];
    if (
      typeof candidate === "string" &&
      candidate.length > 0 &&
      candidate.length <= MAX_YTMD_PROTOCOL_URL_LENGTH &&
      candidate.toLowerCase().startsWith("ytmd://")
    ) {
      return candidate;
    }
  }
  return null;
}

/**
 * Checks whether a raw URL is a bounded `ytmd://listen/` or compact `ytmd://l/` invite link.
 */
export function isListenInviteProtocolUrl(rawUrl: string): boolean {
  return parseYtmdProtocolUrl(rawUrl)?.kind === "listen";
}

/**
 * Safely parses `ytmd://` URLs via WHATWG URL with bounded length.
 */
export function parseYtmdProtocolUrl(
  rawUrl: string,
): ParsedYtmdProtocolUrl | null {
  if (
    typeof rawUrl !== "string" ||
    rawUrl.length === 0 ||
    rawUrl.length > MAX_YTMD_PROTOCOL_URL_LENGTH
  ) {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }

  if (parsed.protocol !== "ytmd:") {
    return null;
  }

  const action = parsed.hostname.toLowerCase();
  if (action === "play") {
    const segments = parsed.pathname.split("/").filter(Boolean);
    if (segments.length === 0) {
      return null;
    }
    const videoId = segments[0];
    const playlistId = segments[1];
    if (!videoId || !/^[A-Za-z0-9_-]+$/.test(videoId)) {
      return null;
    }
    if (playlistId !== undefined && !/^[A-Za-z0-9_-]+$/.test(playlistId)) {
      return null;
    }
    return {
      kind: "play",
      videoId,
      playlistId,
    };
  }

  if (action === "listen") {
    if (!parsed.pathname.startsWith("/v1/") || parsed.pathname.length <= 4) {
      return null;
    }
    return {
      kind: "listen",
      rawUrl,
    };
  }

  if (action === "l") {
    if (!parsed.pathname.startsWith("/") || parsed.pathname.length <= 1) {
      return null;
    }
    return {
      kind: "listen",
      rawUrl,
    };
  }

  return null;
}

export default class ProtocolManager extends Service {
  public static override readonly dependencies: DependencyConstructor<Service>[] =
    [YTMViewManager, ProtectedAPIManager];

  private _initialized = false;
  private listenInviteHandler: ListenInviteHandler | null = null;
  private pendingListenInviteUrl: string | null = null;
  private playbackArbiter:
    | (Pick<PlaybackArbiter, "evaluateCommand"> &
        Partial<Pick<PlaybackArbiter, "getSessionState">>)
    | null = null;
  private injectedDeps: ProtocolManagerDeps = {};

  public get initialized() {
    return this._initialized;
  }

  public setDependencies(deps: ProtocolManagerDeps): this {
    this.injectedDeps = deps;
    return this;
  }

  public setListenInviteHandler(handler: ListenInviteHandler | null): void {
    const logger = this.injectedDeps.logger ?? log;
    this.listenInviteHandler = handler;
    if (handler && this.pendingListenInviteUrl) {
      const pending = this.pendingListenInviteUrl;
      this.pendingListenInviteUrl = null;
      logger.info("Flushing buffered ytmd://listen invite to handler", {
        url: redactInviteUrl(redactLogUrl(pending)),
      });
      handler(pending);
    }
  }

  public setPlaybackArbiter(
    arbiter:
      | (Pick<PlaybackArbiter, "evaluateCommand"> &
          Partial<Pick<PlaybackArbiter, "getSessionState">>)
      | null,
  ): void {
    this.playbackArbiter = arbiter;
  }

  public override onPreInitialized() {
    // Register a custom protocol for use within the app - https://www.electronjs.org/docs/latest/tutorial/security#18-avoid-usage-of-the-file-protocol-and-prefer-usage-of-custom-protocols
    protocol.registerSchemesAsPrivileged([
      {
        scheme: "ytmd-app",
        privileges: {
          standard: true,
          secure: true,
        },
      },
    ]);
  }

  public onInitialized() {
    if (this._initialized)
      throw new Error("ProtocolManager is already initialized!");
    this._initialized = true;

    // Create a handler for the in app ytmd-app protocol
    protocol.handle("ytmd-app", this.handleYTMDAppProtocol.bind(this));

    // Register a `ytmd` protocol into the system to allow opening songs inside YTMD
    // This will register the protocol in development, this is intentional and should stay this way for development purposes
    if (!app.isDefaultProtocolClient("ytmd")) {
      if (process.defaultApp) {
        if (process.argv.length >= 2) {
          log.info("Application set as default protcol client for 'ytmd'");
          app.setAsDefaultProtocolClient("ytmd", process.execPath, [
            path.resolve(process.argv[1]),
          ]);
        }
      } else {
        log.info("Application set as default protcol client for 'ytmd'");
        app.setAsDefaultProtocolClient("ytmd", process.execPath);
      }
    }

    log.info("ProtocolManager initialized");
  }

  public override onPostInitialized(): void {}

  public override onTerminated(): void {}

  public async handleYTMDProtocol(url: string) {
    const logger = this.injectedDeps.logger ?? log;
    const redactedUrl =
      typeof url === "string" ? redactInviteUrl(redactLogUrl(url)) : "";

    if (
      typeof url !== "string" ||
      url.length === 0 ||
      url.length > MAX_YTMD_PROTOCOL_URL_LENGTH
    ) {
      logger.warn("Rejected ytmd protocol url due to invalid length");
      return;
    }

    logger.info("Handling ytmd protocol url", redactedUrl);

    const parsed = parseYtmdProtocolUrl(url);
    if (!parsed) {
      logger.warn("Ignoring invalid ytmd protocol url", redactedUrl);
      return;
    }

    if (parsed.kind === "listen") {
      if (this.listenInviteHandler) {
        logger.info("Forwarding ytmd://listen invite to handler", {
          url: redactedUrl,
        });
        this.listenInviteHandler(parsed.rawUrl);
      } else {
        logger.info("Buffering ytmd://listen invite until handler registers", {
          url: redactedUrl,
        });
        this.pendingListenInviteUrl = parsed.rawUrl;
      }
      return;
    }

    const ytmViewManager =
      this.injectedDeps.ytmViewManager ?? this.getDependency(YTMViewManager);
    const protectedApiManager =
      this.injectedDeps.protectedApiManager ??
      this.getDependency(ProtectedAPIManager);

    const navigateArg = {
      watchEndpoint: {
        videoId: parsed.videoId,
        playlistId: parsed.playlistId,
      },
    };

    if (
      this.playbackArbiter &&
      !this.playbackArbiter.evaluateCommand("navigate", navigateArg)
    ) {
      const sessionState = this.playbackArbiter.getSessionState?.();
      logger.warn(
        "Blocked ytmd://play/ protocol navigation due to active Listen Together session",
        {
          videoId: parsed.videoId,
          playlistId: parsed.playlistId ?? null,
          role: sessionState?.active
            ? sessionState.isHost
              ? "host"
              : "guest"
            : "unknown",
        },
      );
      return;
    }

    if (ytmViewManager.isInitialized()) {
      await ytmViewManager.ready();
      logger.debug(
        `Navigating to videoId: ${parsed.videoId}, playlistId: ${parsed.playlistId}`,
      );

      const remoteControlApi =
        protectedApiManager.createOrGetAPI("RemoteControl");
      remoteControlApi.postMessage("execute", "navigate", navigateArg);
    }
  }

  private async handleYTMDAppProtocol(req: Request) {
    const { host, pathname } = new URL(req.url);
    const rendererBaseDir = app.isPackaged
      ? path.resolve(process.resourcesPath, "app.asar/.vite/renderer")
      : path.resolve(__dirname, "../renderer");
    const ALLOWED_APP_HOSTS = new Set([
      "updater",
      "main",
      "titlebar",
      "settings",
      "authorize-companion",
      "miniplayer",
      "changelog",
      "listen-together",
    ]);
    let rootPath = ALLOWED_APP_HOSTS.has(host)
      ? path.resolve(rendererBaseDir, `windows/${host}`)
      : undefined;

    if (!rootPath) {
      return new Response(null, {
        status: 404,
      });
    }

    let desiredPath = pathname;
    if (!pathname || pathname === "/") desiredPath = "/index.html";

    const assetsRegex = /^[/\\]+(assets[/\\]+)+/;
    if (assetsRegex.test(desiredPath)) {
      desiredPath = desiredPath.replace(assetsRegex, "");
      rootPath = path.resolve(rendererBaseDir, "assets");
    }

    desiredPath = desiredPath.replace(/^[/\\]+/, "");

    if (!this.isSafePath(rootPath, desiredPath)) {
      log.warn("Requested path violated the safe path policy");
      return new Response("Policy Violation", {
        status: 403,
        headers: { "Content-Type": "text/html" },
      });
    }

    const fileUrlPath = pathToFileURL(
      path.resolve(rootPath, desiredPath),
    ).toString();

    return net.fetch(fileUrlPath);
  }

  private isSafePath(rootPath: string, requestedPath: string) {
    const pathToServe = path.resolve(rootPath, requestedPath);
    const relativePath = path.relative(rootPath, pathToServe);
    const isSafe =
      relativePath &&
      !relativePath.startsWith("..") &&
      !path.isAbsolute(relativePath);
    return isSafe;
  }
}
