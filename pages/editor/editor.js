const { ipcRenderer } = require("electron");
const path = require("electron").remote.require("path");
const fs = require("electron").remote.require("fs");
const __ = require("../../providers/translateProvider");
const themePath = path.join(__dirname, "../../assets/custom-theme.css");
var editor;

const textEditor = document.getElementById("editor");
const btnSave = document.getElementById("btn-save");

__.loadi18n();

if (fs.existsSync(themePath)) {
  textEditor.innerHTML = fs.readFileSync(themePath).toString();
}

if (btnSave) {
  btnSave.addEventListener("click", function() {
    var code = editor.getValue();
    fs.writeFileSync(themePath, code);
    ipcRenderer.send("update-custom-theme");
  });
}

document.addEventListener("DOMContentLoaded", function() {
  editor = ace.edit("editor");
  editor.setTheme("ace/theme/twilight");
  editor.session.setMode("ace/mode/css");
});
