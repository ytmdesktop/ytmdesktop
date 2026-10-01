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
  libraryButton.insertAdjacentElement("afterend", playlistButton);

  window.__YTMD_HOOK__.ytmPlayerBar.playerApi.addEventListener("onVideoDataChange", event => {
    if (event.playertype === 1 && (event.type === "dataloaded" || event.type === "dataupdated")) {
      currentVideoId = window.__YTMD_HOOK__.ytmPlayerBar.playerApi.getPlayerResponse().videoDetails.videoId;
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

  let downloadButton = document.createElement("yt-icon-button");
  downloadButton.setAttribute("title", "Unduh Lagu (Download MP3)");
  downloadButton.classList.add("ytmusic-player-bar");
  downloadButton.classList.add("ytmd-player-bar-control");
  downloadButton.classList.add("download-button");

  const PATH_DOWNLOAD = "M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM17 13l-5 5-5-5h3V9h4v4h3z";
  const PATH_SPINNER = "M12 4V2C6.48 2 2 6.48 2 12h2c0-4.41 3.59-8 8-8zm0 16c-4.41 0-8-3.59-8-8H2c0 5.52 4.48 10 10 10v-2zm8-8c0-4.41-3.59-8-8-8v2c3.31 0 6 2.69 6 6h2zm-2 0c0 3.31-2.69 6-6 6v2c4.42 0 8-3.58 8-8h-2z";
  const PATH_CHECK = "M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z";

  function createSvgIcon(pathData) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", "20");
    svg.setAttribute("height", "20");
    svg.style.fill = "currentColor";
    svg.style.pointerEvents = "none";
    svg.style.display = "block";
    svg.style.margin = "auto";

    const pathEl = document.createElementNS("http://www.w3.org/2000/svg", "path");
    pathEl.setAttribute("d", pathData);
    svg.appendChild(pathEl);
    return svg;
  }

  function setButtonIcon(button, pathData) {
    while (button.firstChild) {
      button.removeChild(button.firstChild);
    }
    button.appendChild(createSvgIcon(pathData));
  }

  setButtonIcon(downloadButton, PATH_DOWNLOAD);

  downloadButton.onclick = () => {
    let videoId = currentVideoId;
    let title = "";
    let artist = "";
    try {
      const resp = window.__YTMD_HOOK__.ytmPlayerBar?.playerApi?.getPlayerResponse();
      if (resp && resp.videoDetails) {
        videoId = resp.videoDetails.videoId || videoId;
        title = resp.videoDetails.title || "";
        artist = resp.videoDetails.author || "";
      }
    } catch (e) {}

    window.dispatchEvent(new CustomEvent("ytmd:downloadCurrentTrack", {
      detail: { videoId, title, artist }
    }));
  };

  window.addEventListener("ytmd:downloadStatus", e => {
    const detail = e.detail;
    if (!detail) return;

    if (detail.status === "downloading") {
      downloadButton.classList.add("downloading");
      downloadButton.classList.remove("completed");
      downloadButton.setAttribute("title", `Sedang mengunduh "${detail.title || "lagu"}"...`);
      setButtonIcon(downloadButton, PATH_SPINNER);
    } else if (detail.status === "completed") {
      downloadButton.classList.remove("downloading");
      downloadButton.classList.add("completed");
      downloadButton.setAttribute("title", `Unduhan selesai! "${detail.title || "Lagu"}" tersimpan.`);
      setButtonIcon(downloadButton, PATH_CHECK);
      setTimeout(() => {
        downloadButton.classList.remove("completed");
        downloadButton.setAttribute("title", "Unduh Lagu (Download MP3)");
        setButtonIcon(downloadButton, PATH_DOWNLOAD);
      }, 4000);
    } else if (detail.status === "error") {
      downloadButton.classList.remove("downloading");
      downloadButton.classList.remove("completed");
      downloadButton.setAttribute("title", `Unduhan gagal: ${detail.error || "Terjadi kesalahan"}`);
      setButtonIcon(downloadButton, PATH_DOWNLOAD);
    }
  });

  sleepTimerButton.insertAdjacentElement("afterend", downloadButton);

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
            item.toggleMenuServiceItemRenderer.defaultIcon.iconType === "BOOKMARK_BORDER" ||
            item.toggleMenuServiceItemRenderer.defaultIcon.iconType === "BOOKMARK"
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

            // Dev note 2/12/26: I think this if check got reversed the comments are probably outdated. Didn't bother investigating further to update comments
            if (item.toggleMenuServiceItemRenderer.defaultIcon.iconType === "BOOKMARK_BORDER") {
              // Default value is saved to library (false == remove from library, true == add to library)
              if (libraryButtonData.toggled) {
                libraryButton.setters.iconName("yt-sys-icons:library_saved");
              } else {
                libraryButton.setters.iconName("yt-sys-icons:library_add");
              }
            } else if (item.toggleMenuServiceItemRenderer.defaultIcon.iconType === "BOOKMARK") {
              // Default value is add to library (false == add to library, true == remove from library)
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
  });

  ytmdControlButtons.libraryButton = libraryButton;
});
