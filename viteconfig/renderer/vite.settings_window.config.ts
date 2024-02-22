import type { ConfigEnv, UserConfig } from "vite";
import { defineConfig } from "vite";
import { pluginEjs, pluginExposeRenderer, pluginVue } from "../vite.base.config";
import { execSync } from "child_process";
import path from "path";

let gitBranch: string = "";
let gitCommitHash: string = "";
try {
  gitBranch = execSync("git rev-parse --abbrev-ref HEAD").toString();
  gitCommitHash = execSync("git rev-parse HEAD").toString();
} catch (e) {
  // User has likely downloaded from the YTM Desktop via the "Download ZIP".
  // We don't plan to support this, but at least provide users with a bit of improved UX
  // by providing them with what to do rather than just leaving them in the dust.

  e.message =
    " ======= Failed to get Git Info. ======= \n" +
    "Please make sure that when building this application you are cloning the repository from GitHub rather than using the Download ZIP option.\n" +
    "Follow the instructions in the README.md file to clone the repository and build the application from there.\n" +
    " ======= Failed to get Git Info. ======= \n\n" +
    e.message;

  // Re-throw the error so that the build fails with the updated message.
  throw e;
}

// https://vitejs.dev/config
export default defineConfig(env => {
  const forgeEnv = env as ConfigEnv<"renderer">;
  const { mode, forgeConfigSelf } = forgeEnv;
  const name = forgeConfigSelf.name ?? "";

  return {
    root: "src/renderer/windows/settings",
    mode,
    base: "./",
    build: {
      outDir: `../../../../.vite/renderer/${name}`
    },
    define: {
      YTMD_GIT_COMMIT_HASH: JSON.stringify(gitCommitHash),
      YTMD_GIT_BRANCH: JSON.stringify(gitBranch),
      __VUE_OPTIONS_API__: false,
      __VUE_PROD_DEVTOOLS__: false
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
