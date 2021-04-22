const { isLinux, isMac } = require('./systemInfo')

const PADDING = 1
const PADDING_MAXIMIZED = 16
const PADDING_LINUX = 0

const TITLE_BAR_HEIGHT = 28

const TITLE_BAR_HEIGHT_MAC = 21

/**
 * @param {settingsProvider} store
 * @param window
 */
function calculateYoutubeViewSize(store, window) {
    const windowSize = window.getSize()
    const isMaximized = window.isMaximized()
    const isNiceTitleBarDisabled = store.get('titlebar-type', 'nice') !== 'nice'
    const titlebarType = store.get('titlebar-type')

    if (window.isFullScreen())
        return {
            x: 0,
            y: 0,
            width: windowSize[0],
            height: windowSize[1],
        }

    if (isMac()) {
        // IS MAC
        const x = PADDING
        const y = isNiceTitleBarDisabled
            ? PADDING + TITLE_BAR_HEIGHT_MAC
            : PADDING + TITLE_BAR_HEIGHT

        return {
            x,
            y,
            width: windowSize[0] - x - PADDING,
            height: windowSize[1] - y - PADDING,
        }
    } else if (isLinux()) {
        // IS LINUX
        const x = PADDING_LINUX
        const y = PADDING_LINUX

        return {
            x,
            y,
            width: windowSize[0] - x,
            height: windowSize[1] - y,
        }
    } else {
        // IS WINDOWS
        const x = PADDING
        const y = isNiceTitleBarDisabled ? PADDING : PADDING + TITLE_BAR_HEIGHT

        return {
            x,
            y,
            width: isMaximized
                ? windowSize[0] - x - PADDING_MAXIMIZED
                : windowSize[0] - x - PADDING,
            height:
                titlebarType === 'none'
                    ? windowSize[1]
                    : windowSize[1] -
                      y -
                      (isMaximized ? PADDING_MAXIMIZED : PADDING) -
                      (isNiceTitleBarDisabled ? (isMaximized ? 24 : 40) : 0),
        }
    }
}

module.exports = {
    calcYTViewSize: calculateYoutubeViewSize,
}
