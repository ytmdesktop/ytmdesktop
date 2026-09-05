(function () {
  const MAX_RESULTS = 20;
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

    return {
      // Without a radio videoId the id is only a dedup/display key; PlayResult must never see it.
      id: videoId ?? `artist:${artistId}`,
      title,
      artist,
      duration,
      artworkUrl: pickArtworkUrl(renderer.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails),
      playlistId: watchEndpoint?.playlistId ?? renderer.playlistItemData?.playlistId ?? null,
      kind: artistId ? "artist" : resultKind(watchEndpoint, renderer, subtitleRuns),
      artistId
    };
  }

  function parseCard(renderer) {
    if (!renderer) return null;
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

    return {
      id: videoId ?? `artist:${artistId}`,
      title,
      artist: artists.join(", ") || subtitleFromRuns(subtitleRuns),
      duration,
      artworkUrl: pickArtworkUrl(renderer.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails),
      playlistId: watchEndpoint?.playlistId ?? null,
      kind: artistId ? "artist" : resultKind(watchEndpoint, nestedRenderer ?? renderer, subtitleRuns),
      artistId
    };
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

  async function innertube(endpoint, body) {
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
      body: JSON.stringify({ context, ...body }),
      credentials: "include"
    });

    if (!response.ok) throw new Error(`YouTube Music ${endpoint} failed (${response.status})`);
    return response.json();
  }

  async function search(query) {
    const payload = await innertube("search", { query });
    const results = [];
    const seen = new Set();
    const sections =
      payload?.contents?.tabbedSearchResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents ??
      payload?.contents?.sectionListRenderer?.contents ??
      [];
    collectFromSections(sections, results, seen);
    if (!results.length) fallbackCollect(payload, results, seen);
    return results;
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
    return {
      id: videoId,
      title,
      artist: runsText(subtitleRuns).replace(/^(\s*•\s*)+|(\s*•\s*)+$/g, "").trim(),
      duration: null,
      artworkUrl: pickArtworkUrl(renderer.thumbnailRenderer?.musicThumbnailRenderer?.thumbnail?.thumbnails),
      playlistId: watchEndpoint.playlistId ?? null,
      kind: resultKind(watchEndpoint, renderer, subtitleRuns) === "music" ? "music" : "video",
      artistId: null
    };
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

  return { search, artistBrowse };
})()
