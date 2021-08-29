const $ = (selector) =>
    typeof selector === 'string' ? document.querySelector(selector) : selector

const $click = (selector) => {
    const element =
        typeof selector === 'string'
            ? document.querySelector(selector)
            : selector

    if (element) element.click()
}

const $css = (styles) => {
    let css = document.createElement('style')
    css.innerText = styles
    document.head.appendChild(css)
}

const each = async (selector) => {
    return new Promise((resolve) => {
        let timeout = setInterval(() => {
            const element = document.querySelector(selector)

            if (element) resolve(element) && clearInterval(timeout)
        }, 10)
    })
}

window.onload = async () => {
    let styles = `
    .ytp-ad-image-overlay { display: none!important } 
    .ytp-ad-overlay-container, #player-ads { display: none!important } 
    .ytp-ad-message-overlay { display: none!important } 
    .video-ads { display: none!important } 
    .ytmusic-popup-container { display: none!important } 
  `

    $css(styles)
}

;(() => {
    let interval = setInterval(() => {
        const ad = $('.ad-showing video')

        if (!ad) return

        //Skip
        isFinite(ad.duration) && (ad.currentTime = ad.duration)

        $click('button.ytp-ad-skip-button') // Click on "skip"
    }, 10)

    return function () {
        clearInterval(interval)
    }
})()
