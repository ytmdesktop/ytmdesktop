const { ipcRenderer } = require("electron");

const body = document.getElementsByTagName("body")[0];
const title = document.getElementById("title");
const author = document.getElementById("author");

const current = document.getElementById("current");
const duration = document.getElementById("duration");
const progress = document.getElementById("progress");

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
  body.classList.toggle("paused");
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
  }, 900);

  ipcRenderer.on("song-playing-now-is", (e, data) => {
    setPlayerInfo(data);
  });
}

function setPlayerInfo(data) {
  body.style.backgroundImage = `url(${data.track.cover})`;
  title.innerHTML = data.track.title;
  author.innerHTML = data.track.author;
  current.innerHTML = data.player.seekbarCurrentPositionHuman;
  duration.innerHTML = data.track.durationHuman;
  progress.style.width = data.track.statePercent * 200;

  if (data.player.isPaused) {
    btnPlayPause.children[0].innerHTML = "play_arrow";
    body.classList.add("paused");
  } else {
    btnPlayPause.children[0].innerHTML = "pause";
    body.classList.remove("paused");
  }

  switch (data.player.likeStatus) {
    case "LIKE":
      btnLike.children[0].classList.remove("outlined");
      btnDislike.children[0].classList.add("outlined");
      break;

    case "DISLIKE":
      btnLike.children[0].classList.add("outlined");
      btnDislike.children[0].classList.remove("outlined");
      break;

    case "INDIFFERENT":
      btnLike.children[0].classList.add("outlined");
      btnDislike.children[0].classList.add("outlined");
      break;
  }
}
