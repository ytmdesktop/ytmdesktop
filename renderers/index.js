const { remote, ipcRenderer: ipc } = require("electron");
const electronStore = require("electron-store");
const store = new electronStore();
const status = remote.getGlobal("sharedObj");
const window = remote.getCurrentWindow();

const icons = require("../icons_for_shiny_tray");
let icon_set = icons.bright;

ipc.on("is-online", function(_, isOnline) {
  if (isOnline) {
    document.getElementById("is-offline").classList.add("hide");
    document.getElementById("center-loading").classList.remove("hide");
  } else {
    document.getElementById("is-offline").classList.remove("hide");
    document.getElementById("center-loading").classList.add("hide");
  }
});

if (store.get("titlebar-type", "nice") !== "nice") {
  document.getElementById("nice-titlebar").style.display = "none";
}

document.getElementById("btn-update").addEventListener("click", function() {
  ipc.send("btn-update-clicked", true);
});

document
  .getElementById("btn-show-settings")
  .addEventListener("click", function() {
    ipc.send("show-settings");
  });

document.getElementById("btn-show-lyric").addEventListener("click", function() {
  ipc.send("show-lyrics");
});

if (!!store.get("settings-companion-server")) {
  document.getElementById("btn-show-companion").classList.remove("hide");
  document
    .getElementById("btn-show-companion")
    .addEventListener("click", function() {
      ipc.send("show-companion");
    });
}
if (process.platform === "darwin") {
  document.getElementById("btn-minimize").style.display = "none";
  document.getElementById("btn-maximize").style.display = "none";
  document.getElementById("btn-close").style.display = "none";
} else {
  document.getElementById("btn-minimize").addEventListener("click", function() {
    window.minimize();
  });

  document.getElementById("btn-maximize").addEventListener("click", function() {
    if (!window.isMaximized()) {
      window.maximize();
    } else {
      window.unmaximize();
    }
  });

  document.getElementById("btn-close").addEventListener("click", function() {
    ipc.send("will-close-mainwindow");
  });
}

const canvas = document.createElement("canvas");
canvas.height = 32;
canvas.width = 150;
const ctx = canvas.getContext("2d");
ipc.on("window-is-maximized", function(event, value) {
  if (value) {
    document.getElementById("icon_maximize").classList.add("hide");
    document.getElementById("icon_restore").classList.remove("hide");
  } else {
    document.getElementById("icon_restore").classList.add("hide");
    document.getElementById("icon_maximize").classList.remove("hide");
  }
});

ipc.on("have-new-update", function(e, data) {
  // document.getElementById( 'btn-update' ).classList.remove( 'hide' );
});

ipc.on("downloaded-new-update", function(e, data) {
  document.getElementById("btn-update").classList.remove("hide");
});

ipc.on("update-status-bar", function(event, arg) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.font = "14px Arial";
  if (store.get("settings-shiny-tray-dark", false)) {
    ctx.fillStyle = "white";
    icon_set = icons.dark;
  } else {
    ctx.fillStyle = "black";
    icon_set = icons.bright;
  }
  ctx.fillText(cutstr(status.title, 14), 30, 21);

  // console.log(arg)
  ctx.drawImage(icon_set.icons, 8, 8, 16, 16);
  if (status.paused) {
    ctx.drawImage(icon_set.play, 135, 6, 20, 20);
  } else {
    ctx.drawImage(icon_set.pause, 135, 6, 20, 20);
  }
  ipc.send("updated-tray-image", canvas.toDataURL("image/png", 1));
});

ipc.send("register-renderer");
ipc.on("is-dev", function(event, args) {
  if (args) {
    document.title = document.title + " DEV";
  }
});

function getStrLength(str) {
  // For cut str
  var realLength = 0,
    len = str.length,
    charCode = -1;
  for (var i = 0; i < len; i++) {
    charCode = str.charCodeAt(i);
    if (charCode >= 0 && charCode <= 128) {
      realLength += 1;
    } else {
      realLength += 2;
    }
  }
  return realLength;
}
function cutstr(str, len) {
  var str_length = 0;
  var str_len = 0;
  str_cut = new String();
  str_len = str.length;
  for (var i = 0; i < str_len; i++) {
    a = str.charAt(i);
    str_length++;
    if (escape(a).length > 4) {
      str_length++;
    }
    str_cut = str_cut.concat(a);
    if (str_length >= len) {
      str_cut = str_cut.concat("...");
      return str_cut;
    }
  }
  if (str_length < len) {
    return str;
  }
}
