import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProtectedAPIOpCode } from "~shared/types";

describe("renderer ytmview & store-ipc scripts", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("ProtectedAPIManager initializes port, creates APIs, dispatches messages and invokes", async () => {
    const postedToWindow: any[] = [];
    const port1Messages: any[] = [];
    let apiPort1: any = null;

    class FakePort {
      public onmessage: ((ev: any) => void) | null = null;
      public postMessage = vi.fn((data: any) => {
        port1Messages.push(data);
      });
    }
    class FakeChannel {
      public port1 = new FakePort();
      public port2 = {};
      constructor() {
        if (!apiPort1) {
          // first channel is main channel
        } else {
          apiPort1 = this.port1;
        }
      }
    }
    let channelCount = 0;
    vi.stubGlobal(
      "MessageChannel",
      class {
        public port1 = new FakePort();
        public port2 = {};
        constructor() {
          channelCount++;
          if (channelCount === 2) {
            apiPort1 = this.port1;
          }
        }
      },
    );
    vi.stubGlobal("window", {
      postMessage: vi.fn((...args: any[]) => postedToWindow.push(args)),
    });
    if (typeof CustomEvent === "undefined") {
      vi.stubGlobal(
        "CustomEvent",
        class FakeCustomEvent extends Event {
          public detail: any;
          constructor(type: string, init?: { detail?: any }) {
            super(type);
            this.detail = init?.detail;
          }
        },
      );
    }

    const { default: pam } = await import("../protectedapimanager");
    pam.init();
    expect(postedToWindow[0][0]).toBe("ytmd-protected-api-port");

    const api = pam.createOrGetAPI("TestAPI");
    expect(pam.createOrGetAPI("TestAPI")).toBe(api);
    api.postMessage("ping", 123);
    expect(port1Messages).toContainEqual({
      op: ProtectedAPIOpCode.Message,
      name: "ping",
      args: [123],
    });

    const received: unknown[] = [];
    api.addEventListener("hello", (ev: any) => {
      received.push(ev.detail.args[0]);
    });
    await apiPort1.onmessage({
      data: { op: ProtectedAPIOpCode.Message, name: "hello", args: ["world"] },
    });
    expect(received).toEqual(["world"]);

    api.handleMessage("add", async (ev: any) => [
      ev.detail.args[0] + ev.detail.args[1],
    ]);
    await apiPort1.onmessage({
      data: { op: ProtectedAPIOpCode.Invoke, id: 7, name: "add", args: [2, 3] },
    });
    expect(port1Messages).toContainEqual({
      op: ProtectedAPIOpCode.InvokeResponse,
      id: 7,
      name: "add",
      args: [5],
    });

    // Keep FakeChannel referenced cleanly
    expect(FakeChannel).toBeDefined();
  });

  it("YTMHook captures PLAYER_CONTROLLER_TOKEN and STATE_STORE_TOKEN via Map.prototype.set", async () => {
    const origMapSet = Map.prototype.set;
    try {
      const { default: hook } = await import("../ytmhook");
      hook.init();

      class FakePlayerController {
        public ok = true;
      }
      const m = new Map<any, any>();
      const ctrlEntry = { useClass: FakePlayerController };
      m.set({ name: "PLAYER_CONTROLLER_TOKEN" }, ctrlEntry);
      const ctrlInstance = new ctrlEntry.useClass();
      expect(hook.ytmPlayerController).toBe(ctrlInstance);

      const stateEntry = { useFactory: () => ({ storeId: 1 }) };
      m.set({ name: "STATE_STORE_TOKEN" }, stateEntry);
      const storeInstance = stateEntry.useFactory();
      expect(hook.ytmStateStore).toBe(storeInstance);

      await expect(hook.ready()).resolves.toBeUndefined();
    } finally {
      Object.defineProperty(Map.prototype, "set", {
        value: origMapSet,
        writable: true,
        configurable: true,
      });
    }
  });
});
