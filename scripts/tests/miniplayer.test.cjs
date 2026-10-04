const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const root = path.resolve(__dirname, '../../src/renderer/ytmview');
const preload = fs.readFileSync(path.join(root, 'preload.ts'), 'utf8');
const hookScript = preload.slice(preload.indexOf('// This function helps hook YTM')).match(/executeJavaScript\(`([\s\S]*?)`\)/)[1];
const readinessScript = preload.slice(preload.indexOf('const hooked =')).match(/executeJavaScript\(`([\s\S]*?)`\)/)[1];

function environment(modern) {
  const context = vm.createContext({ window: {}, document: { querySelector: () => modern ? {} : null } });
  vm.runInContext(hookScript, context)();
  const store = { getState() {}, dispatch() {}, subscribe() {} };
  context.window.PolymerFakeBaseClassWithoutHtml.call({ store });
  return context;
}

test('legacy player bar remains preferred when both controllers exist', () => {
  const context = environment(true);
  const player = { hostElement: { nodeName: 'YTMUSIC-PLAYER' }, playerApi: {} };
  const bar = { hostElement: { nodeName: 'YTMUSIC-PLAYER-BAR' }, playerApi: {} };
  context.window.PolymerFakeBaseClassWithoutHtml.call(player);
  context.window.PolymerFakeBaseClassWithoutHtml.call(bar);
  assert.equal(vm.runInContext(readinessScript, context)(), true);
  assert.equal(context.window.__YTMD_HOOK__.ytmPlayerBar, bar);
});

test('miniplayer starts without the removed legacy player bar', () => {
  const context = environment(true);
  const player = { hostElement: { nodeName: 'YTMUSIC-PLAYER' } };
  context.window.PolymerFakeBaseClassWithoutHtml.call(player);
  assert.equal(vm.runInContext(readinessScript, context)(), false);
  player.playerApi = {};
  assert.equal(vm.runInContext(readinessScript, context)(), true);
  assert.equal(context.window.__YTMD_HOOK__.ytmPlayerBar, player);
});

test('legacy layout waits for its bar instead of selecting the fallback early', () => {
  const context = environment(false);
  context.window.PolymerFakeBaseClassWithoutHtml.call({ hostElement: { nodeName: 'YTMUSIC-PLAYER' }, playerApi: {} });
  assert.equal(vm.runInContext(readinessScript, context)(), false);
});

test('metadata and store updates tolerate missing legacy DOM', () => {
  const events = {};
  const updates = [];
  const data = [];
  let subscription;
  const store = {
    getState: () => ({ likeStatus: { videos: {} }, player: { volume: 50, muted: false, adPlaying: false }, queue: {} }),
    subscribe: callback => { subscription = callback; }
  };
  const api = {
    addEventListener: (name, callback) => { events[name] = callback; },
    getPlayerResponse: () => ({ videoDetails: { videoId: 'test-video', title: 'Test' } }),
    getPlaylistId: () => 'test-playlist'
  };
  const context = vm.createContext({
    document: { querySelector: () => null },
    window: {
      __YTMD_HOOK__: { ytmStore: store, ytmPlayerBar: { playerApi: api } },
      addEventListener() {},
      ytmd: { sendStoreUpdate: (...args) => updates.push(args), sendVideoData: (...args) => data.push(args) }
    }
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'scripts/hookplayerapievents.script.js'), 'utf8'), context)();
  subscription();
  events.onVideoDataChange({ playertype: 1, type: 'dataloaded' });
  assert.equal(updates[0][1], 'UNKNOWN');
  assert.equal(updates[0][2], 50);
  assert.equal(data[0][0].videoId, 'test-video');
  assert.equal(data[0][3], 'UNKNOWN');
  assert.equal(data[0][4], false);
});
