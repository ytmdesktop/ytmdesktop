const { isLinux } = require("./systemInfo");

const PADDING = 1;
const PADDING_MAXIMIZED = 16;
const PADDING_LINUX = 0;

const TITLE_BAR_HEIGHT = 28;

const TITLE_BAR_HEIGHT_MAC = 21;

/**
 * @param {ElectonStore} store
 * @param {Array.<width: Number, height: Number, isMac: Boolean, isMaximized: Boolean>} sizes
 */
let isMac = false;

module.exports = {
  setMac: ismac => {
    isMac = ismac;
  },
  calcYTViewSize: function calculateYoutubeViewSize(store, window) {
    const windowSize = window.getSize();
    const isMaximized = window.isMaximized();
    const isNiceTitleBarDisabled =
      store.get("titlebar-type", "nice") !== "nice";
    const x = PADDING;
    if (isMac) {
      // For MacOS
      const y = isNiceTitleBarDisabled
        ? PADDING + TITLE_BAR_HEIGHT_MAC
        : PADDING + TITLE_BAR_HEIGHT;

      return {
        x,
        y,
        width: windowSize[0] - x - PADDING,
        height: windowSize[1] - y - PADDING
      };
    } else if (isLinux()) {
      const y = PADDING_LINUX;

      return {
        x,
        y,
        width: windowSize[0] - x,
        height: windowSize[1] - y
      };
    }
    {
      const y = isNiceTitleBarDisabled ? PADDING : PADDING + TITLE_BAR_HEIGHT;

      return {
        x,
        y,
        width: isMaximized
          ? windowSize[0] - x - PADDING_MAXIMIZED
          : windowSize[0] - x - PADDING,
        height: windowSize[1] - y - (isMaximized ? PADDING_MAXIMIZED : PADDING)
      };
    }
  }
};
