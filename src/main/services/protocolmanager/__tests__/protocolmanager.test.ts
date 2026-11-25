import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: {
    isDefaultProtocolClient: vi.fn(() => true),
    setAsDefaultProtocolClient: vi.fn(),
  },
  net: { fetch: vi.fn() },
  protocol: {
    registerSchemesAsPrivileged: vi.fn(),
    handle: vi.fn(),
  },
}));

vi.mock("electron-log", () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import ProtocolManager, {
  extractYtmdProtocolUrl,
  isListenInviteProtocolUrl,
  MAX_YTMD_PROTOCOL_URL_LENGTH,
  parseYtmdProtocolUrl,
} from "../index";
import PlaybackArbiter from "../../listentogether/arbiter";

describe("ProtocolManager deep-link parsing and gating", () => {
  describe("extractYtmdProtocolUrl & parseYtmdProtocolUrl", () => {
    it("extracts bounded ytmd:// links from argv arrays", () => {
      const invite = "ytmd://listen/v1/abc_def-123";
      expect(extractYtmdProtocolUrl(["app.exe", "--flag", invite])).toBe(
        invite,
      );
      expect(extractYtmdProtocolUrl(["app.exe", "--flag"])).toBeNull();
      expect(
        extractYtmdProtocolUrl([
          `ytmd://listen/v1/${"a".repeat(MAX_YTMD_PROTOCOL_URL_LENGTH)}`,
        ]),
      ).toBeNull();
    });

    it("parses play and listen URLs via WHATWG URL and rejects invalid schemes", () => {
      expect(parseYtmdProtocolUrl("ytmd://play/dQw4w9WgXcQ/PL123")).toEqual({
        kind: "play",
        videoId: "dQw4w9WgXcQ",
        playlistId: "PL123",
      });
      expect(parseYtmdProtocolUrl("ytmd://listen/v1/payload123")).toEqual({
        kind: "listen",
        rawUrl: "ytmd://listen/v1/payload123",
      });
      expect(parseYtmdProtocolUrl("ytmd://l/compact123")).toEqual({
        kind: "listen",
        rawUrl: "ytmd://l/compact123",
      });
      expect(isListenInviteProtocolUrl("ytmd://listen/v1/payload123")).toBe(
        true,
      );
      expect(isListenInviteProtocolUrl("ytmd://l/compact123")).toBe(true);
      expect(
        parseYtmdProtocolUrl("https://music.youtube.com/watch?v=dQw4w9WgXcQ"),
      ).toBeNull();
      expect(parseYtmdProtocolUrl("ytmd://listen/v1/")).toBeNull();
      expect(parseYtmdProtocolUrl("ytmd://l/")).toBeNull();
    });
  });

  describe("handleYTMDProtocol", () => {
    function createSpyLogger() {
      const entries: Array<{
        level: string;
        message: string;
        args: unknown[];
      }> = [];
      const logger = {
        debug: (message: string, ...args: unknown[]) =>
          entries.push({ level: "debug", message, args }),
        info: (message: string, ...args: unknown[]) =>
          entries.push({ level: "info", message, args }),
        warn: (message: string, ...args: unknown[]) =>
          entries.push({ level: "warn", message, args }),
        error: (message: string, ...args: unknown[]) =>
          entries.push({ level: "error", message, args }),
      };
      return { logger, entries };
    }

    it("redacts ytmd://listen/v1/... payloads in all logs (including context objects) and buffers until handler registers", async () => {
      const { logger, entries } = createSpyLogger();
      const pm = new ProtocolManager().setDependencies({ logger });
      const secretPayload = "SUPER_SECRET_CAPABILITY_TOKEN_PAYLOAD_t_and_s";
      const secretUrl = `ytmd://listen/v1/${secretPayload}`;

      await pm.handleYTMDProtocol(secretUrl);

      const dumpedDuringBuffer = JSON.stringify(entries);
      expect(dumpedDuringBuffer).toContain("ytmd://listen/v1/[redacted]");
      expect(dumpedDuringBuffer).not.toContain(secretPayload);

      const handler = vi.fn();
      pm.setListenInviteHandler(handler);
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(secretUrl);

      // Registering another handler does not replay the already-flushed invite
      const secondHandler = vi.fn();
      pm.setListenInviteHandler(secondHandler);
      expect(secondHandler).not.toHaveBeenCalled();

      // Forwarding while handler is already registered
      const secondSecretPayload = "ANOTHER_SECRET_INVITE_PAYLOAD";
      const secondSecretUrl = `ytmd://listen/v1/${secondSecretPayload}`;
      await pm.handleYTMDProtocol(secondSecretUrl);
      expect(secondHandler).toHaveBeenCalledTimes(1);
      expect(secondHandler).toHaveBeenCalledWith(secondSecretUrl);

      const dumpedAll = JSON.stringify(entries);
      expect(dumpedAll).not.toContain(secretPayload);
      expect(dumpedAll).not.toContain(secondSecretPayload);
    });

    it("awaits ytmViewManager.ready() before posting RemoteControl on ytmd://play/", async () => {
      let resolveReady!: () => void;
      const readyPromise = new Promise<void>((resolve) => {
        resolveReady = resolve;
      });
      const postMessage = vi.fn();

      const pm = new ProtocolManager().setDependencies({
        ytmViewManager: {
          isInitialized: () => true,
          ready: () => readyPromise,
        },
        protectedApiManager: {
          createOrGetAPI: () => ({ postMessage }) as any,
        },
      });

      const handlePromise = pm.handleYTMDProtocol(
        "ytmd://play/dQw4w9WgXcQ/PL999",
      );
      await Promise.resolve();
      expect(postMessage).not.toHaveBeenCalled();

      resolveReady();
      await handlePromise;
      expect(postMessage).toHaveBeenCalledWith("execute", "navigate", {
        watchEndpoint: {
          videoId: "dQw4w9WgXcQ",
          playlistId: "PL999",
        },
      });
    });

    it("gates ytmd://play/ via PlaybackArbiter when Guest or Host is active, and allows when inactive", async () => {
      const { logger, entries } = createSpyLogger();
      const onGuestBlockedCommand = vi.fn();
      const onHostBlockedCommand = vi.fn();
      const arbiter = new PlaybackArbiter({
        onGuestBlockedCommand,
        onHostBlockedCommand,
        logger,
      });

      const ready = vi.fn(async () => {});
      const postMessage = vi.fn();

      const pm = new ProtocolManager().setDependencies({
        ytmViewManager: { isInitialized: () => true, ready },
        protectedApiManager: { createOrGetAPI: () => ({ postMessage }) as any },
        logger,
      });
      pm.setPlaybackArbiter(arbiter);

      // 1) Guest in room -> blocked
      arbiter.setSessionState({ active: true, isHost: false });
      await pm.handleYTMDProtocol("ytmd://play/dQw4w9WgXcQ");
      expect(ready).not.toHaveBeenCalled();
      expect(postMessage).not.toHaveBeenCalled();
      expect(onGuestBlockedCommand).toHaveBeenCalledWith("navigate", {
        watchEndpoint: { videoId: "dQw4w9WgXcQ", playlistId: undefined },
      });
      expect(entries).toContainEqual(
        expect.objectContaining({
          level: "warn",
          message:
            "Blocked ytmd://play/ protocol navigation due to active Listen Together session",
          args: [
            expect.objectContaining({
              videoId: "dQw4w9WgXcQ",
              role: "guest",
            }),
          ],
        }),
      );

      // 2) Host in room -> navigate is also blocked by PlaybackArbiter
      arbiter.setSessionState({ active: true, isHost: true });
      await pm.handleYTMDProtocol("ytmd://play/9bZkp7q19f0/PL42");
      expect(ready).not.toHaveBeenCalled();
      expect(postMessage).not.toHaveBeenCalled();
      expect(onHostBlockedCommand).toHaveBeenCalledWith("navigate", {
        watchEndpoint: { videoId: "9bZkp7q19f0", playlistId: "PL42" },
      });

      // 3) Inactive session -> ytmd://play/ is allowed
      arbiter.setSessionState({ active: false, isHost: false });
      await pm.handleYTMDProtocol("ytmd://play/dQw4w9WgXcQ/PL999");
      expect(ready).toHaveBeenCalledTimes(1);
      expect(postMessage).toHaveBeenCalledWith("execute", "navigate", {
        watchEndpoint: { videoId: "dQw4w9WgXcQ", playlistId: "PL999" },
      });
    });
  });
});
