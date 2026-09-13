import polymerhook from "../polymerhook";

export function overrideHistoryButtonDisplay() {
  document.querySelector<HTMLElement>("#history-link .history-button").style = "display: inline-block !important;";
}

export async function hideChromecastButton() {
  polymerhook.ytmStore.dispatch({ type: "SET_CAST_AVAILABLE", payload: false });
}

export async function createAdditionalPlayerBarControls() {
  const ytmStore = polymerhook.ytmStore;
  const playerApi = polymerhook.ytmPlayerBar.playerApi;

  const ytmdControlButtons = {};

  let currentVideoId = "";

  let libraryFeedbackDefaultToken = "";
  let libraryFeedbackToggledToken = "";

  let sleepTimerTimeout = null;

  const libraryButton = document.createElement("yt-button-shape");
  libraryButton.classList.add("ytmd-player-bar-control");
  libraryButton.classList.add("library-button");
  const libraryButtonData = {
    focused: false,
    iconPosition: "icon-only",
    onTap: function () {
      const closePopupEvent = {
        bubbles: true,
        cancelable: false,
        composed: true,
        detail: {
          actionName: "yt-close-popups-action",
          args: [["ytmusic-menu-popup-renderer"]],
          optionalAction: false,
          returnValue: []
        }
      };
      const feedbackEvent = {
        bubbles: true,
        cancelable: false,
        composed: true,
        detail: {
          actionName: "yt-service-request",
          args: [
            this,
            {
              feedbackEndpoint: {
                feedbackToken: libraryButtonData.toggled ? libraryFeedbackToggledToken : libraryFeedbackDefaultToken
              }
            }
          ],
          optionalAction: false,
          returnValue: []
        }
      };
      this.dispatchEvent(new CustomEvent("yt-action", closePopupEvent));
      this.dispatchEvent(new CustomEvent("yt-action", feedbackEvent));
      polymerhook.ytmStore.dispatch({
        type: "SET_FEEDBACK_TOGGLE_STATE",
        payload: { defaultEndpointFeedbackToken: libraryFeedbackDefaultToken, isToggled: !libraryButtonData.toggled }
      });
    }.bind(libraryButton),
    style: "mono",
    toggled: false,
    toggleable: true,
    type: "text"
  };
  libraryButton.rawProps = {
    iconName: "yt-sys-icons:library_add",
    data: libraryButtonData
  };
  document
    .querySelector("ytmusic-app-layout>ytmusic-player-bar")
    .querySelector("ytmusic-like-button-renderer")
    .insertAdjacentElement("afterend", libraryButton);

  const playlistButton = document.createElement("yt-button-shape");
  playlistButton.classList.add("ytmd-player-bar-control");
  playlistButton.classList.add("playlist-button");
  const playlistButtonData = {
    focused: false,
    iconPosition: "icon-only",
    onTap: function () {
      const closePopupEvent = {
        bubbles: true,
        cancelable: false,
        composed: true,
        detail: {
          actionName: "yt-close-popups-action",
          args: [["ytmusic-menu-popup-renderer"]],
          optionalAction: false,
          returnValue: []
        }
      };
      const returnValue = [];
      const serviceRequestEvent = {
        bubbles: true,
        cancelable: false,
        composed: true,
        detail: {
          actionName: "yt-service-request",
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
      this.dispatchEvent(new CustomEvent("yt-action", closePopupEvent));
      this.dispatchEvent(new CustomEvent("yt-action", serviceRequestEvent));
      returnValue[0].ajaxPromise.then(
        response => {
          const addToPlaylistEvent = {
            bubbles: true,
            cancelable: false,
            composed: true,
            detail: {
              actionName: "yt-open-popup-action",
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
          this.dispatchEvent(new CustomEvent("yt-action", addToPlaylistEvent));
          this.dispatchEvent(new CustomEvent("yt-action", closePopupEvent));
        },
        () => {
          // service request errored
        },
        this
      );
    }.bind(playlistButton),
    style: "mono",
    toggled: false,
    type: "text"
  };
  playlistButton.rawProps = {
    iconName: "yt-sys-icons:playlist_add",
    data: playlistButtonData
  };
  libraryButton.insertAdjacentElement("afterend", playlistButton);

  playerApi.addEventListener("onVideoDataChange", event => {
    if (event.playertype === 1 && (event.type === "dataloaded" || event.type === "dataupdated")) {
      currentVideoId = playerApi.getPlayerResponse().videoDetails.videoId;
    }
  });

  const rightControls = document.querySelector("ytmusic-app-layout>ytmusic-player-bar").querySelector(".right-controls-buttons");
  const sleepTimerButton = document.createElement("yt-icon-button");

  const sleepTimerIcon = document.createElement("yt-icon");
  sleepTimerIcon.set("icon", "TIMER");
  sleepTimerButton.appendChild(sleepTimerIcon);

  sleepTimerButton.setAttribute("title", "Sleep timer off");
  sleepTimerButton.classList.add("ytmusic-player-bar");
  sleepTimerButton.classList.add("ytmd-player-bar-control");
  sleepTimerButton.classList.add("sleep-timer-button");
  sleepTimerButton.onclick = () => {
    sleepTimerButton.dispatchEvent(
      new CustomEvent("yt-action", {
        bubbles: true,
        cancelable: false,
        composed: true,
        detail: {
          actionName: "yt-open-popup-action",
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
                        }
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
                        }
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
                        }
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
                        }
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
                        }
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
                        }
                      },
                      sleepTimerTimeout !== null
                        ? {
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
                            }
                          }
                        : {}
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
      })
    );
  };
  rightControls.querySelector(".shuffle").insertAdjacentElement("afterend", sleepTimerButton);

  const humanizeTime = time => {
    // This is just a hacked together function to provide a humanization for the sleep timer. It serves no purpose outside that and isn't some complicated humanizer
    if (time === 1) return `${time} minute`;
    if (time > 1 && time < 60) return `${time} minutes`;
    if (time >= 60 && time < 120) return `${time / 60} hour`;
    if (time >= 120) return `${time / 60} hours`;
  };

  window.addEventListener("yt-action", e => {
    if (e.detail.actionName === "yt-service-request") {
      if (e.detail.args[1].ytmdSleepTimerServiceEndpoint) {
        if (sleepTimerTimeout !== null) {
          clearTimeout(sleepTimerTimeout);
          sleepTimerTimeout = null;
          if (sleepTimerButton.classList.contains("active")) {
            sleepTimerButton.classList.remove("active");
            sleepTimerButton.setAttribute("title", "Sleep timer off");
          }
        }

        if (e.detail.args[1].ytmdSleepTimerServiceEndpoint.time > 0) {
          if (!sleepTimerButton.classList.contains("active")) {
            sleepTimerButton.classList.add("active");
            sleepTimerButton.setAttribute("title", `Sleep timer ${humanizeTime(e.detail.args[1].ytmdSleepTimerServiceEndpoint.time)}`);
          }

          document.body.dispatchEvent(
            new CustomEvent("yt-action", {
              bubbles: true,
              cancelable: false,
              composed: true,
              detail: {
                actionName: "yt-open-popup-action",
                args: [
                  // Endpoint details
                  {
                    openPopupAction: {
                      popup: {
                        notificationActionRenderer: {
                          responseText: {
                            runs: [
                              {
                                text: `Sleep timer set to ${humanizeTime(e.detail.args[1].ytmdSleepTimerServiceEndpoint.time)}`
                              }
                            ]
                          }
                        }
                      },
                      popupType: "TOAST",
                      uniqueId: crypto.randomUUID()
                    }
                  },
                  document.querySelector("ytmusic-app")
                ],
                optionalAction: false,
                returnValue: []
              }
            })
          );

          sleepTimerTimeout = setTimeout(
            () => {
              sleepTimerTimeout = null;
              sleepTimerButton.classList.remove("active");
              sleepTimerButton.setAttribute("title", "Sleep timer off");

              if (document.querySelector("ytmusic-app-layout>ytmusic-player-bar").playing) {
                playerApi.pauseVideo();

                document.body.dispatchEvent(
                  new CustomEvent("yt-action", {
                    bubbles: true,
                    cancelable: false,
                    composed: true,
                    detail: {
                      actionName: "yt-open-popup-action",
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
                                ]
                              }
                            },
                            popupType: "DIALOG"
                          }
                        },
                        document.querySelector("ytmusic-app")
                      ],
                      optionalAction: false,
                      returnValue: []
                    }
                  })
                );
              }
            },
            e.detail.args[1].ytmdSleepTimerServiceEndpoint.time * 1000 * 60
          );
        } else {
          document.body.dispatchEvent(
            new CustomEvent("yt-action", {
              bubbles: true,
              cancelable: false,
              composed: true,
              detail: {
                actionName: "yt-open-popup-action",
                args: [
                  // Endpoint details
                  {
                    openPopupAction: {
                      popup: {
                        notificationActionRenderer: {
                          responseText: {
                            runs: [
                              {
                                text: `Sleep timer cleared`
                              }
                            ]
                          }
                        }
                      },
                      popupType: "TOAST",
                      uniqueId: crypto.randomUUID()
                    }
                  },
                  document.querySelector("ytmusic-app")
                ],
                optionalAction: false,
                returnValue: []
              }
            })
          );
        }
      }
    }
  });

  ytmStore.subscribe(() => {
    const state = ytmStore.getState();

    // Update library button for current data
    const currentMenu = document.querySelector("ytmusic-app-layout>ytmusic-player-bar").getMenuRenderer();
    if (currentMenu) {
      if (playlistButton.classList.contains("hidden")) {
        playlistButton.classList.remove("hidden");
      }

      let foundLibraryButton = false;
      for (let i = 0; i < currentMenu.items.length; i++) {
        const item = currentMenu.items[i];
        if (item.toggleMenuServiceItemRenderer) {
          if (
            item.toggleMenuServiceItemRenderer.defaultIcon.iconType === "LIBRARY_SAVED" ||
            item.toggleMenuServiceItemRenderer.defaultIcon.iconType === "LIBRARY_ADD"
          ) {
            foundLibraryButton = true;
            libraryFeedbackDefaultToken = item.toggleMenuServiceItemRenderer.defaultServiceEndpoint.feedbackEndpoint.feedbackToken;
            libraryFeedbackToggledToken = item.toggleMenuServiceItemRenderer.toggledServiceEndpoint.feedbackEndpoint.feedbackToken;

            if (
              state.toggleStates.feedbackToggleStates[libraryFeedbackDefaultToken] !== undefined &&
              state.toggleStates.feedbackToggleStates[libraryFeedbackDefaultToken] !== null
            ) {
              libraryButtonData.toggled = state.toggleStates.feedbackToggleStates[libraryFeedbackDefaultToken];
              libraryButton.setters.data(libraryButtonData);
            } else {
              libraryButtonData.toggled = false;
              libraryButton.setters.data(libraryButtonData);
            }

            if (item.toggleMenuServiceItemRenderer.defaultIcon.iconType === "LIBRARY_SAVED") {
              // Default value is saved to library (false == remove from library, true == add to library)
              if (libraryButtonData.toggled) {
                libraryButton.setters.iconName("yt-sys-icons:library_add");
              } else {
                libraryButton.setters.iconName("yt-sys-icons:library_saved");
              }
            } else if (item.toggleMenuServiceItemRenderer.defaultIcon.iconType === "LIBRARY_ADD") {
              // Default value is add to library (false == add to library, true == remove from library)
              if (libraryButtonData.toggled) {
                libraryButton.setters.iconName("yt-sys-icons:library_saved");
              } else {
                libraryButton.setters.iconName("yt-sys-icons:library_add");
              }
            }
            break;
          }
        }
      }

      if (!foundLibraryButton) {
        if (!libraryButton.classList.contains("hidden")) {
          libraryButton.classList.add("hidden");
        }
      } else {
        if (libraryButton.classList.contains("hidden")) {
          libraryButton.classList.remove("hidden");
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

  ytmdControlButtons.libraryButton = libraryButton;
}

export async function addTimedLyrics() {
  const ytmStore = polymerhook.ytmStore;
  const playerApi = polymerhook.ytmPlayerBar.playerApi;

  let currentLyricBrowseId = "";
  let currentTimedLyrics = null;
  let autoScrolling = false;
  let autoScrollPaused = false;
  let viewingLyricsTab = false;
  let ytmLyricTabContents = null;

  const timedLyricsContainer = document.createElement("div");
  timedLyricsContainer.classList.add("ytmd-lyrics");
  const timedLyricsSource = document.createElement("p");
  timedLyricsSource.classList.add("ytmd-lyrics-source");
  const timedLyricsYTMDNote = document.createElement("p");
  timedLyricsYTMDNote.classList.add("ytmd-lyrics-ytmdnote");
  timedLyricsYTMDNote.innerText = "Timed lyrics system provided by YTMDesktop";

  const returnToLiveContainer = document.createElement("div");
  returnToLiveContainer.classList.add("ytmd-lyrics-return-live-container");
  const returnToLive = document.createElement("yt-button-renderer");
  returnToLive.classList.add("ytmd-lyrics-return-live");
  returnToLive.data = {
    text: {
      runs: [
        {
          text: "Sync to video time"
        }
      ]
    },
    style: "STYLE_OVERLAY"
  };

  function enableAutoScroll() {
    autoScrollPaused = false;
    returnToLive.hidden = true;
  }

  function disableAutoScroll() {
    autoScrollPaused = true;
    returnToLive.hidden = false;
  }

  returnToLive.onClick = () => {
    enableAutoScroll();
    autoScrolling = true;
    timedLyricsContainer.querySelector(".active").scrollIntoView({
      behavior: "instant",
      block: "center",
      inline: "center"
    });
  };
  returnToLiveContainer.appendChild(returnToLive);

  const tabRenderer = document.querySelector("#player-page #tab-renderer");
  tabRenderer.addEventListener("scroll", () => {
    if (!viewingLyricsTab) return;
    if (autoScrolling) return;

    disableAutoScroll();
  });
  tabRenderer.addEventListener("scrollend", () => {
    if (!viewingLyricsTab) return;
    if (autoScrolling) {
      autoScrolling = false;
      return;
    }
  });

  async function getTimedLyrics() {
    try {
      // This is an anonymous request and could be broken by Google at any time
      const browseRes = await fetch("/youtubei/v1/browse", {
        method: "POST",
        body: JSON.stringify({
          browseId: currentLyricBrowseId,
          context: {
            client: {
              clientName: "ANDROID_MUSIC",
              clientVersion: "7.12.5"
            }
          }
        })
      });
      const json = await browseRes.json();

      // This is likely a timed lyrics response
      if (json.contents && json.contents.elementRenderer) {
        const timedLyrics = json.contents.elementRenderer.newElement.type.componentType.model.timedLyricsModel.lyricsData.timedLyricsData;
        const source = json.contents.elementRenderer.newElement.type.componentType.model.timedLyricsModel.lyricsData.sourceMessage;

        timedLyricsSource.innerText = source;

        const lyricElements = [];
        for (const lyric of timedLyrics) {
          const lyricElement = document.createElement("p");
          lyricElement.innerText = lyric.lyricLine;
          lyricElement.classList.add("ytmd-lyric-line");
          lyricElement.setAttribute("data-start-ms", lyric.cueRange.startTimeMilliseconds);
          lyricElement.setAttribute("data-end-ms", lyric.cueRange.endTimeMilliseconds);
          lyricElement.onclick = () => {
            enableAutoScroll();
            playerApi.seekTo(parseInt(lyric.cueRange.startTimeMilliseconds) / 1000);
          };
          lyricElements.push(lyricElement);
        }
        timedLyricsContainer.replaceChildren(...lyricElements);

        currentTimedLyrics = {
          timedLyrics,
          source
        };
      } else {
        currentTimedLyrics = null;
      }
    } catch {
      /* empty */
    }
  }

  function waitForElement(root, selector) {
    return new Promise(resolve => {
      if (root.querySelector(selector)) {
        return resolve(root.querySelector(selector));
      }

      const observer = new MutationObserver(() => {
        if (root.querySelector(selector)) {
          observer.disconnect();
          resolve(root.querySelector(selector));
        }
      });

      observer.observe(root, {
        childList: true,
        subtree: true
      });
    });
  }

  async function updateLyricsTab() {
    if (currentTimedLyrics) {
      const tabRenderer = document.querySelector("#player-page #tab-renderer");

      const contents = await waitForElement(tabRenderer, ".ytmusic-tab-renderer[page-type='MUSIC_PAGE_TYPE_TRACK_LYRICS'] > #contents");
      if (!ytmLyricTabContents) ytmLyricTabContents = Array.from(contents.children);
      contents.replaceChildren(timedLyricsContainer, timedLyricsSource, timedLyricsYTMDNote, returnToLiveContainer);
    }
  }

  // This could definitely be optimized far better
  function updateLyricLines(progress) {
    const msProgress = progress * 1000;
    for (const lyric of timedLyricsContainer.children) {
      const lyricStart = parseInt(lyric.getAttribute("data-start-ms"));
      const lyricEnd = parseInt(lyric.getAttribute("data-end-ms"));

      if (msProgress >= lyricStart && msProgress < lyricEnd) {
        if (!lyric.classList.contains("active")) {
          lyric.classList.add("active");
          if (!autoScrollPaused) {
            autoScrolling = true;
            lyric.scrollIntoView({
              behavior: "smooth",
              block: "center",
              inline: "center"
            });
          }
        }
      } else {
        if (lyric.classList.contains("active")) lyric.classList.remove("active");
      }
    }
  }

  ytmStore.subscribe(async () => {
    const state = ytmStore.getState();
    if (state.playerPage && state.playerPage.playerPageTabs) {
      let lyricsTab = -1;
      for (let i = 0; i < state.playerPage.playerPageTabs.length; i++) {
        const tab = state.playerPage.playerPageTabs[i];
        // Check if this is the Music Page Lyrics tab
        if (tab.tabRenderer?.endpoint?.browseEndpoint?.browseId.startsWith("MPLY")) {
          lyricsTab = i;
          break;
        }
      }

      const lyricBrowseId = state.playerPage.playerPageTabs[lyricsTab].tabRenderer.endpoint.browseEndpoint.browseId;
      if (currentLyricBrowseId !== lyricBrowseId) {
        currentLyricBrowseId = lyricBrowseId;
        enableAutoScroll();
        await getTimedLyrics();
      }

      if (state.playerPage.playerPageTabSelectedIndex === lyricsTab) {
        viewingLyricsTab = true;
        if (state.player.playerResponse.videoDetails.musicVideoType !== "MUSIC_VIDEO_TYPE_OMV") {
          await updateLyricsTab();
          enableAutoScroll();
          autoScrolling = true;
          timedLyricsContainer.querySelector(".active").scrollIntoView({
            behavior: "instant",
            block: "center",
            inline: "center"
          });
        } else {
          if (currentTimedLyrics) {
            const contents = await waitForElement(tabRenderer, ".ytmusic-tab-renderer[page-type='MUSIC_PAGE_TYPE_TRACK_LYRICS'] > #contents");
            contents.replaceChildren(...ytmLyricTabContents);
          }
        }
      } else if (state.playerPage.playerPageTabSelectedIndex !== lyricsTab) {
        viewingLyricsTab = false;
        ytmLyricTabContents = null;
      }
    }
  });

  playerApi.addEventListener("onVideoProgress", progress => {
    updateLyricLines(progress);
  });
}
