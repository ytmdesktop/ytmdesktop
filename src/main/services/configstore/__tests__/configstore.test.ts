import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

let mockUserDataDir = "";
let mockAppVersion = "2.2.0";

vi.mock("electron", () => ({
  app: {
    getPath: vi.fn(() => mockUserDataDir),
    getVersion: vi.fn(() => mockAppVersion),
    disableHardwareAcceleration: vi.fn(),
    setLoginItemSettings: vi.fn(),
    commandLine: {
      appendSwitch: vi.fn(),
    },
  },
  ipcMain: {
    handle: vi.fn(),
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

import ConfigStore from "../index";

describe("ConfigStore defaults and >=2.2.0 migration", () => {
  const tempDirs: string[] = [];

  function createTempUserDataDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ytmd-configstore-"));
    tempDirs.push(dir);
    mockUserDataDir = dir;
    return dir;
  }

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    mockAppVersion = "2.2.0";
  });

  it("initializes listenTogether defaults on a fresh store", () => {
    createTempUserDataDir();
    const store = new ConfigStore();
    store.onPreInitialized();

    expect(store.get("listenTogether")).toEqual({
      clientSlug: "",
      displayName: "",
      signalingUrl: null,
      trustedSignalingHosts: [],
      tailcatDerpMapUrl: null,
      lanDiscoveryEnabled: false,
      persistentRoomEnabled: true,
      persistentRoomName: "",
      persistentHostKeypair: null,
      persistentRoomId: null,
      persistentQueue: [],
      favoriteRooms: [],
      recentRooms: [],
      friends: [],
    });
    expect(store.get("listenTogether.displayName")).toBe("");
    expect(store.get("listenTogether.signalingUrl")).toBeNull();
    expect(store.get("listenTogether.trustedSignalingHosts")).toEqual([]);
    expect(store.get("listenTogether.tailcatDerpMapUrl")).toBeNull();
  });

  it("migrates pre-2.2.0 configs to populate listenTogether keys without overwriting existing values", () => {
    const dir = createTempUserDataDir();
    mockAppVersion = "2.2.0";

    const legacyConfig = {
      __internal__: {
        migrations: {
          version: "2.1.0",
        },
      },
      metadata: {
        version: 1,
        appVersion: "2.1.0",
      },
      general: {
        disableHardwareAcceleration: false,
        hideToTrayOnClose: false,
        showNotificationOnSongChange: false,
        startOnBoot: false,
        startMinimized: false,
      },
      listenTogether: {
        displayName: "ExistingDJ",
      },
    };
    fs.writeFileSync(
      path.join(dir, "config.json"),
      JSON.stringify(legacyConfig, null, 2),
      "utf8",
    );

    const store = new ConfigStore();
    store.onPreInitialized();

    expect(store.get("listenTogether.displayName")).toBe("ExistingDJ");
    expect(store.get("listenTogether.signalingUrl")).toBeNull();
    expect(store.get("listenTogether.trustedSignalingHosts")).toEqual([]);
  });

  it("populates all listenTogether keys when migrating from 2.1.0 with no listenTogether section", () => {
    const dir = createTempUserDataDir();
    mockAppVersion = "2.2.0";

    const legacyConfig = {
      __internal__: {
        migrations: {
          version: "2.1.0",
        },
      },
      metadata: {
        version: 1,
        appVersion: "2.1.0",
      },
    };
    fs.writeFileSync(
      path.join(dir, "config.json"),
      JSON.stringify(legacyConfig, null, 2),
      "utf8",
    );

    const store = new ConfigStore();
    store.onPreInitialized();

    expect(store.get("listenTogether")).toEqual({
      clientSlug: "",
      displayName: "",
      signalingUrl: null,
      trustedSignalingHosts: [],
      tailcatDerpMapUrl: null,
      lanDiscoveryEnabled: false,
      persistentRoomEnabled: true,
      persistentRoomName: "",
      persistentHostKeypair: null,
      persistentRoomId: null,
      persistentQueue: [],
      favoriteRooms: [],
      recentRooms: [],
      friends: [],
    });
  });
});
