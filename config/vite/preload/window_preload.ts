import { defineConfig } from "vite";

// https://vitejs.dev/config
export function createWindowPreloadConfig(windowName: string) {
  return defineConfig({
    build: {
      outDir: `.vite/preload/windows/${windowName}`,
    },
  });
}
