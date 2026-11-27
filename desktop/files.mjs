import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";

const editableExtensions = new Set([
  ".tex", ".bib", ".sty", ".cls", ".bst", ".ltx", ".tikz", ".pgf", ".txt",
  ".md", ".csv", ".tsv", ".latex", ".bbl", ".cfg", ".def",
]);
const generatedFiles = /\.(?:aux|fls|fdb_latexmk|log|synctex\.gz|toc|out|blg|bcf|run\.xml)$/i;
const maxSourceBytes = 4 * 1024 * 1024;
const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

const isVisibleName = name => !name.startsWith(".") && name !== "node_modules" && !generatedFiles.test(name);

export function isSyncPath(relative) {
  const parts = relative.split("/");
  return parts.slice(0, -1).every(isVisibleName) &&
    (isVisibleName(parts.at(-1)) || [".gitignore", ".latexmkrc"].includes(parts.at(-1)));
}

export async function withProjectWrite(root, operation) {
  // Use the same directory from Electron and MCP, even when their TMPDIR values differ.
  const uid = process.getuid();
  const directory = path.join("/tmp", `quire-locks-${uid}`);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const info = await lstat(directory);
  if (!info.isDirectory() || info.uid !== uid || (info.mode & 0o077) !== 0) {
    throw new Error("Quire could not open its private file lock directory.");
  }
  const key = createHash("sha256").update(await realpath(root)).digest("hex");
  const lock = new DatabaseSync(path.join(directory, key));
  const deadline = Date.now() + 10_000;
  try {
    for (;;) {
      try {
        lock.exec("BEGIN IMMEDIATE");
        break;
      } catch (error) {
        if ((error.errcode & 255) !== 5) throw error;
        if (Date.now() >= deadline) throw new Error("Another operation is writing to this project. Try again.");
        await delay(40);
      }
    }
    return await operation();
  } finally {
    // Closing releases the OS lock, including when a process is terminated.
    lock.close();
  }
}

export function isEditable(file) {
  return editableExtensions.has(path.extname(file).toLowerCase()) ||
    [".gitignore", ".latexmkrc"].includes(path.basename(file));
}

export async function projectPath(root, relative, { newFile = false, editable = false } = {}) {
  if (typeof relative !== "string" || relative.includes("\\") ||
      relative.split("/").some(part => !part || part === "." || part === ".." || part.toLowerCase() === ".git")) {
    throw new Error("Choose a file inside the project.");
  }
  if (editable && !isEditable(relative)) throw new Error("This file type is read-only in Quire.");

  const file = path.join(root, relative);
  const parent = await realpath(path.dirname(file));
  if (parent !== path.dirname(file)) throw new Error("Quire skips symbolic links.");
  const info = await lstat(file).catch(error => {
    if (newFile && error.code === "ENOENT") return null;
    throw error;
  });
  if (info && !info.isFile()) throw new Error("Choose a regular project file.");
  return file;
}

export async function listFiles(root, prefix = "", withStamps = false) {
  const entries = await readdir(path.join(root, prefix), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (!isVisibleName(entry.name)) continue;
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) files.push(...(await listFiles(root, relative, withStamps).catch(ignoreMissing) ?? []));
    if (entry.isFile()) {
      const file = { path: relative, editable: isEditable(relative) };
      if (withStamps) {
        const info = await lstat(path.join(root, relative), { bigint: true }).catch(ignoreMissing);
        if (!info?.isFile()) continue;
        file.stamp = `${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}`;
      }
      files.push(file);
    }
  }
  return files.sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
}

function ignoreMissing(error) {
  if (error.code !== "ENOENT") throw error;
}

const versionOf = bytes => createHash("sha256").update(bytes).digest("hex");

export async function readSource(file) {
  if ((await lstat(file)).size > maxSourceBytes) throw new Error("This source file exceeds 4 MB.");
  const bytes = await readFile(file);
  try {
    return { text: utf8.decode(bytes), version: versionOf(bytes) };
  } catch {
    throw new Error("Quire can edit UTF-8 text files.");
  }
}

export async function atomicWrite(file, bytes, mode = 0o600, beforeReplace) {
  const temporary = path.join(path.dirname(file), `.quire-${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, bytes, { mode, flag: "wx", flush: true });
    await beforeReplace?.();
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function saveSource(file, text, version, root = path.dirname(file)) {
  if (typeof text !== "string" || Buffer.byteLength(text) > maxSourceBytes) {
    throw new Error("This source file exceeds 4 MB.");
  }
  return withProjectWrite(root, async () => {
    async function checkVersion() {
      await projectPath(root, path.relative(root, file), { editable: true });
      const current = await readSource(file);
      if (current.version !== version) throw new Error("This file changed outside Quire.");
      return current;
    }
    const current = await checkVersion();
    if (current.text === text) return current.version;
    await atomicWrite(file, text, (await lstat(file)).mode & 0o777, checkVersion);
    return versionOf(text);
  });
}

export async function createSource(root, relative) {
  if (typeof relative !== "string" || relative.split("/").some(part =>
      part.startsWith(".") || part === "" || /[\\:\u0000-\u001f]/.test(part))) {
    throw new Error("Enter a name like notes.tex or sections/results.tex.");
  }
  const segments = relative.split("/");
  const name = segments.pop();
  if (!isEditable(name)) throw new Error("Use a source extension such as .tex or .bib.");
  let directory = root;
  for (const segment of segments) {
    directory = path.join(directory, segment);
    await mkdir(directory).catch(error => {
      if (error.code !== "EEXIST") throw error;
    });
    if (!(await lstat(directory)).isDirectory()) throw new Error("Choose a folder inside the project.");
  }
  const file = await projectPath(root, relative, { newFile: true, editable: true });
  try {
    await writeFile(file, "", { flag: "wx" });
  } catch (error) {
    if (error.code === "EEXIST") throw new Error("That file already exists.");
    throw error;
  }
}
