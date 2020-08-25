const { remote, ipcRenderer } = require('electron')
const settingsProvider = require('../providers/settingsProvider')
const __ = require('../providers/translateProvider')

window.ipcRenderer = ipcRenderer
window.settingsProvider = settingsProvider
window.__ = __

var content = remote.getCurrentWebContents()

content.addListener('dom-ready', function () {
    createContextMenu()

    content
        .executeJavaScript('window.location.hostname')
        .then((hostname) => {
            if (hostname == 'music.youtube.com') {
                createTopMiddleContent()
                createTopRightContent()
                createBottomPlayerBarContent()
                playerBarScrollToChangeVolume()
            } else {
                createOffTheRoadContent()
            }
        })
        .catch((_) =>
            ipcRenderer.send('log', {
                type: 'error',
                data: 'error on inject content',
            })
        )

    // injectCast()
    loadAudioOutputList()
})

function createContextMenu() {
    content
        .executeJavaScript(
            `
                var materialIcons = document.createElement('link');
                materialIcons.setAttribute('href', 'https://fonts.googleapis.com/icon?family=Material+Icons');
                materialIcons.setAttribute('rel', 'stylesheet');

                document.body.prepend(materialIcons);
            `
        )
        .catch((_) =>
            ipcRenderer.send('log', {
                type: 'warn',
                data: 'error on createContextMenu',
            })
        )

    content
        .insertCSS(
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
        .catch((_) =>
            ipcRenderer.send('log', {
                type: 'warn',
                data: 'error on createContextMenu insertCSS',
            })
        )

    let quickShortcuts = ''
    quickShortcuts += `<a id="ytmd-menu-lyrics"><i class="material-icons">music_note</i></a>`
    quickShortcuts += `<a id="ytmd-menu-miniplayer"><i class="material-icons">picture_in_picture_alt</i></a>`
    quickShortcuts += `<a id="ytmd-menu-bug-report"><i class="material-icons text-red">bug_report</i></a>`

    content
        .executeJavaScript(
            `
                var menuDiv = document.createElement("div");
                menuDiv.setAttribute('id', 'ytmd-menu');
                menuDiv.innerHTML = '${quickShortcuts}';
                document.body.prepend(menuDiv);
            `
        )
        .catch((_) =>
            ipcRenderer.send('log', {
                type: 'warn',
                data: 'error on createContextMenu prepend',
            })
        )

    // LISTENERS FOR MENU OPTIONS
    content
        .executeJavaScript(
            `
        var menuElement = document.getElementById("ytmd-menu").style;

        var buttonOpenCompanion = document.getElementById('ytmd-menu-companion-server');
        var buttonOpenMiniplayer = document.getElementById('ytmd-menu-miniplayer');
        var buttonOpenLyrics = document.getElementById('ytmd-menu-lyrics');
        var buttonOpenBugReport = document.getElementById('ytmd-menu-bug-report');
        var buttonPageOpenMiniplayer = document.getElementsByClassName('player-minimize-button ytmusic-player')[0];

        document.addEventListener('contextmenu', function (e) {
            var posX = e.clientX;
            var posY = e.clientY;
            showMenu(posX, posY);
            e.preventDefault();
            }, false);
            document.addEventListener('click', function (e) {
            menuElement.opacity = "0";
            setTimeout(function () {
                menuElement.visibility = "hidden";
            }, 501);
        }, false);
        
        if (buttonOpenCompanion) {
            buttonOpenCompanion.addEventListener('click', function() { ipcRenderer.send('window', { command: 'show-companion'}); } );
        }

        if (buttonOpenLyrics) {
            buttonOpenLyrics.addEventListener('click', function() { ipcRenderer.send('window', { command: 'show-lyrics'}); } );
        }

        if (buttonOpenMiniplayer) {
            buttonOpenMiniplayer.addEventListener('click', function() { ipcRenderer.send('window', { command: 'show-miniplayer' }); } );
        }

        if (buttonPageOpenMiniplayer) {
            buttonPageOpenMiniplayer.addEventListener('click', function(e) { /* Temporary fix */ document.getElementsByClassName('player-maximize-button ytmusic-player')[0].click(); ipcRenderer.send('window', { command: 'show-miniplayer' }); } );
        }
        
        if (buttonOpenBugReport) {
            buttonOpenBugReport.addEventListener('click', function() { ipcRenderer.send('bug-report'); } );
        }

        function showMenu(x, y) {
            menuElement.top = y + "px";
            menuElement.left = x + "px";
            menuElement.visibility = "visible";
            menuElement.opacity = "1";
        }`
        )
        .catch((_) =>
            ipcRenderer.send('log', {
                type: 'warn',
                data: 'error on createContextMenu listeners',
            })
        )
}

function createTopMiddleContent() {
    content
        .executeJavaScript(
            `
                var center_content = document.getElementsByTagName('ytmusic-pivot-bar-renderer')[0];

                // HISTORY BACK
                var element = document.createElement('i');
                element.id = 'ytmd_history_back';
                element.classList.add('material-icons', 'pointer', 'shine', 'ytmd-icons', 'center-content');
                element.style.color = '#666';
                element.innerText = 'keyboard_backspace';

                element.addEventListener('click', function() { history.go(-1); } )
                
                center_content.prepend(element);
            `
        )
        .catch((_) =>
            ipcRenderer.send('log', {
                type: 'warn',
                data: 'error on createTopMiddleContent',
            })
        )
}

function createTopRightContent() {
    var settingsRemoteServer = settingsProvider.get('settings-companion-server')

    // ADD BUTTONS TO RIGHT CONTENT (side to the photo)
    content
        .executeJavaScript(
            `
                var right_content = document.getElementById('right-content');

                // SETTINGS
                var elementSettings = document.createElement('i');
                elementSettings.id = 'ytmd_settings';
                elementSettings.title = __.trans('LABEL_SETTINGS');
                elementSettings.classList.add('material-icons', 'pointer', 'shine', 'ytmd-icons');
                elementSettings.style.color = '#909090';
                elementSettings.innerText = 'settings';

                elementSettings.addEventListener('click', function() { ipcRenderer.send('window', { command: 'show-settings' }); } )
                
                right_content.prepend(elementSettings);

                // REMOTE SERVER
                var elementRemoteServer = document.createElement('i');
                elementRemoteServer.id = 'ytmd_remote_server';
                elementRemoteServer.title = __.trans('LABEL_SETTINGS_TAB_GENERAL_COMPANION_SERVER');
                elementRemoteServer.classList.add('material-icons', 'pointer', 'shine', 'ytmd-icons', 'hide');
                elementRemoteServer.style.color = '#909090';
                elementRemoteServer.innerText = 'devices_other';

                elementRemoteServer.addEventListener('click', function() { ipcRenderer.send('window', { command: 'show-companion' }); } )
            
                right_content.prepend(elementRemoteServer);
            
                if(${settingsRemoteServer}) {
                    document.getElementById("ytmd_remote_server").classList.remove("hide");
                }

                settingsProvider.onDidChange('settings-companion-server', data => { 
                    if (data.newValue) {
                        document.getElementById("ytmd_remote_server").classList.remove("hide");
                    } else {
                        document.getElementById("ytmd_remote_server").classList.add("hide");
                    }
                })

                // UPDATE
                var elementUpdate = document.createElement('i');
                elementUpdate.id = 'ytmd_update';
                elementUpdate.classList.add('material-icons', 'green-text', 'pointer', 'shine', 'ytmd-icons', 'hide');
                elementUpdate.style.color = '#4CAF50';
                elementUpdate.innerText = 'arrow_downward';

                elementUpdate.addEventListener('click', function() { ipcRenderer.send('btn-update-clicked', true); } )

                right_content.prepend(elementUpdate);

                ipcRenderer.on('downloaded-new-update', function(e, data) {
                    document.getElementById("ytmd_update").classList.remove("hide");
                } );
            `
        )
        .catch((_) =>
            ipcRenderer.send('log', {
                type: 'warn',
                data: 'error on createTopRightContent',
            })
        )
}

function createBottomPlayerBarContent() {
    var shortcutButtons = settingsProvider.get('settings-shortcut-buttons')

    content
        .executeJavaScript(
            `
            var playerBarRightControls = document.querySelector('.right-controls-buttons.ytmusic-player-bar');
            var playerBarMiddleControls = document.querySelector('.middle-controls-buttons.ytmusic-player-bar');

            // Middle ////////////////////////////////////////////////////////////////////////////////////
            // Add to Playlist
            var elementAddToPlaylistIcon = document.createElement('i')
            var elementAddToPlaylistButton = document.createElement('button')
            
            elementAddToPlaylistIcon.id = 'ytmd_add_to_playlist';
            elementAddToPlaylistIcon.title = __.trans('ADD_TO_PLAYLIST');
            elementAddToPlaylistIcon.classList.add('material-icons');
            elementAddToPlaylistIcon.innerText = 'playlist_add';
            
            elementAddToPlaylistButton.id = 'btn_ytmd_add_to_playlist';
            elementAddToPlaylistButton.classList.add('ytmd-button-rounded', 'hide');
            elementAddToPlaylistButton.append(elementAddToPlaylistIcon);

            elementAddToPlaylistButton.addEventListener('click', function() { 
                var popup = document.querySelector('.ytmusic-menu-popup-renderer');
                var addPlaylist = Array.from(popup.children)
                    .filter( (value) => value.querySelector('g path:not([fill])').getAttribute('d') == "M14 10H2v2h12v-2zm0-4H2v2h12V6zm4 8v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zM2 16h8v-2H2v2z" )[0].querySelector('a')
                addPlaylist.click()
            })

            playerBarMiddleControls.insertBefore(elementAddToPlaylistButton, playerBarMiddleControls.children.item(1));

            if(${shortcutButtons['add-to-playlist']}) {
                document.querySelector("#btn_ytmd_add_to_playlist").classList.remove('hide');
            }

            settingsProvider.onDidChange('settings-shortcut-buttons.add-to-playlist', data => {
                if (data.newValue) {
                    document.querySelector("#btn_ytmd_add_to_playlist").classList.remove("hide");
                } else {
                    document.querySelector("#btn_ytmd_add_to_playlist").classList.add("hide");
                }
            })

            // Add to Library
            var elementAddToLibraryIcon = document.createElement('i')
            var elementAddToLibraryButton = document.createElement('button')
            
            elementAddToLibraryIcon.id = 'ytmd_add_to_library';
            elementAddToLibraryIcon.title = __.trans('ADD_TO_LIBRARY');
            elementAddToLibraryIcon.classList.add('material-icons');
            elementAddToLibraryIcon.innerText = 'library_add';
            elementAddToLibraryButton.id = 'btn_ytmd_add_to_library';
            elementAddToLibraryButton.classList.add('ytmd-button-rounded', 'hide');
            elementAddToLibraryButton.append(elementAddToLibraryIcon);

            elementAddToLibraryButton.addEventListener('click', function() { 
                ipcRenderer.send('media-command', { command: 'media-add-library' }); 
            })

            playerBarMiddleControls.insertBefore(elementAddToLibraryButton, playerBarMiddleControls.children.item(1));

            var showAddToLibrary = false;
            if(${shortcutButtons['add-to-library']}) {
                document.querySelector("#btn_ytmd_add_to_library").classList.remove("hide");
                showAddToLibrary = true;
            }
            
            settingsProvider.onDidChange('settings-shortcut-buttons.add-to-library', data => {
                if (data.newValue) {
                    showAddToLibrary = true;
                    document.querySelector("#btn_ytmd_add_to_library").classList.remove("hide");
                } else {
                    showAddToLibrary = false;
                    document.querySelector("#btn_ytmd_add_to_library").classList.add("hide");
                }
            })

            setInterval( () => {
                var popup = document.querySelector('.ytmusic-menu-popup-renderer');
                var addLibrary = Array.from(popup.children)
                    .filter( (value) => value.querySelector('g path:not([fill])').getAttribute('d') == "M20 2H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-7.53 12L9 10.5l1.4-1.41 2.07 2.08L17.6 6 19 7.41 12.47 14zM4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6z" || value.querySelector('g path:not([fill])').getAttribute('d') == "M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-1 9h-4v4h-2v-4H9V9h4V5h2v4h4v2z" )[0]
                
                if(addLibrary != undefined && showAddToLibrary) {
                    var _d = addLibrary.querySelector('g path:not([fill])').getAttribute('d')

                    if(_d == 'M20 2H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-7.53 12L9 10.5l1.4-1.41 2.07 2.08L17.6 6 19 7.41 12.47 14zM4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6z') {
                        document.querySelector('#ytmd_add_to_library').innerText = 'check'
                    } else {
                        document.querySelector('#ytmd_add_to_library').innerText = 'library_add'
                    }
                    document.querySelector('#btn_ytmd_add_to_library').classList.remove('hide');
                } else {
                    document.querySelector('#btn_ytmd_add_to_library').classList.add('hide');
                }
            }, 800)

            // Right ////////////////////////////////////////////////////////////////////////////////////
            // Lyrics
            var elementLyrics = document.createElement('i');
            elementLyrics.id = 'ytmd_lyrics';
            elementLyrics.title = __.trans('LYRICS');
            elementLyrics.classList.add('material-icons', 'pointer', 'ytmd-icons', 'hide');
            elementLyrics.innerText = 'music_note';

            elementLyrics.addEventListener('click', function() { ipcRenderer.send('window', { command: 'show-lyrics' }); } )
            playerBarRightControls.append(elementLyrics);

            if(${shortcutButtons['lyrics']}) {
                document.querySelector("#ytmd_lyrics").classList.remove("hide");
            }

            settingsProvider.onDidChange('settings-shortcut-buttons.lyrics', data => {
                if (data.newValue) {
                    document.querySelector("#ytmd_lyrics").classList.remove("hide");
                    document.querySelector("#ytmd_lyrics").classList.add("ytmd-icons");
                } else {
                    document.querySelector("#ytmd_lyrics").classList.add("hide");
                    document.querySelector("#ytmd_lyrics").classList.remove("ytmd-icons");
                }
            })

            // Miniplayer
            var elementMiniplayer = document.createElement('i');
            elementMiniplayer.id = 'ytmd_miniplayer';
            elementMiniplayer.title = __.trans('MINIPLAYER');
            elementMiniplayer.classList.add('material-icons', 'pointer', 'ytmd-icons', 'hide');
            elementMiniplayer.innerText = 'picture_in_picture_alt';

            elementMiniplayer.addEventListener('click', function() { ipcRenderer.send('window', { command: 'show-miniplayer' }); } )
            playerBarRightControls.append(elementMiniplayer);

            if(${shortcutButtons['miniplayer']}) {
                document.querySelector("#ytmd_miniplayer").classList.remove("hide");
            }

            settingsProvider.onDidChange('settings-shortcut-buttons.miniplayer', data => {
                if (data.newValue) {
                    document.querySelector("#ytmd_miniplayer").classList.remove("hide");
                    document.querySelector("#ytmd_miniplayer").classList.add("ytmd-icons");
                } else {
                    document.querySelector("#ytmd_miniplayer").classList.add("hide");
                    document.querySelector("#ytmd_miniplayer").classList.remove("ytmd-icons");
                }
            })
            `
        )
        .catch((_) =>
            ipcRenderer.send('log', {
                type: 'warn',
                data: 'error on createBottomPlayerBarContent',
            })
        )
}

function playerBarScrollToChangeVolume() {
    content
        .executeJavaScript(
            `
        var playerBar = document.getElementsByTagName('ytmusic-player-bar')[0];

        playerBar.addEventListener('wheel', function(ev) {
            ev.preventDefault();
            
            if ( ev.deltaY < 0) {
                ipcRenderer.send('media-command', { command: 'media-volume-up' });
            } else {
                ipcRenderer.send('media-command', { command: 'media-volume-down' });
            }
        });
    `
        )
        .catch((_) =>
            ipcRenderer.send('log', {
                type: 'warn',
                data: 'error on playerBarScrollToChangeVolume',
            })
        )
}

function createOffTheRoadContent() {
    content
        .executeJavaScript(
            `
        var body = document.getElementsByTagName('body')[0];

        var elementBack = document.createElement('i');
        elementBack.id = 'ytmd_lyrics';
        elementBack.classList.add('material-icons');
        elementBack.style.cursor = "pointer";
        elementBack.style.fontSize = '42px';
        elementBack.style.zIndex = '9999999';
        elementBack.style.position = 'fixed';
        elementBack.style.cssFloat = 'left';
        elementBack.style.boxShadow = "0 0 2px #111"
        elementBack.style.background = "#1D1D1D"
        elementBack.style.color = "#FFF"
        elementBack.innerText = 'arrow_back';

        elementBack.addEventListener('click', function() { ipcRenderer.send('reset-url') } )
        
        body.prepend(elementBack);
        `
        )
        .catch((_) =>
            ipcRenderer.send('log', {
                type: 'warn',
                data: 'error on createOffTheRoadContent',
            })
        )
}

function injectCast() {
    content
        .executeJavaScript(
            `
        // Todo
        `
        )
        .then((data) => {
            console.log(data)
        })
        .catch((err) => {
            console.log(err)
        })
}

function loadAudioOutputList() {
    navigator.mediaDevices.enumerateDevices().then((devices) => {
        audioDevices = devices.filter((device) => device.kind === 'audiooutput')

        ipcRenderer.send(
            'set-audio-output-list',
            audioDevices.length ? JSON.stringify(audioDevices) : []
        )
    })
}
