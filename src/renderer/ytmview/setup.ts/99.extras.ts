export function overrideHistoryButtonDisplay() {
  // @ts-expect-error Style is reported as readonly but this still works
  document.querySelector<HTMLElement>("#history-link tp-yt-paper-icon-button").style = "display: inline-block !important;";
}
