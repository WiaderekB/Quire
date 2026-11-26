import { defineConfig } from "vite";

export default defineConfig({
  ssr: { noExternal: true },
  build: {
    ssr: "desktop/mcp.mjs",
    target: "node24",
    outDir: "dist/mcp",
    emptyOutDir: true,
    license: { fileName: "MCP-LICENSES.md" },
    rolldownOptions: { output: { entryFileNames: "quire-mcp.mjs", codeSplitting: false } },
  },
});
