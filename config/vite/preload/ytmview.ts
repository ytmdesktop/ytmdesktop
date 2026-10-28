import path from "node:path";
import { build, defineConfig } from "vite";

const root = path.resolve(__dirname, "../../..");

// https://vitejs.dev/config
export default defineConfig({
  plugins: [
    {
      name: "iife-ytmview-scripts",
      async transform(code, id) {
        if (id.includes("src/renderer/ytmview/scripts")) {
          const iifeBundle = await build({
            configFile: false,
            build: {
              write: false,
              lib: {
                entry: id.replace("?raw", ""),
                formats: ["iife"],
                name: "ytmview_scripts"
              },
              minify: true,
              target: "esnext"
            },
            resolve: {
              alias: {
                "~shared": path.resolve(root, "src/shared"),
                "~assets": path.resolve(root, "src/assets")
              }
            }
          });

          const iifeCode = iifeBundle[0].output[0].code;
          return {
            code: `export default ${JSON.stringify(iifeCode)}`,
            map: null
          };
        }
      }
    }
  ],
  build: {
    outDir: ".vite/renderer/windows/ytmview"
  },
  resolve: {
    alias: {
      "~shared": path.resolve(root, "src/shared"),
      "~assets": path.resolve(root, "src/assets")
    }
  }
});
