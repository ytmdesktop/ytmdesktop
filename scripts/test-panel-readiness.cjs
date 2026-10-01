// Run with: node scripts/test-panel-readiness.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
let now = 0, serial = 0;
const timers = new Map();
const exportsObject = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/main/gnome-panel-readiness.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS }
}).outputText, {
  exports: exportsObject,
  require: name => { assert.equal(name, 'node:crypto'); return { randomUUID: () => `session-${++serial}` }; },
  Date: { now: () => now },
  setTimeout: fn => { const id = ++serial; timers.set(id, fn); return id; },
  clearTimeout: id => timers.delete(id)
});
const Readiness = exportsObject.default;
const changes = [];
let timeouts = 0;
const panel = new Readiness(41, ready => changes.push(ready), () => timeouts++);
assert.equal(panel.report(41, panel.description.session), false, 'must begin before accepting UI');
panel.begin();
const first = panel.description.session;
assert.equal(panel.report(40, first), false, 'old UI must keep the tray');
assert.equal(panel.report(41, 'old-app'), false, 'stale app session must keep the tray');
assert.equal(panel.isReady, false);
assert.equal(panel.report(41, first), true);
assert.equal(panel.report(41, first), true, 'duplicate report is idempotent');
assert.deepEqual(changes, [true]);
assert.equal(timers.size, 0);
panel.begin();
assert.equal(panel.isReady, false);
assert.equal(panel.report(41, first), false, 'extension restart invalidates earlier reports');
now = 10000;
assert.equal(panel.report(41, panel.description.session), false, 'deadline is enforced even before timer delivery');
for (const [id, fn] of [...timers]) { timers.delete(id); fn(); }
assert.equal(timeouts, 1);
assert.equal(panel.isReady, false);
panel.begin();
assert.equal(panel.report(41, panel.description.session), true);
panel.stop();
assert.equal(panel.report(41, panel.description.session), false);
assert.equal(timers.size, 0);
const secondPackage = new Readiness(42, () => {}, () => {});
secondPackage.begin();
assert.equal(secondPackage.report(41, secondPackage.description.session), false);
assert.equal(secondPackage.report(42, secondPackage.description.session), true);
secondPackage.stop();
// A panel returning after the original deadline needs a fresh handshake, not a late report.
const returningPanel = new Readiness(44, () => {}, () => {});
returningPanel.begin();
const expiredSession = returningPanel.description.session;
now += 3 * 60 * 60 * 1000;
assert.equal(returningPanel.report(44, expiredSession), false);
const renewed = returningPanel.requestSession();
assert.notEqual(renewed.session, expiredSession);
assert.equal(returningPanel.requestSession().session, renewed.session, 'concurrent requests share the active window');
assert.equal(returningPanel.report(44, expiredSession), false, 'renewal must not accept a stale panel report');
assert.equal(returningPanel.report(43, renewed.session), false, 'renewal must retain version validation');
assert.equal(returningPanel.report(44, renewed.session), true);
assert.equal(returningPanel.requestSession().session, renewed.session, 'ready panels remain stable');
returningPanel.stop();
const afterStop = returningPanel.requestSession();
assert.notEqual(afterStop.session, renewed.session);
for (const [id, fn] of [...timers]) {timers.delete(id); fn();}
const afterTimeout = returningPanel.requestSession();
assert.notEqual(afterTimeout.session, afterStop.session, 'a delivered timeout also permits a fresh handshake');
assert.equal(returningPanel.report(44, afterTimeout.session), true);
returningPanel.stop();
const serviceSource = fs.readFileSync('src/main/linux-mini-player-service.ts', 'utf8');
const handlerText = serviceSource.match(/GetPanelSession: \{[\s\S]*?handler: \(\) => ([^\n]+)/)[1];
const serviceHandshake = vm.runInNewContext(`(function() {return ${handlerText};})`);
assert.equal(JSON.parse(serviceHandshake.call({panelReadiness: returningPanel})).session, returningPanel.description.session);
assert.equal(returningPanel.isPending, true, 'the D-Bus handler must use the renewing handshake');
returningPanel.stop();
console.log('PASS: late reactivation renews the handshake, stale/version-mismatched reports remain rejected');
const ui = fs.readFileSync('src/gnome-shell-extension/ytmdesktop-miniplayer@ytmdesktop/extension.js', 'utf8');
const metadata = JSON.parse(fs.readFileSync('src/gnome-shell-extension/ytmdesktop-miniplayer@ytmdesktop/metadata.json', 'utf8'));
assert.equal(Number(ui.match(/const UI_VERSION = (\d+);/)[1]), metadata.version, 'loaded code version must match packaged metadata');
console.log('PASS: version/session checks, restart invalidation, timeout, fallback state, duplicate reports, shutdown, UI/package version parity');

// Exercise the integration decision with real readiness transitions. Creating and destroying
// a transient tray can leave a stale AppIndicator menu even after its D-Bus object is gone.
(async () => {
  const source = fs.readFileSync('src/main/index.ts', 'utf8');
  const start = source.indexOf('async function applyPlatformTrayIntegration()');
  const end = source.indexOf('\nfunction toggleMainWindowVisibility()', start);
  let created = 0, destroyed = 0, active = null, apply, update;
  const watcher = {isEnabled: true};
  const gate = new Readiness(44, () => { if (apply) update = apply(); }, () => {});
  const service = {get isPanelPending() {return gate.isPending;}};
  apply = vm.runInNewContext(`${source.slice(start, end)}\napplyPlatformTrayIntegration`, {
    gnomeShellExtensionWatcher: watcher,
    linuxMiniPlayerService: service,
    startLinuxMiniPlayerService: async () => {},
    miniPlayerServingPanel: () => watcher.isEnabled && gate.isReady,
    createTray: () => created++, destroyTray: () => destroyed++,
    memoryStore: {set: (_key, value) => {active = value;}}
  });
  gate.begin();
  assert.equal(gate.isPending, true);
  await apply();
  assert.equal(created, 0, 'startup must not register a transient tray');
  gate.report(44, gate.description.session);
  await update;
  assert.equal(gate.isPending, false);
  assert.equal(created, 0);
  assert.equal(active, true);
  assert.equal(destroyed, 1);
  gate.begin();
  await update;
  for (const [id, fn] of [...timers]) {timers.delete(id); fn();}
  await update;
  assert.equal(gate.isPending, false);
  assert.equal(created, 1, 'timeout must automatically restore the fallback');
  watcher.isEnabled = false;
  await apply();
  assert.equal(created, 2, 'sessions without an active extension retain the tray');
  console.log('PASS: startup has no transient tray, readiness replaces fallback, timeout and absent extension restore tray');
})().catch(error => {console.error(error); process.exitCode = 1;});
