import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap, snippetCompletion } from "@codemirror/autocomplete";
import type { CompletionContext } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, HighlightStyle, indentUnit, StreamLanguage, syntaxHighlighting } from "@codemirror/language";
import { stex } from "@codemirror/legacy-modes/mode/stex";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { Compartment, EditorState } from "@codemirror/state";
import {
  drawSelection, EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers,
} from "@codemirror/view";
import type { ViewUpdate } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import type { Preferences } from "./api";

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

function completeTex(context: CompletionContext) {
  const command = context.matchBefore(/\\[A-Za-z@]*/);
  if (!command || (command.text.length === 1 && !context.explicit)) return null;
  return { from: command.from, options: completions, validFor: /^\\[a-z@]*$/i };
}

const editability = new Compartment();
const editorOptions = new Compartment();

function editorExtensions(preferences: Preferences) {
  return [
    EditorState.tabSize.of(preferences.tabSize),
    indentUnit.of(" ".repeat(preferences.tabSize)),
    ...(preferences.lineNumbers ? [lineNumbers(), highlightActiveLineGutter()] : []),
    ...(preferences.lineWrapping ? [EditorView.lineWrapping] : []),
  ];
}

export function configureEditor(view: EditorView | undefined, preferences: Preferences) {
  view?.dispatch({ effects: editorOptions.reconfigure(editorExtensions(preferences)) });
}

export function setReadOnly(view: EditorView | undefined, readonly: boolean) {
  view?.dispatch({ effects: editability.reconfigure(EditorState.readOnly.of(readonly)) });
}

export function createEditor(
  parent: HTMLElement, file: string, text: string, onUpdate: (update: ViewUpdate) => void,
  preferences: Preferences, previousState?: EditorState,
) {
  const latex = /\.(?:tex|sty|cls|ltx|tikz|pgf|bib|latex|bbl)$/i.test(file);
  return new EditorView({
    parent,
    state: previousState ?? EditorState.create({
      doc: text,
      extensions: [
        highlightActiveLine(), history(), drawSelection(),
        bracketMatching(), closeBrackets(), highlightSelectionMatches(),
        EditorView.contentAttributes.of({ "aria-label": file, spellcheck: "false", autocapitalize: "off" }),
        EditorState.lineSeparator.of(text.includes("\r\n") ? "\r\n" : "\n"),
        editorOptions.of(editorExtensions(preferences)),
        editability.of(EditorState.readOnly.of(false)),
        keymap.of([
          ...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, ...searchKeymap, ...completionKeymap,
          { ...indentWithTab, run: view => view.hasFocus && indentWithTab.run!(view) },
        ]),
        ...(latex ? [tex, syntaxHighlighting(colors), autocompletion({ override: [completeTex] })] : []),
        EditorView.updateListener.of(onUpdate),
      ],
    }),
  });
}

export function revealLine(view: EditorView, line: number) {
  if (!Number.isInteger(line) || line < 1 || line > view.state.doc.lines) return;
  const from = view.state.doc.line(line).from;
  view.dispatch({ selection: { anchor: from }, effects: EditorView.scrollIntoView(from, { y: "center" }) });
  view.focus();
}

export type Heading = { title: string; line: number; level: number };
export function getHeadings(text: string): Heading[] {
  return text.split(/\r?\n/).flatMap((line, index) => {
    const match = /^\s*\\(chapter|section|subsection|subsubsection)\*?(?:\[[^\]]*\])?\{(.+)\}/.exec(line);
    if (!match) return [];
    const level = ["chapter", "section", "subsection", "subsubsection"].indexOf(match[1]);
    return [{ title: match[2], line: index + 1, level: Math.max(0, level - 1) }];
  });
}
