import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap, snippetCompletion } from "@codemirror/autocomplete";
import type { CompletionContext } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import {
  bracketMatching, foldGutter, foldKeymap, foldService, getIndentUnit, HighlightStyle,
  indentService, indentUnit, StreamLanguage, syntaxHighlighting,
} from "@codemirror/language";
import { stex } from "@codemirror/legacy-modes/mode/stex";
import { lintGutter, lintKeymap, setDiagnostics } from "@codemirror/lint";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { Compartment, EditorSelection, EditorState, Prec } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import {
  drawSelection, EditorView, gutter, GutterMarker, highlightActiveLine, highlightActiveLineGutter,
  highlightSpecialChars, keymap, lineNumbers, rectangularSelection,
} from "@codemirror/view";
import type { ViewUpdate } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { latexSymbols } from "../desktop/latex-symbols.mjs";
import type { BuildIssue, Preferences, ProjectSymbols } from "./api";

const tex = StreamLanguage.define({
  ...stex,
  languageData: { commentTokens: { line: "%" }, closeBrackets: { brackets: ["(", "[", "{", "$"] } },
});

const colors = HighlightStyle.define([
  { tag: [tags.tagName, tags.keyword], class: "tex-command" },
  { tag: [tags.atom, tags.number, tags.bool, tags.string], class: "tex-argument" },
  { tag: [tags.bracket, tags.punctuation], class: "tex-bracket" },
  { tag: tags.special(tags.variableName), class: "tex-math" },
  { tag: tags.comment, class: "tex-comment" },
]);

const completions = [
  snippetCompletion("\\section{${title}}", { label: "\\section", type: "function" }),
  snippetCompletion("\\subsection{${title}}", { label: "\\subsection", type: "function" }),
  snippetCompletion("\\begin{${environment}}\n\t${}\n\\end{${environment}}", { label: "\\begin", type: "keyword" }),
  snippetCompletion("\\begin{itemize}\n\t\\item ${}\n\\end{itemize}", { label: "\\begin{itemize}", type: "keyword" }),
  snippetCompletion("\\begin{equation}\n\t${}\n\\end{equation}", { label: "\\begin{equation}", type: "keyword" }),
  snippetCompletion("\\frac{${numerator}}{${denominator}}", { label: "\\frac", type: "function" }),
  snippetCompletion("\\textbf{${text}}", { label: "\\textbf", type: "function" }),
  snippetCompletion("\\emph{${text}}", { label: "\\emph", type: "function" }),
  snippetCompletion("\\cite{${key}}", { label: "\\cite", type: "function" }),
  snippetCompletion("\\ref{${label}}", { label: "\\ref", type: "function" }),
  snippetCompletion("\\label{${label}}", { label: "\\label", type: "function" }),
  snippetCompletion("\\input{${file}}", { label: "\\input", type: "function" }),
  snippetCompletion("\\includegraphics[width=\\linewidth]{${file}}", { label: "\\includegraphics", type: "function" }),
  ...["alpha", "beta", "gamma", "delta", "theta", "lambda", "pi", "sigma", "sum", "int", "infty",
    "rightarrow", "leftarrow", "times", "cdot", "sqrt", "partial", "mathrm", "mathbf", "text"].map(command =>
    ({ label: "\\" + command, type: "variable" })),
];

const environmentNames = ["abstract", "align", "align*", "center", "description", "document", "enumerate",
  "equation", "equation*", "figure", "gather", "itemize", "minipage", "proof", "quote", "tabular", "table", "verbatim"];
const citationCommand = /^(?:cite\w*|(?:paren|text|auto|foot|super|smart)cite\w*|nocite)$/i;
const referenceCommand = /^(?:ref|eqref|pageref|autoref|cref|vref|nameref)$/i;

function completeTex(context: CompletionContext, file: string, features: EditorFeatures) {
  const fragment = context.state.sliceDoc(context.state.doc.lineAt(context.pos).from, context.pos);
  const argument = /\\([A-Za-z]+)\*?(?:\[[^\]]*\]){0,2}\{([^{}]*)$/.exec(fragment);
  if (argument) {
    const [, command, value] = argument;
    const current = value.split(",").at(-1)!.trimStart();
    const from = context.pos - current.length;
    const symbols = features.symbols();
    if (referenceCommand.test(command) || citationCommand.test(command)) {
      const definitions = citationCommand.test(command) ? symbols.citations :
        [...latexSymbols(context.state.doc.toString(), file).labels, ...symbols.labels.filter(item => item.path !== file)];
      const keys = new Map(definitions.map(item => [item.key, item.path]));
      return { from, options: [...keys].map(([label, detail]) => ({ label, detail, type: "reference" })), validFor: /^[^\s{},]*$/ };
    }
    if (command === "begin" || command === "end") {
      return { from, options: environmentNames.map(label => ({ label, type: "keyword" })), validFor: /^[\w*]*$/ };
    }
    if (["input", "include", "subfile", "includegraphics", "addbibresource", "bibliography"].includes(command)) {
      const candidates = features.files().filter(path => path !== file &&
        (command === "includegraphics" ? /\.(pdf|png|jpe?g|svg|eps|webp)$/i.test(path) :
          ["bibliography", "addbibresource"].includes(command) ? /\.bib$/i.test(path) : /\.(tex|ltx)$/i.test(path)));
      const removeExtension = ["include", "bibliography"].includes(command);
      const options = candidates.map(path => ({ label: removeExtension ? path.replace(/\.(tex|ltx|bib)$/i, "") : path, type: "file" }));
      return { from, options, validFor: /^[^{}]*$/ };
    }
  }
  const command = context.matchBefore(/\\[A-Za-z@]*/);
  if (!command || (command.text.length === 1 && !context.explicit)) return null;
  return { from: command.from, options: completions, validFor: /^\\[a-z@]*$/i };
}

const editability = new Compartment();
const editorOptions = new Compartment();
const inputMode = new Compartment();
let vimBinding: Extension | undefined;
let vimLoading: Promise<void> | undefined;

type EditorFeatures = {
  files: () => string[];
  symbols: () => ProjectSymbols;
  command: (name: "save" | "close-tab" | "next-tab" | "previous-tab") => void;
  syncToPdf: (view: EditorView, position: number) => void;
  definition: (kind: "labels" | "citations", key: string) => void;
};
const handlers = new WeakMap<EditorView, EditorFeatures>();
export async function prepareEditor(preferences: Preferences) {
  if (!preferences.vimMode || vimBinding) return;
  vimLoading ??= import("@replit/codemirror-vim").then(({ vim, Vim }) => {
    for (const [name, prefix, action] of [
      ["write", "w", "save"], ["quit", "q", "close-tab"], ["wq", "wq", "close-tab"],
      ["bnext", "bn", "next-tab"], ["bprevious", "bp", "previous-tab"],
    ] as const) Vim.defineEx(name, prefix, cm => handlers.get(cm.cm6)?.command(action));
    vimBinding = Prec.high(vim({ status: true }));
  }).catch(error => {
    vimLoading = undefined;
    throw error;
  });
  await vimLoading;
}

class NumberMarker extends GutterMarker {
  constructor(readonly text: string) { super(); }
  eq(other: NumberMarker) { return other.text === this.text; }
  toDOM() { return document.createTextNode(this.text); }
}

const relativeNumbers = gutter({
  class: "cm-lineNumbers cm-relativeNumbers",
  lineMarker(view, block) {
    const current = view.state.doc.lineAt(view.state.selection.main.head).number;
    const line = view.state.doc.lineAt(block.from).number;
    return new NumberMarker(String(line === current ? line : Math.abs(line - current)));
  },
  lineMarkerChange: update => update.selectionSet,
  initialSpacer: view => new NumberMarker("9".repeat(String(view.state.doc.lines).length)),
  updateSpacer: (spacer, update) => update.docChanged
    ? new NumberMarker("9".repeat(String(update.state.doc.lines).length)) : spacer,
});

const environmentFold = foldService.of((state, from, to) => {
  const opening = /\\begin\{([\w*]+)\}/.exec(state.sliceDoc(from, to));
  if (!opening || opening.index > state.sliceDoc(from, to).search(/%|$/)) return null;
  const name = opening[1];
  const limit = Math.min(state.doc.lines, state.doc.lineAt(from).number + 4000);
  let depth = 0;
  for (let number = state.doc.lineAt(from).number; number <= limit; number++) {
    const line = state.doc.line(number);
    for (const part of line.text.split(/(?<!\\)%/)[0].matchAll(/\\(begin|end)\{([\w*]+)\}/g)) {
      if (part[2] !== name) continue;
      depth += part[1] === "begin" ? 1 : -1;
      if (depth === 0) return line.from > to + 1 ? { from: to, to: line.from - 1 } : null;
    }
  }
  return null;
});

const environmentIndent = indentService.of((context, position) => {
  const current = context.lineAt(position, 1);
  if (current.from === 0) return null;
  const previous = context.lineAt(current.from - 1, -1);
  const indent = context.countColumn(previous.text.match(/^\s*/)?.[0] ?? "");
  if (/^\s*\\end\{/.test(current.text)) return Math.max(0, indent - getIndentUnit(context.state));
  if (/\\begin\{[\w*]+\}/.test(previous.text) && !/\\end\{/.test(previous.text)) return indent + getIndentUnit(context.state);
  return null;
});

function editorExtensions(preferences: Preferences) {
  return [
    EditorState.tabSize.of(preferences.tabSize),
    indentUnit.of(" ".repeat(preferences.tabSize)),
    preferences.lineNumberMode === "relative" ? relativeNumbers : preferences.lineNumberMode === "absolute" ? lineNumbers() : [],
    preferences.activeLine ? [highlightActiveLine(), highlightActiveLineGutter()] : [],
    ...(preferences.lineWrapping ? [EditorView.lineWrapping] : []),
    preferences.autoCloseBrackets ? [closeBrackets(), keymap.of(closeBracketsKeymap)] : [],
    preferences.vimMode ? [] : keymap.of([indentWithTab]),
  ];
}

export function configureEditor(view: EditorView | undefined, preferences: Preferences) {
  if (!view) return;
  const effects = [editorOptions.reconfigure(editorExtensions(preferences))];
  const enabled = !!vimBinding && inputMode.get(view.state) === vimBinding;
  if (enabled !== preferences.vimMode) effects.push(inputMode.reconfigure(preferences.vimMode ? vimBinding ?? [] : []));
  view.dispatch({ effects });
}

export function setReadOnly(view: EditorView | undefined, readonly: boolean) {
  view?.dispatch({ effects: editability.reconfigure(EditorState.readOnly.of(readonly)) });
}

export function createEditor(
  parent: HTMLElement, file: string, text: string, onUpdate: (update: ViewUpdate) => void,
  preferences: Preferences, features: EditorFeatures, previousState?: EditorState,
) {
  const latex = /\.(?:tex|sty|cls|ltx|tikz|pgf|bib|latex|bbl)$/i.test(file);
  const view = new EditorView({
    parent,
    state: previousState ?? EditorState.create({
      doc: text,
      extensions: [
        history(), drawSelection(), highlightSpecialChars(), EditorState.allowMultipleSelections.of(true),
        bracketMatching(), highlightSelectionMatches(), rectangularSelection({ eventFilter: event => event.altKey && event.shiftKey }),
        EditorView.contentAttributes.of({ "aria-label": file, spellcheck: "false", autocapitalize: "off" }),
        EditorState.lineSeparator.of(text.includes("\r\n") ? "\r\n" : "\n"),
        editorOptions.of(editorExtensions(preferences)),
        inputMode.of(preferences.vimMode ? vimBinding ?? [] : []),
        editability.of(EditorState.readOnly.of(false)),
        lintGutter(),
        keymap.of([
          ...completionKeymap, ...defaultKeymap, ...historyKeymap, ...searchKeymap, ...foldKeymap, ...lintKeymap,
        ]),
        ...(latex ? [tex, syntaxHighlighting(colors), environmentFold, environmentIndent, foldGutter(),
          autocompletion({ override: [context => completeTex(context, file, features)] })] : []),
        EditorView.domEventHandlers({
          click(event, view) {
            if (event.button !== 0 || (!event.altKey && !event.metaKey && !event.ctrlKey)) return false;
            const position = view.posAtCoords({ x: event.clientX, y: event.clientY });
            if (position === null) return false;
            if (event.altKey) {
              const line = view.state.doc.lineAt(position);
              const col = position - line.from;
              for (const token of line.text.matchAll(/\\([A-Za-z]+)\*?(?:\[[^\]]*\]){0,2}\{([^{}]*)\}/g)) {
                const start = token.index + token[0].indexOf("{") + 1;
                if (col < start || col > start + token[2].length) continue;
                const kind = referenceCommand.test(token[1]) ? "labels" : citationCommand.test(token[1]) ? "citations" : null;
                if (!kind) return false;
                const keys = token[2].split(",");
                let remaining = col - start;
                const key = keys.find(part => (remaining -= part.length + 1) < 0)?.trim();
                if (!key) return false;
                features.definition(kind, key);
                return true;
              }
              return false;
            }
            if (latex && !event.shiftKey) {
              features.syncToPdf(view, position);
              return true;
            }
            return false;
          },
        }),
        EditorView.updateListener.of(onUpdate),
      ],
    }),
  });
  handlers.set(view, features);
  return view;
}

export function revealLine(view: EditorView, line: number, column = 1, length = 0) {
  if (!Number.isInteger(line) || line < 1 || line > view.state.doc.lines) return;
  const text = view.state.doc.line(line);
  const from = Math.min(text.to, text.from + Math.max(0, column - 1));
  const to = Math.min(text.to, from + length);
  view.dispatch({ selection: EditorSelection.range(from, to), effects: EditorView.scrollIntoView(from, { y: "center" }) });
  view.focus();
}

export function showDiagnostics(view: EditorView | undefined, path: string | undefined, issues: BuildIssue[]) {
  if (!view || !path) return;
  const diagnostics = issues.flatMap(issue => {
    if (issue.path !== path || !issue.line || issue.line > view.state.doc.lines) return [];
    const line = view.state.doc.line(issue.line);
    const from = line.from + (line.text.match(/^\s*/)?.[0].length ?? 0);
    return [{ from, to: line.to, severity: issue.severity, message: issue.message }];
  });
  view.dispatch(setDiagnostics(view.state, diagnostics));
}
