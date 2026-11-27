import { spawn } from "node:child_process";
import { cp, lstat, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { projectPath } from "./files.mjs";
import { buildDiagnostics } from "./diagnostics.mjs";
import { texEnvironment } from "./synctex.mjs";

const modes = {
  pdflatex: ["-pdf", "-pdflatex=pdflatex -no-shell-escape %O %S"],
  xelatex: ["-xelatex", "-xelatex=xelatex -no-shell-escape %O %S"],
  lualatex: ["-lualatex", "-lualatex=lualatex -no-shell-escape %O %S"],
};

function runLatex(cwd, file, engine, cache) {
  return new Promise((resolve, reject) => {
    const args = [
      "-norc", "-interaction=nonstopmode", "-halt-on-error", "-file-line-error",
      "-synctex=1", "-outdir=.quire-output", ...modes[engine], `./${file}`,
    ];
    const child = spawn("latexmk", args, {
      cwd,
      detached: true,
      env: {
        ...texEnvironment(), TEXMFCACHE: cache,
        openin_any: "p", openout_any: "p",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let log = "";
    let timedOut = false;
    const append = bytes => { log = (log + bytes.toString()).slice(-48_000); };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    const timeout = setTimeout(() => {
      if (child.pid === undefined) return;
      timedOut = true;
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch (error) {
        if (error.code !== "ESRCH") child.kill("SIGKILL");
      }
    }, 60_000);
    child.once("error", error => {
      clearTimeout(timeout);
      if (error.code === "ENOENT") reject(new Error("Install MacTeX or TeX Live with latexmk, then build again."));
      else reject(error);
    });
    child.once("close", code => {
      clearTimeout(timeout);
      if (timedOut) resolve({ ok: false, message: "This build took more than a minute.", log });
      else if (code === 0) resolve({ ok: true, log });
      else {
        const firstError = log.split("\n").find(line => /^! |^.+\.tex:\d+:/.test(line));
        resolve({ ok: false, message: firstError || "LaTeX could not build this project.", log });
      }
    });
  });
}

export async function compileProject(root, file, engine) {
  if (!Object.hasOwn(modes, engine) || typeof file !== "string" || !/\.tex$/i.test(file)) {
    throw new Error("Choose a TeX main document and a LaTeX engine.");
  }
  if (/["`$\\\r\n]/.test(file)) throw new Error("Rename the main document to use a simple file name.");
  await projectPath(root, file, { editable: true });
  const staging = await mkdtemp(path.join(os.tmpdir(), "quire-latex-"));
  try {
    const project = path.join(await realpath(staging), "project");
    await cp(root, project, {
      recursive: true,
      async filter(source) {
        if (source === root) return true;
        if ([".git", ".quire-output", "node_modules"].includes(path.basename(source))) return false;
        // Compile a private snapshot and skip links that could leave the project.
        const info = await lstat(source);
        return info.isFile() || info.isDirectory();
      },
    });
    // LuaTeX needs a writable relative cache when TeX's file restrictions are enabled.
    const cache = path.basename(await mkdtemp(path.join(project, "quire-tex-cache-")));
    const result = await runLatex(project, file, engine, cache);
    const issues = buildDiagnostics(result.log, project, file, result.ok);
    if (!result.ok) {
      if (!issues.some(issue => issue.severity === "error")) {
        issues.unshift({ severity: "error", path: file, line: null, message: result.message });
      }
      return { ...result, issues };
    }
    const name = path.basename(file, path.extname(file));
    const output = path.join(project, ".quire-output", name);
    try {
      const bytes = await readFile(output + ".pdf");
      const map = await readFile(output + ".synctex.gz").catch(() => null);
      return { ...result, bytes: new Uint8Array(bytes), name: `${name}.pdf`, issues, mapping: map ? { root: project, bytes: map } : null };
    } catch {
      const message = "LaTeX completed without creating a PDF.";
      return { ok: false, message, log: result.log, issues: [{ severity: "error", message, path: file, line: null }] };
    }
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
