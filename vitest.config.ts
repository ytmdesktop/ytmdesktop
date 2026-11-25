import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    exclude: ["**/node_modules/**", "**/dist/**", "**/.pnpm-store/**", "tests/system/**"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts", "server/listen-relay/src/**/*.ts"],
      exclude: [
        "**/*.d.ts",
        "**/__tests__/**",
        "src/declarations.d.ts",
        "src/main/index.ts",
        "src/main/manager.ts",
        "src/renderer/**/preload.ts",
        "src/renderer/**/renderer.ts",
        "src/renderer/ytmview/preload.ts",
        "src/renderer/ytmview/scripts/index.ts",
      ],
    },
  },
  resolve: {
    alias: {
      "~shared": path.resolve(__dirname, "src/shared"),
      "~assets": path.resolve(__dirname, "src/assets"),
    },
  },
});
