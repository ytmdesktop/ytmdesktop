import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PluginOption } from "vite";

export default function nodeNativesPlugin(): PluginOption {
  const files = new Map<string, { readonly fileName: string; readonly fileContent: Buffer }>();

  return {
    name: "node-natives-plugin",
    async load(id) {
      if (!id.endsWith(".node")) return null;

      const fileContent = await readFile(id);
      const hash = createHash("sha256").update(fileContent).digest("hex").slice(0, 8);
      const fileName = `${path.basename(id, ".node")}.${hash}.node`;
      files.set(id, {
        fileName,
        fileContent
      });

      return {
        code: `
          import { createRequire } from "node:module";

          const require = createRequire(import.meta.url);
          export default require("./${fileName}");`,
        syntheticNamedExports: true
      };
    },

    generateBundle(_, bundle) {
      for (const entry of files.entries()) {
        const id = entry[0];
        const file = entry[1];
        this.emitFile({
          type: "asset",
          fileName: file.fileName,
          source: file.fileContent
        });
        delete bundle[id];
      }
    }
  };
}
