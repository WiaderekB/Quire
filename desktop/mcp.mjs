import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { z } from "zod/v4";
import { isEditable, listFiles, projectPath, readSource, saveSource } from "./files.mjs";
import manifest from "../package.json" with { type: "json" };

const maxExcerpt = 50_000;
const relativePath = z.string().min(1).max(1024).describe("A project-relative path, such as sections/results.tex");
const isVisibleSource = relative =>
  isEditable(relative) && !relative.split("/").some(part => part.startsWith(".") || part === "node_modules");
const readOnly = { readOnlyHint: true, openWorldHint: false };
const response = value => ({
  content: [{ type: "text", text: JSON.stringify(value) }],
  structuredContent: value,
});

function makeServer(root, write) {
  const server = new McpServer({ name: "quire", version: manifest.version });
  let edits = Promise.resolve();
  async function sourcePath(relative) {
    if (!isVisibleSource(relative)) throw new Error("Choose a visible LaTeX project source file.");
    return projectPath(root, relative, { editable: true });
  }

  server.registerTool("list_project_files", {
    title: "List Quire project files",
    description: "List the visible LaTeX and text sources in the selected project.",
    inputSchema: z.object({}),
    annotations: readOnly,
  }, async () => response({
    files: (await listFiles(root)).filter(file => isVisibleSource(file.path)).map(file => file.path),
  }));

  server.registerTool("read_project_file", {
    title: "Read Quire project file",
    description: "Read a range of source lines and the current file revision. Line numbers start at 1.",
    inputSchema: z.object({
      path: relativePath,
      startLine: z.number().int().min(1).default(1),
      lineCount: z.number().int().min(1).max(400).default(200),
    }),
    annotations: readOnly,
  }, async ({ path: relative, startLine, lineCount }) => {
    const { text, version } = await readSource(await sourcePath(relative));
    const lines = text.split(/(?<=\n)/);
    if (startLine > lines.length) throw new Error(`This file has ${lines.length} lines.`);
    const excerpt = lines.slice(startLine - 1, startLine - 1 + lineCount).join("");
    if (excerpt.length > maxExcerpt) throw new Error("The excerpt is too large. Request fewer lines.");
    return response({ path: relative, startLine, totalLines: lines.length, version, text: excerpt });
  });

  if (write) {
    server.registerTool("replace_project_text", {
      title: "Edit Quire project file",
      description: "Replace one unique passage in a source file using the version from its most recent read.",
      inputSchema: z.object({
        path: relativePath,
        version: z.string().regex(/^[a-f\d]{64}$/),
        oldText: z.string().min(1).max(maxExcerpt),
        newText: z.string().max(maxExcerpt),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    }, ({ path: relative, version, oldText, newText }) => {
      const operation = edits.then(async () => {
        const file = await sourcePath(relative);
        const current = await readSource(file);
        if (current.version !== version) throw new Error("This file changed since it was read. Read it again to get the latest version.");
        const start = current.text.indexOf(oldText);
        if (start === -1 || current.text.indexOf(oldText, start + 1) !== -1) {
          throw new Error("The old text must match exactly once. Include enough surrounding text to identify it.");
        }
        const next = current.text.slice(0, start) + newText + current.text.slice(start + oldText.length);
        const written = await saveSource(file, next, version);
        return response({ path: relative, version: written });
      });
      edits = operation.catch(() => {});
      return operation;
    });
  }

  return server;
}

try {
  const { values } = parseArgs({
    options: { project: { type: "string" }, write: { type: "boolean" }, help: { type: "boolean" } },
  });
  if (values.help) {
    console.error("Usage: node quire-mcp.mjs --project /absolute/path/to/project [--write]");
  } else {
    if (!values.project || !path.isAbsolute(values.project)) throw new Error("Pass an absolute project folder with --project.");
    const root = await realpath(values.project);
    if (!(await stat(root)).isDirectory()) throw new Error("The project path must be a folder.");
    serveStdio(() => makeServer(root, values.write === true));
  }
} catch (error) {
  console.error("Quire MCP: " + error.message);
  process.exitCode = 1;
}
