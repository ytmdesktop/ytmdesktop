// Run with: node scripts/test-player-recovery.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function loadTs(file, requireModule) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, esModuleInterop: true}
  }).outputText, {exports, require: requireModule, setTimeout, clearTimeout, URL});
  return exports;
}
const enums = loadTs('src/shared/player-state.ts', require);
const Readiness = loadTs('src/main/gnome-panel-readiness.ts', require).default;
let methods;
const emitted = [];
const Service = loadTs('src/main/linux-mini-player-service.ts', name => {
  if (name === './player-state-store') return enums;
  if (name === './gnome-panel-readiness') return {default: Readiness, __esModule: true};
  if (name === 'electron-log') return {info() {}, warn() {}, error() {}};
  assert.equal(name, 'dbus-native');
  return {
    defineInterface: spec => {
      methods = spec.methods;
      return {emit: Object.fromEntries(Object.keys(spec.signals).map(name => [name, value => emitted.push([name, value])]))};
    },
    sessionBus: () => ({connection: {on() {}}, ownName: async () => ({isPrimaryOwner: true, release() {}}),
      export: async () => ({remove() {}}), close() {}})
  };
}).default;
const calls = [];
const state = {videoDetails: {id: 'CURRENT0001', title: 'Current track', author: 'Artist', thumbnails: [], durationSeconds: 180},
  trackState: enums.VideoState.Playing, videoProgress: 42, queue: {items: [{}]}, volume: 60};
let failRefresh = false;
const actions = Object.fromEntries(['command', 'searchMusic', 'startResultMix', 'albumBrowse', 'playNext', 'openAlbum', 'search',
  'artistBrowse', 'openArtist', 'playResult', 'toggleMainWindow', 'showMainWindow', 'openSettings', 'quit'].map(name => [name, () => calls.push(name)]));
actions.refresh = () => {calls.push('refresh'); if (failRefresh) throw Error('View creation failed');};
(async () => {
  const service = new Service(actions, state, {authenticated: true, hasSavedTrack: true}, {version: 46, changed() {}});
  await service.start();
  const snapshot = () => JSON.parse(methods.GetState.handler());
  assert.equal(snapshot().status, 'loading');
  assert.equal(snapshot().canPlay, false, 'cached track cannot enable a loading view');
  service.updateViewState('ready');
  assert.equal(snapshot().status, 'playing');
  service.updateViewState('error', 'Initialization timed out');
  service.updatePlayerState(state);
  service.updateSessionState({authenticated: true, hasSavedTrack: true});
  assert.equal(snapshot().status, 'error', 'metadata/auth updates must not clear a view failure');
  for (const capability of ['canPlay', 'canPrevious', 'canNext', 'canLike', 'canSkipAd']) assert.equal(snapshot()[capability], false);
  const musicRequests = {
    Command: {command: 'playPause', value: 0}, Search: {query: 'song'}, SearchByMode: {query: 'song', mode: 'music'},
    SearchMusic: {}, StartResultMix: {videoId: 'CURRENT0001'}, AlbumBrowse: {}, PlayNext: {},
    OpenAlbum: {albumId: 'MPREtest'}, PlayResult: {videoId: 'CURRENT0001', action: 'now'},
    ArtistBrowse: {artistId: 'UCtest', section: '', continuation: ''}, OpenArtist: {browseId: 'UCtest'}
  };
  for (const [name, request] of Object.entries(musicRequests)) assert.throws(() => methods[name].handler(request), /not ready/, name);
  for (const name of ['ToggleMainWindow', 'ShowMainWindow', 'OpenSettings', 'Quit']) methods[name].handler();
  assert.deepEqual(calls, ['toggleMainWindow', 'showMainWindow', 'openSettings', 'quit']);
  methods.Refresh.handler(); methods.Refresh.handler();
  assert.equal(calls.filter(name => name === 'refresh').length, 1, 'duplicate refresh must be ignored while reconnecting');
  assert.equal(snapshot().viewStatus, 'loading');
  service.updateViewState('error', 'Connection failed');
  failRefresh = true;
  assert.throws(() => methods.Refresh.handler(), /View creation failed/);
  assert.equal(snapshot().status, 'error');
  failRefresh = false;
  methods.Refresh.handler();
  service.updatePlayerState(state);
  assert.equal(snapshot().viewStatus, 'loading');
  service.updateViewState('ready');
  assert.equal(snapshot().canPlay, true);
  methods.Command.handler({command: 'playPause', value: 0});
  assert.equal(calls.at(-1), 'command');
  await service.stop();

  // Exercise the actual controller-only Start mix script, including its navigation endpoint.
  const dispatched = [];
  const startMixSource = fs.readFileSync('src/renderer/ytmview/scripts/startmix.script.js', 'utf8');
  const makeMix = hook => vm.runInNewContext(startMixSource, {window: {__YTMD_HOOK__: hook},
    document: {querySelector: () => ({}), dispatchEvent: e => dispatched.push(e)},
    CustomEvent: class {constructor(type, options) {this.type = type; this.detail = options.detail;}}});
  const hook = {ytmStore: {getState: () => ({queue: {items: []}})}, ytmPlayerBar: {playerApi: {getPlayerResponse: () => ({videoDetails: {videoId: 'CURRENT0001'}})}}};
  assert.equal(makeMix(hook)().videoId, 'CURRENT0001');
  assert.equal(dispatched[0].detail.endpoint.watchEndpoint.playlistId, 'RDAMVMCURRENT0001');
  assert.throws(makeMix({}), /Player unavailable/);

  // Execute the real extension methods with actor doubles; no music request reaches D-Bus while blocked.
  const uiPath = fs.existsSync('src/gnome-shell-extension/ytmdesktop-miniplayer@ytmdesktop/ui.js')
    ? 'src/gnome-shell-extension/ytmdesktop-miniplayer@ytmdesktop/ui.js'
    : 'src/gnome-shell-extension/ytmdesktop-miniplayer@ytmdesktop/extension.js';
  const uiSource = fs.readFileSync(uiPath, 'utf8');
  const names = ['_musicUnavailable', '_refreshPlayer', '_updateRecoveryUi', '_call'];
  const body = names.map(name => {const start = uiSource.indexOf(`    ${name}(`); assert(start > 0); return uiSource.slice(start, uiSource.indexOf('\n    }', start) + 6);}).join('\n');
  const UI = vm.runInNewContext(`(class {${body}})`, {console: {error() {}}, global: {stage: {get_key_focus: () => null}}});
  const ui = new UI(); const sent = []; let refreshCallback;
  Object.assign(ui, {_state: {viewStatus: 'error', message: 'Timed out'}, _recoveryOverlay: {}, _recoveryLabel: {}, _refreshButton: {},
    _playerContent: {}, _searchWrap: {}, _searchEntry: {get_clutter_text: () => ({set_editable() {}})},
    _setButtonEnabled(button, enabled) {button.reactive = enabled;}, menu: {close() {sent.push('close');}},
    _updateUi() {this._updateRecoveryUi();}, _proxy: {g_name_owner: ':1.23',
      CommandRemote() {sent.push('command');}, OpenSettingsRemote() {sent.push('settings');}, QuitRemote() {sent.push('quit');},
      RefreshRemote(callback) {sent.push('refresh'); refreshCallback = callback;}}});
  ui._updateRecoveryUi();
  assert.equal(ui._recoveryOverlay.visible, true); assert.equal(ui._playerContent.opacity, 65);
  ui._call('Command', 'playPause', 0); assert.equal(sent.length, 0);
  ui._call('OpenSettings'); ui._call('Quit');
  assert.deepEqual(sent, ['settings', 'close', 'quit', 'close']);
  ui._refreshPlayer(); ui._refreshPlayer();
  assert.equal(sent.filter(name => name === 'refresh').length, 1);
  assert.equal(ui._refreshButton.reactive, false);
  refreshCallback(null, Error('D-Bus request failed'));
  assert.equal(ui._state.viewStatus, 'error'); assert.equal(ui._refreshButton.reactive, true);
  ui._state = {viewStatus: 'ready'}; ui._updateRecoveryUi();
  assert.equal(ui._recoveryOverlay.visible, false); assert.equal(ui._playerContent.opacity, 255);
  ui._call('Command', 'playPause', 0); assert.equal(sent.at(-1), 'command');
  console.log('PASS: stale-track failure priority, all music guards, footer access, duplicate/failed/successful recovery, controller-only mix and recovery rendering');
})().catch(error => {console.error(error); process.exitCode = 1;});
