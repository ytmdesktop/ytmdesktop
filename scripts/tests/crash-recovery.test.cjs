const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');
const source = fs.readFileSync('src/main/index.ts', 'utf8');
const handler = source.slice(source.indexOf('  const currentView = ytmView;'), source.indexOf('  ytmView.webContents.on("page-title-updated"'));
test('crashed view is detached and closed before replacement', () => {
  const calls = [];
  let callback;
  const view = {webContents: {
    on: (_event, cb) => { callback = cb; },
    removeAllListeners: () => calls.push('removeListeners'),
    close: () => calls.push('close')
  }};
  const context = {ytmView: view, applicationQuitting: false,
    mainWindow: {isDestroyed: () => false, removeBrowserView: v => {assert.equal(v, view); calls.push('detach');}},
    ytmViewLoadTimeout: 123, clearTimeout: () => calls.push('clearTimer'),
    log: {error: () => calls.push('log')}, store: {set: () => {}},
    lastUrl: '', lastVideoId: '', lastPlaylistId: '',
    createYTMView: () => {assert.equal(context.ytmView, null); calls.push('replace');}
  };
  vm.runInNewContext(handler, context);
  callback({}, {reason: 'crashed', exitCode: 1});
  assert.deepEqual(calls, ['log', 'detach', 'clearTimer', 'removeListeners', 'close', 'replace']);
  callback({}, {reason: 'crashed', exitCode: 1});
  assert.equal(calls.filter(x => x === 'replace').length, 1);
});
