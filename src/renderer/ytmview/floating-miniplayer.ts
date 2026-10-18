import { ipcRenderer } from "electron";

/**
 * The YouTube Music miniplayer button only docks the video inside the page.
 * Picture-in-picture has to start in the click turn. Awaiting another API
 * first drops the user gesture and the request is rejected.
 */
export function installFloatingMiniplayer(): void {
  let resumeAfterHide = false;

  document.addEventListener(
    "click",
    event => {
      if (!event.composedPath().some(isMiniplayerControl)) return;
      event.preventDefault();
      event.stopPropagation();
      togglePictureInPicture();
    },
    true
  );

  document.addEventListener(
    "keydown",
    event => {
      if (event.key.toLowerCase() !== "i" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || target.matches("input, textarea"))) return;
      if (!findVideo()) return;
      event.preventDefault();
      event.stopPropagation();
      togglePictureInPicture();
    },
    true
  );

  document.addEventListener("enterpictureinpicture", () => {
    resumeAfterHide = true;
    ipcRenderer.send("miniplayer:pip", true);
  });
  document.addEventListener("leavepictureinpicture", () => {
    resumeAfterHide = false;
    ipcRenderer.send("miniplayer:pip", false);
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && document.pictureInPictureElement) resumeAfterHide = true;
  });
  document.addEventListener(
    "pause",
    event => {
      const video = event.target;
      if (!(video instanceof HTMLVideoElement) || document.pictureInPictureElement !== video) return;
      if (!resumeAfterHide || document.visibilityState !== "hidden") return;
      resumeAfterHide = false;
      void video.play();
    },
    true
  );
}

function togglePictureInPicture(): void {
  const video = findVideo();
  if (!video) return;
  video.disablePictureInPicture = false;
  if (document.pictureInPictureElement === video) {
    void document.exitPictureInPicture();
    return;
  }
  void video.requestPictureInPicture();
}

function isMiniplayerControl(node: EventTarget | null): boolean {
  if (!(node instanceof Element)) return false;
  const className = node.getAttribute("class") ?? "";
  if (/\bytp-miniplayer-button\b|\bminiplayer-button\b|\bmini-player-button\b/.test(className)) return true;
  const label =
    `${node.getAttribute("aria-label") ?? ""} ${node.getAttribute("title") ?? ""} ${node.getAttribute("data-title-no-tooltip") ?? ""}`.toLowerCase();
  if (!label.trim()) return false;
  if (/minimizar|minimize/.test(label) && !/miniplayer|minirreprodutor|picture|imagem/.test(label)) return false;
  return /miniplayer|mini player|minirreprodutor|picture-in-picture|picture in picture|imagem em imagem/.test(label);
}

function findVideo(): HTMLVideoElement | null {
  const videos: HTMLVideoElement[] = [];
  const collect = (root: ParentNode) => {
    root.querySelectorAll("video").forEach(video => videos.push(video));
    root.querySelectorAll("*").forEach(element => {
      if (element.shadowRoot) collect(element.shadowRoot);
    });
  };
  collect(document);
  return (
    videos.find(video => video.readyState > 0 && video.videoWidth > 0 && !video.paused) ??
    videos.find(video => video.readyState > 0 && video.videoWidth > 0) ??
    videos[0] ??
    null
  );
}
