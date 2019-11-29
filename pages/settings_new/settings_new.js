const { remote, ipcRenderer: ipc } = require("electron");
const electronStore = require("electron-store");
const store = new electronStore();
const __ = require("../../providers/translateProvider");
const {
  companionUrl,
  companionWindowTitle,
  companionWindowSettings
} = require("../../server.config");

__.loadi18n();
// remote.getCurrentWebContents().openDevTools();

document.addEventListener("DOMContentLoaded", function() {
  M.FormSelect.init(document.querySelectorAll("select"), {});
  M.Tabs.init(document.getElementsByClassName("tabs")[0], {});
});

document.getElementById("btn-close").addEventListener("click", function() {
  window.close();
});

if (process.platform !== "darwin") {
  const macSpecificNodes = document.getElementsByClassName("macos-specific");
  for (let i = 0; i < macSpecificNodes.length; i++) {
    macSpecificNodes.item(i).style.display = "none";
  }
}

function relaunch() {
  remote.app.relaunch();
  remote.app.exit(0);
}
