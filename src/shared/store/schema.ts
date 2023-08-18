export type StoreSchema = {
  metadata: {
    version: 1
  }
  general: {
    hideToTrayOnClose: boolean;
    showNotificationOnSongChange: boolean;
    startOnBoot: boolean;
    startMinimized: boolean;
    disableHardwareAcceleration: boolean;
  };
  appearance: {
    alwaysShowVolumeSlider: boolean;
    customCSSEnabled: boolean;
    customCSSPath: string | null;
  };
  playback: {
    continueWhereYouLeftOff: boolean;
    continueWhereYouLeftOffPaused: boolean;
    progressInTaskbar: boolean;
    enableSpeakerFill: boolean;
    ratioVolume: boolean;
  };
  integrations: {
    companionServerEnabled: boolean;
    companionServerAuthWindowEnabled: string | null; // boolean | Encrypted for security
    companionServerAuthTokens: string | null; // array[object] | Encrypted for security
    discordPresenceEnabled: boolean;
  };
  shortcuts: {
    playPause: string;
    next: string;
    previous: string;
    thumbsUp: string;
    thumbsDown: string;
    volumeUp: string;
    volumeDown: string;
  };
  state: {
    lastUrl: string;
    lastVideoId: string;
    lastPlaylistId: string;
    companionServerAuthWindowEnableTime: string | null; // string (ISO8601) | Encrypted for security
    windowBounds: Electron.Rectangle | null;
    windowMaximized: boolean;
  };
  developer: {
    enableDevTools: boolean
  }
};
