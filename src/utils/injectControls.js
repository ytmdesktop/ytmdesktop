const { ipcRenderer } = require('electron')

// FIXME: This should not be sync IPC
const translate = (id, params) =>
    ipcRenderer.sendSync('I18N_TRANSLATE', id, params)

// FIXME: This should not be sync IPC
const settingsGet = (key) => ipcRenderer.sendSync('SETTINGS_GET', key)

const settingsOnDidChange = (key, cb) => {
    ipcRenderer.on(`SETTINGS_NOTIFY_${key}`, (e, newValue, oldValue) =>
        cb({ newValue, oldValue })
    )
    ipcRenderer.send('SETTINGS_SUBSCRIBE', key)
}

window.addEventListener('load', () => {
    createContextMenu()

    const { hostname } = window.location
    if (hostname == 'music.youtube.com') {
        createTopMiddleContent()
        createTopRightContent()
        createBottomPlayerBarContent()
        playerBarScrollToChangeVolume()
    } else {
        createOffTheRoadContent()
    }

    // injectCast()
    loadAudioOutputList()
})

function createContextMenu() {
    try {
        const materialIcons = document.createElement('link')
        materialIcons.setAttribute(
            'href',
            'https://fonts.googleapis.com/icon?family=Material+Icons'
        )
        materialIcons.setAttribute('rel', 'stylesheet')

        document.body.prepend(materialIcons)
    } catch (err) {
        console.error(err)
        ipcRenderer.send('log', {
            type: 'warn',
            data: 'error on createContextMenu',
        })
    }

    try {
        const css = document.createElement('style')
        css.appendChild(
            document.createTextNode(
                `
                #ytmd-menu {
                    visibility: hidden;
                    opacity: 0;
                    position: fixed;
                    background: #232323;
                    font-family: sans-serif;

                    -webkit-transition: opacity .2s ease-in-out;
                    transition: opacity .2s ease-in-out;
                    
                    padding: 0 !important;
                    
                    border: 1px solid rgba(255, 255, 255, .08) !important;
                    border-radius: 2px !important;

                    z-index: 999999 !important;

                    width: 144px;
                }
            
                #ytmd-menu a {
                    color: #AAA;
                    display: inline-block;
                    cursor: pointer;

                    padding: 10px 12px 6px 12px;
                }

                #ytmd-menu a:hover {
                    background-color: rgba(255, 255, 255, 0.1);
                }

                .divider {
                    border: 1px solid rgba(255, 255, 255, 0.1) !important;
                    height: 21px;
                    display: inline-block;
                }

                .hide {
                    visibility: hidden;
                    width: 0 !important;
                    height: 0 !important;
                    margin: 0 !important;
                    padding: 0 !important;
                }

                .pointer {
                    cursor: pointer;
                }

                .shine:hover {
                    color: #FFF !important;
                }

                .ytmd-icons {
                    margin: 0 18px 0 2px !important;
                    color: rgba(255, 255, 255, 0.5) !important;
                }

                .ytmd-button-rounded {
                    margin: 0 0 0 10px;

                    width: 40px;
                    height: 40px;

                    padding: 6px;

                    border: 0;

                    color: #999;

                    background: rgba(255, 255, 255, 0);
                    border-radius: 50%;
                }

                .ytmd-button-rounded:hover {
                    background: rgba(255, 255, 255, .1);
                }

                .ytmd-icons-middle {
                    margin: 0 10px 0 18px !important;
                }

                .center-content {
                    padding-top: 12px;
                }

                .btn-disabled {
                    color: #000 !important;
                }

                .text-red {
                    color: red !important;
                }
            `
            )
        )
        document.head.appendChild(css)
    } catch (err) {
        console.error(err)
        ipcRenderer.send('log', {
            type: 'warn',
            data: 'error on createContextMenu insertCSS',
        })
    }

    let quickShortcuts = ''
    quickShortcuts += `<a id="ytmd-menu-lyrics"><i class="material-icons">music_note</i></a>`
    quickShortcuts += `<a id="ytmd-menu-miniplayer"><i class="material-icons">picture_in_picture_alt</i></a>`
    quickShortcuts += `<a id="ytmd-menu-bug-report"><i class="material-icons text-red">bug_report</i></a>`

    try {
        const menuDiv = document.createElement('div')
        menuDiv.setAttribute('id', 'ytmd-menu')
        menuDiv.innerHTML = quickShortcuts
        document.body.prepend(menuDiv)
    } catch (err) {
        console.error(err)
        ipcRenderer.send('log', {
            type: 'warn',
            data: 'error on createContextMenu prepend',
        })
    }

    // LISTENERS FOR MENU OPTIONS
    try {
        const menuElement = document.getElementById('ytmd-menu').style

        const buttonOpenCompanion = document.getElementById(
            'ytmd-menu-companion-server'
        )
        const buttonOpenMiniplayer = document.getElementById(
            'ytmd-menu-miniplayer'
        )
        const buttonOpenLyrics = document.getElementById('ytmd-menu-lyrics')
        const buttonOpenBugReport = document.getElementById(
            'ytmd-menu-bug-report'
        )
        const buttonPageOpenMiniplayer = document.getElementsByClassName(
            'player-minimize-button ytmusic-player'
        )[0]

        document.addEventListener(
            'contextmenu',
            function (e) {
                const posX = e.clientX
                const posY = e.clientY
                showMenu(posX, posY)
                e.preventDefault()
            },
            false
        )
        document.addEventListener(
            'click',
            function (e) {
                menuElement.opacity = '0'
                setTimeout(function () {
                    menuElement.visibility = 'hidden'
                }, 501)
            },
            false
        )

        if (buttonOpenCompanion) {
            buttonOpenCompanion.addEventListener('click', function () {
                ipcRenderer.send('window', { command: 'show-companion' })
            })
        }

        if (buttonOpenLyrics) {
            buttonOpenLyrics.addEventListener('click', function () {
                ipcRenderer.send('window', { command: 'show-lyrics' })
            })
        }

        if (buttonOpenMiniplayer) {
            buttonOpenMiniplayer.addEventListener('click', function () {
                ipcRenderer.send('window', { command: 'show-miniplayer' })
            })
        }

        if (buttonPageOpenMiniplayer) {
            buttonPageOpenMiniplayer.addEventListener('click', function (e) {
                /* Temporary fix */ document
                    .getElementsByClassName(
                        'player-maximize-button ytmusic-player'
                    )[0]
                    .click()
                ipcRenderer.send('window', { command: 'show-miniplayer' })
            })
        }

        if (buttonOpenBugReport) {
            buttonOpenBugReport.addEventListener('click', function () {
                ipcRenderer.send('bug-report')
            })
        }

        function showMenu(x, y) {
            menuElement.top = y + 'px'
            menuElement.left = x + 'px'
            menuElement.visibility = 'visible'
            menuElement.opacity = '1'
        }
    } catch (err) {
        console.error(err)
        ipcRenderer.send('log', {
            type: 'warn',
            data: 'error on createContextMenu listeners',
        })
    }
}

function createTopMiddleContent() {
    try {
        const center_content = document.getElementsByTagName(
            'ytmusic-pivot-bar-renderer'
        )[0]

        // HISTORY BACK
        const element = document.createElement('i')
        element.id = 'ytmd_history_back'
        element.classList.add(
            'material-icons',
            'pointer',
            'shine',
            'ytmd-icons',
            'center-content'
        )
        element.innerText = 'keyboard_backspace'

        element.addEventListener('click', function () {
            history.go(-1)
        })

        center_content.prepend(element)
    } catch (err) {
        console.error(err)
        ipcRenderer.send('log', {
            type: 'warn',
            data: 'error on createTopMiddleContent',
        })
    }
}

function createTopRightContent() {
    const settingsRemoteServer = settingsGet('settings-companion-server')

    // ADD BUTTONS TO RIGHT CONTENT (side to the photo)
    try {
        const right_content = document.getElementById('right-content')

        // SETTINGS
        const elementSettings = document.createElement('i')
        elementSettings.id = 'ytmd_settings'
        elementSettings.title = translate('LABEL_SETTINGS')
        elementSettings.classList.add(
            'material-icons',
            'pointer',
            'shine',
            'ytmd-icons'
        )
        elementSettings.innerText = 'settings'

        elementSettings.addEventListener('click', function () {
            ipcRenderer.send('window', { command: 'show-settings' })
        })

        right_content.prepend(elementSettings)

        // REMOTE SERVER
        const elementRemoteServer = document.createElement('i')
        elementRemoteServer.id = 'ytmd_remote_server'
        elementRemoteServer.title = translate(
            'LABEL_SETTINGS_TAB_GENERAL_COMPANION_SERVER'
        )
        elementRemoteServer.classList.add(
            'material-icons',
            'pointer',
            'shine',
            'ytmd-icons',
            'hide'
        )
        elementRemoteServer.innerText = 'devices_other'

        elementRemoteServer.addEventListener('click', function () {
            ipcRenderer.send('window', { command: 'show-companion' })
        })

        right_content.prepend(elementRemoteServer)

        if (settingsRemoteServer) {
            document
                .getElementById('ytmd_remote_server')
                .classList.remove('hide')
        }

        settingsOnDidChange('settings-companion-server', (data) => {
            if (data.newValue) {
                document
                    .getElementById('ytmd_remote_server')
                    .classList.remove('hide')
            } else {
                document
                    .getElementById('ytmd_remote_server')
                    .classList.add('hide')
            }
        })

        // UPDATE
        const elementUpdate = document.createElement('i')
        elementUpdate.id = 'ytmd_update'
        elementUpdate.classList.add(
            'material-icons',
            'green-text',
            'pointer',
            'shine',
            'ytmd-icons',
            'hide'
        )
        elementUpdate.style.color = '#4CAF50'
        elementUpdate.innerText = 'arrow_downward'

        elementUpdate.addEventListener('click', function () {
            ipcRenderer.send('btn-update-clicked', true)
        })

        right_content.prepend(elementUpdate)

        ipcRenderer.on('downloaded-new-update', function (e, data) {
            document.getElementById('ytmd_update').classList.remove('hide')
        })
    } catch (err) {
        ipcRenderer.send('log', {
            type: 'warn',
            data: 'error on createTopRightContent',
        })
    }
}

function createBottomPlayerBarContent() {
    const shortcutButtons = settingsGet('settings-shortcut-buttons')

    try {
        const playerBarRightControls = document.querySelector(
            '.right-controls-buttons.ytmusic-player-bar'
        )
        const playerBarMiddleControls = document.querySelector(
            '.middle-controls-buttons.ytmusic-player-bar'
        )

        // Middle ////////////////////////////////////////////////////////////////////////////////////
        // Add to Playlist
        const elementAddToPlaylistIcon = document.createElement('i')
        const elementAddToPlaylistButton = document.createElement('button')

        elementAddToPlaylistIcon.id = 'ytmd_add_to_playlist'
        elementAddToPlaylistIcon.title = translate('ADD_TO_PLAYLIST')
        elementAddToPlaylistIcon.classList.add('material-icons')
        elementAddToPlaylistIcon.innerText = 'playlist_add'

        elementAddToPlaylistButton.id = 'btn_ytmd_add_to_playlist'
        elementAddToPlaylistButton.classList.add('ytmd-button-rounded', 'hide')
        elementAddToPlaylistButton.append(elementAddToPlaylistIcon)

        elementAddToPlaylistButton.addEventListener('click', function () {
            const popup = document.querySelector('.ytmusic-menu-popup-renderer')
            const addPlaylist = Array.from(popup.children)
                .filter(
                    (value) =>
                        value
                            .querySelector('g path:not([fill])')
                            .getAttribute('d') ==
                        'M14 10H2v2h12v-2zm0-4H2v2h12V6zm4 8v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zM2 16h8v-2H2v2z'
                )[0]
                .querySelector('a')
            addPlaylist.click()
        })

        playerBarMiddleControls.insertBefore(
            elementAddToPlaylistButton,
            playerBarMiddleControls.children.item(1)
        )

        if (shortcutButtons['add-to-playlist']) {
            document
                .querySelector('#btn_ytmd_add_to_playlist')
                .classList.remove('hide')
        }

        settingsOnDidChange(
            'settings-shortcut-buttons.add-to-playlist',
            (data) => {
                if (data.newValue) {
                    document
                        .querySelector('#btn_ytmd_add_to_playlist')
                        .classList.remove('hide')
                } else {
                    document
                        .querySelector('#btn_ytmd_add_to_playlist')
                        .classList.add('hide')
                }
            }
        )

        // Add to Library
        const elementAddToLibraryIcon = document.createElement('i')
        const elementAddToLibraryButton = document.createElement('button')

        elementAddToLibraryIcon.id = 'ytmd_add_to_library'
        elementAddToLibraryIcon.title = translate('ADD_TO_LIBRARY')
        elementAddToLibraryIcon.classList.add('material-icons')
        elementAddToLibraryIcon.innerText = 'library_add'
        elementAddToLibraryButton.id = 'btn_ytmd_add_to_library'
        elementAddToLibraryButton.classList.add('ytmd-button-rounded', 'hide')
        elementAddToLibraryButton.append(elementAddToLibraryIcon)

        elementAddToLibraryButton.addEventListener('click', function () {
            ipcRenderer.send('media-command', { command: 'media-add-library' })
        })

        playerBarMiddleControls.insertBefore(
            elementAddToLibraryButton,
            playerBarMiddleControls.children.item(1)
        )

        let showAddToLibrary = false
        if (shortcutButtons['add-to-library']) {
            document
                .querySelector('#btn_ytmd_add_to_library')
                .classList.remove('hide')
            showAddToLibrary = true
        }

        settingsOnDidChange(
            'settings-shortcut-buttons.add-to-library',
            (data) => {
                if (data.newValue) {
                    showAddToLibrary = true
                    document
                        .querySelector('#btn_ytmd_add_to_library')
                        .classList.remove('hide')
                } else {
                    showAddToLibrary = false
                    document
                        .querySelector('#btn_ytmd_add_to_library')
                        .classList.add('hide')
                }
            }
        )

        setInterval(() => {
            const popup = document.querySelector('.ytmusic-menu-popup-renderer')
            const addLibrary = Array.from(popup.children).filter(
                (value) =>
                    value
                        .querySelector('g path:not([fill])')
                        .getAttribute('d') ==
                        'M20 2H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-7.53 12L9 10.5l1.4-1.41 2.07 2.08L17.6 6 19 7.41 12.47 14zM4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6z' ||
                    value
                        .querySelector('g path:not([fill])')
                        .getAttribute('d') ==
                        'M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-1 9h-4v4h-2v-4H9V9h4V5h2v4h4v2z'
            )[0]

            if (addLibrary != undefined && showAddToLibrary) {
                const _d = addLibrary
                    .querySelector('g path:not([fill])')
                    .getAttribute('d')

                if (
                    _d ==
                    'M20 2H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-7.53 12L9 10.5l1.4-1.41 2.07 2.08L17.6 6 19 7.41 12.47 14zM4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6z'
                ) {
                    document.querySelector('#ytmd_add_to_library').innerText =
                        'check'
                    document.querySelector(
                        '#ytmd_add_to_library'
                    ).title = translate('REMOVE_FROM_LIBRARY')
                } else {
                    document.querySelector('#ytmd_add_to_library').innerText =
                        'library_add'
                    document.querySelector(
                        '#ytmd_add_to_library'
                    ).title = translate('ADD_TO_LIBRARY')
                }
                document
                    .querySelector('#btn_ytmd_add_to_library')
                    .classList.remove('hide')
            } else {
                document
                    .querySelector('#btn_ytmd_add_to_library')
                    .classList.add('hide')
            }
        }, 800)

        // Right ////////////////////////////////////////////////////////////////////////////////////
        // Lyrics
        const elementLyrics = document.createElement('i')
        elementLyrics.id = 'ytmd_lyrics'
        elementLyrics.title = translate('LYRICS')
        elementLyrics.classList.add(
            'material-icons',
            'pointer',
            'ytmd-icons',
            'hide'
        )
        elementLyrics.innerText = 'music_note'

        elementLyrics.addEventListener('click', function () {
            ipcRenderer.send('window', { command: 'show-lyrics' })
        })
        playerBarRightControls.append(elementLyrics)

        if (shortcutButtons['lyrics']) {
            document.querySelector('#ytmd_lyrics').classList.remove('hide')
        }

        settingsOnDidChange('settings-shortcut-buttons.lyrics', (data) => {
            if (data.newValue) {
                document.querySelector('#ytmd_lyrics').classList.remove('hide')
                document
                    .querySelector('#ytmd_lyrics')
                    .classList.add('ytmd-icons')
            } else {
                document.querySelector('#ytmd_lyrics').classList.add('hide')
                document
                    .querySelector('#ytmd_lyrics')
                    .classList.remove('ytmd-icons')
            }
        })

        // Miniplayer
        const elementMiniplayer = document.createElement('i')
        elementMiniplayer.id = 'ytmd_miniplayer'
        elementMiniplayer.title = translate('MINIPLAYER')
        elementMiniplayer.classList.add(
            'material-icons',
            'pointer',
            'ytmd-icons',
            'hide'
        )
        elementMiniplayer.innerText = 'picture_in_picture_alt'

        elementMiniplayer.addEventListener('click', function () {
            ipcRenderer.send('window', { command: 'show-miniplayer' })
        })
        playerBarRightControls.append(elementMiniplayer)

        if (shortcutButtons['miniplayer']) {
            document.querySelector('#ytmd_miniplayer').classList.remove('hide')
        }

        settingsOnDidChange('settings-shortcut-buttons.miniplayer', (data) => {
            if (data.newValue) {
                document
                    .querySelector('#ytmd_miniplayer')
                    .classList.remove('hide')
                document
                    .querySelector('#ytmd_miniplayer')
                    .classList.add('ytmd-icons')
            } else {
                document.querySelector('#ytmd_miniplayer').classList.add('hide')
                document
                    .querySelector('#ytmd_miniplayer')
                    .classList.remove('ytmd-icons')
            }
        })

        // Volume slider
        document.querySelector('#volume-slider').setAttribute('step', 0)
        document.querySelector('#expand-volume-slider').setAttribute('step', 0)
        document
            .querySelector('#volume-slider')
            .addEventListener('value-change', function (e) {
                ipcRenderer.send('change-volume', {
                    volume: e.target.getAttribute('value'),
                })
            })
    } catch (err) {
        console.error(err)
        ipcRenderer.send('log', {
            type: 'warn',
            data: 'error on createBottomPlayerBarContent',
        })
    }
}

function playerBarScrollToChangeVolume() {
    try {
        const playerBar = document.getElementsByTagName('ytmusic-player-bar')[0]

        playerBar.addEventListener('wheel', function (ev) {
            ev.preventDefault()

            if (ev.deltaY < 0) {
                ipcRenderer.send('media-command', {
                    command: 'media-volume-up',
                })
            } else {
                ipcRenderer.send('media-command', {
                    command: 'media-volume-down',
                })
            }
        })
    } catch (err) {
        console.error(err)
        ipcRenderer.send('log', {
            type: 'warn',
            data: 'error on playerBarScrollToChangeVolume',
        })
    }
}

function createOffTheRoadContent() {
    try {
        const { body } = document

        const elementBack = document.createElement('i')
        elementBack.id = 'ytmd_lyrics'
        elementBack.classList.add('material-icons')
        elementBack.style.cursor = 'pointer'
        elementBack.style.fontSize = '42px'
        elementBack.style.zIndex = '9999999'
        elementBack.style.position = 'fixed'
        elementBack.style.cssFloat = 'left'
        elementBack.style.boxShadow = '0 0 2px #111'
        elementBack.style.background = '#1D1D1D'
        elementBack.style.color = '#FFF'
        elementBack.innerText = 'arrow_back'

        elementBack.addEventListener('click', function () {
            ipcRenderer.send('reset-url')
        })

        body.prepend(elementBack)
    } catch (err) {
        ipcRenderer.send('log', {
            type: 'warn',
            data: 'error on createOffTheRoadContent',
        })
    }
}

function injectCast() {
    // content
    //     .executeJavaScript(
    //         `
    //     // Todo
    //     `
    //     )
    //     .then((data) => {
    //         console.log(data)
    //     })
    //     .catch((err) => {
    //         console.log(err)
    //     })
}

function loadAudioOutputList() {
    navigator.mediaDevices.enumerateDevices().then((devices) => {
        audioDevices = devices.filter((device) => device.kind === 'audiooutput')

        ipcRenderer.send(
            'set-audio-output-list',
            audioDevices.length ? JSON.stringify(audioDevices) : '[]'
        )
    })
}
