import path from "node:path";

export function sourceInProject(root, input) {
  const relative = path.relative(root, path.resolve(root, input));
  if (!relative || relative === ".." || relative.startsWith("../") || path.isAbsolute(relative)) return null;
  return relative;
}

export function buildDiagnostics(log, snapshot, main, success) {
  const entries = [];
  const seen = new Set();
  function add(severity, message, source = main, line = null) {
    const key = JSON.stringify([severity, source, line, message]);
    if (!seen.has(key)) {
      seen.add(key);
      entries.push({ severity, message, path: source, line });
    }
  }
  for (const text of log.split(/\r?\n/)) {
    const located = /^(.+?\.(?:tex|ltx|latex|sty|cls|bib|bbl|bst)):(\d+):\s*(.+)$/i.exec(text);
    if (located) {
      const source = sourceInProject(snapshot, located[1]);
      if (source) add(/warning/i.test(located[3]) ? "warning" : "error", located[3], source, Number(located[2]) || null);
      continue;
    }
    const warning = /^(?:LaTeX(?: Font)?|Package \S+|Class \S+) Warning:\s*(.+)/.exec(text);
    if (warning) {
      // TeX can report a package warning for an included file without giving its path.
      add("warning", warning[1].trim());
    }
  }
  if (!success && !entries.some(entry => entry.severity === "error")) {
    const general = /^!\s+(.+)$/m.exec(log)?.[1];
    if (general) add("error", general);
  }
  return entries.slice(0, 200);
}
