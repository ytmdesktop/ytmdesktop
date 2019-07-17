const PADDING = 1;
const TITLE_BAR_HEIGHT = 28;

/**
 * @param {ElectonStore} store
 * @param {Array.<width: Number, height: Number, isMaximized: Boolean>} sizes
 */
module.exports = function calculateYoutubeViewSize(store, [width, height, isMaximized]) {
  const isNiceTitleBarDisabled = store.get('titlebar-type', 'nice') !== 'nice';
  const x = PADDING;
  const y = isNiceTitleBarDisabled 
    ? PADDING
    : PADDING + TITLE_BAR_HEIGHT;

  return {
      x, y,
      width: width - x - PADDING,
      height: height - y - PADDING,
  };
}