/* eslint-disable @typescript-eslint/no-unused-expressions */
(function () {
  function isExperimentEnabled(experimentFlag) {
    const flag = window.ytcfg.data_.EXPERIMENT_FLAGS[experimentFlag];
    if (flag && typeof flag === "string") return flag === "false" ? false : true;
    return !!flag;
  }

  const ytmStore = window.__YTMD_HOOK__.ytmStore;

  let ytmdControlButtons = {};

  let currentVideoId = "";

  let libraryFeedbackDefaultToken = "";
  let libraryFeedbackToggledToken = "";

  let sleepTimerTimeout = null;

  let libraryButton = document.createElement("yt-button-shape");
  libraryButton.classList.add("ytmd-player-bar-control");
  libraryButton.classList.add("library-button");
  let libraryButtonData = {
    focused: false,
    iconPosition: "icon-only",
    onTap: function () {
      var closePopupEvent = {
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
      var feedbackEvent = {
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
      window.__YTMD_HOOK__.ytmStore.dispatch({
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
  const likeButton = document.querySelector("ytmusic-like-button-renderer");
  if (likeButton) {
    likeButton.insertAdjacentElement("afterend", libraryButton);
  }

  let playlistButton = document.createElement("yt-button-shape");
  playlistButton.classList.add("ytmd-player-bar-control");
  playlistButton.classList.add("playlist-button");
  let playlistButtonData = {
    focused: false,
    iconPosition: "icon-only",
    onTap: function () {
      var closePopupEvent = {
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
      var returnValue = [];
      var serviceRequestEvent = {
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
          var addToPlaylistEvent = {
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
  if (likeButton) {
    libraryButton.insertAdjacentElement("afterend", playlistButton);
  }

  window.__YTMD_HOOK__.ytmPlayerBar.playerApi.addEventListener("onVideoDataChange", event => {
    if (event.playertype === 1 && (event.type === "dataloaded" || event.type === "dataupdated")) {
      currentVideoId = window.__YTMD_HOOK__.ytmPlayerBar.playerApi.getPlayerResponse().videoDetails.videoId;
    }
  });

  let rightControls = document.querySelector(".right-controls-buttons, ytmusic-player-bar, ytmusic-player-controls");
  let sleepTimerButton = document.createElement("yt-icon-button");

  let sleepTimerIcon = document.createElement("yt-icon");
  sleepTimerIcon.set("icon", "TIMER");
  sleepTimerButton.appendChild(sleepTimerIcon);

  sleepTimerButton.setAttribute("title", "Sleep timer off");
  sleepTimerButton.classList.add("ytmusic-player-bar");
  sleepTimerButton.classList.add("ytmusic-player-controls");
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
  const shuffleButton = rightControls?.querySelector(".shuffle") || document.querySelector(".shuffle");
  if (shuffleButton) {
    shuffleButton.insertAdjacentElement("afterend", sleepTimerButton);
  } else if (rightControls) {
    rightControls.appendChild(sleepTimerButton);
  }

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

              const playerBar = document.querySelector("ytmusic-app-layout>ytmusic-player-bar") || document.querySelector("ytmusic-player-controls");
              let isPlaying = false;
              if (playerBar && typeof playerBar.playing === "boolean") {
                isPlaying = playerBar.playing;
              } else if (window.__YTMD_HOOK__ && window.__YTMD_HOOK__.ytmPlayerBar && window.__YTMD_HOOK__.ytmPlayerBar.playerApi && typeof window.__YTMD_HOOK__.ytmPlayerBar.playerApi.getPlayerState === "function") {
                isPlaying = window.__YTMD_HOOK__.ytmPlayerBar.playerApi.getPlayerState() === 1;
              }

              if (isPlaying) {
                window.__YTMD_HOOK__.ytmPlayerBar.playerApi.pauseVideo();

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
    try {
      let state = ytmStore.getState();

      // Update library button for current data
      const playerBar = document.querySelector("ytmusic-player-bar, ytmusic-player-controls");
      let currentMenu = null;
      try {
        if (playerBar && playerBar.data && playerBar.data.menu && typeof playerBar.getMenuRenderer === "function") {
          currentMenu = playerBar.getMenuRenderer();
        } else if (window.__YTMD_HOOK__?.ytmPlayerBar?.data?.menu && typeof window.__YTMD_HOOK__.ytmPlayerBar.getMenuRenderer === "function") {
          currentMenu = window.__YTMD_HOOK__.ytmPlayerBar.getMenuRenderer();
        }
      } catch {
        currentMenu = null;
      }
      if (!currentMenu) {
        const menuElem = (
          playerBar?.querySelector?.("ytmusic-menu-renderer") ||
          document.querySelector("ytmusic-player-controls ytmusic-menu-renderer, ytmusic-player-bar ytmusic-menu-renderer")
        );
        currentMenu = menuElem?.data || menuElem?.inst?.data || null;
      }
      if (currentMenu && Array.isArray(currentMenu.items)) {
        if (playlistButton.classList.contains("hidden")) {
          playlistButton.classList.remove("hidden");
        }

        let foundLibraryButton = false;
        for (let i = 0; i < currentMenu.items.length; i++) {
          const item = currentMenu.items[i];
          if (item?.toggleMenuServiceItemRenderer) {
            if (
              item.toggleMenuServiceItemRenderer.defaultIcon?.iconType === "BOOKMARK_BORDER" ||
              item.toggleMenuServiceItemRenderer.defaultIcon?.iconType === "BOOKMARK"
            ) {
              foundLibraryButton = true;
              libraryFeedbackDefaultToken = item.toggleMenuServiceItemRenderer.defaultServiceEndpoint?.feedbackEndpoint?.feedbackToken;
              libraryFeedbackToggledToken = item.toggleMenuServiceItemRenderer.toggledServiceEndpoint?.feedbackEndpoint?.feedbackToken;

              if (
                state?.toggleStates?.feedbackToggleStates?.[libraryFeedbackDefaultToken] !== undefined &&
                state?.toggleStates?.feedbackToggleStates?.[libraryFeedbackDefaultToken] !== null
              ) {
                libraryButtonData.toggled = state.toggleStates.feedbackToggleStates[libraryFeedbackDefaultToken];
                libraryButton.setters.data(libraryButtonData); 
              } else {
                libraryButtonData.toggled = false;
                libraryButton.setters.data(libraryButtonData); 
              }

              if (item.toggleMenuServiceItemRenderer.defaultIcon?.iconType === "BOOKMARK_BORDER") {
                if (libraryButtonData.toggled) {
                  libraryButton.setters.iconName("yt-sys-icons:library_saved");
                } else {
                  libraryButton.setters.iconName("yt-sys-icons:library_add");
                }
              } else if (item.toggleMenuServiceItemRenderer.defaultIcon?.iconType === "BOOKMARK") {
                if (libraryButtonData.toggled) {
                  libraryButton.setters.iconName("yt-sys-icons:library_add");
                } else {
                  libraryButton.setters.iconName("yt-sys-icons:library_saved");
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
    } catch (e) {
      console.warn("YTMD subscriber error:", e);
    }
  });

  ytmdControlButtons.libraryButton = libraryButton;
});
