const { ipcRenderer } = require("electron");

let animationId;
let mouseX;
let mouseY;

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

  ipcRenderer.on("windowMoving", (e, { mouseX, mouseY }) => {
    const { x, y } = electron.screen.getCursorScreenPoint();
    this.win.setPosition(x - mouseX, y - mouseY);
  });

  ipcRenderer.on("windowMoved", () => {
    // Do somehting when dragging stop
  });
}

function setPlayerInfo(data) {
  document.title = `${data.track.title} - ${data.track.author}`;
  body.style.backgroundImage = `url(${data.track.cover})`;
  title.innerHTML = data.track.title || "Title";
  author.innerHTML = data.track.author || "Author";
  current.innerHTML = data.player.seekbarCurrentPositionHuman || "0:00";
  duration.innerHTML = data.track.durationHuman || "0:00";
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

function onMouseDown(e) {
  console.log("down");
  mouseX = e.clientX;
  mouseY = e.clientY;
  document.addEventListener("mouseup", onMouseUp);
  requestAnimationFrame(this.moveWindow);
}

function onMouseUp(e) {
  console.log("up");
  ipcRenderer.send("windowMoved");
  document.removeEventListener("mouseup", onMouseUp);
  cancelAnimationFrame(animationId);
}

function moveWindow() {
  console.log("move");
  ipcRenderer.send("windowMoving", {
    mouseX,
    mouseY
  });
  animationId = requestAnimationFrame(moveWindow);
}
