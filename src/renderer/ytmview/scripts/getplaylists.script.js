(function() {
  return new Promise((resolve, reject) => {
    try {
      var returnValue = [];
      var serviceRequestEvent = {
        bubbles: true,
        cancelable: false,
        composed: true,
        detail: {
          actionName: "yt-service-request",
          args: [
            document.querySelector("ytmusic-app-layout>ytmusic-player-bar"),
            {
              addToPlaylistEndpoint: {
                videoId: document.querySelector("ytmusic-app-layout>ytmusic-player-bar").playerApi.getPlayerResponse().videoDetails.videoId
              }
            }
          ],
          optionalAction: false,
          returnValue
        }
      };

      // Try the new API format first
      document.querySelector("ytmusic-app-layout>ytmusic-player-bar").dispatchEvent(new CustomEvent("yt-action", serviceRequestEvent));

      if (returnValue[0] && returnValue[0].ajaxPromise) {
        returnValue[0].ajaxPromise.then(
          response => {
            try {
              // Check if response has the expected structure
              if (response && response.data && response.data.contents && response.data.contents[0] && response.data.contents[0].addToPlaylistRenderer) {
                resolve(response.data.contents[0].addToPlaylistRenderer.playlists);
              } else {
                console.warn("Unexpected API response structure, falling back to empty playlists");
                resolve([]);
              }
            } catch (error) {
              console.warn("Error parsing playlist response:", error);
              resolve([]);
            }
          },
          error => {
            console.warn("Playlist API request failed:", error);
            // Return empty array instead of rejecting to prevent app crashes
            resolve([]);
          }
        );
      } else {
        console.warn("No return value from playlist API request");
        resolve([]);
      }
    } catch (error) {
      console.error("Error in getPlaylists script:", error);
      resolve([]);
    }
  });
})
