// Focused regression checks. Run with: node scripts/test-mini-player.cjs
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const source = fs.readFileSync("src/renderer/ytmview/scripts/search.script.js", "utf8");
const menu = id => ({
  text: { runs: [{ text: "Play next" }] },
  serviceEndpoint: { queueAddEndpoint: { queueTarget: { videoId: id }, queueInsertPosition: "INSERT_AFTER_CURRENT_VIDEO" } }
});
const song = (id, title, type, count) => ({
  musicResponsiveListItemRenderer: {
    flexColumns: [
      { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: title }] } } },
      { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: count || "" }] } } }
    ],
    navigationEndpoint: { watchEndpoint: { videoId: id, watchEndpointMusicSupportedConfigs: { watchEndpointMusicConfig: { musicVideoType: type } } } },
    menu: { menuRenderer: { items: [{ menuServiceItemRenderer: menu(id) }] } }
  }
});
const album = {
  musicResponsiveListItemRenderer: {
    flexColumns: [{ musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: "파급효과 (Ripple Effect)" }] } } }],
    navigationEndpoint: {
      browseEndpoint: {
        browseId: "MPREtest",
        browseEndpointContextSupportedConfigs: { browseEndpointContextMusicConfig: { pageType: "MUSIC_PAGE_TYPE_ALBUM" } }
      }
    }
  }
};
const shelf = contents => ({ contents: { sectionListRenderer: { contents: [{ musicShelfRenderer: { contents } }] } } });
let queue = ["CURRENT0001"],
  state = 2,
  time = 42,
  insert = true,
  ad = false,
  removed = 0,
  fail = false,
  clock = 0;
const bar = {
  queue: { getCurrentItemIndex: () => 0, getItems: () => queue.map(videoId => ({ playlistPanelVideoRenderer: { videoId } })) },
  playerApi: { getPlayerState: () => state, getCurrentTime: () => time }
};
const requests = [];
const api = vm.runInNewContext(source, {
  window: { ytcfg: { get: key => (key === "INNERTUBE_CONTEXT" ? { client: { hl: "en" } } : "test") } },
  Date: { now: () => clock },
  setTimeout: (fn, ms) => {
    clock += ms;
    fn();
  },
  document: {
    querySelector: s => (s === "ytmusic-app" ? { appendChild() {} } : s === "ytmusic-player-bar" ? bar : { classList: { contains: () => ad } }),
    createElement: () => ({
      remove() {
        removed++;
      },
      onTap() {
        if (insert) queue.splice(1, 0, this.data.serviceEndpoint.queueAddEndpoint.queueTarget.videoId);
      }
    })
  },
  fetch: async (url, options) => {
    const body = JSON.parse(options.body);
    requests.push(body);
    const data = url.includes("/browse")
      ? shelf([song("TRACK000002", "Second", "MUSIC_VIDEO_TYPE_ATV"), song("TRACK000001", "First", "MUSIC_VIDEO_TYPE_ATV")])
      : body.params?.includes("AQIY")
        ? shelf([album])
        : shelf([
            song("UNRELATED01", "ALL IN", "MUSIC_VIDEO_TYPE_ATV", "352만회 재생"),
            song("ORIGINAL001", "소문내", "MUSIC_VIDEO_TYPE_ATV", "99만회 재생"),
            song("OTHER000001", "소문내", "MUSIC_VIDEO_TYPE_ATV", "12K plays"),
            song("VIDEO000001", "소문내 Official Video", "MUSIC_VIDEO_TYPE_UGC", "663K views"),
            song("VIDEO000002", "소문내", "MUSIC_VIDEO_TYPE_OMV", "1.2M views")
          ]);
    return { ok: !fail, status: 503, json: async () => data };
  }
});
(async () => {
  const results = await api.search("소문내", "music");
  const songs = results.filter(x => x.kind === "music");
  assert.equal(songs[0].id, "ORIGINAL001");
  assert.equal(songs[0].playCount, 990000);
  assert.equal(songs[1].playCount, 12000);
  assert(results.some(x => x.kind === "album"));
  assert.equal(requests[0].context.client.hl, "ko");
  const videos = await api.search("소문내", "video");
  assert(videos.every(x => x.kind === "video"));
  assert(videos.some(x => x.id === "VIDEO000001"));
  const page = await api.albumBrowse({ albumId: "MPREtest" });
  assert.deepEqual(
    Array.from(page.items, x => x.title),
    ["Second", "First"]
  );
  assert((await api.playNext("ORIGINAL001")).title === "소문내");
  assert.deepEqual(queue, ["CURRENT0001", "ORIGINAL001"]);
  assert.equal(state, 2);
  assert.equal(time, 42);
  assert.equal(removed, 1);
  state = -1;
  await assert.rejects(api.playNext("ORIGINAL001"), /Press Play once/);
  state = 2;
  queue = [];
  await assert.rejects(api.playNext("ORIGINAL001"), /Start playback/);
  queue = ["CURRENT0001"];
  ad = true;
  await assert.rejects(api.playNext("ORIGINAL001"), /advertisement/);
  ad = false;
  insert = false;
  await assert.rejects(api.playNext("ORIGINAL001"), /did not confirm/);
  await assert.rejects(api.playNext("MISSING0001"), /Search again/);
  fail = true;
  await assert.rejects(api.search("query", "video"), /503/);
  const uiSource = fs.readFileSync('src/gnome-shell-extension/ytmdesktop-miniplayer@ytmdesktop/extension.js', 'utf8');
  const methods = ['_openAlbum', '_applyAlbumJson', '_applySearchJson', '_applyQueueJson'].map(name => {
    const start = uiSource.indexOf(`    ${name}(`);
    return uiSource.slice(start, uiSource.indexOf('\n    }', start) + 6);
  }).join('\n');
  const UI = vm.runInNewContext(`(class {${methods}})`, {console, GLib: {source_remove() {}, timeout_add() {return 1;}, PRIORITY_DEFAULT: 0}});
  const ui = new UI();
  const calls = [];
  Object.assign(ui, {_renderSearch() {}, _call(...args) {calls.push(args);}, _searchOrder: 'video', _searchEntry: {get_text: () => 'query'}, _queueStatus: {}});
  ui._openAlbum({albumId: 'album1', title: 'Album'});
  assert.equal(calls[0][0], 'AlbumBrowse');
  ui._applyAlbumJson(JSON.stringify({albumId:'old',status:'ready',items:[{id:'wrong'}]}));
  assert.equal(ui._artistView.songs.length,0);
  ui._applyAlbumJson(JSON.stringify({albumId:'album1',status:'ready',items:[{id:'first'},{id:'second'}],continuation:'next'}));
  assert.deepEqual(Array.from(ui._artistView.songs, x=>x.id), ['first','second']);
  ui._searchState = {status:'loading'};
  ui._applySearchJson(JSON.stringify({query:'query',mode:'music',status:'ready',results:[]}));
  assert.equal(ui._searchState.status,'loading');
  ui._queuePending = 'VIDEO000001';
  ui._applyQueueJson(JSON.stringify({videoId:'other',status:'ready',title:'wrong'}));
  assert.equal(ui._queueStatus.text,undefined);
  ui._applyQueueJson(JSON.stringify({videoId:'VIDEO000001',status:'error',message:'Not inserted'}));
  assert.equal(ui._queueStatus.text,'Not inserted');
  ui._queuePending = 'VIDEO000001';
  ui._applyQueueJson(JSON.stringify({videoId:'VIDEO000001',status:'ready',title:'Video'}));
  assert.equal(ui._queueStatus.text,'“Video” added to next');
  console.log(
    "PASS: relevance/counts/localization, album classification/order, video isolation, verified queue insertion, empty queue/ad/stale ID/timeout/API errors"
  );
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
