/* eslint-disable @typescript-eslint/no-unused-expressions */
(function () {
  const ytmStore = window.__YTMD_HOOK__?.ytmStore;

  let isOpen = false;
  let currentVideoId = "";
  let currentTitle = "";
  let currentArtist = "";
  let currentAlbum = "";
  let currentThumbnail = "";
  let currentDuration = 0;
  let lyricsData = null;
  let activeLineIndex = -1;
  let userIsScrolling = false;
  let userScrollTimeout = null;
  let syncInterval = null;
  let fontSizeIndex = 1;
  const fontSizes = ["font-small", "font-medium", "font-large"];
  let isFullscreen = false;
  let isProgrammaticScroll = false;
  let syncMode = localStorage.getItem("ytmd_lyrics_sync_mode") || "line";

  let lyricsSettings = {
    liveLyricsEnabled: true,
    liveLyricsDefaultMode: "line",
    liveLyricsLanguage: "default",
    liveLyricsFontSize: 32,
    liveLyricsGradientBg: true,
    liveLyricsInstrumentalBreaks: true
  };

  let lyricsOverlay = null;
  let lyricsButton = null;
  let scrollContainer = null;
  let scrollContent = null;
  let syncButton = null;
  let syncModeBtn = null;
  let titleEl = null;
  let artistEl = null;
  let artEl = null;
  let badgeEl = null;
  let fontSizeBtn = null;
  let fullscreenBtn = null;
  let closeBtn = null;
  let styleSheet = null;

  function applyLyricsSettings(settings) {
    if (!settings) return;
    const prevLang = lyricsSettings.liveLyricsLanguage;
    const prevBreaks = lyricsSettings.liveLyricsInstrumentalBreaks;
    lyricsSettings = Object.assign({}, lyricsSettings, settings);

    if (lyricsSettings.liveLyricsFontSize) {
      if (lyricsOverlay) {
        lyricsOverlay.style.setProperty("--ytmd-lyric-font-size", `${lyricsSettings.liveLyricsFontSize}px`);
      }
    }

    if (lyricsSettings.liveLyricsDefaultMode) {
      syncMode = lyricsSettings.liveLyricsDefaultMode;
      localStorage.setItem("ytmd_lyrics_sync_mode", syncMode);
      if (lyricsOverlay) {
        lyricsOverlay.classList.remove("mode-karaoke", "mode-line");
        lyricsOverlay.classList.add(`mode-${syncMode}`);
      }
      updateSyncModeButton();
      if (activeLineIndex >= 0) {
        updateActiveLine(activeLineIndex, true);
      }
    }

    if (typeof lyricsSettings.liveLyricsGradientBg === "boolean") {
      if (lyricsOverlay) {
        const bgMesh = lyricsOverlay.querySelector(".ytmd-lyrics-bg-mesh");
        if (bgMesh) {
          bgMesh.style.display = lyricsSettings.liveLyricsGradientBg ? "block" : "none";
        }
      }
    }

    if (typeof lyricsSettings.liveLyricsEnabled === "boolean") {
      if (lyricsButton) {
        lyricsButton.style.display = lyricsSettings.liveLyricsEnabled ? "inline-flex" : "none";
      }
      if (!lyricsSettings.liveLyricsEnabled && isOpen) {
        toggleLyrics(false);
      }
    }

    if (
      (typeof lyricsSettings.liveLyricsInstrumentalBreaks === "boolean" && lyricsSettings.liveLyricsInstrumentalBreaks !== prevBreaks) ||
      (lyricsSettings.liveLyricsLanguage && lyricsSettings.liveLyricsLanguage !== prevLang)
    ) {
      if (currentVideoId) {
        fetchLyrics(currentVideoId, currentTitle, currentArtist, currentDuration, currentAlbum);
      }
    }
  }

  function createLyricsStyles() {
    if (styleSheet) return;
    styleSheet = document.createElement("style");
    styleSheet.id = "ytmd-live-lyrics-styles";
    styleSheet.textContent = `
      :root {
        --ytmd-lyric-c1: #3b1d5a;
        --ytmd-lyric-c2: #1e3a6c;
        --ytmd-lyric-c3: #121e36;
        --ytmd-lyric-bg: #0d0d12;
      }

      .ytmd-player-bar-control.lyrics-button {
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        margin-left: 6px;
        color: rgba(255, 255, 255, 0.7);
        transition: color 0.2s ease, transform 0.2s ease;
      }

      .ytmd-player-bar-control.lyrics-button:hover {
        color: #ffffff;
        transform: scale(1.08);
      }

      .ytmd-player-bar-control.lyrics-button.active {
        color: #1db954 !important;
        text-shadow: 0 0 12px rgba(29, 185, 84, 0.6);
      }

      .ytmd-player-bar-control.lyrics-button .material-symbols-outlined {
        font-size: 22px;
      }

      .ytmd-lyrics-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 72px; 
        z-index: 1000;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        user-select: none;
        opacity: 1;
        visibility: visible;
        transition: opacity 0.3s cubic-bezier(0.2, 0.9, 0.3, 1), visibility 0.3s;
        background-color: var(--ytmd-lyric-bg);
      }

      .ytmd-lyrics-overlay.fullscreen {
        bottom: 0 !important;
        z-index: 2147483647;
      }

      .ytmd-lyrics-overlay.hidden {
        opacity: 0;
        visibility: hidden;
        pointer-events: none;
      }

      .ytmd-lyrics-bg {
        position: absolute;
        inset: 0;
        z-index: 0;
        overflow: hidden;
        pointer-events: none;
        background: var(--ytmd-lyric-bg);
      }

      .ytmd-lyrics-bg-mesh {
        position: absolute;
        inset: -20%;
        background:
          radial-gradient(circle at 25% 25%, var(--ytmd-lyric-c1) 0%, transparent 50%),
          radial-gradient(circle at 75% 30%, var(--ytmd-lyric-c2) 0%, transparent 55%),
          radial-gradient(circle at 50% 75%, var(--ytmd-lyric-c3) 0%, transparent 60%),
          radial-gradient(circle at 80% 80%, var(--ytmd-lyric-c1) 0%, transparent 50%);
        filter: blur(60px);
        opacity: 0.85;
        animation: ytmd-gradient-pulse 16s ease-in-out infinite alternate;
        transition: background 1.5s ease;
      }

      @keyframes ytmd-gradient-pulse {
        0% {
          transform: scale(1) rotate(0deg);
        }
        50% {
          transform: scale(1.1) rotate(3deg);
        }
        100% {
          transform: scale(1.05) rotate(-2deg);
        }
      }

      .ytmd-lyrics-bg-overlay {
        position: absolute;
        inset: 0;
        background: radial-gradient(circle at 50% 50%, rgba(0, 0, 0, 0.1) 0%, rgba(0, 0, 0, 0.65) 100%);
        backdrop-filter: blur(20px);
      }

      .ytmd-lyrics-header {
        position: relative;
        z-index: 10;
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 24px 40px 16px 40px;
        background: linear-gradient(to bottom, rgba(0,0,0,0.5), transparent);
        flex-shrink: 0;
      }

      .ytmd-lyrics-track-info {
        display: flex;
        align-items: center;
        gap: 16px;
        min-width: 0;
      }

      .ytmd-lyrics-track-art {
        width: 52px;
        height: 52px;
        border-radius: 8px;
        object-fit: cover;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
        flex-shrink: 0;
      }

      .ytmd-lyrics-track-meta {
        display: flex;
        flex-direction: column;
        min-width: 0;
      }

      .ytmd-lyrics-track-title {
        font-size: 18px;
        font-weight: 700;
        color: #ffffff;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        letter-spacing: -0.01em;
      }

      .ytmd-lyrics-track-artist {
        font-size: 14px;
        font-weight: 500;
        color: rgba(255, 255, 255, 0.7);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        margin-top: 2px;
      }

      .ytmd-lyrics-header-controls {
        display: flex;
        align-items: center;
        gap: 10px;
        flex-shrink: 0;
      }

      .ytmd-lyrics-badge {
        font-size: 11px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        padding: 4px 10px;
        border-radius: 20px;
        background: rgba(255, 255, 255, 0.12);
        color: rgba(255, 255, 255, 0.85);
        backdrop-filter: blur(10px);
        border: 1px solid rgba(255, 255, 255, 0.15);
        display: inline-flex;
        align-items: center;
        gap: 6px;
      }

      .ytmd-beta-tag {
        display: inline-block;
        padding: 1px 6px;
        border-radius: 4px;
        font-size: 9px;
        font-weight: 800;
        letter-spacing: 0.06em;
        background: #0070f3;
        color: #ffffff;
        vertical-align: middle;
        text-transform: uppercase;
        box-shadow: 0 0 10px rgba(0, 112, 243, 0.5);
      }

      .ytmd-lyrics-header-btn {
        background: rgba(255, 255, 255, 0.1);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 50%;
        width: 38px;
        height: 38px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        color: rgba(255, 255, 255, 0.8);
        cursor: pointer;
        transition: all 0.2s ease;
        backdrop-filter: blur(10px);
      }

      .ytmd-lyrics-header-btn:hover {
        background: rgba(255, 255, 255, 0.22);
        color: #ffffff;
        transform: scale(1.06);
      }

      .ytmd-lyrics-header-btn .material-symbols-outlined {
        font-size: 20px;
      }

      .ytmd-lyrics-scroll-container {
        position: relative;
        z-index: 10;
        flex: 1;
        overflow-y: auto;
        overflow-x: hidden;
        padding: 40px 60px 180px 60px;
        scroll-behavior: smooth;
        mask-image: linear-gradient(to bottom, transparent 0%, black 12%, black 88%, transparent 100%);
        -webkit-mask-image: linear-gradient(to bottom, transparent 0%, black 12%, black 88%, transparent 100%);
      }

      .ytmd-lyrics-scroll-container::-webkit-scrollbar {
        width: 6px;
      }

      .ytmd-lyrics-scroll-container::-webkit-scrollbar-track {
        background: transparent;
      }

      .ytmd-lyrics-scroll-container::-webkit-scrollbar-thumb {
        background: rgba(255, 255, 255, 0.2);
        border-radius: 4px;
      }

      .ytmd-lyrics-scroll-content {
        max-width: 900px;
        margin: 0 auto;
        display: flex;
        flex-direction: column;
        gap: 20px;
      }

      .ytmd-lyric-line {
        position: relative;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans", "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic", "Meiryo", "Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans CJK JP", "Noto Sans CJK KR", "Noto Sans CJK SC", "Noto Sans Arabic", "Noto Sans Devanagari", Helvetica, Arial, sans-serif;
        font-weight: 700;
        font-size: var(--ytmd-lyric-font-size, 32px);
        color: rgba(255, 255, 255, 0.35);
        line-height: 1.35;
        cursor: pointer;
        transform-origin: left center;
        transition: color 0.35s cubic-bezier(0.25, 1, 0.5, 1),
                    opacity 0.35s cubic-bezier(0.25, 1, 0.5, 1),
                    transform 0.35s cubic-bezier(0.25, 1, 0.5, 1),
                    filter 0.35s cubic-bezier(0.25, 1, 0.5, 1),
                    text-shadow 0.35s cubic-bezier(0.25, 1, 0.5, 1),
                    font-size 0.15s ease;
        border-radius: 8px;
        padding: 6px 12px;
        margin-left: -12px;
      }

      .ytmd-lyric-line:hover {
        color: rgba(255, 255, 255, 0.75);
        background: rgba(255, 255, 255, 0.05);
      }

      .ytmd-lyric-word {
        display: inline-block;
        margin: 0;
        vertical-align: baseline;
        transform-origin: center bottom;
        transition: color 0.1s ease, opacity 0.1s ease, transform 0.12s cubic-bezier(0.175, 0.885, 0.32, 1.275), text-shadow 0.12s ease;
      }

      .ytmd-lyric-word:last-child {
        margin: 0;
      }

      .ytmd-lyric-line.past {
        color: rgba(255, 255, 255, 0.45);
      }

      .ytmd-lyric-line.future {
        color: rgba(255, 255, 255, 0.28);
      }

      .ytmd-lyric-line.plain {
        color: rgba(255, 255, 255, 0.85);
        font-weight: 600;
        cursor: default;
        line-height: 1.6;
        padding: 6px 12px;
      }

      .ytmd-lyric-line.plain:hover {
        background: transparent;
        color: rgba(255, 255, 255, 0.85);
      }

      /* Mode: Line Sync (Solid Line Highlight) */
      .ytmd-lyrics-overlay.mode-line .ytmd-lyric-line.active {
        color: #ffffff !important;
        font-weight: 800;
        transform: scale(1.03);
        opacity: 1 !important;
        text-shadow: 0 4px 28px rgba(0, 0, 0, 0.5), 0 0 35px rgba(255, 255, 255, 0.3);
      }

      .ytmd-lyrics-overlay.mode-line .ytmd-lyric-line.active .ytmd-lyric-word {
        color: #ffffff !important;
        opacity: 1 !important;
        transform: none !important;
        text-shadow: none !important;
      }

      /* Mode: Karaoke (Crisp Pop-Word Sync) */
      .ytmd-lyrics-overlay.mode-karaoke .ytmd-lyric-line.active {
        color: rgba(255, 255, 255, 0.35);
        font-weight: 800;
        transform: scale(1.03);
        opacity: 1 !important;
      }

      .ytmd-lyrics-overlay.mode-karaoke .ytmd-lyric-line.active .ytmd-lyric-word.word-sung {
        color: #ffffff !important;
        opacity: 1 !important;
        transform: scale(1);
        text-shadow: 0 2px 14px rgba(0, 0, 0, 0.4);
      }

      .ytmd-lyrics-overlay.mode-karaoke .ytmd-lyric-line.active .ytmd-lyric-word.word-active {
        color: #ffffff !important;
        opacity: 1 !important;
        font-weight: 800;
        transform: translateY(-2px) scale(1.04);
        text-shadow: 0 0 18px rgba(255, 255, 255, 0.95), 0 2px 10px rgba(0, 0, 0, 0.6);
      }

      .ytmd-lyrics-overlay.mode-karaoke .ytmd-lyric-line.active .ytmd-lyric-word.word-upcoming {
        color: rgba(255, 255, 255, 0.32);
        opacity: 0.8;
        transform: scale(1);
        text-shadow: none;
      }

      .ytmd-lyric-line.instrumental {
        padding: 8px 12px;
        min-height: 48px;
        display: flex;
        align-items: center;
      }

      .ytmd-instrumental-container {
        display: inline-flex;
        align-items: center;
        gap: 12px;
      }

      .ytmd-instrumental-note {
        font-size: 32px !important;
        color: rgba(255, 255, 255, 0.3) !important;
        transition: color 0.35s ease, transform 0.45s cubic-bezier(0.2, 0.8, 0.2, 1), text-shadow 0.35s ease, opacity 0.45s ease;
      }

      .ytmd-lyric-line.instrumental.active .ytmd-instrumental-note {
        color: #ffffff !important;
        opacity: 1 !important;
        text-shadow: 0 0 20px rgba(255, 255, 255, 0.95), 0 0 35px rgba(255, 255, 255, 0.45);
        animation: ytmd-note-pulse 1.1s cubic-bezier(0.4, 0, 0.2, 1) infinite alternate;
      }

      .ytmd-lyric-line.instrumental.active .ytmd-instrumental-note:nth-child(2) {
        animation-delay: 0.2s;
      }

      .ytmd-lyric-line.instrumental.active .ytmd-instrumental-note:nth-child(3) {
        animation-delay: 0.4s;
      }

      .ytmd-lyrics-overlay.is-paused .ytmd-lyric-line.instrumental.active .ytmd-instrumental-note {
        animation: none !important;
        transform: translateY(0px) scale(0.92) !important;
        opacity: 0.65 !important;
      }

      @keyframes ytmd-note-pulse {
        0% {
          transform: translateY(2px) scale(0.92);
          opacity: 0.65;
        }
        100% {
          transform: translateY(-6px) scale(1.22);
          opacity: 1;
        }
      }

      .ytmd-lyrics-status {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        min-height: 300px;
        gap: 16px;
        color: rgba(255, 255, 255, 0.6);
        text-align: center;
      }

      .ytmd-lyrics-status .material-symbols-outlined {
        font-size: 48px;
        color: rgba(255, 255, 255, 0.4);
      }

      .ytmd-lyrics-status.loading .material-symbols-outlined {
        animation: ytmd-spin 1.2s linear infinite;
      }

      @keyframes ytmd-spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }

      .ytmd-lyrics-footer {
        margin-top: 40px;
        padding-top: 20px;
        border-top: 1px solid rgba(255, 255, 255, 0.1);
        font-size: 13px;
        color: rgba(255, 255, 255, 0.4);
        font-weight: 500;
      }

      .ytmd-lyrics-sync-btn {
        position: absolute;
        bottom: 30px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 20;
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 10px 20px;
        border-radius: 30px;
        background: rgba(29, 185, 84, 0.95);
        color: #ffffff;
        font-weight: 700;
        font-size: 14px;
        border: none;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
        cursor: pointer;
        backdrop-filter: blur(8px);
        transition: all 0.25s ease;
        opacity: 1;
        visibility: visible;
      }

      .ytmd-lyrics-sync-btn:hover {
        background: #1ed760;
        transform: translateX(-50%) scale(1.05);
        box-shadow: 0 10px 28px rgba(0, 0, 0, 0.5);
      }

      .ytmd-lyrics-sync-btn.hidden {
        opacity: 0;
        visibility: hidden;
        transform: translateX(-50%) translateY(16px);
        pointer-events: none;
      }

      .ytmd-lyrics-sync-btn .material-symbols-outlined {
        font-size: 18px;
      }
    `;
    document.head.appendChild(styleSheet);
  }

  function extractPalette(imgUrl) {
    if (!imgUrl) return;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        canvas.width = 32;
        canvas.height = 32;
        ctx.drawImage(img, 0, 0, 32, 32);
        const data = ctx.getImageData(0, 0, 32, 32).data;

        let rTotal = 0,
          gTotal = 0,
          bTotal = 0,
          count = 0;
        let maxSat = -1;
        let vibrantR = 40,
          vibrantG = 20,
          vibrantB = 70;

        for (let i = 0; i < data.length; i += 16) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          const brightness = (r * 299 + g * 587 + b * 114) / 1000;
          if (brightness > 20 && brightness < 235) {
            rTotal += r;
            gTotal += g;
            bTotal += b;
            count++;

            const max = Math.max(r, g, b);
            const min = Math.min(r, g, b);
            const sat = max === 0 ? 0 : (max - min) / max;
            if (sat > maxSat) {
              maxSat = sat;
              vibrantR = r;
              vibrantG = g;
              vibrantB = b;
            }
          }
        }

        if (count > 0) {
          const avgR = Math.round(rTotal / count);
          const avgG = Math.round(gTotal / count);
          const avgB = Math.round(bTotal / count);

          const c1 = `rgb(${vibrantR}, ${vibrantG}, ${vibrantB})`;
          const c2 = `rgb(${Math.round((vibrantR + avgR) / 2)}, ${Math.round((vibrantG + avgG) / 2)}, ${Math.round((vibrantB + avgB) / 2)})`;
          const c3 = `rgb(${Math.round(avgR * 0.5)}, ${Math.round(avgG * 0.5)}, ${Math.round(avgB * 0.5)})`;
          const bg = `rgb(${Math.max(8, Math.round(avgR * 0.15))}, ${Math.max(8, Math.round(avgG * 0.15))}, ${Math.max(12, Math.round(avgB * 0.2))})`;

          if (lyricsOverlay) {
            lyricsOverlay.style.setProperty("--ytmd-lyric-c1", c1);
            lyricsOverlay.style.setProperty("--ytmd-lyric-c2", c2);
            lyricsOverlay.style.setProperty("--ytmd-lyric-c3", c3);
            lyricsOverlay.style.setProperty("--ytmd-lyric-bg", bg);
          }
        }
      } catch {}
    };
    img.src = imgUrl;
  }

  function insertInstrumentalBreaks(rawLines) {
    if (!rawLines || rawLines.length === 0) return [];

    const result = [];
    const minBreak = 5.0;

    if (rawLines[0].startTime >= 4.5) {
      result.push({
        startTime: 0,
        endTime: rawLines[0].startTime,
        text: "♪",
        isInstrumental: true,
        words: [{ text: "♪", startTime: 0, endTime: rawLines[0].startTime }]
      });
    }

    for (let i = 0; i < rawLines.length; i++) {
      const line = rawLines[i];
      const nextLine = rawLines[i + 1];

      const isExplicitMusic =
        !line.text || line.text === "♪" || /^(?:♪|\(instrumental\)|\[instrumental\]|instrumental|music|intro|outro)$/i.test(line.text.trim());

      if (isExplicitMusic) {
        line.isInstrumental = true;
        line.text = "♪";
        line.words = [{ text: "♪", startTime: line.startTime, endTime: line.endTime }];
      }

      result.push(line);

      if (nextLine && !line.isInstrumental && !nextLine.isInstrumental) {
        const gap = nextLine.startTime - line.endTime;
        if (gap >= minBreak) {
          result.push({
            startTime: line.endTime,
            endTime: nextLine.startTime,
            text: "♪",
            isInstrumental: true,
            words: [{ text: "♪", startTime: line.endTime, endTime: nextLine.startTime }]
          });
        }
      }
    }

    return result.map((item, idx) => ({
      ...item,
      id: idx
    }));
  }

  function segmentTextIntoWords(text) {
    if (!text) return [];
    const clean = text.trim();
    if (!clean) return [];

    const matches = clean.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]|[^\s\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+/gu);
    if (matches && matches.length > 0) {
      return matches.map(m => m.trim()).filter(m => m.length > 0);
    }
    return clean.split(/\s+/).filter(w => w.length > 0);
  }

  function parseLRC(lrcString) {
    if (!lrcString || typeof lrcString !== "string") return [];
    const lines = [];
    const rawLines = lrcString.split(/\r?\n/);
    const lineTimeExp = /\[(\d{2}):(\d{2})\.?(\d{2,3})?\]/g;
    const wordTimeExp = /<(\d{2}):(\d{2})\.?(\d{2,3})?>([^<]*)/g;

    for (const rawLine of rawLines) {
      lineTimeExp.lastIndex = 0;
      const match = lineTimeExp.exec(rawLine);
      if (!match) continue;

      const minutes = parseInt(match[1], 10);
      const seconds = parseInt(match[2], 10);
      const ms = match[3] ? parseInt(match[3].padEnd(3, "0").slice(0, 3), 10) : 0;
      const lineStartTime = minutes * 60 + seconds + ms / 1000;

      const lineContent = rawLine.replace(/\[\d{2}:\d{2}\.?\d{0,3}\]/g, "").trim();
      if (!lineContent) continue;

      const words = [];
      wordTimeExp.lastIndex = 0;
      let wordMatch;
      let hasWordTimestamps = false;

      while ((wordMatch = wordTimeExp.exec(lineContent)) !== null) {
        hasWordTimestamps = true;
        const wMin = parseInt(wordMatch[1], 10);
        const wSec = parseInt(wordMatch[2], 10);
        const wMs = wordMatch[3] ? parseInt(wordMatch[3].padEnd(3, "0").slice(0, 3), 10) : 0;
        const wStart = wMin * 60 + wSec + wMs / 1000;
        const wText = wordMatch[4].trim();
        if (wText) {
          words.push({
            text: wText,
            startTime: wStart,
            endTime: wStart + 1
          });
        }
      }

      if (!hasWordTimestamps) {
        const cleanText = lineContent.replace(/<[^>]+>/g, "").trim();
        const rawWords = segmentTextIntoWords(cleanText);
        rawWords.forEach(w => {
          words.push({
            text: w,
            startTime: lineStartTime,
            endTime: lineStartTime
          });
        });
      }

      lines.push({
        startTime: lineStartTime,
        text: lineContent.replace(/<[^>]+>/g, "").trim(),
        words: words,
        hasWordTimestamps: hasWordTimestamps
      });
    }

    lines.sort((a, b) => a.startTime - b.startTime);

    const mapped = lines.map((line, idx) => {
      const nextLine = lines[idx + 1];
      const estimatedVocalDuration = Math.min(
        nextLine ? nextLine.startTime - line.startTime : 6.0,
        Math.max(1.8, (line.words ? line.words.length : 4) * 0.42 + 0.6)
      );
      const lineEndTime =
        nextLine && nextLine.startTime - line.startTime > estimatedVocalDuration + 4.5
          ? line.startTime + estimatedVocalDuration
          : nextLine
            ? nextLine.startTime
            : line.startTime + 5.0;

      const lineDuration = Math.max(0.6, lineEndTime - line.startTime);

      if (!line.hasWordTimestamps && line.words.length > 0) {
        const totalChars = line.words.reduce((sum, w) => sum + Math.max(1, w.text.length), 0);
        let accumulatedTime = line.startTime;

        line.words.forEach(w => {
          const wordWeight = Math.max(1, w.text.length) / totalChars;
          const wordDur = lineDuration * wordWeight;
          w.startTime = accumulatedTime;
          w.endTime = accumulatedTime + wordDur;
          accumulatedTime += wordDur;
        });
      } else if (line.hasWordTimestamps && line.words.length > 0) {
        line.words.forEach((w, wIdx) => {
          const nextW = line.words[wIdx + 1];
          w.endTime = nextW ? nextW.startTime : lineEndTime;
        });
      }

      return {
        id: idx,
        startTime: line.startTime,
        endTime: lineEndTime,
        text: line.text || "♪",
        words: line.words.length > 0 ? line.words : [{ text: line.text || "♪", startTime: line.startTime, endTime: lineEndTime }]
      };
    });

    return insertInstrumentalBreaks(mapped);
  }

  function extractArtistName(currentItem, fallbackAuthor) {
    if (currentItem && currentItem.longBylineText && Array.isArray(currentItem.longBylineText.runs)) {
      const artistParts = [];
      for (const run of currentItem.longBylineText.runs) {
        if (!run.text) continue;
        if (run.text.includes("•") || run.text.includes("·")) {
          break;
        }
        const pageType = run.navigationEndpoint?.browseEndpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType;
        if (pageType === "MUSIC_PAGE_TYPE_ALBUM") {
          break;
        }
        artistParts.push(run.text);
      }
      const parsed = artistParts.join("").trim();
      if (parsed) return parsed;
    }
    return fallbackAuthor ? fallbackAuthor.replace(/ - Topic$/i, "").trim() : "";
  }

  function extractAlbumName(currentItem) {
    if (currentItem && currentItem.longBylineText && Array.isArray(currentItem.longBylineText.runs)) {
      for (const run of currentItem.longBylineText.runs) {
        const pageType = run.navigationEndpoint?.browseEndpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType;
        if (pageType === "MUSIC_PAGE_TYPE_ALBUM" && run.text) {
          return run.text.trim();
        }
      }
    }
    return "";
  }

  function cleanTrackTitle(title) {
    if (!title) return "";
    let clean = title;
    if (clean.includes(" - ")) {
      const parts = clean.split(" - ");
      if (parts.length >= 2) {
        clean = parts.slice(1).join(" - ");
      }
    }
    return clean
      .replace(
        /\s*[\(\[](?:official\s+)?(?:music\s+)?(?:video|audio|visualizer|lyric(?:s)?(?:\s+video)?|hd|4k|explicit|remaster(?:ed)?(?:\s+\d{4})?)[^\)\]]*[\)\]]/gi,
        ""
      )
      .replace(/\s*[\(\[]ft\.?[^\)\]]*[\)\]]/gi, "")
      .replace(/\s*[\(\[]feat\.?[^\)\]]*[\)\]]/gi, "")
      .replace(/\s*ft\.?\s+[^\-,]+/gi, "")
      .replace(/\s*feat\.?\s+[^\-,]+/gi, "")
      .replace(/["“”]/g, "")
      .trim();
  }

  function cleanArtistName(artist) {
    if (!artist) return "";
    return artist
      .replace(/ - Topic$/gi, "")
      .replace(/,?\s*(?:ft\.?|feat\.?).*$/gi, "")
      .replace(/\s*•.*$/gi, "")
      .trim();
  }

  async function fetchLyrics(videoId, title, artist, duration, album = "") {
    lyricsData = null;
    renderLoadingState();

    let ytmRawLyrics = null;
    let ytmFooter = "";
    let ytmTimedLyrics = null;

    try {
      if (window.ytcfg && window.ytcfg.get) {
        const apiKey = window.ytcfg.get("INNERTUBE_API_KEY");
        const context = window.ytcfg.get("INNERTUBE_CONTEXT");

        const nextRes = await fetch(`/youtubei/v1/next?key=${apiKey}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ context, videoId })
        });

        if (nextRes.ok) {
          const nextData = await nextRes.json();
          let lyricsBrowseId = null;
          const tabs = nextData?.contents?.singleColumnMusicWatchNextResultsRenderer?.tabbedRenderer?.watchNextTabbedResultsRenderer?.tabs;
          if (Array.isArray(tabs)) {
            for (const tab of tabs) {
              const tabRenderer = tab.tabRenderer;
              if (tabRenderer && tabRenderer.endpoint?.browseEndpoint?.browseId) {
                const bId = tabRenderer.endpoint.browseEndpoint.browseId;
                if (bId.startsWith("MPLYt") || tabRenderer.title === "Lyrics") {
                  lyricsBrowseId = bId;
                  break;
                }
              }
            }
          }

          if (lyricsBrowseId) {
            const browseRes = await fetch(`/youtubei/v1/browse?key=${apiKey}`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ context, browseId: lyricsBrowseId })
            });

            if (browseRes.ok) {
              const browseData = await browseRes.json();
              const section = browseData?.contents?.sectionListRenderer?.contents?.[0];
              if (section?.timedLyricsRenderer?.timedLyricsData?.timedLyrics) {
                ytmTimedLyrics = section.timedLyricsRenderer.timedLyricsData.timedLyrics;
              } else if (section?.musicDescriptionShelfRenderer) {
                const runs = section.musicDescriptionShelfRenderer.description?.runs;
                if (Array.isArray(runs)) {
                  ytmRawLyrics = runs.map(r => r.text).join("");
                }
                const footers = section.musicDescriptionShelfRenderer.footer?.runs;
                if (Array.isArray(footers)) {
                  ytmFooter = footers.map(r => r.text).join("");
                }
              }
            }
          }
        }
      }
    } catch {}

    if (Array.isArray(ytmTimedLyrics) && ytmTimedLyrics.length > 0) {
      const mappedLines = ytmTimedLyrics.map((cue, idx) => {
        const start = parseInt(cue.startTimeMs || cue.cueRange?.startTimeMilliseconds || 0, 10) / 1000;
        const nextCue = ytmTimedLyrics[idx + 1];
        const nextStart = nextCue ? parseInt(nextCue.startTimeMs || nextCue.cueRange?.startTimeMilliseconds || 0, 10) / 1000 : 0;
        const end = parseInt(cue.endTimeMs || cue.cueRange?.endTimeMilliseconds || 0, 10) / 1000 || (nextStart > start ? nextStart : start + 4.5);
        const text = cue.lyricLine || cue.text || "";
        const rawWords = segmentTextIntoWords(text);
        const lineDur = Math.max(0.5, end - start);
        const totalChars = rawWords.reduce((sum, w) => sum + Math.max(1, w.length), 0);
        let accumulated = start;

        const words = rawWords.map(w => {
          const dur = lineDur * (Math.max(1, w.length) / totalChars);
          const wObj = { text: w, startTime: accumulated, endTime: accumulated + dur };
          accumulated += dur;
          return wObj;
        });

        return {
          id: idx,
          startTime: start,
          endTime: end,
          text: text,
          words: words.length > 0 ? words : [{ text: text, startTime: start, endTime: end }]
        };
      });

      const lines = insertInstrumentalBreaks(mappedLines);

      lyricsData = {
        lines: lines,
        isSynced: true,
        provider: "YouTube Music (Timed)",
        footer: ytmFooter || "Lyrics provided by YouTube Music"
      };
      renderLyricsContent();
      return;
    }

    const cleanTitle = cleanTrackTitle(title);
    const cleanArtist = cleanArtistName(artist);
    let lrcSyncedText = null;
    let lrcPlainLyrics = null;

    const titleCandidates = [];
    if (cleanTitle) titleCandidates.push(cleanTitle);
    if (title && title !== cleanTitle && !titleCandidates.includes(title.trim())) titleCandidates.push(title.trim());

    if (title) {
      const parenMatches = title.matchAll(/\(([^)]+)\)|\[([^\]]+)\]/g);
      for (const m of parenMatches) {
        const inside = (m[1] || m[2] || "").trim();
        if (inside && !titleCandidates.includes(inside)) titleCandidates.push(inside);
      }
      const stripped = title.replace(/\s*[\(\[][^\)\]]*[\)\]]/g, "").trim();
      if (stripped && !titleCandidates.includes(stripped)) titleCandidates.push(stripped);
    }

    const artistCandidates = [];
    if (cleanArtist) artistCandidates.push(cleanArtist);
    if (artist && artist !== cleanArtist && !artistCandidates.includes(artist.trim())) artistCandidates.push(artist.trim());

    for (const tCand of titleCandidates) {
      if (lrcSyncedText) break;
      for (const aCand of artistCandidates) {
        if (lrcSyncedText) break;
        try {
          const getUrl = `https://lrclib.net/api/get?track_name=${encodeURIComponent(tCand)}&artist_name=${encodeURIComponent(aCand)}${duration > 0 ? `&duration=${Math.round(duration)}` : ""}`;
          const res = await fetch(getUrl);
          if (res.ok) {
            const data = await res.json();
            if (data?.syncedLyrics) {
              lrcSyncedText = data.syncedLyrics;
              break;
            } else if (!lrcPlainLyrics && data?.plainLyrics) {
              lrcPlainLyrics = data.plainLyrics;
            }
          }
        } catch {}
      }
    }

    if (!lrcSyncedText) {
      for (const tCand of titleCandidates) {
        if (lrcSyncedText) break;
        for (const aCand of artistCandidates) {
          if (lrcSyncedText) break;
          try {
            const searchUrl = `https://lrclib.net/api/search?track_name=${encodeURIComponent(tCand)}&artist_name=${encodeURIComponent(aCand)}`;
            const res = await fetch(searchUrl);
            if (res.ok) {
              const list = await res.json();
              if (Array.isArray(list) && list.length > 0) {
                const syncedList = list.filter(item => item.syncedLyrics);
                if (syncedList.length > 0) {
                  if (duration > 0) {
                    syncedList.sort((a, b) => Math.abs(a.duration - duration) - Math.abs(b.duration - duration));
                  }
                  lrcSyncedText = syncedList[0].syncedLyrics;
                  break;
                } else if (!lrcPlainLyrics && list[0]?.plainLyrics) {
                  lrcPlainLyrics = list[0].plainLyrics;
                }
              }
            }
          } catch {}
        }
      }
    }

    if (!lrcSyncedText) {
      for (const tCand of titleCandidates) {
        if (lrcSyncedText) break;
        try {
          const queryStr = cleanArtist ? `${tCand} ${cleanArtist}` : tCand;
          const searchUrl = `https://lrclib.net/api/search?q=${encodeURIComponent(queryStr)}`;
          const res = await fetch(searchUrl);
          if (res.ok) {
            const list = await res.json();
            if (Array.isArray(list) && list.length > 0) {
              const syncedList = list.filter(item => item.syncedLyrics);
              if (syncedList.length > 0) {
                if (duration > 0) {
                  syncedList.sort((a, b) => Math.abs(a.duration - duration) - Math.abs(b.duration - duration));
                }
                lrcSyncedText = syncedList[0].syncedLyrics;
                break;
              } else if (!lrcPlainLyrics && list[0]?.plainLyrics) {
                lrcPlainLyrics = list[0].plainLyrics;
              }
            }
          }
        } catch {}
      }
    }

    if (lrcSyncedText) {
      const lines = parseLRC(lrcSyncedText);
      if (lines.length > 0) {
        lyricsData = {
          lines: lines,
          isSynced: true,
          provider: "YouTube Music & LRCLIB",
          footer: ytmFooter ? `${ytmFooter} • Synced via LRCLIB` : "Synced lyrics via LRCLIB"
        };
        renderLyricsContent();
        return;
      }
    }

    const fallbackLyrics = ytmRawLyrics || lrcPlainLyrics;
    if (fallbackLyrics) {
      const rawLines = fallbackLyrics.split(/\r?\n/).filter(l => l.trim().length > 0);
      const lines = rawLines.map((text, idx) => ({
        id: idx,
        startTime: -1,
        endTime: -1,
        text: text,
        words: [{ text: text, startTime: -1, endTime: -1 }]
      }));

      lyricsData = {
        lines: lines,
        isSynced: false,
        provider: "YouTube Music (Plain)",
        footer: ytmFooter || "Lyrics provided by YouTube Music / LyricFind"
      };
      renderLyricsContent();
      return;
    }

    renderEmptyState();
  }

  function createEl(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined && text !== null) el.textContent = text;
    return el;
  }

  function createIcon(iconName) {
    const span = document.createElement("span");
    span.className = "material-symbols-outlined";
    span.textContent = iconName;
    return span;
  }

  function clearChildren(el) {
    if (el) {
      while (el.firstChild) {
        el.removeChild(el.firstChild);
      }
    }
  }

  function renderLoadingState() {
    if (!scrollContent) return;
    if (badgeEl) {
      clearChildren(badgeEl);
      badgeEl.textContent = "Loading...";
    }
    clearChildren(scrollContent);
    const status = createEl("div", "ytmd-lyrics-status loading");
    status.appendChild(createIcon("sync"));
    status.appendChild(createEl("p", null, "Fetching lyrics from YouTube Music..."));
    scrollContent.appendChild(status);
  }

  function renderEmptyState() {
    if (!scrollContent) return;
    if (badgeEl) {
      clearChildren(badgeEl);
      badgeEl.textContent = "Unavailable";
    }
    clearChildren(scrollContent);
    const status = createEl("div", "ytmd-lyrics-status");
    status.appendChild(createIcon("music_off"));
    status.appendChild(createEl("p", null, "No lyrics found for this song."));
    scrollContent.appendChild(status);
  }

  function updateBadgeText() {
    if (!badgeEl) return;
    clearChildren(badgeEl);
    if (!lyricsData) {
      badgeEl.textContent = "Loading...";
      return;
    }
    if (!lyricsData.lines || lyricsData.lines.length === 0) {
      badgeEl.textContent = "Unavailable";
      return;
    }
    if (!lyricsData.isSynced) {
      badgeEl.textContent = lyricsData.provider || "Plain Lyrics";
      return;
    }

    if (syncMode === "karaoke") {
      badgeEl.appendChild(document.createTextNode("Live Karaoke "));
      const betaTag = createEl("span", "ytmd-beta-tag", "BETA");
      badgeEl.appendChild(betaTag);
    } else {
      badgeEl.textContent = "Time-Synced";
    }
  }

  function renderLyricsContent() {
    if (!scrollContent || !lyricsData || !lyricsData.lines) return;

    updateBadgeText();
    clearChildren(scrollContent);

    lyricsData.lines.forEach(line => {
      const lineClass = lyricsData.isSynced ? `ytmd-lyric-line future${line.isInstrumental ? " instrumental" : ""}` : "ytmd-lyric-line plain";
      const lineEl = createEl("div", lineClass);
      lineEl.dataset.id = line.id.toString();
      lineEl.dataset.time = line.startTime.toString();

      if (line.isInstrumental) {
        const noteContainer = createEl("div", "ytmd-instrumental-container");
        const n1 = createIcon("music_note");
        n1.className = "material-symbols-outlined ytmd-instrumental-note";
        const n2 = createIcon("music_note");
        n2.className = "material-symbols-outlined ytmd-instrumental-note";
        const n3 = createIcon("music_note");
        n3.className = "material-symbols-outlined ytmd-instrumental-note";
        noteContainer.appendChild(n1);
        noteContainer.appendChild(n2);
        noteContainer.appendChild(n3);
        lineEl.appendChild(noteContainer);
      } else if (lyricsData.isSynced && line.words && line.words.length > 0) {
        line.words.forEach((word, wIdx) => {
          const wordSpan = createEl("span", "ytmd-lyric-word word-upcoming", word.text);
          wordSpan.dataset.wordId = wIdx.toString();
          lineEl.appendChild(wordSpan);
          if (wIdx < line.words.length - 1) {
            lineEl.appendChild(document.createTextNode(" "));
          }
        });
      } else {
        lineEl.textContent = line.text;
      }

      if (lyricsData.isSynced && line.startTime >= 0) {
        lineEl.addEventListener("click", () => {
          const playerBar = document.querySelector("ytmusic-app-layout>ytmusic-player-bar");
          if (playerBar && playerBar.playerApi) {
            playerBar.playerApi.seekTo(line.startTime, true);
            if (!playerBar.playing) {
              playerBar.playerApi.playVideo();
            }
          }
          userIsScrolling = false;
          if (syncButton) syncButton.classList.add("hidden");
          updateActiveLine(line.id, true);
        });
      }

      scrollContent.appendChild(lineEl);
    });

    if (lyricsData.footer) {
      const footerEl = createEl("div", "ytmd-lyrics-footer", lyricsData.footer);
      scrollContent.appendChild(footerEl);
    }

    activeLineIndex = -1;
    if (lyricsData.isSynced) {
      updateSync();
    }
  }

  function updateActiveLine(newIdx, forceScroll = false) {
    if (!scrollContent || !lyricsData || !lyricsData.lines) return;

    if (newIdx !== activeLineIndex || forceScroll) {
      const lineEls = scrollContent.querySelectorAll(".ytmd-lyric-line");

      lineEls.forEach((el, idx) => {
        el.classList.remove("active", "past", "future");
        const wordEls = el.querySelectorAll(".ytmd-lyric-word");
        if (idx === newIdx) {
          el.classList.add("active");
        } else if (idx < newIdx) {
          el.classList.add("past");
          wordEls.forEach(wEl => {
            wEl.classList.remove("word-active", "word-upcoming");
            wEl.classList.add("word-sung");
          });
        } else {
          el.classList.add("future");
          wordEls.forEach(wEl => {
            wEl.classList.remove("word-active", "word-sung");
            wEl.classList.add("word-upcoming");
          });
        }
      });

      activeLineIndex = newIdx;

      if (newIdx >= 0 && (!userIsScrolling || forceScroll)) {
        const activeEl = lineEls[newIdx];
        if (activeEl && scrollContainer) {
          isProgrammaticScroll = true;
          const containerHeight = scrollContainer.clientHeight;
          const targetTop = activeEl.offsetTop - containerHeight * 0.38;
          scrollContainer.scrollTo({
            top: Math.max(0, targetTop),
            behavior: "smooth"
          });
          setTimeout(() => {
            isProgrammaticScroll = false;
          }, 300);
        }
      }
    }
  }

  function updateSync() {
    if (!isOpen || !lyricsData || !lyricsData.lines || lyricsData.lines.length === 0) return;

    const playerBar = document.querySelector("ytmusic-app-layout>ytmusic-player-bar");
    const videoEl = document.querySelector("video");
    const isPlaying = videoEl ? !videoEl.paused && !videoEl.ended : playerBar ? !!playerBar.playing : false;
    if (lyricsOverlay) {
      lyricsOverlay.classList.toggle("is-paused", !isPlaying);
    }

    if (!lyricsData.isSynced) return;

    const rawTime =
      videoEl && !isNaN(videoEl.currentTime) && videoEl.currentTime > 0
        ? videoEl.currentTime
        : playerBar && playerBar.playerApi && playerBar.playerApi.getCurrentTime
          ? playerBar.playerApi.getCurrentTime()
          : 0;

    const SYNC_LEAD_TIME = 0.22;
    const currentTime = rawTime + SYNC_LEAD_TIME;

    const lines = lyricsData.lines;

    let targetIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const nextLine = lines[i + 1];
      if (currentTime >= line.startTime && (!nextLine || currentTime < nextLine.startTime)) {
        targetIdx = i;
        break;
      }
    }

    if (targetIdx !== activeLineIndex) {
      updateActiveLine(targetIdx);
    }

    if (syncMode === "karaoke" && targetIdx >= 0 && scrollContent) {
      const activeLineData = lines[targetIdx];
      const activeEl = scrollContent.querySelector(`.ytmd-lyric-line[data-id="${targetIdx}"]`);
      if (activeEl && activeLineData && activeLineData.words && activeLineData.words.length > 0) {
        const wordEls = activeEl.querySelectorAll(".ytmd-lyric-word");
        for (let wIdx = 0; wIdx < activeLineData.words.length; wIdx++) {
          const w = activeLineData.words[wIdx];
          const wordEl = wordEls[wIdx];
          if (!wordEl) continue;

          if (currentTime >= w.endTime) {
            if (!wordEl.classList.contains("word-sung")) {
              wordEl.classList.remove("word-active", "word-upcoming");
              wordEl.classList.add("word-sung");
            }
          } else if (currentTime >= w.startTime && currentTime < w.endTime) {
            if (!wordEl.classList.contains("word-active")) {
              wordEl.classList.remove("word-sung", "word-upcoming");
              wordEl.classList.add("word-active");
            }
          } else {
            if (!wordEl.classList.contains("word-upcoming")) {
              wordEl.classList.remove("word-sung", "word-active");
              wordEl.classList.add("word-upcoming");
            }
          }
        }
      }
    }
  }

  function updateSyncModeButton() {
    if (!syncModeBtn) return;
    clearChildren(syncModeBtn);
    if (syncMode === "karaoke") {
      syncModeBtn.title = "Mode: Live Karaoke (Beta). Click to switch to Time-Synced";
      syncModeBtn.appendChild(createIcon("mic"));
    } else {
      syncModeBtn.title = "Mode: Time-Synced. Click to switch to Live Karaoke (Beta)";
      syncModeBtn.appendChild(createIcon("segment"));
    }
    updateBadgeText();
  }

  function startSyncLoop() {
    if (syncInterval) return;
    function loop() {
      if (!isOpen) {
        syncInterval = null;
        return;
      }
      updateSync();
      syncInterval = requestAnimationFrame(loop);
    }
    syncInterval = requestAnimationFrame(loop);
  }

  function stopSyncLoop() {
    if (syncInterval) {
      cancelAnimationFrame(syncInterval);
      syncInterval = null;
    }
  }

  function createLyricsOverlay() {
    if (lyricsOverlay) return;

    lyricsOverlay = createEl("div", `ytmd-lyrics-overlay hidden mode-${syncMode}`);
    if (lyricsSettings.liveLyricsFontSize) {
      lyricsOverlay.style.setProperty("--ytmd-lyric-font-size", `${lyricsSettings.liveLyricsFontSize}px`);
    }

    const bg = createEl("div", "ytmd-lyrics-bg");
    const bgMesh = createEl("div", "ytmd-lyrics-bg-mesh");
    if (lyricsSettings.liveLyricsGradientBg === false) {
      bgMesh.style.display = "none";
    }
    const bgOverlay = createEl("div", "ytmd-lyrics-bg-overlay");
    bg.appendChild(bgMesh);
    bg.appendChild(bgOverlay);
    lyricsOverlay.appendChild(bg);

    const header = createEl("div", "ytmd-lyrics-header");

    const trackInfo = createEl("div", "ytmd-lyrics-track-info");
    artEl = createEl("img", "ytmd-lyrics-track-art");
    artEl.src = "";
    artEl.alt = "Album Art";

    const trackMeta = createEl("div", "ytmd-lyrics-track-meta");
    titleEl = createEl("span", "ytmd-lyrics-track-title");
    artistEl = createEl("span", "ytmd-lyrics-track-artist");
    trackMeta.appendChild(titleEl);
    trackMeta.appendChild(artistEl);

    trackInfo.appendChild(artEl);
    trackInfo.appendChild(trackMeta);
    header.appendChild(trackInfo);

    const controls = createEl("div", "ytmd-lyrics-header-controls");
    badgeEl = createEl("span", "ytmd-lyrics-badge");
    updateBadgeText();

    syncModeBtn = createEl("button", "ytmd-lyrics-header-btn ytmd-mode-btn");
    updateSyncModeButton();
    syncModeBtn.addEventListener("click", () => {
      syncMode = syncMode === "karaoke" ? "line" : "karaoke";
      localStorage.setItem("ytmd_lyrics_sync_mode", syncMode);
      lyricsOverlay.classList.remove("mode-karaoke", "mode-line");
      lyricsOverlay.classList.add(`mode-${syncMode}`);
      updateSyncModeButton();
      if (activeLineIndex >= 0) {
        updateActiveLine(activeLineIndex, true);
      }
    });

    fontSizeBtn = createEl("button", "ytmd-lyrics-header-btn ytmd-font-btn");
    fontSizeBtn.title = `Change Font Size (${lyricsSettings.liveLyricsFontSize || 32}px)`;
    fontSizeBtn.appendChild(createIcon("format_size"));

    fullscreenBtn = createEl("button", "ytmd-lyrics-header-btn ytmd-fs-btn");
    fullscreenBtn.title = "Toggle Fullscreen (F)";
    fullscreenBtn.appendChild(createIcon("fullscreen"));

    closeBtn = createEl("button", "ytmd-lyrics-header-btn ytmd-close-btn");
    closeBtn.title = "Close Lyrics (Esc)";
    closeBtn.appendChild(createIcon("close"));

    controls.appendChild(badgeEl);
    controls.appendChild(syncModeBtn);
    controls.appendChild(fontSizeBtn);
    controls.appendChild(fullscreenBtn);
    controls.appendChild(closeBtn);
    header.appendChild(controls);

    lyricsOverlay.appendChild(header);

    scrollContainer = createEl("div", "ytmd-lyrics-scroll-container");
    scrollContent = createEl("div", "ytmd-lyrics-scroll-content");
    scrollContainer.appendChild(scrollContent);
    lyricsOverlay.appendChild(scrollContainer);

    syncButton = createEl("button", "ytmd-lyrics-sync-btn hidden");
    syncButton.title = "Scroll to currently playing line";
    syncButton.appendChild(createIcon("sync"));
    const syncText = createEl("span", null, "Sync with music");
    syncButton.appendChild(syncText);
    lyricsOverlay.appendChild(syncButton);

    document.body.appendChild(lyricsOverlay);

    closeBtn.addEventListener("click", () => {
      toggleLyrics(false);
    });

    fontSizeBtn.addEventListener("click", () => {
      const presetSizes = [24, 32, 40, 48];
      let currentSize = lyricsSettings.liveLyricsFontSize || 32;
      let nextIdx = 0;
      for (let i = 0; i < presetSizes.length; i++) {
        if (presetSizes[i] > currentSize) {
          nextIdx = i;
          break;
        }
      }
      lyricsSettings.liveLyricsFontSize = presetSizes[nextIdx];
      lyricsOverlay.style.setProperty("--ytmd-lyric-font-size", `${lyricsSettings.liveLyricsFontSize}px`);
      fontSizeBtn.title = `Change Font Size (${lyricsSettings.liveLyricsFontSize}px)`;
      if (activeLineIndex >= 0) {
        updateActiveLine(activeLineIndex, true);
      }
    });

    fullscreenBtn.addEventListener("click", () => {
      isFullscreen = !isFullscreen;
      const fsIcon = fullscreenBtn.querySelector(".material-symbols-outlined");
      if (isFullscreen) {
        lyricsOverlay.classList.add("fullscreen");
        if (fsIcon) fsIcon.textContent = "fullscreen_exit";
      } else {
        lyricsOverlay.classList.remove("fullscreen");
        if (fsIcon) fsIcon.textContent = "fullscreen";
      }
    });

    syncButton.addEventListener("click", () => {
      userIsScrolling = false;
      syncButton.classList.add("hidden");
      if (activeLineIndex >= 0) {
        updateActiveLine(activeLineIndex, true);
      }
    });

    scrollContainer.addEventListener("scroll", () => {
      if (isProgrammaticScroll) return;
      userIsScrolling = true;
      syncButton.classList.remove("hidden");

      if (userScrollTimeout) clearTimeout(userScrollTimeout);
      userScrollTimeout = setTimeout(() => {
        userIsScrolling = false;
        syncButton.classList.add("hidden");
      }, 4000);
    });
  }

  function injectPlayerBarButton() {
    const playerBar = document.querySelector("ytmusic-app-layout>ytmusic-player-bar");
    if (!playerBar) return;

    const rightControls = playerBar.querySelector(".right-controls-buttons");
    if (!rightControls) return;

    if (document.querySelector(".ytmd-lyrics-button")) return;

    lyricsButton = document.createElement("yt-icon-button");
    lyricsButton.className = "ytmusic-player-bar ytmd-player-bar-control lyrics-button ytmd-lyrics-button";
    lyricsButton.setAttribute("title", "Live Lyrics (L)");
    if (lyricsSettings.liveLyricsEnabled === false) {
      lyricsButton.style.display = "none";
    }

    const icon = createIcon("mic");
    lyricsButton.appendChild(icon);

    lyricsButton.addEventListener("click", () => {
      toggleLyrics();
    });

    const sleepTimer = rightControls.querySelector(".sleep-timer-button");
    if (sleepTimer) {
      sleepTimer.insertAdjacentElement("afterend", lyricsButton);
    } else {
      const shuffleBtn = rightControls.querySelector(".shuffle");
      if (shuffleBtn) {
        shuffleBtn.insertAdjacentElement("afterend", lyricsButton);
      } else {
        rightControls.prepend(lyricsButton);
      }
    }
  }

  function toggleLyrics(forcedState) {
    isOpen = typeof forcedState === "boolean" ? forcedState : !isOpen;

    if (isOpen) {
      lyricsOverlay.classList.remove("hidden");
      if (lyricsButton) lyricsButton.classList.add("active");
      startSyncLoop();
      updateTrackInfo();
      if (!lyricsData || lyricsData.lines.length === 0) {
        fetchLyrics(currentVideoId, currentTitle, currentArtist, currentDuration, currentAlbum);
      } else {
        updateActiveLine(activeLineIndex, true);
      }
    } else {
      lyricsOverlay.classList.add("hidden");
      if (lyricsButton) lyricsButton.classList.remove("active");
      stopSyncLoop();
    }
  }

  function updateTrackInfo() {
    if (!titleEl || !artistEl || !artEl) return;
    titleEl.textContent = currentTitle || "Unknown Track";
    artistEl.textContent = currentArtist || "Unknown Artist";
    artEl.src = currentThumbnail || "";
    artEl.style.display = currentThumbnail ? "block" : "none";
    extractPalette(currentThumbnail);
  }

  function hookTrackDataEvents() {
    const playerBar = document.querySelector("ytmusic-app-layout>ytmusic-player-bar");
    if (!playerBar || !playerBar.playerApi) return;

    playerBar.playerApi.addEventListener("onVideoDataChange", event => {
      if (event.playertype === 1 && (event.type === "dataloaded" || event.type === "dataupdated")) {
        const response = playerBar.playerApi.getPlayerResponse();
        const videoDetails = response?.videoDetails;
        const currentItem = playerBar.currentItem;

        if (videoDetails) {
          const newVideoId = videoDetails.videoId;
          const title = currentItem?.title?.runs?.map(r => r.text).join("") || videoDetails.title || "";
          const artist = extractArtistName(currentItem, videoDetails.author);
          const album = extractAlbumName(currentItem);
          const thumbnail = currentItem?.thumbnail?.thumbnails?.slice(-1)[0]?.url || videoDetails?.thumbnail?.thumbnails?.slice(-1)[0]?.url || "";
          const duration = parseInt(videoDetails.lengthSeconds, 10) || 0;

          if (newVideoId !== currentVideoId) {
            currentVideoId = newVideoId;
            currentTitle = title;
            currentArtist = artist;
            currentAlbum = album;
            currentThumbnail = thumbnail;
            currentDuration = duration;
            updateTrackInfo();
            if (isOpen) {
              fetchLyrics(currentVideoId, currentTitle, currentArtist, currentDuration, currentAlbum);
            } else {
              lyricsData = null;
            }
          }
        }
      }
    });

    playerBar.playerApi.addEventListener("onVideoProgress", () => {
      if (isOpen) {
        updateSync();
      }
    });
  }

  window.addEventListener("keydown", e => {
    const target = e.target;
    if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable || (target.closest && target.closest("ytmusic-search-box"))) {
      return;
    }

    if (e.key === "l" || e.key === "L") {
      toggleLyrics();
    } else if (e.key === "Escape" && isOpen) {
      toggleLyrics(false);
    }
  });

  window.addEventListener("ytmd:toggleLyrics", () => {
    toggleLyrics();
  });

  window.addEventListener("ytmd:lyricsSettingsChanged", e => {
    if (e && e.detail) {
      applyLyricsSettings(e.detail);
    }
  });

  if (window.__YTMD_LYRICS_SETTINGS__) {
    applyLyricsSettings(window.__YTMD_LYRICS_SETTINGS__);
  }

  createLyricsStyles();
  createLyricsOverlay();
  injectPlayerBarButton();
  hookTrackDataEvents();

  const initInterval = setInterval(() => {
    injectPlayerBarButton();
    hookTrackDataEvents();
    if (lyricsButton && document.querySelector("ytmusic-app-layout>ytmusic-player-bar")) {
      clearInterval(initInterval);
    }
  }, 1000);
});
