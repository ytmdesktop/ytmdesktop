import path from "node:path";
import { defineConfig } from "vite";

// https://vitejs.dev/config
export default defineConfig({
  build: {
    outDir: ".vite/renderer/windows/ytmview"
  },
  resolve: {
    alias: {
      "~shared": path.resolve(__dirname, "../../src/shared"),
      "~assets": path.resolve(__dirname, "../../src/assets")
    }
  }
});
