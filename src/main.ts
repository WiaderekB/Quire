import "@fontsource/ibm-plex-mono/latin-400.css";
import "@fontsource/ibm-plex-mono/latin-500.css";
import "./style.css";
import { gotoLine, openSearchPanel } from "@codemirror/search";
import type { EditorState } from "@codemirror/state";
import type { EditorView, ViewUpdate } from "@codemirror/view";
import { api } from "./api";
import type { Appearance, Engine, Preferences, ProjectFile, Source, Workspace } from "./api";
import { configureEditor, createEditor, getHeadings, revealLine, setReadOnly } from "./editor";
import { icon, iconButton } from "./icons";
import type { Icon } from "./icons";
import { Preview } from "./preview";
import { templates, texText } from "../desktop/templates.mjs";
import type { TemplateId } from "../desktop/templates.mjs";

const mac = api.platform === "darwin";
const shortcut = mac ? "⌘↵" : "Ctrl+↵";
const settingsShortcut = mac ? "⌘," : "Ctrl+,";
const quickShortcut = mac ? "⌘K" : "Ctrl+K";
const app = document.querySelector<HTMLElement>("#app")!;
app.classList.toggle("mac", mac);
app.innerHTML = `
  <header class="topbar">
    <div class="top-leading">
      <div class="brand">
        <span class="brand-mark" aria-hidden="true">${icon("files")}</span>
        <span>Quire</span>
      </div>
      <span class="toolbar-divider"></span>
      <div class="project-picker">
        <button id="project-menu" class="project-button" aria-expanded="false" aria-controls="project-popover">
          <span id="project-name">Projects</span>${icon("chevronDown")}
        </button>
        <div id="project-popover" class="popover" hidden></div>
      </div>
      <button id="quick-open" class="icon-button" title="Quick open (${quickShortcut})" aria-label="Quick open">${icon("search")}</button>
    </div>
    <div class="view-switch" role="group" aria-label="Workspace view">
      <button data-view="editor" title="Source only" aria-label="Source only" aria-pressed="false">${icon("fileCode")}<span>Source</span></button>
      <button data-view="split" title="Source and preview" aria-label="Source and preview" aria-pressed="true">${icon("columns2")}<span>Split</span></button>
      <button data-view="preview" title="Preview only" aria-label="Preview only" aria-pressed="false">${icon("fileText")}<span>PDF</span></button>
    </div>
    <div class="top-actions">
      <button id="cloud-button" class="cloud-button">${icon("cloud")}<span>Connect Overleaf</span></button>
      <div class="compile-group">
        <button id="build" class="compile-button" title="Compile (${shortcut})">${icon("play")}<span>Compile</span></button>
        <button id="build-settings" class="compile-options" title="Compiler settings" aria-label="Compiler settings">${icon("chevronDown")}</button>
      </div>
    </div>
  </header>
  <main class="workspace" data-view="split">
    <aside class="sidebar" aria-label="Project navigation">
      <section class="files-section">
        <div class="sidebar-heading"><h2>Files</h2>
          <button id="new-file" class="icon-button" title="New file" aria-label="New file">${icon("plus")}</button>
        </div>
        <div id="files" class="file-list"></div>
      </section>
      <section class="outline-section" id="outline-section" hidden>
        <div class="sidebar-heading"><h2>Outline</h2></div>
        <nav id="outline" aria-label="Document outline"></nav>
      </section>
      <button id="settings" class="settings-button" title="Settings (${settingsShortcut})">${icon("gear")}<span>Settings</span></button>
    </aside>
    <div class="document-panes">
    <section class="source-pane" aria-label="Source editor">
      <div class="pane-bar source-bar">
        <div id="file-tabs" class="file-tabs" role="tablist" aria-label="Open project files"></div>
        <div class="source-actions">
          <button id="insert-block" class="icon-button" title="Insert LaTeX block" aria-label="Insert LaTeX block">${icon("plus")}</button>
          <button id="find-button" class="icon-button" title="Find in file" aria-label="Find in file">${icon("search")}</button>
        </div>
      </div>
      <div id="editor" class="editor" role="tabpanel" aria-label="Source"></div>
      <div id="editor-empty" class="empty-state" hidden></div>
    </section>
    <div id="pane-divider" class="pane-divider" role="separator" tabindex="0" aria-orientation="vertical"
      aria-label="Resize source and preview" aria-valuemin="34" aria-valuemax="66" aria-valuenow="52" hidden></div>
    <section class="preview-pane" aria-label="PDF preview">
      <div class="pane-bar preview-bar">
        <div class="pane-title"><span>Preview</span><span id="page-count" class="page-count" hidden></span></div>
        <div class="preview-tools" id="preview-tools">
          <button class="icon-button" id="zoom-out" title="Zoom out" aria-label="Zoom out">${icon("minus")}</button>
          <button id="fit" class="zoom-label" title="Fit page" aria-label="Fit page">Fit</button>
          <button class="icon-button" id="zoom-in" title="Zoom in" aria-label="Zoom in">${icon("plus")}</button>
          <span class="toolbar-divider"></span>
          <button class="icon-button" id="export" title="Save PDF" aria-label="Save PDF">${icon("download")}</button>
        </div>
      </div>
      <div id="preview-scroll" class="preview-scroll">
        <div id="paper-stack" class="paper-stack"></div>
        <div id="preview-empty" class="empty-state">
          <span class="empty-icon">${icon("fileText")}</span>
          <strong>No PDF yet</strong>
          <p>Compile your project to see it here.</p>
        </div>
      </div>
      <section id="build-log" class="build-log" hidden>
        <div class="log-bar"><strong>Build log</strong>
          <button id="close-log" class="icon-button" title="Close build log" aria-label="Close build log">${icon("x")}</button>
        </div>
        <pre id="log-text"></pre>
      </section>
    </section>
    </div>
  </main>
  <footer class="statusbar">
    <div class="status-slot">
      <button class="icon-button sidebar-toggle" id="toggle-sidebar" title="Toggle sidebar" aria-label="Toggle sidebar" aria-pressed="true">${icon("panelLeft")}</button>
      <button id="settings-collapsed" class="icon-button" title="Settings (${settingsShortcut})" aria-label="Settings" hidden>${icon("gear")}</button>
      <span id="save-status" role="status"></span><span id="sync-status" role="status" hidden></span>
    </div>
    <div class="status-slot status-details">
      <span id="cursor" class="cursor"></span>
      <button id="build-status" class="status-button" title="Show build log"></button>
    </div>
  </footer>
  <div id="toast" class="toast" role="status" hidden></div>
  <dialog id="dialog" aria-labelledby="dialog-title">
    <form id="dialog-form">
      <button type="button" id="close-dialog" class="icon-button dialog-close" title="Close" aria-label="Close">${icon("x")}</button>
      <div id="dialog-icon" class="dialog-icon"></div>
      <h2 id="dialog-title"></h2>
      <p id="dialog-description" class="dialog-description"></p>
      <div id="dialog-fields" class="dialog-fields"></div>
      <p id="dialog-error" class="dialog-error" role="alert" hidden></p>
      <div class="dialog-actions">
        <button type="button" id="cancel-dialog" class="secondary-button">Cancel</button>
        <button type="submit" id="confirm-dialog" class="primary-button"></button>
      </div>
    </form>
  </dialog>
  <dialog id="quick-palette" class="quick-palette" aria-label="Quick open">
    <form id="quick-form">
      <label class="quick-query">${icon("search")}
        <input id="quick-input" role="combobox" aria-expanded="true" aria-autocomplete="list"
          aria-label="Find a file or command" aria-controls="quick-results" placeholder="Find a file or command…" autocomplete="off" spellcheck="false">
      </label>
      <ul id="quick-results" role="listbox" aria-label="Results"></ul>
      <p id="quick-empty" class="quick-empty" hidden>No matching files or commands.</p>
      <footer class="quick-hints"><span><kbd>↑</kbd> <kbd>↓</kbd> Choose</span><span><kbd>↵</kbd> Open</span><span><kbd>Esc</kbd> Close</span></footer>
    </form>
  </dialog>`;

const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id)! as T;
const main = app.querySelector<HTMLElement>("main")!;
const panes = app.querySelector<HTMLElement>(".document-panes")!;
const divider = el("pane-divider");
const editorHost = el("editor");
const dialog = el<HTMLDialogElement>("dialog");
const form = el<HTMLFormElement>("dialog-form");
const quick = el<HTMLDialogElement>("quick-palette");
const quickInput = el<HTMLInputElement>("quick-input");
const quickResults = el("quick-results");
const popover = el("project-popover");
const collapse = new Set<string>();
const tabBar = el("file-tabs");
const storedEditors = new Map<string, { version: string; state: EditorState; scrollTop: number }>();
const viewButtons = [...app.querySelectorAll<HTMLButtonElement>(".view-switch button")];
let workspace: Workspace = { project: null, files: [], recent: [] };
let view: EditorView | undefined;
let source: Source | undefined;
let activeFile: ProjectFile | undefined;
let saveTimer: number | undefined;
let saveInProgress: Promise<void> | undefined;
let autoSyncTimer: number | undefined;
let autoCompileTimer: number | undefined;
let toastTimer: number | undefined;
let syncingProject: string | undefined;
let applying = false;
let building = false;
let switching = false;
let switchingFile = false;
let currentBuildLog = "";
let syncMessage = "";
let syncError = false;
let buildMessage = "";
let buildError = false;
let buildStale = false;
let saveError = "";
let savePending = false;
let editCount = 0;
let dialogAction: ((data: FormData) => Promise<void>) | undefined;
let dialogBusy = false;
let preferences: Preferences = {
  appearance: "system", editorSize: 14, tabSize: 2, lineNumbers: true, lineWrapping: true, autoCompile: false,
};
let split = 52;
let tabs: string[] = [];
let focusRestore: { mode: string; sidebar: boolean } | undefined;
type QuickItem = { label: string; detail?: string; key?: string; symbol: Icon; action: () => void | Promise<unknown> };
let quickItems: QuickItem[] = [];
let quickSelection = 0;

const preview = new Preview(el("preview-scroll"), el("paper-stack"), (page, pages, zoom) => {
  const count = el("page-count");
  count.hidden = !pages;
  count.textContent = pages ? `${page} / ${pages}` : "";
  count.title = pages ? `Page ${page} of ${pages}` : "";
  el("fit").textContent = zoom;
  for (const id of ["zoom-out", "fit", "zoom-in", "export"]) el<HTMLButtonElement>(id).disabled = !pages;
});

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function notify(text: string, error = false) {
  const toast = el("toast");
  toast.replaceChildren();
  const symbol = document.createElement("span");
  symbol.innerHTML = icon(error ? "circleAlert" : "check");
  const label = document.createElement("span");
  label.textContent = text;
  const close = iconButton("x", "Dismiss");
  close.addEventListener("click", () => { toast.hidden = true; });
  toast.append(symbol, label, close);
  toast.classList.toggle("warning", error);
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { toast.hidden = true; }, error ? 9500 : 3800);
}

function run(action: () => void | Promise<unknown>) {
  try {
    void Promise.resolve(action()).catch(error => notify(message(error), true));
  } catch (error) {
    notify(message(error), true);
  }
}

function showView(mode: string, persist = true) {
  if (persist && focusRestore) toggleFocusMode();
  if (!["editor", "split", "preview"].includes(mode)) mode = "split";
  main.dataset.view = mode;
  divider.hidden = mode !== "split";
  if (persist) localStorage.setItem("view", mode);
  for (const button of viewButtons) button.setAttribute("aria-pressed", String(button.dataset.view === mode));
  if (mode !== "preview") view?.requestMeasure();
}

function showSidebar(show: boolean, persist = true) {
  if (persist && focusRestore) toggleFocusMode();
  main.classList.toggle("sidebar-hidden", !show);
  el("settings-collapsed").hidden = show;
  el("toggle-sidebar").setAttribute("aria-pressed", String(show));
  if (persist) localStorage.setItem("sidebar", show ? "open" : "closed");
}

function toggleFocusMode() {
  if (focusRestore) {
    const previous = focusRestore;
    focusRestore = undefined;
    showView(previous.mode, false);
    showSidebar(previous.sidebar, false);
  } else {
    focusRestore = { mode: main.dataset.view ?? "split", sidebar: !main.classList.contains("sidebar-hidden") };
    showView("editor", false);
    showSidebar(false, false);
  }
  if (main.dataset.view !== "preview") view?.focus();
}

function resizeSplit(value: number, persist = true) {
  split = Math.max(34, Math.min(66, Math.round(value)));
  panes.style.setProperty("--source-share", `${split}%`);
  divider.setAttribute("aria-valuenow", String(split));
  divider.setAttribute("aria-valuetext", `Source ${split} percent`);
  if (persist) localStorage.setItem("source-share", String(split));
}

function setStatus(id: string, symbol: Icon | null, text: string, tone = "") {
  const item = el(id);
  if (item.dataset.text === text && item.dataset.tone === tone) return;
  item.dataset.text = text;
  item.dataset.tone = tone;
  item.hidden = !text;
  item.replaceChildren();
  if (symbol) {
    const mark = document.createElement("span");
    mark.innerHTML = icon(symbol);
    item.append(mark);
  }
  item.append(document.createTextNode(text));
}

function renderStatus() {
  const syncing = !!syncingProject && syncingProject === workspace.project?.id;
  setStatus("save-status", saveError ? "circleAlert" : savePending ? "refresh" : "check",
    !workspace.project ? "" : saveError ? "Save failed" : savePending ? "Saving…" : "Saved locally",
    saveError ? "error" : savePending ? "working" : "good");
  el("save-status").title = saveError;
  const dirty = tabBar.querySelector<HTMLElement>(".active .tab-dirty");
  if (dirty) dirty.hidden = !savePending;
  setStatus("sync-status", syncError ? "circleAlert" : syncing ? "refresh" : "cloudCheck", syncMessage,
    syncError ? "error" : syncing ? "working" : "");
  el("sync-status").title = syncMessage;
  setStatus("build-status", buildError ? "circleAlert" : building ? "refresh" : buildStale ? null : "check", buildMessage,
    buildError ? "error" : building ? "working" : buildStale ? "" : "good");
  el<HTMLButtonElement>("build-status").disabled = !currentBuildLog;
  el<HTMLButtonElement>("build").disabled = !workspace.project?.main || building || applying;
  el<HTMLButtonElement>("new-file").disabled = !workspace.project || applying || switching || switchingFile;
  el<HTMLButtonElement>("build-settings").disabled = !workspace.project || !workspace.files.some(file => /\.tex$/i.test(file.path));
  el<HTMLButtonElement>("find-button").disabled = !view;
  el<HTMLButtonElement>("insert-block").disabled = !view || !/\.(tex|ltx)$/i.test(activeFile?.path ?? "") || applying;
  const cloud = el<HTMLButtonElement>("cloud-button");
  const connected = !!workspace.project?.connection;
  const label = connected ? syncing ? "Syncing…" : "Sync Overleaf" : "Connect Overleaf";
  if (cloud.dataset.label !== label) {
    cloud.dataset.label = label;
    cloud.title = label;
    cloud.setAttribute("aria-label", label);
    cloud.innerHTML = icon(connected ? "refresh" : "cloud") + `<span>${label}</span>`;
  }
  cloud.disabled = (connected && !!syncingProject) || switching;
  cloud.classList.toggle("working", syncing);
}

function fileName(path: string) {
  return path.split("/").at(-1)!;
}

function fileSymbol(path: string): Icon {
  return /\.(tex|cls|sty)$/i.test(path) ? "fileCode" : /\.bib$/i.test(path) ? "bookOpen" : "file";
}

function persistTabs() {
  if (workspace.project) {
    localStorage.setItem(`tabs:${workspace.project.id}`, JSON.stringify({ tabs, active: activeFile?.path }));
  }
}

function restoreTabs(id?: string): string | undefined {
  tabs = [];
  if (!id) return;
  try {
    const saved = JSON.parse(localStorage.getItem(`tabs:${id}`) ?? "{}");
    const files = new Set(workspace.files.map(file => file.path));
    if (Array.isArray(saved.tabs)) {
      tabs = [...new Set<string>(saved.tabs.filter((path: unknown) => typeof path === "string" && files.has(path)))];
    }
    return tabs.includes(saved.active) ? saved.active : tabs[0];
  } catch {
    return undefined;
  }
}

function tabKey(id: string, file: string) {
  return id + "\0" + file;
}

function rememberEditor() {
  if (!workspace.project || !activeFile || !view || !source) return;
  storedEditors.set(tabKey(workspace.project.id, activeFile.path), {
    version: source.version, state: view.state, scrollTop: view.scrollDOM.scrollTop,
  });
}

function renderTabs() {
  tabBar.replaceChildren();
  for (const [index, path] of tabs.entries()) {
    const file = workspace.files.find(entry => entry.path === path);
    if (!file) continue;
    const active = path === activeFile?.path;
    const wrapper = document.createElement("div");
    wrapper.className = "editor-tab";
    wrapper.setAttribute("role", "presentation");
    wrapper.classList.toggle("active", active);
    const tab = document.createElement("button");
    tab.type = "button";
    tab.id = `source-tab-${index}`;
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-controls", "editor");
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
    tab.title = path;
    const name = fileName(path);
    const label = document.createElement("span");
    label.textContent = tabs.some(entry => entry !== path && fileName(entry) === name) ? path : name;
    tab.innerHTML = icon(fileSymbol(path));
    tab.append(label);
    tab.addEventListener("click", () => run(() => openFile(file)));
    const dirty = document.createElement("i");
    dirty.className = "tab-dirty";
    dirty.title = "Unsaved changes";
    dirty.hidden = !active || !savePending;
    const close = iconButton("x", `Close ${name}`);
    close.classList.add("tab-close");
    close.tabIndex = -1;
    close.addEventListener("click", () => run(() => closeTab(path)));
    wrapper.append(tab, dirty, close);
    tabBar.append(wrapper);
    if (active) {
      editorHost.setAttribute("aria-labelledby", tab.id);
      wrapper.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }
  if (!activeFile) editorHost.removeAttribute("aria-labelledby");
}

async function closeTab(path = activeFile?.path) {
  if (!path || !workspace.project || switchingFile || switching || applying) return;
  const index = tabs.indexOf(path);
  if (index < 0) return;
  if (activeFile?.path === path) {
    const adjacent = tabs[index + 1] ?? tabs[index - 1];
    await openFile(workspace.files.find(file => file.path === adjacent));
  }
  storedEditors.delete(tabKey(workspace.project.id, path));
  tabs = tabs.filter(tab => tab !== path);
  persistTabs();
  renderTabs();
}

async function cycleTabs(step: number, focusEditor = true) {
  if (tabs.length < 2) return;
  const index = tabs.indexOf(activeFile?.path ?? "");
  const next = tabs[(Math.max(0, index) + step + tabs.length) % tabs.length];
  await openFile(workspace.files.find(file => file.path === next), { focus: focusEditor });
  if (!focusEditor) tabBar.querySelector<HTMLElement>('[aria-selected="true"]')?.focus();
}

function treeRow(label: string, depth: number, symbol: Icon, action: () => void, type: string) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `tree-row ${type}`;
  button.style.paddingLeft = `${8 + depth * 16}px`;
  const name = document.createElement("span");
  name.textContent = label;
  button.innerHTML = icon(symbol);
  button.append(name);
  button.addEventListener("click", action);
  return button;
}

function renderFiles() {
  const target = el("files");
  target.replaceChildren();
  if (workspace.project && !workspace.files.length) {
    const empty = document.createElement("p");
    empty.className = "sidebar-empty";
    empty.textContent = "No files in this folder.";
    target.append(empty);
    return;
  }
  function addRows(files: ProjectFile[], prefix = "", depth = 0) {
    const folders = new Map<string, ProjectFile[]>();
    const direct: ProjectFile[] = [];
    for (const file of files) {
      const subpath = file.path.slice(prefix.length);
      const slash = subpath.indexOf("/");
      if (slash < 0) direct.push(file);
      else {
        const folder = subpath.slice(0, slash);
        if (!folders.has(folder)) folders.set(folder, []);
        folders.get(folder)!.push(file);
      }
    }
    function fileRow(file: ProjectFile) {
      const row = treeRow(fileName(file.path), depth, fileSymbol(file.path), () => run(() => openFile(file)), "file-row");
      row.title = file.path;
      row.dataset.path = file.path;
      row.classList.toggle("bib", /\.bib$/i.test(file.path));
      row.classList.toggle("selected", activeFile?.path === file.path);
      if (activeFile?.path === file.path) row.setAttribute("aria-current", "true");
      target.append(row);
    }
    const mainFile = direct.find(file => file.path === workspace.project?.main);
    if (mainFile) fileRow(mainFile);
    for (const [folder, contents] of folders) {
      const key = prefix + folder + "/";
      const expanded = !collapse.has(key);
      const row = treeRow(folder, depth, expanded ? "folderOpen" : "folder", () => {
        if (expanded) collapse.add(key);
        else collapse.delete(key);
        renderFiles();
        [...target.querySelectorAll<HTMLButtonElement>(".folder-row")].find(button => button.dataset.folder === key)?.focus();
      }, "folder-row");
      row.dataset.folder = key;
      const arrow = document.createElement("span");
      arrow.className = "tree-chevron";
      arrow.innerHTML = icon(expanded ? "chevronDown" : "chevronRight");
      row.prepend(arrow);
      row.setAttribute("aria-expanded", String(expanded));
      target.append(row);
      if (expanded) addRows(contents, key, depth + 1);
    }
    direct.filter(file => file !== mainFile).forEach(fileRow);
  }
  addRows(workspace.files);
}

function renderOutline() {
  const outline = el("outline");
  outline.replaceChildren();
  const headings = view && /\.tex$/i.test(activeFile?.path ?? "") ? getHeadings(view.state.sliceDoc()) : [];
  el("outline-section").hidden = !headings.length;
  for (const heading of headings) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.line = String(heading.line);
    button.className = "outline-row";
    button.style.paddingLeft = `${9 + heading.level * 13}px`;
    const title = document.createElement("span");
    title.textContent = heading.title;
    button.innerHTML = icon("list");
    button.append(title);
    button.addEventListener("click", () => { if (view) revealLine(view, heading.line); });
    outline.append(button);
  }
}

function renderCursor() {
  const cursor = el("cursor");
  if (!view) {
    cursor.textContent = "";
    return;
  }
  const position = view.state.selection.main.head;
  const line = view.state.doc.lineAt(position);
  cursor.textContent = `Ln ${line.number}, Col ${position - line.from + 1}`;
  const headings = [...el("outline").querySelectorAll<HTMLButtonElement>("button")];
  const selected = headings.findLast(heading => Number(heading.dataset.line) <= line.number);
  headings.forEach(heading => heading.classList.toggle("current-heading", heading === selected));
}

function edited(update: ViewUpdate) {
  if (update.docChanged) {
    editCount += 1;
    savePending = true;
    renderOutline();
    clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => { void flush().catch(() => {}); }, 300);
    if (preview.hasDocument && !building && !buildError) {
      buildStale = true;
      buildMessage = "Preview needs compilation";
    }
    renderStatus();
  }
  if (update.docChanged || update.selectionSet) renderCursor();
}

async function flush() {
  clearTimeout(saveTimer);
  while (saveInProgress) await saveInProgress;
  const project = workspace.project;
  const file = activeFile;
  if (!project || !file || !source || !view) return;
  const text = view.state.sliceDoc();
  if (text === source.text) {
    savePending = false;
    saveError = "";
    renderStatus();
    return;
  }
  const version = source.version;
  const save = api.save(project.id, file.path, text, version).then(nextVersion => {
    source = { version: nextVersion, text };
    savePending = view?.state.sliceDoc() !== text;
    saveError = "";
    if (project.connection && !syncingProject && !syncError) syncMessage = "Changes to sync";
    queueSync();
    if (!building) queueCompile();
  }).catch(error => {
    saveError = message(error);
    savePending = true;
    if (saveError !== el("save-status").title) notify(saveError, true);
    throw error;
  }).finally(() => {
    saveInProgress = undefined;
    renderStatus();
  });
  saveInProgress = save;
  await save;
}

function editorPlaceholder(symbol: Icon, title: string, description: string, button?: HTMLButtonElement) {
  const empty = el("editor-empty");
  const mark = document.createElement("span");
  mark.className = "empty-icon";
  mark.innerHTML = icon(symbol);
  const text = document.createElement("strong");
  text.textContent = title;
  const detail = document.createElement("p");
  detail.textContent = description;
  empty.replaceChildren(mark, text, detail);
  if (button) empty.append(button);
  empty.hidden = false;
}

function textButton(label: string, callback: () => void, kind = "secondary-button") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = kind;
  button.textContent = label;
  button.addEventListener("click", callback);
  return button;
}

async function openFile(file?: ProjectFile, { reload = false, focus = true } = {}) {
  if (switchingFile || (applying && !reload)) return;
  if (!reload && file && view && file.path === activeFile?.path) {
    if (focus && main.dataset.view === "preview") showView("split");
    if (focus) view.focus();
    return;
  }
  const project = workspace.project;
  switchingFile = true;
  setReadOnly(view, true);
  try {
    await flush();
    let loaded: Source | undefined;
    if (project && file?.editable) loaded = await api.read(project.id, file.path);
    if (reload && file?.path === activeFile?.path && loaded?.version === source?.version && view) return;
    if (reload && view && file?.path === activeFile?.path && loaded?.version !== source?.version) {
      if (preview.hasDocument) {
        buildStale = true;
        buildMessage = "Preview needs compilation";
      }
      if (project?.connection && !syncingProject && !syncError) {
        syncMessage = "Changes to sync";
        queueSync();
      }
      queueCompile();
    }
    rememberEditor();
    view?.destroy();
    view = undefined;
    source = loaded;
    activeFile = file;
    el("editor-empty").hidden = true;
    saveError = "";
    savePending = false;
    if (project && file) {
      if (!tabs.includes(file.path)) tabs.push(file.path);
      if (loaded) {
        if (focus && main.dataset.view === "preview") showView("split");
        const previous = storedEditors.get(tabKey(project.id, file.path));
        const restored = previous?.version === loaded.version ? previous : undefined;
        view = createEditor(editorHost, file.path, loaded.text, edited, preferences, restored?.state);
        if (restored) configureEditor(view, preferences);
        view.scrollDOM.scrollTop = restored?.scrollTop ?? 0;
        if (focus) view.focus();
      } else {
        editorPlaceholder(fileSymbol(file.path), fileName(file.path), "Open this file with another app from the project folder.",
          textButton("Show file", () => run(() => api.reveal(project.id, file.path))));
      }
    } else if (project && workspace.files.length) {
      editorPlaceholder("fileCode", "No file open", "Choose a file from the sidebar.");
    } else if (project) {
      editorPlaceholder("fileCode", "Start with a source file", "Add a .tex file to write and compile.",
        textButton("New file", newFile, "primary-button"));
    } else {
      editorPlaceholder("folderOpen", "Open a project", "Choose a folder or create a LaTeX project.",
        textButton("Open folder", () => run(openFolder), "primary-button"));
    }
    persistTabs();
  } finally {
    setReadOnly(view, applying);
    switchingFile = false;
    renderFiles();
    renderTabs();
    renderOutline();
    renderCursor();
    renderStatus();
  }
}

async function loadWorkspace(next: Workspace, first = false) {
  rememberEditor();
  view?.destroy();
  view = undefined;
  source = undefined;
  activeFile = undefined;
  workspace = next;
  const remembered = restoreTabs(next.project?.id);
  collapse.clear();
  clearTimeout(autoSyncTimer);
  clearTimeout(autoCompileTimer);
  clearTimeout(saveTimer);
  el("project-name").textContent = next.project?.name ?? "Projects";
  document.title = next.project ? `${next.project.name} — Quire` : "Quire";
  syncMessage = next.project?.connection ? "Overleaf connected" : "";
  syncError = false;
  buildStale = false;
  buildError = false;
  buildMessage = next.preview ? first ? "PDF up to date" : "Last compiled PDF" : "";
  currentBuildLog = "";
  el("build-log").hidden = true;
  renderStatus();
  const initial = next.files.find(file => file.path === remembered) ??
    next.files.find(file => file.path === next.project?.main) ?? next.files.find(file => file.editable);
  const results = await Promise.allSettled([openFile(initial, { reload: true, focus: !first && !dialog.open }), showPdf(next.preview)]);
  for (const result of results) if (result.status === "rejected") notify(message(result.reason), true);
  if (next.project?.connection?.auto) queueSync(6000);
  if (!next.preview) queueCompile();
}

async function showPdf(bytes?: Uint8Array, keepViewport = false) {
  el("preview-empty").hidden = !!bytes;
  try {
    await preview.load(bytes, keepViewport);
  } catch (error) {
    el("preview-empty").hidden = preview.hasDocument;
    throw error;
  }
}

async function changeProject(action: () => Promise<Workspace | null>) {
  if (switching || switchingFile || applying || building) {
    throw new Error("Wait for the current project operation to finish.");
  }
  switching = true;
  setReadOnly(view, true);
  renderStatus();
  closeMenu();
  try {
    await flush();
    const next = await action();
    if (next) await loadWorkspace(next);
  } finally {
    switching = false;
    setReadOnly(view, false);
    renderStatus();
  }
}

function openFolder() {
  return changeProject(() => api.openFolder());
}

function queueSync(delay = 4200) {
  if (!workspace.project?.connection?.auto || syncError) return;
  clearTimeout(autoSyncTimer);
  autoSyncTimer = window.setTimeout(() => { void sync(false); }, delay);
}

async function sync(manual: boolean) {
  const project = workspace.project;
  if (!project?.connection || syncingProject || switching || switchingFile || building || (!manual && dialog.open)) return;
  clearTimeout(autoSyncTimer);
  syncingProject = project.id;
  syncError = false;
  syncMessage = "Syncing with Overleaf…";
  renderStatus();
  try {
    await api.fetch(project.id);
    if (workspace.project?.id !== project.id) return;
    if (building || switching || switchingFile || dialogBusy) {
      syncMessage = "Overleaf connected";
      queueSync();
      return;
    }
    applying = true;
    setReadOnly(view, true);
    renderStatus();
    let integrated;
    let stagedRevision;
    try {
      await flush();
      stagedRevision = editCount;
      integrated = await api.integrate(project.id);
      if (integrated.changed) {
        const hadFocus = view?.hasFocus;
        const fresh = await api.refresh(project.id);
        const previous = activeFile?.path;
        workspace = fresh;
        tabs = tabs.filter(path => fresh.files.some(file => file.path === path));
        const file = fresh.files.find(entry => entry.path === previous) ?? fresh.files.find(entry => entry.path === fresh.project?.main);
        await openFile(file, { reload: true, focus: hadFocus === true });
        if (preview.hasDocument) {
          buildMessage = "Preview needs compilation";
          buildStale = true;
        }
        queueCompile();
      }
    } finally {
      applying = false;
      setReadOnly(view, false);
      renderStatus();
    }
    if (integrated.conflicts.length) {
      syncError = true;
      syncMessage = "Overleaf conflict";
      notify(`Local and Overleaf edits overlap in ${integrated.conflicts.join(", ")}. Both versions are still available.`, true);
      return;
    }
    if (integrated.needsPush) await api.push(project.id);
    if (workspace.project?.id !== project.id) return;
    const hasNewEdits = stagedRevision !== editCount || savePending;
    syncMessage = hasNewEdits ? "Changes to sync" : "Synced with Overleaf";
    if (hasNewEdits) queueSync();
  } catch (error) {
    if (workspace.project?.id !== project.id) return;
    syncError = true;
    syncMessage = message(error);
    if (manual) notify(syncMessage, true);
  } finally {
    syncingProject = undefined;
    if (workspace.project?.id !== project.id) queueSync();
    renderStatus();
  }
}

function queueCompile(delay = 950) {
  clearTimeout(autoCompileTimer);
  if (!preferences.autoCompile || !workspace.project?.main) return;
  autoCompileTimer = window.setTimeout(() => {
    if (building || switching || switchingFile || applying || dialog.open || quick.open) queueCompile(500);
    else if (!saveError) void build(true);
  }, delay);
}

async function build(automatic = false) {
  const project = workspace.project;
  if (!project?.main || building || switching || switchingFile || applying) return;
  clearTimeout(autoCompileTimer);
  building = true;
  buildError = false;
  buildStale = false;
  buildMessage = "Compiling…";
  const revision = editCount;
  renderStatus();
  try {
    await flush();
    const result = await api.build(project.id);
    currentBuildLog = result.log;
    el("log-text").textContent = result.log;
    if (!automatic && main.dataset.view === "editor" && !focusRestore) showView("split");
    if (result.ok) {
      await showPdf(result.bytes, true);
      buildStale = editCount !== revision;
      buildMessage = buildStale ? "Preview needs compilation" : "PDF up to date";
      el("build-log").hidden = true;
    } else {
      buildError = true;
      buildMessage = "Build failed";
      if (!automatic) {
        el("build-log").hidden = false;
        notify(result.message, true);
      }
    }
  } catch (error) {
    buildError = true;
    buildMessage = "Build failed";
    if (!automatic) notify(message(error), true);
  } finally {
    building = false;
    renderStatus();
    if (editCount !== revision) queueCompile();
  }
}

function closeMenu() {
  popover.hidden = true;
  el("project-menu").setAttribute("aria-expanded", "false");
}

function showMenu() {
  if (!popover.hidden) {
    closeMenu();
    return;
  }
  popover.replaceChildren();
  function item(symbol: Icon, label: string, callback: () => void | Promise<unknown>) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "popover-item";
    button.innerHTML = icon(symbol);
    button.append(document.createTextNode(label));
    button.addEventListener("click", () => { closeMenu(); run(callback); });
    popover.append(button);
    return button;
  }
  item("plus", "New project…", newProject);
  item("folderOpen", "Open folder…", openFolder);
  const project = workspace.project;
  if (project) item("folder", "Show project folder", () => api.reveal(project.id));
  if (project?.connection) {
    item("settings", "Connection settings…", connectionSettings);
    item("externalLink", "Open on Overleaf", () => api.openOverleaf(project.id));
  } else item("cloud", "Connect Overleaf…", connect);
  if (workspace.recent.length) {
    const section = document.createElement("div");
    section.className = "popover-heading";
    section.textContent = "Recent projects";
    popover.append(section);
    for (const recent of workspace.recent.slice(0, 8)) {
      const button = item(recent.connection ? "cloud" : "folder", recent.name, () => changeProject(() => api.selectProject(recent.id)));
      if (project?.id === recent.id) {
        button.classList.add("current-project");
        const check = document.createElement("span");
        check.innerHTML = icon("check");
        button.append(check);
      }
    }
  }
  popover.hidden = false;
  el("project-menu").setAttribute("aria-expanded", "true");
  popover.querySelector("button")?.focus();
}

function quickCommands(): QuickItem[] {
  const modifier = mac ? "⌘" : "Ctrl+";
  const commands: QuickItem[] = [
    { label: "New project", key: mac ? "⌘⇧N" : "Ctrl+Shift+N", symbol: "plus", action: newProject },
    { label: "Open folder", key: modifier + "O", symbol: "folderOpen", action: openFolder },
    { label: "Compile project", key: shortcut, symbol: "play", action: build },
    { label: focusRestore ? "Exit focus mode" : "Enter focus mode", symbol: "scan", action: toggleFocusMode },
    { label: "Go to line", key: modifier + "L", symbol: "list", action: goToLine },
    { label: "Insert LaTeX block", symbol: "plus", action: openInsert },
    { label: "Settings", key: settingsShortcut, symbol: "gear", action: openSettings },
    { label: "Keyboard shortcuts", key: modifier + "/", symbol: "list", action: openShortcuts },
  ];
  if (workspace.project?.connection) {
    commands.push({ label: "Sync Overleaf", symbol: "refresh", action: () => sync(true) });
  } else commands.push({ label: "Connect Overleaf", symbol: "cloud", action: connect });
  return commands;
}

function highlightQuickItem(index: number) {
  if (!quickItems.length) {
    quickInput.removeAttribute("aria-activedescendant");
    return;
  }
  quickSelection = (index + quickItems.length) % quickItems.length;
  for (const [position, row] of [...quickResults.children].entries()) {
    const selected = position === quickSelection;
    row.setAttribute("aria-selected", String(selected));
    if (selected) {
      quickInput.setAttribute("aria-activedescendant", row.id);
      row.scrollIntoView({ block: "nearest" });
    }
  }
}

function renderQuickItems() {
  const input = quickInput.value.trim();
  const commandsOnly = input.startsWith(">");
  const query = (commandsOnly ? input.slice(1).trim() : input).toLocaleLowerCase();
  const terms = query.split(/\s+/);
  const files: QuickItem[] = commandsOnly ? [] : workspace.files.map(file => ({
    label: fileName(file.path), detail: file.path.includes("/") ? file.path : undefined, symbol: fileSymbol(file.path),
    action: () => openFile(file),
  }));
  const commands = quickCommands();
  const items = query ? [...files, ...commands] : [...files.slice(0, 4), ...commands];
  quickItems = items.filter(item => terms.every(term =>
    (item.label + " " + (item.detail ?? "")).toLocaleLowerCase().includes(term),
  ));
  if (query) {
    quickItems.sort((first, second) =>
      Number(second.label.toLocaleLowerCase().startsWith(query)) - Number(first.label.toLocaleLowerCase().startsWith(query)),
    );
  }
  quickItems = quickItems.slice(0, 9);
  quickResults.replaceChildren();
  for (const [index, item] of quickItems.entries()) {
    const row = document.createElement("li");
    row.id = `quick-option-${index}`;
    row.setAttribute("role", "option");
    row.innerHTML = icon(item.symbol);
    const label = document.createElement("span");
    label.textContent = item.label;
    row.append(label);
    if (item.detail || item.key) {
      const detail = document.createElement(item.key ? "kbd" : "small");
      detail.textContent = item.key ?? item.detail ?? "";
      row.append(detail);
    }
    row.addEventListener("mouseenter", () => highlightQuickItem(index));
    row.addEventListener("mousedown", event => event.preventDefault());
    row.addEventListener("click", () => chooseQuickItem(index));
    quickResults.append(row);
  }
  el("quick-empty").hidden = quickItems.length > 0;
  highlightQuickItem(0);
}

function chooseQuickItem(index: number) {
  const item = quickItems[index];
  if (!item) return;
  quick.close();
  run(item.action);
}

function openQuickPalette() {
  if (dialog.open || quick.open) return;
  closeMenu();
  quickInput.value = "";
  quick.showModal();
  renderQuickItems();
  quickInput.focus();
}

function field(label: string, name: string, options: Partial<HTMLInputElement> = {}) {
  const wrap = document.createElement("label");
  wrap.className = "field";
  wrap.append(document.createTextNode(label));
  const input = document.createElement("input");
  input.name = name;
  Object.assign(input, options);
  wrap.append(input);
  return wrap;
}

function select(label: string, name: string, options: [string, string][], value: string) {
  const wrap = document.createElement("label");
  wrap.className = "field";
  wrap.append(document.createTextNode(label));
  const input = document.createElement("select");
  input.name = name;
  for (const [key, title] of options) input.add(new Option(title, key, false, key === value));
  wrap.append(input);
  return wrap;
}

function showDialog(options: {
  title: string; description: string; symbol: Icon; label: string; fields: HTMLElement[];
  submit: (data: FormData) => Promise<void>;
  actionOnly?: boolean;
}) {
  if (dialog.open) return;
  closeMenu();
  el("dialog-icon").innerHTML = icon(options.symbol);
  el("dialog-title").textContent = options.title;
  el("dialog-description").textContent = options.description;
  el("dialog-description").hidden = !options.description;
  el("dialog-fields").replaceChildren(...options.fields);
  el("dialog-error").hidden = true;
  el("cancel-dialog").hidden = options.actionOnly === true;
  el<HTMLButtonElement>("confirm-dialog").textContent = options.label;
  dialogAction = options.submit;
  dialog.showModal();
  dialog.querySelector<HTMLElement>("input, select")?.focus();
}

const value = (data: FormData, name: string) => String(data.get(name) ?? "").trim();

function setPreferences(next: Preferences) {
  preferences = next;
  editorHost.style.setProperty("--code-size", `${next.editorSize}px`);
  configureEditor(view, next);
  view?.requestMeasure();
}

function openSettings() {
  const appearance = document.createElement("fieldset");
  appearance.className = "appearance-field";
  const legend = document.createElement("legend");
  legend.textContent = "Appearance";
  const choices = document.createElement("div");
  choices.className = "appearance-choices";
  const options: [Appearance, string][] = [["system", "System"], ["light", "Light"], ["dark", "Dark"]];
  for (const [mode, name] of options) {
    const choice = document.createElement("label");
    choice.className = "appearance-choice";
    const input = document.createElement("input");
    input.type = "radio";
    input.name = "appearance";
    input.value = mode;
    input.checked = preferences.appearance === mode;
    const sample = document.createElement("span");
    sample.className = `theme-sample ${mode}`;
    sample.setAttribute("aria-hidden", "true");
    sample.innerHTML = "<i></i><i></i>";
    choice.append(input, sample, document.createTextNode(name));
    choices.append(choice);
  }
  appearance.append(legend, choices);
  const sizes: [string, string][] = ["12", "13", "14", "15", "16", "17", "18"].map(size => [size, `${size} px`]);
  const editorChoices = document.createElement("div");
  editorChoices.className = "editor-preferences";
  editorChoices.append(
    select("Text size", "size", sizes, String(preferences.editorSize)),
    select("Indentation", "tab-size", [["2", "2 spaces"], ["4", "4 spaces"]], String(preferences.tabSize)),
  );
  const editorToggles = document.createElement("div");
  editorToggles.className = "editor-preferences";
  for (const [title, name, checked] of [
    ["Line numbers", "lineNumbers", preferences.lineNumbers],
    ["Wrap long lines", "lineWrapping", preferences.lineWrapping],
  ] as const) {
    const option = field(title, name, { type: "checkbox", checked });
    option.classList.add("checkbox-field");
    editorToggles.append(option);
  }
  const autoCompile = field("Compile automatically after edits", "autoCompile", { type: "checkbox", checked: preferences.autoCompile });
  autoCompile.classList.add("checkbox-field");
  const editorSection = document.createElement("fieldset");
  editorSection.className = "settings-section";
  const editorLegend = document.createElement("legend");
  editorLegend.textContent = "Editor";
  editorSection.append(editorLegend, editorChoices, editorToggles);
  const buildSection = document.createElement("fieldset");
  buildSection.className = "settings-section";
  const buildLegend = document.createElement("legend");
  buildLegend.textContent = "Build";
  buildSection.append(buildLegend, autoCompile);
  const shortcuts = textButton("Keyboard shortcuts", () => {
    dialog.close();
    openShortcuts();
  }, "text-link");
  const links = document.createElement("div");
  links.className = "editor-preferences";
  links.append(shortcuts);
  if (workspace.project) links.append(textButton("MCP for AI", () => {
    dialog.close();
    openMcpSettings();
  }, "text-link"));
  showDialog({
    title: "Settings", symbol: "gear", label: "Save settings", description: "",
    fields: [appearance, editorSection, buildSection, links],
    submit: async data => {
      setPreferences(await api.savePreferences({
        appearance: value(data, "appearance") as Appearance,
        editorSize: Number(value(data, "size")),
        tabSize: Number(value(data, "tab-size")) as 2 | 4,
        lineNumbers: data.has("lineNumbers"),
        lineWrapping: data.has("lineWrapping"),
        autoCompile: data.has("autoCompile"),
      }));
      queueCompile();
    },
  });
  appearance.querySelector<HTMLInputElement>("input:checked")?.focus();
}

function openMcpSettings() {
  const project = workspace.project;
  if (!project) return;
  const write = field("Allow source edits", "write", { type: "checkbox" });
  write.classList.add("checkbox-field");
  showDialog({
    title: "MCP for AI", symbol: "files", label: "Copy configuration",
    description: `Connect an MCP client to ${project.name}. Use Node.js to run the local server.`,
    fields: [write],
    submit: async data => {
      await api.copyMcpConfig(project.id, data.has("write"));
      notify("MCP configuration copied");
    },
  });
}

function openShortcuts() {
  const modifier = mac ? "⌘" : "Ctrl+";
  const shift = mac ? "⇧" : "Shift+";
  const entries = [
    ["New project", modifier + shift + "N"], ["Open folder", modifier + "O"], ["New file", modifier + "N"],
    ["Close tab", modifier + "W"], ["Previous tab", "Ctrl+Shift+Tab"], ["Next tab", "Ctrl+Tab"],
    ["Quick open", quickShortcut], ["Find in file", modifier + "F"], ["Go to line", modifier + "L"],
    ["Save source", modifier + "S"], ["Compile", shortcut],
    ["Insert LaTeX block", modifier + shift + "I"],
    ["Save PDF", modifier + shift + "S"], ["Sync Overleaf", modifier + shift + "R"],
    ["Source / Split / PDF", modifier + "1 / 2 / 3"], ["Fit PDF page", modifier + "0"],
    ["Toggle sidebar", modifier + "B"], ["Focus mode", modifier + shift + "F"],
    ["Settings", settingsShortcut], ["Keyboard shortcuts", modifier + "/"],
  ];
  const list = document.createElement("dl");
  list.className = "shortcuts-list";
  for (const [name, keys] of entries) {
    const term = document.createElement("dt");
    term.textContent = name;
    const detail = document.createElement("dd");
    const key = document.createElement("kbd");
    key.textContent = keys;
    detail.append(key);
    list.append(term, detail);
  }
  showDialog({
    title: "Keyboard shortcuts", symbol: "list", label: "Done", description: "", fields: [list],
    submit: async () => {}, actionOnly: true,
  });
}

function findInFile() {
  if (!view) return;
  if (main.dataset.view === "preview") showView("split");
  openSearchPanel(view);
}

function goToLine() {
  if (!view) return;
  if (main.dataset.view === "preview") showView("split");
  gotoLine(view);
}

function newProject() {
  const metadata = document.createElement("div");
  metadata.className = "editor-preferences";
  metadata.append(
    field("Author", "author", { maxLength: 160 }),
    field("Course", "course", { maxLength: 160 }),
  );
  showDialog({
    title: "New project", symbol: "folder", label: "Create project", description: "",
    fields: [
      select("Template", "template", templates.map(template => [template.id, template.label]), "article"),
      field("Project name", "name", { placeholder: "Untitled paper", required: true, maxLength: 80 }),
      field("Document title", "title", { placeholder: "Uses the project name when blank", maxLength: 160 }),
      metadata,
    ],
    submit: data => changeProject(() => api.newProject({
      name: value(data, "name"), title: value(data, "title"), author: value(data, "author"),
      course: value(data, "course"), template: value(data, "template") as TemplateId,
    })),
  });
  form.querySelector<HTMLInputElement>('input[name="name"]')?.focus();
}

function openInsert() {
  const target = view;
  if (!target || !/\.(tex|ltx)$/i.test(activeFile?.path ?? "") || applying) return;
  const kind = select("Block", "block", [["section", "Section"], ["equation", "Equation"], ["table", "Table"]], "section");
  const details = document.createElement("div");
  details.className = "block-details";
  const choice = kind.querySelector("select")!;
  function updateFields() {
    if (choice.value === "section") {
      details.replaceChildren(field("Section title", "content", { placeholder: "Introduction", required: true, maxLength: 160 }));
    } else if (choice.value === "equation") {
      details.replaceChildren(field("LaTeX expression", "content", { placeholder: "E = mc^2", required: true }));
    } else {
      details.replaceChildren(
        field("Column headers", "content", { placeholder: "Trial, Time, Result", required: true }),
        select("Rows", "rows", Array.from({ length: 8 }, (_, index) => {
          const count = String(index + 1);
          return [count, count];
        }), "2"),
      );
    }
  }
  choice.addEventListener("change", updateFields);
  updateFields();
  showDialog({
    title: "Insert LaTeX block", symbol: "plus", label: "Insert", description: "",
    fields: [kind, details],
    submit: async data => {
      if (target !== view || applying) throw new Error("Choose a source file and try again.");
      const content = value(data, "content");
      if (!content) throw new Error("Enter a value for this block.");
      const block = value(data, "block");
      let latex = "";
      if (block === "section") {
        latex = `\\section{${texText(content)}}`;
      } else if (block === "equation") {
        latex = ["\\begin{equation}", "  " + content, "\\end{equation}"].join("\n");
      } else {
        const columns = content.split(",").map(header => header.trim());
        if (columns.length < 2 || columns.length > 8 || !columns.every(Boolean)) {
          throw new Error("Enter between two and eight column headers, separated by commas.");
        }
        const endRow = " \\\\";
        latex = [
          `\\begin{tabular}{${"l".repeat(columns.length)}}`,
          "  " + columns.map(texText).join(" & ") + endRow,
          "  \\hline",
          ...Array.from({ length: Number(value(data, "rows")) }, () => "  " + columns.map(() => "{}").join(" & ") + endRow),
          "\\end{tabular}",
        ].join("\n");
      }
      const text = target.state.doc.toString();
      const start = text.indexOf("\\begin{document}");
      const end = text.lastIndexOf("\\end{document}");
      const selection = target.state.selection.main;
      const insert = "\n" + latex + "\n";
      if (start >= 0 && end > start && (selection.from < start + "\\begin{document}".length || selection.to > end)) {
        target.dispatch({
          changes: { from: end, insert },
          selection: { anchor: end + insert.length },
          scrollIntoView: true,
        });
      } else target.dispatch(target.state.replaceSelection(insert));
    },
  });
}

function newFile() {
  const project = workspace.project;
  if (!project || applying || switching) return;
  showDialog({
    title: "New file", symbol: "fileCode", label: "Create file", description: "Use a slash to put the file in a folder.",
    fields: [field("File name", "name", { placeholder: "sections/results.tex", required: true, spellcheck: false })],
    submit: async data => {
      if (applying) throw new Error("Wait for Overleaf sync to finish.");
      await flush();
      const relative = value(data, "name");
      workspace = await api.createFile(project.id, relative);
      await openFile(workspace.files.find(file => file.path === relative), { focus: false });
      queueSync();
    },
  });
}

function connect() {
  showDialog({
    title: "Connect Overleaf", symbol: "cloud", label: "Connect project",
    description: "Open an Overleaf project here. Quire saves a local copy and syncs edits back through Git.",
    fields: [
      field("Project name", "name", { placeholder: "My paper", required: true, maxLength: 80 }),
      field("Project or Git URL", "url", { placeholder: "https://www.overleaf.com/project/…", required: true, spellcheck: false }),
      field("Git authentication token", "token", { type: "password", placeholder: "From Overleaf account settings", required: true, autocomplete: "off" }),
    ],
    submit: data => changeProject(() => api.connect(value(data, "url"), value(data, "token"), value(data, "name"))),
  });
}

function connectionSettings() {
  const project = workspace.project;
  if (!project?.connection) return;
  const auto = field("Sync automatically", "auto", { type: "checkbox", checked: project.connection.auto });
  auto.classList.add("checkbox-field");
  showDialog({
    title: "Overleaf connection", symbol: "cloud", label: "Save settings", description: project.connection.web,
    fields: [
      field("New Git authentication token", "token", { type: "password", placeholder: "Current token stays when blank", autocomplete: "off" }),
      auto,
    ],
    submit: async data => {
      workspace.project = await api.configureConnection(project.id, value(data, "token"), data.has("auto"));
      syncError = false;
      syncMessage = "Overleaf connected";
      renderStatus();
      clearTimeout(autoSyncTimer);
      queueSync();
    },
  });
}

function buildSettings() {
  const project = workspace.project;
  if (!project) return;
  const candidates = workspace.files.filter(file => file.editable && /\.tex$/i.test(file.path));
  showDialog({
    title: "Compiler settings", symbol: "settings", label: "Save settings", description: "",
    fields: [
      select("Main document", "main", candidates.map(file => [file.path, file.path]), project.main ?? ""),
      select("LaTeX engine", "engine", [["pdflatex", "pdfLaTeX"], ["xelatex", "XeLaTeX"], ["lualatex", "LuaLaTeX"]], project.engine),
    ],
    submit: async data => {
      workspace.project = await api.configureBuild(project.id, value(data, "main"), value(data, "engine") as Engine);
      renderFiles();
      renderStatus();
    },
  });
}

form.addEventListener("submit", event => {
  event.preventDefault();
  if (dialogBusy || !dialogAction) return;
  dialogBusy = true;
  el("dialog-error").hidden = true;
  for (const id of ["confirm-dialog", "cancel-dialog", "close-dialog"]) el<HTMLButtonElement>(id).disabled = true;
  void dialogAction(new FormData(form)).then(() => {
    dialog.close();
    const secret = form.querySelector<HTMLInputElement>("input[type=password]");
    if (secret) secret.value = "";
    view?.focus();
  }).catch(error => {
    el("dialog-error").textContent = message(error);
    el("dialog-error").hidden = false;
  }).finally(() => {
    dialogBusy = false;
    for (const id of ["confirm-dialog", "cancel-dialog", "close-dialog"]) el<HTMLButtonElement>(id).disabled = false;
  });
});
dialog.addEventListener("close", () => {
  const secret = form.querySelector<HTMLInputElement>("input[type=password]");
  if (secret) secret.value = "";
});
dialog.addEventListener("cancel", event => { if (dialogBusy) event.preventDefault(); });
el("close-dialog").addEventListener("click", () => dialog.close());
el("cancel-dialog").addEventListener("click", () => dialog.close());

el("project-menu").addEventListener("click", showMenu);
el("quick-open").addEventListener("click", openQuickPalette);
quickInput.addEventListener("input", renderQuickItems);
quickInput.addEventListener("keydown", event => {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  event.preventDefault();
  highlightQuickItem(quickSelection + (event.key === "ArrowDown" ? 1 : -1));
});
el("quick-form").addEventListener("submit", event => {
  event.preventDefault();
  chooseQuickItem(quickSelection);
});
document.addEventListener("click", event => {
  if (!(event.target as HTMLElement).closest(".project-picker")) closeMenu();
});
document.addEventListener("keydown", event => {
  if (event.key === "Escape" && !popover.hidden) {
    closeMenu();
    el("project-menu").focus();
  }
  if (popover.hidden || !["ArrowDown", "ArrowUp"].includes(event.key)) return;
  const buttons = [...popover.querySelectorAll("button")];
  const index = buttons.findIndex(button => button === document.activeElement);
  buttons[(index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length]?.focus();
  event.preventDefault();
});
el("cloud-button").addEventListener("click", () => workspace.project?.connection ? void sync(true) : connect());
el("toggle-sidebar").addEventListener("click", () => showSidebar(main.classList.contains("sidebar-hidden")));
el("build").addEventListener("click", () => void build());
el("new-file").addEventListener("click", newFile);
el("build-settings").addEventListener("click", buildSettings);
el("find-button").addEventListener("click", findInFile);
el("insert-block").addEventListener("click", openInsert);
el("settings").addEventListener("click", openSettings);
el("settings-collapsed").addEventListener("click", openSettings);
el("zoom-out").addEventListener("click", () => preview.zoom(-0.1));
el("zoom-in").addEventListener("click", () => preview.zoom(0.1));
el("fit").addEventListener("click", () => preview.fit());
el("export").addEventListener("click", () => run(() => api.exportPdf(workspace.project!.id)));
el("build-status").addEventListener("click", () => {
  if (!currentBuildLog) return;
  if (main.dataset.view === "editor") showView("split");
  el("build-log").hidden = !el("build-log").hidden;
});
el("close-log").addEventListener("click", () => { el("build-log").hidden = true; });
viewButtons.forEach(button => button.addEventListener("click", () => showView(button.dataset.view!)));
tabBar.addEventListener("keydown", event => {
  if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
  event.preventDefault();
  run(() => cycleTabs(event.key === "ArrowRight" ? 1 : -1, false));
});
divider.addEventListener("pointerdown", event => {
  if (event.button !== 0 || !event.isPrimary || divider.hasPointerCapture(event.pointerId)) return;
  divider.setPointerCapture(event.pointerId);
  divider.classList.add("dragging");
});
divider.addEventListener("pointermove", event => {
  if (!divider.hasPointerCapture(event.pointerId)) return;
  const box = panes.getBoundingClientRect();
  resizeSplit((event.clientX - box.left) / box.width * 100, false);
});
divider.addEventListener("lostpointercapture", () => {
  divider.classList.remove("dragging");
  resizeSplit(split);
});
divider.addEventListener("dblclick", () => resizeSplit(52));
divider.addEventListener("keydown", event => {
  const sizes: Record<string, number> = { ArrowLeft: split - 2, ArrowRight: split + 2, Home: 34, End: 66 };
  if (!Object.hasOwn(sizes, event.key)) return;
  event.preventDefault();
  resizeSplit(sizes[event.key]);
});

api.onPrepareClose(() => {
  setReadOnly(view, true);
  void flush().then(() => api.close(true)).catch(error => {
    setReadOnly(view, false);
    notify(message(error), true);
    void api.close(false);
  });
});
api.onCommand(command => {
  if (dialog.open || quick.open) return;
  if (command === "new") newProject();
  if (command === "new-file") newFile();
  if (command === "open") run(openFolder);
  if (command === "settings") openSettings();
  if (command === "shortcuts") openShortcuts();
  if (command === "quick-open") openQuickPalette();
  if (command === "save") run(flush);
  if (command === "build") void build();
  if (command === "find") findInFile();
  if (command === "goto-line") goToLine();
  if (command === "insert-block") openInsert();
  if (command === "focus-mode") toggleFocusMode();
  if (command === "close-tab") run(() => closeTab());
  if (command === "next-tab") run(() => cycleTabs(1));
  if (command === "previous-tab") run(() => cycleTabs(-1));
  if (command === "source-view") showView("editor");
  if (command === "split-view") showView("split");
  if (command === "pdf-view") showView("preview");
  if (command === "toggle-sidebar") showSidebar(main.classList.contains("sidebar-hidden"));
  if (command === "pdf-fit") preview.fit();
  if (command === "export" && preview.hasDocument && workspace.project) run(() => api.exportPdf(workspace.project!.id));
  if (command === "sync") void sync(true);
});

window.setInterval(() => {
  if (workspace.project?.connection?.auto && (!syncError || /unreachable|rejected/i.test(syncMessage))) void sync(false);
}, 60_000);
window.addEventListener("online", () => {
  if (workspace.project?.connection?.auto && syncError && /unreachable/i.test(syncMessage)) void sync(false);
});
window.addEventListener("focus", () => {
  if (activeFile?.editable && !savePending && !switching && !switchingFile && !applying && !dialog.open && !quick.open) {
    run(() => openFile(activeFile, { reload: true, focus: view?.hasFocus === true }));
  }
});
showSidebar(localStorage.getItem("sidebar") !== "closed");
showView(localStorage.getItem("view") ?? "split");
resizeSplit(Number(localStorage.getItem("source-share")) || 52, false);
renderStatus();
run(async () => {
  const { preferences, ...workspace } = await api.start();
  setPreferences(preferences);
  await loadWorkspace(workspace, true);
});
