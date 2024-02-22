import type { ConfigEnv, UserConfig } from "vite";
import { defineConfig } from "vite";
import { pluginEjs, pluginExposeRenderer, pluginVue } from "../vite.base.config";
import path from "path";

// https://vitejs.dev/config
export default defineConfig(env => {
  const forgeEnv = env as ConfigEnv<"renderer">;
  const { mode, forgeConfigSelf } = forgeEnv;
  const name = forgeConfigSelf.name ?? "";

  return {
    root: "src/renderer/windows/main",
    mode,
    base: "./",
    build: {
      outDir: `../../../../.vite/renderer/${name}`
    },
    plugins: [pluginExposeRenderer(name), pluginEjs(), pluginVue()],
    resolve: {
      preserveSymlinks: true,
      alias: {
        "~shared": path.resolve(__dirname, "../../src/shared"),
        "~assets": path.resolve(__dirname, "../../src/assets")
      }
    },
    clearScreen: false
  } as UserConfig;
});
