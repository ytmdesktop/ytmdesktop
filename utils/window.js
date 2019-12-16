const settingsProvider = require("../providers/settingsProvider");

function create() {
  // for create window
}

function checkBounds() {
  const { screen } = require("electron");

  let displays = screen.getAllDisplays();
  let externalDisplay = displays.find(display => {
    return display.bounds.x !== 0 || display.bounds.y !== 0;
  });

  if (externalDisplay === undefined) {
    primaryDisplayPosition = displays[0].bounds;
    windowPosition = settingsProvider.get("window-position");

    if (windowPosition && windowPosition.x > primaryDisplayPosition.width) {
      var position = {
        x: windowPosition.x - primaryDisplayPosition.width,
        y: windowPosition.y
      };
      settingsProvider.set("window-position", position);
    }
  }
}

function doBehavior(mainWindow) {
  if (mainWindow.isVisible()) {
    if (mainWindow.isFocused()) {
      mainWindow.hide();
    } else {
      mainWindow.focus();
    }
  } else {
    if (mainWindow.isFocused()) {
      mainWindow.show();
    } else {
      mainWindow.show();
    }
  }
}

module.exports = {
  create: create,
  checkBounds: checkBounds,
  doBehavior: doBehavior
};
