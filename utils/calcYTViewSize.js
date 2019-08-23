const PADDING = 1;
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
  calcYTViewSize: function calculateYoutubeViewSize(
    store,
    [width, height, isMaximized]
  ) {
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
        width: width - x - PADDING,
        height: height - y - PADDING
      };
    } else {
      const y = isNiceTitleBarDisabled ? PADDING : PADDING + TITLE_BAR_HEIGHT;

      return {
        x,
        y,
        width: width - x - PADDING,
        height: height - y - PADDING
      };
    }
  }
};
