import { contextBridge, ipcRenderer, webFrame } from "electron";
import Store from "../shared/store/renderer";
import { StoreSchema } from "../shared/store/schema";

const store = new Store<StoreSchema>();

contextBridge.exposeInMainWorld('ytmd', {
    sendVideoProgress: (volume: number) => ipcRenderer.send('ytmView:videoProgressChanged', volume),
    sendVideoState: (state: number) => ipcRenderer.send('ytmView:videoStateChanged', state),
    sendVideoData: (videoDetails: any, playlistId: string) => ipcRenderer.send('ytmView:videoDataChanged', videoDetails, playlistId),
    sendAdState: (adRunning: boolean) => ipcRenderer.send('ytmView:adStateChanged', adRunning),
    sendStoreUpdate: (queueState: any) => ipcRenderer.send('ytmView:storeStateChanged', queueState)
})

function createStyleSheet() {
    const css = document.createElement('style')
    css.appendChild(document.createTextNode(
        `
        .ytmd-history-back, .ytmd-history-forward {
            cursor: pointer;
            margin: 0 18px 0 2px;
            font-size: 24px;
            color: rgba(255, 255, 255, 0.5);
        }

        .ytmd-history-back.pivotbar, .ytmd-history-forward.pivotbar {
            padding-top: 12px;
        }

        .ytmd-history-forward {
            transform: rotate(180deg);
        }

        .ytmd-history-back.disabled, .ytmd-history-forward.disabled {
            cursor: not-allowed;
        }

        .ytmd-history-back:hover:not(.disabled), .ytmd-history-forward:hover:not(.disabled) {
            color: #FFFFFF;
        }

        .ytmd-hidden {
            display: none;
        }

        .ytmd-persist-volume-slider {
            opacity: 1 !important;
            pointer-events: initial !important;
        }
        
        .ytmd-player-bar-control.library-button {
            margin-left: 8px;
        }

        .ytmd-player-bar-control.library-button.hidden {
            display: none;
        }

        .ytmd-player-bar-control.playlist-button {
            margin-left: 8px;
        }

        .ytmd-player-bar-control.playlist-button.hidden {
            display: none;
        }

        .ytmd-player-bar-control.sleep-timer-button.active {
            color: #FFFFFF;
        }
        `
    ))
    document.head.appendChild(css);
}

function createMaterialSymbolsLink() {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,100,0,0'
    return link;
}

function createNavigationMenuArrows() {
    // Go back in history
    const historyBackElement = document.createElement('span');
    historyBackElement.classList.add('material-symbols-outlined', 'ytmd-history-back', 'disabled');
    historyBackElement.innerText = 'keyboard_backspace';

    historyBackElement.addEventListener('click', function () {
        if (!historyBackElement.classList.contains('disabled')) {
            history.back();
        }
    });

    // Go forward in history
    const historyForwardElement = document.createElement('span');
    historyForwardElement.classList.add('material-symbols-outlined', 'ytmd-history-forward', 'disabled');
    historyForwardElement.innerText = 'keyboard_backspace';

    historyForwardElement.addEventListener('click', function () {
        if (!historyForwardElement.classList.contains('disabled')) {
            history.forward();
        }
    });

    ipcRenderer.on('ytmView:navigationStateChanged', (event, state) => {
        if (state.canGoBack) {
            historyBackElement.classList.remove('disabled');
        } else {
            historyBackElement.classList.add('disabled');
        }

        if (state.canGoForward) {
            historyForwardElement.classList.remove('disabled');
        } else {
            historyForwardElement.classList.add('disabled');
        }
    })

    const pivotBar = document.querySelector("ytmusic-pivot-bar-renderer");
    if (!pivotBar) {
        // New YTM UI
        const searchBar = document.querySelector("ytmusic-search-box");
        const navBar = searchBar.parentNode;
        navBar.insertBefore(historyForwardElement, searchBar);
        navBar.insertBefore(historyBackElement, historyForwardElement);
    } else {
        historyForwardElement.classList.add("pivotbar");
        historyBackElement.classList.add("pivotbar");
        pivotBar.prepend(historyForwardElement);
        pivotBar.prepend(historyBackElement);
    }
}

function createKeyboardNavigation() {
    const keyboardNavigation = document.createElement('div');
    keyboardNavigation.tabIndex = 32767;
    keyboardNavigation.onfocus = () => {
        keyboardNavigation.blur();
        ipcRenderer.send('ytmView:switchFocus', 'main')
    }
    document.body.appendChild(keyboardNavigation);
}

function createAdditionalPlayerBarControls() {
    webFrame.executeJavaScript(`
        window.ytmdControlButtons = {};
        
        let currentVideoId = "";

        let libraryFeedbackDefaultToken = "";
        let libraryFeedbackToggledToken = "";

        let sleepTimerTimeout = null;

        let libraryButton = document.createElement("yt-button-shape");
        libraryButton.classList.add("ytmd-player-bar-control");
        libraryButton.classList.add("library-button");
        libraryButton.set('data', {
            focused: false,
            iconPosition: "icon-only",
            onTap: function() {
                var closePopoupEvent = {
                    bubbles: true,
                    cancelable: false,
                    composed: true,
                    detail: {
                        actionName: 'yt-close-popups-action',
                        args: [
                            ['ytmusic-menu-popup-renderer']
                        ],
                        optionalAction: false,
                        returnValue: []
                    }
                };
                var feedbackEvent = {
                    bubbles: true,
                    cancelable: false,
                    composed: true,
                    detail: {
                        actionName: 'yt-service-request',
                        args: [
                            this,
                            {
                                feedbackEndpoint: {
                                    feedbackToken: this.data.toggled ? libraryFeedbackToggledToken : libraryFeedbackDefaultToken
                                }
                            }
                        ],
                        optionalAction: false,
                        returnValue: []
                    }
                };
                this.dispatchEvent(new CustomEvent('yt-action', closePopoupEvent));
                this.dispatchEvent(new CustomEvent('yt-action', feedbackEvent));
                window.ytmdPlayerBar.store.dispatch({ type: "SET_FEEDBACK_TOGGLE_STATE", payload: { defaultEndpointFeedbackToken: libraryFeedbackDefaultToken, isToggled: !this.data.toggled } })
            }.bind(libraryButton),
            style: "mono",
            toggled: false,
            type: "text"
        });
        window.ytmdPlayerBar.querySelector("ytmusic-like-button-renderer").insertAdjacentElement("afterend", libraryButton);

        let playlistButton = document.createElement("yt-button-shape");
        playlistButton.classList.add("ytmd-player-bar-control");
        playlistButton.classList.add("playlist-button");
        playlistButton.set('icon', "yt-sys-icons:playlist_add");
        playlistButton.set('data', {
            focused: false,
            iconPosition: "icon-only",
            onTap: function() {
                var closePopoupEvent = {
                    bubbles: true,
                    cancelable: false,
                    composed: true,
                    detail: {
                        actionName: 'yt-close-popups-action',
                        args: [
                            ['ytmusic-menu-popup-renderer']
                        ],
                        optionalAction: false,
                        returnValue: []
                    }
                };
                var returnValue = []
                var serviceRequestEvent = {
                    bubbles: true,
                    cancelable: false,
                    composed: true,
                    detail: {
                        actionName: 'yt-service-request',
                        args: [
                            this,
                            {
                                addToPlaylistEndpoint: {
                                    videoId: currentVideoId
                                }
                            }
                        ],
                        optionalAction: false,
                        returnValue
                    }
                };
                this.dispatchEvent(new CustomEvent('yt-action', closePopoupEvent));
                this.dispatchEvent(new CustomEvent('yt-action', serviceRequestEvent));
                returnValue[0].ajaxPromise.then((response) => {
                    var addToPlaylistEvent = {
                        bubbles: true,
                        cancelable: false,
                        composed: true,
                        detail: {
                            actionName: 'yt-open-popup-action',
                            args: [
                                {
                                    openPopupAction: {
                                        popup: {
                                            addToPlaylistRenderer: response.data.contents[0].addToPlaylistRenderer
                                        },
                                        popupType: "DIALOG"
                                    }
                                },
                                this
                            ],
                            optionalAction: false,
                            returnValue: []
                        }
                    };
                    this.dispatchEvent(new CustomEvent('yt-action', addToPlaylistEvent));
                    this.dispatchEvent(new CustomEvent('yt-action', closePopoupEvent));
                }, () => {
                    // service request errored
                }, this);
            }.bind(playlistButton),
            style: "mono",
            toggled: false,
            type: "text"
        });
        libraryButton.insertAdjacentElement("afterend", playlistButton);

        window.ytmdPlayerBar.playerApi_.addEventListener('onVideoDataChange', (event) => {
            if (event.type === 'dataloaded' && event.playertype === 1) {
                currentVideoId = window.ytmdPlayerBar.playerApi_.getPlayerResponse().videoDetails.videoId;
            }
        });

        let rightControls = document.querySelector("ytmusic-player-bar").querySelector(".right-controls-buttons");
        let sleepTimerButton = document.createElement("tp-yt-paper-icon-button");
        sleepTimerButton.setAttribute("title", "Sleep timer off");
        sleepTimerButton.classList.add("ytmusic-player-bar");
        sleepTimerButton.classList.add("ytmd-player-bar-control");
        sleepTimerButton.classList.add("sleep-timer-button");
        sleepTimerButton.set("icon", "yt-sys-icons:stopwatch");
        sleepTimerButton.onclick = () => {
            sleepTimerButton.dispatchEvent(new CustomEvent('yt-action', {
                bubbles: true,
                cancelable: false,
                composed: true,
                detail: {
                    actionName: 'yt-open-popup-action',
                    args: [
                        {
                            openPopupAction: {
                                popup: {
                                    menuPopupRenderer: {
                                        accessibilityData: {
                                            label: "Action menu"
                                        },
                                        items: [
                                            {
                                                menuServiceItemRenderer: {
                                                    icon: {
                                                        iconType: "CLOCK"
                                                    },
                                                    serviceEndpoint: {
                                                        ytmdSleepTimerServiceEndpoint: {
                                                            time: 5
                                                        }
                                                    },
                                                    text: {
                                                        runs: [
                                                            {
                                                                text: "5 minutes"
                                                            }
                                                        ]
                                                    }
                                                },
                                            },
                                            {
                                                menuServiceItemRenderer: {
                                                    icon: {
                                                        iconType: "CLOCK"
                                                    },
                                                    serviceEndpoint: {
                                                        ytmdSleepTimerServiceEndpoint: {
                                                            time: 10
                                                        }
                                                    },
                                                    text: {
                                                        runs: [
                                                            {
                                                                text: "10 minutes"
                                                            }
                                                        ]
                                                    }
                                                },
                                            },
                                            {
                                                menuServiceItemRenderer: {
                                                    icon: {
                                                        iconType: "CLOCK"
                                                    },
                                                    serviceEndpoint: {
                                                        ytmdSleepTimerServiceEndpoint: {
                                                            time: 15
                                                        }
                                                    },
                                                    text: {
                                                        runs: [
                                                            {
                                                                text: "15 minutes"
                                                            }
                                                        ]
                                                    }
                                                },
                                            },
                                            {
                                                menuServiceItemRenderer: {
                                                    icon: {
                                                        iconType: "CLOCK"
                                                    },
                                                    serviceEndpoint: {
                                                        ytmdSleepTimerServiceEndpoint: {
                                                            time: 30
                                                        }
                                                    },
                                                    text: {
                                                        runs: [
                                                            {
                                                                text: "30 minutes"
                                                            }
                                                        ]
                                                    }
                                                },
                                            },
                                            {
                                                menuServiceItemRenderer: {
                                                    icon: {
                                                        iconType: "CLOCK"
                                                    },
                                                    serviceEndpoint: {
                                                        ytmdSleepTimerServiceEndpoint: {
                                                            time: 45
                                                        }
                                                    },
                                                    text: {
                                                        runs: [
                                                            {
                                                                text: "45 minutes"
                                                            }
                                                        ]
                                                    }
                                                },
                                            },
                                            {
                                                menuServiceItemRenderer: {
                                                    icon: {
                                                        iconType: "CLOCK"
                                                    },
                                                    serviceEndpoint: {
                                                        ytmdSleepTimerServiceEndpoint: {
                                                            time: 60
                                                        }
                                                    },
                                                    text: {
                                                        runs: [
                                                            {
                                                                text: "1 hour"
                                                            }
                                                        ]
                                                    }
                                                },
                                            },
                                            (sleepTimerTimeout !== null) ? {
                                                menuServiceItemRenderer: {
                                                    icon: {
                                                        iconType: "DELETE"
                                                    },
                                                    serviceEndpoint: {
                                                        ytmdSleepTimerServiceEndpoint: {
                                                            time: 0
                                                        }
                                                    },
                                                    text: {
                                                        runs: [
                                                            {
                                                                text: "Clear sleep timer"
                                                            }
                                                        ]
                                                    }
                                                },
                                            } : {}
                                        ]
                                    }
                                },
                                popupType: "DROPDOWN"
                            }
                        },
                        sleepTimerButton
                    ],
                    optionalAction: false,
                    returnValue: []
                }
            }));
        };
        rightControls.querySelector(".shuffle").insertAdjacentElement("afterend", sleepTimerButton);
        
        window.addEventListener("yt-action", (e) => {
            if (e.detail.actionName === "yt-service-request") {
                if (e.detail.args[1].ytmdSleepTimerServiceEndpoint) {
                    if (sleepTimerTimeout !== null) {
                        clearTimeout(sleepTimerTimeout);
                        sleepTimerTimeout = null;
                        if (sleepTimerButton.classList.contains("active")) {
                            sleepTimerButton.classList.remove("active");
                            sleepTimerButton.setAttribute("title", "Sleep timer off")
                        }
                    }

                    if (e.detail.args[1].ytmdSleepTimerServiceEndpoint.time > 0) {
                        if (!sleepTimerButton.classList.contains("active")) {
                            sleepTimerButton.classList.add("active")
                            sleepTimerButton.setAttribute("title", "Sleep timer " + e.detail.args[1].ytmdSleepTimerServiceEndpoint.time + " minutes")
                        }

                        sleepTimerTimeout = setTimeout(() => {
                            sleepTimerTimeout = null;
                            sleepTimerButton.classList.remove("active");
                            sleepTimerButton.setAttribute("title", "Sleep timer off");

                            if (window.ytmdPlayerBar.playing_) {
                                window.ytmdPlayerBar.playerApi_.pauseVideo()

                                document.body.dispatchEvent(new CustomEvent('yt-action', {
                                    bubbles: true,
                                    cancelable: false,
                                    composed: true,
                                    detail: {
                                        actionName: 'yt-open-popup-action',
                                        args: [
                                            {
                                                openPopupAction: {
                                                    popup: {
                                                        dismissableDialogRenderer: {
                                                            title: {
                                                                runs: [
                                                                    {
                                                                        text: "Music paused"
                                                                    }
                                                                ]
                                                            },
                                                            dialogMessages: [
                                                                {
                                                                    runs: [
                                                                        {
                                                                            text: "Sleep timer expired and your music has been paused"
                                                                        }
                                                                    ]
                                                                }
                                                            ],
                                                        }
                                                    },
                                                    popupType: "DIALOG",
                                                }
                                            },
                                            document.querySelector("ytmusic-app")
                                        ],
                                        optionalAction: false,
                                        returnValue: []
                                    }
                                }));
                            }
                        }, (e.detail.args[1].ytmdSleepTimerServiceEndpoint.time * 1000) * 60);
                    }
                }
            }
        });

        window.ytmdPlayerBar.store.subscribe(() => {
            let state = window.ytmdPlayerBar.store.getState();

            // Update library button for current data
            const currentMenu = window.ytmdPlayerBar.getMenuRenderer();
            if (currentMenu) {
                if (playlistButton.classList.contains("hidden")) {
                    playlistButton.classList.remove("hidden");
                }

                for (let i = 0; i < currentMenu.items.length; i++) {
                    const item = currentMenu.items[i];
                    if (item.toggleMenuServiceItemRenderer) {
                        if (item.toggleMenuServiceItemRenderer.defaultIcon.iconType === "LIBRARY_SAVED" || item.toggleMenuServiceItemRenderer.defaultIcon.iconType === "LIBRARY_ADD") {
                            libraryFeedbackDefaultToken = item.toggleMenuServiceItemRenderer.defaultServiceEndpoint.feedbackEndpoint.feedbackToken;
                            libraryFeedbackToggledToken = item.toggleMenuServiceItemRenderer.toggledServiceEndpoint.feedbackEndpoint.feedbackToken;

                            if (state.toggleStates.feedbackToggleStates[libraryFeedbackDefaultToken] !== undefined && state.toggleStates.feedbackToggleStates[libraryFeedbackDefaultToken] !== null) {
                                libraryButton.set("data.toggled", state.toggleStates.feedbackToggleStates[libraryFeedbackDefaultToken]);
                            } else {
                                libraryButton.set("data.toggled", false);
                            }
    
                            if (item.toggleMenuServiceItemRenderer.defaultIcon.iconType === "LIBRARY_SAVED") {
                                // Default value is saved to library (false == remove from library, true == add to library)
                                if (libraryButton.data.toggled) {
                                    libraryButton.set("icon", "yt-sys-icons:library_add");
                                } else {
                                    libraryButton.set("icon", "yt-sys-icons:library_saved");
                                }
                            } else if (item.toggleMenuServiceItemRenderer.defaultIcon.iconType === "LIBRARY_ADD") {
                                // Default value is add to library (false == add to library, true == remove from library)
                                if (libraryButton.data.toggled) {
                                    libraryButton.set("icon", "yt-sys-icons:library_saved");
                                } else {
                                    libraryButton.set("icon", "yt-sys-icons:library_add");
                                }
                            }

                            if (libraryButton.classList.contains("hidden")) {
                                libraryButton.classList.remove("hidden");
                            }

                            break;
                        }
                    }
                }
            } else {
                if (!libraryButton.classList.contains("hidden")) {
                    libraryButton.classList.add("hidden");
                }
                if (!playlistButton.classList.contains("hidden")) {
                    playlistButton.classList.add("hidden");
                }
            }
        });

        window.ytmdControlButtons.libraryButton = libraryButton;
    `);
}

function hideChromecastButton() {
    webFrame.executeJavaScript(`
        window.ytmdPlayerBar.store.dispatch({ type: 'SET_CAST_AVAILABLE', payload: false });
    `);
}

function hookPlayerApiEvents() {
    webFrame.executeJavaScript(`
        window.ytmdPlayerBar.playerApi_.addEventListener('onVideoProgress', (progress) => { window.ytmd.sendVideoProgress(progress) });
        window.ytmdPlayerBar.playerApi_.addEventListener('onStateChange', (state) => { window.ytmd.sendVideoState(state) });
        window.ytmdPlayerBar.playerApi_.addEventListener('onVideoDataChange', (event) => { if (event.type === 'dataloaded' && event.playertype === 1) { window.ytmd.sendVideoData(window.ytmdPlayerBar.playerApi_.getPlayerResponse().videoDetails, window.ytmdPlayerBar.playerApi_.getPlaylistId()) } });
        window.ytmdPlayerBar.playerApi_.addEventListener('onAdStart', () => { window.ytmd.sendAdState(true) });
        window.ytmdPlayerBar.playerApi_.addEventListener('onAdEnd', () => { window.ytmd.sendAdState(false) });
        window.ytmdPlayerBar.store.subscribe(() => {
            // We don't want to see everything in the store as there can be some sensitive data so we only send what's necessary to operate
            let state = window.ytmdPlayerBar.store.getState();
            window.ytmd.sendStoreUpdate(state.queue)
        })
    `);
}

window.addEventListener('load', async () => {
    if (window.location.hostname !== "music.youtube.com") {
        if (window.location.hostname === 'consent.youtube.com') {
            ipcRenderer.send('ytmView:loaded');
        }
        return;
    }

    let materialSymbolsLoaded = false;

    const materialSymbols = createMaterialSymbolsLink();
    materialSymbols.onload = () => {
        materialSymbolsLoaded = true;
    }
    document.head.appendChild(materialSymbols);

    await new Promise<void>((resolve) => {
        const interval = setInterval(async () => {
            const playerApiReady: boolean = await webFrame.executeJavaScript(`
                document.querySelector("ytmusic-player-bar").playerApi_.isReady();
            `);

            if (materialSymbolsLoaded && playerApiReady) {
                clearInterval(interval);
                resolve();
            }
        }, 250);
    });

    await webFrame.executeJavaScript(`
        window.ytmdPlayerBar = document.querySelector("ytmusic-player-bar");
    `);

    createStyleSheet();
    createNavigationMenuArrows();
    createKeyboardNavigation();
    createAdditionalPlayerBarControls();
    hideChromecastButton();
    hookPlayerApiEvents();

    const state = await store.get('state');
    const continueWhereYouLeftOff = (await store.get('playback')).continueWhereYouLeftOff;
    const continueWhereYouLeftOffPaused = (await store.get('playback')).continueWhereYouLeftOffPaused;

    if (continueWhereYouLeftOff) {
        // The last page the user was on is already a page where it will be playing a song from (no point telling YTM to play it again)
        if (!state.lastUrl.startsWith("https://music.youtube.com/watch") && state.lastVideoId) {
            document.dispatchEvent(new CustomEvent('yt-navigate', {
                detail: {
                    endpoint: {
                        watchEndpoint: {
                            videoId: state.lastVideoId,
                            playlistId: state.lastPlaylistId
                        }
                    }
                }
            }));

            if (continueWhereYouLeftOffPaused) {
                webFrame.executeJavaScript(`
                    // The reason we wait for video data to appear before pausing instead of pausing immediately is because the YTM UI will have a missing play/pause button icon
                    let callback = (event) => {
                        if (event.type === 'dataloaded' && event.playertype === 1) {
                            window.ytmdPlayerBar.playerApi_.pauseVideo();
                            window.ytmdPlayerBar.playerApi_.removeEventListener('onVideoDataChange', callback);
                        }
                    }
                    window.ytmdPlayerBar.playerApi_.addEventListener('onVideoDataChange', callback);
                `);
            }
        } else {
            webFrame.executeJavaScript(`
                window.ytmd.sendVideoData(window.ytmdPlayerBar.playerApi_.getPlayerResponse().videoDetails, window.ytmdPlayerBar.playerApi_.getPlaylistId());
            `);
        }
    }

    const alwaysShowVolumeSlider = (await store.get('general')).alwaysShowVolumeSlider;
    if (alwaysShowVolumeSlider) {
        document.querySelector("#volume-slider").classList.add("ytmd-persist-volume-slider");
    }

    ipcRenderer.on('remoteControl:execute', async (event, command, value) => {
        
        switch (command) {
            case 'playPause':
                {
                    webFrame.executeJavaScript(`
                        window.ytmdPlayerBar.playing_ ? window.ytmdPlayerBar.playerApi_.pauseVideo() : window.ytmdPlayerBar.playerApi_.playVideo();
                    `);
                    break;
                }

            case 'play':
                {
                    webFrame.executeJavaScript(`
                        window.ytmdPlayerBar.playerApi_.playVideo();
                    `);
                    break;
                }

            case 'pause':
                {
                    webFrame.executeJavaScript(`
                        window.ytmdPlayerBar.playerApi_.pauseVideo();
                    `);
                    break;
                }
            
            case 'next':
                {
                    webFrame.executeJavaScript(`
                        window.ytmdPlayerBar.playerApi_.nextVideo();
                    `);
                    break;
                }

            case 'previous':
                {
                    webFrame.executeJavaScript(`
                        window.ytmdPlayerBar.playerApi_.previousVideo();
                    `);
                    break;
                }

            case 'thumbsUp':
                // TODO
                break;

            case 'thumbsDown':
                // TODO
                break;

            case 'volumeUp':
                {
                    const currentVolumeUp: number = await webFrame.executeJavaScript(`
                        window.ytmdPlayerBar.playerApi_.getVolume();
                    `);

                    let newVolumeUp = currentVolumeUp + 10;
                    if (currentVolumeUp > 100) {
                        newVolumeUp = 100;
                    }
                    webFrame.executeJavaScript(`
                        window.ytmdPlayerBar.playerApi_.setVolume(${newVolumeUp});
                        window.ytmdPlayerBar.store.dispatch({ type: 'SET_VOLUME', payload: ${newVolumeUp} });
                    `);
                    break;
                }

            case 'volumeDown':
                {
                    const currentVolumeDown: number = await webFrame.executeJavaScript(`
                        window.ytmdPlayerBar.playerApi_.getVolume();
                    `);

                    let newVolumeDown = currentVolumeDown - 10;
                    if (currentVolumeDown < 0) {
                        newVolumeDown = 0;
                    }
                    webFrame.executeJavaScript(`
                        window.ytmdPlayerBar.playerApi_.setVolume(${newVolumeDown});
                        window.ytmdPlayerBar.store.dispatch({ type: 'SET_VOLUME', payload: ${newVolumeDown} });
                    `);
                    break;
                }

            case 'setVolume':
                {
                    const valueInt: number = parseInt(value);
                    // Check if Volume is a number and between 0 and 100
                    if (isNaN(valueInt) || valueInt < 0 || valueInt > 100) {
                        return;
                    }

                    webFrame.executeJavaScript(`
                        window.ytmdPlayerBar.playerApi_.setVolume(${valueInt});
                        window.ytmdPlayerBar.store.dispatch({ type: 'SET_VOLUME', payload: ${valueInt} });
                    `);
                    break;
                }

            
            case 'mute':
                webFrame.executeJavaScript(`
                    window.ytmdPlayerBar.playerApi_.mute();
                    window.ytmdPlayerBar.store.dispatch({ type: 'SET_MUTED', payload: true });
                `);
                break;

            case 'unmute':
                webFrame.executeJavaScript(`
                    window.ytmdPlayerBar.playerApi_.unMute();
                    window.ytmdPlayerBar.store.dispatch({ type: 'SET_MUTED', payload: false });
                `);
                break;


            case 'navigate':
                {
                    const endpoint = value;
                    document.dispatchEvent(new CustomEvent('yt-navigate', {
                        detail: {
                            endpoint
                        }
                    }));
                    break;
                }
        }
    });

    store.onDidAnyChange((newState) => {
        if (newState.general.alwaysShowVolumeSlider) {
            const volumeSlider = document.querySelector("#volume-slider")
            if (!volumeSlider.classList.contains("persist-volume-slider")) {
                volumeSlider.classList.add("persist-volume-slider")
            }
        } else {
            const volumeSlider = document.querySelector("#volume-slider")
            if (volumeSlider.classList.contains("persist-volume-slider")) {
                volumeSlider.classList.remove("persist-volume-slider")
            }
        }
    });

    ipcRenderer.send('ytmView:loaded');
});