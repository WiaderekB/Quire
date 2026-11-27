import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { sourceInProject } from "./diagnostics.mjs";

const run = promisify(execFile);

export function texEnvironment() {
  const locations = [process.env.PATH, "/Library/TeX/texbin", "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"];
  return { ...process.env, PATH: locations.filter(Boolean).join(path.delimiter) };
}

async function lookup(mapping, mode, position) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "quire-sync-"));
  try {
    const pdf = path.join(directory, "output.pdf");
    await writeFile(path.join(directory, "output.synctex.gz"), mapping.bytes);
    const args = mode === "view" ? ["view", "-i", position, "-o", pdf] : ["edit", "-o", `${position}:${pdf}`];
    const { stdout } = await run("synctex", args, { cwd: directory, env: texEnvironment(), timeout: 5000, maxBuffer: 1024 * 1024 });
    return stdout.split("SyncTeX result begin")[1]?.split("SyncTeX result end")[0].split(/^Output:.*\r?\n/m).slice(1).map(block =>
      Object.fromEntries(block.split(/\r?\n/).flatMap(line => {
        const colon = line.indexOf(":");
        return colon > 0 ? [[line.slice(0, colon), line.slice(colon + 1)]] : [];
      }))) ?? [];
  } catch (error) {
    if (error.code === "ENOENT") throw new Error("Install SyncTeX with your TeX distribution to jump between source and PDF.");
    if (typeof error.code === "number" && !error.killed) return [];
    throw error;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function sourceToPdf(mapping, relative, line, column) {
  const results = await lookup(mapping, "view", `${line}:${column}:${path.join(mapping.root, relative)}`);
  for (const result of results) {
    const page = Number(result.Page);
    const x = Number(result.h ?? result.x);
    const y = Number(result.v ?? result.y);
    const width = Number(result.W);
    const height = Number(result.H);
    if (Number.isInteger(page) && page > 0 && Number.isFinite(x) && Number.isFinite(y)) {
      return { page, x, y, width: width > 0 ? width : 24, height: height > 0 ? height : 8 };
    }
  }
  return null;
}

export async function pdfToSource(mapping, page, x, y) {
  const results = await lookup(mapping, "edit", `${page}:${x}:${y}`);
  for (const result of results) {
    const relative = result.Input && sourceInProject(mapping.root, result.Input);
    const line = Number(result.Line);
    const column = Number(result.Column);
    if (relative && Number.isInteger(line) && line > 0) {
      return { path: relative, line, column: column > 0 ? column : 1 };
    }
  }
  return null;
}
