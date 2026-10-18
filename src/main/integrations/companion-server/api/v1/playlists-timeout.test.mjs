/**
 * Exercises the real GET /api/v1/playlists handler.
 * Application source is not modified. Electron is mocked; the 30s timer is the production timer.
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";
import { mock } from "node:test";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";
import Fastify from "fastify";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../../../");
const bundlePath = path.join(projectRoot, "node_modules/.cache/playlists-route-under-test.mjs");

const ipcMain = new EventEmitter();
ipcMain.setMaxListeners(50);

const tokens = [
  { id: "companion-a", secret: "secret-a" },
  { id: "companion-b", secret: "secret-b" }
];

function hashToken(secret) {
  return crypto.createHash("sha256").update(secret).digest("hex");
}

const decryptedTokens = JSON.stringify(
  tokens.map(token => ({
    id: token.id,
    appId: token.id,
    appName: token.id,
    appVersion: "1.0.0",
    token: hashToken(token.secret),
    metadata: { version: 1 }
  }))
);

mock.module("electron", {
  namedExports: {
    ipcMain,
    BrowserWindow: class BrowserWindow {},
    BrowserView: class BrowserView {},
    safeStorage: {
      decryptString() {
        return decryptedTokens;
      },
      encryptString(value) {
        return Buffer.from(value);
      },
      isEncryptionAvailable() {
        return true;
      }
    }
  }
});

const unhandled = [];
function onUnhandledRejection(error) {
  unhandled.push(error);
}

let plugin;
let isDefinedAPIError;

before(async () => {
  fs.mkdirSync(path.dirname(bundlePath), { recursive: true });
  await esbuild.build({
    stdin: {
      contents: `
        export { default as plugin } from "./src/main/integrations/companion-server/api/v1/index.ts";
        export { isDefinedAPIError } from "./src/main/integrations/companion-server/api-shared/errors.ts";
      `,
      resolveDir: projectRoot,
      sourcefile: "playlists-route-entry.ts",
      loader: "ts"
    },
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: bundlePath,
    alias: {
      "~shared": path.join(projectRoot, "src/shared")
    },
    plugins: [
      {
        name: "externalize-dependencies",
        setup(build) {
          build.onResolve({ filter: /.*/ }, args => {
            if (args.path.startsWith(".") || path.isAbsolute(args.path) || args.path.startsWith("~shared")) return null;
            return { path: args.path, external: true };
          });
        }
      }
    ]
  });
  ({ plugin, isDefinedAPIError } = await import(bundlePath));
  process.on("unhandledRejection", onUnhandledRejection);
});

after(() => {
  process.off("unhandledRejection", onUnhandledRejection);
  fs.rmSync(bundlePath, { force: true });
});

function responseChannel(requestId) {
  return `ytmView:getPlaylists:response:${requestId}`;
}

function createView() {
  const sent = [];
  const webContents = {
    send(channel, requestId) {
      sent.push({ channel, requestId });
    }
  };
  return { webContents, sent };
}

function emitPlaylists(view, requestId, playlists) {
  return ipcMain.emit(responseChannel(requestId), { sender: view.webContents }, playlists);
}

async function yieldToHandler() {
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
}

async function createApp(view) {
  const logs = [];
  const errorHandlerCalls = [];
  let sendCount = 0;
  const app = Fastify({
    logger: {
      level: "info",
      stream: {
        write(message) {
          logs.push(String(message));
        }
      }
    }
  });
  app.decorate("io", {
    of() {
      return { use() {}, on() {}, emit() {} };
    },
    close() {}
  });
  app.setErrorHandler((error, _request, reply) => {
    errorHandlerCalls.push({
      code: error.code,
      message: error.message,
      sent: reply.sent
    });
    if (!isDefinedAPIError(error)) {
      if (!error.statusCode || error.statusCode >= 500) {
        reply.send(new Error("An internal server error occurred"));
        return;
      }
    }
    reply.send(error);
  });
  app.addHook("onSend", (_request, _reply, payload, done) => {
    sendCount += 1;
    done(null, payload);
  });
  await app.register(plugin, {
    prefix: "/api/v1",
    getYtmView: () => view,
    getStore: () => ({
      get(key) {
        if (key === "integrations") return { companionServerAuthTokens: "00" };
        throw new Error(`unexpected store key ${key}`);
      }
    })
  });
  await app.ready();
  await yieldToHandler();
  return {
    app,
    logs,
    errorHandlerCalls,
    sendCount: () => sendCount
  };
}

function installTimerSpy() {
  mock.timers.enable({ apis: ["setTimeout"] });
  const pending = [];
  const cleared = [];
  const mockedSetTimeout = global.setTimeout;
  const mockedClearTimeout = global.clearTimeout;
  global.setTimeout = (fn, delay, ...args) => {
    const id = mockedSetTimeout(fn, delay, ...args);
    if (delay === 30_000) {
      const stack = new Error().stack ?? "";
      pending.push({
        id,
        kind: stack.includes("playlists-route-under-test") ? "handler" : "other",
        cleared: false
      });
    }
    return id;
  };
  global.clearTimeout = id => {
    const timer = pending.find(entry => entry.id === id);
    if (timer) {
      timer.cleared = true;
      cleared.push(timer);
    }
    return mockedClearTimeout(id);
  };
  return {
    handlerTimers() {
      return pending.filter(entry => entry.kind === "handler");
    },
    cleared,
    restore() {
      global.setTimeout = mockedSetTimeout;
      global.clearTimeout = mockedClearTimeout;
      mock.timers.reset();
    }
  };
}

test("immediate playlist response cancels the timeout", async () => {
  const view = createView();
  const server = await createApp(view);
  const timers = installTimerSpy();
  const unhandledBefore = unhandled.length;
  try {
    view.webContents.send = (channel, requestId) => {
      view.sent.push({ channel, requestId });
      emitPlaylists(view, requestId, [{ id: "liked", title: "Liked songs" }]);
    };

    const response = await server.app.inject({
      method: "GET",
      url: "/api/v1/playlists",
      headers: { authorization: "secret-a" }
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), [{ id: "liked", title: "Liked songs" }]);
    assert.equal(server.sendCount(), 1);
    assert.equal(server.errorHandlerCalls.length, 0);
    assert.equal(view.sent.length, 1);
    assert.equal(ipcMain.listenerCount(responseChannel(view.sent[0].requestId)), 0);
    assert.equal(timers.handlerTimers().length, 1);
    assert.equal(timers.handlerTimers().every(timer => timer.cleared), true);
    assert.equal(server.logs.some(line => line.includes("Promise errored")), false);

    mock.timers.tick(30_000);
    await yieldToHandler();

    assert.equal(server.sendCount(), 1);
    assert.equal(server.errorHandlerCalls.length, 0);
    assert.equal(ipcMain.listenerCount(responseChannel(view.sent[0].requestId)), 0);
    assert.equal(timers.handlerTimers().every(timer => timer.cleared), true);
    assert.equal(unhandled.length, unhandledBefore);
    assert.equal(server.logs.some(line => line.includes("Promise errored")), false);
    assert.equal(server.logs.some(line => line.includes("YOUTUBE_MUSIC_TIME_OUT")), false);
    assert.equal(server.logs.some(line => line.includes("FST_ERR_REP_ALREADY_SENT")), false);
  } finally {
    timers.restore();
    await server.app.close();
  }
});

test("no playlist response returns the timeout error", async () => {
  const view = createView();
  const server = await createApp(view);
  const timers = installTimerSpy();
  try {
    const pending = server.app.inject({
      method: "GET",
      url: "/api/v1/playlists",
      headers: { authorization: "secret-a" }
    });
    await yieldToHandler();
    assert.equal(view.sent.length, 1);
    assert.equal(ipcMain.listenerCount(responseChannel(view.sent[0].requestId)), 1);

    mock.timers.tick(29_999);
    await yieldToHandler();
    assert.equal(server.sendCount(), 0);
    assert.equal(ipcMain.listenerCount(responseChannel(view.sent[0].requestId)), 1);

    mock.timers.tick(1);
    const response = await pending;
    await yieldToHandler();

    assert.equal(response.statusCode, 504);
    assert.equal(response.json().code, "YOUTUBE_MUSIC_TIME_OUT");
    assert.equal(response.json().message, "Response from YouTube Music took too long");
    assert.equal(server.sendCount(), 1);
    assert.equal(server.errorHandlerCalls.length, 1);
    assert.equal(server.errorHandlerCalls[0].sent, false);
    assert.equal(ipcMain.listenerCount(responseChannel(view.sent[0].requestId)), 0);
    assert.equal(timers.handlerTimers().some(timer => timer.cleared), false);
  } finally {
    timers.restore();
    await server.app.close();
  }
});

test("a playlist response after timeout does not send a second reply", async () => {
  const view = createView();
  const server = await createApp(view);
  const timers = installTimerSpy();
  try {
    const pending = server.app.inject({
      method: "GET",
      url: "/api/v1/playlists",
      headers: { authorization: "secret-a" }
    });
    await yieldToHandler();
    const requestId = view.sent[0].requestId;

    mock.timers.tick(30_000);
    const response = await pending;
    await yieldToHandler();

    assert.equal(response.statusCode, 504);
    assert.equal(ipcMain.listenerCount(responseChannel(requestId)), 0);
    const sendsAfterTimeout = server.sendCount();

    const hadListener = emitPlaylists(view, requestId, [{ id: "late", title: "Late" }]);
    await yieldToHandler();

    assert.equal(hadListener, false);
    assert.equal(server.sendCount(), sendsAfterTimeout);
    assert.equal(server.errorHandlerCalls.length, 1);
    assert.equal(server.logs.some(line => line.includes("FST_ERR_REP_ALREADY_SENT")), false);
  } finally {
    timers.restore();
    await server.app.close();
  }
});

test("overlapping playlist requests stay isolated per auth token and IPC channel", async () => {
  const view = createView();
  const server = await createApp(view);
  const timers = installTimerSpy();
  try {
    const sameTokenFirst = server.app.inject({
      method: "GET",
      url: "/api/v1/playlists",
      headers: { authorization: "secret-a" }
    });
    await yieldToHandler();
    const sameTokenSecond = await server.app.inject({
      method: "GET",
      url: "/api/v1/playlists",
      headers: { authorization: "secret-a" }
    });

    assert.equal(sameTokenSecond.statusCode, 429);
    assert.equal(view.sent.length, 1);
    const firstRequestId = view.sent[0].requestId;
    assert.equal(ipcMain.listenerCount(responseChannel(firstRequestId)), 1);

    emitPlaylists(view, firstRequestId, [{ id: firstRequestId, title: "First" }]);
    const firstResponse = await sameTokenFirst;
    assert.equal(firstResponse.statusCode, 200);
    assert.deepEqual(firstResponse.json(), [{ id: firstRequestId, title: "First" }]);
    assert.equal(ipcMain.listenerCount(responseChannel(firstRequestId)), 0);
    assert.equal(timers.handlerTimers().every(timer => timer.cleared), true);

    mock.timers.tick(30_000);
    await yieldToHandler();
    assert.equal(server.logs.some(line => line.includes("Promise errored")), false);
  } finally {
    timers.restore();
    await server.app.close();
  }

  const isolatedView = createView();
  isolatedView.webContents.send = (channel, requestId) => {
    isolatedView.sent.push({ channel, requestId });
    emitPlaylists(isolatedView, requestId, [{ id: requestId, title: requestId }]);
  };
  const isolated = await createApp(isolatedView);
  const isolatedTimers = installTimerSpy();
  try {
    const [responseA, responseB] = await Promise.all([
      isolated.app.inject({
        method: "GET",
        url: "/api/v1/playlists",
        headers: { authorization: "secret-a" }
      }),
      isolated.app.inject({
        method: "GET",
        url: "/api/v1/playlists",
        headers: { authorization: "secret-b" }
      })
    ]);

    assert.equal(responseA.statusCode, 200);
    assert.equal(responseB.statusCode, 200);
    const echoedIds = [responseA.json()[0].id, responseB.json()[0].id];
    assert.equal(new Set(echoedIds).size, 2);
    assert.deepEqual(echoedIds.sort(), isolatedView.sent.map(entry => entry.requestId).sort());
    for (const entry of isolatedView.sent) {
      assert.equal(ipcMain.listenerCount(responseChannel(entry.requestId)), 0);
    }
    assert.equal(isolatedTimers.handlerTimers().length, 2);
    assert.equal(isolatedTimers.handlerTimers().every(timer => timer.cleared), true);

    mock.timers.tick(30_000);
    await yieldToHandler();
    assert.equal(isolated.sendCount(), 2);
    assert.equal(isolated.errorHandlerCalls.length, 0);
    assert.equal(isolated.logs.some(line => line.includes("Promise errored")), false);
  } finally {
    isolatedTimers.restore();
    await isolated.app.close();
  }
});
