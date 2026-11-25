import { describe, expect, it, vi } from "vitest";
import { LOCAL_ALLOWED_COMMANDS, PlaybackArbiter } from "../arbiter";

describe("PlaybackArbiter", () => {
  it("allows all commands when session is inactive", () => {
    const arbiter = new PlaybackArbiter();
    expect(arbiter.evaluateCommand("play")).toBe(true);
    expect(
      arbiter.evaluateCommand("navigate", {
        watchEndpoint: { videoId: "abc" },
      }),
    ).toBe(true);
    expect(arbiter.evaluateCommand("previous")).toBe(true);
  });

  it("permits LOCAL_ALLOWED_COMMANDS for both Host and Guest", () => {
    const onHostTransport = vi.fn();
    const onGuestBlockedCommand = vi.fn();
    const arbiter = new PlaybackArbiter({
      onHostTransport,
      onGuestBlockedCommand,
    });

    for (const isHost of [true, false]) {
      arbiter.setSessionState({ active: true, isHost });
      for (const cmd of LOCAL_ALLOWED_COMMANDS) {
        expect(arbiter.evaluateCommand(cmd)).toBe(true);
      }
    }

    expect(onHostTransport).not.toHaveBeenCalled();
    expect(onGuestBlockedCommand).not.toHaveBeenCalled();
  });

  it("forwards Host transport commands and blocks direct bypasses and disallowed commands", () => {
    const onHostTransport = vi.fn();
    const onHostBlockedCommand = vi.fn();
    const arbiter = new PlaybackArbiter({
      onHostTransport,
      onHostBlockedCommand,
    });
    arbiter.setSessionState({ active: true, isHost: true });

    expect(arbiter.evaluateCommand("play")).toBe(false);
    expect(arbiter.evaluateCommand("pause")).toBe(false);
    expect(arbiter.evaluateCommand("playPause")).toBe(false);
    expect(arbiter.evaluateCommand("next")).toBe(false);
    expect(arbiter.evaluateCommand("seekTo", 42)).toBe(false);

    expect(onHostTransport.mock.calls).toEqual([
      ["play"],
      ["pause"],
      ["playPause"],
      ["next"],
      ["seekTo", 42],
    ]);

    for (const blocked of [
      "previous",
      "repeatMode",
      "cycleRepeatMode",
      "shuffle",
      "playQueueIndex",
      "queueAdd",
      "queueRemove",
      "queueMove",
      "navigate",
    ]) {
      expect(arbiter.evaluateCommand(blocked)).toBe(false);
    }
    expect(onHostTransport).toHaveBeenCalledTimes(5);
    expect(onHostBlockedCommand).toHaveBeenCalledTimes(9);
  });

  it("blocks non-local commands for Guest and notifies onGuestBlockedCommand", () => {
    const onGuestBlockedCommand = vi.fn();
    const arbiter = new PlaybackArbiter({ onGuestBlockedCommand });
    arbiter.setSessionState({ active: true, isHost: false });

    expect(arbiter.evaluateCommand("play")).toBe(false);
    expect(
      arbiter.evaluateCommand("navigate", {
        watchEndpoint: { videoId: "dQw4w9WgXcQ" },
      }),
    ).toBe(false);
    expect(onGuestBlockedCommand).toHaveBeenCalledTimes(2);
    expect(onGuestBlockedCommand).toHaveBeenNthCalledWith(1, "play");
    expect(onGuestBlockedCommand).toHaveBeenNthCalledWith(2, "navigate", {
      watchEndpoint: { videoId: "dQw4w9WgXcQ" },
    });
  });

  it("attaches and detaches RemoteControl interceptor on ProtectedAPIManager", () => {
    const setCommandInterceptor = vi.fn();
    const arbiter = new PlaybackArbiter();
    arbiter.attach({ setCommandInterceptor });

    expect(setCommandInterceptor).toHaveBeenCalledWith(
      "RemoteControl",
      expect.any(Function),
    );

    const registeredFn = setCommandInterceptor.mock.calls[0][1] as (
      cmd: string,
      ...args: unknown[]
    ) => boolean;
    arbiter.setSessionState({ active: true, isHost: false });
    expect(registeredFn("play")).toBe(false);

    arbiter.detach();
    expect(setCommandInterceptor).toHaveBeenLastCalledWith(
      "RemoteControl",
      null,
    );
  });

  it("emits structured role and command diagnostics via injectable logger", () => {
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const arbiter = new PlaybackArbiter({ logger });

    arbiter.setSessionState({ active: true, isHost: true });
    expect(logger.info).toHaveBeenCalledWith(
      "PlaybackArbiter session state changed",
      { active: true, isHost: true, listeningMode: "room", role: "host" },
    );

    arbiter.evaluateCommand("volumeUp");
    expect(logger.debug).toHaveBeenCalledWith(
      "PlaybackArbiter allowed local command",
      { role: "host", command: "volumeUp" },
    );

    arbiter.evaluateCommand("play");
    expect(logger.info).toHaveBeenCalledWith(
      "PlaybackArbiter forwarded host transport command",
      { role: "host", command: "play" },
    );

    arbiter.evaluateCommand("shuffle");
    expect(logger.warn).toHaveBeenCalledWith(
      "PlaybackArbiter blocked disallowed host command",
      { role: "host", command: "shuffle" },
    );

    arbiter.setSessionState({ active: true, isHost: false });
    arbiter.evaluateCommand("navigate", { watchEndpoint: { videoId: "abc" } });
    expect(logger.warn).toHaveBeenCalledWith(
      "PlaybackArbiter blocked guest command",
      { role: "guest", command: "navigate" },
    );
  });

  it("allows all commands natively when listeningMode is local", () => {
    const onHostTransport = vi.fn();
    const onGuestBlockedCommand = vi.fn();
    const arbiter = new PlaybackArbiter({
      onHostTransport,
      onGuestBlockedCommand,
    });

    for (const isHost of [true, false]) {
      arbiter.setSessionState({
        active: true,
        isHost,
        listeningMode: "local",
      });
      expect(arbiter.evaluateCommand("play")).toBe(true);
      expect(arbiter.evaluateCommand("pause")).toBe(true);
      expect(arbiter.evaluateCommand("seekTo", 12)).toBe(true);
      expect(arbiter.evaluateCommand("previous")).toBe(true);
      expect(
        arbiter.evaluateCommand("navigate", {
          watchEndpoint: { videoId: "dQw4w9WgXcQ" },
        }),
      ).toBe(true);
    }

    expect(onHostTransport).not.toHaveBeenCalled();
    expect(onGuestBlockedCommand).not.toHaveBeenCalled();
  });
});
