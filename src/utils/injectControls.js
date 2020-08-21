const { remote, ipcRenderer } = require('electron')

window.ipcRenderer = ipcRenderer
var content = remote.getCurrentWebContents()

content.addListener('dom-ready', function () {
    createContextMenu()

    content
        .executeJavaScript('window.location.hostname')
        .then((hostname) => {
            if (hostname == 'music.youtube.com') {
                createMiddleContent()
                createRightContent()
                playerBarScrollToChangeVolume()
                createPlayerBarContent()
            } else {
                createOffTheRoadContent()
            }
        })
        .catch((_) =>
            ipcRenderer.send('log', { type: 'error', data: 'error on inject' })
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

            min-width: 99px;
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
        }

        .pointer {
            cursor: pointer;
        }

        .ytmd-icons {
            margin: 0 18px 0 2px !important;
        }

        .ytmd-icons-middle {
            margin: 0 25px 0 0 !important;
        }

        .pointer:hover {
            color: #FFF !important;
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

    var menu = `<a id="ytmd-menu-lyrics"><i class="material-icons">music_note</i></a> <a id="ytmd-menu-miniplayer"><i class="material-icons">picture_in_picture_alt</i></a> <a id="ytmd-menu-bug-report"><i class="material-icons text-red">bug_report</i></a>`

    content
        .executeJavaScript(
            `
        var menuDiv = document.createElement("div");
        menuDiv.setAttribute('id', 'ytmd-menu');
        menuDiv.innerHTML = '${menu}';
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

function createMiddleContent() {
    content
        .executeJavaScript(
            `
                var center_content = document.getElementsByTagName('ytmusic-pivot-bar-renderer')[0];

                // HISTORY BACK
                var element = document.createElement('i');
                element.id = 'ytmd_history_back';
                element.classList.add('material-icons', 'pointer', 'ytmd-icons', 'center-content');
                element.style.color = '#666';
                element.innerText = 'keyboard_backspace';

                element.addEventListener('click', function() { history.go(-1); } )
                
                center_content.prepend(element);
            `
        )
        .catch((_) =>
            ipcRenderer.send('log', {
                type: 'warn',
                data: 'error on createMiddleContent',
            })
        )
}

function createRightContent() {
    // ADD BUTTONS TO RIGHT CONTENT (side to the photo)
    content
        .executeJavaScript(
            `
        var right_content = document.getElementById('right-content');

        // SETTINGS
        var elementSettings = document.createElement('i');
        elementSettings.id = 'ytmd_settings';
        elementSettings.classList.add('material-icons', 'pointer', 'ytmd-icons');
        elementSettings.style.color = '#909090';
        elementSettings.innerText = 'settings';

        elementSettings.addEventListener('click', function() { ipcRenderer.send('window', { command: 'show-settings' }); } )
        
        right_content.prepend(elementSettings);

        // UPDATE
        var element = document.createElement('i');
        element.id = 'ytmd_update';
        element.classList.add('material-icons', 'green-text', 'pointer', 'ytmd-icons', 'hide');
        element.style.color = '#4CAF50';
        element.innerText = 'arrow_downward';

        element.addEventListener('click', function() { ipcRenderer.send('btn-update-clicked', true); } )

        right_content.prepend(element);

        ipcRenderer.on('downloaded-new-update', function(e, data) {
            document.getElementById("ytmd_update").classList.remove("hide");
        } );`
        )
        .catch((_) =>
            ipcRenderer.send('log', {
                type: 'warn',
                data: 'error on createRightContent',
            })
        )
}

function createPlayerBarContent() {
    content
        .executeJavaScript(
            `
            var playerBarRightControls = document.querySelector('.right-controls-buttons.ytmusic-player-bar');
            var playerBarMiddleControls = document.querySelector('.middle-controls-buttons.ytmusic-player-bar');

            // Right ////////////////////////////////////////////////////////////////////////////////////
            // LYRICS
            var elementLyrics = document.createElement('i');
            elementLyrics.id = 'ytmd_lyrics';
            elementLyrics.classList.add('material-icons', 'pointer', 'ytmd-icons');
            elementLyrics.innerText = 'music_note';

            elementLyrics.addEventListener('click', function() { ipcRenderer.send('window', { command: 'show-lyrics'}); } )
            
            playerBarRightControls.append(elementLyrics);

            // MINIPLAYER
            var elementMiniplayer = document.createElement('i');
            elementMiniplayer.id = 'ytmd_miniplayer';
            elementMiniplayer.classList.add('material-icons', 'pointer', 'ytmd-icons');
            elementMiniplayer.innerText = 'picture_in_picture_alt';

            elementMiniplayer.addEventListener('click', function() { ipcRenderer.send('window', { command: 'show-miniplayer' }); } )
            playerBarRightControls.append(elementMiniplayer);

            // Middle ////////////////////////////////////////////////////////////////////////////////////
            // Add to Library
            var elementAddToLibrary = document.createElement('i');
            elementAddToLibrary.id = 'ytmd_add_to_library';
            elementAddToLibrary.classList.add('material-icons', 'pointer', 'ytmd-icons-middle');
            elementAddToLibrary.innerText = 'library_add';

            elementAddToLibrary.addEventListener('click', function() { 
                ipcRenderer.send('media-command', { command: 'media-add-library' }); 
            } )

            setInterval( () => {
                var popup = document.querySelector('.ytmusic-menu-popup-renderer');
                var addLibrary = popup.children[3];
                var _g = addLibrary.querySelector('g')
                var _path = _g.querySelectorAll('path')[1];
                var _d = _path.getAttribute('d')
                
                if(_d == 'M20 2H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-7.53 12L9 10.5l1.4-1.41 2.07 2.08L17.6 6 19 7.41 12.47 14zM4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6z') {
                    document.querySelector('#ytmd_add_to_library').innerText = 'check'
                } else {
                    document.querySelector('#ytmd_add_to_library').innerText = 'library_add'
                }
            }, 1000)
            playerBarMiddleControls.append(elementAddToLibrary);

            // Add to Playlist
            var elementAddToPlaylist = document.createElement('i');
            elementAddToPlaylist.id = 'ytmd_add_to_playlist';
            elementAddToPlaylist.classList.add('material-icons', 'pointer', 'ytmd-icons-middle');
            elementAddToPlaylist.innerText = 'playlist_add';

            elementAddToPlaylist.addEventListener('click', function() { 
                var popup = document.querySelector('.ytmusic-menu-popup-renderer');
                var addPlaylist = popup.children[5].querySelector('a');
                addPlaylist.click()
             } )
            playerBarMiddleControls.append(elementAddToPlaylist);
            `
        )
        .catch((_) =>
            ipcRenderer.send('log', {
                type: 'warn',
                data: 'error on createPlayerBarContent',
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
