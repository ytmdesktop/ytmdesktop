import { TranslationSchema } from "../types";

const enUS: TranslationSchema = {
  app: {
    loading: {
      checkingForUpdates: "Checking for updates...",
      downloadingUpdate: "Downloading update...",
      initializing: "Initializing...",
      loadingYouTubeMusic: "Loading YouTube Music...",
      loadedYouTubeMusic: "Loaded YouTube Music",
      initialized: "Initialized",
      failedToLoadYouTubeMusic: (errorDescription, errorCode) => `Failed to load YouTube Music: ${errorDescription} (${errorCode})`,
      youTubeMusicLoadTimedOut: "YouTube Music is taking longer than usual to load"
    }
  },
  settings: {
    tabs: {
      general: "General",
      appearance: "Appearance",
      playback: "Playback",
      integrations: "Integrations",
      shortcuts: "Shortcuts",
      about: "About"
    },
    general: {
      language: "Language",
      hideToTrayOnClose: "Hide to tray on close",
      showNotificationOnSongChange: "Show notification on song change",
      startOnBoot: "Start on boot",
      disableHardwareAcceleration: "Disable hardware acceleration"
    },
    appearance: {
      alwaysShowVolumeSlider: "Always show volume slider",
      customCSS: "Custom CSS",
      customCSSFilePath: "Custom CSS file path",
      zoom: "Zoom",
      trayIconStyle: "Tray icon style",
      trayIconStyleOptions: {
        auto: "Auto",
        white: "White",
        black: "Black"
      }
    },
    playback: {
      continueWhereYouLeftOff: "Continue where you left off",
      pauseOnApplicationLaunch: "Pause on application launch",
      showTrackProgressOnTaskbar: "Show track progress on taskbar",
      enableSpeakerFill: "Enable speaker fill",
      ratioVolume: "Ratio volume"
    },
    integrations: {
      companionServer: "Companion server",
      companionServerDisabled: "This integration cannot be enabled due to safeStorage being unavailable",
      allowBrowserCommunication: "Allow browser communication",
      allowBrowserCommunicationDescription: "This setting could be dangerous as it allows any website you visit to communicate with the companion server",
      enableCompanionAuthorization: "Enable companion authorization",
      enableCompanionAuthorizationDescription: "Automatically disables after the first successful authorization or 5 minutes has passed",
      authorizedCompanions: "Authorized companions",
      authorizedCompanionsDescription: "This is a list of companions that currently have access to the companion server",
      companion: "Companion",
      version: "Version",
      noAuthorizedCompanions: "No authorized companions",
      discordRichPresence: "Discord rich presence",
      discordConnectionFailed: "Discord connection could not be established after 30 attempts",
      retry: "Retry",
      lastFmScrobbling: "Last.fm scrobbling",
      lastFmDisabled: "This integration cannot be enabled due to safeStorage being unavailable",
      userIsAuthenticated: "User is Authenticated:",
      yes: "Yes",
      no: "No",
      logout: "Logout",
      scrobblePercent: "Scrobble percent",
      scrobblePercentDescription: "Determines when a song is scrobbled"
    },
    shortcuts: {
      playPause: "Play/Pause",
      next: "Next",
      previous: "Previous",
      thumbsUp: "Thumbs Up",
      thumbsDown: "Thumbs Down",
      increaseVolume: "Increase Volume",
      decreaseVolume: "Decrease Volume",
      registerError: "Failed to register keybind. Does another application have this keybind?"
    },
    about: {
      madeBy: "Made by YTMDesktop Team",
      checkForUpdates: "Check for updates",
      restartToUpdate: "Restart to update",
      checkingForUpdates: "Checking for updates...",
      downloadingUpdate: "Downloading update...",
      updateNotAvailable: "Update not available",
      autoUpdaterDisabled: "Auto updater disabled",
      version: "Version",
      branch: "Branch",
      commit: "Commit",
      website: "Website"
    },
    restart: {
      message: "Restart app to apply changes",
      button: "Restart"
    }
  }
};

export default enUS;
