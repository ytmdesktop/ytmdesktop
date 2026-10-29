export function createStyleSheet() {
  const css = document.createElement("style");
  css.appendChild(
    document.createTextNode(`
      .ytmd-history-back, .ytmd-history-forward {
        cursor: pointer;
        margin: 0 18px 0 2px;
        font-size: 24px;
        color: rgba(255, 255, 255, 0.5);
      }

      .ytmd-history-back.pivotbar, .ytmd-history-forward.pivotbar {
        padding-top: 12px;
      }

      .ytmd-history-back.disabled, .ytmd-history-forward.disabled {
        cursor: not-allowed;
      }

      .ytmd-history-back:hover:not(.disabled), .ytmd-history-forward:hover:not(.disabled) {
        color: #FFFFFF;
      }

      .ytmd-hidden {
        display: none;
      }

      .ytmd-persist-volume-slider {
        opacity: 1 !important;
        pointer-events: initial !important;
      }
      
      .ytmd-player-bar-control.library-button {
        margin-left: 8px;
      }

      .ytmd-player-bar-control.library-button.hidden {
        display: none;
      }

      .ytmd-player-bar-control.playlist-button {
        margin-left: 8px;
      }

      .ytmd-player-bar-control.playlist-button.hidden {
        display: none;
      }

      .ytmd-player-bar-control.sleep-timer-button.active {
        color: #FFFFFF;
      }

      .ytmd-lyrics {
        margin-top: 16px;
      }

      .ytmd-lyrics .ytmd-lyric-line {
        font-size: 24px;
        color: rgba(255, 255, 255, 0.7);
        cursor: pointer;
      }
        
      .ytmd-lyrics .ytmd-lyric-line.active {
        color: rgba(255, 255, 255, 1);
      }

      .ytmd-lyrics .ytmd-lyric-line {
        margin-bottom: 16px;
      }

      .ytmd-lyrics .ytmd-lyric-line:last-child {
        margin-bottom: 24px;
      }

      .ytmd-lyrics-source {
        font-size: 14px;
        color: rgba(255, 255, 255, 0.7);
        margin-bottom: 16px;
      }

      .ytmd-lyrics-ytmdnote {
        font-size: 14px;
        color: rgba(255, 255, 255, 0.7);
        margin-bottom: 128px;
      }

      /* This makes sure the return live button is positioned properly */
      .ytmusic-tab-renderer[page-type='MUSIC_PAGE_TYPE_TRACK_LYRICS'] > #contents {
        position: relative;
      }

      .ytmd-lyrics-return-live-container {
        position: sticky;
        bottom: 24px;
        display: flex;
        justify-content: center;
        align-items: center;
      }
    `)
  );
  document.head.appendChild(css);
}

export function createMaterialSymbolsLink() {
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,100,0,0";
  return link;
}
