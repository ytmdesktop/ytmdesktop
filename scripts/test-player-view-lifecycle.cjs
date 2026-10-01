// Run with: node scripts/test-player-view-lifecycle.cjs
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require('typescript');
const source = fs.readFileSync('src/main/index.ts', 'utf8');
const file = ts.createSourceFile('index.ts', source, ts.ScriptTarget.Latest, true);
const names = new Set(['setYtmViewStatus', 'beginYtmViewLoad']);
const events = new Set(['did-start-navigation', 'did-fail-load', 'responsive', 'unresponsive']);
const ipcEvents = new Set(['ytmView:playerReady', 'ytmView:initializationFailed']);
const chunks = [];
function visit(node) {
  if (ts.isFunctionDeclaration(node) && names.has(node.name?.text)) chunks.push(node.getText(file));
  if (ts.isCallExpression(node) && node.arguments.length > 0 && ts.isStringLiteral(node.arguments[0])) {
    const callee = node.expression.getText(file), event = node.arguments[0].text;
    if ((callee === 'ytmView.webContents.on' && events.has(event)) || (callee === 'ipcMain.on' && ipcEvents.has(event))) chunks.push(node.getText(file) + ';');
  }
  ts.forEachChild(node, visit);
}
visit(file);
assert.equal(chunks.length, 8);
const handlers = {}, ipc = {}, state = {}, timers = new Map(); let serial = 0;
const contents = {on: (event, fn) => {handlers[event] = fn;}};
const context = vm.createContext({ytmViewLoadTimeout: null, ytmPlayerInitialized: false, ytmViewStatus: 'loading', ytmViewMessage: '',
  ytmView: {webContents: contents}, ipcMain: {on: (event, fn) => {ipc[event] = fn;}},
  memoryStore: {set: (key, value) => {state[key] = value;}, get: key => state[key]},
  linuxMiniPlayerService: {updateViewState() {}}, setTimeout: fn => {timers.set(++serial, fn); return serial;}, clearTimeout: id => timers.delete(id)});
vm.runInContext(ts.transpileModule(chunks.join('\n'), {compilerOptions: {target: ts.ScriptTarget.ES2022}}).outputText, context);
const begin = () => vm.runInContext('beginYtmViewLoad()', context);
const ready = () => ipc['ytmView:playerReady']({sender: contents});
begin(); assert.equal(context.ytmViewStatus, 'loading');
handlers['did-start-navigation']({}, '', false, false); assert.equal(timers.size, 1);
ipc['ytmView:playerReady']({sender: {}}); assert.equal(context.ytmViewStatus, 'loading');
ready(); assert.equal(context.ytmViewStatus, 'ready'); assert.equal(timers.size, 0);
handlers['did-start-navigation']({}, '', true, true); assert.equal(context.ytmViewStatus, 'ready', 'SPA navigation must preserve readiness');
handlers.unresponsive(); assert.equal(context.ytmViewStatus, 'error');
handlers.responsive(); assert.equal(context.ytmViewStatus, 'ready');
handlers['did-start-navigation']({}, '', false, true); assert.equal(context.ytmViewStatus, 'loading');
handlers['did-fail-load']({}, -105, 'NAME_NOT_RESOLVED', '', false); assert.equal(context.ytmViewStatus, 'loading');
handlers['did-fail-load']({}, -3, 'ABORTED', '', true); assert.equal(context.ytmViewStatus, 'loading');
handlers['did-fail-load']({}, -105, 'NAME_NOT_RESOLVED', '', true); assert.equal(context.ytmViewStatus, 'error'); assert.equal(timers.size, 0);
handlers.responsive(); assert.equal(context.ytmViewStatus, 'error', 'responsive alone cannot finish an uninitialized document');
begin(); assert.equal(state.ytmViewLoadingError, false);
const timeout = [...timers.values()][0]; timeout(); assert.equal(context.ytmViewStatus, 'error');
begin(); ipc['ytmView:initializationFailed']({sender: {}}); assert.equal(context.ytmViewStatus, 'loading');
ipc['ytmView:initializationFailed']({sender: contents}); assert.equal(context.ytmViewStatus, 'error'); assert.equal(timers.size, 0);
begin(); ready(); assert.equal(context.ytmViewStatus, 'ready'); assert.equal(state.ytmViewLoadTimedout, false);
console.log('PASS: initialization deadline, full/SPA navigation, stale senders, main-frame failures, aborted redirects, unresponsiveness and recovery');
