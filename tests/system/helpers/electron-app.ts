import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";

export interface TrackSeedInput {
  entryId: string;
  videoId: string;
  title: string;
  author: string;
  durationSec: number;
  thumbnailUrl: string | null;
}

export interface YtmdE2EInstance {
  electronApp: ElectronApplication;
  userDataDir: string;
  titlebarPage: Page;
  listenTogetherPage: Page;
}

const REPO_ROOT = path.resolve(__dirname, "../../..");
const PKG_VERSION: string = JSON.parse(
  fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"),
).version;
const PACKAGED_LINUX_BIN = path.join(
  REPO_ROOT,
  "out/YouTube Music Desktop App-linux-x64/youtube-music-desktop-app",
);
const DEV_MAIN_ENTRY = path.join(REPO_ROOT, ".vite/main/index.cjs");

function getLaunchConfig(): {
  executablePath?: string;
  args: string[];
  display?: string;
} {
  const args = ["--no-sandbox", "--disable-dev-shm-usage", "--disable-features=Vulkan"];
  let display: string | undefined;
  if (!process.env.DISPLAY && fs.existsSync("/tmp/.X11-unix/X0")) {
    display = ":0";
  } else if (process.env.WAYLAND_DISPLAY && !process.env.DISPLAY) {
    args.push("--ozone-platform-hint=auto");
  }

  // Packaged binaries enable FusesPlugin, which blocks Playwright's --inspect=0 loader;
  // always launch Playwright against the repo root.
  if (fs.existsSync(DEV_MAIN_ENTRY)) {
    return { args: [REPO_ROOT, ...args], display };
  }

  if (process.env.YTMD_E2E_ALLOW_PACKAGED === "1" && fs.existsSync(PACKAGED_LINUX_BIN)) {
    return { executablePath: PACKAGED_LINUX_BIN, args, display };
  }

  throw new Error(
    `Vite main bundle (${DEV_MAIN_ENTRY}) does not exist. Run 'electron-forge package' first to build .vite/.`,
  );
}

async function waitForPageByUrl(
  electronApp: ElectronApplication,
  predicate: (url: string) => boolean,
  timeoutMs = 20_000,
): Promise<Page> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const pages = electronApp.windows();
    for (const page of pages) {
      if (predicate(page.url())) {
        return page;
      }
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  const seenUrls = electronApp.windows().map((p) => p.url());
  throw new Error(
    `Timed out waiting for matching Electron page. Open URLs: ${JSON.stringify(seenUrls)}`,
  );
}

export async function launchYtmdInstance(): Promise<YtmdE2EInstance> {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "ytmd-e2e-"));
  // Suppress v1ConfigMigration first-run modal dialog on clean temp profiles
  fs.writeFileSync(path.join(userDataDir, ".first-run"), "");
  // Pre-seed config.json to suppress Changelog modal and disable EnhancedMediaService
  // to avoid MPRIS2 D-Bus ZBus(NameTaken) crashes when running multiple instances in E2E.
  fs.writeFileSync(
    path.join(userDataDir, "config.json"),
    JSON.stringify({
      metadata: {
        version: 1,
        appVersion: PKG_VERSION,
      },
      integrations: {
        companionServerEnabled: false,
        companionServerAuthTokens: null,
        companionServerCORSWildcardEnabled: true,
        discordPresenceEnabled: false,
        lastFMEnabled: false,
        enhancedMediaServiceEnabled: false,
      },
    }),
  );
  const config = getLaunchConfig();

  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") {
      env[key] = value;
    }
  }
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_NO_ATTACH_CONSOLE;
  if (config.display) {
    env.DISPLAY = config.display;
  }
  env.YTMD_TEST_USER_DATA_DIR = userDataDir;
  env.YTMD_E2E_MODE = "1";

  const electronApp = await electron.launch({
    executablePath: config.executablePath,
    args: config.args,
    env,
  });

  // Wait for __ytmdE2E to finish initializing in Main
  await electronApp.evaluate(async () => {
    const deadline = Date.now() + 20_000;
    while (!(globalThis as any).__ytmdE2E && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100));
    }
    if (!(globalThis as any).__ytmdE2E) {
      throw new Error("Timed out waiting for __ytmdE2E in Main process");
    }
  });

  const titlebarPage = await waitForPageByUrl(
    electronApp,
    (url) => url.includes("titlebar"),
  );

  // Show main window & open Listen Together drawer
  await electronApp.evaluate(() => {
    const ctx = (globalThis as any).__ytmdE2E;
    ctx.mainWindow?.show?.();
    ctx.listenTogetherService.setPanelOpen(true);
  });

  const listenTogetherPage = await waitForPageByUrl(
    electronApp,
    (url) => url.includes("listen-together"),
  );

  await listenTogetherPage.waitForLoadState("domcontentloaded");

  return {
    electronApp,
    userDataDir,
    titlebarPage,
    listenTogetherPage,
  };
}

export async function closeYtmdInstance(
  instance: YtmdE2EInstance | undefined,
): Promise<void> {
  if (!instance) return;
  const withTimeout = async <T>(promise: Promise<T>, ms: number): Promise<T | undefined> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<undefined>((resolve) => {
          timer = setTimeout(() => resolve(undefined), ms);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
  try {
    await withTimeout(
      instance.electronApp.evaluate(async () => {
        const ctx = (globalThis as any).__ytmdE2E;
        await ctx?.listenTogetherService?.leaveRoom?.();
      }),
      5_000,
    );
  } catch {
    // Ignore shutdown races
  }
  try {
    const closed = await withTimeout(
      instance.electronApp.close().then(() => true),
      8_000,
    );
    if (!closed) {
      instance.electronApp.process().kill("SIGKILL");
    }
  } catch {
    try {
      instance.electronApp.process().kill("SIGKILL");
    } catch {
      // Ignore close errors
    }
  }
  try {
    fs.rmSync(instance.userDataDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

export async function getListenTogetherState(instance: YtmdE2EInstance) {
  return instance.electronApp.evaluate(() => {
    const ctx = (globalThis as any).__ytmdE2E;
    return ctx.listenTogetherService.getUIState();
  });
}

export async function enqueueTrackInRoom(
  instance: YtmdE2EInstance,
  track: TrackSeedInput,
): Promise<void> {
  const result = await instance.electronApp.evaluate((_electron, t) => {
    const ctx = (globalThis as any).__ytmdE2E;
    const svc = ctx.listenTogetherService as any;
    return svc.enqueueTrackMeta({
      videoId: t.videoId,
      title: t.title,
      author: t.author,
      durationSec: t.durationSec,
      thumbnailUrl: t.thumbnailUrl,
    });
  }, track);
  if (result && result.ok === false) {
    throw new Error(`enqueueTrackInRoom failed: ${result.error ?? "unknown"}`);
  }
}

export async function simulateLocalPlaybackEvent(
  instance: YtmdE2EInstance,
  payload: {
    kind: "track" | "playlist";
    videoId?: string | null;
    playlistId?: string | null;
    title?: string | null;
    meta?: {
      videoId: string;
      title: string;
      author: string;
      durationSec: number;
      thumbnailUrl: string | null;
    };
  },
): Promise<void> {
  await instance.electronApp.evaluate((_electron, p) => {
    const ctx = (globalThis as any).__ytmdE2E;
    const svc = ctx.listenTogetherService as any;
    svc.listenTogetherApi.emit("localPlaybackStarted", {
      kind: p.kind,
      videoId: p.videoId ?? null,
      playlistId: p.playlistId ?? null,
      title: p.title ?? null,
    });
    if (p.meta) {
      svc.listenTogetherApi.emit("localTrackMetaResolved", p.meta);
    }
  }, payload);
}
