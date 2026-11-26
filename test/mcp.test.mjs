import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const entry = process.env.QUIRE_MCP_TEST_SERVER ?? fileURLToPath(new URL("../desktop/mcp.mjs", import.meta.url));

test("MCP limits reads to one project and protects revisions before writing", async t => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "quire-mcp-"));
  const project = path.join(temporary, "paper");
  const tex = path.join(project, "main.tex");
  await mkdir(project);
  await writeFile(tex, "\\section{Draft}\nA first draft.\n");
  await writeFile(path.join(project, ".private.tex"), "hidden");
  await writeFile(path.join(temporary, "other.tex"), "another project");
  await symlink(path.join(temporary, "other.tex"), path.join(project, "linked.tex"));

  const clients = [];
  t.after(async () => {
    await Promise.all(clients.map(client => client.close()));
    await rm(temporary, { force: true, recursive: true });
  });
  async function connect(write = false) {
    const client = new Client({ name: "quire-test", version: "1.0.0" });
    const args = [entry, "--project", project, ...(write ? ["--write"] : [])];
    clients.push(client);
    await client.connect(new StdioClientTransport({ command: process.execPath, args }));
    return client;
  }
  const call = (client, name, args = {}) => client.callTool({ name, arguments: args });

  const reader = await connect();
  const { tools } = await reader.listTools();
  assert.deepEqual(tools.map(tool => tool.name), ["list_project_files", "read_project_file"]);
  assert.deepEqual((await call(reader, "list_project_files")).structuredContent.files, ["main.tex"]);
  for (const relative of ["../other.tex", ".private.tex", "linked.tex", "/etc/passwd"]) {
    assert.equal((await call(reader, "read_project_file", { path: relative })).isError, true, relative);
  }

  const read = (await call(reader, "read_project_file", {
    path: "main.tex", startLine: 2, lineCount: 1,
  })).structuredContent;
  assert.equal(read.text, "A first draft.\n");
  const writer = await connect(true);
  const edit = { path: "main.tex", version: read.version, oldText: "A first draft.", newText: "A revised draft." };
  const result = await call(writer, "replace_project_text", edit);
  assert.ok(result.structuredContent.version);
  assert.match(await readFile(tex, "utf8"), /A revised draft/);
  assert.equal((await call(writer, "replace_project_text", edit)).isError, true);
});
