setInterval(() => {
    const skipAdBtn = document.querySelector('button.ytp-ad-skip-button')
    const skipAdBanner = document.querySelector('.ytp-ad-overlay-close-button')

    if (skipAdBtn) skipAdBtn.click()
    if (skipAdBanner) skipAdBanner.click()
}, 300)

// setInterval(() => {document.querySelector("button.ytp-ad-skip-button").click(); document.querySelector('.ytp-ad-overlay-close-button').click()}, 300)
