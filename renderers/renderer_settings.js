const { remote, ipcRenderer: ipc } = require("electron");
const electronStore = require("electron-store");
const store = new electronStore();
const __ = require("../providers/translateProvider");
const {
  companionUrl,
  companionWindowTitle,
  companionWindowSettings
} = require("../server.config");

loadSettings();
__.loadi18n();
// remote.getCurrentWebContents().openDevTools();

document.addEventListener("DOMContentLoaded", function() {
  M.FormSelect.init(document.querySelectorAll("select"), {});
  M.Tabs.init(document.getElementsByClassName("tabs")[0], {});
});

document.getElementById("btn-close").addEventListener("click", function() {
  window.close();
});

const elementKeepBackground = document.getElementById("toggle-keep-background");
const elementToggleShowNotification = document.getElementById(
  "toggle-show-notifications"
);
const elementToggleStartOnBoot = document.getElementById(
  "toggle-start-on-boot"
);
const elementToggleCompanionServer = document.getElementById(
  "toggle-companion-server"
);
const elementToggleLeftOf = document.getElementById(
  "toggle-continue-where-left-of"
);
const elementToggleShinyTray = document.getElementById("toggle-shiny-tray");
const elementDiscordRichPresence = document.getElementById(
  "toggle-discord-rich-presence"
);
const elementAppLanguage = document.getElementById("select-app-language");
const elementTitlebarStyle = document.getElementById("select-titlebar-style");
const elementSettingsCompanionApp = document.getElementById(
  "COMPANION_SERVER_INFO"
);
//const elementBtnAppRelaunch = document.getElementById( 'btn-app-relaunch' );

if (process.platform !== "darwin") {
  const macSpecificNodes = document.getElementsByClassName("macos-specific");
  for (let i = 0; i < macSpecificNodes.length; i++) {
    macSpecificNodes.item(i).style.display = "none";
  }
}

elementKeepBackground.addEventListener("click", function() {
  store.set("settings-keep-background", this.checked);
});

elementToggleShowNotification.addEventListener("click", function() {
  store.set("settings-show-notifications", this.checked);
});

elementToggleLeftOf.addEventListener("click", function() {
  store.set("settings-continue-where-left-of", this.checked);
});

elementToggleStartOnBoot.addEventListener("click", function() {
  store.set("settings-start-on-boot", this.checked);
});

elementToggleCompanionServer.addEventListener("click", function() {
  store.set("settings-companion-server", this.checked);
  relaunch();
});

elementDiscordRichPresence.addEventListener("click", function() {
  store.set("settings-discord-rich-presence", this.checked);
});

elementAppLanguage.addEventListener("change", function() {
  store.set("settings-app-language", this.value);
  relaunch();
});

elementTitlebarStyle.addEventListener("change", function() {
  store.set("titlebar-type", this.value);
  relaunch();
});

elementToggleShinyTray.addEventListener("click", function() {
  store.set("settings-shiny-tray", this.checked);
  ipc.send("update-tray");
});

elementSettingsCompanionApp.addEventListener("click", function() {
  window.open(companionUrl, companionWindowTitle, companionWindowSettings);
});

/*elementBtnAppRelaunch.addEventListener( 'click', function() {
    relaunch();
} )*/

/*const elementCheckUpdate = document.getElementById( 'check-update' );
elementCheckUpdate.addEventListener( 'click', function() {
    elementCheckUpdate.setAttribute( 'disabled', true );
} );*/

const elementRangeZoom = document.getElementById("range-zoom");

elementRangeZoom.addEventListener("input", function() {
  document.getElementById("range-zoom-value").innerText = this.value;
  store.set("settings-page-zoom", this.value);
  ipc.send("settings-changed-zoom", this.value);
});

function loadSettings() {
  if (store.get("settings-keep-background")) {
    document.getElementById("toggle-keep-background").checked = true;
  }

  if (store.get("settings-show-notifications")) {
    document.getElementById("toggle-show-notifications").checked = true;
  }

  if (store.get("settings-continue-where-left-of")) {
    document.getElementById("toggle-continue-where-left-of").checked = true;
  }

  if (store.get("settings-discord-rich-presence")) {
    document.getElementById("toggle-discord-rich-presence").checked = true;
  }

  if (store.get("settings-start-on-boot")) {
    document.getElementById("toggle-start-on-boot").checked = true;
  }

  if (store.get("settings-companion-server")) {
    document.getElementById("toggle-companion-server").checked = true;
    document.getElementById("COMPANION_SERVER_INFO").classList.remove("hide");
  }

  if (store.get("settings-app-language")) {
    document.getElementById("select-app-language").value = store.get(
      "settings-app-language"
    );
  }

  document.getElementById("select-titlebar-style").value = store.get(
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
    document.getElementById("toggle-shiny-tray").checked = true;
  }

  document.getElementById("app-version").innerText = remote.app.getVersion();

  // Disable unsupported platforms which may get an API later
  if (!["darwin", "win32"].includes(process.platform)) {
    const startOnBootEl = document.getElementById("toggle-start-on-boot");
    startOnBootEl.checked = false;
    startOnBootEl.setAttribute("disabled", "disabled");
  }
}

function relaunch() {
  remote.app.relaunch();
  remote.app.exit(0);
}
