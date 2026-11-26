import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const editableExtensions = new Set([
  ".tex", ".bib", ".sty", ".cls", ".bst", ".ltx", ".tikz", ".pgf", ".txt",
  ".md", ".csv", ".tsv", ".latex", ".bbl", ".cfg", ".def",
]);
const generatedFiles = /\.(?:aux|fls|fdb_latexmk|log|synctex\.gz|toc|out|blg|bcf|run\.xml)$/i;
const maxSourceBytes = 4 * 1024 * 1024;
const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

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

export async function listFiles(root, prefix = "") {
  const entries = await readdir(path.join(root, prefix), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name === "node_modules" || generatedFiles.test(entry.name)) continue;
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(root, relative));
    if (entry.isFile()) files.push({ path: relative, editable: isEditable(relative) });
  }
  return files.sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
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

export async function atomicWrite(file, bytes, mode = 0o600) {
  const temporary = path.join(path.dirname(file), `.quire-${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, bytes, { mode, flag: "wx", flush: true });
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function saveSource(file, text, version) {
  if (typeof text !== "string" || Buffer.byteLength(text) > maxSourceBytes) {
    throw new Error("This source file exceeds 4 MB.");
  }
  const current = await readSource(file);
  if (current.version !== version) {
    throw new Error("This file changed outside Quire. Copy your unsaved text before reopening the file.");
  }
  if (current.text === text) return current.version;
  await atomicWrite(file, text, (await lstat(file)).mode & 0o777);
  return versionOf(text);
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
