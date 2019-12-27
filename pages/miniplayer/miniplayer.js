const { ipcRenderer } = require("electron");

const coverbg = document.getElementById("cover-bg");

const btnClose = document.getElementById("btn-close");
const btnDislike = document.getElementById("btn-dislike");
const btnPrevious = document.getElementById("btn-previous");
const btnPlayPause = document.getElementById("btn-play-pause");
const btnNext = document.getElementById("btn-next");
const btnLike = document.getElementById("btn-like");

btnClose.addEventListener("click", () => {
  ipcRenderer.send("restore-main-window");
  window.close();
});

btnDislike.addEventListener("click", () => {
  ipcRenderer.send("media-down-vote", true);
});

btnPrevious.addEventListener("click", () => {
  ipcRenderer.send("media-previous-track", true);
});

btnPlayPause.addEventListener("click", () => {
  ipcRenderer.send("media-play-pause", true);
});

btnNext.addEventListener("click", () => {
  ipcRenderer.send("media-next-track", true);
});

btnLike.addEventListener("click", () => {
  ipcRenderer.send("media-up-vote", true);
});

init();

function init() {
  setInterval(() => {
    ipcRenderer.send("what-is-song-playing-now");
  }, 1000);

  ipcRenderer.on("song-playing-now-is", (e, data) => {
    // console.log(data);
    setBackgroundCover(data.track.cover);
  });
}

function setBackgroundCover(cover) {
  coverbg.style.backgroundImage = `url(${cover})`;
}
