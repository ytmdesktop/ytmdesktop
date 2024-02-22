import type { ConfigEnv, UserConfig } from "vite";
import { defineConfig, mergeConfig } from "vite";
import { getBuildConfig, getBuildDefine, external, pluginHotRestart } from "./vite.base.config";

// https://vitejs.dev/config
export default defineConfig(env => {
  const forgeEnv = env as ConfigEnv<"build">;
  const { forgeConfigSelf } = forgeEnv;
  const define = getBuildDefine(forgeEnv);
  const config: UserConfig = {
    build: {
      target: "ESNext",
      lib: {
        entry: forgeConfigSelf.entry!,
        fileName: () => "[name].js",
        formats: ["es"]
      },
      rollupOptions: {
        external
      }
    },
    plugins: [pluginHotRestart("restart")],
    define: {
      YTMD_DISABLE_UPDATES: false,
      YTMD_UPDATE_FEED_OWNER: "'ytmdesktop'",
      YTMD_UPDATE_FEED_REPOSITORY: "'ytmdesktop'",
      ...define
    },
    resolve: {
      // Load the Node.js entry.
      mainFields: ["module", "jsnext:main", "jsnext"]
    }
  };

  return mergeConfig(getBuildConfig(forgeEnv), config);
});
