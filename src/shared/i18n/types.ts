export type TranslationSchema = {
  app: {
    loading: {
      checkingForUpdates: string;
      downloadingUpdate: string;
      initializing: string;
      loadingYouTubeMusic: string;
      loadedYouTubeMusic: string;
      initialized: string;
      failedToLoadYouTubeMusic: (errorDescription: string, errorCode: number) => string;
      youTubeMusicLoadTimedOut: string;
    };
  };
  settings: {
    tabs: {
      general: string;
      appearance: string;
      playback: string;
      integrations: string;
      shortcuts: string;
      about: string;
    };
    general: {
      language: string;
      hideToTrayOnClose: string;
      showNotificationOnSongChange: string;
      startOnBoot: string;
      disableHardwareAcceleration: string;
    };
    appearance: {
      alwaysShowVolumeSlider: string;
      customCSS: string;
      customCSSFilePath: string;
      zoom: string;
      trayIconStyle: string;
      trayIconStyleOptions: {
        auto: string;
        white: string;
        black: string;
      };
    };
    playback: {
      continueWhereYouLeftOff: string;
      pauseOnApplicationLaunch: string;
      showTrackProgressOnTaskbar: string;
      enableSpeakerFill: string;
      ratioVolume: string;
    };
    integrations: {
      companionServer: string;
      companionServerDisabled: string;
      allowBrowserCommunication: string;
      allowBrowserCommunicationDescription: string;
      enableCompanionAuthorization: string;
      enableCompanionAuthorizationDescription: string;
      authorizedCompanions: string;
      authorizedCompanionsDescription: string;
      companion: string;
      version: string;
      noAuthorizedCompanions: string;
      discordRichPresence: string;
      discordConnectionFailed: string;
      retry: string;
      lastFmScrobbling: string;
      lastFmDisabled: string;
      userIsAuthenticated: string;
      yes: string;
      no: string;
      logout: string;
      scrobblePercent: string;
      scrobblePercentDescription: string;
    };
    shortcuts: {
      playPause: string;
      next: string;
      previous: string;
      thumbsUp: string;
      thumbsDown: string;
      increaseVolume: string;
      decreaseVolume: string;
      registerError: string;
    };
    about: {
      madeBy: string;
      checkForUpdates: string;
      restartToUpdate: string;
      checkingForUpdates: string;
      downloadingUpdate: string;
      updateNotAvailable: string;
      autoUpdaterDisabled: string;
      version: string;
      branch: string;
      commit: string;
      website: string;
    };
    restart: {
      message: string;
      button: string;
    };
  };
};
