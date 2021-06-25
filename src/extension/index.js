window.onload = () => {
    let css = document.createElement('style')
    let styles =
        '.ytp-ad-overlay-container, #player-ads { display:none !important }' // remove "upgrade" button from youtube music.
    styles +=
        ' #layout > ytmusic-nav-bar > div.center-content.style-scope.ytmusic-nav-bar > ytmusic-pivot-bar-renderer > ytmusic-pivot-bar-item-renderer:nth-child(4) { display: none!important }'

    if (css.styleSheet) css.styleSheet.cssText = styles
    else css.appendChild(document.createTextNode(styles))

    document.getElementsByTagName('head')[0].appendChild(css)
}

const clear = (() => {
    const defined = (v) => v !== null && v !== undefined
    const timeout = setInterval(() => {
        const ad = [...document.querySelectorAll('.ad-showing')][0]
        if (defined(ad)) {
            const video = document.querySelector('video')
            if (defined(video)) {
                video.currentTime = video.duration
            }
        }

        const skipAdBtn = document.querySelector('button.ytp-ad-skip-button')

        if (skipAdBtn) skipAdBtn.click()
    }, 300)

    return function () {
        clearTimeout(timeout)
    }
})()
