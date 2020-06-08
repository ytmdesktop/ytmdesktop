const { ipcRenderer } = require('electron')
const settingsProvider = require('../../providers/settingsProvider')
const Vibrant = require('node-vibrant')

const body = document.getElementsByTagName('body')[0]
const title = document.getElementById('title')
const author = document.getElementById('author')

const current = document.getElementById('current')
const duration = document.getElementById('duration')
const progress = document.getElementById('progress')
const secondsEffect = document.getElementById('secondsEffect')

const btnClose = document.getElementById('btn-close')
const btnOnTop = document.getElementById('btn-pin')
const btnDislike = document.getElementById('btn-dislike')
const btnPrevious = document.getElementById('btn-previous')
const btnPlayPause = document.getElementById('btn-play-pause')
const btnNext = document.getElementById('btn-next')
const btnLike = document.getElementById('btn-like')

btnClose.addEventListener('click', () => {
    ipcRenderer.send('restore-main-window')
    window.close()
})

btnOnTop.addEventListener('click', () => {
    ipcRenderer.send('miniplayer-toggle-ontop', true)
})

btnDislike.addEventListener('click', () => {
    ipcRenderer.send('media-command', { command: 'media-vote-down' })
})

btnPrevious.addEventListener('click', () => {
    ipcRenderer.send('media-command', { command: 'media-track-previous' })
})

btnPlayPause.addEventListener('click', () => {
    ipcRenderer.send('media-command', { command: 'media-play-pause' })
    body.classList.toggle('showinfo')
})

btnNext.addEventListener('click', () => {
    ipcRenderer.send('media-command', { command: 'media-track-next' })
})

btnLike.addEventListener('click', () => {
    ipcRenderer.send('media-command', { command: 'media-vote-up' })
})

document.addEventListener('DOMContentLoaded', async () => {
    setPlayerInfo(await retrieveAllInfo())

    setInterval(async () => {
        setPlayerInfo(await retrieveAllInfo())
    }, 500)
})

async function retrieveAllInfo() {
    return new Promise((resolve, reject) => {
        ipcRenderer
            .invoke('invoke-all-info')
            .then(result => resolve(result))
            .catch(_ => reject(false))
    })
}

document.addEventListener('dblclick', ev => {
    if (ev.clientX >= 100) {
        ipcRenderer.send('media-command', { command: 'media-seekbar-forward' })
        showDbClickAnimation('right')
    } else {
        ipcRenderer.send('media-command', { command: 'media-seekbar-rewind' })
        showDbClickAnimation('left')
    }
})

function setPlayerInfo(data) {
    document.title = `${data.track.title} - ${data.track.author}`
    body.style.backgroundImage = `url(${data.track.cover})`
    body.style.textShadow = '0 0 3px #000'
    title.innerHTML = data.track.title || 'Title'
    author.innerHTML = data.track.author || 'Author'
    current.innerHTML = data.player.seekbarCurrentPositionHuman || '0:00'
    duration.innerHTML = data.track.durationHuman || '0:00'
    progress.style.width = data.track.statePercent * 100 + 'vw'

    if (data.player.isPaused) {
        btnPlayPause.children[0].innerHTML = 'play_arrow'
        body.classList.add('showinfo')
    } else {
        btnPlayPause.children[0].innerHTML = 'pause'
        body.classList.remove('showinfo')
    }

    switch (data.player.likeStatus) {
        case 'LIKE':
            btnLike.children[0].classList.remove('outlined')
            btnDislike.children[0].classList.add('outlined')
            break

        case 'DISLIKE':
            btnLike.children[0].classList.add('outlined')
            btnDislike.children[0].classList.remove('outlined')
            break

        case 'INDIFFERENT':
            btnLike.children[0].classList.add('outlined')
            btnDislike.children[0].classList.add('outlined')
            break
    }

    if (settingsProvider.get('settings-miniplayer-paint-controls')) {
        Vibrant.from(data.track.cover)
            .getPalette()
            .then(palette => {
                body.style.color = palette.LightVibrant.hex
            })
    } else {
        body.style.color = '#FFF'
    }

    if (settingsProvider.get('settings-miniplayer-always-show-controls')) {
        body.classList.add('showinfo')
    }
}

function showDbClickAnimation(side) {
    secondsEffect.classList.add(side)
    setTimeout(() => {
        secondsEffect.classList.remove(side)
    }, 200)
}
