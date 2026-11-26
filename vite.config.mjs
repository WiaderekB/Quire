import { cp } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const pdfAssets = fileURLToPath(new URL("./node_modules/pdfjs-dist/", import.meta.url));

export default defineConfig({
  base: "./",
  plugins: [{
    name: "pdf-assets",
    async writeBundle({ dir }) {
      await Promise.all(["cmaps", "iccs", "standard_fonts", "wasm"].map(name =>
        cp(path.join(pdfAssets, name), path.join(dir, "pdf", name), { recursive: true }),
      ));
    },
  }],
});
