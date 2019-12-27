const { ipcRenderer } = require("electron");

const coverbg = document.getElementById("cover-bg");
const buttonClose = document.getElementById("btn-close");

buttonClose.addEventListener("click", () => {
  ipcRenderer.send("restore-main-window");
  window.close();
});

init();

function init() {
  setInterval(() => {
    ipcRenderer.send("what-is-song-playing-now");
  }, 500);

  ipcRenderer.on("song-playing-now-is", (e, data) => {
    console.log(data);
    setBackgroundCover(data.track.cover);
  });
}

function setBackgroundCover(cover) {
  coverbg.style.backgroundImage = `url(${cover})`;
}
