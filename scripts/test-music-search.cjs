const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('src/renderer/ytmview/scripts/search.script.js', 'utf8');
const title = text => ({flexColumns: [{musicResponsiveListItemFlexColumnRenderer: {text: {runs: [{text}]}}}]});
const row = (name, type, id) => ({musicResponsiveListItemRenderer: {
  ...title(name), navigationEndpoint: type === 'song' || type === 'podcast' || type === 'video' ? {
    watchEndpoint: {videoId: id, watchEndpointMusicSupportedConfigs: {watchEndpointMusicConfig: {
      musicVideoType: {song: 'MUSIC_VIDEO_TYPE_ATV', podcast: 'MUSIC_VIDEO_TYPE_PODCAST_EPISODE', video: 'MUSIC_VIDEO_TYPE_UGC'}[type]
    }}}
  } : {browseEndpoint: {browseId: id, browseEndpointContextSupportedConfigs: {browseEndpointContextMusicConfig: {
    pageType: type === 'artist' ? 'MUSIC_PAGE_TYPE_ARTIST' : 'MUSIC_PAGE_TYPE_ALBUM'
  }}}}
}});
const shelf = contents => ({contents: {sectionListRenderer: {contents: [{musicShelfRenderer: {contents}}]}}});
let requests = [];
const api = vm.runInNewContext(source, {
  window: {ytcfg: {get: key => key === 'INNERTUBE_CONTEXT' ? {client: {hl: 'ko'}} : 'test'}},
  fetch: async (url, options) => {
    const body = JSON.parse(options.body); requests.push(body);
    const data = body.continuation ? {continuationContents: {musicShelfContinuation: {
      contents: [row('Duplicate', 'artist', 'UC0'), row('New', 'artist', 'UC60')]
    }}} : body.params?.includes('AQIg') ? {...shelf(Array.from({length: 60}, (_, i) => row('Artist '+i, 'artist', 'UC'+i))),
      nextContinuationData: {continuation: 'next'}} : body.params?.includes('AQIY') ? shelf([row('Irrelevant album', 'album', 'MPRE1')]) : body.params ?
      shelf([row('API first', 'song', 'SONG0000001'), row('Query', 'song', 'SONG0000002'), row('Podcast', 'podcast', 'PODCAST0001'), row('Video', 'video', 'VIDEO000001')]) :
      shelf([row('Irrelevant album', 'album', 'MPRE1'), row('Query', 'song', 'SONG0000002')]);
    return {ok: true, json: async () => data};
  }
});
(async () => {
  let page = await api.searchMusic({query: 'Query', category: 'all'});
  assert.equal(requests.length, 4);
  assert(requests.every(request => request.context.client.hl === 'en'));
  assert.equal(page.sectionOrder[0], 'songs');
  assert.deepEqual(Array.from(page.results.filter(item => item.kind === 'music'), item => item.id), ['SONG0000001', 'SONG0000002']);
  assert.equal(page.results.filter(item => item.kind === 'artist').length, 60);
  assert.equal(page.artistsNext, 'next');
  requests = [];
  page = await api.searchMusic({query: 'Query', category: 'songs'});
  assert.equal(requests.length, 1);
  assert(page.results.every(item => item.kind === 'music'));
  page = await api.searchMusic({query: 'Query', category: 'all', continuation: 'next'});
  assert.equal(page.results.length, 2);
  assert.equal(page.artistsNext, null);

  const uiSource = fs.readFileSync('src/gnome-shell-extension/ytmdesktop-miniplayer@ytmdesktop/extension.js', 'utf8');
  const methods = ['_applyMusicJson', '_moreArtists', '_orderedSearchResults'].map(name => {
    const start = uiSource.indexOf(`    ${name}(`);
    return uiSource.slice(start, uiSource.indexOf('\n    }', start) + 6);
  }).join('\n');
  const UI = vm.runInNewContext(`(class {${methods}})`, {console});
  const ui = new UI(); let loads = 0;
  Object.assign(ui, {_searchOrder: 'music', _musicCategory: 'all', _searchEntry: {get_text: () => 'Query'},
    _renderSearch() {}, _renderKeepingScroll() {}, _requestMusic() { loads++; this._searchState.moreLoading = true; },
    _searchState: {requestKey: '2', status: 'ready', artistsVisible: 5, artistsNext: 'next', results: Array.from({length: 7}, (_, i) => ({kind: 'artist', artistId: 'UC'+i}))}});
  ui._moreArtists(); assert.equal(loads, 0); assert.equal(ui._searchState.artistsVisible, 15);
  ui._moreArtists(); ui._moreArtists(); assert.equal(loads, 1);
  const reply = {requestKey: '2', query: 'Query', category: 'all', append: true, status: 'ready', results: [{kind: 'artist', artistId: 'UC0'}, {kind: 'artist', artistId: 'UC7'}], artistsNext: null};
  ui._applyMusicJson(JSON.stringify({...reply, requestKey: '1'})); assert.equal(ui._searchState.results.length, 7);
  ui._applyMusicJson(JSON.stringify({...reply, category: 'songs'})); assert.equal(ui._searchState.results.length, 7);
  ui._applyMusicJson(JSON.stringify({...reply, status: 'error', message: 'Try again'}));
  assert.equal(ui._searchState.artistsNext, 'next'); assert.equal(ui._searchState.results.length, 7); assert.equal(ui._searchState.moreLoading, false);
  ui._applyMusicJson(JSON.stringify(reply)); assert.equal(ui._searchState.results.length, 8); assert.equal(ui._searchState.artistsNext, null);
  console.log('PASS: dedicated filters, strict songs, API order, section relevance, 60 hidden artists, continuation, stale responses, deduplication, retry and duplicate clicks');
})().catch(error => {console.error(error); process.exitCode = 1;});
