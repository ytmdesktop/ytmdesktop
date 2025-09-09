import { webFrame } from "electron";
import playerBarControlsScript from "../scripts/playerbarcontrols.script?raw";
import timedLyricsScript from "../scripts/timedlyrics.script?raw";

export function overrideHistoryButtonDisplay() {
  document.querySelector<HTMLElement>("#history-link .history-button").style = "display: inline-block !important;";
}

export async function hideChromecastButton() {
  (
    await webFrame.executeJavaScript(`
      (function() {
        window.__YTMD_HOOK__.ytmStore.dispatch({ type: 'SET_CAST_AVAILABLE', payload: false });
      })
    `)
  )();
}

export async function createAdditionalPlayerBarControls() {
  (await webFrame.executeJavaScript(playerBarControlsScript))();
}

export async function addTimedLyrics() {
  (await webFrame.executeJavaScript(timedLyricsScript))();
}
