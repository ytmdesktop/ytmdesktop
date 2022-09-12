const { ipcRenderer } = require('electron')
const settingsProvider = require('../../providers/settingsProvider')

const btnClose = document.getElementById('btn-close')
const btnDislike = document.getElementById('btn-dislike')
const btnPrevious = document.getElementById('btn-previous')
const btnPlayPause = document.getElementById('btn-play-pause')
const btnNext = document.getElementById('btn-next')
const btnLike = document.getElementById('btn-like')

let body = document.getElementsByTagName('body')[0]
let background = document.getElementById('background')
let title = document.getElementById('title')
let author = document.getElementById('author')
let album = document.getElementById('album')

let current = document.getElementById('current')
let duration = document.getElementById('duration')
let progress = document.getElementById('progress')
let secondsEffect = document.getElementById('secondsEffect')

document.addEventListener('DOMContentLoaded', async () => {
    setPlayerInfo(await retrieveAllInfo())

    setInterval(async () => {
        setPlayerInfo(await retrieveAllInfo())
    }, 500)

    document.addEventListener('wheel', function (ev) {
        ev.preventDefault()
        if (ev.deltaY < 0)
            ipcRenderer.send('media-command', { command: 'media-volume-up' })
        else ipcRenderer.send('media-command', { command: 'media-volume-down' })
    })

    document.addEventListener('dblclick', (ev) => {
        if (ev.clientX >= 100) {
            ipcRenderer.send('media-command', {
                command: 'media-seekbar-forward',
            })
            showDbClickAnimation('right')
        } else {
            ipcRenderer.send('media-command', {
                command: 'media-seekbar-rewind',
            })
            showDbClickAnimation('left')
        }
    })

    btnClose.addEventListener('click', () => {
        ipcRenderer.send('window', { command: 'restore-main-window' })
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
})

async function retrieveAllInfo() {
    return new Promise((resolve, reject) => {
        ipcRenderer
            .invoke('invoke-all-info')
            .then((result) => resolve(result))
            .catch((_) => reject(false))
    })
}

function setPlayerInfo(data) {
    document.title = `${data.track.title} - ${data.track.author}`
    background.style.backgroundImage = `url(${data.track.cover})`
    title.innerHTML = data.track.title || 'Title'
    author.innerHTML = data.track.author || 'Author'
    album.innerHTML = data.track.album || 'Album'
    current.innerHTML = data.player.seekbarCurrentPositionHuman || '0:00'
    duration.innerHTML = data.track.durationHuman || '0:00'
    progress.style.width = data.player.statePercent * 100 + '%'
    if (data.player.isPaused) {
        btnPlayPause.children.item(0).innerHTML = 'play_arrow'
        body.classList.add('showinfo')
    } else {
        btnPlayPause.children.item(0).innerHTML = 'pause'
        body.classList.remove('showinfo')
    }

    const btnLikeCL = btnLike.children.item(0).classList
    const btnDislikeCL = btnDislike.children.item(0).classList

    switch (data.player.likeStatus) {
        case 'LIKE':
            btnLikeCL.add('show-solid')
            btnLikeCL.remove('hide-solid')
            btnDislikeCL.add('hide-solid')
            btnDislikeCL.remove('show-solid')
            break

        case 'DISLIKE':
            btnLikeCL.add('hide-solid')
            btnLikeCL.remove('show-solid')
            btnDislikeCL.add('show-solid')
            btnDislikeCL.remove('hide-solid')
            break

        case 'INDIFFERENT':
            btnDislikeCL.add('hide-solid')
            btnDislikeCL.remove('show-solid')
            btnLikeCL.add('hide-solid')
            btnLikeCL.remove('show-solid')
            break
    }

    if (settingsProvider.get('settings-miniplayer-paint-controls')) {
        const Vibrant = require('node-vibrant')

        Vibrant.from(data.track.cover)
            .getPalette()
            .then((palette) => {
                body.style.color = palette.LightVibrant.hex
                progress.style.background = palette.LightVibrant.hex
                secondsEffect.style.background = `linear-gradient(to right, ${palette.LightVibrant.hex}, transparent)`
            })
    }

    if (settingsProvider.get('settings-miniplayer-always-show-controls'))
        body.classList.add('showinfo')

    if (data.track.id) {
        document.querySelector('#loading').classList.add('hide')
        document.querySelector('#content').classList.remove('hide')
    }
}

function showDbClickAnimation(side) {
    secondsEffect.classList.add(side)
    setTimeout(() => {
        secondsEffect.classList.remove(side)
    }, 200)
}
