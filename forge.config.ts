import type { ForgeConfig } from "@electron-forge/shared-types";
import { MakerSquirrel } from "@electron-forge/maker-squirrel";
import { MakerZIP } from "@electron-forge/maker-zip";
import { MakerDeb } from "@electron-forge/maker-deb";
import { MakerRpm } from "@electron-forge/maker-rpm";
import { VitePlugin } from "@electron-forge/plugin-vite";
import { FusesPlugin } from "@electron-forge/plugin-fuses";
import { AutoUnpackNativesPlugin } from "@electron-forge/plugin-auto-unpack-natives";
import { FuseV1Options, FuseVersion } from "@electron/fuses";

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
      "./src/assets/icons/ytmd_white.png",
      "./src/assets/icons/ytmd_black.png",

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
    new VitePlugin({
      build: [
        {
          entry: "src/main/index.ts",
          config: "viteconfig/main.ts",
          target: "main"
        },
        // TODO: Utilize a single config for preload so we can share chunks if needed
        {
          entry: "src/renderer/windows/main/preload.ts",
          config: "viteconfig/preload/main_window.ts",
          target: "preload"
        },
        {
          entry: "src/renderer/windows/settings/preload.ts",
          config: "viteconfig/preload/settings_window.ts",
          target: "preload"
        },
        {
          entry: "src/renderer/windows/authorize-companion/preload.ts",
          config: "viteconfig/preload/authorize_companion_window.ts",
          target: "preload"
        },
        {
          entry: "src/renderer/windows/titlebar/preload.ts",
          config: "viteconfig/preload/titlebar_window.ts",
          target: "preload"
        },
        {
          entry: "src/renderer/windows/updater/preload.ts",
          config: "viteconfig/preload/updater_window.ts",
          target: "preload"
        },
        {
          entry: "src/renderer/windows/miniplayer/preload.ts",
          config: "viteconfig/preload/miniplayer_window.ts",
          target: "preload"
        },
        {
          entry: "src/renderer/ytmview/preload.ts",
          config: "viteconfig/preload/ytmview.ts",
          target: "preload"
        }
      ],
      renderer: [
        // Instead of opting for defining each window as a separate object we bundle them all together and have a more custom output to share chunks
        {
          name: "all_windows",
          config: "viteconfig/renderer.ts"
        }
      ]
    }),
    new AutoUnpackNativesPlugin({}),
    new FusesPlugin({
      version: FuseVersion.V1,
      resetAdHocDarwinSignature: process.platform === "darwin" && makerArch == "arm64",
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
      [FuseV1Options.GrantFileProtocolExtraPrivileges]: false
    })
  ]
};

export default config;
