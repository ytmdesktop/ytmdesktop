import EventEmitter from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProtectedAPIOpCode } from "~shared/types";

vi.mock("electron", () => ({
  ipcMain: {
    on: vi.fn(),
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

import ProtectedAPIManager, {
  ProtectedAPI,
  type ProtectedAPILogger,
  type ProtectedAPIPort,
} from "..";

function createLogger(): ProtectedAPILogger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function createMockPort(): ProtectedAPIPort & {
  emitMessage: (data: unknown, ports?: unknown[]) => void;
  emitClose: () => void;
  start: ReturnType<typeof vi.fn>;
  postMessage: ReturnType<typeof vi.fn>;
} {
  const emitter = new EventEmitter();
  return {
    on(event: "message" | "close", listener: (...args: any[]) => void) {
      emitter.on(event, listener);
      return this;
    },
    start: vi.fn(),
    postMessage: vi.fn(),
    emitMessage(data: unknown, ports: unknown[] = []) {
      emitter.emit("message", { data, ports });
    },
    emitClose() {
      emitter.emit("close");
    },
  };
}

describe("ProtectedAPI", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("waitForPort resolves immediately when a port is already bound", async () => {
    const api = new ProtectedAPI("PlayerState", createLogger());
    const port = createMockPort();

    api.setPort(port);

    expect(api.isPortBound).toBe(true);
    await expect(api.waitForPort()).resolves.toBeUndefined();
    expect(port.start).toHaveBeenCalledTimes(1);
  });

  it("waitForPort defers until a non-null port is bound and ignores setPort(null)", async () => {
    const api = new ProtectedAPI("PlayerState", createLogger());
    let resolvedFirst = false;
    let resolvedSecond = false;

    const firstWait = api.waitForPort().then(() => {
      resolvedFirst = true;
    });
    const secondWait = api.waitForPort().then(() => {
      resolvedSecond = true;
    });

    api.setPort(null);
    await Promise.resolve();
    expect(resolvedFirst).toBe(false);
    expect(resolvedSecond).toBe(false);

    const port = createMockPort();
    api.setPort(port);

    await Promise.all([firstWait, secondWait]);
    expect(resolvedFirst).toBe(true);
    expect(resolvedSecond).toBe(true);
  });

  it("waitForPort rejects on timeout when no port is bound in time", async () => {
    vi.useFakeTimers();
    const logger = createLogger();
    const api = new ProtectedAPI("PlayerState", logger);

    const waitPromise = api.waitForPort(500);
    const assertion = expect(waitPromise).rejects.toThrow(
      "Timed out waiting for ProtectedAPI 'PlayerState' port",
    );

    await vi.advanceTimersByTimeAsync(499);
    await vi.advanceTimersByTimeAsync(1);
    await assertion;

    expect(logger.warn).toHaveBeenCalledTimes(1);

    const latePort = createMockPort();
    expect(() => api.setPort(latePort)).not.toThrow();
    expect(api.isPortBound).toBe(true);
  });

  it("waitForPort clears its timeout when bound before deadline", async () => {
    vi.useFakeTimers();
    const api = new ProtectedAPI("PlayerState", createLogger());
    const port = createMockPort();

    const waitPromise = api.waitForPort(500);
    await vi.advanceTimersByTimeAsync(200);
    api.setPort(port);

    await expect(waitPromise).resolves.toBeUndefined();
    await vi.advanceTimersByTimeAsync(500);
  });

  it("setCommandInterceptor blocks execute commands and allows other commands", () => {
    const logger = createLogger();
    const api = new ProtectedAPI("Shortcuts", logger);
    const port = createMockPort();
    api.setPort(port);

    const interceptor = vi.fn((command: string) => command !== "playPause");
    api.setCommandInterceptor(interceptor);

    api.postMessage("execute", "playPause", { source: "shortcut" });
    expect(interceptor).toHaveBeenCalledWith("playPause", {
      source: "shortcut",
    });
    expect(port.postMessage).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      "protectedapi: blocked command 'playPause' on api 'Shortcuts'",
    );

    api.postMessage("execute", "nextTrack", 1);
    expect(interceptor).toHaveBeenCalledWith("nextTrack", 1);
    expect(port.postMessage).toHaveBeenCalledWith({
      op: ProtectedAPIOpCode.Message,
      name: "execute",
      args: ["nextTrack", 1],
    });

    api.postMessage("ping", "ok");
    expect(interceptor).toHaveBeenCalledWith("ping", "ok");
    expect(port.postMessage).toHaveBeenCalledWith({
      op: ProtectedAPIOpCode.Message,
      name: "ping",
      args: ["ok"],
    });

    api.setCommandInterceptor(null);
    api.postMessage("execute", "playPause");
    expect(port.postMessage).toHaveBeenCalledWith({
      op: ProtectedAPIOpCode.Message,
      name: "execute",
      args: ["playPause"],
    });
  });

  it("unbinds on setPort(null) and port close event, dropping subsequent messages", () => {
    const logger = createLogger();
    const api = new ProtectedAPI("PlayerState", logger);
    const firstPort = createMockPort();
    const secondPort = createMockPort();

    api.setPort(firstPort);
    expect(api.isPortBound).toBe(true);

    api.setPort(null);
    expect(api.isPortBound).toBe(false);
    api.postMessage("update", 1);
    expect(firstPort.postMessage).not.toHaveBeenCalled();

    api.setPort(secondPort);
    expect(api.isPortBound).toBe(true);
    secondPort.emitClose();
    expect(api.isPortBound).toBe(false);

    api.postMessage("update", 2);
    expect(secondPort.postMessage).not.toHaveBeenCalled();
  });

  it("replaces an active port cleanly and emits incoming RPC messages", async () => {
    const logger = createLogger();
    const api = new ProtectedAPI("PlayerState", logger);
    const portA = createMockPort();
    const portB = createMockPort();

    api.setPort(portA);
    api.setPort(portB);
    expect(api.isPortBound).toBe(true);
    expect(logger.info).toHaveBeenCalledWith(
      "protectedapi: api 'PlayerState' replacing bound port",
    );

    portA.emitClose();
    expect(api.isPortBound).toBe(true);

    const listener = vi.fn();
    api.on("playerSignal", listener);
    portB.emitMessage({
      op: ProtectedAPIOpCode.Message,
      name: "playerSignal",
      args: ["TRACK_ENDED", "vid-1"],
    });
    expect(listener).toHaveBeenCalledWith("TRACK_ENDED", "vid-1");

    const invokePromise = api.invokeMessage("getState", "arg1");
    expect(portB.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        op: ProtectedAPIOpCode.Invoke,
        name: "getState",
        args: ["arg1"],
      }),
    );
    const sentInvokeId = portB.postMessage.mock.calls[0][0].id;
    portB.emitMessage({
      op: ProtectedAPIOpCode.InvokeResponse,
      id: sentInvokeId,
      args: [{ ok: true }],
    });
    await expect(invokePromise).resolves.toEqual([{ ok: true }]);
  });

  it("invokeMessage rejects when no response arrives within 30 seconds", async () => {
    vi.useFakeTimers();
    const api = new ProtectedAPI("PlayerState", createLogger());
    const port = createMockPort();
    api.setPort(port);

    const invokePromise = api.invokeMessage("slowCall");
    const assertion = expect(invokePromise).rejects.toBeUndefined();

    await vi.advanceTimersByTimeAsync(30_000);
    await assertion;
  });
});

describe("ProtectedAPIManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function setupManager() {
    const handlers = new Map<string, (event: any) => void>();
    const logger = createLogger();
    const manager = new ProtectedAPIManager().setDependencies({
      ipcMain: {
        on: ((channel: string, listener: (event: any) => void) => {
          handlers.set(channel, listener);
        }) as any,
      },
      logger,
    });
    manager.onInitialized();
    const bindPortHandler = handlers.get("protectedApi:bindPort");
    if (!bindPortHandler) {
      throw new Error("protectedApi:bindPort handler was not registered");
    }
    return { manager, logger, bindPortHandler };
  }

  it("rejects protectedApi:bindPort when allowedBinderWebContentsId is unset or mismatched", () => {
    const { manager, logger, bindPortHandler } = setupManager();
    const portA = createMockPort();
    const portB = createMockPort();

    bindPortHandler({ sender: { id: 10 }, ports: [portA] });
    expect(portA.start).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      "protectedapi: rejected bindPort from unauthorized sender 10 (expected none)",
    );

    manager.setAllowedBinderWebContentsId(42);
    bindPortHandler({ sender: { id: 99 }, ports: [portB] });
    expect(portB.start).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      "protectedapi: rejected bindPort from unauthorized sender 99 (expected 42)",
    );

    bindPortHandler({ ports: [portB] });
    expect(portB.start).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      "protectedapi: rejected bindPort from unauthorized sender unknown (expected 42)",
    );
  });

  it("warns when authorized sender omits a MessagePort", () => {
    const { manager, logger, bindPortHandler } = setupManager();
    manager.setAllowedBinderWebContentsId(42);

    bindPortHandler({ sender: { id: 42 }, ports: [] });
    expect(logger.warn).toHaveBeenCalledWith(
      "protectedapi: bindPort from authorized sender 42 had no MessagePort",
    );
  });

  it("accepts authorized binder, resets existing APIs, and binds ProvideAPIPort ports", () => {
    const { manager, logger, bindPortHandler } = setupManager();
    const existingApi = manager.createOrGetAPI("PlayerState");
    const staleChildPort = createMockPort();
    existingApi.setPort(staleChildPort);
    expect(existingApi.isPortBound).toBe(true);

    const mainPort = createMockPort();
    manager.setAllowedBinderWebContentsId(42);
    bindPortHandler({ sender: { id: 42 }, ports: [mainPort] });

    expect(mainPort.start).toHaveBeenCalledTimes(1);
    expect(existingApi.isPortBound).toBe(false);

    mainPort.emitMessage(
      { op: ProtectedAPIOpCode.ProvideAPIPort, name: "PlayerState" },
      [],
    );
    expect(logger.warn).toHaveBeenCalledWith(
      "protectedapi: ProvideAPIPort for 'PlayerState' had no port",
    );

    const freshChildPort = createMockPort();
    mainPort.emitMessage(
      { op: ProtectedAPIOpCode.ProvideAPIPort, name: "PlayerState" },
      [freshChildPort],
    );
    expect(existingApi.isPortBound).toBe(true);
    expect(freshChildPort.start).toHaveBeenCalledTimes(1);
  });

  it("delegates setCommandInterceptor and handles setMainPort(null)", () => {
    const { manager, logger } = setupManager();
    const api = manager.createOrGetAPI("Shortcuts");
    const port = createMockPort();
    api.setPort(port);

    manager.setCommandInterceptor("Shortcuts", (cmd) => cmd !== "blocked");
    api.postMessage("execute", "blocked");
    expect(port.postMessage).not.toHaveBeenCalled();

    manager.setMainPort(null);
    expect(logger.warn).toHaveBeenCalledWith(
      "protectedapi: main port cleared (null)",
    );
  });
});
