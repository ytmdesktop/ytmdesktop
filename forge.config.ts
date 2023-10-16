import type { ForgeConfig } from "@electron-forge/shared-types";
import { MakerSquirrel } from "@electron-forge/maker-squirrel";
import { MakerDMG } from "@electron-forge/maker-dmg";
import { MakerDeb } from "@electron-forge/maker-deb";
import { MakerRpm } from "@electron-forge/maker-rpm";
import { WebpackPlugin } from "@electron-forge/plugin-webpack";

import { mainConfig } from "./webpack.main.config";
import { rendererConfig } from "./webpack.renderer.config";

const config: ForgeConfig = {
  packagerConfig: {
    executableName: "youtube-music-desktop-app",
    icon: "./src/assets/icons/ytmd",
    extraResource: [
      "./src/assets/icons/tray.ico",
      "./src/assets/icons/trayTemplate.png",
      "./src/assets/icons/trayTemplate@2x.png",
      "./src/assets/icons/ytmd.png",

      "./src/assets/icons/controls/pause-button.png",
      "./src/assets/icons/controls/play-button.png",
      "./src/assets/icons/controls/play-next-button.png",
      "./src/assets/icons/controls/play-previous-button.png"
    ],
    protocols: [
      {
        name: "YouTube Music Desktop App",
        schemes: ["ytmd"]
      }
    ],
    appCategoryType: "public.app-category.music",
    asar: true
  },
  rebuildConfig: {},
  makers: [
    new MakerSquirrel({
      iconUrl: "https://raw.githubusercontent.com/ytmdesktop/ytmdesktop/137c4e5c175c8c125cbcca9a5312611f80cd3bd9/src/assets/icons/ytmd.ico"
    }),
    new MakerDMG({
      icon: "./src/assets/icons/ytmd.png"
    }),
    new MakerRpm({
      options: {
        categories: ["AudioVideo", "Audio"],
        mimeType: ["x-scheme-handler/ytmd"],
        icon: "./src/assets/icons/ytmd.png"
      }
    }),
    new MakerDeb({
      options: {
        categories: ["AudioVideo", "Audio"],
        mimeType: ["x-scheme-handler/ytmd"],
        section: "sound",
        icon: "./src/assets/icons/ytmd.png"
      }
    })
  ],
  publishers: [
    {
      name: "@electron-forge/publisher-github",
      config: {
        repository: {
          owner: "ytmdesktop",
          name: "ytmdesktop"
        }
      }
    }
  ],
  plugins: [
    new WebpackPlugin({
      mainConfig,
      renderer: {
        config: rendererConfig,
        entryPoints: [
          {
            html: "./src/windows/main/index.html",
            js: "./src/windows/main/renderer.ts",
            name: "main_window",
            preload: {
              js: "./src/windows/main/preload.ts"
            }
          },
          {
            html: "./src/windows/settings/index.html",
            js: "./src/windows/settings/renderer.ts",
            name: "settings_window",
            preload: {
              js: "./src/windows/settings/preload.ts"
            }
          },
          {
            html: "./src/windows/authorize-companion/index.html",
            js: "./src/windows/authorize-companion/renderer.ts",
            name: "authorize_companion_window",
            preload: {
              js: "./src/windows/authorize-companion/preload.ts"
            }
          },
          {
            name: "ytm_view",
            preload: {
              js: "./src/ytmview/preload.ts"
            }
          }
        ]
      }
    })
  ]
};

export default config;
