import type { QueueTrackMeta } from "~shared/listentogether/protocol";
import protectedapimanager, {
  type ProtectedAPIMessageEvent,
} from "../protectedapimanager";
import { getYTMTextRun } from "../utils";
import ytmhook from "../ytmhook";

const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;
const PLAYLIST_ID_RE = /^[A-Za-z0-9_-]{2,128}$/;
const THUMBNAIL_URL_RE =
  /^https:\/\/(i\d*\.ytimg\.com|lh\d+\.googleusercontent\.com|yt\d+\.(ggpht|googleusercontent)\.com)\//;
const UNAVAILABLE_PLAYABILITY_STATUSES = new Set([
  "UNPLAYABLE",
  "LOGIN_REQUIRED",
  "ERROR",
  "CONTENT_CHECK_REQUIRED",
  "AGE_VERIFICATION_REQUIRED",
]);
const DISALLOWED_MUSIC_VIDEO_TYPES = new Set([
  "MUSIC_VIDEO_TYPE_PODCAST_EPISODE",
  "MUSIC_VIDEO_TYPE_PRIVATELY_OWNED_TRACK",
]);
const RESOLVE_TIMEOUT_MS = 8000;
export const AD_END_DEBOUNCE_MS = 750;

export type LoadExactVideoParams = {
  videoId: string;
  startPosSec?: number;
  pausedForBarrier?: boolean;
};

export type SyncPlaybackParams = {
  action: "play" | "pause" | "seek";
  posSec?: number;
};

export type ListeningMode = "room" | "local";

export type SetSessionLockParams = {
  locked: boolean;
  isHost?: boolean;
  canAddSongs?: boolean;
  currentRoomVideoId?: string | null;
  listeningMode?: ListeningMode;
};

export type QuickAddTarget =
  | { kind: "track"; videoId: string }
  | { kind: "playlist"; playlistId: string };

export type ListenTogetherResult<T = Record<string, unknown>> =
  | ({ ok: true } & T)
  | { ok: false; error: string };

let sessionLocked = false;
let currentListeningMode: ListeningMode = "room";

/**
 * Returns whether the YTM player/navigation session is currently locked for Listen Together.
 */
export function isListenTogetherLocked(): boolean {
  return sessionLocked;
}

/**
 * Determines whether a history traversal onto `destinationUrl` should be blocked while locked.
 */
export function shouldBlockHistoryTraversal(
  destinationUrl: string | null | undefined,
  locked: boolean = sessionLocked,
  listeningMode: ListeningMode = currentListeningMode,
): boolean {
  if (!locked || listeningMode === "local" || !destinationUrl) return false;
  try {
    const parsed = new URL(destinationUrl, "https://music.youtube.com");
    return parsed.pathname.startsWith("/watch");
  } catch {
    return false;
  }
}

/**
 * Parses YouTube Music duration strings (`M:SS` or `H:MM:SS`) into positive integer seconds.
 */
export function parseDurationTextToSec(text: string): number | null {
  if (typeof text !== "string") return null;
  const trimmed = text.trim();
  if (!trimmed) return null;

  const parts = trimmed.split(":");
  if (parts.length < 2 || parts.length > 3) return null;

  const nums: number[] = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!/^\d+$/.test(part)) return null;
    const val = Number(part);
    if (!Number.isSafeInteger(val) || val < 0) return null;
    if (i > 0 && val >= 60) return null;
    nums.push(val);
  }

  const totalSec =
    nums.length === 2
      ? nums[0] * 60 + nums[1]
      : nums[0] * 3600 + nums[1] * 60 + nums[2];

  if (!Number.isSafeInteger(totalSec) || totalSec <= 0) {
    return null;
  }

  return totalSec;
}

function readTextField(field: unknown): string {
  if (!field || typeof field !== "object") return "";
  const obj = field as {
    simpleText?: unknown;
    runs?: Array<{ text?: string }>;
  };
  if (typeof obj.simpleText === "string") {
    return obj.simpleText;
  }
  if (Array.isArray(obj.runs)) {
    return getYTMTextRun(
      obj.runs.filter(
        (run): run is { text: string } =>
          Boolean(run) && typeof run.text === "string",
      ),
    );
  }
  return "";
}

function readAuthorText(renderer: Record<string, unknown>): string {
  const shortText = readTextField(renderer.shortBylineText).trim();
  if (shortText) {
    return shortText.slice(0, 120);
  }

  const longByline = renderer.longBylineText as
    | { runs?: Array<{ text?: string }>; simpleText?: string }
    | undefined;
  if (longByline && Array.isArray(longByline.runs)) {
    const authorRuns: { text: string }[] = [];
    for (const run of longByline.runs) {
      if (!run || typeof run.text !== "string") continue;
      if (run.text.includes("•")) break;
      authorRuns.push({ text: run.text });
    }
    const joined = getYTMTextRun(authorRuns).trim();
    if (joined) {
      return joined.slice(0, 120);
    }
  }

  const shortFallback = readTextField(renderer.subtitle).trim();
  if (shortFallback) {
    return shortFallback.slice(0, 120);
  }

  if (typeof renderer.author === "string" && renderer.author.trim()) {
    return renderer.author.trim().slice(0, 120);
  }

  const videoDetails = renderer.videoDetails as
    | { author?: unknown }
    | undefined;
  if (typeof videoDetails?.author === "string" && videoDetails.author.trim()) {
    return videoDetails.author.trim().slice(0, 120);
  }

  return readTextField(renderer.longBylineText).trim().slice(0, 120);
}

function defaultThumbnailUrl(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

function sanitizeThumbnailUrl(url: unknown): string | null {
  if (typeof url !== "string") return null;
  let trimmed = url.trim();
  if (trimmed.startsWith("//")) {
    trimmed = `https:${trimmed}`;
  }
  if (trimmed.length === 0 || trimmed.length > 512) return null;
  if (!THUMBNAIL_URL_RE.test(trimmed)) return null;
  return trimmed;
}

function pickBestThumbnailUrl(thumbnailObj: unknown): string | null {
  if (!thumbnailObj || typeof thumbnailObj !== "object") return null;
  const thumbnails = (
    thumbnailObj as {
      thumbnails?: Array<{ url?: unknown; width?: unknown; height?: unknown }>;
    }
  ).thumbnails;
  if (!Array.isArray(thumbnails)) return null;

  let bestUrl: string | null = null;
  let bestScore = -1;
  for (const thumb of thumbnails) {
    const candidate = sanitizeThumbnailUrl(thumb?.url);
    if (!candidate) continue;
    const width = typeof thumb.width === "number" ? thumb.width : 0;
    const height = typeof thumb.height === "number" ? thumb.height : 0;
    const score = width * height;
    if (score >= bestScore) {
      bestScore = score;
      bestUrl = candidate;
    }
  }
  return bestUrl;
}

function unwrapPlaylistPanelVideoRenderer(
  item: unknown,
): Record<string, unknown> | null {
  if (!item || typeof item !== "object") return null;
  const obj = item as Record<string, unknown>;

  if (obj.content && typeof obj.content === "object") {
    return unwrapPlaylistPanelVideoRenderer(obj.content);
  }

  if (
    obj.playlistPanelVideoWrapperRenderer &&
    typeof obj.playlistPanelVideoWrapperRenderer === "object"
  ) {
    const wrapper = obj.playlistPanelVideoWrapperRenderer as {
      primaryRenderer?: unknown;
    };
    if (wrapper.primaryRenderer) {
      return unwrapPlaylistPanelVideoRenderer(wrapper.primaryRenderer);
    }
  }

  if (
    obj.playlistPanelVideoRenderer &&
    typeof obj.playlistPanelVideoRenderer === "object"
  ) {
    return obj.playlistPanelVideoRenderer as Record<string, unknown>;
  }

  if (typeof obj.videoId === "string") {
    return obj;
  }

  return null;
}

function hasLiveBadge(renderer: Record<string, unknown>): boolean {
  const badges = renderer.badges;
  if (!Array.isArray(badges)) return false;
  for (const badge of badges) {
    if (!badge || typeof badge !== "object") continue;
    const b = badge as Record<string, unknown>;
    if (b.liveBadgeRenderer) return true;
    const inlineBadge = b.musicInlineBadgeRenderer as
      | { icon?: { iconType?: string } }
      | undefined;
    if (inlineBadge?.icon?.iconType === "LIVE") return true;
  }
  return false;
}

function readMusicVideoType(renderer: Record<string, unknown>): string | null {
  const nav = renderer.navigationEndpoint as
    | {
        watchEndpoint?: {
          watchEndpointMusicSupportedConfigs?: {
            watchEndpointMusicConfig?: { musicVideoType?: unknown };
          };
        };
      }
    | undefined;
  const type =
    nav?.watchEndpoint?.watchEndpointMusicSupportedConfigs
      ?.watchEndpointMusicConfig?.musicVideoType;
  return typeof type === "string" ? type : null;
}

function extractRendererMeta(
  renderer: Record<string, unknown>,
  options: { requireMusicAudioOrVideo?: boolean } = {},
): QueueTrackMeta | null {
  if (
    renderer.isLive === true ||
    renderer.unplayableText ||
    hasLiveBadge(renderer)
  ) {
    return null;
  }

  const videoId =
    typeof renderer.videoId === "string" ? renderer.videoId.trim() : "";
  if (!VIDEO_ID_RE.test(videoId)) {
    return null;
  }

  if (options.requireMusicAudioOrVideo) {
    const musicVideoType = readMusicVideoType(renderer);
    if (musicVideoType && DISALLOWED_MUSIC_VIDEO_TYPES.has(musicVideoType)) {
      return null;
    }
  }

  const title = readTextField(renderer.title).trim().slice(0, 200);
  if (!title) {
    return null;
  }

  const lengthText = readTextField(renderer.lengthText);
  let durationSec = parseDurationTextToSec(lengthText);
  if (durationSec === null && renderer.lengthSeconds !== undefined) {
    const parsedSeconds = Number(renderer.lengthSeconds);
    if (Number.isInteger(parsedSeconds) && parsedSeconds >= 1) {
      durationSec = parsedSeconds;
    }
  }
  if (durationSec === null || durationSec < 1) {
    return null;
  }

  const author = readAuthorText(renderer);
  const thumbnailUrl =
    pickBestThumbnailUrl(renderer.thumbnail) ?? defaultThumbnailUrl(videoId);

  return {
    videoId,
    title,
    author,
    durationSec,
    thumbnailUrl,
  };
}

/**
 * Extracts a sanitized `QueueTrackMeta` candidate from a `/youtubei/v1/music/get_queue`
 * or `queueAddEndpoint` response payload, unwrapping wrappers and rejecting live/unplayable tracks.
 */
export function extractQueueCandidateFromResponse(
  data: unknown,
): QueueTrackMeta | null {
  if (!data || typeof data !== "object") return null;
  const obj = data as Record<string, unknown>;

  const playabilityStatus = (
    obj.playabilityStatus as { status?: unknown } | undefined
  )?.status;
  if (
    typeof playabilityStatus === "string" &&
    UNAVAILABLE_PLAYABILITY_STATUSES.has(playabilityStatus)
  ) {
    return null;
  }

  if (Array.isArray(obj.queueDatas)) {
    for (const queueItem of obj.queueDatas) {
      const renderer = unwrapPlaylistPanelVideoRenderer(queueItem);
      if (!renderer) continue;
      const meta = extractRendererMeta(renderer);
      if (meta) return meta;
    }
    return null;
  }

  const renderer = unwrapPlaylistPanelVideoRenderer(obj);
  if (!renderer) return null;
  return extractRendererMeta(renderer);
}

/**
 * Extracts sanitized autoplay `QueueTrackMeta` candidates from a `/youtubei/v1/next` response.
 */
export function extractAutoplayCandidatesFromNext(
  data: unknown,
  limit: number,
): QueueTrackMeta[] {
  if (!data || typeof data !== "object") return [];
  const maxItems = Number.isFinite(limit) ? Math.floor(limit) : 0;
  if (maxItems <= 0) return [];

  const obj = data as any;
  const rawContents: unknown[] | undefined =
    obj?.contents?.singleColumnMusicWatchNextResultsRenderer?.tabbedRenderer
      ?.watchNextTabbedResultsRenderer?.tabs?.[0]?.tabRenderer?.content
      ?.musicQueueRenderer?.content?.playlistPanelRenderer?.contents ??
    obj?.continuationContents?.playlistPanelContinuation?.contents ??
    obj?.playlistPanelRenderer?.contents ??
    (Array.isArray(obj?.contents) ? obj.contents : undefined);

  if (!Array.isArray(rawContents)) return [];

  const candidates: QueueTrackMeta[] = [];
  const seenIds = new Set<string>();

  for (const item of rawContents) {
    if (candidates.length >= maxItems) break;
    const renderer = unwrapPlaylistPanelVideoRenderer(item);
    if (!renderer) continue;
    const meta = extractRendererMeta(renderer, {
      requireMusicAudioOrVideo: true,
    });
    if (!meta || seenIds.has(meta.videoId)) continue;
    seenIds.add(meta.videoId);
    candidates.push(meta);
  }

  return candidates;
}

export interface AdObserverTimers {
  setTimeout(fn: () => void, ms: number): ReturnType<typeof setTimeout>;
  clearTimeout(id: ReturnType<typeof setTimeout>): void;
}

export interface SetupLogger {
  debug?(message: string, context?: Record<string, unknown>): void;
  info?(message: string, context?: Record<string, unknown>): void;
  warn?(message: string, context?: Record<string, unknown>): void;
  error?(message: string, context?: Record<string, unknown>): void;
}

const defaultConsoleLogger: Required<SetupLogger> = {
  debug: (message, context) => {
    if (context !== undefined) console.debug(message, context);
    else console.debug(message);
  },
  info: (message, context) => {
    if (context !== undefined) console.info(message, context);
    else console.info(message);
  },
  warn: (message, context) => {
    if (context !== undefined) console.warn(message, context);
    else console.warn(message);
  },
  error: (message, context) => {
    if (context !== undefined) console.error(message, context);
    else console.error(message);
  },
};

export interface AdObserverOptions {
  debounceMs?: number;
  timers?: AdObserverTimers;
  logger?: SetupLogger;
  onAdStarted: () => void;
  onAdBreakEnded: () => void;
}

export interface AdObserver {
  onAdStateUpdate(adPlaying: boolean): void;
  isInAdBreak(): boolean;
  reset(): void;
}

/**
 * Tracks Rule 0 `adPlaying` transitions with a 750 ms `true -> false` debounce so multi-ad pods
 * cancel the pending completion timer when a second ad begins.
 */
export function createAdObserver(options: AdObserverOptions): AdObserver {
  const debounceMs = options.debounceMs ?? AD_END_DEBOUNCE_MS;
  const timers = options.timers ?? {
    setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
    clearTimeout: (id) => globalThis.clearTimeout(id),
  };
  const logger = options.logger ?? defaultConsoleLogger;

  let latestAdPlaying = false;
  let inAdBreak = false;
  let endTimer: ReturnType<typeof setTimeout> | null = null;

  function clearEndTimer(): void {
    if (endTimer !== null) {
      timers.clearTimeout(endTimer);
      endTimer = null;
    }
  }

  return {
    onAdStateUpdate(adPlaying: boolean): void {
      const normalized = Boolean(adPlaying);
      latestAdPlaying = normalized;

      if (normalized) {
        if (endTimer !== null) {
          clearEndTimer();
          logger.debug?.(
            "[ListenTogether][YTMView] Cancelled ad-end debounce timer for subsequent ad",
            { debounceMs },
          );
        }
        if (!inAdBreak) {
          inAdBreak = true;
          logger.info?.("[ListenTogether][YTMView] Ad break started");
          options.onAdStarted();
        }
        return;
      }

      if (inAdBreak && endTimer === null) {
        logger.debug?.(
          "[ListenTogether][YTMView] Started ad-end debounce timer",
          { debounceMs },
        );
        endTimer = timers.setTimeout(() => {
          endTimer = null;
          if (latestAdPlaying) return;
          inAdBreak = false;
          logger.info?.(
            "[ListenTogether][YTMView] Ad break ended after debounce",
            { debounceMs },
          );
          options.onAdBreakEnded();
        }, debounceMs);
      }
    },

    isInAdBreak(): boolean {
      return inAdBreak;
    },

    reset(): void {
      clearEndTimer();
      latestAdPlaying = false;
      inAdBreak = false;
    },
  };
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return "UNKNOWN_ERROR";
}

function findQueueAddEndpoint(detail: any): {
  videoId?: unknown;
  playlistId?: unknown;
} | null {
  if (!detail || typeof detail !== "object") return null;
  const args = detail.args;
  if (!Array.isArray(args)) return null;
  for (const arg of args) {
    if (
      arg &&
      typeof arg === "object" &&
      "queueAddEndpoint" in arg &&
      arg.queueAddEndpoint &&
      typeof arg.queueAddEndpoint === "object"
    ) {
      const queueTarget = (
        arg.queueAddEndpoint as {
          queueTarget?: { videoId?: unknown; playlistId?: unknown };
        }
      ).queueTarget;
      return queueTarget ?? {};
    }
  }
  return null;
}

/**
 * Extracts a Listen Together track or playlist target from a YouTube Music navigation endpoint.
 */
export function extractQuickAddTargetFromEndpoint(
  endpoint: unknown,
  preferPlaylist = false,
): QuickAddTarget | null {
  if (!endpoint || typeof endpoint !== "object") return null;
  const ep = endpoint as {
    watchEndpoint?: { videoId?: unknown; playlistId?: unknown };
    watchPlaylistEndpoint?: { playlistId?: unknown };
  };

  const wpPlaylist = ep.watchPlaylistEndpoint?.playlistId;
  const watchPlaylist = ep.watchEndpoint?.playlistId;
  const playlistId =
    typeof wpPlaylist === "string" && PLAYLIST_ID_RE.test(wpPlaylist.trim())
      ? wpPlaylist.trim()
      : typeof watchPlaylist === "string" &&
          PLAYLIST_ID_RE.test(watchPlaylist.trim())
        ? watchPlaylist.trim()
        : null;

  if (preferPlaylist && playlistId) {
    return { kind: "playlist", playlistId };
  }

  if (
    typeof ep.watchEndpoint?.videoId === "string" &&
    VIDEO_ID_RE.test(ep.watchEndpoint.videoId)
  ) {
    return { kind: "track", videoId: ep.watchEndpoint.videoId };
  }

  if (playlistId) {
    return { kind: "playlist", playlistId };
  }

  return null;
}

/**
 * Extracts a track or playlist target from a YTM card, list row, or playlist header element.
 */
export function extractQuickAddTargetFromRenderer(
  el: unknown,
  locationHref?: string,
): QuickAddTarget | null {
  if (!el || typeof el !== "object") return null;
  const node = el as {
    tagName?: string;
    data?: Record<string, any>;
    __data?: { data?: Record<string, any> };
    querySelector?: (selector: string) => {
      playNavigationEndpoint?: unknown;
      data?: { playNavigationEndpoint?: unknown };
    } | null;
    querySelectorAll?: (selector: string) => Iterable<{
      getAttribute?: (name: string) => string | null;
      href?: string;
    }>;
  };
  const tagName = String(node.tagName ?? "").toUpperCase();

  if (
    tagName === "YTMUSIC-RESPONSIVE-HEADER-RENDERER" ||
    tagName === "YTMUSIC-DETAIL-HEADER-RENDERER" ||
    tagName === "YTMUSIC-EDITABLE-PLAYLIST-DETAIL-HEADER-RENDERER"
  ) {
    const rawLoc =
      locationHref ??
      (typeof window !== "undefined" ? window.location?.href : undefined);
    if (rawLoc) {
      try {
        const parsed = new URL(rawLoc, "https://music.youtube.com");
        if (parsed.pathname.startsWith("/playlist")) {
          const listId = parsed.searchParams.get("list")?.trim() ?? "";
          if (PLAYLIST_ID_RE.test(listId)) {
            return { kind: "playlist", playlistId: listId };
          }
        }
      } catch {
        // Ignore malformed URL
      }
    }
    const headerData = node.data ?? node.__data?.data;
    if (Array.isArray(headerData?.buttons)) {
      for (const btn of headerData.buttons) {
        const playEp =
          btn?.musicPlayButtonRenderer?.playNavigationEndpoint ??
          btn?.buttonRenderer?.navigationEndpoint;
        const target = extractQuickAddTargetFromEndpoint(playEp, true);
        if (target?.kind === "playlist") return target;
      }
    }
    const playBtn = node.querySelector?.("ytmusic-play-button-renderer");
    if (playBtn) {
      const playTarget = extractQuickAddTargetFromEndpoint(
        playBtn.playNavigationEndpoint ??
          playBtn.data?.playNavigationEndpoint,
        true,
      );
      if (playTarget?.kind === "playlist") return playTarget;
    }
  }

  const data = node.data ?? node.__data?.data;
  if (data && typeof data === "object") {
    const playlistItemVideoId = data.playlistItemData?.videoId;
    if (
      typeof playlistItemVideoId === "string" &&
      VIDEO_ID_RE.test(playlistItemVideoId)
    ) {
      return { kind: "track", videoId: playlistItemVideoId };
    }

    const navEndpoint = data.navigationEndpoint ?? data.title?.runs?.[0]?.navigationEndpoint;
    const isBrowseContainer = Boolean(navEndpoint?.browseEndpoint);
    const overlayEndpoint =
      data.overlay?.musicItemThumbnailOverlayRenderer?.content
        ?.musicPlayButtonRenderer?.playNavigationEndpoint ??
      data.thumbnailOverlay?.musicItemThumbnailOverlayRenderer?.content
        ?.musicPlayButtonRenderer?.playNavigationEndpoint;
    const overlayTarget = extractQuickAddTargetFromEndpoint(
      overlayEndpoint,
      isBrowseContainer,
    );
    const navTarget = extractQuickAddTargetFromEndpoint(
      navEndpoint,
      isBrowseContainer,
    );

    if (isBrowseContainer && overlayTarget?.kind === "playlist") {
      return overlayTarget;
    }
    if (navTarget?.kind === "track") {
      return navTarget;
    }
    if (overlayTarget) {
      return overlayTarget;
    }
    if (navTarget) {
      return navTarget;
    }

    if (Array.isArray(data.flexColumns)) {
      for (const col of data.flexColumns) {
        const runs =
          col?.musicResponsiveListItemFlexColumnRenderer?.text?.runs;
        if (!Array.isArray(runs)) continue;
        for (const run of runs) {
          const runTarget = extractQuickAddTargetFromEndpoint(
            run?.navigationEndpoint,
          );
          if (runTarget?.kind === "track") {
            return runTarget;
          }
        }
      }
    }

    const menuItems = data.menu?.menuRenderer?.items;
    if (Array.isArray(menuItems)) {
      for (const item of menuItems) {
        const menuNav =
          item?.menuNavigationItemRenderer?.navigationEndpoint ??
          item?.menuServiceItemRenderer?.serviceEndpoint;
        const menuTarget = extractQuickAddTargetFromEndpoint(menuNav);
        if (menuTarget) {
          return menuTarget;
        }
        const queuePlaylistId =
          item?.menuServiceItemRenderer?.serviceEndpoint?.queueAddEndpoint
            ?.queueTarget?.playlistId;
        if (
          typeof queuePlaylistId === "string" &&
          PLAYLIST_ID_RE.test(queuePlaylistId.trim())
        ) {
          return { kind: "playlist", playlistId: queuePlaylistId.trim() };
        }
        const queueVideoId =
          item?.menuServiceItemRenderer?.serviceEndpoint?.queueAddEndpoint
            ?.queueTarget?.videoId;
        if (
          typeof queueVideoId === "string" &&
          VIDEO_ID_RE.test(queueVideoId.trim())
        ) {
          return { kind: "track", videoId: queueVideoId.trim() };
        }
      }
    }
  }

  const playButton = node.querySelector?.("ytmusic-play-button-renderer");
  if (playButton) {
    const playTarget = extractQuickAddTargetFromEndpoint(
      playButton.playNavigationEndpoint ??
        playButton.data?.playNavigationEndpoint,
    );
    if (playTarget) {
      return playTarget;
    }
  }

  if (typeof node.querySelectorAll === "function") {
    const links = node.querySelectorAll("a[href]");
    let fallbackPlaylist: QuickAddTarget | null = null;
    for (const anchor of links) {
      const href = anchor.getAttribute?.("href") ?? anchor.href ?? "";
      if (!href) continue;
      try {
        const parsed = new URL(href, "https://music.youtube.com");
        if (parsed.pathname === "/watch") {
          const v = parsed.searchParams.get("v")?.trim() ?? "";
          if (VIDEO_ID_RE.test(v)) {
            return { kind: "track", videoId: v };
          }
        }
        if (parsed.pathname === "/playlist" && !fallbackPlaylist) {
          const listId = parsed.searchParams.get("list")?.trim() ?? "";
          if (PLAYLIST_ID_RE.test(listId)) {
            fallbackPlaylist = { kind: "playlist", playlistId: listId };
          }
        }
      } catch {
        // Ignore unparseable anchor href
      }
    }
    if (fallbackPlaylist) {
      return fallbackPlaylist;
    }
  }

  return null;
}

export interface SetupListenTogetherDeps {
  listenTogetherApi?: ReturnType<typeof protectedapimanager.createOrGetAPI>;
  ytmStore?: typeof ytmhook.ytmStateStore.store;
  ytmPlayerController?: typeof ytmhook.ytmPlayerController;
  windowObj?: {
    addEventListener: Window["addEventListener"];
    removeEventListener?: Window["removeEventListener"];
    ytcfg?: unknown;
    location?: { href?: string };
  };
  documentObj?: {
    querySelector: Document["querySelector"];
    querySelectorAll: Document["querySelectorAll"];
    createElement?: Document["createElement"];
    createElementNS?: Document["createElementNS"];
    head?: { appendChild?: (node: any) => any };
    body?: any;
  };
  fetchFn?: typeof fetch;
  mediaSession?: Pick<MediaSession, "setActionHandler"> | null;
  mediaElementProto?: {
    play: (...args: any[]) => any;
  } | null;
  timers?: AdObserverTimers;
  logger?: SetupLogger;
  forwardViewLogs?: boolean;
}

/**
 * Registers the `ListenTogether` ProtectedAPI and playback/navigation locks in `ytmview`.
 */
export default function setupListenTogether(
  deps: SetupListenTogetherDeps = {},
): { cleanup: () => void } {
  const listenTogetherApi =
    deps.listenTogetherApi ??
    protectedapimanager.createOrGetAPI("ListenTogether");
  const ytmStore = deps.ytmStore ?? ytmhook.ytmStateStore.store;
  const ytmPlayerController =
    deps.ytmPlayerController ?? ytmhook.ytmPlayerController;
  const playerApi = ytmPlayerController.playerApi;
  const win = deps.windowObj ?? (window as any);
  const doc = deps.documentObj ?? document;
  const fetchImpl = deps.fetchFn ?? fetch;
  const timers: AdObserverTimers = deps.timers ?? {
    setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
    clearTimeout: (id) => globalThis.clearTimeout(id),
  };
  const logger = deps.logger ?? defaultConsoleLogger;
  const shouldForwardViewLogs =
    deps.forwardViewLogs ?? !deps.listenTogetherApi;
  const cleanups: Array<() => void> = [];

  function emitViewLog(
    level: "debug" | "info" | "warn" | "error",
    message: string,
    context?: Record<string, unknown>,
  ): void {
    logger[level]?.(message, context);
    if (!shouldForwardViewLogs || level === "debug") return;
    try {
      listenTogetherApi.postMessage("ytmViewLog", {
        level,
        message: message.replace(/^\[ListenTogether\]\[YTMView\]\s*/, ""),
        context,
      });
    } catch {
      // Never break playback on log forwarding errors
    }
  }

  let lockState: {
    locked: boolean;
    isHost: boolean;
    canAddSongs: boolean;
    currentRoomVideoId: string | null;
    listeningMode: ListeningMode;
  } = {
    locked: false,
    isHost: false,
    canAddSongs: false,
    currentRoomVideoId: null,
    listeningMode: "room",
  };

  let authorizedDepth = 0;
  let internalNavBypass = false;
  let internalServiceRequestBypass = false;
  let awaitingSyncAnchor = false;
  let pendingStartPosSec: number | null = null;
  let barrierMutedByUs = false;
  let wasMutedBeforeBarrier = false;
  let roomTrackEndedAtMs = 0;
  const ROOM_AUTO_ADVANCE_WINDOW_MS = 4000;
  let pendingLoadTrack: LoadExactVideoParams | null = null;
  let awaitingRoomLoadForId: string | null = null;
  let reloadedVideoIdForTrack: string | null = null;
  let wrappersInstalled = false;

  const mediaSessionHandlers = new Map<
    string,
    MediaSessionActionHandler | null
  >();

  const LT_BTN_ATTR = "data-lt-add-btn";
  const LT_STYLE_ID = "lt-ytm-queue-btn-styles";
  let domObserver: MutationObserver | null = null;
  let domSyncTimer: ReturnType<typeof setTimeout> | null = null;

  const PLUS_PATH_D = "M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z";
  const CHECK_PATH_D = "M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z";

  function clearElementChildren(el: any): void {
    if (typeof el.replaceChildren === "function") {
      el.replaceChildren();
      return;
    }
    while (el.firstChild && typeof el.removeChild === "function") {
      el.removeChild(el.firstChild);
    }
  }

  function createIconNode(added: boolean): any {
    if (typeof doc.createElementNS === "function") {
      const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "0 0 24 24");
      svg.setAttribute("width", "16");
      svg.setAttribute("height", "16");
      svg.setAttribute("fill", "currentColor");
      svg.setAttribute("aria-hidden", "true");
      const iconPath = doc.createElementNS("http://www.w3.org/2000/svg", "path");
      iconPath.setAttribute("d", added ? CHECK_PATH_D : PLUS_PATH_D);
      svg.appendChild(iconPath);
      return svg;
    }
    if (typeof doc.createElement === "function") {
      const glyph = doc.createElement("span");
      glyph.textContent = added ? "✓" : "+";
      return glyph;
    }
    return null;
  }

  function renderQuickAddButtonContent(
    btn: HTMLButtonElement,
    added: boolean,
    labelText?: string,
  ): void {
    clearElementChildren(btn);
    const icon = createIconNode(added);
    if (icon) {
      btn.appendChild(icon);
    }
    if (labelText && typeof doc.createElement === "function") {
      const labelSpan = doc.createElement("span");
      labelSpan.textContent = added ? "Added" : labelText;
      btn.appendChild(labelSpan);
    }
  }

  function ensureQuickAddStyles(): void {
    if (typeof doc.createElement !== "function" || !doc.head?.appendChild) {
      return;
    }
    if (doc.querySelector(`#${LT_STYLE_ID}`)) {
      return;
    }
    const styleEl = doc.createElement("style");
    styleEl.id = LT_STYLE_ID;
    styleEl.textContent = `
      button[${LT_BTN_ATTR}] {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 5px;
        border: 1px solid rgba(255, 255, 255, 0.22);
        background: rgba(18, 18, 18, 0.86);
        color: #f1f1f1;
        cursor: pointer;
        padding: 0;
        transition: background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease, transform 0.12s ease;
        flex-shrink: 0;
        font-family: "Roboto", "YouTube Sans", sans-serif;
        font-size: 12px;
        font-weight: 500;
      }
      button[${LT_BTN_ATTR}]:hover {
        background: rgba(244, 67, 54, 0.92);
        border-color: #f44336;
        color: #ffffff;
        transform: scale(1.04);
      }
      button[${LT_BTN_ATTR}].is-added {
        background: rgba(76, 175, 80, 0.92);
        border-color: #4caf50;
        color: #ffffff;
      }
      button[${LT_BTN_ATTR}="player-bar"] {
        width: 36px;
        height: 36px;
        border: none;
        background: transparent;
        color: var(--yt-spec-text-primary, #ffffff);
        border-radius: 50%;
        margin: 0 2px;
      }
      button[${LT_BTN_ATTR}="player-bar"]:hover {
        background: rgba(255, 255, 255, 0.1);
        border-color: transparent;
        color: #ffffff;
        transform: none;
      }
      button[${LT_BTN_ATTR}="player-bar"].is-added {
        background: rgba(76, 175, 80, 0.16);
        border-color: transparent;
        color: #4caf50;
      }
      html[data-ytmd-lt-mode="room"] ytmusic-player-bar,
      html[data-ytmd-lt-mode="room"] ytmusic-player-bar #player-bar-background {
        background: linear-gradient(180deg, #102617 0%, #0b1910 100%) !important;
        box-shadow: inset 0 1px 0 rgba(76, 175, 80, 0.25) !important;
      }
      html[data-ytmd-lt-mode="room"] ytmusic-player-bar #play-pause-button,
      html[data-ytmd-lt-mode="room"] ytmusic-player-bar .previous-button,
      html[data-ytmd-lt-mode="room"] ytmusic-player-bar .next-button {
        color: #66bb6a !important;
      }
      html[data-ytmd-lt-mode="room"] ytmusic-player-bar .left-controls tp-yt-paper-icon-button,
      html[data-ytmd-lt-mode="room"] ytmusic-player-bar .right-controls-buttons tp-yt-paper-icon-button,
      html[data-ytmd-lt-mode="room"] ytmusic-player-bar .time-info {
        color: #a5d6a7 !important;
      }
      html[data-ytmd-lt-mode="room"] ytmusic-player-bar #progress-bar {
        --paper-slider-active-color: #4caf50 !important;
        --paper-slider-knob-color: #4caf50 !important;
      }
      html[data-ytmd-lt-mode="room"] ytmusic-player-bar #progress-bar #primaryProgress,
      html[data-ytmd-lt-mode="room"] ytmusic-player-bar #progress-bar #sliderKnobInner,
      html[data-ytmd-lt-mode="room"] ytmusic-player-bar #progress-bar .slider-knob-inner {
        background-color: #4caf50 !important;
        border-color: #4caf50 !important;
      }
      button[${LT_BTN_ATTR}="row"] {
        position: relative;
        z-index: 10;
        width: 30px;
        height: 30px;
        border-radius: 50%;
        margin: 0 4px;
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.12s ease, background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease, transform 0.12s ease;
      }
      ytmusic-responsive-list-item-renderer:hover button[${LT_BTN_ATTR}="row"],
      ytmusic-responsive-list-item-renderer:focus-within button[${LT_BTN_ATTR}="row"],
      ytmusic-responsive-list-item-renderer button[${LT_BTN_ATTR}="row"].is-added,
      ytmusic-player-queue-item:hover button[${LT_BTN_ATTR}="row"],
      ytmusic-player-queue-item:focus-within button[${LT_BTN_ATTR}="row"],
      ytmusic-player-queue-item button[${LT_BTN_ATTR}="row"].is-added {
        opacity: 1;
        pointer-events: auto;
      }
      button[${LT_BTN_ATTR}="card"] {
        position: absolute;
        top: 8px;
        left: 8px;
        z-index: 6;
        width: 30px;
        height: 30px;
        border-radius: 50%;
        backdrop-filter: blur(4px);
      }
      button[${LT_BTN_ATTR}="playlist-header"] {
        position: relative;
        z-index: 2;
        flex-shrink: 0;
        height: 34px;
        padding: 0 14px;
        margin: 0 8px;
        border-radius: 17px;
      }
      button[${LT_BTN_ATTR}="sidebar"] {
        position: absolute;
        right: 44px;
        top: 50%;
        transform: translateY(-50%);
        z-index: 5;
        width: 26px;
        height: 26px;
        border-radius: 50%;
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.12s ease, background-color 0.15s ease;
      }
      ytmusic-guide-entry-renderer:hover button[${LT_BTN_ATTR}="sidebar"],
      ytmusic-guide-entry-renderer:focus-within button[${LT_BTN_ATTR}="sidebar"],
      ytmusic-guide-entry-renderer button[${LT_BTN_ATTR}="sidebar"].is-added {
        opacity: 1;
        pointer-events: auto;
      }
      button[${LT_BTN_ATTR}="sidebar"]:hover {
        transform: translateY(-50%) scale(1.04);
      }
    `;
    doc.head.appendChild(styleEl);
  }

  function createQuickAddButton(
    variant: "player-bar" | "card" | "row" | "playlist-header" | "sidebar",
    title: string,
    onActivate: () => void,
    labelText?: string,
  ): HTMLButtonElement | null {
    if (typeof doc.createElement !== "function") return null;
    const btn = doc.createElement("button") as HTMLButtonElement;
    btn.type = "button";
    btn.setAttribute(LT_BTN_ATTR, variant);
    btn.setAttribute("title", title);
    btn.setAttribute("aria-label", title);
    renderQuickAddButtonContent(btn, false, labelText);

    let resetTimer: ReturnType<typeof setTimeout> | null = null;
    const isolatePointer = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
      if ("stopImmediatePropagation" in event) {
        (event as Event & { stopImmediatePropagation?: () => void }).stopImmediatePropagation?.();
      }
    };
    btn.addEventListener("pointerdown", isolatePointer);
    btn.addEventListener("mousedown", isolatePointer);
    btn.addEventListener("click", (event: Event) => {
      isolatePointer(event);
      onActivate();
      btn.classList?.add("is-added");
      renderQuickAddButtonContent(btn, true, labelText);
      if (resetTimer !== null) timers.clearTimeout(resetTimer);
      resetTimer = timers.setTimeout(() => {
        resetTimer = null;
        btn.classList?.remove("is-added");
        renderQuickAddButtonContent(btn, false, labelText);
      }, 1500);
    });
    return btn;
  }

  function removeInjectedQueueButtons(): void {
    if (domSyncTimer !== null) {
      timers.clearTimeout(domSyncTimer);
      domSyncTimer = null;
    }
    if (domObserver) {
      domObserver.disconnect();
      domObserver = null;
    }
    doc.querySelectorAll?.(`[${LT_BTN_ATTR}]`)?.forEach((el) => {
      (el as { remove?: () => void }).remove?.();
    });
    if (!lockState.locked) {
      const styleEl = doc.querySelector?.(`#${LT_STYLE_ID}`) as
        | { remove?: () => void }
        | null;
      styleEl?.remove?.();
      (doc as { documentElement?: { removeAttribute?: (k: string) => void } })
        .documentElement?.removeAttribute?.("data-ytmd-lt-mode");
    }
  }

  function syncPlayerBarQueueButton(): void {
    const playerBar =
      doc.querySelector?.("ytmusic-app-layout>ytmusic-player-bar") ??
      doc.querySelector?.("ytmusic-player-bar");
    if (!playerBar) return;
    if (playerBar.querySelector?.(`[${LT_BTN_ATTR}="player-bar"]`)) return;

    const mount =
      playerBar.querySelector?.(".middle-controls-buttons") ??
      playerBar.querySelector?.(".right-controls-buttons") ??
      playerBar;
    const btn = createQuickAddButton(
      "player-bar",
      "Add current song to Room Queue",
      () => {
        const videoId =
          playerApi.getPlayerResponse?.()?.videoDetails?.videoId ?? "";
        if (typeof videoId === "string" && VIDEO_ID_RE.test(videoId)) {
          listenTogetherApi.postMessage("quickAddTrack", { videoId });
        }
      },
    );
    if (!btn) return;
    const menuEl = mount.querySelector?.("ytmusic-menu-renderer, .menu-button");
    if (menuEl && typeof mount.insertBefore === "function") {
      mount.insertBefore(btn, menuEl);
    } else {
      mount.appendChild?.(btn);
    }
  }

  function syncRendererButtons(
    selector: string,
    variant: "card" | "row" | "playlist-header" | "sidebar",
    resolveMount: (host: Element) => Element | null,
    insertBeforeMenu: boolean,
    labelText?: string,
  ): void {
    const nodes = doc.querySelectorAll?.(selector);
    if (!nodes) return;
    const locationHref = win.location?.href;
    nodes.forEach((node) => {
      if (node.querySelector?.(`[${LT_BTN_ATTR}="${variant}"]`)) return;
      const target = extractQuickAddTargetFromRenderer(node, locationHref);
      if (!target) return;

      const mount = resolveMount(node);
      if (!mount) return;
      const btn = createQuickAddButton(
        variant,
        target.kind === "playlist"
          ? "Add playlist to Room Queue"
          : "Add song to Room Queue",
        () => {
          const latestTarget =
            extractQuickAddTargetFromRenderer(node, win.location?.href) ??
            target;
          if (latestTarget.kind === "playlist") {
            listenTogetherApi.postMessage("quickAddPlaylist", {
              playlistId: latestTarget.playlistId,
            });
          } else {
            listenTogetherApi.postMessage("quickAddTrack", {
              videoId: latestTarget.videoId,
            });
          }
        },
        labelText,
      );
      if (!btn) return;
      if (insertBeforeMenu) {
        const menuEl = mount.querySelector?.("ytmusic-menu-renderer");
        if (menuEl && typeof mount.insertBefore === "function") {
          mount.insertBefore(btn, menuEl);
          return;
        }
      }
      mount.appendChild?.(btn);
    });
  }

  function syncQueueButtons(): void {
    if (!lockState.locked) {
      removeInjectedQueueButtons();
      return;
    }
    if (typeof doc.createElement !== "function") {
      return;
    }
    const runSafely = (surface: string, fn: () => void) => {
      try {
        fn();
      } catch (err) {
        logger.warn?.(
          `[ListenTogether][YTMView] Failed injecting queue button for ${surface}`,
          { error: getErrorMessage(err) },
        );
      }
    };
    runSafely("styles", ensureQuickAddStyles);
    if (!lockState.canAddSongs) {
      removeInjectedQueueButtons();
      return;
    }
    runSafely("player-bar", syncPlayerBarQueueButton);
    runSafely("cards", () =>
      syncRendererButtons(
        "ytmusic-two-row-item-renderer, ytmusic-card-shelf-renderer",
        "card",
        (el) =>
          el.querySelector?.(
            ".image-wrapper, .thumbnail-container, ytmusic-thumbnail-renderer",
          ) ?? el,
        false,
      ),
    );
    runSafely("rows", () =>
      syncRendererButtons(
        "ytmusic-responsive-list-item-renderer, ytmusic-player-queue-item",
        "row",
        (el) => el,
        true,
      ),
    );
    runSafely("playlist-header", () =>
      syncRendererButtons(
        "ytmusic-responsive-header-renderer, ytmusic-detail-header-renderer, ytmusic-editable-playlist-detail-header-renderer",
        "playlist-header",
        (el) =>
          el.querySelector?.(
            ".actions-container, #top-level-buttons, .top-level-buttons",
          ) ?? el,
        true,
        "Add to Room",
      ),
    );
    runSafely("sidebar", () =>
      syncRendererButtons(
        "ytmusic-guide-entry-renderer",
        "sidebar",
        (el) => el.querySelector?.("tp-yt-paper-item, #entry") ?? el,
        false,
      ),
    );

    if (!domObserver && typeof MutationObserver !== "undefined" && doc.body) {
      domObserver = new MutationObserver(() => {
        if (!lockState.locked || !lockState.canAddSongs) return;
        if (domSyncTimer !== null) return;
        domSyncTimer = timers.setTimeout(() => {
          domSyncTimer = null;
          syncQueueButtons();
        }, 150);
      });
      domObserver.observe(doc.body, { childList: true, subtree: true });
    }
  }

  const onYtNavigateFinish = () => {
    if (lockState.locked && lockState.canAddSongs) {
      syncQueueButtons();
    }
  };
  win.addEventListener("yt-navigate-finish", onYtNavigateFinish);
  cleanups.push(() => {
    win.removeEventListener?.("yt-navigate-finish", onYtNavigateFinish);
    removeInjectedQueueButtons();
  });

  function isAdPlaying(): boolean {
    try {
      return Boolean(ytmStore.getState()?.player?.adPlaying);
    } catch {
      return false;
    }
  }

  function withAuthorizedAction<T>(fn: () => T): T {
    authorizedDepth += 1;
    try {
      return fn();
    } finally {
      authorizedDepth -= 1;
    }
  }

  function getInnertubeConfig(): {
    context: unknown;
    apiKey: string | null;
  } | null {
    const ytcfg = win.ytcfg;
    const context = ytcfg?.get?.("INNERTUBE_CONTEXT");
    if (!context) return null;
    const apiKey = ytcfg?.get?.("INNERTUBE_API_KEY");
    return {
      context,
      apiKey: typeof apiKey === "string" && apiKey ? apiKey : null,
    };
  }

  async function resolveVideoMetaInternal(
    videoId: string,
  ): Promise<ListenTogetherResult<{ meta: QueueTrackMeta }>> {
    try {
      if (!VIDEO_ID_RE.test(videoId)) {
        logger.warn?.(
          "[ListenTogether][YTMView] resolveVideoMeta failed: invalid videoId",
        );
        return { ok: false, error: "INVALID_VIDEO_ID" };
      }

      const cfg = getInnertubeConfig();
      if (cfg) {
        const controller = new AbortController();
        const timeout = timers.setTimeout(
          () => controller.abort(),
          RESOLVE_TIMEOUT_MS,
        );
        try {
          const url = `/youtubei/v1/music/get_queue?prettyPrint=false${
            cfg.apiKey ? `&key=${encodeURIComponent(cfg.apiKey)}` : ""
          }`;
          const res = await fetchImpl(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "same-origin",
            signal: controller.signal,
            body: JSON.stringify({
              context: cfg.context,
              videoIds: [videoId],
            }),
          });
          if (!res.ok) {
            logger.warn?.(
              "[ListenTogether][YTMView] resolveVideoMeta HTTP error",
              { videoId, status: res.status },
            );
            return { ok: false, error: `HTTP_${res.status}` };
          }
          const data = await res.json();
          const meta = extractQueueCandidateFromResponse(data);
          if (!meta) {
            logger.warn?.(
              "[ListenTogether][YTMView] resolveVideoMeta rejected unavailable/live track",
              { videoId },
            );
            return { ok: false, error: "UNAVAILABLE_OR_LIVE" };
          }
          return { ok: true, meta };
        } finally {
          timers.clearTimeout(timeout);
        }
      }

      const ytmusicAppElement = doc.querySelector("ytmusic-app");
      if (!ytmusicAppElement) {
        logger.warn?.(
          "[ListenTogether][YTMView] resolveVideoMeta failed: ytmusic-app not found",
          { videoId },
        );
        return { ok: false, error: "YTM_APP_NOT_FOUND" };
      }

      const returnValue: any[] = [];
      internalServiceRequestBypass = true;
      try {
        ytmusicAppElement.dispatchEvent(
          new CustomEvent("yt-action", {
            bubbles: true,
            cancelable: false,
            composed: true,
            detail: {
              actionName: "yt-service-request",
              args: [
                ytmusicAppElement,
                {
                  queueAddEndpoint: {
                    queueTarget: {
                      videoId,
                    },
                  },
                },
              ],
              optionalAction: false,
              returnValue,
            },
          }),
        );
      } finally {
        internalServiceRequestBypass = false;
      }

      const ajaxPromise = returnValue[0]?.ajaxPromise;
      if (!ajaxPromise || typeof ajaxPromise.then !== "function") {
        logger.warn?.(
          "[ListenTogether][YTMView] resolveVideoMeta failed: missing ajaxPromise",
          { videoId },
        );
        return { ok: false, error: "MISSING_AJAX_PROMISE" };
      }

      let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
      const response = await Promise.race([
        ajaxPromise,
        new Promise<never>((_, reject) => {
          fallbackTimer = timers.setTimeout(
            () => reject(new Error("RESOLVE_TIMEOUT")),
            RESOLVE_TIMEOUT_MS,
          );
        }),
      ]).finally(() => {
        if (fallbackTimer !== null) {
          timers.clearTimeout(fallbackTimer);
          fallbackTimer = null;
        }
      });

      const meta = extractQueueCandidateFromResponse(response?.data);
      if (!meta) {
        logger.warn?.(
          "[ListenTogether][YTMView] resolveVideoMeta rejected unavailable/live track",
          { videoId },
        );
        return { ok: false, error: "UNAVAILABLE_OR_LIVE" };
      }
      return { ok: true, meta };
    } catch (error) {
      const message = getErrorMessage(error);
      logger.warn?.("[ListenTogether][YTMView] resolveVideoMeta failed", {
        videoId,
        error: message,
      });
      return { ok: false, error: message };
    }
  }

  async function fetchAutoplayCandidatesInternal(
    videoId: string,
    limit: number = 5,
  ): Promise<ListenTogetherResult<{ candidates: QueueTrackMeta[] }>> {
    try {
      if (!VIDEO_ID_RE.test(videoId)) {
        logger.warn?.(
          "[ListenTogether][YTMView] fetchAutoplayCandidates failed: invalid videoId",
        );
        return { ok: false, error: "INVALID_VIDEO_ID" };
      }

      const currentResponse = playerApi.getPlayerResponse?.();
      if (currentResponse?.videoDetails?.videoId === videoId) {
        const musicVideoType = currentResponse.videoDetails.musicVideoType;
        if (
          typeof musicVideoType === "string" &&
          DISALLOWED_MUSIC_VIDEO_TYPES.has(musicVideoType)
        ) {
          logger.debug?.(
            "[ListenTogether][YTMView] Skipping autoplay candidates for disallowed musicVideoType",
            { videoId, musicVideoType },
          );
          return { ok: true, candidates: [] };
        }
      }

      const cfg = getInnertubeConfig();
      if (!cfg) {
        logger.warn?.(
          "[ListenTogether][YTMView] fetchAutoplayCandidates failed: missing INNERTUBE_CONTEXT",
          { videoId },
        );
        return { ok: false, error: "MISSING_INNERTUBE_CONFIG" };
      }

      const clampedLimit = Math.max(
        1,
        Math.min(5, Number.isFinite(limit) ? Math.floor(limit) : 5),
      );
      const controller = new AbortController();
      const timeout = timers.setTimeout(
        () => controller.abort(),
        RESOLVE_TIMEOUT_MS,
      );

      try {
        const url = `/youtubei/v1/next?prettyPrint=false${
          cfg.apiKey ? `&key=${encodeURIComponent(cfg.apiKey)}` : ""
        }`;
        const res = await fetchImpl(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          signal: controller.signal,
          body: JSON.stringify({
            context: cfg.context,
            playlistId: `RDAMVM${videoId}`,
            isAudioOnly: true,
          }),
        });
        if (!res.ok) {
          logger.warn?.(
            "[ListenTogether][YTMView] fetchAutoplayCandidates HTTP error",
            { videoId, status: res.status },
          );
          return { ok: false, error: `HTTP_${res.status}` };
        }
        const data = await res.json();
        const candidates = extractAutoplayCandidatesFromNext(
          data,
          clampedLimit,
        );
        return { ok: true, candidates };
      } finally {
        timers.clearTimeout(timeout);
      }
    } catch (error) {
      const message = getErrorMessage(error);
      logger.warn?.(
        "[ListenTogether][YTMView] fetchAutoplayCandidates failed",
        { videoId, error: message },
      );
      return { ok: false, error: message };
    }
  }

  function readPlaylistTitleFromNext(
    data: unknown,
    fallbackPlaylistId: string,
  ): string {
    const obj = data as any;
    const queueHeader =
      obj?.contents?.singleColumnMusicWatchNextResultsRenderer?.tabbedRenderer
        ?.watchNextTabbedResultsRenderer?.tabs?.[0]?.tabRenderer?.content
        ?.musicQueueRenderer?.header?.musicQueueHeaderRenderer;
    const subtitle = readTextField(queueHeader?.subtitle).trim();
    if (subtitle) return subtitle.slice(0, 120);
    const title = readTextField(queueHeader?.title).trim();
    if (title) return title.slice(0, 120);
    return `Playlist (${fallbackPlaylistId.slice(0, 12)})`;
  }

  function readPlaylistTitleFromBrowse(
    data: unknown,
    fallbackPlaylistId: string,
  ): string {
    const obj = data as any;
    const header =
      obj?.header?.musicDetailHeaderRenderer ??
      obj?.header?.musicEditablePlaylistDetailHeaderRenderer?.header
        ?.musicDetailHeaderRenderer ??
      obj?.contents?.twoColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer
        ?.content?.sectionListRenderer?.contents?.[0]
        ?.musicResponsiveHeaderRenderer;
    const title = readTextField(header?.title).trim();
    if (title) return title.slice(0, 120);
    return `Playlist (${fallbackPlaylistId.slice(0, 12)})`;
  }

  function extractListItemColumns(
    item: Record<string, any> | undefined,
    fallbackTitle: string,
  ): { title: string; author: string; durationSec: number } {
    const title =
      readTextField(
        item?.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text,
      ).trim() || fallbackTitle;
    const author = readTextField(
      item?.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text,
    )
      .split("•")[0]
      .trim();
    const durationText = readTextField(
      item?.fixedColumns?.[0]?.musicResponsiveListItemFixedColumnRenderer?.text,
    ).trim();
    return {
      title: title.slice(0, 200),
      author: author.slice(0, 120),
      durationSec: parseDurationTextToSec(durationText) ?? 0,
    };
  }

  function extractTracksFromVisibleDom(limit: number): QueueTrackMeta[] {
    const results: QueueTrackMeta[] = [];
    const seen = new Set<string>();
    const rows = doc.querySelectorAll?.("ytmusic-responsive-list-item-renderer");
    if (!rows) return results;
    rows.forEach((row) => {
      if (results.length >= limit) return;
      const target = extractQuickAddTargetFromRenderer(row, win.location?.href);
      if (!target || target.kind !== "track" || seen.has(target.videoId)) {
        return;
      }
      seen.add(target.videoId);
      const data = (row as { data?: Record<string, any> }).data;
      const { title, author, durationSec } = extractListItemColumns(
        data,
        target.videoId,
      );
      results.push({
        videoId: target.videoId,
        title,
        author,
        durationSec,
        thumbnailUrl: null,
      });
    });
    return results;
  }

  function extractTracksFromBrowse(
    data: unknown,
    limit: number,
  ): QueueTrackMeta[] {
    const results: QueueTrackMeta[] = [];
    const seen = new Set<string>();
    const stack: unknown[] = [data];
    while (stack.length > 0 && results.length < limit) {
      const node = stack.pop();
      if (!node || typeof node !== "object") continue;
      if (Array.isArray(node)) {
        for (let i = node.length - 1; i >= 0; i--) {
          stack.push(node[i]);
        }
        continue;
      }
      const rec = node as Record<string, any>;
      const item = rec.musicResponsiveListItemRenderer;
      if (item && typeof item === "object") {
        const videoId =
          item.playlistItemData?.videoId ??
          item.overlay?.musicItemThumbnailOverlayRenderer?.content
            ?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint
            ?.videoId ??
          item.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text
            ?.runs?.[0]?.navigationEndpoint?.watchEndpoint?.videoId;
        if (
          typeof videoId === "string" &&
          VIDEO_ID_RE.test(videoId) &&
          !seen.has(videoId)
        ) {
          seen.add(videoId);
          const { title, author, durationSec } = extractListItemColumns(
            item,
            videoId,
          );
          const thumbs =
            item.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails;
          const thumbUrl = Array.isArray(thumbs)
            ? thumbs[thumbs.length - 1]?.url
            : undefined;
          results.push({
            videoId,
            title,
            author,
            durationSec,
            thumbnailUrl: sanitizeThumbnailUrl(thumbUrl),
          });
          if (results.length >= limit) break;
        }
        continue;
      }
      for (const value of Object.values(rec)) {
        if (value && typeof value === "object") {
          stack.push(value);
        }
      }
    }
    return results;
  }

  async function buildInnertubeHeaders(): Promise<Record<string, string>> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    try {
      const rawCookie =
        typeof (doc as { cookie?: string }).cookie === "string"
          ? (doc as { cookie: string }).cookie
          : "";
      const match =
        /(?:^|;\s*)(?:__Secure-3PAPISID|SAPISID)=([^;]+)/.exec(rawCookie);
      const sapisid = match?.[1]?.trim();
      if (sapisid && globalThis.crypto?.subtle) {
        const ts = Math.floor(Date.now() / 1000);
        const origin = "https://music.youtube.com";
        const data = new TextEncoder().encode(`${ts} ${sapisid} ${origin}`);
        const hashBuf = await globalThis.crypto.subtle.digest("SHA-1", data);
        const hashHex = Array.from(new Uint8Array(hashBuf))
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");
        headers["Authorization"] = `SAPISIDHASH ${ts}_${hashHex}`;
        headers["X-Origin"] = origin;
        headers["X-Goog-AuthUser"] = "0";
      }
    } catch {
      // Ignore cookie/crypto errors and fall back to unauthenticated headers
    }
    return headers;
  }

  async function resolvePlaylistTracksInternal(
    playlistId: string,
    limit: number = 25,
  ): Promise<
    ListenTogetherResult<{ tracks: QueueTrackMeta[]; title: string }>
  > {
    try {
      const cleanId = typeof playlistId === "string" ? playlistId.trim() : "";
      if (!PLAYLIST_ID_RE.test(cleanId)) {
        logger.warn?.(
          "[ListenTogether][YTMView] resolvePlaylistTracks failed: invalid playlistId",
        );
        return { ok: false, error: "INVALID_PLAYLIST_ID" };
      }

      const cfg = getInnertubeConfig();
      if (!cfg) {
        logger.warn?.(
          "[ListenTogether][YTMView] resolvePlaylistTracks failed: missing INNERTUBE_CONTEXT",
          { playlistId: cleanId },
        );
        return { ok: false, error: "MISSING_INNERTUBE_CONFIG" };
      }

      const clampedLimit = Math.max(
        1,
        Math.min(25, Number.isFinite(limit) ? Math.floor(limit) : 25),
      );
      const controller = new AbortController();
      const timeout = timers.setTimeout(
        () => controller.abort(),
        RESOLVE_TIMEOUT_MS,
      );

      try {
        const authHeaders = await buildInnertubeHeaders();
        const isLikedMusic = cleanId === "LM" || cleanId === "VLLM";
        if (!isLikedMusic) {
          const url = `/youtubei/v1/next?prettyPrint=false${
            cfg.apiKey ? `&key=${encodeURIComponent(cfg.apiKey)}` : ""
          }`;
          const res = await fetchImpl(url, {
            method: "POST",
            headers: authHeaders,
            credentials: "same-origin",
            signal: controller.signal,
            body: JSON.stringify({
              context: cfg.context,
              playlistId: cleanId,
              isAudioOnly: true,
            }),
          });
          if (res.ok) {
            const data = await res.json();
            const tracks = extractAutoplayCandidatesFromNext(data, clampedLimit);
            if (tracks.length > 0) {
              const title = readPlaylistTitleFromNext(data, cleanId);
              return { ok: true, tracks, title };
            }
          } else {
            logger.warn?.(
              "[ListenTogether][YTMView] resolvePlaylistTracks /next HTTP error; trying browse fallback",
              { playlistId: cleanId, status: res.status },
            );
          }
        }

        const browseId = isLikedMusic
          ? "FEmusic_liked_videos"
          : cleanId.startsWith("VL")
            ? cleanId
            : `VL${cleanId}`;

        // Try YTM's authenticated internal yt-service-request first, which is required for private playlists like Liked Music
        try {
          const ytApp = doc.querySelector?.("ytmusic-app") as
            | (Element & { dispatchEvent?: (ev: Event) => boolean })
            | null;
          if (ytApp?.dispatchEvent && typeof CustomEvent !== "undefined") {
            const returnValue: Array<{ ajaxPromise?: Promise<{ data?: unknown }> }> = [];
            ytApp.dispatchEvent(
              new CustomEvent("yt-action", {
                bubbles: true,
                cancelable: false,
                composed: true,
                detail: {
                  actionName: "yt-service-request",
                  args: [ytApp, { browseEndpoint: { browseId } }],
                  optionalAction: false,
                  returnValue,
                },
              }),
            );
            const ajaxPromise = returnValue[0]?.ajaxPromise;
            if (ajaxPromise) {
              const resp = await ajaxPromise;
              const tracks = extractTracksFromBrowse(resp?.data ?? resp, clampedLimit);
              if (tracks.length > 0) {
                const title = isLikedMusic
                  ? "Liked Music"
                  : readPlaylistTitleFromBrowse(resp?.data ?? resp, cleanId);
                return { ok: true, tracks, title };
              }
            }
          }
        } catch (err) {
          logger.debug?.(
            "[ListenTogether][YTMView] yt-service-request browse fallback failed; trying fetch",
            { playlistId: cleanId, error: getErrorMessage(err) },
          );
        }

        const browseUrl = `/youtubei/v1/browse?prettyPrint=false${
          cfg.apiKey ? `&key=${encodeURIComponent(cfg.apiKey)}` : ""
        }`;
        const browseRes = await fetchImpl(browseUrl, {
          method: "POST",
          headers: authHeaders,
          credentials: "same-origin",
          signal: controller.signal,
          body: JSON.stringify({
            context: cfg.context,
            browseId,
          }),
        });
        if (!browseRes.ok) {
          logger.warn?.(
            "[ListenTogether][YTMView] resolvePlaylistTracks /browse HTTP error",
            { playlistId: cleanId, browseId, status: browseRes.status },
          );
          if (isLikedMusic) {
            const domTracks = extractTracksFromVisibleDom(clampedLimit);
            if (domTracks.length > 0) {
              return { ok: true, tracks: domTracks, title: "Liked Music" };
            }
          }
          return { ok: false, error: `HTTP_${browseRes.status}` };
        }
        const browseData = await browseRes.json();
        const tracks = extractTracksFromBrowse(browseData, clampedLimit);
        const title = isLikedMusic
          ? "Liked Music"
          : readPlaylistTitleFromBrowse(browseData, cleanId);
        return { ok: true, tracks, title };
      } finally {
        timers.clearTimeout(timeout);
      }
    } catch (error) {
      const message = getErrorMessage(error);
      logger.warn?.(
        "[ListenTogether][YTMView] resolvePlaylistTracks failed",
        { playlistId, error: message },
      );
      return { ok: false, error: message };
    }
  }

  function applyLoadExactVideo(params: LoadExactVideoParams): void {
    const startPosSec =
      typeof params.startPosSec === "number" &&
      Number.isFinite(params.startPosSec) &&
      params.startPosSec >= 0
        ? params.startPosSec
        : 0;
    const pausedForBarrier = Boolean(params.pausedForBarrier ?? true);

    emitViewLog("info", "[ListenTogether][YTMView] Applying loadExactVideo", {
      videoId: params.videoId,
      startPosSec,
      pausedForBarrier,
    });

    lockState.currentRoomVideoId = params.videoId;
    lockState.listeningMode = "room";
    currentListeningMode = "room";
    awaitingRoomLoadForId = params.videoId;
    reloadedVideoIdForTrack = null;
    roomTrackEndedAtMs = 0;
    awaitingSyncAnchor = pausedForBarrier;
    pendingStartPosSec = startPosSec > 0 ? startPosSec : null;

    withAuthorizedAction(() => {
      internalNavBypass = true;
      try {
        if (!barrierMutedByUs) {
          wasMutedBeforeBarrier = Boolean(playerApi.isMuted?.());
        }
        if (!wasMutedBeforeBarrier) {
          playerApi.mute?.();
          barrierMutedByUs = true;
        }
        const ytmusicAppEl = doc.querySelector("ytmusic-app");
        if (
          ytmusicAppEl &&
          typeof ytmusicAppEl.dispatchEvent === "function" &&
          typeof CustomEvent !== "undefined"
        ) {
          ytmusicAppEl.dispatchEvent(
            new CustomEvent("yt-navigate", {
              bubbles: true,
              composed: true,
              detail: {
                endpoint: {
                  watchEndpoint: { videoId: params.videoId },
                },
              },
            }),
          );
          if (pausedForBarrier) {
            playerApi.pauseVideo?.();
          }
        } else {
          playerApi.loadVideoById(params.videoId, startPosSec);
          if (pausedForBarrier) {
            playerApi.pauseVideo?.();
          }
        }
      } finally {
        internalNavBypass = false;
      }
    });
  }

  function clearBarrierMuteIfOwned(): void {
    if (barrierMutedByUs && !wasMutedBeforeBarrier) {
      playerApi.unMute?.();
      try {
        const videoEl = doc.querySelector("video");
        if (videoEl && videoEl.muted) {
          videoEl.muted = false;
        }
      } catch {
        // best-effort only
      }
      barrierMutedByUs = false;
    } else if (!awaitingSyncAnchor) {
      barrierMutedByUs = false;
    }
  }

  function handleLockedPlayerCall(
    action: "play" | "pause" | "seek" | "next" | "previous" | "loadVideo",
    posSec?: number,
  ): void {
    if (
      lockState.isHost &&
      (action === "play" ||
        action === "pause" ||
        action === "seek" ||
        action === "next")
    ) {
      logger.debug?.(
        "[ListenTogether][YTMView] Forwarding locked host transport call",
        { action, posSec },
      );
      listenTogetherApi.postMessage("hostTransportRequested", {
        action: action === "next" ? "skip" : action,
        posSec,
      });
      return;
    }

    logger.warn?.("[ListenTogether][YTMView] Blocked locked player call", {
      action,
      isHost: lockState.isHost,
    });
    listenTogetherApi.postMessage("blockedAction", { action });
  }

  function enterLocalListeningMode(info: {
    kind: "track" | "playlist";
    videoId?: string | null;
    playlistId?: string | null;
    title?: string | null;
  }): void {
    emitViewLog("info", "[ListenTogether][YTMView] Entered local listening mode", {
      kind: info.kind,
      videoId: info.videoId ?? null,
      playlistId: info.playlistId ?? null,
    });
    lockState.listeningMode = "local";
    currentListeningMode = "local";
    (
      doc as {
        documentElement?: { setAttribute?: (k: string, v: string) => void };
      }
    ).documentElement?.setAttribute?.("data-ytmd-lt-mode", "local");
    awaitingSyncAnchor = false;
    awaitingRoomLoadForId = null;
    pendingStartPosSec = null;
    pendingLoadTrack = null;
    clearBarrierMuteIfOwned();
    listenTogetherApi.postMessage("localPlaybackStarted", info);
  }

  function installWrappersOnce(): void {
    if (wrappersInstalled) return;
    wrappersInstalled = true;

    const wrapMethod = <T extends object>(
      target: T,
      methodName: keyof T,
      action: "play" | "pause" | "seek" | "next" | "previous" | "loadVideo",
    ) => {
      const original = target[methodName];
      if (typeof original !== "function") return;
      (target as any)[methodName] = function (...args: unknown[]) {
        if (
          !lockState.locked ||
          lockState.listeningMode === "local" ||
          authorizedDepth > 0 ||
          isAdPlaying()
        ) {
          return original.apply(this, args);
        }
        const posSec =
          action === "seek" && typeof args[0] === "number"
            ? args[0]
            : undefined;
        handleLockedPlayerCall(action, posSec);
        return undefined;
      };
      cleanups.push(() => {
        (target as any)[methodName] = original;
      });
    };

    wrapMethod(ytmPlayerController, "nextVideo", "next");
    wrapMethod(ytmPlayerController, "previousVideo", "previous");
    wrapMethod(playerApi, "playVideo", "play");
    wrapMethod(playerApi, "pauseVideo", "pause");
    wrapMethod(playerApi, "seekTo", "seek");
    wrapMethod(playerApi, "nextVideo", "next");
    wrapMethod(playerApi, "previousVideo", "previous");

    const wrapVideoLoadMethod = (methodName: string) => {
      const original = (playerApi as any)[methodName];
      if (typeof original !== "function") return;
      (playerApi as any)[methodName] = function (...args: unknown[]) {
        if (
          !lockState.locked ||
          lockState.listeningMode === "local" ||
          authorizedDepth > 0 ||
          internalNavBypass ||
          isAdPlaying()
        ) {
          return original.apply(this, args);
        }
        const firstArg = args[0] as
          | string
          | { videoId?: unknown; list?: unknown }
          | undefined;
        const requestedVideoId =
          typeof firstArg === "string"
            ? firstArg.trim()
            : typeof firstArg?.videoId === "string"
              ? firstArg.videoId.trim()
              : "";
        const requestedListId =
          typeof firstArg === "object" &&
          firstArg !== null &&
          typeof firstArg.list === "string"
            ? firstArg.list.trim()
            : null;
        if (
          VIDEO_ID_RE.test(requestedVideoId) &&
          requestedVideoId !== lockState.currentRoomVideoId
        ) {
          emitViewLog(
            "info",
            `[ListenTogether][YTMView] User loaded different track locally via ${methodName}`,
            { videoId: requestedVideoId, listId: requestedListId },
          );
          enterLocalListeningMode({
            kind: "track",
            videoId: requestedVideoId,
            ...(requestedListId ? { playlistId: requestedListId } : {}),
          });
          void resolveVideoMetaInternal(requestedVideoId).then((res) => {
            if (res.ok && lockState.listeningMode === "local") {
              listenTogetherApi.postMessage("localTrackMetaResolved", res.meta);
            }
          });
          return original.apply(this, args);
        }
        if (requestedListId && PLAYLIST_ID_RE.test(requestedListId)) {
          emitViewLog(
            "info",
            `[ListenTogether][YTMView] User loaded playlist locally via ${methodName}`,
            { playlistId: requestedListId },
          );
          enterLocalListeningMode({
            kind: "playlist",
            playlistId: requestedListId,
            videoId: VIDEO_ID_RE.test(requestedVideoId) ? requestedVideoId : null,
          });
          return original.apply(this, args);
        }
        handleLockedPlayerCall("loadVideo");
        return undefined;
      };
      cleanups.push(() => {
        (playerApi as any)[methodName] = original;
      });
    };

    wrapVideoLoadMethod("loadVideoById");
    wrapVideoLoadMethod("loadVideoByPlayerVars");

    const mediaSession =
      deps.mediaSession !== undefined
        ? deps.mediaSession
        : typeof navigator !== "undefined"
          ? navigator.mediaSession
          : null;
    if (mediaSession && typeof mediaSession.setActionHandler === "function") {
      const origSetActionHandler =
        mediaSession.setActionHandler.bind(mediaSession);
      const lockedActions = new Set<string>([
        "play",
        "pause",
        "nexttrack",
        "previoustrack",
        "seekto",
        "seekbackward",
        "seekforward",
      ]);

      const rawOriginalSetActionHandler = mediaSession.setActionHandler;
      mediaSession.setActionHandler = function (
        action: MediaSessionAction,
        handler: MediaSessionActionHandler | null,
      ) {
        mediaSessionHandlers.set(action, handler);
        if (!lockedActions.has(action) || !handler) {
          return origSetActionHandler(action, handler);
        }
        return origSetActionHandler(action, (details) => {
          if (
            lockState.locked &&
            lockState.listeningMode !== "local" &&
            authorizedDepth === 0
          ) {
            const mapped =
              action === "play"
                ? "play"
                : action === "pause"
                  ? "pause"
                  : action === "nexttrack"
                    ? "next"
                    : action === "previoustrack"
                      ? "previous"
                      : "seek";
            handleLockedPlayerCall(mapped, details?.seekTime);
            return;
          }
          const latest = mediaSessionHandlers.get(action);
          return latest?.(details);
        });
      };
      cleanups.push(() => {
        mediaSession.setActionHandler = rawOriginalSetActionHandler;
      });
    }

    const mediaElementProto =
      deps.mediaElementProto !== undefined
        ? deps.mediaElementProto
        : typeof HTMLMediaElement !== "undefined"
          ? HTMLMediaElement.prototype
          : null;
    if (mediaElementProto && typeof mediaElementProto.play === "function") {
      const origMediaPlay = mediaElementProto.play;
      mediaElementProto.play = function (...args: []) {
        const result = origMediaPlay.apply(this, args);
        if (result && typeof result.catch === "function") {
          return result.catch((err: unknown) => {
            if (
              lockState.locked &&
              err instanceof Error &&
              err.name === "NotAllowedError"
            ) {
              logger.warn?.(
                "[ListenTogether][YTMView] HTMLMediaElement.play() blocked with NotAllowedError while locked",
              );
              listenTogetherApi.postMessage("audioBlocked");
            }
            throw err;
          });
        }
        return result;
      };
      cleanups.push(() => {
        mediaElementProto.play = origMediaPlay;
      });
    }

    const onYtNavigate = (event: Event) => {
      if (!lockState.locked || internalNavBypass) return;
      const endpoint = (event as CustomEvent)?.detail?.endpoint;
      if (!endpoint || typeof endpoint !== "object") return;

      if (
        "watchPlaylistEndpoint" in endpoint &&
        endpoint.watchPlaylistEndpoint
      ) {
        const playlistId =
          typeof endpoint.watchPlaylistEndpoint.playlistId === "string"
            ? endpoint.watchPlaylistEndpoint.playlistId.trim()
            : null;
        const videoId =
          typeof endpoint.watchPlaylistEndpoint.videoId === "string" &&
          VIDEO_ID_RE.test(endpoint.watchPlaylistEndpoint.videoId)
            ? endpoint.watchPlaylistEndpoint.videoId
            : null;
        logger.info?.(
          "[ListenTogether][YTMView] User opened playlist locally during session",
          { playlistId, videoId },
        );
        enterLocalListeningMode({
          kind: "playlist",
          playlistId,
          videoId,
        });
        if (playlistId) {
          void resolvePlaylistTracksInternal(playlistId, 25).then((res) => {
            if (res.ok && lockState.listeningMode === "local") {
              listenTogetherApi.postMessage("localPlaylistResolved", {
                playlistId,
                title: res.title,
                trackCount: res.tracks.length,
              });
            }
          });
        }
        if (videoId) {
          void resolveVideoMetaInternal(videoId).then((res) => {
            if (res.ok && lockState.listeningMode === "local") {
              listenTogetherApi.postMessage("localTrackMetaResolved", res.meta);
            }
          });
        }
        return;
      }

      if ("watchEndpoint" in endpoint && endpoint.watchEndpoint) {
        const videoId = endpoint.watchEndpoint.videoId;
        const playlistId =
          typeof endpoint.watchEndpoint.playlistId === "string"
            ? endpoint.watchEndpoint.playlistId.trim()
            : null;
        if (typeof videoId === "string" && VIDEO_ID_RE.test(videoId)) {
          logger.info?.(
            "[ListenTogether][YTMView] User clicked track to play locally during session",
            { videoId, playlistId },
          );
          enterLocalListeningMode({
            kind: "track",
            videoId,
            playlistId,
          });
          void resolveVideoMetaInternal(videoId).then((res) => {
            if (res.ok && lockState.listeningMode === "local") {
              listenTogetherApi.postMessage("localTrackMetaResolved", res.meta);
            }
          });
        }
      }
    };
    win.addEventListener("yt-navigate", onYtNavigate, { capture: true });
    cleanups.push(() => {
      win.removeEventListener?.("yt-navigate", onYtNavigate, { capture: true });
    });

    const onYtAction = (event: Event) => {
      if (!lockState.locked || internalServiceRequestBypass) return;
      const detail = (event as CustomEvent)?.detail;
      const queueTarget = findQueueAddEndpoint(detail);
      if (!queueTarget) return;

      event.preventDefault();
      event.stopImmediatePropagation();

      if (queueTarget.playlistId && !queueTarget.videoId) {
        logger.warn?.(
          "[ListenTogether][YTMView] Blocked yt-action queueAddEndpoint for playlist while locked",
        );
        listenTogetherApi.postMessage("blockedAction", {
          action: "playlist",
        });
        return;
      }

      if (
        typeof queueTarget.videoId === "string" &&
        VIDEO_ID_RE.test(queueTarget.videoId)
      ) {
        const videoId = queueTarget.videoId;
        logger.info?.(
          "[ListenTogether][YTMView] Intercepted yt-action queueAddEndpoint while locked",
          { videoId },
        );
        void resolveVideoMetaInternal(videoId).then((res) => {
          if (res.ok) {
            listenTogetherApi.postMessage("trackSelectedCandidate", res.meta);
          } else {
            logger.warn?.(
              "[ListenTogether][YTMView] Failed to resolve candidate from yt-action",
              { videoId, error: res.error },
            );
            listenTogetherApi.postMessage("blockedAction", {
              action: "invalidTrack",
              videoId,
              error: res.error,
            });
          }
        });
      }
    };
    win.addEventListener("yt-action", onYtAction, { capture: true });
    cleanups.push(() => {
      win.removeEventListener?.("yt-action", onYtAction, { capture: true });
    });
  }

  const adObserver = createAdObserver({
    timers,
    logger,
    onAdStarted: () => {
      if (lockState.locked && lockState.listeningMode !== "local") {
        listenTogetherApi.postMessage("adStarted");
      }
    },
    onAdBreakEnded: () => {
      const localVideoId =
        playerApi.getPlayerResponse?.()?.videoDetails?.videoId ?? null;
      if (!lockState.locked || lockState.listeningMode === "local") return;

      if (pendingLoadTrack) {
        const nextLoad = pendingLoadTrack;
        pendingLoadTrack = null;
        logger.info?.(
          "[ListenTogether][YTMView] Applying deferred loadExactVideo after ad break",
          { videoId: nextLoad.videoId, localVideoId },
        );
        applyLoadExactVideo(nextLoad);
        listenTogetherApi.postMessage("adPostRollEnded", {
          appliedPendingLoad: true,
          videoId: nextLoad.videoId,
          localVideoId,
        });
        return;
      }

      logger.info?.(
        "[ListenTogether][YTMView] Emitting adEnded after ad break",
        {
          localVideoId,
        },
      );
      listenTogetherApi.postMessage("adEnded", { localVideoId });
    },
  });

  const storeUnsub = ytmStore.subscribe(() => {
    try {
      adObserver.onAdStateUpdate(isAdPlaying());
    } catch {
      // Never propagate errors back to YTM store
    }
  });
  if (typeof storeUnsub === "function") {
    cleanups.push(storeUnsub);
  }

  playerApi.addEventListener("onStateChange", (state: number) => {
    try {
      if (
        state === 0 &&
        lockState.locked &&
        lockState.listeningMode === "room" &&
        !isAdPlaying()
      ) {
        roomTrackEndedAtMs = Date.now();
        emitViewLog("debug", "[ListenTogether][YTMView] Room track ended locally", {
          videoId: lockState.currentRoomVideoId,
        });
      }
      if (
        lockState.locked &&
        lockState.listeningMode !== "local" &&
        awaitingSyncAnchor &&
        !isAdPlaying() &&
        state === 1
      ) {
        withAuthorizedAction(() => {
          playerApi.pauseVideo?.();
        });
      }
    } catch {
      // Never propagate errors back to YTM player
    }
  });

  function extractLocalMetaFromPlayerResponse(
    response: any,
  ): QueueTrackMeta | null {
    const details = response?.videoDetails;
    const videoId =
      typeof details?.videoId === "string" ? details.videoId.trim() : "";
    if (!VIDEO_ID_RE.test(videoId)) return null;
    const title =
      typeof details?.title === "string" && details.title.trim()
        ? details.title.trim().slice(0, 200)
        : `Track (${videoId})`;
    const author =
      typeof details?.author === "string"
        ? details.author.trim().slice(0, 120)
        : "";
    const parsedDur = Number(details?.lengthSeconds);
    const durationSec =
      Number.isFinite(parsedDur) && parsedDur >= 1
        ? Math.round(parsedDur)
        : 180;
    const thumbnailUrl =
      pickBestThumbnailUrl(details?.thumbnail) ?? defaultThumbnailUrl(videoId);
    return {
      videoId,
      title,
      author,
      durationSec,
      thumbnailUrl,
    };
  }

  playerApi.addEventListener(
    "onVideoDataChange",
    (event: { playertype?: number; type?: string }) => {
      try {
        if (
          !lockState.locked ||
          event?.playertype !== 1 ||
          (event?.type !== "dataloaded" && event?.type !== "dataupdated")
        ) {
          return;
        }
        if (isAdPlaying()) return;

        const response = playerApi.getPlayerResponse?.();
        const actualVideoId = response?.videoDetails?.videoId ?? null;
        const status = response?.playabilityStatus?.status ?? null;

        if (lockState.listeningMode === "local") {
          const localMeta = extractLocalMetaFromPlayerResponse(response);
          if (localMeta) {
            listenTogetherApi.postMessage("localTrackUpdated", localMeta);
          }
          return;
        }

        const expectedVideoId = lockState.currentRoomVideoId;
        if (!expectedVideoId) return;

        if (actualVideoId === expectedVideoId && status === "OK") {
          awaitingRoomLoadForId = null;
          if (pendingStartPosSec !== null && pendingStartPosSec > 0) {
            const seekPos = pendingStartPosSec;
            pendingStartPosSec = null;
            withAuthorizedAction(() => {
              playerApi.seekTo?.(seekPos);
              if (awaitingSyncAnchor) {
                playerApi.pauseVideo?.();
              }
            });
          } else {
            pendingStartPosSec = null;
          }
          if (!awaitingSyncAnchor) {
            withAuthorizedAction(() => {
              clearBarrierMuteIfOwned();
            });
          }
          emitViewLog(
            "info",
            "[ListenTogether][YTMView] Track ready for room video",
            { videoId: expectedVideoId },
          );
          listenTogetherApi.postMessage("trackReady", {
            videoId: expectedVideoId,
          });
          return;
        }

        if (actualVideoId && actualVideoId !== expectedVideoId) {
          if (
            awaitingSyncAnchor ||
            awaitingRoomLoadForId === expectedVideoId
          ) {
            if (reloadedVideoIdForTrack !== expectedVideoId) {
              emitViewLog(
                "warn",
                "[ListenTogether][YTMView] Mismatched video loaded while room track barrier pending; reloading expected room track",
                { expectedVideoId, actualVideoId, awaitingSyncAnchor },
              );
              reloadedVideoIdForTrack = expectedVideoId;
              withAuthorizedAction(() => {
                playerApi.loadVideoById(expectedVideoId, 0);
                if (awaitingSyncAnchor) {
                  playerApi.pauseVideo?.();
                }
              });
            }
            return;
          }

          const playerState = Number(playerApi.getPlayerState?.() ?? -1);
          const justEndedRoomTrack =
            roomTrackEndedAtMs > 0 &&
            Date.now() - roomTrackEndedAtMs < ROOM_AUTO_ADVANCE_WINDOW_MS;
          if (justEndedRoomTrack || playerState === 0) {
            emitViewLog(
              "info",
              "[ListenTogether][YTMView] Suppressed YTM auto-advance at end of room track; waiting for room next track",
              {
                expectedVideoId,
                actualVideoId,
                playerState,
                msSinceEnded:
                  roomTrackEndedAtMs > 0
                    ? Date.now() - roomTrackEndedAtMs
                    : null,
              },
            );
            withAuthorizedAction(() => {
              playerApi.pauseVideo?.();
            });
            return;
          }

          emitViewLog(
            "info",
            "[ListenTogether][YTMView] Detected user local track switch via onVideoDataChange",
            { expectedVideoId, actualVideoId },
          );
          enterLocalListeningMode({
            kind: "track",
            videoId: actualVideoId,
          });
          const localMeta = extractLocalMetaFromPlayerResponse(response);
          if (localMeta) {
            listenTogetherApi.postMessage("localTrackUpdated", localMeta);
          }
        }
      } catch {
        // Never propagate errors back to YTM player
      }
    },
  );

  installWrappersOnce();

  listenTogetherApi.handleMessage("loadExactVideo", async (event: Event) => {
    try {
      const params = ((event as CustomEvent<ProtectedAPIMessageEvent>).detail
        ?.args?.[0] ?? {}) as Partial<LoadExactVideoParams>;
      if (!params.videoId || !VIDEO_ID_RE.test(params.videoId)) {
        logger.warn?.(
          "[ListenTogether][YTMView] Rejected loadExactVideo with invalid videoId",
        );
        return [{ ok: false, error: "INVALID_VIDEO_ID" }];
      }

      const loadParams: LoadExactVideoParams = {
        videoId: params.videoId,
        startPosSec: params.startPosSec ?? 0,
        pausedForBarrier: params.pausedForBarrier ?? true,
      };

      if (isAdPlaying()) {
        pendingLoadTrack = loadParams;
        lockState.currentRoomVideoId = loadParams.videoId;
        logger.info?.(
          "[ListenTogether][YTMView] Deferred loadExactVideo during active ad",
          {
            videoId: loadParams.videoId,
            startPosSec: loadParams.startPosSec,
          },
        );
        return [{ ok: true, deferredForAd: true }];
      }

      pendingLoadTrack = null;
      applyLoadExactVideo(loadParams);
      return [{ ok: true, deferredForAd: false }];
    } catch (error) {
      const message = getErrorMessage(error);
      logger.warn?.("[ListenTogether][YTMView] loadExactVideo failed", {
        error: message,
      });
      return [{ ok: false, error: message }];
    }
  });

  listenTogetherApi.handleMessage("syncPlayback", async (event: Event) => {
    try {
      const params = ((event as CustomEvent<ProtectedAPIMessageEvent>).detail
        ?.args?.[0] ?? {}) as Partial<SyncPlaybackParams>;

      if (
        params.action !== "play" &&
        params.action !== "pause" &&
        params.action !== "seek"
      ) {
        logger.warn?.(
          "[ListenTogether][YTMView] Rejected syncPlayback with invalid action",
          { action: String(params.action ?? "") },
        );
        return [{ ok: false, error: "INVALID_SYNC_ACTION" }];
      }

      if (isAdPlaying()) {
        logger.debug?.(
          "[ListenTogether][YTMView] Deferred syncPlayback during active ad",
          { action: params.action },
        );
        return [{ ok: true, deferredForAd: true }];
      }

      logger.debug?.("[ListenTogether][YTMView] Applied syncPlayback", {
        action: params.action,
        posSec: params.posSec ?? null,
      });
      awaitingSyncAnchor = false;
      withAuthorizedAction(() => {
        clearBarrierMuteIfOwned();

        if (
          typeof params.posSec === "number" &&
          Number.isFinite(params.posSec) &&
          params.posSec >= 0
        ) {
          const currentPos = Number(playerApi.getCurrentTime?.() ?? 0);
          if (
            params.action === "seek" ||
            Math.abs(currentPos - params.posSec) > 0.35
          ) {
            playerApi.seekTo?.(params.posSec);
          }
        }

        if (params.action === "play") {
          playerApi.playVideo?.();
          clearBarrierMuteIfOwned();
        } else if (params.action === "pause") {
          playerApi.pauseVideo?.();
        }
      });

      return [{ ok: true }];
    } catch (error) {
      const message = getErrorMessage(error);
      logger.warn?.("[ListenTogether][YTMView] syncPlayback failed", {
        error: message,
      });
      return [{ ok: false, error: message }];
    }
  });

  listenTogetherApi.handleMessage("setSessionLock", async (event: Event) => {
    try {
      const params = ((event as CustomEvent<ProtectedAPIMessageEvent>).detail
        ?.args?.[0] ?? {}) as Partial<SetSessionLockParams>;
      const locked = Boolean(params.locked);
      const nextListeningMode: ListeningMode = locked
        ? (params.listeningMode ?? lockState.listeningMode ?? "room")
        : "room";

      lockState = {
        locked,
        isHost: locked && Boolean(params.isHost),
        canAddSongs: locked && Boolean(params.canAddSongs ?? params.isHost),
        currentRoomVideoId: locked
          ? (params.currentRoomVideoId ?? lockState.currentRoomVideoId)
          : null,
        listeningMode: nextListeningMode,
      };
      sessionLocked = locked;
      currentListeningMode = nextListeningMode;

      emitViewLog("debug", "[ListenTogether][YTMView] Session lock updated", {
        locked,
        isHost: lockState.isHost,
        canAddSongs: lockState.canAddSongs,
        listeningMode: lockState.listeningMode,
        currentRoomVideoId: lockState.currentRoomVideoId,
      });

      const docEl = (
        doc as {
          documentElement?: {
            setAttribute?: (k: string, v: string) => void;
            removeAttribute?: (k: string) => void;
          };
        }
      ).documentElement;
      if (docEl) {
        if (locked) {
          docEl.setAttribute?.("data-ytmd-lt-mode", nextListeningMode);
        } else {
          docEl.removeAttribute?.("data-ytmd-lt-mode");
        }
      }
      syncQueueButtons();

      if (!locked || nextListeningMode === "local") {
        pendingLoadTrack = null;
        awaitingSyncAnchor = false;
        awaitingRoomLoadForId = null;
        pendingStartPosSec = null;
        reloadedVideoIdForTrack = null;
        roomTrackEndedAtMs = 0;
        clearBarrierMuteIfOwned();
        if (!locked) {
          adObserver.reset();
        }
      }

      return [{ ok: true, locked, listeningMode: nextListeningMode }];
    } catch (error) {
      const message = getErrorMessage(error);
      logger.warn?.("[ListenTogether][YTMView] setSessionLock failed", {
        error: message,
      });
      return [{ ok: false, error: message }];
    }
  });

  listenTogetherApi.handleMessage("resumeBlockedAudio", async () => {
    try {
      awaitingSyncAnchor = false;
      let playPromise: Promise<unknown> | undefined;

      withAuthorizedAction(() => {
        clearBarrierMuteIfOwned();
        playerApi.playVideo?.();
        const videoEl = doc.querySelector("video");
        if (videoEl && videoEl.paused) {
          playPromise = videoEl.play();
        }
      });

      if (playPromise) {
        await playPromise;
      }

      logger.info?.("[ListenTogether][YTMView] Resumed blocked audio");
      return [{ ok: true }];
    } catch (error) {
      const message = getErrorMessage(error);
      logger.warn?.("[ListenTogether][YTMView] resumeBlockedAudio failed", {
        error: message,
      });
      return [{ ok: false, error: message }];
    }
  });

  listenTogetherApi.handleMessage("resolveVideoMeta", async (event: Event) => {
    try {
      const arg = (event as CustomEvent<ProtectedAPIMessageEvent>).detail
        ?.args?.[0];
      const videoId =
        typeof arg === "string"
          ? arg
          : typeof (arg as { videoId?: unknown } | undefined)?.videoId ===
              "string"
            ? (arg as { videoId: string }).videoId
            : "";
      return [await resolveVideoMetaInternal(videoId)];
    } catch (error) {
      const message = getErrorMessage(error);
      logger.warn?.(
        "[ListenTogether][YTMView] resolveVideoMeta handler threw",
        {
          error: message,
        },
      );
      return [{ ok: false, error: message }];
    }
  });

  listenTogetherApi.handleMessage(
    "fetchAutoplayCandidates",
    async (event: Event) => {
      try {
        const arg = ((event as CustomEvent<ProtectedAPIMessageEvent>).detail
          ?.args?.[0] ?? {}) as { videoId?: unknown; limit?: unknown };
        const videoId = typeof arg.videoId === "string" ? arg.videoId : "";
        const limit = typeof arg.limit === "number" ? arg.limit : 5;
        return [await fetchAutoplayCandidatesInternal(videoId, limit)];
      } catch (error) {
        const message = getErrorMessage(error);
        logger.warn?.(
          "[ListenTogether][YTMView] fetchAutoplayCandidates handler threw",
          { error: message },
        );
        return [{ ok: false, error: message }];
      }
    },
  );

  listenTogetherApi.handleMessage(
    "openAddToPlaylist",
    async (event: Event) => {
      try {
        const params = ((event as CustomEvent<ProtectedAPIMessageEvent>).detail
          ?.args?.[0] ?? {}) as { videoId?: string };
        const videoId =
          typeof params.videoId === "string" ? params.videoId.trim() : "";
        if (!VIDEO_ID_RE.test(videoId)) {
          return [{ ok: false, error: "INVALID_VIDEO_ID" }];
        }
        emitViewLog("info", "[ListenTogether][YTMView] openAddToPlaylist invoked", {
          videoId,
        });
        const ytApp = doc.querySelector?.("ytmusic-app") as
          | (Element & { dispatchEvent?: (ev: Event) => boolean })
          | null;
        if (!ytApp?.dispatchEvent || typeof CustomEvent === "undefined") {
          emitViewLog("warn", "[ListenTogether][YTMView] openAddToPlaylist missing ytmusic-app", {
            videoId,
            hasYtApp: Boolean(ytApp),
          });
          return [{ ok: false, error: "YTM_APP_UNAVAILABLE" }];
        }
        const returnValue: Array<{
          ajaxPromise?: Promise<{
            data?: { contents?: Array<{ addToPlaylistRenderer?: unknown }> };
          }>;
        }> = [];
        ytApp.dispatchEvent(
          new CustomEvent("yt-action", {
            bubbles: true,
            cancelable: false,
            composed: true,
            detail: {
              actionName: "yt-service-request",
              args: [ytApp, { addToPlaylistEndpoint: { videoId } }],
              optionalAction: false,
              returnValue,
            },
          }),
        );
        const ajaxPromise = returnValue[0]?.ajaxPromise;
        if (!ajaxPromise) {
          emitViewLog("warn", "[ListenTogether][YTMView] openAddToPlaylist no ajaxPromise", {
            videoId,
            returnValueLen: returnValue.length,
          });
          return [{ ok: false, error: "YTM_SERVICE_REQUEST_FAILED" }];
        }
        const response = await ajaxPromise;
        const renderer =
          response?.data?.contents?.[0]?.addToPlaylistRenderer;
        if (!renderer) {
          emitViewLog("warn", "[ListenTogether][YTMView] openAddToPlaylist missing renderer", {
            videoId,
            hasData: Boolean(response?.data),
          });
          return [{ ok: false, error: "ADD_TO_PLAYLIST_RENDERER_MISSING" }];
        }
        ytApp.dispatchEvent(
          new CustomEvent("yt-action", {
            bubbles: true,
            cancelable: false,
            composed: true,
            detail: {
              actionName: "yt-open-popup-action",
              args: [
                {
                  openPopupAction: {
                    popup: { addToPlaylistRenderer: renderer },
                    popupType: "DIALOG",
                  },
                },
                ytApp,
              ],
              optionalAction: false,
              returnValue: [],
            },
          }),
        );
        emitViewLog("info", "[ListenTogether][YTMView] openAddToPlaylist dialog dispatched", {
          videoId,
        });
        return [{ ok: true }];
      } catch (err) {
        return [{ ok: false, error: getErrorMessage(err) }];
      }
    },
  );

  listenTogetherApi.handleMessage(
    "resolvePlaylistTracks",
    async (event: Event) => {
      try {
        const arg = ((event as CustomEvent<ProtectedAPIMessageEvent>).detail
          ?.args?.[0] ?? {}) as { playlistId?: unknown; limit?: unknown };
        const playlistId =
          typeof arg.playlistId === "string" ? arg.playlistId : "";
        const limit = typeof arg.limit === "number" ? arg.limit : 25;
        return [await resolvePlaylistTracksInternal(playlistId, limit)];
      } catch (error) {
        const message = getErrorMessage(error);
        logger.warn?.(
          "[ListenTogether][YTMView] resolvePlaylistTracks handler threw",
          { error: message },
        );
        return [{ ok: false, error: message }];
      }
    },
  );

  return {
    cleanup: () => {
      sessionLocked = false;
      currentListeningMode = "room";
      lockState = {
        locked: false,
        isHost: false,
        canAddSongs: false,
        currentRoomVideoId: null,
        listeningMode: "room",
      };
      pendingLoadTrack = null;
      awaitingSyncAnchor = false;
      pendingStartPosSec = null;
      reloadedVideoIdForTrack = null;
      adObserver.reset();
      for (const fn of cleanups.splice(0).reverse()) {
        try {
          fn();
        } catch {
          // Ignore teardown errors in tests
        }
      }
    },
  };
}
