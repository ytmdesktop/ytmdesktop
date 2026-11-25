import { afterEach, describe, expect, it, vi } from "vitest";
import type { ListenTogetherCommand } from "~shared/listentogether/ipc";
import {
  closeListenTogetherPanel,
  copyToClipboard,
  dispatchCommand,
  formatDuration,
  formatEndpoint,
  formatPasscodeDisplay,
  isInviteUrlInput,
  looksLikeRoomCodeInput,
  normalizePasscodeInput,
  roleLabel,
} from "../utils";

describe("dispatchCommand", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("returns unavailable error when window.ytmd.listenTogether.dispatch is missing", async () => {
    vi.stubGlobal("window", {});

    const result = await dispatchCommand({ type: "leaveRoom" });

    expect(result).toEqual({
      ok: false,
      error: "Listen Together controls are unavailable",
    });
  });

  it("returns ok result without warning when dispatch succeeds", async () => {
    const dispatch = vi.fn().mockResolvedValue({ ok: true });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("window", {
      ytmd: { listenTogether: { dispatch } },
    });

    const result = await dispatchCommand({ type: "leaveRoom" });

    expect(result).toEqual({ ok: true });
    expect(dispatch).toHaveBeenCalledWith({ type: "leaveRoom" });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("logs sanitized warning when dispatch returns ok: false and redacts passcodes and rawUrl", async () => {
    const secretPasscode = "ABCD2345";
    const secretRawUrl = "ytmd://listen/v1/super-secret-invite";
    const dispatch = vi
      .fn()
      .mockResolvedValue({ ok: false, error: "Room not found" });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("window", {
      ytmd: { listenTogether: { dispatch } },
    });

    const command = {
      type: "joinRoom",
      passcode: secretPasscode,
      rawUrl: secretRawUrl,
    } as unknown as ListenTogetherCommand;

    const result = await dispatchCommand(command);

    expect(result).toEqual({ ok: false, error: "Room not found" });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith("Listen Together command failed", {
      type: "joinRoom",
      error: "Room not found",
    });
    const serialized = JSON.stringify(warnSpy.mock.calls);
    expect(serialized).not.toContain(secretPasscode);
    expect(serialized).not.toContain(secretRawUrl);
  });

  it("logs sanitized warning and returns error when dispatch throws an Error", async () => {
    const secretPasscode = "WXYZ6789";
    const secretRawUrl = "ytmd://listen/v1/another-secret";
    const dispatch = vi.fn().mockRejectedValue(new Error("IPC disconnected"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("window", {
      ytmd: { listenTogether: { dispatch } },
    });

    const command = {
      type: "joinRoom",
      passcode: secretPasscode,
      rawUrl: secretRawUrl,
    } as unknown as ListenTogetherCommand;

    const result = await dispatchCommand(command);

    expect(result).toEqual({ ok: false, error: "IPC disconnected" });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith("Listen Together command threw", {
      type: "joinRoom",
      error: "IPC disconnected",
    });
    const serialized = JSON.stringify(warnSpy.mock.calls);
    expect(serialized).not.toContain(secretPasscode);
    expect(serialized).not.toContain(secretRawUrl);
  });

  it("falls back to generic error message when dispatch throws a non-Error value", async () => {
    const dispatch = vi.fn().mockRejectedValue("unexpected failure");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("window", {
      ytmd: { listenTogether: { dispatch } },
    });

    const result = await dispatchCommand({ type: "leaveRoom" });

    expect(result).toEqual({ ok: false, error: "Action failed" });
    expect(warnSpy).toHaveBeenCalledWith("Listen Together command threw", {
      type: "leaveRoom",
      error: "Action failed",
    });
  });
});

describe("listen-together UI utils", () => {
  it("normalizes valid 8-char room codes and rejects invalid ones", () => {
    expect(normalizePasscodeInput("ab23-cd45")).toBe("AB23CD45");
    expect(normalizePasscodeInput(" ab23 cd45 ")).toBe("AB23CD45");
    expect(normalizePasscodeInput("23456789")).toBe("23456789");
    expect(normalizePasscodeInput("01IO-ABCD")).toBeNull();
    expect(normalizePasscodeInput("AB23")).toBeNull();
    expect(normalizePasscodeInput("AB23-CD45-EF")).toBeNull();
    expect(normalizePasscodeInput("")).toBeNull();
  });

  it("formats passcode display with hyphen after 4 characters", () => {
    expect(formatPasscodeDisplay("ab23cd45")).toBe("AB23-CD45");
    expect(formatPasscodeDisplay(" ab23-cd45 ")).toBe("AB23-CD45");
    expect(formatPasscodeDisplay("ab23")).toBe("AB23");
    expect(formatPasscodeDisplay("ab23cd45ef")).toBe("AB23-CD45");
    expect(formatPasscodeDisplay("")).toBe("");
  });

  it("distinguishes invite links from room-code inputs", () => {
    expect(isInviteUrlInput("  ytmd://listen/v1/abc  ")).toBe(true);
    expect(isInviteUrlInput("ytmd://listen/v1/")).toBe(true);
    expect(isInviteUrlInput("  ytmd://l/abc123  ")).toBe(true);
    expect(isInviteUrlInput("ytmd://l/")).toBe(true);
    expect(isInviteUrlInput("AB23-CD45")).toBe(false);
    expect(isInviteUrlInput("https://example.com")).toBe(false);

    expect(looksLikeRoomCodeInput("AB23")).toBe(true);
    expect(looksLikeRoomCodeInput("ab23-cd45")).toBe(true);
    expect(looksLikeRoomCodeInput("ab 23")).toBe(true);
    expect(looksLikeRoomCodeInput("ytmd://listen/v1/abc")).toBe(false);
    expect(looksLikeRoomCodeInput("YTMD:listen/v1/abc")).toBe(false);
    expect(looksLikeRoomCodeInput("https://example.com")).toBe(false);
    expect(looksLikeRoomCodeInput("A")).toBe(false);
    expect(looksLikeRoomCodeInput("")).toBe(false);
    expect(looksLikeRoomCodeInput("   ")).toBe(false);
  });

  it("formats endpoints for IPv4 and IPv6", () => {
    expect(formatEndpoint("192.168.1.10", 45123)).toBe("192.168.1.10:45123");
    expect(formatEndpoint("fe80::1", 45123)).toBe("[fe80::1]:45123");
    expect(formatEndpoint("[fe80::1]", 45123)).toBe("[fe80::1]:45123");
  });

  it("formats durations including zero, negative, minutes, and hours", () => {
    expect(formatDuration(-5)).toBe("0:00");
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(9.8)).toBe("0:09");
    expect(formatDuration(65)).toBe("1:05");
    expect(formatDuration(3661)).toBe("1:01:01");
  });

  it("maps roles to human-readable labels", () => {
    expect(roleLabel("admin")).toBe("Host");
    expect(roleLabel("dj")).toBe("DJ");
    expect(roleLabel("listener")).toBe("Listener");
  });

  it("closes panel and copies to clipboard with navigator and execCommand fallback", async () => {
    const closePanel = vi.fn();
    vi.stubGlobal("window", { ytmd: { listenTogether: { closePanel } } });
    closeListenTogetherPanel();
    expect(closePanel).toHaveBeenCalledTimes(1);

    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    expect(await copyToClipboard("ytmd://l/abc")).toBe(true);
    expect(writeText).toHaveBeenCalledWith("ytmd://l/abc");

    vi.stubGlobal("navigator", {
      clipboard: {
        writeText: vi.fn().mockRejectedValue(new Error("blocked")),
      },
    });
    const fakeTextarea: any = {
      value: "",
      style: {},
      select: vi.fn(),
    };
    const appendChild = vi.fn();
    const removeChild = vi.fn();
    vi.stubGlobal("document", {
      createElement: vi.fn(() => fakeTextarea),
      body: { appendChild, removeChild },
      execCommand: vi.fn(() => true),
    });
    expect(await copyToClipboard("fallback-text")).toBe(true);
    expect(appendChild).toHaveBeenCalledWith(fakeTextarea);
    expect(removeChild).toHaveBeenCalledWith(fakeTextarea);
  });
});
