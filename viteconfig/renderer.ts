import path from "node:path";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { execSync } from "node:child_process";

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
export default defineConfig({
  root: "src/renderer",
  build: {
    outDir: "../../.vite/renderer",
    rollupOptions: {
      input: {
        main_window: "src/renderer/windows/main/index.html",
        settings_window: "src/renderer/windows/settings/index.html",
        authorize_companion_window: "src/renderer/windows/authorize-companion/index.html",
        updater_window: "src/renderer/windows/updater/index.html",
        titlebar_window: "src/renderer/windows/titlebar/index.html",
        miniplayer_window: "src/renderer/windows/miniplayer/index.html"
      },
      output: {
        manualChunks: {
          vue: ["vue"]
        }
      }
    }
  },
  plugins: [
    vue({
      features: {
        optionsAPI: false
      }
    })
  ],
  resolve: {
    alias: {
      "~shared": path.resolve(__dirname, "../src/shared"),
      "~assets": path.resolve(__dirname, "../src/assets")
    }
  },
  define: {
    YTMD_GIT_COMMIT_HASH: JSON.stringify(gitCommitHash),
    YTMD_GIT_BRANCH: JSON.stringify(gitBranch)
  }
});
