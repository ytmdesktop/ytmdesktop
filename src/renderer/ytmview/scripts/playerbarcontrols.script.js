/* eslint-disable @typescript-eslint/no-unused-expressions */
(function () {
  function isExperimentEnabled(experimentFlag) {
    const flag = window.ytcfg.data_.EXPERIMENT_FLAGS[experimentFlag];
    if (flag && typeof flag === "string") return flag === "false" ? false : true;
    return !!flag;
  }

  // Helper function to safely set properties on elements
  function safelySetProperty(element, property, value) {
    try {
      if (typeof element.set === 'function') {
        element.set(property, value);
      } else {
        // Fallback for elements without .set() method
        if (property === 'iconName') {
          element.setAttribute('icon', value);
        } else if (property.startsWith('data.')) {
          // Handle nested property setting
          const propPath = property.split('.');
          let current = element;
          for (let i = 0; i < propPath.length - 1; i++) {
            if (!current[propPath[i]]) current[propPath[i]] = {};
            current = current[propPath[i]];
          }
          current[propPath[propPath.length - 1]] = value;
        } else {
          element[property] = value;
        }
      }
    } catch (error) {
      console.warn(`Failed to set property ${property} on element:`, error);
    }
  }

  const ytmStore = window.__YTMD_HOOK__.ytmStore;
  const wizButtonShapeEnabled = true; // TODO: Remove this - 9/3/2025 YTM did a UI update and the experiment flag associated with this is gone as its now default enabled

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
  if (wizButtonShapeEnabled) {
    libraryButton.rawProps = {
      iconName: "yt-sys-icons:library_add",
      data: libraryButtonData
    };
  } else {
    safelySetProperty(libraryButton, "iconName", "yt-sys-icons:library_add");
    safelySetProperty(libraryButton, "data", libraryButtonData);
  }
  document
    .querySelector("ytmusic-app-layout>ytmusic-player-bar")
    .querySelector("ytmusic-like-button-renderer")
    .insertAdjacentElement("afterend", libraryButton);

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
      if (returnValue[0] && returnValue[0].ajaxPromise) {
        returnValue[0].ajaxPromise.then(
          response => {
            try {
              if (response && response.data && response.data.contents && response.data.contents[0] && response.data.contents[0].addToPlaylistRenderer) {
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
              } else {
                console.warn("No playlists available or unexpected response structure");
              }
            } catch (error) {
              console.warn("Error processing playlist response:", error);
            }
            this.dispatchEvent(new CustomEvent("yt-action", closePopupEvent));
          },
          error => {
            console.warn("Playlist API request failed:", error);
            // Show user-friendly message for API errors
            this.dispatchEvent(new CustomEvent("yt-action", closePopupEvent));
          }
        );
      } else {
        console.warn("No playlist API response received");
        this.dispatchEvent(new CustomEvent("yt-action", closePopupEvent));
      }
    }.bind(playlistButton),
    style: "mono",
    toggled: false,
    type: "text"
  };
  if (wizButtonShapeEnabled) {
    playlistButton.rawProps = {
      iconName: "yt-sys-icons:playlist_add",
      data: playlistButtonData
    };
  } else {
    safelySetProperty(playlistButton, "iconName", "yt-sys-icons:playlist_add");
    safelySetProperty(playlistButton, "data", playlistButtonData);
  }
  libraryButton.insertAdjacentElement("afterend", playlistButton);

  document.querySelector("ytmusic-app-layout>ytmusic-player-bar").playerApi.addEventListener("onVideoDataChange", event => {
    if (event.playertype === 1 && (event.type === "dataloaded" || event.type === "dataupdated")) {
      currentVideoId = document.querySelector("ytmusic-app-layout>ytmusic-player-bar").playerApi.getPlayerResponse().videoDetails.videoId;
    }
  });

  let rightControls = document.querySelector("ytmusic-app-layout>ytmusic-player-bar").querySelector(".right-controls-buttons");
  let sleepTimerButton = document.createElement("yt-icon-button");

  let sleepTimerIcon = document.createElement("yt-icon");
  sleepTimerIcon.set("icon", "TIMER");
  sleepTimerButton.appendChild(sleepTimerIcon);

  sleepTimerButton.setAttribute("title", "Sleep timer off");
  sleepTimerButton.classList.add("ytmusic-player-bar");
  sleepTimerButton.classList.add("ytmd-player-bar-control");
  sleepTimerButton.classList.add("sleep-timer-button");
  safelySetProperty(sleepTimerButton, "icon", "yt-sys-icons:stopwatch");
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
                        : {},
                      // Divider
                      { menuSectionRenderer: { items: [] } },
                      // Vinyl Player Option
                      {
                        menuServiceItemRenderer: {
                          icon: {
                            iconType: "ALBUM"
                          },
                          serviceEndpoint: {
                            ytmdVinylPlayerServiceEndpoint: {}
                          },
                          text: {
                            runs: [
                              {
                                text: "Vinyl Player"
                              }
                            ]
                          }
                        }
                      }
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
                document.querySelector("ytmusic-app-layout>ytmusic-player-bar").playerApi.pauseVideo();

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
      // Handle Vinyl Player menu item
      if (e.detail.args[1].ytmdVinylPlayerServiceEndpoint !== undefined) {
        window.__YTMD_HOOK__.ipcRenderer.send("vinyl-player:toggle-window");
      }
    }
  });

  ytmStore.subscribe(() => {
    let state = ytmStore.getState();

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
              if (wizButtonShapeEnabled) {
                libraryButton.setters.data(libraryButtonData); 
              } else {
                safelySetProperty(libraryButton, "data.toggled", libraryButtonData.toggled);
              }
            } else {
              libraryButtonData.toggled = false;
              if (wizButtonShapeEnabled) {
                libraryButton.setters.data(libraryButtonData); 
              } else {
                safelySetProperty(libraryButton, "data.toggled", libraryButtonData.toggled);
              }
            }

            if (item.toggleMenuServiceItemRenderer.defaultIcon.iconType === "LIBRARY_SAVED") {
              // Default value is saved to library (false == remove from library, true == add to library)
              if (libraryButtonData.toggled) {
                if (wizButtonShapeEnabled) {
                  libraryButton.setters.iconName("yt-sys-icons:library_add");
                } else {
                  safelySetProperty(libraryButton, "iconName", "yt-sys-icons:library_add");
                }
              } else {
                if (wizButtonShapeEnabled) {
                  libraryButton.setters.iconName("yt-sys-icons:library_saved");
                } else {
                  safelySetProperty(libraryButton, "iconName", "yt-sys-icons:library_saved");
                } 
              }
            } else if (item.toggleMenuServiceItemRenderer.defaultIcon.iconType === "LIBRARY_ADD") {
              // Default value is add to library (false == add to library, true == remove from library)
              if (libraryButtonData.toggled) {
                if (wizButtonShapeEnabled) {
                  libraryButton.setters.iconName("yt-sys-icons:library_saved");
                } else {
                  safelySetProperty(libraryButton, "iconName", "yt-sys-icons:library_saved");
                }
              } else {
                if (wizButtonShapeEnabled) {
                  libraryButton.setters.iconName("yt-sys-icons:library_add");
                } else {
                  safelySetProperty(libraryButton, "iconName", "yt-sys-icons:library_add");
                }
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
});
