import type { ForgeConfig } from "@electron-forge/shared-types";
import { MakerSquirrel } from "@electron-forge/maker-squirrel";
import { MakerZIP } from "@electron-forge/maker-zip";
import { MakerDeb } from "@electron-forge/maker-deb";
import { MakerRpm } from "@electron-forge/maker-rpm";
import { WebpackPlugin } from "@electron-forge/plugin-webpack";
import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives';
import { ElectronegativityPlugin } from '@electron-forge/plugin-electronegativity';

import { mainConfig } from "./webpack.main.config";
import { rendererConfig } from "./webpack.renderer.config";

const config: ForgeConfig = {
  packagerConfig: {
    icon: "./src/assets/icons/ytmd",
    extraResource: ["./src/assets/icons"],
    protocols: [
      {
        name: "YouTube Music Desktop App",
        schemes: ["ytmd"]
      }
    ],
    asar: true,
  },
  rebuildConfig: {},
  makers: [
    new MakerSquirrel({}),
    new MakerZIP({}, ["darwin"]),
    new MakerRpm({}),
    new MakerDeb({
      options: {
        mimeType: ["x-scheme-handler/ytmd"]
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
    }),
    new AutoUnpackNativesPlugin({}),
    new ElectronegativityPlugin({
      isSarif: true,
      parserPlugins: []
    })
  ]
};

export default config;
