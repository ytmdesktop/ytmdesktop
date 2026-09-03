type LyricsLine = {
  startMs: number;
  endMs?: number;
  text: string;
};

type LyricsResult = {
  type: "synced" | "plain" | "none";
  lines?: LyricsLine[];
  plainText?: string;
  source?: "lrclib" | "musixmatch";
};

type LyricsDebugInfo = {
  source?: "lrclib" | "musixmatch";
  origin?: "cache" | "network";
};

type LyricsViewState =
  | {
      status: "idle" | "loading" | "none" | "error" | "ad";
      message?: string;
      trackFingerprint?: string;
      debug?: LyricsDebugInfo;
    }
  | {
      status: "synced" | "plain";
      result: LyricsResult;
      trackFingerprint: string;
      debug?: LyricsDebugInfo;
    };

type LyricsSyncState = {
  trackFingerprint?: string;
  progressMs: number;
  playing: boolean;
  adPlaying: boolean;
};

type WordSlot = {
  startMs: number;
  endMs: number;
  element: HTMLSpanElement;
};

function isRenderableLyricsText(text: string) {
  return text.replace(/[\s\u200B-\u200D\uFEFF]/g, "").length > 0;
}

export default class LyricsOverlay {
  private root: HTMLElement | null = null;
  private contentEl: HTMLElement | null = null;
  private headerTitleEl: HTMLElement | null = null;
  private headerMetaEl: HTMLElement | null = null;
  private collapsedButtonEl: HTMLButtonElement | null = null;
  private loadingBadgeEl: HTMLDivElement | null = null;
  private collapsed = false;
  private enabled = false;
  private debugEnabled = false;
  private wordHighlightEnabled = true;
  private fontSizePx = 26;
  private seekCallback: ((positionSeconds: number) => void) | null = null;

  private currentState: LyricsViewState = { status: "idle" };
  private currentSyncState: LyricsSyncState = {
    trackFingerprint: "",
    progressMs: 0,
    playing: false,
    adPlaying: false
  };

  private renderedTrackFingerprint = "";
  private syncedLines: LyricsLine[] = [];
  private lineElements: HTMLDivElement[] = [];
  private wordSlotsByLine: WordSlot[][] = [];
  private activeSyncedLineIndex = -1;
  private activeWord: WordSlot | null = null;
  private manualScrollUntil = 0;
  private hiddenNativeElements = new Map<HTMLElement, string | null>();

  private hostScanInterval: number | null = null;
  private mutationObserver: MutationObserver | null = null;
  private lastPlacementSignature = "";
  private lastHostSelector = "none";

  public setSeekCallback(callback: (positionSeconds: number) => void) {
    this.seekCallback = callback;
  }

  public setSettings(settings: { enabled: boolean; fontSize: number; debug: boolean; wordHighlight: boolean }) {
    const enabledChanged = this.enabled !== settings.enabled;
    const debugChanged = this.debugEnabled !== settings.debug;
    const wordHighlightChanged = this.wordHighlightEnabled !== settings.wordHighlight;

    this.enabled = settings.enabled;
    this.debugEnabled = settings.debug;
    this.wordHighlightEnabled = settings.wordHighlight;
    const parsedFontSize = Number(settings.fontSize);
    const oldFontSizePx = this.fontSizePx;
    this.fontSizePx = Number.isFinite(parsedFontSize) ? Math.max(18, Math.min(42, parsedFontSize)) : 26;

    if (!this.enabled) {
      this.destroy();
      return;
    }

    this.ensureMounted();
    this.applyFontSize();
    if (enabledChanged || debugChanged || wordHighlightChanged) {
      this.syncPlacement();
      this.render();
    } else if (oldFontSizePx !== this.fontSizePx) {
      this.updateActiveSyncedLine(this.currentSyncState.progressMs);
    }
    this.debugLog(`settings enabled=${this.enabled} size=${this.fontSizePx} debug=${this.debugEnabled}`);
  }

  public setState(state: LyricsViewState) {
    this.currentState = state;
    if (!this.enabled) {
      return;
    }
    this.ensureMounted();
    this.render();
    this.syncPlacement();
    this.debugLog(`state status=${state.status} track=${state.trackFingerprint ?? "none"}`);
  }

  public setSyncState(syncState: LyricsSyncState) {
    this.currentSyncState = syncState;
    if (!this.enabled || this.currentState.status !== "synced") {
      return;
    }
    if (syncState.trackFingerprint !== this.renderedTrackFingerprint) {
      return;
    }
    this.updateActiveSyncedLine(syncState.progressMs);
  }

  private debugLog(message: string) {
    if (!this.debugEnabled) {
      return;
    }
    console.info(`[lyrics-ui] ${message}`);
  }

  private debugPlacement(message: string) {
    if (!this.debugEnabled) {
      return;
    }
    if (this.lastPlacementSignature === message) {
      return;
    }
    this.lastPlacementSignature = message;
    this.debugLog(message);
  }

  private isPlayerRouteContext() {
    return !!document.querySelector("ytmusic-player-page");
  }

  private isPlayerPageVisible() {
    const playerPage = document.querySelector("ytmusic-player-page") as HTMLElement | null;
    if (!playerPage) {
      return false;
    }

    const styleVisibility = playerPage.style.visibility;
    const computedVisibility = window.getComputedStyle(playerPage).visibility;
    const playerPageOpen = playerPage.hasAttribute("player-page-open");
    const uiState = playerPage.getAttribute("player-ui-state") ?? "";

    const visibleByStyle = styleVisibility !== "hidden" && computedVisibility !== "hidden";
    const visibleByState = playerPageOpen || uiState === "PLAYER_PAGE_OPEN";
    return visibleByStyle && visibleByState;
  }

  public destroy() {
    if (this.hostScanInterval !== null) {
      window.clearInterval(this.hostScanInterval);
      this.hostScanInterval = null;
    }
    if (this.mutationObserver) {
      this.mutationObserver.disconnect();
      this.mutationObserver = null;
    }
    const globalStyle = document.getElementById("ytmd-lyrics-global-style");
    if (globalStyle) {
      globalStyle.remove();
    }

    this.root?.remove();
    this.collapsedButtonEl?.remove();
    this.loadingBadgeEl?.remove();
    this.showNativeLyrics();

    this.root = null;
    this.contentEl = null;
    this.collapsedButtonEl = null;
    this.loadingBadgeEl = null;
    this.syncedLines = [];
    this.lineElements = [];
    this.wordSlotsByLine = [];
    this.activeSyncedLineIndex = -1;
    this.activeWord = null;
  }

  private ensureMounted() {
    if (this.root) {
      return;
    }

    const root = document.createElement("div");
    root.id = "ytmd-lyrics-overlay";
    root.style.display = "none";

    const shadow = root.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = `
      :host { all: initial; }
      .container {
        display: flex;
        flex-direction: column;
        width: 100%;
        height: calc(100vh - 160px);
        min-height: 280px;
        border-radius: 12px;
        overflow: hidden;
        border: 1px solid rgba(255,255,255,0.14);
        background: linear-gradient(180deg, rgba(22,22,22,0.88), rgba(10,10,10,0.92));
        color: #f2f2f2;
        font-family: "Open Sans", "Work Sans", sans-serif;
      }
      .header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 10px 12px;
        border-bottom: 1px solid rgba(255,255,255,0.1);
      }
      .title {
        font-size: 11px;
        letter-spacing: .08em;
        text-transform: uppercase;
        color: rgba(255,255,255,0.74);
      }
      .meta {
        margin-left: 10px;
        font-size: 10px;
        letter-spacing: .04em;
        color: rgba(255,255,255,0.55);
        text-transform: uppercase;
      }
      .header-left {
        display: flex;
        align-items: center;
      }
      .button {
        background: rgba(255,255,255,0.12);
        border: 1px solid rgba(255,255,255,0.14);
        color: #fff;
        border-radius: 4px;
        font-size: 11px;
        cursor: pointer;
        padding: 3px 8px;
      }
      .content {
        flex: 1;
        overflow-y: scroll;
        overflow-x: hidden;
        padding: 14px;
        line-height: 2.05;
        font-size: 26px;
        scrollbar-width: none;
        -ms-overflow-style: none;
        position: relative;
      }
      .content::-webkit-scrollbar { 
        display: none; 
      }
      .empty { color: rgba(255,255,255,0.74); }
      .loader {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        color: rgba(255,255,255,0.82);
      }
      .loader-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: #ffe082;
        animation: lyrics-loader 900ms infinite ease-in-out;
      }
      .loader-dot:nth-child(2) { animation-delay: 120ms; }
      .loader-dot:nth-child(3) { animation-delay: 240ms; }
      @keyframes lyrics-loader {
        0%, 80%, 100% { opacity: 0.2; transform: scale(0.8); }
        40% { opacity: 1; transform: scale(1); }
      }
      .line {
        opacity: 0.58;
        margin-bottom: 14px;
        white-space: pre-wrap;
        transition: opacity 120ms ease, color 120ms ease;
        cursor: pointer;
      }
      .line:hover { opacity: 0.9; }
      .line.active { opacity: 1; color: #ffe082; }
      .word.active-word { color: #ffca28; }
      .plain { white-space: pre-wrap; }
    `;

    const container = document.createElement("div");
    container.className = "container";

    const header = document.createElement("div");
    header.className = "header";
    const title = document.createElement("div");
    title.className = "title";
    title.textContent = "Synced Lyrics";
    const collapse = document.createElement("button");
    collapse.className = "button";
    collapse.textContent = "Collapse";
    collapse.addEventListener("click", () => {
      this.collapsed = true;
      this.syncPlacement();
    });
    const headerLeft = document.createElement("div");
    headerLeft.className = "header-left";
    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = "";
    headerLeft.appendChild(title);
    headerLeft.appendChild(meta);
    header.appendChild(headerLeft);
    header.appendChild(collapse);

    const content = document.createElement("div");
    content.className = "content medium";
    content.addEventListener("wheel", () => {
      this.manualScrollUntil = Date.now() + 2500;
    });
    content.addEventListener("pointerdown", () => {
      this.manualScrollUntil = Date.now() + 2500;
    });

    container.appendChild(header);
    container.appendChild(content);
    shadow.appendChild(style);
    shadow.appendChild(container);

    const collapsedButton = document.createElement("button");
    collapsedButton.textContent = "Show Lyrics";
    collapsedButton.style.display = "none";
    collapsedButton.style.margin = "8px 0";
    collapsedButton.style.padding = "8px 10px";
    collapsedButton.style.borderRadius = "999px";
    collapsedButton.style.border = "1px solid rgba(255,255,255,0.2)";
    collapsedButton.style.background = "rgba(20,20,20,0.88)";
    collapsedButton.style.color = "#fff";
    collapsedButton.style.cursor = "pointer";
    collapsedButton.style.position = "sticky";
    collapsedButton.style.top = "0";
    collapsedButton.style.zIndex = "2";
    collapsedButton.addEventListener("click", () => {
      this.collapsed = false;
      this.syncPlacement();
    });

    const loadingBadge = document.createElement("div");
    loadingBadge.style.display = "none";
    loadingBadge.style.position = "sticky";
    loadingBadge.style.top = "0";
    loadingBadge.style.zIndex = "2";
    loadingBadge.style.padding = "6px 10px";
    loadingBadge.style.borderRadius = "999px";
    loadingBadge.style.margin = "8px 0";
    loadingBadge.style.width = "fit-content";
    loadingBadge.style.background = "rgba(20,20,20,0.92)";
    loadingBadge.style.border = "1px solid rgba(255,255,255,0.16)";
    loadingBadge.style.color = "#f5f5f5";
    loadingBadge.style.fontSize = "12px";
    loadingBadge.style.letterSpacing = "0.03em";
    loadingBadge.textContent = "Searching synced lyrics...";

    this.root = root;
    this.contentEl = content;
    this.headerTitleEl = title;
    this.headerMetaEl = meta;
    this.collapsedButtonEl = collapsedButton;
    this.loadingBadgeEl = loadingBadge;

    document.body.appendChild(root);
    document.body.appendChild(collapsedButton);
    document.body.appendChild(loadingBadge);

    this.hostScanInterval = window.setInterval(() => this.syncPlacement(), 1200);
    this.mutationObserver = new MutationObserver(() => this.syncPlacement());
    this.mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["selected", "aria-selected", "class", "player-page-ui-state", "player-ui-state", "player-page-open"]
    });
  }

  private findLyricsTabButton(): HTMLElement | null {
    const scopedCandidates = Array.from(
      document.querySelectorAll("ytmusic-player-page #right-content tp-yt-paper-tab.tab-header, ytmusic-player-page #right-content [role='tab']")
    );
    const fallbackCandidates = Array.from(document.querySelectorAll("tp-yt-paper-tab.tab-header, [role='tab']"));
    const candidates = scopedCandidates.length > 0 ? scopedCandidates : fallbackCandidates;
    for (const element of candidates) {
      const text = element.textContent?.trim().toLowerCase() ?? "";
      if (text.includes("lyrics")) {
        return element as HTMLElement;
      }
    }
    return null;
  }

  private isLyricsTabSelected() {
    const tab = this.findLyricsTabButton();
    if (!tab) {
      return !!document.querySelector("ytmusic-player-page #right-content ytmusic-tab-renderer[selected] ytmusic-description-shelf-renderer");
    }
    const className = tab.className.toString().toLowerCase();
    return (
      tab.getAttribute("aria-selected") === "true" || tab.hasAttribute("selected") || className.includes("selected") || className.includes("iron-selected")
    );
  }

  private findLyricsHost(): { host: HTMLElement | null; selector: string } {
    const selectors = [
      "ytmusic-player-page #right-content",
      "ytmusic-player-page #related-content",
      "ytmusic-player-page ytmusic-tab-renderer[selected] #contents",
      "ytmusic-player-page ytmusic-tab-renderer[selected] #content",
      "ytmusic-player-page ytmusic-tab-renderer[selected]",
      "ytmusic-player-page ytmusic-description-shelf-renderer"
    ];

    for (const selector of selectors) {
      const host = document.querySelector(selector);
      if (!(host instanceof HTMLElement)) {
        continue;
      }
      if (host.id === "ytmd-lyrics-overlay" || host.id === "ytmd-lyrics-collapsed-pill") {
        continue;
      }
      return { host, selector };
    }

    return { host: null, selector: "none" };
  }

  private hideNativeLyrics() {
    const candidates = Array.from(
      document.querySelectorAll(
        "ytmusic-description-shelf-renderer yt-formatted-string.description, ytmusic-description-shelf-renderer yt-attributed-string, ytmusic-description-shelf-renderer yt-formatted-string.footer"
      )
    ) as HTMLElement[];

    for (const candidate of candidates) {
      if (!this.hiddenNativeElements.has(candidate)) {
        this.hiddenNativeElements.set(candidate, candidate.style.display || null);
      }
      candidate.style.display = "none";
    }
  }

  private showNativeLyrics() {
    for (const [element, previousDisplay] of this.hiddenNativeElements.entries()) {
      if (previousDisplay === null) {
        element.style.removeProperty("display");
      } else {
        element.style.display = previousDisplay;
      }
    }
    this.hiddenNativeElements.clear();
  }

  private syncPlacement() {
    if (!this.root || !this.collapsedButtonEl || !this.loadingBadgeEl) {
      return;
    }

    const tabSelected = this.isLyricsTabSelected();
    const hostInfo = this.findLyricsHost();
    const host = hostInfo.host;
    this.lastHostSelector = hostInfo.selector;
    const playerPageVisible = this.isPlayerPageVisible();
    const showInTab = this.enabled && tabSelected && !!host && host.isConnected;
    this.debugPlacement(
      `placement status=${this.currentState.status} pageVisible=${playerPageVisible} tabSelected=${tabSelected} host=${host ? "yes" : "no"} selector=${this.lastHostSelector} showInTab=${showInTab} collapsed=${this.collapsed}`
    );

    if (!showInTab) {
      const canUseFloatingFallback = this.enabled && tabSelected;
      if (canUseFloatingFallback) {
        if (this.root.parentElement !== document.body) {
          document.body.appendChild(this.root);
        }
        if (this.collapsedButtonEl.parentElement !== document.body) {
          document.body.appendChild(this.collapsedButtonEl);
        }
        if (this.loadingBadgeEl.parentElement !== document.body) {
          document.body.appendChild(this.loadingBadgeEl);
        }

        this.root.style.position = "fixed";
        this.root.style.top = "84px";
        this.root.style.right = "16px";
        this.root.style.width = "min(36vw, 500px)";
        this.root.style.height = "calc(100vh - 160px)";
        this.root.style.zIndex = "2147483000";

        this.collapsedButtonEl.style.position = "fixed";
        this.collapsedButtonEl.style.top = "84px";
        this.collapsedButtonEl.style.right = "16px";
        this.collapsedButtonEl.style.zIndex = "2147483001";

        this.loadingBadgeEl.style.position = "fixed";
        this.loadingBadgeEl.style.top = "84px";
        this.loadingBadgeEl.style.right = "16px";
        this.loadingBadgeEl.style.zIndex = "2147483001";

        if (this.collapsed) {
          this.showNativeLyrics();
          this.root.style.display = "none";
          this.collapsedButtonEl.style.display = "inline-block";
          this.loadingBadgeEl.style.display = "none";
          return;
        }

        const shouldShowCustomLyrics = this.hasRenderableCustomLyrics();
        if (shouldShowCustomLyrics) {
          this.hideNativeLyrics();
          this.root.style.display = "block";
          this.collapsedButtonEl.style.display = "none";
          this.loadingBadgeEl.style.display = "none";
          return;
        }

        this.showNativeLyrics();
        this.root.style.display = "none";
        this.collapsedButtonEl.style.display = "none";
        this.loadingBadgeEl.style.display = this.currentState.status === "loading" ? "inline-flex" : "none";
        return;
      }

      this.showNativeLyrics();
      this.root.style.display = "none";
      this.collapsedButtonEl.style.display = "none";
      this.loadingBadgeEl.style.display = "none";
      return;
    }

    const nativeContainer = host;
    if (!nativeContainer || !nativeContainer.isConnected) {
      this.showNativeLyrics();
      this.root.style.display = "none";
      this.collapsedButtonEl.style.display = "none";
      this.loadingBadgeEl.style.display = "none";
      this.debugLog("native container unavailable; restoring native lyrics");
      return;
    }

    if (nativeContainer && this.root.parentElement !== nativeContainer) {
      nativeContainer.prepend(this.root);
    }

    if (nativeContainer && this.collapsedButtonEl.parentElement !== nativeContainer) {
      nativeContainer.prepend(this.collapsedButtonEl);
    }

    if (nativeContainer && this.loadingBadgeEl.parentElement !== nativeContainer) {
      nativeContainer.prepend(this.loadingBadgeEl);
    }

    this.root.style.position = "sticky";
    this.root.style.top = "0";
    this.root.style.right = "";
    this.root.style.width = "100%";
    this.root.style.zIndex = "0";

    this.collapsedButtonEl.style.position = "sticky";
    this.collapsedButtonEl.style.top = "0";
    this.collapsedButtonEl.style.right = "";
    this.collapsedButtonEl.style.zIndex = "0";

    this.loadingBadgeEl.style.position = "sticky";
    this.loadingBadgeEl.style.top = "0";
    this.loadingBadgeEl.style.zIndex = "2";

    if (this.collapsed) {
      this.showNativeLyrics();
      this.root.style.display = "none";
      this.collapsedButtonEl.style.display = "inline-block";
      this.loadingBadgeEl.style.display = "none";
      return;
    }

    const shouldShowCustomLyrics = this.hasRenderableCustomLyrics();

    if (!shouldShowCustomLyrics) {
      this.showNativeLyrics();
      this.collapsedButtonEl.style.display = "none";
      this.root.style.display = "none";
      this.loadingBadgeEl.style.display = this.currentState.status === "loading" ? "inline-flex" : "none";
      return;
    }

    this.hideNativeLyrics();
    this.collapsedButtonEl.style.display = "none";
    this.loadingBadgeEl.style.display = "none";
    this.root.style.display = "block";

    queueMicrotask(() => {
      if (!this.root) {
        return;
      }
      const visible = this.root.isConnected && this.root.getClientRects().length > 0 && this.root.offsetHeight > 0;
      const renderedLineCount = this.lineElements.length;
      const shouldHaveLines = this.currentState.status === "synced";
      if (!visible || (shouldHaveLines && renderedLineCount === 0)) {
        this.showNativeLyrics();
        this.root.style.display = "none";
      }
    });
  }

  private hasRenderableCustomLyrics() {
    if (this.currentState.status === "plain") {
      return isRenderableLyricsText(this.currentState.result.plainText ?? "");
    }

    if (this.currentState.status === "synced") {
      const lines = this.currentState.result.lines ?? [];
      return lines.some(line => isRenderableLyricsText(line.text));
    }

    return false;
  }

  private render() {
    if (!this.contentEl) {
      return;
    }

    while (this.contentEl.firstChild) {
      this.contentEl.removeChild(this.contentEl.firstChild);
    }

    this.syncedLines = [];
    this.lineElements = [];
    this.wordSlotsByLine = [];
    this.activeSyncedLineIndex = -1;
    this.activeWord = null;

    this.updateHeaderMeta();

    const state = this.currentState;
    if (state.status === "idle") {
      this.renderMessage("Waiting for track info...");
      return;
    }
    if (state.status === "loading") {
      this.renderMessage("Loading lyrics...");
      return;
    }
    if (state.status === "ad") {
      this.renderMessage(state.message ?? "Ad playing");
      return;
    }
    if (state.status === "error") {
      this.renderMessage(state.message ?? "Lyrics unavailable right now");
      return;
    }
    if (state.status === "none") {
      this.renderMessage(state.message ?? "No lyrics found");
      return;
    }

    this.renderedTrackFingerprint = state.trackFingerprint;
    if (state.status === "plain") {
      this.renderPlain(state.result.plainText ?? "No lyrics found");
      return;
    }

    if (state.status === "synced") {
      this.renderSynced(state.result.lines ?? []);
    }
    this.updateActiveSyncedLine(this.currentSyncState.progressMs);
  }

  private updateHeaderMeta() {
    if (!this.headerTitleEl || !this.headerMetaEl) {
      return;
    }

    this.headerTitleEl.textContent = "Synced Lyrics";
    if (!this.debugEnabled) {
      this.headerMetaEl.textContent = "";
      return;
    }

    const state = this.currentState;
    const source = state.debug?.source ?? (state.status === "synced" || state.status === "plain" ? state.result.source : undefined);
    const origin = state.debug?.origin;

    const sourceLabel = source === "musixmatch" ? "Musixmatch" : source === "lrclib" ? "LRCLib" : source === "youtube" ? "YouTube" : "unknown";
    const originLabel = origin === "cache" ? "cached" : origin === "network" ? "fetched" : "";
    this.headerMetaEl.textContent = originLabel ? `${sourceLabel} ${originLabel}` : sourceLabel;
  }

  private renderMessage(message: string) {
    if (!this.contentEl) {
      return;
    }
    const empty = document.createElement("div");
    empty.className = "empty";

    if (this.currentState.status === "loading") {
      const loader = document.createElement("div");
      loader.className = "loader";

      const dot1 = document.createElement("span");
      dot1.className = "loader-dot";
      const dot2 = document.createElement("span");
      dot2.className = "loader-dot";
      const dot3 = document.createElement("span");
      dot3.className = "loader-dot";
      const label = document.createElement("span");
      label.textContent = message;

      loader.appendChild(dot1);
      loader.appendChild(dot2);
      loader.appendChild(dot3);
      loader.appendChild(label);
      empty.appendChild(loader);
    } else {
      empty.textContent = message;
    }

    this.contentEl.appendChild(empty);
  }

  private renderPlain(plainText: string) {
    if (!this.contentEl) {
      return;
    }
    const plain = document.createElement("div");
    plain.className = "plain";
    plain.textContent = plainText;
    this.contentEl.appendChild(plain);
  }

  private renderSynced(lines: LyricsLine[]) {
    if (!this.contentEl) {
      return;
    }

    this.syncedLines = lines.filter(line => isRenderableLyricsText(line.text));
    if (this.syncedLines.length === 0) {
      this.renderMessage("No lyrics found");
      return;
    }
    const host = document.createElement("div");

    for (let i = 0; i < this.syncedLines.length; i++) {
      const line = this.syncedLines[i];
      const lineEl = document.createElement("div");
      lineEl.className = "line";
      lineEl.title = "Click to seek";
      lineEl.addEventListener("click", () => {
        this.seekCallback?.(Math.floor(line.startMs / 1000));
      });

      const slots: WordSlot[] = [];
      const words = line.text.split(/(\s+)/).filter(token => token.length > 0);
      const rangeStart = line.startMs;
      const rangeEnd = line.endMs ?? line.startMs + 2000;
      const duration = Math.max(200, rangeEnd - rangeStart);
      const wordTokens = words.filter(token => !/^\s+$/.test(token));
      const slotDuration = Math.max(60, Math.floor(duration / Math.max(1, wordTokens.length)));

      let wordIndex = 0;
      for (const token of words) {
        const span = document.createElement("span");
        span.textContent = token;
        if (!/^\s+$/.test(token)) {
          span.className = "word";
          const startMs = rangeStart + wordIndex * slotDuration;
          const endMs = Math.min(rangeEnd, startMs + slotDuration - 1);
          slots.push({
            startMs,
            endMs,
            element: span
          });
          wordIndex++;
        }
        lineEl.appendChild(span);
      }

      if (line.text.trim().length === 0) {
        lineEl.textContent = " ";
      }

      host.appendChild(lineEl);
      this.lineElements.push(lineEl);
      this.wordSlotsByLine.push(slots);
    }

    this.contentEl.appendChild(host);
  }

  private updateActiveSyncedLine(progressMs: number) {
    if (!this.syncedLines.length || !this.lineElements.length) {
      return;
    }

    let lineIndex = -1;
    for (let i = 0; i < this.syncedLines.length; i++) {
      const line = this.syncedLines[i];
      const endMs = line.endMs ?? Number.MAX_SAFE_INTEGER;
      if (progressMs >= line.startMs && progressMs <= endMs) {
        lineIndex = i;
        break;
      }
    }

    if (lineIndex === -1 && progressMs >= this.syncedLines[this.syncedLines.length - 1].startMs) {
      lineIndex = this.syncedLines.length - 1;
    }

    if (lineIndex !== this.activeSyncedLineIndex) {
      if (this.activeSyncedLineIndex >= 0) {
        this.lineElements[this.activeSyncedLineIndex]?.classList.remove("active");
      }
      this.activeSyncedLineIndex = lineIndex;

      if (lineIndex >= 0) {
        const activeLine = this.lineElements[lineIndex];
        activeLine?.classList.add("active");
        if (Date.now() > this.manualScrollUntil && this.contentEl && activeLine) {
          const containerCenter = this.contentEl.clientHeight / 2;
          const lineCenter = activeLine.offsetTop + activeLine.clientHeight / 2;
          this.contentEl.scrollTo({
            top: lineCenter - containerCenter,
            behavior: "smooth"
          });
        }
      }
    }

    if (this.activeWord) {
      this.activeWord.element.classList.remove("active-word");
      this.activeWord = null;
    }

    if (!this.wordHighlightEnabled) {
      return;
    }

    if (lineIndex < 0) {
      return;
    }

    const wordSlots = this.wordSlotsByLine[lineIndex] ?? [];
    for (const slot of wordSlots) {
      if (progressMs >= slot.startMs && progressMs <= slot.endMs) {
        slot.element.classList.add("active-word");
        this.activeWord = slot;
        break;
      }
    }
  }

  private applyFontSize() {
    if (!this.contentEl) {
      return;
    }
    this.contentEl.style.fontSize = `${this.fontSizePx}px`;
  }
}
