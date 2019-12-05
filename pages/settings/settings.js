const { remote, ipcRenderer: ipc } = require("electron");
const electronStore = require("electron-store");
const store = new electronStore();
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
  M.FormSelect.init(document.querySelectorAll("select"), {});
  M.Tabs.init(document.getElementsByClassName("tabs")[0], {});
});

document.getElementById("btn-close").addEventListener("click", function() {
  window.close();
});

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
  var login = store.get("last-fm-login");
  if (!login) {
    ipc.send("show-last-fm-login");
  }
});

if (elementSettingsCompanionApp) {
  elementSettingsCompanionApp.addEventListener("click", function() {
    window.open(companionUrl, companionWindowTitle, companionWindowSettings);
  });
}

if (elementRangeZoom) {
  elementRangeZoom.addEventListener("input", function() {
    document.getElementById("range-zoom-value").innerText = this.value;
    store.set("settings-page-zoom", this.value);
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
        store.set(settingsName, this.checked);
        break;

      case "change":
        store.set(settingsName, this.value);
        break;
    }
    fn();
  });
}

function loadSettings() {
  if (store.get("settings-keep-background")) {
    document.getElementById("settings-keep-background").checked = true;
  }

  if (store.get("settings-show-notifications")) {
    document.getElementById("settings-show-notifications").checked = true;
  }

  if (store.get("settings-continue-where-left-of")) {
    document.getElementById("settings-continue-where-left-of").checked = true;
  }

  if (store.get("settings-discord-rich-presence")) {
    document.getElementById("settings-discord-rich-presence").checked = true;
  }

  if (store.get("settings-start-on-boot")) {
    document.getElementById("settings-start-on-boot").checked = true;
  }

  if (store.get("settings-companion-server")) {
    document.getElementById("settings-companion-server").checked = true;
    document.getElementById("COMPANION_SERVER_INFO").classList.remove("hide");
  }

  if (store.get("settings-app-language")) {
    document.getElementById("settings-app-language").value = store.get(
      "settings-app-language"
    );
  }

  if (store.get("settings-clipboard-read")) {
    document.getElementById("settings-clipboard-read").checked = true;
  }

  document.getElementById("titlebar-type").value = store.get(
    "titlebar-type",
    "nice"
  );

  if (store.get("settings-page-zoom")) {
    document.getElementById("range-zoom").value = store.get(
      "settings-page-zoom"
    );
    document.getElementById("range-zoom-value").innerText = store.get(
      "settings-page-zoom"
    );
  }

  if (store.get("settings-shiny-tray")) {
    document.getElementById("settings-shiny-tray").checked = true;
  }

  if (store.get("settings-custom-theme")) {
    document.getElementById("settings-custom-theme").checked = true;
  }

  if (store.get("settings-last-fm-scrobbler")) {
    document.getElementById("settings-last-fm-scrobbler").checked = true;
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
