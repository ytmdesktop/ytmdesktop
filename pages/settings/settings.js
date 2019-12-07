const { remote, ipcRenderer: ipc } = require("electron");
const settingsProvider = require("../../providers/settingsProvider");
const __ = require("../../providers/translateProvider");
const scrobblerProvider = require("../../providers/scrobblerProvider");
const path = require("path");
const fs = require("fs");

const {
  companionUrl,
  companionWindowTitle,
  companionWindowSettings
} = require("../../server.config");

const elementSettingsCompanionApp = document.getElementById(
  "COMPANION_SERVER_INFO"
);
const elementRangeZoom = document.getElementById("range-zoom");
const elementBtnAppRelaunch = document.getElementById("btn-relaunch");
const elementBtnOpenEditor = document.getElementById("btn-editor-custom-theme");
const elementBtnLastFmLogin = document.getElementById("btn-last-fm-login");

document.addEventListener("DOMContentLoaded", function() {
  initElement("settings-keep-background", "click");
  initElement("settings-show-notifications", "click");
  initElement("settings-start-on-boot", "click");
  initElement("settings-companion-server", "click", showRelaunchButton);
  initElement("settings-continue-where-left-of", "click");
  initElement("settings-shiny-tray", "click", () => {
    ipc.send("update-tray");
  });
  initElement("settings-discord-rich-presence", "click");
  initElement("settings-app-language", "change", showRelaunchButton);
  initElement("settings-clipboard-read", "click", () => {
    ipc.send("switch-clipboard-watcher");
  });
  initElement("titlebar-type", "change", showRelaunchButton);
  initElement("settings-custom-theme", "click", showRelaunchButton);
  initElement("settings-last-fm-scrobbler", "click", () => {
    var login = settingsProvider.get("last-fm-login");
    if (login.username == "") {
      ipc.send("show-last-fm-login");
    }
  });
  initElement(
    "settings-rainmeter-web-now-playing",
    "click",
    showRelaunchButton
  );

  M.FormSelect.init(document.querySelectorAll("select"), {});
  M.Tabs.init(document.getElementsByClassName("tabs")[0], {});
});

document.getElementById("btn-close").addEventListener("click", function() {
  window.close();
});

if (elementSettingsCompanionApp) {
  elementSettingsCompanionApp.addEventListener("click", function() {
    window.open(companionUrl, companionWindowTitle, companionWindowSettings);
  });
}

if (elementRangeZoom) {
  elementRangeZoom.addEventListener("input", function() {
    document.getElementById("range-zoom-value").innerText = this.value;
    settingsProvider.set("settings-page-zoom", this.value);
    ipc.send("settings-changed-zoom", this.value);
  });
}

if (elementBtnOpenEditor) {
  elementBtnOpenEditor.addEventListener("click", function() {
    ipc.send("show-editor-theme");
  });
}

if (elementBtnLastFmLogin) {
  elementBtnLastFmLogin.addEventListener("click", function() {
    ipc.send("show-last-fm-login");
  });
}

if (elementBtnAppRelaunch) {
  elementBtnAppRelaunch.addEventListener("click", function() {
    relaunch();
  });
}

if (process.platform !== "darwin") {
  const macSpecificNodes = document.getElementsByClassName("macos-specific");
  for (let i = 0; i < macSpecificNodes.length; i++) {
    macSpecificNodes.item(i).classList.add("hide");
  }
}

loadSettings();
__.loadi18n();

function showRelaunchButton() {
  elementBtnAppRelaunch.classList.remove("hide");
}

/**
 * Initialize element and create listener for it
 * @param {*} elementName
 * @param {*} eventType
 * @param {*} fn
 */
function initElement(elementName, eventType, fn) {
  if (fn === undefined) {
    fn = () => {};
  }
  const element = document.getElementById(elementName);

  if (element) {
    loadValue(element, elementName, eventType);
    createListener(element, elementName, eventType, fn);
  }
}

/**
 *
 * @param {*} element
 * @param {*} settingsName
 * @param {*} eventType
 * @param {*} fn
 */
function createListener(element, settingsName, eventType, fn) {
  element.addEventListener(eventType, function() {
    switch (eventType) {
      case "click":
        settingsProvider.set(settingsName, this.checked);
        break;

      case "change":
        settingsProvider.set(settingsName, this.value);
        break;
    }
    fn();
  });
}

function loadValue(element, settingsName, eventType) {
  switch (eventType) {
    case "click":
      element.checked = settingsProvider.get(settingsName, false);
      break;

    case "change":
      element.value = settingsProvider.get(settingsName);
      break;
  }
}

function loadSettings() {
  if (settingsProvider.get("settings-companion-server")) {
    document.getElementById("COMPANION_SERVER_INFO").classList.remove("hide");
  }

  if (settingsProvider.get("settings-page-zoom")) {
    document.getElementById("range-zoom").value = settingsProvider.get(
      "settings-page-zoom"
    );
    document.getElementById(
      "range-zoom-value"
    ).innerText = settingsProvider.get("settings-page-zoom");
  }

  document.getElementById("app-version").innerText = remote.app.getVersion();

  // Disable unsupported platforms which may get an API later
  if (!["darwin", "win32"].includes(process.platform)) {
    const startOnBootEl = document.getElementById("settings-start-on-boot");
    startOnBootEl.checked = false;
    startOnBootEl.setAttribute("disabled", "disabled");
  }
}

function relaunch() {
  remote.app.relaunch();
  remote.app.exit(0);
}
