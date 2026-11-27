const headings = ["part", "chapter", "section", "subsection", "subsubsection", "paragraph"];

function uncomment(line) {
  for (let at = 0; at < line.length; at++) {
    if (line[at] === "\\") at++;
    else if (line[at] === "%") return line.slice(0, at);
  }
  return line;
}

function argument(line, start) {
  if (line[start] !== "{") return null;
  let depth = 1;
  for (let end = start + 1; end < line.length; end++) {
    if (line[end] === "\\") end++;
    else if (line[end] === "{") depth++;
    else if (line[end] === "}" && --depth === 0) return line.slice(start + 1, end);
  }
  return null;
}

export function latexSymbols(text, path) {
  const structure = [];
  const labels = [];
  let verbatim = "";
  for (const [index, raw] of text.split(/\r\n?|\n/).entries()) {
    const line = uncomment(raw);
    if (verbatim) {
      if (line.includes(`\\end{${verbatim}}`)) verbatim = "";
      continue;
    }
    const literal = /\\begin\{(verbatim\*?|lstlisting|minted)\}/.exec(line);
    if (literal && !line.includes(`\\end{${literal[1]}}`)) verbatim = literal[1];
    const commands = /\\(part|chapter|section|subsection|subsubsection|paragraph|label|input|include|subfile)\*?\s*(?:\[[^\]]*\]\s*)?(?=\{)/g;
    for (const match of line.matchAll(commands)) {
      if (match.index > (literal?.index ?? Infinity)) break;
      const value = argument(line, match.index + match[0].length)?.trim();
      if (!value) continue;
      const location = { path, line: index + 1, column: match.index + 1 };
      const level = headings.indexOf(match[1]);
      if (level >= 0) {
        const title = value.replace(/\\(?:textbf|textit|emph|texttt|underline)(?=\{)/g, "").replace(/[{}]/g, "").replaceAll("~", " ");
        structure.push({ kind: "heading", title, level, ...location });
      } else if (match[1] === "label") {
        labels.push({ key: value, ...location });
      } else {
        structure.push({ kind: "include", target: value, ...location });
      }
    }
  }
  return { structure, labels };
}

export function bibliographySymbols(text, path) {
  const entries = [];
  const lines = text.split(/\r\n?|\n/);
  for (let index = 0; index < lines.length; index++) {
    const declaration = /^\s*@([A-Za-z]+)\s*[{(]\s*(.*)/.exec(uncomment(lines[index]));
    if (!declaration || /^(?:string|preamble|comment)$/i.test(declaration[1])) continue;
    const candidates = declaration[2].trim() || lines[index + 1]?.trim();
    const key = candidates && /^([^\s,={}()]+)\s*,/.exec(candidates)?.[1];
    if (key) entries.push({ key, path, line: index + 1, column: 1 });
  }
  return entries;
}
