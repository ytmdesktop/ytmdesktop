import type { ConfigEnv, UserConfig } from "vite";
import { defineConfig, mergeConfig } from "vite";
import { getBuildConfig, external, pluginHotRestart } from "../vite.base.config";

// https://vitejs.dev/config
export default defineConfig(env => {
  const forgeEnv = env as ConfigEnv<"build">;
  const { forgeConfigSelf } = forgeEnv;
  const config: UserConfig = {
    build: {
      rollupOptions: {
        external,
        // Preload scripts may contain Web assets, so use the `build.rollupOptions.input` instead `build.lib.entry`.
        input: forgeConfigSelf.entry!,
        output: {
          format: "cjs",
          // It should not be split chunks.
          inlineDynamicImports: true,
          entryFileNames: "settings_window/[name].js",
          chunkFileNames: "settings_window/[name].js",
          assetFileNames: "settings_window/[name].[ext]"
        }
      }
    },
    plugins: [pluginHotRestart("reload")]
  };

  return mergeConfig(getBuildConfig(forgeEnv), config);
});
