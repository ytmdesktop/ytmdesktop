import { defineConfig } from 'vite';
import vue from "@vitejs/plugin-vue";
import path from "node:path";

const root = path.resolve(__dirname, "../..");

// https://vitejs.dev/config
export default defineConfig({
    root: "src/renderer",
    build: {
        outDir: "../../.vite/renderer",
        rolldownOptions: {
            input: {
                main_window: path.resolve(root, "src/renderer/windows/main/index.html"),
                settings_window: path.resolve(root, "src/renderer/windows/settings/index.html"),
                authorize_companion_window: path.resolve(root, "src/renderer/windows/authorize-companion/index.html"),
                updater_window: path.resolve(root, "src/renderer/windows/updater/index.html"),
                titlebar_window: path.resolve(root, "src/renderer/windows/titlebar/index.html"),
                miniplayer_window: path.resolve(root, "src/renderer/windows/miniplayer/index.html")
            },
            output: {
                codeSplitting: {
                    groups: [
                        {
                            name(moduleId) {
                                if (moduleId.includes('node_modules')) {
                                    return 'vendor';
                                }
                                return null;
                            },
                        },
                    ],
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
            "~shared": path.resolve(root, "src/shared"),
            "~assets": path.resolve(root, "src/assets")
        }
    },
    define: {
        YTMD_GIT_COMMIT_HASH: `"abc"`,
        YTMD_GIT_BRANCH: `"dev"`
    }
});
