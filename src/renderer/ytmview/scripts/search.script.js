(function () {
  const MAX_RESULTS = 40;
  // Keep trusted menu data in the page; D-Bus clients only send a result ID.
  const cache = (window.__YTMD_MINI_RESULTS__ ??= new Map());
  function remember(renderer, result) {
    if (!result) return result;
    const menu = renderer?.menu?.menuRenderer?.items
      ?.map(item => item.menuServiceItemRenderer)
      .find(item => item?.serviceEndpoint?.queueAddEndpoint?.queueInsertPosition === "INSERT_AFTER_CURRENT_VIDEO");
    const mix = renderer?.menu?.menuRenderer?.items?.map(item => item.menuNavigationItemRenderer?.navigationEndpoint)
      .find(endpoint => endpoint?.watchEndpoint?.playlistId?.startsWith("RD") && endpoint.watchEndpoint.videoId === result.id);
    const canPlayNext = menu?.serviceEndpoint?.queueAddEndpoint?.queueTarget?.videoId === result.id;
    if (canPlayNext || mix) {
      cache.set(result.id, {menu: canPlayNext ? menu : null, mix, title: result.title});
      if (cache.size > 500) cache.delete(cache.keys().next().value);
    }
    result.canPlayNext = Boolean(canPlayNext);
    result.canStartMix = Boolean(mix);
    const text = JSON.stringify(renderer?.flexColumns?.slice(1) ?? renderer?.subtitle ?? []);
    const match = text.match(/([\d,.]+)\s*(K|M|B|thousand|million|billion|만|억)?\s*(?:plays|views|회)/i);
    result.playCount = match
      ? Number(match[1].replace(/,/g, "")) *
        ({ k: 1e3, m: 1e6, b: 1e9, thousand: 1e3, million: 1e6, billion: 1e9, 만: 1e4, 억: 1e8 }[match[2]?.toLowerCase()] ?? 1)
      : null;
    return result;
  }
  function normalized(text) {
    return text
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
  }
  function rankResults(results, query) {
    const q = normalized(query),
      tokens = q.split(/\s+/).filter(Boolean);
    const rank = item => {
      const title = normalized(item.title),
        all = normalized(`${item.title} ${item.artist}`);
      if (title === q) return 0;
      if (tokens.length && tokens.every(t => all.includes(t))) return 1;
      if (tokens.some(t => all.includes(t))) return 2;
      return 3;
    };
    return results
      .map((item, index) => ({ item, index }))
      .sort((a, b) => rank(a.item) - rank(b.item) || (b.item.playCount ?? -1) - (a.item.playCount ?? -1) || a.index - b.index)
      .map(entry => entry.item);
  }
  function parseAlbum(renderer) {
    const endpoint = renderer?.navigationEndpoint?.browseEndpoint;
    if (endpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType !== "MUSIC_PAGE_TYPE_ALBUM") return null;
    const title = runsText(renderer.title?.runs ?? renderer.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs).trim();
    if (!title) return null;
    return {
      id: `album:${endpoint.browseId}`,
      albumId: endpoint.browseId,
      title,
      artist: subtitleFromRuns(renderer.subtitle?.runs ?? renderer.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs ?? []),
      kind: "album",
      artistId: null,
      playlistId: null,
      duration: null,
      artworkUrl: pickArtworkUrl(
        renderer.thumbnailRenderer?.musicThumbnailRenderer?.thumbnail?.thumbnails ?? renderer.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails
      )
    };
  }
  const MUSIC_VIDEO_TYPES = new Set([
    "MUSIC_VIDEO_TYPE_ATV",
    "MUSIC_VIDEO_TYPE_PRIVATELY_OWNED_TRACK",
    "MUSIC_VIDEO_TYPE_PODCAST_EPISODE"
  ]);
  const VIDEO_VIDEO_TYPES = new Set(["MUSIC_VIDEO_TYPE_OMV", "MUSIC_VIDEO_TYPE_UGC"]);

  function runsText(runs) {
    return (runs ?? []).map(run => run.text ?? "").join("");
  }

  function pickArtworkUrl(thumbnails) {
    if (!thumbnails?.length) return null;
    const sorted = [...thumbnails].sort((left, right) => (left.width ?? 0) - (right.width ?? 0));
    return (sorted.find(thumbnail => (thumbnail.width ?? 0) >= 60) ?? sorted[sorted.length - 1]).url ?? null;
  }

  function resultKind(watchEndpoint, renderer, metadataRuns) {
    const musicVideoType =
      watchEndpoint?.watchEndpointMusicSupportedConfigs?.watchEndpointMusicConfig?.musicVideoType ??
      renderer?.playlistItemData?.musicVideoType ??
      renderer?.musicVideoType ??
      null;
    if (MUSIC_VIDEO_TYPES.has(musicVideoType)) return "music";
    if (VIDEO_VIDEO_TYPES.has(musicVideoType)) return "video";

    const labels = (metadataRuns ?? []).map(run => (run.text ?? "").trim().toLowerCase());
    if (labels.some(label => /^(video|videos|동영상)$/.test(label))) return "video";
    if (labels.some(label => /^(song|songs|노래|audio|podcast|팟캐스트)$/.test(label))) return "music";
    return "unknown";
  }

  function artistBrowseIdFromEndpoint(endpoint) {
    const browseEndpoint = endpoint?.browseEndpoint;
    const pageType = browseEndpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType;
    return pageType === "MUSIC_PAGE_TYPE_ARTIST" && browseEndpoint?.browseId ? browseEndpoint.browseId : null;
  }

  // An artist result navigates to a browse page instead of a watch page, so it has no videoId of
  // its own. Its identity is the UC… browseId, which is what the artist songs lookup needs.
  function artistBrowseIdFromRenderer(renderer) {
    if (!renderer) return null;
    const titleRuns =
      renderer.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs ??
      renderer.title?.runs ??
      [];
    return (
      artistBrowseIdFromEndpoint(renderer.navigationEndpoint) ??
      artistBrowseIdFromEndpoint(renderer.onTap) ??
      titleRuns.map(run => artistBrowseIdFromEndpoint(run.navigationEndpoint)).find(Boolean) ??
      null
    );
  }

  function watchEndpointFromRenderer(renderer) {
    if (!renderer) return null;
    const titleRuns =
      renderer.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs ??
      renderer.title?.runs ??
      [];
    return (
      renderer.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint ??
      renderer.navigationEndpoint?.watchEndpoint ??
      renderer.onTap?.watchEndpoint ??
      renderer.buttons?.map(button => button.buttonRenderer?.command?.watchEndpoint).find(Boolean) ??
      titleRuns.map(run => run.navigationEndpoint?.watchEndpoint).find(Boolean) ??
      null
    );
  }

  // YouTube Music leads a search subtitle with a type label ("Song", "Artist", ...) and a
  // separator run. Dropping the separators and joining what is left glued the label onto the
  // artist ("SongOkasian"), so skip the label structurally instead and keep YTM's own separators.
  function subtitleFromRuns(runs) {
    const texts = runs.map(run => run.text ?? "");
    const hasTypeLabel = texts.length >= 2 && texts[1].trim() === "•" && !runs[0].navigationEndpoint;
    return texts
      .slice(hasTypeLabel ? 2 : 0)
      .filter(text => !/^\d+:\d{2}(?::\d{2})?$/.test(text))
      .join("")
      .replace(/^(\s*•\s*)+|(\s*•\s*)+$/g, "")
      .trim();
  }

  function parseSong(renderer) {
    if (!renderer) return null;
    const album = parseAlbum(renderer);
    if (album) return album;
    const watchEndpoint = watchEndpointFromRenderer(renderer);
    const videoId = renderer.playlistItemData?.videoId ?? watchEndpoint?.videoId;
    const artistId = artistBrowseIdFromRenderer(renderer);
    if (!videoId && !artistId) return null;

    const title = runsText(renderer.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs).trim();
    if (!title) return null;

    const subtitleRuns = renderer.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs ?? [];
    const artists = [];
    let duration = renderer.fixedColumns?.[0]?.musicResponsiveListItemFixedColumnRenderer?.text?.runs?.[0]?.text ?? null;

    for (const run of subtitleRuns) {
      const pageType = run.navigationEndpoint?.browseEndpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType;
      if (pageType === "MUSIC_PAGE_TYPE_ARTIST" && run.text) artists.push(run.text);
      if (/^\d+:\d{2}(?::\d{2})?$/.test(run.text ?? "")) duration = run.text;
    }

    const artist = artists.join(", ") || subtitleFromRuns(subtitleRuns);

    return remember(renderer, {
      // Without a radio videoId the id is only a dedup/display key; PlayResult must never see it.
      id: videoId ?? `artist:${artistId}`,
      title,
      artist,
      duration,
      artworkUrl: pickArtworkUrl(renderer.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails),
      playlistId: watchEndpoint?.playlistId ?? renderer.playlistItemData?.playlistId ?? null,
      kind: artistId ? "artist" : resultKind(watchEndpoint, renderer, subtitleRuns),
      artistId
    });
  }

  function parseCard(renderer) {
    if (!renderer) return null;
    const album = parseAlbum(renderer);
    if (album) return album;
    const nestedRenderer = renderer.contents?.[0]?.musicResponsiveListItemRenderer ?? null;
    const watchEndpoint =
      watchEndpointFromRenderer(renderer) ??
      watchEndpointFromRenderer(nestedRenderer) ??
      nestedRenderer?.playlistItemData ??
      null;
    const videoId = watchEndpoint?.videoId ?? nestedRenderer?.playlistItemData?.videoId;
    const artistId = artistBrowseIdFromRenderer(renderer) ?? artistBrowseIdFromRenderer(nestedRenderer);
    if (!videoId && !artistId) return parseSong(nestedRenderer);

    const title = runsText(renderer.title?.runs).trim();
    if (!title) return parseSong(renderer.contents?.[0]?.musicResponsiveListItemRenderer);

    const subtitleRuns = renderer.subtitle?.runs ?? [];
    const artists = [];
    let duration = null;
    for (const run of subtitleRuns) {
      const pageType = run.navigationEndpoint?.browseEndpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType;
      if (pageType === "MUSIC_PAGE_TYPE_ARTIST" && run.text) artists.push(run.text);
      if (/^\d+:\d{2}(?::\d{2})?$/.test(run.text ?? "")) duration = run.text;
    }

    return remember(renderer, {
      id: videoId ?? `artist:${artistId}`,
      title,
      artist: artists.join(", ") || subtitleFromRuns(subtitleRuns),
      duration,
      artworkUrl: pickArtworkUrl(renderer.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails),
      playlistId: watchEndpoint?.playlistId ?? null,
      kind: artistId ? "artist" : resultKind(watchEndpoint, nestedRenderer ?? renderer, subtitleRuns),
      artistId
    });
  }

  function addResult(results, seen, song) {
    if (!song || seen.has(song.id) || results.length >= MAX_RESULTS) return;
    seen.add(song.id);
    results.push(song);
  }

  function collectFromSections(sections, results, seen) {
    for (const section of sections ?? []) {
      if (!section || typeof section !== "object") continue;
      if (section.itemSectionRenderer) {
        collectFromSections(section.itemSectionRenderer.contents, results, seen);
        continue;
      }
      if (section.musicCardShelfRenderer) {
        addResult(results, seen, parseCard(section.musicCardShelfRenderer));
        collectFromSections(section.musicCardShelfRenderer.contents, results, seen);
        continue;
      }
      if (section.musicShelfRenderer) {
        collectFromSections(section.musicShelfRenderer.contents, results, seen);
        continue;
      }
      if (section.musicTwoRowItemRenderer) addResult(results, seen, parseAlbum(section.musicTwoRowItemRenderer));
      if (section.musicResponsiveListItemRenderer) {
        addResult(results, seen, parseSong(section.musicResponsiveListItemRenderer));
      }
    }
  }

  function fallbackCollect(node, results, seen) {
    if (!node || typeof node !== "object" || results.length >= MAX_RESULTS) return;
    if (node.musicCardShelfRenderer) {
      addResult(results, seen, parseCard(node.musicCardShelfRenderer));
      return;
    }
    if (node.musicResponsiveListItemRenderer) {
      addResult(results, seen, parseSong(node.musicResponsiveListItemRenderer));
      return;
    }
    if (Array.isArray(node)) {
      for (const child of node) fallbackCollect(child, results, seen);
      return;
    }
    for (const child of Object.values(node)) fallbackCollect(child, results, seen);
  }

  async function innertube(endpoint, body, language = null) {
    const ytcfg = window.ytcfg;
    const apiKey = ytcfg?.get?.("INNERTUBE_API_KEY");
    const context = ytcfg?.get?.("INNERTUBE_CONTEXT");
    if (!apiKey || !context) throw new Error("YouTube Music API context is unavailable");

    // Runs inside the YTM page on purpose: the request rides on the page's own cookies.
    const response = await fetch(`https://music.youtube.com/youtubei/v1/${endpoint}?prettyPrint=false&key=${apiKey}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-YouTube-Client-Name": String(ytcfg.get("INNERTUBE_CONTEXT_CLIENT_NAME") ?? "67"),
        "X-YouTube-Client-Version": String(ytcfg.get("INNERTUBE_CLIENT_VERSION") ?? context.client?.clientVersion ?? "")
      },
      body: JSON.stringify({ context: language ? {...context, client: {...context.client, hl: language}} : context, ...body }),
      credentials: "include"
    });

    if (!response.ok) throw new Error(`YouTube Music ${endpoint} failed (${response.status})`);
    return response.json();
  }

  async function search(query, mode = "music") {
    if (mode !== "music" && mode !== "video") throw new Error("Invalid search mode");
    // From YouTube Music's Videos chip searchEndpoint (verified against the live page).
    // This requests the video shelf instead of sorting the limited mixed search response.
    const params = "EgWKAQIQAWoQEAUQCRADEAQQChAVEBAQDg%3D%3D";
    const language = /[가-힣]/.test(query) ? "ko" : null;
    const [payload, albums] = await Promise.all([
      innertube("search", mode === "video" ? { query, params } : { query }, language),
      mode === "music" ? innertube("search", {query, params:"EgWKAQIYAWoQEAUQCRADEAQQChAVEBAQDg%3D%3D"}, language) : Promise.resolve(null)
    ]);
    const results = [];
    const seen = new Set();
    const sections =
      payload?.contents?.tabbedSearchResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents ??
      payload?.contents?.sectionListRenderer?.contents ??
      [];
    collectFromSections(sections, results, seen);
    if (!results.length) fallbackCollect(payload, results, seen);
    if (albums) {
      const albumResults = [];
      fallbackCollect(albums, albumResults, new Set());
      for (const item of albumResults.filter(item => item.kind === "album")) {
        if (!seen.has(item.id)) { seen.add(item.id); results.push(item); }
      }
    }
    return rankResults(mode === "video" ? results.filter(result => result.kind === "video") : results, query);
  }

  // Params captured from the site's Songs, Artists and Albums chips. Keep video search separate.
  const MUSIC_FILTERS = {
    songs: "EgWKAQIIAWoQEAUQCRADEAQQChAVEBAQDg%3D%3D",
    artists: "EgWKAQIgAWoQEAUQCRADEAQQChAVEBAQDg%3D%3D",
    albums: "EgWKAQIYAWoQEAUQCRADEAQQChAVEBAQDg%3D%3D"
  };
  function searchItems(payload) {
    const items = [], seen = new Set();
    // Preserve every fetched item, including hidden artists, in response order.
    const visit = node => {
      if (!node || typeof node !== "object") return;
      const renderer = node.musicResponsiveListItemRenderer ?? node.musicTwoRowItemRenderer ?? node.musicCardShelfRenderer;
      if (renderer) {
        const item = node.musicCardShelfRenderer ? parseCard(renderer) : parseSong(node.musicTwoRowItemRenderer ? {...renderer, thumbnail: renderer.thumbnailRenderer, flexColumns: [{musicResponsiveListItemFlexColumnRenderer: {text: renderer.title}}, {musicResponsiveListItemFlexColumnRenderer: {text: renderer.subtitle}}]} : renderer);
        const key = item?.kind === "artist" ? item.artistId : item?.id;
        if (item && key && !seen.has(key)) { seen.add(key); items.push(item); }
        if (node.musicCardShelfRenderer) visit(renderer.contents);
        return;
      }
      for (const child of Object.values(node)) visit(child);
    };
    visit(payload);
    return items;
  }
  async function searchMusic(request) {
    const {query, category = "all", continuation = null} = request;
    if (!["all", "songs", "artists", "albums"].includes(category)) throw new Error("Invalid music category");
    const kinds = {songs:"music", artists:"artist", albums:"album"};
    const sections = category === "all" ? ["songs", "artists", "albums"] : [category];
    if (continuation && !["all", "artists"].includes(category)) throw new Error("Invalid artist continuation");
    const load = async section => {
      const payload = await innertube("search", continuation ? {continuation} : {query, params:MUSIC_FILTERS[section]}, "en");
      let items = searchItems(payload).filter(item => item.kind === kinds[section]);
      if (section === "songs") {
        // Podcast episodes use watch endpoints too, but are not songs.
        const songIds = new Set();
        for (const renderer of findAll(payload, "musicResponsiveListItemRenderer")) {
          const endpoint = watchEndpointFromRenderer(renderer);
          const type = endpoint?.watchEndpointMusicSupportedConfigs?.watchEndpointMusicConfig?.musicVideoType ?? renderer.playlistItemData?.musicVideoType ?? renderer.musicVideoType;
          if (["MUSIC_VIDEO_TYPE_ATV", "MUSIC_VIDEO_TYPE_PRIVATELY_OWNED_TRACK"].includes(type)) songIds.add(renderer.playlistItemData?.videoId ?? endpoint?.videoId);
        }
        items = items.filter(item => songIds.has(item.id));
      }
      return {section, items, next:section === "artists" ? continuationTokenFrom(payload) : null};
    };
    if (continuation) {
      const page = await load("artists");
      return {results:page.items, artistsNext:page.next, sectionOrder:["artists"]};
    }
    const [pages, mixed] = await Promise.all([
      Promise.all(sections.map(load)),
      category === "all" ? innertube("search", {query}, "en").then(searchItems) : Promise.resolve([])
    ]);
    const q = normalized(query), words = q.split(/\s+/).filter(Boolean);
    const relevance = item => {
      const title = normalized(item.title);
      return title === q ? 0 : q && title.includes(q) ? 1 : words.some(word => title.includes(word)) ? 2 : 3;
    };
    const mixedIndex = section => {const index = mixed.findIndex(item => item.kind === kinds[section]);return index < 0 ? Number.MAX_SAFE_INTEGER : index;};
    const order = pages.map(page => page.section).sort((left,right) => {
      const best = section => Math.min(4,...pages.find(page=>page.section===section).items.map(relevance));
      return best(left)-best(right) || mixedIndex(left)-mixedIndex(right) || sections.indexOf(left)-sections.indexOf(right);
    });
    return {results:pages.flatMap(page=>page.items), sectionOrder:order, artistsNext:pages.find(page=>page.section==="artists")?.next ?? null};
  }
  async function startResultMix(videoId) {
    const saved = cache.get(videoId), endpoint = saved?.mix?.watchEndpoint;
    if (!endpoint) throw new Error("Start mix is unavailable; refresh the results");
    const api = document.querySelector("ytmusic-player-bar")?.playerApi;
    if (!api) throw new Error("Player unavailable");
    document.dispatchEvent(new CustomEvent("yt-navigate", {detail:{endpoint:saved.mix}}));
    const deadline = Date.now()+7000;
    while (Date.now()<deadline) {
      if (api.getPlayerResponse()?.videoDetails?.videoId === endpoint.videoId && api.getPlaylistId?.() === endpoint.playlistId)
        return {videoId, title:saved.title};
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    throw new Error("YouTube Music did not confirm the selected mix");
  }

  // Depth-first search for the first object carrying `key`, so the artist page layout can move
  // between singleColumn/twoColumn/tabbed roots without the lookup breaking.
  function findFirst(node, key, depth = 0) {
    if (!node || typeof node !== "object" || depth > 24) return null;
    if (!Array.isArray(node) && node[key]) return node[key];
    for (const child of Array.isArray(node) ? node : Object.values(node)) {
      const found = findFirst(child, key, depth + 1);
      if (found) return found;
    }
    return null;
  }

  function continuationTokenFrom(node) {
    const item = findFirst(node, "continuationItemRenderer");
    const endpoint = item?.continuationEndpoint;
    const token =
      endpoint?.continuationCommand?.token ??
      endpoint?.commandExecutorCommand?.commands?.map(command => command.continuationCommand?.token).find(Boolean) ??
      findFirst(node, "nextContinuationData")?.continuation ??
      null;
    return typeof token === "string" && token ? token : null;
  }

  function parseTwoRow(renderer) {
    const watchEndpoint = renderer?.navigationEndpoint?.watchEndpoint ?? null;
    const videoId = watchEndpoint?.videoId;
    if (!videoId) return null;
    const title = runsText(renderer.title?.runs).trim();
    if (!title) return null;
    const subtitleRuns = renderer.subtitle?.runs ?? [];
    return remember(renderer, {
      id: videoId,
      title,
      artist: runsText(subtitleRuns).replace(/^(\s*•\s*)+|(\s*•\s*)+$/g, "").trim(),
      duration: null,
      artworkUrl: pickArtworkUrl(renderer.thumbnailRenderer?.musicThumbnailRenderer?.thumbnail?.thumbnails),
      playlistId: watchEndpoint.playlistId ?? null,
      kind: resultKind(watchEndpoint, renderer, subtitleRuns) === "music" ? "music" : "video",
      artistId: null
    });
  }

  // Song shelves and playlist pages use list items; the videos carousel and grid pages use two-row
  // tiles. Either way an artist row never belongs in a song or video list.
  function itemsFrom(list) {
    const items = [];
    const seen = new Set();
    for (const entry of list ?? []) {
      const item = entry?.musicResponsiveListItemRenderer
        ? parseSong(entry.musicResponsiveListItemRenderer)
        : entry?.musicTwoRowItemRenderer
          ? parseTwoRow(entry.musicTwoRowItemRenderer)
          : null;
      if (item && item.kind !== "artist" && !seen.has(item.id)) {
        seen.add(item.id);
        items.push(item);
      }
    }
    return items;
  }

  function findAll(node, key, out = [], depth = 0) {
    if (!node || typeof node !== "object" || depth > 24) return out;
    if (!Array.isArray(node) && node[key]) out.push(node[key]);
    for (const child of Array.isArray(node) ? node : Object.values(node)) findAll(child, key, out, depth + 1);
    return out;
  }

  // Albums, singles and related artists are carousels too. Only the videos carousel holds watch
  // endpoints, so pick it by structure rather than by its localized title.
  function findVideosCarousel(payload) {
    return (
      findAll(payload, "musicCarouselShelfRenderer").find(shelf =>
        (shelf.contents ?? []).some(entry => entry.musicTwoRowItemRenderer?.navigationEndpoint?.watchEndpoint)
      ) ?? null
    );
  }

  function browseNextFrom(endpoint) {
    const browseId = endpoint?.browseEndpoint?.browseId;
    if (!browseId) return null;
    const params = endpoint.browseEndpoint.params;
    return `browse:${browseId}${params ? `:${params}` : ""}`;
  }

  function pageItemsFrom(payload) {
    const grid = findFirst(payload, "gridRenderer");
    const shelf = findFirst(payload, "musicPlaylistShelfRenderer") ?? findFirst(payload, "musicShelfRenderer");
    const source = grid?.items?.length ? grid : shelf;
    return { items: itemsFrom(source?.items ?? source?.contents), continuation: continuationTokenFrom(source) };
  }

  // request: { artistId, section: "" | "songs" | "videos", continuation }
  //   no continuation          -> the artist page: top songs, the videos carousel, and the two
  //                               "see all" browse targets, all in YTM's own (popularity) order
  //   "browse:<id>[:<params>]" -> first page of the section's full list
  //   "token:<continuation>"   -> the pages after it
  async function artistBrowse(request) {
    const section = request?.section ?? "";
    const continuation = request?.continuation ?? "";

    if (continuation.startsWith("token:")) {
      const payload = await innertube("browse", { continuation: continuation.slice("token:".length) });
      const appended =
        payload?.onResponseReceivedActions?.flatMap(action => action.appendContinuationItemsAction?.continuationItems ?? []) ?? [];
      const legacy = payload?.continuationContents?.musicPlaylistShelfContinuation ?? payload?.continuationContents?.gridContinuation;
      const list = appended.length ? appended : (legacy?.contents ?? legacy?.items ?? []);
      return { section, items: itemsFrom(list), continuation: continuationTokenFrom(appended.length ? payload : legacy) };
    }

    if (continuation.startsWith("browse:")) {
      const [browseId, params] = continuation.slice("browse:".length).split(":");
      const payload = await innertube("browse", params ? { browseId, params } : { browseId });
      const page = pageItemsFrom(payload);
      return { section, items: page.items, continuation: page.continuation };
    }

    if (!request?.artistId) throw new Error("No artist to look up");
    const payload = await innertube("browse", { browseId: request.artistId });
    const header = findFirst(payload, "musicImmersiveHeaderRenderer") ?? findFirst(payload, "musicVisualHeaderRenderer");
    const songsShelf = findFirst(payload, "musicShelfRenderer");
    const videosShelf = findVideosCarousel(payload);
    return {
      section: "",
      name: runsText(header?.title?.runs).trim() || null,
      artworkUrl: pickArtworkUrl(header?.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails),
      songs: itemsFrom(songsShelf?.contents),
      videos: itemsFrom(videosShelf?.contents),
      songsNext:
        songsShelf?.title?.runs?.map(run => browseNextFrom(run.navigationEndpoint)).find(Boolean) ??
        browseNextFrom(songsShelf?.bottomEndpoint) ??
        null,
      videosNext:
        videosShelf?.header?.musicCarouselShelfBasicHeaderRenderer?.title?.runs?.map(run => browseNextFrom(run.navigationEndpoint)).find(Boolean) ??
        null
    };
  }

  async function albumBrowse(request) {
    if (!request?.albumId) throw new Error("No album to look up");
    const payload = await innertube("browse", request.continuation ? { continuation: request.continuation } : { browseId: request.albumId });
    const header = findFirst(payload, "musicResponsiveHeaderRenderer") ?? findFirst(payload, "musicDetailHeaderRenderer");
    const shelf =
      findFirst(payload, "musicPlaylistShelfRenderer") ?? findFirst(payload, "musicShelfRenderer") ?? findFirst(payload, "musicPlaylistShelfContinuation");
    const appended = payload.onResponseReceivedActions?.flatMap(action => action.appendContinuationItemsAction?.continuationItems ?? []) ?? [];
    return {
      albumId: request.albumId,
      name: runsText(header?.title?.runs) || null,
      artworkUrl: pickArtworkUrl(header?.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails),
      items: itemsFrom(shelf?.contents ?? appended),
      continuation: continuationTokenFrom(shelf ?? payload)
    };
  }
  async function playNext(videoId) {
    const saved = cache.get(videoId);
    if (!saved?.menu) throw new Error("Search again to refresh this item's Play next action");
    const app = document.querySelector("ytmusic-app"),
      bar = document.querySelector("ytmusic-player-bar");
    const queue = bar?.queue,
      api = bar?.playerApi;
    const unwrap = item => item?.playlistPanelVideoRenderer ?? item?.playlistPanelVideoWrapperRenderer?.primaryRenderer?.playlistPanelVideoRenderer;
    if (!queue || !api || !app) throw new Error("Player queue unavailable");
    if (document.querySelector("#movie_player")?.classList.contains("ad-showing")) throw new Error("Wait until the advertisement finishes");
    const index = queue.getCurrentItemIndex(),
      before = queue.getItems().map(item => unwrap(item)?.videoId);
    if (index < 0 || !before[index]) throw new Error("Start playback before adding a next track");
    const state = api.getPlayerState(),
      time = api.getCurrentTime(),
      current = before[index];
    if (state === -1 || state === 5) throw new Error("Press Play once before adding a next track");
    if (![1, 2].includes(state)) throw new Error("Wait until playback is ready");
    const menu = document.createElement("ytmusic-menu-service-item-renderer");
    menu.hidden = true;
    app.appendChild(menu);
    try {
      menu.data = saved.menu;
      await Promise.resolve();
      if (typeof menu.onTap !== "function") throw new Error("YouTube Music menu handler unavailable");
      menu.onTap();
    } finally {
      menu.remove();
    }
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const after = queue.getItems().map(item => unwrap(item)?.videoId),
        selected = queue.getCurrentItemIndex();
      if (selected !== index || after[selected] !== current) throw new Error("Current track changed during Play next");
      if (after.length > before.length && after[selected + 1] === videoId) {
        if (api.getPlayerState() !== state || Math.abs(api.getCurrentTime() - time) > (state === 2 ? 0.5 : 7))
          throw new Error("Playback changed during Play next");
        return { videoId, title: saved.title };
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error("YouTube Music did not confirm insertion into the next queue position");
  }
  return { search, searchMusic, artistBrowse, albumBrowse, playNext, startResultMix };
})()
