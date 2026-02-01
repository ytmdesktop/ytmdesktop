import { BasePlugin } from "../../base-plugin";
import log from "electron-log";

export class SixKLabsWidgetPlugin extends BasePlugin {
  constructor() {
    super({
      id: "6klabs-widget",
      name: "6K Labs Widget",
      description: "Configure 6K Labs Amuse widget for OBS streaming. Get your widget token from 6klabs.com/dashboard",
      version: "1.0.0",
      author: "YTMD Team",
      enabled: false,
      settings: {
        widgetToken: "",
        coverStyle: 1, // 0=Square, 1=Circle, 2=Vinyl, 3=CD
        coverBlur: false,
        coverGlow: true,
        hideOnPause: false,
        hideDelay: 10,
        visibleDuration: 5,
        songChangeOnly: false,
        hideEqualizer: false,
        playerStyle: 0, // 0=Minimal, 1=Modern, 2=Classic
        playerColors: true,
        theme: 0, // 0=Dark, 1=Light, 2=Auto, 3=Gradient, 4=Glass
        tintColor: "#1DB954"
      }
    });
  }

  // Get settings schema for UI
  static getSettingsSchema() {
    return {
      widgetToken: {
        type: "text",
        label: "Widget Token",
        description: "Enter your 6K Labs widget token from the dashboard",
        placeholder: "58673b945983fcf8130a5110b7b487e45f670466e181ef6d67af3c393135dbf5"
      },
      coverStyle: {
        type: "select",
        label: "Cover Style",
        description: "Album cover display style",
        options: [
          { label: "Square", value: 0 },
          { label: "Circle", value: 1 },
          { label: "Vinyl", value: 2 },
          { label: "CD", value: 3 }
        ]
      },
      coverBlur: {
        type: "toggle",
        label: "Cover Blur",
        description: "Apply blur effect to album cover background"
      },
      coverGlow: {
        type: "toggle",
        label: "Cover Glow",
        description: "Add glow effect to album cover"
      },
      hideOnPause: {
        type: "toggle",
        label: "Hide on Pause",
        description: "Hide widget when music is paused"
      },
      hideDelay: {
        type: "number",
        label: "Hide Delay (seconds)",
        description: "Delay before hiding widget",
        min: 0,
        max: 60
      },
      visibleDuration: {
        type: "number",
        label: "Visible Duration (seconds)",
        description: "How long to show widget",
        min: 1,
        max: 60
      },
      songChangeOnly: {
        type: "toggle",
        label: "Song Change Only",
        description: "Only show widget when song changes"
      },
      hideEqualizer: {
        type: "toggle",
        label: "Hide Equalizer",
        description: "Hide equalizer visualization"
      },
      playerStyle: {
        type: "select",
        label: "Player Style",
        description: "Player UI style",
        options: [
          { label: "Minimal", value: 0 },
          { label: "Modern", value: 1 },
          { label: "Classic", value: 2 }
        ]
      },
      playerColors: {
        type: "toggle",
        label: "Player Colors",
        description: "Use dynamic colors from album art"
      },
      theme: {
        type: "select",
        label: "Theme",
        description: "Widget theme",
        options: [
          { label: "Dark", value: 0 },
          { label: "Light", value: 1 },
          { label: "Auto", value: 2 },
          { label: "Gradient", value: 3 },
          { label: "Glass", value: 4 }
        ]
      },
      tintColor: {
        type: "color",
        label: "Tint Color",
        description: "Custom tint color for widget"
      }
    };
  }

  onEnable(): void {
    log.debug("[6K Labs Widget] Plugin enabled");
  }

  onDisable(): void {
    log.debug("[6K Labs Widget] Plugin disabled");
  }

  getWidgetUrl(): string {
    const token = this.currentSettings.widgetToken as string;
    if (!token) {
      return "⚠️ Enter your widget token above to get the URL";
    }
    return `https://6klabs.com/widget/youtube/${token}`;
  }
}
