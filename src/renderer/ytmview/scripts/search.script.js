(function () {
  const MAX_RESULTS = 20;

  function runsText(runs) {
    return (runs ?? []).map(run => run.text ?? "").join("");
  }

  function pickArtworkUrl(thumbnails) {
    if (!thumbnails?.length) return null;
    const sorted = [...thumbnails].sort((left, right) => (left.width ?? 0) - (right.width ?? 0));
    return (sorted.find(thumbnail => (thumbnail.width ?? 0) >= 60) ?? sorted[sorted.length - 1]).url ?? null;
  }

  function parseSong(renderer) {
    if (!renderer) return null;
    const watchEndpoint =
      renderer.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint ??
      renderer.playlistItemData ??
      renderer.navigationEndpoint?.watchEndpoint ??
      null;
    const videoId = renderer.playlistItemData?.videoId ?? watchEndpoint?.videoId;
    if (!videoId) return null;

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

    const artist =
      artists.join(", ") ||
      subtitleRuns
        .map(run => run.text ?? "")
        .filter(text => text && text !== " • " && !/^\d+:\d{2}(?::\d{2})?$/.test(text))
        .join("")
        .replace(/^•\s*|\s*•$/g, "")
        .trim();

    return {
      id: videoId,
      title,
      artist,
      duration,
      artworkUrl: pickArtworkUrl(renderer.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails),
      playlistId: watchEndpoint?.playlistId ?? null
    };
  }

  function parseCard(renderer) {
    if (!renderer) return null;
    const watchEndpoint =
      renderer.onTap?.watchEndpoint ??
      renderer.buttons?.map(button => button.buttonRenderer?.command?.watchEndpoint).find(Boolean) ??
      renderer.contents?.[0]?.musicResponsiveListItemRenderer?.playlistItemData ??
      null;
    const videoId = watchEndpoint?.videoId ?? renderer.contents?.[0]?.musicResponsiveListItemRenderer?.playlistItemData?.videoId;
    if (!videoId) return parseSong(renderer.contents?.[0]?.musicResponsiveListItemRenderer);

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
      id: videoId,
      title,
      artist:
        artists.join(", ") ||
        subtitleRuns
          .map(run => run.text ?? "")
          .filter(text => text && text !== " • " && !/^(Song|노래|Video|동영상)$/i.test(text) && !/^\d+:\d{2}(?::\d{2})?$/.test(text))
          .join("")
          .replace(/^•\s*|\s*•$/g, "")
          .trim(),
      duration,
      artworkUrl: pickArtworkUrl(renderer.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails),
      playlistId: watchEndpoint?.playlistId ?? null
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

  return async function (query) {
    const ytcfg = window.ytcfg;
    const apiKey = ytcfg?.get?.("INNERTUBE_API_KEY");
    const context = ytcfg?.get?.("INNERTUBE_CONTEXT");
    if (!apiKey || !context) throw new Error("YouTube Music search context is unavailable");

    const response = await fetch(`https://music.youtube.com/youtubei/v1/search?prettyPrint=false&key=${apiKey}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-YouTube-Client-Name": String(ytcfg.get("INNERTUBE_CONTEXT_CLIENT_NAME") ?? "67"),
        "X-YouTube-Client-Version": String(ytcfg.get("INNERTUBE_CLIENT_VERSION") ?? context.client?.clientVersion ?? "")
      },
      body: JSON.stringify({
        context,
        query
      }),
      credentials: "include"
    });

    if (!response.ok) throw new Error(`YouTube Music search failed (${response.status})`);

    const payload = await response.json();
    const results = [];
    const seen = new Set();
    const sections =
      payload?.contents?.tabbedSearchResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents ??
      payload?.contents?.sectionListRenderer?.contents ??
      [];
    collectFromSections(sections, results, seen);
    if (!results.length) fallbackCollect(payload, results, seen);
    return results;
  };
})()
