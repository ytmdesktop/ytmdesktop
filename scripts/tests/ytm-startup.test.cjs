const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");

const root = path.resolve(__dirname, "../..");
const preloadPath = path.join(root, "src/renderer/ytmview/preload.ts");
const flush = () => new Promise(setImmediate);

class Clock {
  now = 0;
  nextId = 0;
  timers = new Map();

  setTimeout(callback, delay = 0) {
    const id = ++this.nextId;
    this.timers.set(id, { callback, due: this.now + delay });
    return id;
  }

  clearTimeout(id) {
    this.timers.delete(id);
  }

  async advance(milliseconds) {
    // Let checks awaiting executeJavaScript schedule their next fake timer first.
    await flush();
    const target = this.now + milliseconds;
    for (;;) {
      const next = [...this.timers].sort((a, b) => a[1].due - b[1].due)[0];
      if (!next || next[1].due > target) break;
      this.now = next[1].due;
      this.timers.delete(next[0]);
      await next[1].callback();
      await flush();
    }
    this.now = target;
    await flush();
  }
}

function eventTarget() {
  const listeners = new Map();
  return {
    listeners,
    events: [],
    addEventListener(name, callback) {
      if (!listeners.has(name)) listeners.set(name, []);
      listeners.get(name).push(callback);
    },
    removeEventListener(name, callback) {
      listeners.set(
        name,
        (listeners.get(name) ?? []).filter(item => item !== callback)
      );
    },
    dispatchEvent(event) {
      this.events.push(event);
      for (const callback of listeners.get(event.type) ?? []) callback(event);
      return true;
    }
  };
}

function element(name) {
  const classes = new Set();
  const children = [];
  const selectors = new Map();
  const node = {
    ...eventTarget(),
    nodeName: name.toUpperCase(),
    children,
    selectors,
    style: { setProperty() {} },
    classList: {
      add: (...names) => names.forEach(value => classes.add(value)),
      remove: (...names) => names.forEach(value => classes.delete(value)),
      contains: name => classes.has(name)
    },
    appendChild(child) {
      children.push(child);
      child.parentNode = this;
      return child;
    },
    prepend(child) {
      children.unshift(child);
      child.parentNode = this;
    },
    insertBefore(child, reference) {
      children.splice(Math.max(children.indexOf(reference), 0), 0, child);
      child.parentNode = this;
    },
    insertAdjacentElement(_position, child) {
      this.parentNode?.appendChild(child);
      return child;
    },
    querySelector(selector) {
      return selectors.get(selector) ?? null;
    },
    setAttribute(name, value) {
      this[name] = value;
    },
    set(name, value) {
      this[name] = value;
    },
    blur() {},
    getMenuRenderer: () => null
  };
  node.setters = {
    data(value) {
      node.rawProps.data = value;
    },
    iconName(value) {
      node.rawProps.iconName = value;
    }
  };
  return node;
}

function createApi(name) {
  const api = {
    ...eventTarget(),
    name,
    calls: [],
    ready: true,
    state: 1,
    response: { videoDetails: { videoId: "current-video", title: "API title" } },
    isReady: () => api.ready,
    getPlayerState: () => api.state,
    getPlayerResponse: () => api.response,
    getPlaylistId: () => "current-playlist",
    getCurrentTime: () => 42,
    getVolume: () => 50
  };
  for (const method of ["playVideo", "pauseVideo", "nextVideo", "previousVideo", "seekTo", "setVolume", "mute", "unMute"]) {
    api[method] = (...args) => {
      api.calls.push([method, ...args]);
      if (method === "playVideo") api.state = 1;
      if (method === "pauseVideo") api.state = 2;
    };
  }
  return api;
}

async function harness(options = {}) {
  const clock = new Clock();
  const sent = [];
  const logs = [];
  const handlers = new Map();
  const selectors = new Map();
  const subscriptions = [];
  const storeState = {
    queue: { items: [], automixItems: [] },
    player: { volume: 50, muted: false, adPlaying: false },
    likeStatus: { videos: { "current-video": "LIKE" } },
    toggleStates: { feedbackToggleStates: {} }
  };
  const store = {
    actions: [],
    getState: () => storeState,
    subscribe: callback => subscriptions.push(callback),
    dispatch(action) {
      this.actions.push(action);
      for (const callback of subscriptions) callback();
    }
  };
  const document = {
    ...eventTarget(),
    head: element("head"),
    body: element("body"),
    createElement: element,
    createTextNode: text => ({ textContent: text }),
    querySelector(selector) {
      for (const part of selector.split(",")) {
        if (selectors.has(part.trim())) return selectors.get(part.trim());
      }
      return null;
    }
  };
  if (options.failStyles)
    document.head.appendChild = () => {
      throw new Error("Missing document head");
    };
  const window = {
    ...eventTarget(),
    location: { hostname: options.hostname ?? "music.youtube.com" },
    ytcfg: { data_: { EXPERIMENT_FLAGS: {} } }
  };
  const settings = {
    state: {
      lastUrl: options.savedUrl ?? "https://music.youtube.com/",
      lastVideoId: "saved-video",
      lastPlaylistId: "saved-playlist"
    },
    playback: { continueWhereYouLeftOff: options.resume ?? false },
    appearance: { alwaysShowVolumeSlider: false }
  };
  const globals = {
    window,
    document,
    console: { warn: (...args) => logs.push(args), log() {}, error: (...args) => logs.push(args) },
    setTimeout: clock.setTimeout.bind(clock),
    clearTimeout: clock.clearTimeout.bind(clock),
    Date: class extends Date {
      static now() {
        return clock.now;
      }
    },
    CustomEvent: class {
      constructor(type, init = {}) {
        this.type = type;
        Object.assign(this, init);
      }
    },
    history: { back() {}, forward() {} },
    crypto: { randomUUID: () => "fixture-id" }
  };
  const pageContext = vm.createContext({ ...globals });
  let executionCount = 0;
  const electron = {
    contextBridge: {
      exposeInMainWorld: (name, value) => {
        window[name] = value;
      }
    },
    ipcRenderer: {
      send: (...args) => sent.push(args),
      on(name, callback) {
        if (!handlers.has(name)) handlers.set(name, []);
        handlers.get(name).push(callback);
      },
      async invoke(name, key) {
        if (name === "settings:get") return settings[key];
        if (name === "ytmView:getIntegrationScripts") return {};
        throw new Error(`Unexpected IPC invocation: ${name}`);
      }
    },
    webFrame: {
      async executeJavaScript(code) {
        executionCount++;
        if (options.rejectExecution?.(executionCount)) throw new Error("private remote-page diagnostic");
        return vm.runInContext(code, pageContext, { filename: "injected-ytm-script.js" });
      }
    }
  };
  const preloadContext = vm.createContext({ ...globals, process: { type: "renderer" } });
  const modules = new Map();
  function loadModule(filename) {
    if (modules.has(filename)) return modules.get(filename).exports;
    const module = { exports: {} };
    modules.set(filename, module);
    const source = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
    }).outputText;
    const localRequire = specifier => {
      if (specifier === "electron") return electron;
      if (specifier.endsWith("?raw")) return fs.readFileSync(path.resolve(path.dirname(filename), specifier.replace("?raw", ".js")), "utf8");
      return loadModule(path.resolve(path.dirname(filename), `${specifier}.ts`));
    };
    vm.runInContext(`(function(require, module, exports) {\n${source}\n})`, preloadContext, { filename })(localRequire, module, module.exports);
    return module.exports;
  }
  loadModule(preloadPath);
  await flush();

  function installPlayer(layout, capture = true) {
    const api = createApi(layout);
    if (options.ready === false) api.ready = false;
    if (options.noSelectedVideo) api.response = null;
    const player = element(layout === "legacy" ? "ytmusic-player-bar" : "ytmusic-player");
    Object.assign(player, { playerApi: api, store, queue: { shuffle: () => api.calls.push(["shuffle"]) } });
    if (layout === "legacy") {
      selectors.set("ytmusic-app-layout>ytmusic-player-bar", player);
      player.currentItem = {
        title: { runs: [{ text: "Full current title" }] },
        thumbnail: { thumbnails: [{ url: "fixture-thumbnail" }] },
        longBylineText: {
          runs: [
            {
              text: "Current album",
              navigationEndpoint: {
                browseEndpoint: {
                  browseId: "current-album",
                  browseEndpointContextSupportedConfigs: { browseEndpointContextMusicConfig: { pageType: "MUSIC_PAGE_TYPE_ALBUM" } }
                }
              }
            }
          ]
        }
      };
      if (options.cosmetics !== false) {
        const like = element("ytmusic-like-button-renderer");
        like.data = { likeStatus: "INDIFFERENT", serviceEndpoints: [] };
        const right = element("div");
        right.selectors.set(".shuffle", element("button"));
        player.selectors.set("ytmusic-like-button-renderer", like);
        player.selectors.set(".right-controls-buttons", right);
        selectors.set("ytmusic-app-layout>ytmusic-player-bar ytmusic-like-button-renderer", like);
        selectors.set("ytmusic-like-button-renderer", like);
      }
    } else {
      selectors.set("ytmusic-player", options.domController ? { polymerController: player } : player);
      if (options.miniplayer !== false) selectors.set("ytmusic-miniplayer", element("ytmusic-miniplayer"));
    }
    if (capture && window.PolymerFakeBaseClassWithoutHtml) {
      window.PolymerFakeBaseClassWithoutHtml.call({ hostElement: player, playerApi: api, store });
    }
    return { api, player };
  }

  if (options.cosmetics !== false) {
    selectors.set("ytmusic-pivot-bar-renderer", element("ytmusic-pivot-bar-renderer"));
    selectors.set("#history-link .history-button", element("button"));
  }
  let primary;
  let modern;
  if (options.layout !== "none") primary = installPlayer(options.layout === "modern" ? "modern" : "legacy", options.capture !== false);
  if (options.layout === "both") modern = installPlayer("modern", options.capture !== false);
  const loadPromises = [];
  const h = {
    clock,
    sent,
    logs,
    handlers,
    document,
    window,
    store,
    selectors,
    api: primary?.api,
    player: primary?.player,
    modernApi: modern?.api,
    installPlayer,
    executionCount: () => executionCount,
    count: channel => sent.filter(([name]) => name === channel).length,
    messages: channel => sent.filter(([name]) => name === channel),
    load() {
      for (const callback of window.listeners.get("load") ?? []) loadPromises.push(Promise.resolve(callback()));
    },
    async emit(channel, ...args) {
      for (const callback of handlers.get(channel) ?? []) await callback({}, ...args);
      await flush();
    },
    async dispose() {
      window.dispatchEvent({ type: "pagehide" });
      await flush();
      await Promise.all(loadPromises);
      assert.equal(clock.timers.size, 0, "pagehide must cancel every pending player poll");
    }
  };
  return h;
}

async function initialized(t, options = {}) {
  const h = await harness(options);
  t.after(() => h.dispose());
  h.load();
  assert.equal(h.count("ytmView:loaded"), 1, "website must be visible before optional setup awaits");
  await flush();
  assert.equal(h.count("ytmView:integrationsReady"), 1);
  assert.equal(h.handlers.get("remoteControl:execute")?.length, 1);
  return h;
}

for (const layout of ["legacy", "modern"]) {
  test(`${layout} player initializes without font completion and supports native playback`, async t => {
    const h = await initialized(t, { layout });
    const fonts = h.document.head.children.filter(node => node.nodeName === "LINK");
    assert.equal(fonts.length, 1);
    // No load/error event is fired for the font: controls must already work.
    await h.emit("remoteControl:execute", "playPause");
    await h.emit("remoteControl:execute", "playPause");
    await h.emit("remoteControl:execute", "next");
    await h.emit("remoteControl:execute", "previous");
    await h.emit("remoteControl:execute", "seekTo", 123);
    await h.emit("remoteControl:execute", "setVolume", "65");
    assert.deepEqual(h.api.calls, [["pauseVideo"], ["playVideo"], ["nextVideo"], ["previousVideo"], ["seekTo", 123], ["setVolume", 65]]);
    assert.equal(h.store.actions.find(action => action.type === "SET_VOLUME").payload, 65);
    assert.equal(h.clock.timers.size, 0);
    assert.equal(h.count("ytmView:loaded"), 1);
  });
}

test("legacy player remains preferred when both players exist", async t => {
  const h = await initialized(t, { layout: "both" });
  await h.emit("remoteControl:execute", "play");
  assert.deepEqual(h.api.calls, [["playVideo"]]);
  assert.deepEqual(h.modernApi.calls, []);
});

test("modern layout safely handles commands whose legacy controls are absent", async t => {
  const h = await initialized(t, { layout: "modern" });
  await h.emit("remoteControl:execute", "toggleLike");
  await h.emit("remoteControl:execute", "toggleDislike");
  await h.emit("remoteControl:execute", "shuffle");
  await h.emit("ytmView:getPlaylists", "fixture-request");
  assert.deepEqual(h.api.calls, []);
  const responses = h.messages("ytmView:getPlaylists:response:fixture-request");
  assert.equal(responses.length, 1);
  assert.equal(responses[0][1].length, 0);
  assert.equal(h.count("ytmView:loaded"), 1);
});

test("DOM controller fallback initializes without a captured Polymer instance", async t => {
  const h = await initialized(t, { layout: "modern", capture: false, domController: true });
  await h.emit("remoteControl:execute", "pause");
  assert.deepEqual(h.api.calls, [["pauseVideo"]]);
});

test("a modern player without a recognized miniplayer does not attach native controls", async t => {
  const h = await harness({ layout: "modern", miniplayer: false });
  t.after(() => h.dispose());
  h.load();
  await h.clock.advance(12_000);
  assert.equal(h.count("ytmView:loaded"), 1);
  assert.equal(h.count("ytmView:integrationsReady"), 0);
  assert.equal(h.handlers.has("remoteControl:execute"), false);
  assert.deepEqual(h.api.calls, []);
});

test("missing hook shows the website, backs off, and cancels polling on pagehide", async t => {
  const h = await harness({ layout: "none" });
  t.after(() => h.dispose());
  h.load();
  assert.equal(h.count("ytmView:loaded"), 1);
  await h.clock.advance(10_000);
  assert.equal(h.count("ytmView:integrationsReady"), 0);
  assert.equal(h.clock.timers.size, 1);
  const executions = h.executionCount();
  await h.clock.advance(1_999);
  assert.equal(h.executionCount(), executions, "slow polling should avoid busy work");
  await h.clock.advance(1);
  assert.equal(h.executionCount(), executions + 1);
  await h.emit("remoteControl:execute", "playPause");
  assert.equal(h.handlers.has("remoteControl:execute"), false);
  await h.dispose();
  const afterUnload = h.executionCount();
  await h.clock.advance(20_000);
  assert.equal(h.executionCount(), afterUnload);
  assert.equal(h.count("ytmView:loaded"), 1);
});

test("a player appearing after the fast polling period attaches exactly once", async t => {
  const h = await harness({ layout: "none" });
  t.after(() => h.dispose());
  h.load();
  await h.clock.advance(12_000);
  const { api } = h.installPlayer("modern");
  await h.clock.advance(2_000);
  assert.equal(h.count("ytmView:loaded"), 1);
  assert.equal(h.count("ytmView:integrationsReady"), 1);
  assert.equal(h.handlers.get("remoteControl:execute").length, 1);
  await h.emit("remoteControl:execute", "play");
  assert.deepEqual(api.calls, [["playVideo"]]);
  await h.clock.advance(20_000);
  assert.equal(h.count("ytmView:integrationsReady"), 1);
  assert.equal(h.clock.timers.size, 0);
});

test("an API that becomes ready late does not hold the website loading screen", async t => {
  const h = await harness({ layout: "modern", ready: false });
  t.after(() => h.dispose());
  h.load();
  assert.equal(h.count("ytmView:loaded"), 1);
  await flush();
  await h.clock.advance(12_000);
  assert.equal(h.count("ytmView:integrationsReady"), 0);
  h.api.ready = true;
  await h.clock.advance(2_000);
  assert.equal(h.count("ytmView:integrationsReady"), 1);
  await h.emit("remoteControl:execute", "pause");
  assert.deepEqual(h.api.calls, [["pauseVideo"]]);
});

test("transient JavaScript execution failure recovers without exposing page data", async t => {
  const h = await harness({ layout: "modern", rejectExecution: count => count === 2 });
  t.after(() => h.dispose());
  h.load();
  assert.equal(h.count("ytmView:loaded"), 1);
  await flush();
  await h.clock.advance(250);
  assert.equal(h.count("ytmView:integrationsReady"), 1);
  assert.equal(JSON.stringify(h.logs).includes("private remote-page diagnostic"), false);
  await h.emit("remoteControl:execute", "play");
  assert.deepEqual(h.api.calls, [["playVideo"]]);
});

test("hook installation failure still releases the website and unloads cleanly", async t => {
  const h = await harness({ layout: "modern", rejectExecution: count => count === 1 });
  t.after(() => h.dispose());
  h.load();
  assert.equal(h.count("ytmView:loaded"), 1);
  await h.clock.advance(12_000);
  assert.equal(h.count("ytmView:integrationsReady"), 0);
  assert.equal(JSON.stringify(h.logs).includes("private remote-page diagnostic"), false);
});

test("missing cosmetic nodes and a failed style insertion preserve native controls", async t => {
  const h = await initialized(t, { cosmetics: false, failStyles: true });
  await h.emit("remoteControl:execute", "playPause");
  assert.deepEqual(h.api.calls, [["pauseVideo"]]);
  await h.emit("settings:stateChanged", { appearance: { alwaysShowVolumeSlider: true } }, {});
  assert.equal(h.count("ytmView:loaded"), 1);
});

test("saved watch URLs retain the full initial metadata snapshot with resume enabled", async t => {
  const h = await initialized(t, { resume: true, savedUrl: "https://music.youtube.com/watch?v=saved-video" });
  assert.equal(h.count("ytmView:videoStateChanged"), 1);
  assert.equal(h.messages("ytmView:videoStateChanged")[0][1], 1);
  assert.equal(h.messages("ytmView:videoProgressChanged")[0][1], 42);
  const snapshots = h.messages("ytmView:videoDataChanged");
  assert.equal(snapshots.length, 1);
  const [, details, playlist, album, like, full] = snapshots[0];
  assert.equal(details.videoId, "current-video");
  assert.equal(details.title, "Full current title");
  assert.equal(playlist, "current-playlist");
  assert.equal(album.id, "current-album");
  assert.equal(like, "LIKE");
  assert.equal(full, true);
  assert.equal(h.api.response.videoDetails.title, "API title", "metadata enrichment must not mutate YTM's response");
  assert.equal(h.document.events.filter(event => event.type === "yt-navigate").length, 0);
});

test("resume does not replace a song selected before desktop integration attached", async t => {
  const h = await initialized(t, { layout: "modern", resume: true });
  assert.equal(h.messages("ytmView:videoDataChanged")[0][1].videoId, "current-video");
  assert.equal(h.document.events.filter(event => event.type === "yt-navigate").length, 0);
});

test("resume still restores a saved song when no video has been selected", async t => {
  const h = await initialized(t, { layout: "modern", resume: true, noSelectedVideo: true });
  const navigations = h.document.events.filter(event => event.type === "yt-navigate");
  assert.equal(navigations.length, 1);
  assert.equal(navigations[0].detail.endpoint.watchEndpoint.videoId, "saved-video");
});

for (const hostname of ["consent.youtube.com", "accounts.google.com", "example.com"]) {
  test(`${hostname} retains its expected loading behavior`, async t => {
    const h = await harness({ hostname, layout: "none" });
    t.after(() => h.dispose());
    h.load();
    await flush();
    assert.equal(h.count("ytmView:loaded"), hostname === "example.com" ? 0 : 1);
    assert.equal(h.count("ytmView:integrationsReady"), 0);
    assert.equal(h.clock.timers.size, 0);
  });
}
