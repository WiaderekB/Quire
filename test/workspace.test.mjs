import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildDiagnostics } from "../desktop/diagnostics.mjs";
import { listWorkspace } from "../desktop/files.mjs";
import { compileProject } from "../desktop/latex.mjs";
import { importProjectFiles, moveProjectEntry } from "../desktop/project-files.mjs";
import { indexProject, searchSources } from "../desktop/project-navigation.mjs";
import { validateShortcuts } from "../desktop/shortcuts.mjs";
import { pdfToSource, sourceToPdf, texEnvironment } from "../desktop/synctex.mjs";

async function sandbox(t) {
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), "quire-workspace-test-")));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test("project search and outline use visible sources and include subordinate TeX files", async t => {
  const root = await sandbox(t);
  await mkdir(path.join(root, "sections"));
  await mkdir(path.join(root, "empty"));
  await writeFile(path.join(root, "main.tex"), [
    "\\section{Introduction}", "\\input{sections/data}", "% \\section{Ignored}",
    "\\section{Conclusion}", "A comparison of (β+α) with β and βeta.", "",
  ].join("\r\n"));
  await writeFile(path.join(root, "sections/data.tex"), [
    "\\subsection{Data from \\emph{Żółć}}", "\\label{sec:data}",
    "\\begin{verbatim}", "\\section{Literal}", "\\end{verbatim}", "\\input{main}", "",
  ].join("\n"));
  await writeFile(path.join(root, "sources.bib"), "@article{paper,\n  title={Case and Search}\n}\n");
  await writeFile(path.join(root, ".private.tex"), "β\n");
  const cache = new Map();
  const index = await indexProject(root, "main.tex", cache);
  assert.deepEqual(index.outline.map(entry => [entry.title, entry.path]), [
    ["Introduction", "main.tex"], ["Data from Żółć", "sections/data.tex"], ["Conclusion", "main.tex"],
  ]);
  assert.equal(index.labels[0].key, "sec:data");
  assert.equal(index.citations[0].key, "paper");
  const options = { wholeWord: true, caseSensitive: false };
  const { matches } = await searchSources(root, "Β", options);
  assert.deepEqual(matches.map(match => [match.path, match.line, match.column]), [
    ["main.tex", 5, 18], ["main.tex", 5, 28],
  ]);
  assert.equal((await searchSources(root, "(β+α)")).matches.length, 1);
  assert.equal((await searchSources(root, "case", { ...options, caseSensitive: true })).matches.length, 0);
  assert.deepEqual((await listWorkspace(root)).folders, ["empty", "sections"]);
});

test("moves and imports preserve existing content and reject paths outside the project", async t => {
  const directory = await sandbox(t);
  const root = path.join(directory, "paper");
  const external = path.join(directory, "reference.tex");
  await mkdir(path.join(root, "parts"), { recursive: true });
  await writeFile(external, "External text");
  await writeFile(path.join(root, "main.tex"), "Original text");
  await symlink(directory, path.join(root, "external"));
  await assert.rejects(moveProjectEntry(root, "main.tex", "../outside.tex"), /destination/i);
  await assert.rejects(moveProjectEntry(root, "main.tex", "external/replacement.tex"), /regular project|symbolic/i);
  await moveProjectEntry(root, "main.tex", "parts/result.tex");
  assert.equal(await readFile(path.join(root, "parts/result.tex"), "utf8"), "Original text");
  assert.deepEqual(await importProjectFiles(root, "parts", [external]), {
    added: ["parts/reference.tex"], skipped: [],
  });
  await writeFile(external, "Changed external text");
  assert.deepEqual(await importProjectFiles(root, "parts", [external]), {
    added: [], skipped: ["reference.tex"],
  });
  assert.equal(await readFile(path.join(root, "parts/reference.tex"), "utf8"), "External text");
});

test("shortcut overrides are checked against native commands and each other", () => {
  assert.deepEqual(validateShortcuts({ build: "Shift+CmdOrCtrl+J" }, true), { build: "CmdOrCtrl+Shift+J" });
  assert.throws(() => validateShortcuts({ build: "CmdOrCtrl+Q" }, true), /same shortcut/);
  assert.throws(() => validateShortcuts({ build: "Ctrl+K" }, false), /same shortcut/);
  assert.throws(() => validateShortcuts({ build: "CmdOrCtrl+K", "quick-open": "CmdOrCtrl+K" }, true), /same shortcut/);
  assert.throws(() => validateShortcuts({ build: "Enter" }, true), /Command or Control/);
});

const available = ["latexmk", "pdflatex", "synctex"].every(tool => !spawnSync(tool, ["--version"], { env: texEnvironment() }).error);
test("real LaTeX builds map included source to PDF and expose actionable errors", { skip: !available }, async t => {
  const root = await sandbox(t);
  await mkdir(path.join(root, "sections"));
  const include = "sections/measurements.tex";
  const chapter = path.join(root, include);
  await writeFile(path.join(root, "main.tex"), [
    "\\documentclass{article}", "\\begin{document}", "\\input{sections/measurements}", "\\end{document}", "",
  ].join("\n"));
  await writeFile(chapter, "\\section{Results}\n\nThe measurements give a result.\n");
  const built = await compileProject(root, "main.tex", "pdflatex");
  assert.equal(built.ok, true, built.log);
  assert.ok(built.mapping);
  const hit = await sourceToPdf(built.mapping, include, 3, 5);
  assert.ok(hit && hit.page === 1);
  const source = await pdfToSource(built.mapping, hit.page, hit.x + 20, hit.y - hit.height * .25);
  assert.equal(source?.path, include);
  assert.ok(source.line >= 2 && source.line <= 4);

  await writeFile(chapter, "\\section{Results}\n\\unknownquirecontrol\n");
  const failed = await compileProject(root, "main.tex", "pdflatex");
  assert.equal(failed.ok, false);
  assert.ok(failed.issues.some(issue =>
    issue.path === include && issue.line === 2 && issue.severity === "error" && /Undefined control sequence/.test(issue.message)));
  const log = "/outside/tmp/private.tex:1: External error\n! Build stopped";
  assert.deepEqual(buildDiagnostics(log, root, "main.tex", false),
    [{ path: "main.tex", line: null, severity: "error", message: "Build stopped" }]);
});
