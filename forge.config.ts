import type { ForgeConfig } from "@electron-forge/shared-types";
import { MakerSquirrel } from "@electron-forge/maker-squirrel";
import { MakerZIP } from "@electron-forge/maker-zip";
import { MakerDeb } from "@electron-forge/maker-deb";
import { MakerRpm } from "@electron-forge/maker-rpm";
import { WebpackPlugin } from "@electron-forge/plugin-webpack";
import { FusesPlugin } from "@electron-forge/plugin-fuses";

import { FuseV1Options, FuseVersion } from "@electron/fuses/dist/index";

import { mainConfig } from "./webpack.main.config";
import { rendererConfig } from "./webpack.renderer.config";

// There is probably a better way to do this, such as fetching it directly from forge
let makerArch = null;
for (let i = 0; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (arg === "--arch") {
    makerArch = process.argv[i + 1];
  }
}

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
      iconUrl: `https://raw.githubusercontent.com/${process.env.YTMD_UPDATE_FEED_OWNER ?? "ytmdesktop"}/ytmdesktop/137c4e5c175c8c125cbcca9a5312611f80cd3bd9/src/assets/icons/ytmd.ico`
    }),
    new MakerZIP({}, ["darwin"]),
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
          owner: process.env.YTMD_UPDATE_FEED_OWNER ?? "ytmdesktop",
          name: process.env.YTMD_UPDATE_FEED_REPOSITORY ?? "ytmdesktop"
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
            html: "./src/renderer/windows/main/index.html",
            js: "./src/renderer/windows/main/renderer.ts",
            name: "main_window",
            preload: {
              js: "./src/renderer/windows/main/preload.ts"
            },
            additionalChunks: ["shared", "vueSharedComponents", "vendorVue"]
          },
          {
            html: "./src/renderer/windows/settings/index.html",
            js: "./src/renderer/windows/settings/renderer.ts",
            name: "settings_window",
            preload: {
              js: "./src/renderer/windows/settings/preload.ts"
            },
            additionalChunks: ["shared", "vueSharedComponents", "vendorVue"]
          },
          {
            html: "./src/renderer/windows/authorize-companion/index.html",
            js: "./src/renderer/windows/authorize-companion/renderer.ts",
            name: "authorize_companion_window",
            preload: {
              js: "./src/renderer/windows/authorize-companion/preload.ts"
            },
            additionalChunks: ["shared", "vueSharedComponents", "vendorVue"]
          },
          {
            name: "ytm_view",
            preload: {
              js: "./src/renderer/ytmview/preload.ts"
            }
          }
        ]
      }
    }),
    new FusesPlugin({
      version: FuseVersion.V1,
      resetAdHocDarwinSignature: process.platform === "darwin" && makerArch == "arm64",
      [FuseV1Options.EnableCookieEncryption]: true
    })
  ]
};

export default config;
