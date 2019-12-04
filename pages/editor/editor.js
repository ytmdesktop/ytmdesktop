const { ipcRenderer } = require("electron");
const path = require("path");
const fs = require("fs");
const __ = require("../../providers/translateProvider");
const themePath = path.join(__dirname, "../../assets/custom-theme.css");

const textEditor = document.getElementById("editor");
const btnSave = document.getElementById("save");
const btnClose = document.getElementById("btn-close");

__.loadi18n();

if (fs.existsSync(themePath)) {
  textEditor.innerHTML = fs.readFileSync(themePath).toString();
}

if (btnSave) {
  btnSave.addEventListener("click", function() {
    fs.writeFileSync(themePath, textEditor.value);
    ipcRenderer.send("update-custom-theme");
  });
}

if (btnClose) {
  btnClose.addEventListener("click", function() {
    window.close();
  });
}
