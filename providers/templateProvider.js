let statusBarMenu = [
  {
    label: "Edit",
    submenu: [
      {
        role: "undo"
      },
      {
        role: "redo"
      },
      {
        type: "separator"
      },
      {
        role: "cut"
      },
      {
        role: "copy"
      },
      {
        role: "paste"
      },
      {
        role: "pasteandmatchstyle"
      },
      {
        role: "delete"
      },
      {
        role: "selectall"
      }
    ]
  },
  {
    label: "View",
    submenu: [
      {
        label: "Reload",
        accelerator: "CmdOrCtrl+R",
        click(item, focusedWindow) {
          if (focusedWindow) focusedWindow.reload();
        }
      },
      {
        label: "Toggle Developer Tools",
        accelerator:
          process.platform === "darwin" ? "Alt+Command+I" : "Ctrl+Shift+I",
        click(item, focusedWindow) {
          if (focusedWindow) focusedWindow.webContents.toggleDevTools();
        }
      },
      {
        type: "separator"
      },
      {
        role: "resetzoom"
      },
      {
        role: "zoomin"
      },
      {
        role: "zoomout"
      },
      {
        type: "separator"
      },
      {
        role: "togglefullscreen"
      }
    ]
  },
  {
    role: "window",
    submenu: [
      {
        role: "minimize"
      },
      {
        role: "close"
      }
    ]
  },
  {
    role: "help",
    submenu: [
      {
        label: "Learn More",
        click() {
          require("electron").shell.openExternal("http://electron.atom.io");
        }
      }
    ]
  }
];
statusBarMenu.unshift({
  label: "YTMDesktop",
  submenu: [
    {
      role: "about"
    },
    {
      type: "separator"
    },
    {
      role: "services",
      submenu: []
    },
    {
      type: "separator"
    },
    {
      role: "hide"
    },
    {
      role: "hideothers"
    },
    {
      role: "unhide"
    },
    {
      type: "separator"
    },
    {
      role: "quit"
    }
  ]
});
// Edit menu.
statusBarMenu[1].submenu.push(
  {
    type: "separator"
  },
  {
    label: "Speech",
    submenu: [
      {
        role: "startspeaking"
      },
      {
        role: "stopspeaking"
      }
    ]
  }
);
// Window menu.
statusBarMenu[3].submenu = [
  {
    label: "Close",
    accelerator: "CmdOrCtrl+W",
    role: "close"
  },
  {
    label: "Minimize",
    accelerator: "CmdOrCtrl+M",
    role: "minimize"
  },
  {
    label: "Zoom",
    role: "zoom"
  },
  {
    type: "separator"
  },
  {
    label: "Bring All to Front",
    role: "front"
  }
];

const popUpMenu = (
  __,
  saved_mainWindow,
  mediaControl,
  BrowserWindow,
  path,
  app
) => {
  return [
    {
      label: "YTMD App",
      type: "normal",
      click: function() {
        saved_mainWindow.show();
      }
    },

    { type: "separator" },

    {
      label: __.trans("MEDIA_CONTROL_PLAY_PAUSE"),
      type: "normal",
      click: function() {
        mediaControl.playPauseTrack(saved_mainWindow.getBrowserView());
      }
    },

    {
      label: __.trans("MEDIA_CONTROL_PREVIOUS"),
      type: "normal",
      click: function() {
        mediaControl.previousTrack(saved_mainWindow.getBrowserView());
      }
    },

    {
      label: __.trans("MEDIA_CONTROL_NEXT"),
      type: "normal",
      click: function() {
        mediaControl.nextTrack(saved_mainWindow.getBrowserView());
      }
    },

    { type: "separator" },

    {
      label: __.trans("MEDIA_CONTROL_THUMBS_UP"),
      type: "normal",
      click: function() {
        mediaControl.upVote(saved_mainWindow.getBrowserView());
      }
    },

    {
      label: __.trans("MEDIA_CONTROL_THUMBS_DOWN"),
      type: "normal",
      click: function() {
        mediaControl.downVote(saved_mainWindow.getBrowserView());
      }
    },

    { type: "separator" },

    {
      label: __.trans("LABEL_LYRICS"),
      type: "normal",
      click: function() {
        const lyrics = new BrowserWindow({
          frame: false,
          center: true,
          resizable: true,
          backgroundColor: "#232323",
          width: 700,
          height: 800,
          icon: path.join(__dirname, "../assets/favicon.png"),
          webPreferences: {
            nodeIntegration: true
          }
        });
        lyrics.loadFile(path.join(__dirname, "../pages/lyrics.html"));
      }
    },

    { type: "separator" },

    {
      label: __.trans("LABEL_SETTINGS"),
      type: "normal",
      click: function() {
        const settings = new BrowserWindow({
          parent: saved_mainWindow,
          modal: true,
          frame: false,
          center: true,
          resizable: true,
          backgroundColor: "#232323",
          width: 800,
          icon: path.join(__dirname, "../assets/favicon.png"),
          webPreferences: {
            nodeIntegration: true
          }
        });
        settings.loadFile(path.join(__dirname, "../pages/settings.html"));
      }
    },

    { type: "separator" },

    {
      label: __.trans("LABEL_EXIT"),
      type: "normal",
      click: function() {
        app.exit();
      }
    }
  ];
};

exports.statusBarMenu = statusBarMenu;
exports.popUpMenu = popUpMenu;
