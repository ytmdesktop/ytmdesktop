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
