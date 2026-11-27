import path from "node:path";
import { listFiles, projectPath, readSource } from "./files.mjs";
import { bibliographySymbols, latexSymbols } from "./latex-symbols.mjs";

async function readText(root, relative) {
  try {
    return (await readSource(await projectPath(root, relative, { editable: true }))).text;
  } catch (error) {
    if (["ENOENT", "EACCES", "ENOTDIR"].includes(error.code) || /UTF-8|exceeds 4 MB|symbolic links|regular project file/.test(error.message)) return null;
    throw error;
  }
}

export async function searchSources(root, query, { caseSensitive, wholeWord } = {}) {
  if (typeof query !== "string" || query.length > 160 || /[\r\n]/.test(query)) throw new Error("Enter a single line of up to 160 characters.");
  if (!query) return { matches: [], truncated: false };
  const literal = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const term = wholeWord ? `(?<![\\p{L}\\p{N}_])${literal}(?![\\p{L}\\p{N}_])` : literal;
  const pattern = new RegExp(term, caseSensitive ? "gu" : "giu");
  const matches = [];
  for (const file of await listFiles(root)) {
    if (!file.editable) continue;
    const text = await readText(root, file.path);
    if (text === null) continue;
    for (const [row, line] of text.split(/\r\n?|\n/).entries()) {
      for (const match of line.matchAll(pattern)) {
        if (matches.length === 250) return { matches, truncated: true };
        const start = Math.max(0, match.index - 40);
        const end = Math.min(line.length, match.index + match[0].length + 75);
        matches.push({
          path: file.path, line: row + 1, column: match.index + 1, length: match[0].length,
          excerpt: (start ? "…" : "") + line.slice(start, end) + (end < line.length ? "…" : ""),
          offset: match.index - start + (start ? 1 : 0),
        });
      }
    }
  }
  return { matches, truncated: false };
}

export async function indexProject(root, main, cache) {
  const files = (await listFiles(root, "", true)).filter(file => /\.(?:tex|ltx|latex|bib)$/i.test(file.path));
  const previous = new Set(cache.keys());
  for (let index = 0; index < files.length; index += 8) {
    await Promise.all(files.slice(index, index + 8).map(async file => {
      previous.delete(file.path);
      if (cache.get(file.path)?.stamp === file.stamp) return;
      const text = await readText(root, file.path) ?? "";
      const bib = /\.bib$/i.test(file.path);
      const symbols = bib
        ? { structure: [], labels: [], citations: bibliographySymbols(text, file.path) }
        : { ...latexSymbols(text, file.path), citations: [] };
      cache.set(file.path, { stamp: file.stamp, ...symbols });
    }));
  }
  for (const removed of previous) cache.delete(removed);

  const outline = [];
  const visited = new Set();
  function visit(relative) {
    if (visited.has(relative)) return;
    visited.add(relative);
    for (const entry of cache.get(relative)?.structure ?? []) {
      if (entry.kind === "heading") {
        outline.push(entry);
      } else {
        const target = path.extname(entry.target) ? entry.target : entry.target + ".tex";
        const resolved = [target, path.posix.join(path.posix.dirname(relative), target)]
          .map(candidate => path.posix.normalize(candidate)).find(candidate => cache.has(candidate));
        if (resolved) visit(resolved);
      }
    }
  }
  if (main) visit(main);
  for (const { path: relative } of files) visit(relative);
  const symbols = files.map(file => cache.get(file.path));
  return {
    outline,
    labels: symbols.flatMap(entry => entry.labels),
    citations: symbols.flatMap(entry => entry.citations),
  };
}
