import "@fontsource/ibm-plex-mono/latin-400.css";
import "@fontsource/ibm-plex-mono/latin-500.css";
import "./style.css";
import { gotoLine, openSearchPanel } from "@codemirror/search";
import type { EditorState } from "@codemirror/state";
import type { EditorView, ViewUpdate } from "@codemirror/view";
import { api, defaultPreferences } from "./api";
import type { BuildIssue, Engine, ImportedFiles, Preferences, ProjectFile, ProjectSymbols, Source, Workspace } from "./api";
import { configureEditor, createEditor, prepareEditor, revealLine, setReadOnly, showDiagnostics } from "./editor";
import { icon, iconButton } from "./icons";
import type { Icon } from "./icons";
import { Preview } from "./preview";
import { field, select, value } from "./controls";
import { projectSearch } from "./project-search";
import { latexSymbols } from "../desktop/latex-symbols.mjs";
import type { Heading, SourceLocation } from "../desktop/latex-symbols.mjs";
import { displayShortcut, resolveShortcut } from "../desktop/shortcuts.mjs";
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
      <section id="files-section" class="files-section">
        <div class="sidebar-heading"><h2>Files</h2>
          <div class="sidebar-actions">
            <button id="search-project" class="icon-button" title="Search project" aria-label="Search project">${icon("search")}</button>
            <button id="new-file" class="icon-button" title="New file" aria-label="New file">${icon("plus")}</button>
          </div>
        </div>
        <div id="files" class="file-list"></div>
      </section>
      <section class="outline-section" id="outline-section" hidden>
        <div class="sidebar-heading"><h2>Outline</h2></div>
        <nav id="outline" aria-label="Document outline"></nav>
      </section>
      <section id="project-search-panel" class="project-search" aria-label="Search in project" hidden>
        <div class="sidebar-heading"><h2>Search</h2>
          <button id="close-project-search" class="icon-button" title="Close project search" aria-label="Close project search">${icon("x")}</button>
        </div>
        <form class="search-form">
          <input type="search" aria-label="Search project text" placeholder="Search project…" autocomplete="off" spellcheck="false" maxlength="160">
          <button class="filter-button" type="button" data-filter="case" aria-pressed="false" title="Match case" aria-label="Match case">Aa</button>
          <button class="filter-button" type="button" data-filter="word" aria-pressed="false" title="Whole word" aria-label="Whole word">ab</button>
        </form>
        <div class="search-summary" role="status"></div>
        <div class="search-results"></div>
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
          <button id="reveal-pdf" class="icon-button" title="Reveal source in PDF" aria-label="Reveal source in PDF">${icon("crosshair")}</button>
        </div>
      </div>
      <nav id="breadcrumbs" class="breadcrumbs" aria-label="Active file path" hidden></nav>
      <div id="editor" class="editor" role="tabpanel" aria-label="Source"></div>
      <div id="editor-empty" class="empty-state" hidden></div>
    </section>
    <div id="pane-divider" class="pane-divider" role="separator" tabindex="0" aria-orientation="vertical"
      aria-label="Resize source and preview" aria-valuemin="34" aria-valuemax="66" aria-valuenow="52" hidden></div>
    <section class="preview-pane" aria-label="PDF preview">
      <div class="pane-bar preview-bar">
        <div class="pane-title">
          <span>Preview</span>
          <div class="page-nav" role="group" aria-label="PDF pages">
            <button class="icon-button" id="previous-page" title="Previous PDF page" aria-label="Previous PDF page">${icon("chevronLeft")}</button>
            <button id="page-count" class="page-count" title="Go to page" aria-label="Go to page" aria-expanded="false" hidden></button>
            <button class="icon-button" id="next-page" title="Next PDF page" aria-label="Next PDF page">${icon("chevronRight")}</button>
            <form id="page-jump" class="page-jump" hidden><input type="number" min="1" step="1" required aria-label="PDF page number"><button class="secondary-button">Go</button></form>
          </div>
        </div>
        <div class="preview-tools" id="preview-tools">
          <button class="icon-button" id="zoom-out" title="Zoom out" aria-label="Zoom out">${icon("minus")}</button>
          <button id="fit" class="zoom-label" title="Fit page" aria-label="Fit page">Fit</button>
          <button class="icon-button" id="zoom-in" title="Zoom in" aria-label="Zoom in">${icon("plus")}</button>
          <span class="toolbar-divider"></span>
          <button class="icon-button" id="layout-toggle" title="Change split layout" aria-label="Change split layout">${icon("rows2")}</button>
          <button class="icon-button" id="export" title="Save PDF" aria-label="Save PDF">${icon("download")}</button>
        </div>
      </div>
      <div id="preview-scroll" class="preview-scroll" tabindex="0" aria-label="PDF document">
        <div id="paper-stack" class="paper-stack"></div>
        <div id="preview-empty" class="empty-state">
          <span class="empty-icon">${icon("fileText")}</span>
          <strong>No PDF yet</strong>
          <p>Compile your project to see it here.</p>
        </div>
      </div>
      <section id="build-log" class="build-log" hidden>
        <div class="log-bar">
          <div class="log-switch" role="group" aria-label="Build output">
            <button id="issues-tab" type="button" aria-pressed="true">Issues</button>
            <button id="log-tab" type="button" aria-pressed="false">Log</button>
          </div>
          <button id="close-log" class="icon-button" title="Close build output" aria-label="Close build output">${icon("x")}</button>
        </div>
        <div id="build-issues" class="build-issues"></div>
        <pre id="log-text" hidden></pre>
      </section>
    </section>
    </div>
  </main>
  <footer class="statusbar">
    <div class="status-slot">
      <button class="icon-button sidebar-toggle" id="toggle-sidebar" title="Toggle sidebar" aria-label="Toggle sidebar" aria-pressed="true">${icon("panelLeft")}</button>
      <button id="settings-collapsed" class="icon-button" title="Settings (${settingsShortcut})" aria-label="Settings" hidden>${icon("gear")}</button>
      <span id="save-status" role="status"></span>
      <button class="status-button" id="recover-save" type="button" hidden>Recover edits…</button>
      <span id="sync-status" role="status" hidden></span>
    </div>
    <div class="status-slot status-details">
      <span id="cursor" class="cursor"></span>
      <button id="build-status" class="status-button" title="Show build log"></button>
    </div>
  </footer>
  <div id="toast" class="toast" role="status" hidden></div>
  <div id="entry-menu" class="popover entry-menu" role="menu" hidden></div>
  <div id="drop-hint" class="drop-hint" hidden>${icon("upload")}<span></span></div>
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
          aria-label="Find a file, project, or command" aria-controls="quick-results" placeholder="Files, projects, and commands…" autocomplete="off" spellcheck="false">
      </label>
      <ul id="quick-results" role="listbox" aria-label="Results"></ul>
      <p id="quick-empty" class="quick-empty" hidden>No matches.</p>
      <footer class="quick-hints"><span><kbd>↑</kbd> <kbd>↓</kbd> Choose</span><span><kbd>&gt;</kbd> Commands</span><span><kbd>@</kbd> Outline</span></footer>
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
let buildIssues: BuildIssue[] = [];
let syncAvailable = false;
let switching = false;
let switchingFile = false;
let refreshing = false;
let recovering = false;
let currentBuildLog = "";
let syncMessage = "";
let syncError = false;
let syncRetries = 0;
let buildMessage = "";
let buildError = false;
let buildStale = false;
let saveError = "";
let savePending = false;
let editCount = 0;
let buildRevision = 0;
const saveCancelled = Symbol("saveCancelled");
let dialogAction: ((data: FormData) => Promise<void>) | undefined;
let dialogBusy = false;
let preferences: Preferences = defaultPreferences;
let split = 52;
let splitDirection = "side";
let tabs: string[] = [];
let pinnedTabs = new Set<string>();
let recentTabs: string[] = [];
let closedTabs: string[] = [];
let symbols: ProjectSymbols = { outline: [], labels: [], citations: [] };
let outlineEntries: Heading[] = [];
let symbolsTimer = 0;
let symbolsRevision = 0;
let outlineTimer = 0;
let settingsCleanup: (() => void) | undefined;
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
let focusRestore: { mode: string; sidebar: boolean } | undefined;
type QuickItem = { label: string; detail?: string; key?: string; symbol: Icon; group?: string; action: () => void | Promise<unknown> };
let quickItems: QuickItem[] = [];
let quickSelection = 0;

const preview = new Preview(el("preview-scroll"), el("paper-stack"), (page, pages, zoom) => {
  const count = el("page-count");
  count.hidden = !pages;
  count.textContent = pages ? `${page} / ${pages}` : "";
  count.title = `Go to page (${page} of ${pages})`;
  el<HTMLButtonElement>("previous-page").disabled = page <= 1;
  el<HTMLButtonElement>("next-page").disabled = page >= pages;
  el("fit").textContent = zoom;
  for (const id of ["zoom-out", "fit", "zoom-in"]) el<HTMLButtonElement>(id).disabled = !pages;
  renderExport();
});
const searchProjectPanel = projectSearch(el("project-search-panel"), match => run(() => revealSource(match, match.length)), closeProjectSearch);
const editorFeatures = {
  files: () => workspace.files.map(file => file.path),
  symbols: () => symbols,
  command: dispatchCommand,
  syncToPdf: (editor: EditorView, position: number) => run(() => revealPdf(editor, position)),
  definition: (kind: "labels" | "citations", key: string) => run(() => revealDefinition(kind, key)),
};

function keyHint(action: string) { return displayShortcut(resolveShortcut(action, preferences.shortcuts), mac); }

function message(error: unknown) {
  return typeof error === "object" && error && "message" in error && typeof error.message === "string"
    ? error.message : String(error);
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
    void Promise.resolve(action()).catch(error => {
      if (error !== saveCancelled) notify(message(error), true);
    });
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
  if (persist) localStorage.setItem(splitDirection === "side" ? "source-share" : "source-stack-share", String(split));
}

function setSplitDirection(direction: string, persist = true) {
  splitDirection = direction === "stack" ? "stack" : "side";
  const stacked = splitDirection === "stack";
  panes.dataset.direction = splitDirection;
  divider.setAttribute("aria-orientation", stacked ? "horizontal" : "vertical");
  const button = el("layout-toggle");
  button.innerHTML = icon(stacked ? "columns2" : "rows2");
  button.title = stacked ? "Arrange panels side by side" : "Stack editor and PDF";
  button.setAttribute("aria-label", button.title);
  resizeSplit(Number(localStorage.getItem(stacked ? "source-stack-share" : "source-share")) || 52, false);
  if (persist) {
    localStorage.setItem("split-direction", splitDirection);
    if (main.dataset.view !== "split") showView("split");
  }
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
  el("recover-save").hidden = !saveError;
  el<HTMLButtonElement>("recover-save").disabled = switching || switchingFile || applying || recovering;
  const dirty = tabBar.querySelector<HTMLElement>(".active .tab-dirty");
  if (dirty) dirty.hidden = !savePending;
  setStatus("sync-status", syncError ? "circleAlert" : syncing ? "refresh" : "cloudCheck", syncMessage,
    syncError ? "error" : syncing ? "working" : "");
  el("sync-status").title = syncMessage;
  setStatus("build-status", buildError ? "circleAlert" : building ? "refresh" : buildStale ? null : "check", buildMessage,
    buildError ? "error" : building ? "working" : buildStale ? "" : "good");
  el<HTMLButtonElement>("build-status").disabled = !currentBuildLog && !buildIssues.length;
  el<HTMLButtonElement>("build").disabled = !workspace.project?.main || building || applying;
  el<HTMLButtonElement>("new-file").disabled = !workspace.project || applying || switching || switchingFile;
  el<HTMLButtonElement>("build-settings").disabled = building || !workspace.project || !workspace.files.some(file => /\.tex$/i.test(file.path));
  el<HTMLButtonElement>("find-button").disabled = !view;
  el<HTMLButtonElement>("reveal-pdf").disabled = !view || !workspace.project?.main || building || applying;
  el<HTMLButtonElement>("search-project").disabled = !workspace.project;
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
  renderExport();
}

function renderExport() {
  const button = el<HTMLButtonElement>("export");
  button.disabled = !preview.hasDocument || buildStale || building || buildError;
  button.title = preview.hasDocument && (buildStale || buildError) ? "Compile before saving PDF" : "Save PDF";
}

function fileName(path: string) {
  return path.split("/").at(-1)!;
}

function fileSymbol(path: string): Icon {
  return /\.(tex|cls|sty)$/i.test(path) ? "fileCode" : /\.bib$/i.test(path) ? "bookOpen" : "file";
}

function persistTabs() {
  if (workspace.project) {
    localStorage.setItem(`tabs:${workspace.project.id}`, JSON.stringify({
      tabs, active: activeFile?.path, pinned: [...pinnedTabs], recent: recentTabs, closed: closedTabs,
    }));
  }
}

function restoreTabs(id?: string): string | undefined {
  tabs = [];
  pinnedTabs = new Set();
  closedTabs = [];
  recentTabs = [];
  if (!id) return;
  try {
    const saved = JSON.parse(localStorage.getItem(`tabs:${id}`) ?? "{}");
    const files = new Set(workspace.files.map(file => file.path));
    if (Array.isArray(saved.tabs)) {
      tabs = [...new Set<string>(saved.tabs.filter((path: unknown) => typeof path === "string" && files.has(path)))];
    }
    const existing = (paths: unknown) => Array.isArray(paths)
      ? [...new Set<string>(paths.filter((path: unknown) => typeof path === "string" && files.has(path)))].slice(0, 16) : [];
    pinnedTabs = new Set(existing(saved.pinned).filter(path => tabs.includes(path)));
    recentTabs = existing(saved.recent);
    closedTabs = existing(saved.closed);
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

function renderTabs(keepFocus = false, animate = false) {
  const left = tabBar.scrollLeft;
  const positions = animate && !reducedMotion.matches
    ? new Map([...tabBar.querySelectorAll<HTMLElement>("[data-tab]")].map(tab => [tab.dataset.tab, tab.getBoundingClientRect().left]))
    : undefined;
  tabBar.replaceChildren();
  for (const [index, path] of tabs.entries()) {
    const file = workspace.files.find(entry => entry.path === path);
    if (!file) continue;
    const active = path === activeFile?.path;
    const wrapper = document.createElement("div");
    wrapper.className = "editor-tab";
    wrapper.dataset.tab = path;
    wrapper.draggable = true;
    wrapper.classList.toggle("pinned", pinnedTabs.has(path));
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
    tab.innerHTML = icon(pinnedTabs.has(path) ? "pin" : fileSymbol(path));
    tab.append(label);
    tab.addEventListener("click", () => run(() => openFile(file)));
    wrapper.addEventListener("contextmenu", event => {
      showEntryMenu(event, [
        [pinnedTabs.has(path) ? "Unpin tab" : "Pin tab", () => togglePin(path)],
        ["Close tab", () => closeTab(path)],
        ["Reopen closed tab", reopenTab],
      ]);
    });
    wrapper.addEventListener("dragstart", event => beginEntryDrag(event, path, "tab"));
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
      if (keepFocus) tab.focus({ preventScroll: true });
    }
  }
  tabBar.scrollLeft = left;
  if (keepFocus || !animate) tabBar.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
  if (positions) {
    for (const next of tabBar.querySelectorAll<HTMLElement>("[data-tab]")) {
      const previous = positions.get(next.dataset.tab);
      if (previous === undefined) continue;
      const delta = previous - next.getBoundingClientRect().left;
      if (Math.abs(delta) > 1) next.animate([{ transform: `translateX(${delta}px)` }, { transform: "none" }], {
        duration: 170, easing: "cubic-bezier(.2,.7,.2,1)",
      });
    }
  }
  if (!activeFile) editorHost.removeAttribute("aria-labelledby");
}

function togglePin(path = activeFile?.path) {
  if (!path || !tabs.includes(path)) return;
  if (pinnedTabs.has(path)) pinnedTabs.delete(path);
  else pinnedTabs.add(path);
  tabs = [...tabs.filter(item => pinnedTabs.has(item)), ...tabs.filter(item => !pinnedTabs.has(item))];
  persistTabs();
  renderTabs(false, true);
}

async function closeTab(path = activeFile?.path) {
  if (!path || !workspace.project || switchingFile || switching || applying) return;
  const index = tabs.indexOf(path);
  if (index < 0) return;
  if (activeFile?.path === path) {
    const adjacent = tabs[index + 1] ?? tabs[index - 1];
    await openFile(workspace.files.find(file => file.path === adjacent));
    if (activeFile?.path === path) return;
  }
  const nextClosed = [path, ...closedTabs.filter(item => item !== path)];
  const displaced = nextClosed[16];
  closedTabs = nextClosed.slice(0, 16);
  if (displaced) storedEditors.delete(tabKey(workspace.project.id, displaced));
  pinnedTabs.delete(path);
  tabs = tabs.filter(tab => tab !== path);
  persistTabs();
  renderTabs();
}

async function reopenTab() {
  const file = closedTabs.map(path => workspace.files.find(item => item.path === path)).find(Boolean);
  if (!file) return;
  await openFile(file);
  if (activeFile?.path === file.path) {
    closedTabs = closedTabs.filter(path => path !== file.path);
    persistTabs();
  }
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

function showEntryMenu(event: MouseEvent, actions: Array<[string, () => void | Promise<unknown>]>) {
  event.preventDefault();
  event.stopPropagation();
  closeMenu();
  const menu = el("entry-menu");
  menu.replaceChildren();
  for (const [label, action] of actions) {
    const button = textButton(label, () => { menu.hidden = true; run(action); }, "popover-item");
    button.setAttribute("role", "menuitem");
    menu.append(button);
  }
  menu.hidden = false;
  const anchor = (event.currentTarget as HTMLElement).getBoundingClientRect();
  menu.style.left = `${Math.max(5, Math.min(event.clientX || anchor.left, innerWidth - menu.offsetWidth - 8))}px`;
  menu.style.top = `${Math.max(5, Math.min(event.clientY || anchor.bottom, innerHeight - menu.offsetHeight - 8))}px`;
  menu.querySelector("button")?.focus();
}

type EntryKind = "tab" | "file" | "folder";
let entryDrag: { path: string; kind: EntryKind } | undefined;
const entryType = "application/x-quire-entry";

function beginEntryDrag(event: DragEvent, path: string, kind: EntryKind) {
  if (!event.dataTransfer || event.target instanceof Element && event.target.closest(".tab-close")) return;
  entryDrag = { path, kind };
  event.dataTransfer.setData(entryType, path);
  event.dataTransfer.effectAllowed = kind === "tab" ? "move" : "copyMove";
  const element = event.currentTarget as HTMLElement | null;
  requestAnimationFrame(() => {
    if (entryDrag?.path === path) element?.classList.add("drag-origin");
  });
}

function clearEntryDrag() {
  entryDrag = undefined;
  for (const item of document.querySelectorAll(".drag-target, .drag-before, .drag-after, .drag-origin")) {
    item.classList.remove("drag-target", "drag-before", "drag-after", "drag-origin");
  }
  el("drop-hint").hidden = true;
}

function directoryOf(path: string) { return path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : ""; }
function joins(folder: string, file: string) { return folder ? `${folder}/${file}` : file; }
function movedPath(path: string, from: string, to: string) {
  return path === from ? to : path.startsWith(from + "/") ? to + path.slice(from.length) : path;
}

function showFileMenu(event: MouseEvent, path: string, folder: boolean) {
  showEntryMenu(event, folder ? [
    ["New file here…", () => newFile(path)], ["New folder here…", () => newFolder(path)],
    ["Import files here…", () => importFiles(path)], ["Rename…", () => renameEntry(path)],
    ["Move to Trash…", () => trashEntry(path)],
  ] : [
    ["Open", () => openFile(workspace.files.find(file => file.path === path))],
    ["Rename…", () => renameEntry(path)],
    ["Show in file manager", () => api.reveal(workspace.project!.id, path)],
    ["Move to Trash…", () => trashEntry(path)],
  ]);
}

function renderFiles() {
  const target = el("files");
  target.replaceChildren();
  if (workspace.project && !workspace.files.length && !workspace.folders?.length) {
    const empty = document.createElement("p");
    empty.className = "sidebar-empty";
    empty.textContent = "No files in this folder.";
    target.append(empty);
    return;
  }
  function addRows(files: ProjectFile[], knownFolders: string[], prefix = "", depth = 0) {
    const folders = new Map<string, ProjectFile[]>();
    const direct: ProjectFile[] = [];
    for (const relative of knownFolders) {
      const name = relative.slice(prefix.length);
      if (!name.includes("/")) folders.set(name, []);
    }
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
      row.draggable = true;
      row.addEventListener("dragstart", event => beginEntryDrag(event, file.path, "file"));
      row.addEventListener("contextmenu", event => showFileMenu(event, file.path, false));
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
      row.draggable = true;
      row.addEventListener("dragstart", event => beginEntryDrag(event, key.slice(0, -1), "folder"));
      row.addEventListener("contextmenu", event => showFileMenu(event, key.slice(0, -1), true));
      const arrow = document.createElement("span");
      arrow.className = "tree-chevron";
      arrow.innerHTML = icon(expanded ? "chevronDown" : "chevronRight");
      row.prepend(arrow);
      row.setAttribute("aria-expanded", String(expanded));
      target.append(row);
      if (expanded) addRows(contents, knownFolders.filter(relative => relative.startsWith(key)), key, depth + 1);
    }
    direct.filter(file => file !== mainFile).forEach(fileRow);
  }
  addRows(workspace.files, workspace.folders ?? []);
}

function renderBreadcrumbs() {
  const crumbs = el("breadcrumbs");
  const parts = activeFile?.path.split("/") ?? [];
  crumbs.hidden = parts.length < 2;
  crumbs.replaceChildren();
  if (crumbs.hidden) return;
  parts.forEach((part, index) => {
    if (index) {
      const separator = document.createElement("span");
      separator.innerHTML = icon("chevronRight");
      crumbs.append(separator);
    }
    if (index === parts.length - 1) {
      crumbs.append(part);
      return;
    }
    const folder = parts.slice(0, index + 1).join("/") + "/";
    crumbs.append(textButton(part, () => {
      closeProjectSearch();
      showSidebar(true);
      for (const key of collapse) if (folder.startsWith(key)) collapse.delete(key);
      renderFiles();
      [...el("files").querySelectorAll<HTMLButtonElement>("[data-folder]")].find(row => row.dataset.folder === folder)?.focus();
    }, "breadcrumb"));
  });
}

function queueSymbols(delay = 240) {
  clearTimeout(symbolsTimer);
  const project = workspace.project;
  const revision = ++symbolsRevision;
  if (!project) return;
  symbolsTimer = window.setTimeout(async () => {
    try {
      const indexed = await api.projectSymbols(project.id);
      if (symbolsRevision !== revision || workspace.project?.id !== project.id) return;
      symbols = indexed;
      renderOutline();
      renderCursor();
      if (quick.open && quickInput.value.startsWith("@")) renderQuickItems();
    } catch { /* The next refresh retries if the project is temporarily unavailable. */ }
  }, delay);
}

function renderOutline() {
  const outline = el("outline");
  outline.replaceChildren();
  const path = activeFile?.path;
  const visible = path && view && /\.(?:tex|ltx|latex)$/i.test(path)
    ? latexSymbols(view.state.doc.toString(), path).structure.filter((entry): entry is Heading => entry.kind === "heading") : undefined;
  if (visible && path) {
    let next = 0;
    const merged = symbols.outline.flatMap(heading => {
      if (heading.path !== path) return [heading];
      const current = visible[next++];
      return current ? [current] : [];
    });
    const last = merged.findLastIndex(heading => heading.path === path);
    merged.splice(last < 0 ? 0 : last + 1, 0, ...visible.slice(next));
    outlineEntries = merged;
  } else {
    outlineEntries = symbols.outline;
  }
  el("outline-section").hidden = outlineEntries.length === 0 || !el("project-search-panel").hidden;
  for (const heading of outlineEntries) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.line = String(heading.line);
    button.dataset.path = heading.path;
    button.className = "outline-row";
    button.style.paddingLeft = `${8 + Math.max(0, heading.level - 2) * 13}px`;
    button.title = `${heading.title} · ${heading.path}:${heading.line}`;
    const title = document.createElement("span");
    title.textContent = heading.title;
    button.innerHTML = icon("list");
    button.append(title);
    button.addEventListener("click", () => run(() => revealSource(heading)));
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
  const selected = headings.findLast(heading => heading.dataset.path === activeFile?.path && Number(heading.dataset.line) <= line.number);
  headings.forEach(heading => heading.classList.toggle("current-heading", heading === selected));
}

function edited(update: ViewUpdate) {
  if (update.docChanged) {
    editCount += 1;
    savePending = true;
    clearTimeout(outlineTimer);
    outlineTimer = window.setTimeout(() => { renderOutline(); renderCursor(); }, 110);
    clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => { void flush().catch(() => {}); }, 300);
    invalidatePreview();
    renderStatus();
  }
  if (update.docChanged || update.selectionSet) renderCursor();
}

function invalidatePreview() {
  buildRevision += 1;
  if (preview.hasDocument) {
    buildStale = true;
    if (!building) {
      buildError = false;
      buildMessage = "Preview needs compilation";
    }
  }
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
    queueSymbols();
    searchProjectPanel.refresh();
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

async function flushForNavigation() {
  try {
    await flush();
  } catch (error) {
    const { project } = workspace;
    if (!project || !activeFile || !source || !view || recovering) throw error;
    const file = activeFile;
    const previous = source;
    const readOnly = view.state.readOnly;
    setReadOnly(view, true);
    recovering = true;
    renderStatus();
    try {
      if (!await api.recoverSource(project.id, file.path, view.state.sliceDoc(), message(error))) throw saveCancelled;
      source = await api.read(project.id, file.path).catch(() => previous);
      storedEditors.delete(tabKey(project.id, file.path));
      view.destroy();
      view = createEditor(editorHost, file.path, source.text, edited, preferences, editorFeatures);
      showDiagnostics(view, file.path, buildIssues);
      saveError = "";
      savePending = false;
      invalidatePreview();
      queueCompile();
      queueSync();
      renderOutline();
      renderCursor();
    } finally {
      recovering = false;
      setReadOnly(view, readOnly);
      renderStatus();
    }
  }
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
  if (switchingFile || recovering || (applying && !reload)) return;
  if (!reload && file && view && file.path === activeFile?.path) {
    if (focus && main.dataset.view === "preview") showView("split");
    if (focus) view.focus();
    return;
  }
  const project = workspace.project;
  switchingFile = true;
  setReadOnly(view, true);
  try {
    if (reload) await flush();
    else await flushForNavigation();
    let loaded: Source | undefined;
    if (project && file?.editable) loaded = await api.read(project.id, file.path);
    if (reload && file?.path === activeFile?.path && loaded?.version === source?.version && view) return;
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
      recentTabs = [file.path, ...recentTabs.filter(path => path !== file.path)].slice(0, 16);
      if (loaded) {
        if (focus && main.dataset.view === "preview") showView("split");
        const previous = storedEditors.get(tabKey(project.id, file.path));
        const restored = previous?.version === loaded.version ? previous : undefined;
        view = createEditor(editorHost, file.path, loaded.text, edited, preferences, editorFeatures, restored?.state);
        if (restored) configureEditor(view, preferences);
        showDiagnostics(view, file.path, buildIssues);
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
    renderBreadcrumbs();
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
  symbols = { outline: [], labels: [], citations: [] };
  ++symbolsRevision;
  clearTimeout(symbolsTimer);
  clearTimeout(outlineTimer);
  closeProjectSearch(false);
  const remembered = restoreTabs(next.project?.id);
  collapse.clear();
  clearTimeout(autoSyncTimer);
  clearTimeout(autoCompileTimer);
  clearTimeout(saveTimer);
  el("project-name").textContent = next.project?.name ?? "Projects";
  document.title = next.project ? `${next.project.name} — Quire` : "Quire";
  syncMessage = next.project?.connection ? "Overleaf connected" : "";
  syncError = false;
  syncRetries = 0;
  buildStale = next.previewStale === true;
  syncAvailable = next.syncAvailable === true;
  buildIssues = next.issues ?? [];
  buildError = false;
  buildMessage = buildStale ? "Preview needs compilation" : next.preview ? "PDF up to date" : "";
  currentBuildLog = "";
  el("build-log").hidden = true;
  renderBuildIssues();
  renderStatus();
  const initial = next.files.find(file => file.path === remembered) ??
    next.files.find(file => file.path === next.project?.main) ?? next.files.find(file => file.editable);
  const results = await Promise.allSettled([openFile(initial, { reload: true, focus: !first && !dialog.open }), showPdf(next.preview)]);
  for (const result of results) if (result.status === "rejected") notify(message(result.reason), true);
  queueSymbols(0);
  if (next.project?.connection?.auto) queueSync(6000);
  if (!next.preview || buildStale) queueCompile();
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
  if (switching || switchingFile || applying || building || recovering) {
    throw new Error("Wait for the current project operation to finish.");
  }
  switching = true;
  setReadOnly(view, true);
  renderStatus();
  closeMenu();
  try {
    await flushForNavigation();
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

function openProjectSearch() {
  const id = workspace.project?.id;
  if (!id) return;
  showSidebar(true);
  el("files-section").hidden = true;
  el("outline-section").hidden = true;
  const selection = view && view.state.selection.main;
  const text = selection && !selection.empty ? view?.state.sliceDoc(selection.from, selection.to) : undefined;
  searchProjectPanel.open(id, text);
}

function closeProjectSearch(focus = true) {
  searchProjectPanel.close();
  el("files-section").hidden = false;
  el("outline-section").hidden = outlineEntries.length === 0;
  if (focus) view?.focus();
}

async function revealSource(location: SourceLocation, length = 0) {
  const file = workspace.files.find(file => file.path === location.path && file.editable);
  if (!file) return;
  await openFile(file);
  if (view && activeFile?.path === location.path) revealLine(view, location.line, location.column, length);
}

async function revealDefinition(kind: "labels" | "citations", key: string) {
  const local = kind === "labels" && view && activeFile
    ? latexSymbols(view.state.doc.toString(), activeFile.path).labels.find(symbol => symbol.key === key) : undefined;
  const defined = local ?? symbols[kind].find(symbol => symbol.key === key);
  if (defined) await revealSource(defined);
  else notify(`No definition found for ${key}.`, true);
}

async function revealPdf(editor = view, position = editor?.state.selection.main.head) {
  const project = workspace.project;
  const file = activeFile;
  if (!project || !file || !editor || position === undefined) return;
  const line = editor.state.doc.lineAt(position);
  if (main.dataset.view === "editor") showView("split");
  if (!syncAvailable || buildStale) await build(true);
  if (workspace.project?.id !== project.id || activeFile?.path !== file.path || view !== editor) return;
  if (!syncAvailable || buildStale || buildError) throw new Error("Compile the current document to jump to its PDF.");
  const result = await api.syncToPdf(project.id, file.path, line.number, position - line.from + 1);
  if (workspace.project?.id !== project.id || activeFile?.path !== file.path || buildStale || building) return;
  if (result) preview.reveal(result);
  else notify("This source location has no matching PDF content.");
}

async function revealFromPdf(event: MouseEvent) {
  if (!(mac ? event.metaKey : event.ctrlKey) || event.button !== 0) return;
  const point = preview.pointAt(event);
  const project = workspace.project;
  if (!point || !project) return;
  if (buildStale || building || !syncAvailable || buildError) throw new Error("Compile the current PDF before jumping to its source.");
  const revision = buildRevision;
  const location = await api.syncToSource(project.id, point.page, point.x, point.y);
  if (workspace.project?.id !== project.id || revision !== buildRevision) return;
  if (location) await revealSource(location);
  else notify("No project source was found at this PDF location.");
}

async function applyFileChanges(fresh: Workspace, rename?: { from: string; to: string }) {
  const previous = activeFile?.path;
  const oldCursor = view?.state.selection.main.head ?? 0;
  const oldScroll = view?.scrollDOM.scrollTop ?? 0;
  const project = fresh.project;
  const translate = (path: string) => rename ? movedPath(path, rename.from, rename.to) : path;
  const paths = new Set(fresh.files.map(file => file.path));
  const retain = (items: string[]) => items.map(translate).filter(path => paths.has(path) || (savePending && path === previous));
  workspace = fresh;
  tabs = retain(tabs);
  pinnedTabs = new Set(retain([...pinnedTabs]));
  recentTabs = retain(recentTabs);
  closedTabs = retain(closedTabs);
  if (rename) {
    const existing = [...collapse].map(path => translate(path.slice(0, -1)) + "/");
    collapse.clear();
    existing.forEach(path => collapse.add(path));
  }
  if (!savePending) {
    const target = previous && translate(previous);
    const next = fresh.files.find(file => file.path === target) ?? fresh.files.find(file => file.path === project?.main) ??
      fresh.files.find(file => file.editable);
    if (activeFile || next) await openFile(next, { reload: true, focus: view?.hasFocus === true });
    if (rename && target !== previous && activeFile?.path === target && view) {
      view.dispatch({ selection: { anchor: Math.min(oldCursor, view.state.doc.length) } });
      view.scrollDOM.scrollTop = oldScroll;
    }
  }
  persistTabs();
  renderFiles();
  renderTabs();
  queueSymbols();
  searchProjectPanel.refresh();
  renderStatus();
}

async function mutateFiles(
  action: (id: string) => Promise<Workspace | null>,
  rename?: { from: string; to: string },
) {
  const { project } = workspace;
  if (!project) return;
  await changeProject(async () => {
    const fresh = await action(project.id);
    if (fresh) {
      await applyFileChanges(fresh, rename);
      if (fresh.previewStale || !preview.hasDocument) invalidatePreview();
      queueCompile();
      queueSync();
      renderStatus();
    }
    return null;
  });
}

function renameEntry(path: string) {
  const folder = directoryOf(path);
  showDialog({
    title: "Rename", symbol: "file", label: "Rename", description: "",
    fields: [field("New name", "name", { value: fileName(path), required: true, spellcheck: false })],
    submit: data => {
      const name = value(data, "name");
      if (name.includes("/")) throw new Error("Enter a name without folder separators.");
      return moveEntry(path, joins(folder, name));
    },
  });
  form.querySelector<HTMLInputElement>("input")?.select();
}

function moveEntry(from: string, to: string) {
  if (from === to) return Promise.resolve();
  return mutateFiles(id => api.moveEntry(id, from, to), { from, to });
}

function trashEntry(path: string) { return mutateFiles(id => api.trashEntry(id, path)); }

function newFolder(parent = "") {
  if (!workspace.project) return;
  showDialog({
    title: "New folder", symbol: "folder", label: "Create folder", description: parent,
    fields: [field("Folder name", "name", { required: true, spellcheck: false })],
    submit: async data => {
      if (parent) collapse.delete(parent + "/");
      await mutateFiles(id => api.createFolder(id, parent, value(data, "name")));
    },
  });
}

function importedMessage(result: ImportedFiles) {
  if (result.error) notify(result.error, true);
  else if (result.skipped.length) notify(`${result.added.length} imported, ${result.skipped.length} skipped: ${result.skipped.join(", ")}`, true);
  else if (result.added.length) notify(result.added.length === 1 ? `Imported ${fileName(result.added[0])}` : `Imported ${result.added.length} files`);
}

function importFiles(folder = "") {
  return mutateFiles(async id => {
    const result = await api.importFiles(id, folder);
    if (result) {
      if (folder) collapse.delete(folder + "/");
      importedMessage(result);
    }
    return result?.workspace ?? null;
  });
}

function queueSync(delay = 4200) {
  if (!syncError) scheduleSync(delay);
}

function scheduleSync(delay: number) {
  if (!workspace.project?.connection?.auto) return;
  clearTimeout(autoSyncTimer);
  autoSyncTimer = window.setTimeout(() => { void sync(false); }, delay);
}

async function refreshProject(incoming = false) {
  const { project, files } = workspace;
  if (!project || refreshing) return;
  refreshing = true;
  try {
    const fresh = await api.refresh(project.id);
    if (workspace.project?.id !== project.id || switching || switchingFile || recovering || (!incoming && applying)) return;
    const changed = fresh.files.length !== files.length || fresh.files.some((file, index) =>
      file.path !== files[index].path || file.stamp !== files[index].stamp);
    if (incoming || project.main !== fresh.project?.main || (preview.hasDocument ? fresh.previewStale : changed)) {
      invalidatePreview();
      queueCompile();
    }
    if (changed && !incoming) queueSync();
    await applyFileChanges(fresh);
  } finally {
    refreshing = false;
  }
}

async function sync(manual: boolean) {
  const project = workspace.project;
  if (!project?.connection || syncingProject || (!manual && !project.connection.auto)) return;
  if (switching || switchingFile || building || refreshing || recovering || (!manual && dialog.open)) {
    if (!manual) scheduleSync(1000);
    return;
  }
  clearTimeout(autoSyncTimer);
  syncingProject = project.id;
  syncError = false;
  syncMessage = "Syncing with Overleaf…";
  let nextSync: number | undefined;
  renderStatus();
  try {
    await api.fetch(project.id);
    if (workspace.project?.id !== project.id) return;
    if (building || switching || switchingFile || dialogBusy || refreshing || recovering) {
      syncMessage = "Overleaf connected";
      nextSync = 1000;
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
      if (integrated.changed) await refreshProject(true);
    } finally {
      applying = false;
      setReadOnly(view, false);
      renderStatus();
    }
    if (integrated.conflicts.length) {
      syncRetries = 0;
      syncError = true;
      syncMessage = "Overleaf conflict";
      notify(`Local and Overleaf edits overlap in ${integrated.conflicts.join(", ")}. Both versions are still available.`, true);
      return;
    }
    if (integrated.needsPush) await api.push(project.id);
    if (workspace.project?.id !== project.id) return;
    const hasNewEdits = stagedRevision !== editCount || savePending;
    syncMessage = hasNewEdits ? "Changes to sync" : "Synced with Overleaf";
    syncRetries = 0;
    nextSync = hasNewEdits ? 4200 : 60_000;
  } catch (error) {
    if (workspace.project?.id !== project.id) return;
    syncError = true;
    syncMessage = message(error);
    if (typeof error === "object" && error && "code" in error && error.code === "SYNC_RETRY") {
      nextSync = 4000 * 2 ** Math.min(syncRetries++, 4);
      nextSync = Math.min(nextSync, 60_000);
    } else {
      syncRetries = 0;
      if (saveError) nextSync = 60_000;
    }
    if (manual) notify(syncMessage, true);
  } finally {
    syncingProject = undefined;
    if (workspace.project?.id !== project.id) queueSync();
    else if (nextSync !== undefined) scheduleSync(nextSync);
    renderStatus();
  }
}

function queueCompile(delay: number = preferences.compileDelay) {
  clearTimeout(autoCompileTimer);
  if (!preferences.autoCompile || !workspace.project?.main) return;
  autoCompileTimer = window.setTimeout(() => {
    if (building || switching || switchingFile || applying || refreshing || recovering || dialog.open || quick.open) queueCompile(500);
    else if (!saveError) void build(true);
  }, delay);
}

async function build(automatic = false) {
  const project = workspace.project;
  if (!project?.main || building || switching || switchingFile || applying || refreshing || recovering) return;
  clearTimeout(autoCompileTimer);
  building = true;
  buildError = false;
  buildMessage = "Compiling…";
  const revision = buildRevision;
  renderStatus();
  try {
    await flush();
    const result = await api.build(project.id);
    currentBuildLog = result.log;
    el("log-text").textContent = result.log;
    buildIssues = result.issues;
    renderBuildIssues();
    if (!automatic && main.dataset.view === "editor" && !focusRestore) showView("split");
    if (result.ok) {
      await showPdf(result.bytes, true);
      syncAvailable = result.syncAvailable;
      buildStale = buildRevision !== revision;
      buildMessage = buildStale ? "Preview needs compilation" : "PDF up to date";
      if (!buildIssues.length && el("log-text").hidden) el("build-log").hidden = true;
    } else {
      buildError = true;
      buildMessage = "Build failed";
      if (!automatic) {
        showBuildPanel("issues");
      }
    }
  } catch (error) {
    buildError = true;
    buildMessage = "Build failed";
    buildIssues = [{ severity: "error", path: project.main, line: null, message: message(error) }];
    currentBuildLog = "";
    el("log-text").textContent = "";
    renderBuildIssues();
    if (!automatic) showBuildPanel("issues");
  } finally {
    building = false;
    renderStatus();
    if (buildRevision !== revision) queueCompile();
  }
}

function renderBuildIssues() {
  const list = el("build-issues");
  list.replaceChildren();
  el("issues-tab").textContent = buildIssues.length ? `Issues ${buildIssues.length}` : "Issues";
  if (!buildIssues.length) {
    const empty = document.createElement("p");
    empty.className = "issue-empty";
    empty.textContent = currentBuildLog ? "No issues in this build." : "Compile to see build issues.";
    list.append(empty);
  }
  const ordered = [...buildIssues.filter(issue => issue.severity === "error"), ...buildIssues.filter(issue => issue.severity !== "error")];
  for (const issue of ordered) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "build-issue";
    row.dataset.severity = issue.severity;
    row.innerHTML = icon(issue.severity === "error" ? "circleAlert" : "triangleAlert");
    const text = document.createElement("span");
    text.textContent = issue.message;
    const location = document.createElement("small");
    location.textContent = issue.line ? `${issue.path}:${issue.line}` : issue.path;
    row.append(text, location);
    row.title = `${location.textContent} · ${issue.message}`;
    row.disabled = !workspace.files.some(file => file.path === issue.path && file.editable);
    row.addEventListener("click", () => run(() => revealSource({ path: issue.path, line: issue.line ?? 1, column: 1 })));
    list.append(row);
  }
  showDiagnostics(view, activeFile?.path, buildIssues);
}

function showBuildPanel(panel: "issues" | "log") {
  if (main.dataset.view === "editor") showView("split");
  el("build-log").hidden = false;
  el("build-issues").hidden = panel !== "issues";
  el("log-text").hidden = panel !== "log";
  el("issues-tab").setAttribute("aria-pressed", String(panel === "issues"));
  el("log-tab").setAttribute("aria-pressed", String(panel === "log"));
}

function toggleBuildPanel() {
  if (el("build-log").hidden) showBuildPanel("issues");
  else el("build-log").hidden = true;
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
  if (project) {
    item("upload", "Import files…", () => importFiles());
    item("folder", "New folder…", () => newFolder());
    item("folder", "Show project folder", () => api.reveal(project.id));
  }
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
  function action(label: string, name: string, symbol: Icon): QuickItem {
    return { label, key: keyHint(name), symbol, action: () => dispatchCommand(name) };
  }
  const commands = [
    action("New project", "new", "plus"), action("Open folder", "open", "folderOpen"),
    action("Search project text", "project-search", "search"),
    action("Compile project", "build", "play"), action("Show build issues", "issues", "triangleAlert"),
    action(focusRestore ? "Exit focus mode" : "Enter focus mode", "focus-mode", "scan"),
    action("Go to line", "goto-line", "list"), action("Find in file", "find", "search"),
    action("Insert LaTeX block", "insert-block", "plus"), action("Reveal source in PDF", "reveal-pdf", "crosshair"),
    action("Reopen closed tab", "reopen-tab", "files"), action("Import files", "import", "upload"),
    action("Source view", "source-view", "fileCode"), action("Split view", "split-view", "columns2"),
    action("PDF view", "pdf-view", "fileText"), action("Settings", "settings", "gear"),
    action("Keyboard shortcuts", "shortcuts", "list"),
    { label: "Editor settings", symbol: "fileCode", action: () => openSettings("editor") } satisfies QuickItem,
    { label: preferences.vimMode ? "Disable Vim mode" : "Enable Vim mode", symbol: "terminal", action: toggleVim } satisfies QuickItem,
    { label: "Change split layout", symbol: "rows2", action: () => setSplitDirection(splitDirection === "side" ? "stack" : "side") } satisfies QuickItem,
  ];
  if (activeFile) {
    commands.push({ label: pinnedTabs.has(activeFile.path) ? "Unpin current tab" : "Pin current tab", symbol: "pin", action: () => togglePin() });
  }
  if (workspace.project?.connection) commands.push(action("Sync Overleaf", "sync", "refresh"));
  else commands.push({ label: "Connect Overleaf", symbol: "cloud", action: connect });
  return commands;
}

function quickScore(item: QuickItem, query: string) {
  const label = item.label.toLocaleLowerCase();
  const text = label + " " + (item.detail ?? "").toLocaleLowerCase();
  let score = 0;
  for (const word of query.split(/\s+/)) {
    if (label.startsWith(word)) { score += 20; continue; }
    if (label.includes(word)) { score += 12; continue; }
    if (text.includes(word)) { score += 7; continue; }
    let index = -1;
    let gap = 0;
    for (const letter of word) {
      const next = text.indexOf(letter, index + 1);
      if (next < 0) return -1;
      if (index >= 0) gap += next - index - 1;
      index = next;
    }
    score += Math.max(0, 6 - gap);
  }
  return score;
}

function highlightQuickItem(index: number) {
  if (!quickItems.length) {
    quickInput.removeAttribute("aria-activedescendant");
    return;
  }
  quickSelection = (index + quickItems.length) % quickItems.length;
  for (const [position, row] of [...quickResults.querySelectorAll('[role="option"]')].entries()) {
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
  const scope = [">", "@"].includes(input[0]) ? input[0] : "";
  const query = input.slice(scope.length).trim().toLocaleLowerCase();
  const route = (file: ProjectFile): QuickItem => ({
    label: fileName(file.path), detail: file.path.includes("/") ? file.path : undefined,
    symbol: fileSymbol(file.path), action: () => openFile(file),
  });
  const recent = recentTabs.flatMap(path => {
    const file = workspace.files.find(item => item.path === path);
    return file ? [route(file)] : [];
  });
  const files = query ? workspace.files.map(route) : recent.length ? recent : workspace.files.slice(0, 3).map(route);
  const projects: QuickItem[] = workspace.recent.map(project => ({
    label: project.name, symbol: project.connection ? "cloud" : "folder",
    detail: project.id === workspace.project?.id ? "Current project" : project.connection ? "Overleaf" : undefined,
    action: () => project.id === workspace.project?.id ? undefined : changeProject(() => api.selectProject(project.id)),
  }));
  const outline: QuickItem[] = outlineEntries.map(heading => ({
    label: heading.title, detail: heading.path + ":" + heading.line, symbol: "list", action: () => revealSource(heading),
  }));
  const groups: Array<[string, QuickItem[], number]> = scope === ">"
    ? [["Commands", quickCommands(), 20]] : scope === "@"
      ? [["Document outline", outline, 20]] : [
        [query ? "Files" : "Recent files", files, query ? 7 : 4], ["Projects", projects, query ? 5 : 3],
        ["Commands", quickCommands(), query ? 7 : 4],
      ];
  quickItems = groups.flatMap(([group, items, limit]) => {
    const filtered = query ? items.map(item => ({ item, score: quickScore(item, query) })).filter(hit => hit.score >= 0)
      .sort((a, b) => b.score - a.score).map(hit => hit.item) : items;
    return filtered.slice(0, limit).map(item => ({ ...item, group }));
  });
  quickResults.replaceChildren();
  let previous = "";
  for (const [index, item] of quickItems.entries()) {
    if (item.group !== previous) {
      const group = document.createElement("li");
      group.className = "quick-group";
      group.setAttribute("role", "presentation");
      group.textContent = item.group ?? "";
      quickResults.append(group);
      previous = item.group ?? "";
    }
    const row = document.createElement("li");
    row.id = "quick-option-" + index;
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

function showDialog(options: {
  title: string; description: string; symbol: Icon; label: string; fields: HTMLElement[];
  submit: (data: FormData) => Promise<void>;
  actionOnly?: boolean;
  variant?: string;
}) {
  if (dialog.open) return;
  closeMenu();
  dialog.dataset.variant = options.variant ?? "";
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

async function setPreferences(next: Preferences) {
  await prepareEditor(next);
  preferences = next;
  editorHost.style.setProperty("--code-size", next.editorSize + "px");
  editorHost.style.setProperty("--code-leading", String(next.lineHeight));
  editorHost.dataset.font = next.editorFont;
  for (const [id, name, label] of [
    ["build", "build", "Compile"], ["quick-open", "quick-open", "Quick Open"],
    ["settings", "settings", "Settings"], ["settings-collapsed", "settings", "Settings"],
    ["search-project", "project-search", "Search project"], ["reveal-pdf", "reveal-pdf", "Reveal source in PDF"],
  ]) el(id).title = label + " (" + keyHint(name) + ")";
  configureEditor(view, next);
  view?.requestMeasure();
}

async function toggleVim() {
  await prepareEditor({ ...preferences, vimMode: !preferences.vimMode });
  await setPreferences(await api.savePreferences({ ...preferences, vimMode: !preferences.vimMode }));
  view?.focus();
}

async function openSettings(section?: string) {
  if (dialog.open || quick.open) return;
  const { settingsView } = await import("./settings");
  if (dialog.open || quick.open) return;
  const context = workspace.project;
  const settings = settingsView(preferences, {
    section, mac,
    mcp: context ? () => { dialog.close(); openMcpSettings(); } : undefined,
    connection: context?.connection ? () => { dialog.close(); connectionSettings(); } : undefined,
    capture: active => run(() => api.captureShortcuts(active)),
  });
  settingsCleanup = settings.finishRecording;
  showDialog({
    title: "Settings", symbol: "gear", label: "Save settings", description: "", variant: "settings",
    fields: [settings.root],
    submit: async data => {
      const wasAutomatic = preferences.autoCompile;
      const next = settings.collect(data);
      await prepareEditor(next);
      await setPreferences(await api.savePreferences(next));
      if (!preferences.autoCompile || !wasAutomatic || buildStale || !preview.hasDocument) queueCompile();
    },
  });
  settings.filter.focus();
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

function openShortcuts() { return openSettings("shortcuts"); }

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
  const chooser = document.createElement("fieldset");
  chooser.className = "template-field";
  const legend = document.createElement("legend");
  legend.textContent = "Template";
  const choices = document.createElement("div");
  choices.className = "template-picker";
  for (const template of templates) {
    const option = field(template.label, "template", { type: "radio", value: template.id, checked: template.id === "article" });
    option.className = "template-option";
    const sample = document.createElement("span");
    sample.className = "template-paper";
    sample.setAttribute("aria-hidden", "true");
    for (const title of template.sections.slice(0, 4)) {
      const section = document.createElement("span");
      section.textContent = title;
      sample.append(section);
    }
    option.insertBefore(sample, option.firstChild);
    choices.append(option);
  }
  chooser.append(legend, choices);
  const metadata = document.createElement("div");
  metadata.className = "editor-preferences";
  metadata.append(
    field("Author", "author", { maxLength: 160 }),
    field("Course", "course", { maxLength: 160 }),
  );
  showDialog({
    title: "New project", symbol: "folder", label: "Create project", description: "",
    fields: [
      chooser,
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
      const insert = target.state.toText(["", ...latex.split("\n"), ""].join(target.state.lineBreak));
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

function newFile(folder = "") {
  const project = workspace.project;
  if (!project || applying || switching || recovering) return;
  showDialog({
    title: "New file", symbol: "fileCode", label: "Create file", description: folder || "Use a slash to put the file in a folder.",
    fields: [field("File name", "name", { placeholder: "sections/results.tex", required: true, spellcheck: false })],
    submit: async data => {
      if (applying) throw new Error("Wait for Overleaf sync to finish.");
      const relative = joins(folder, value(data, "name"));
      if (folder) collapse.delete(folder + "/");
      await mutateFiles(id => api.createFile(id, relative));
      await openFile(workspace.files.find(file => file.path === relative), { focus: false });
      if (view && main.dataset.view === "preview") showView("split");
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
      syncRetries = 0;
      syncMessage = "Overleaf connected";
      renderStatus();
      clearTimeout(autoSyncTimer);
      queueSync();
    },
  });
}

function buildSettings() {
  const project = workspace.project;
  if (!project || building) return;
  const candidates = workspace.files.filter(file => file.editable && /\.tex$/i.test(file.path));
  showDialog({
    title: "Compiler settings", symbol: "settings", label: "Save settings", description: "",
    fields: [
      select("Main document", "main", candidates.map(file => [file.path, file.path]), project.main ?? ""),
      select("LaTeX engine", "engine", [["pdflatex", "pdfLaTeX"], ["xelatex", "XeLaTeX"], ["lualatex", "LuaLaTeX"]], project.engine),
    ],
    submit: async data => {
      const main = value(data, "main");
      const engine = value(data, "engine") as Engine;
      if (project.main === main && project.engine === engine) return;
      workspace.project = await api.configureBuild(project.id, main, engine);
      invalidatePreview();
      queueCompile();
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
    if (error === saveCancelled) return;
    el("dialog-error").textContent = message(error);
    el("dialog-error").hidden = false;
  }).finally(() => {
    dialogBusy = false;
    for (const id of ["confirm-dialog", "cancel-dialog", "close-dialog"]) el<HTMLButtonElement>(id).disabled = false;
  });
});
dialog.addEventListener("close", () => {
  settingsCleanup?.();
  settingsCleanup = undefined;
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
  if (!(event.target as HTMLElement).closest("#entry-menu")) el("entry-menu").hidden = true;
  if (!(event.target as HTMLElement).closest(".page-nav")) closePageJump();
});
document.addEventListener("keydown", event => {
  const entryMenu = el("entry-menu");
  if (!entryMenu.hidden) {
    if (event.key === "Escape") { entryMenu.hidden = true; event.preventDefault(); }
    else if (["ArrowDown", "ArrowUp"].includes(event.key)) {
      const items = [...entryMenu.querySelectorAll("button")];
      const current = items.indexOf(document.activeElement as HTMLButtonElement);
      const next = current + (event.key === "ArrowDown" ? 1 : -1);
      items[(next + items.length) % items.length]?.focus();
      event.preventDefault();
    }
    return;
  }
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
el("new-file").addEventListener("click", () => newFile());
el("search-project").addEventListener("click", openProjectSearch);
el("close-project-search").addEventListener("click", () => closeProjectSearch());
el("build-settings").addEventListener("click", buildSettings);
el("find-button").addEventListener("click", findInFile);
el("insert-block").addEventListener("click", openInsert);
el("settings").addEventListener("click", () => run(() => openSettings()));
el("settings-collapsed").addEventListener("click", () => run(() => openSettings()));
el("reveal-pdf").addEventListener("click", () => run(() => revealPdf()));
el("preview-scroll").addEventListener("click", event => run(() => revealFromPdf(event)));
el("zoom-out").addEventListener("click", () => preview.zoom(-0.1));
el("zoom-in").addEventListener("click", () => preview.zoom(0.1));
el("fit").addEventListener("click", () => preview.fit());
el("layout-toggle").addEventListener("click", () => setSplitDirection(splitDirection === "side" ? "stack" : "side"));
el("previous-page").addEventListener("click", () => preview.goToPage(preview.currentPage - 1));
el("next-page").addEventListener("click", () => preview.goToPage(preview.currentPage + 1));
const pageJump = el<HTMLFormElement>("page-jump");
const pageInput = pageJump.querySelector("input")!;
function closePageJump() {
  pageJump.hidden = true;
  el("page-count").setAttribute("aria-expanded", "false");
}
el("page-count").addEventListener("click", () => {
  if (!pageJump.hidden) { closePageJump(); return; }
  pageInput.value = String(preview.currentPage);
  pageInput.max = String(preview.pageCount);
  pageJump.hidden = false;
  el("page-count").setAttribute("aria-expanded", "true");
  pageInput.focus();
  pageInput.select();
});
pageJump.addEventListener("submit", event => {
  event.preventDefault();
  preview.goToPage(pageInput.valueAsNumber);
  closePageJump();
  el("page-count").focus();
});
pageJump.addEventListener("keydown", event => {
  if (event.key !== "Escape") return;
  closePageJump();
  el("page-count").focus();
});
function exportPdf() {
  if (workspace.project && !el<HTMLButtonElement>("export").disabled) return api.exportPdf(workspace.project.id);
}

el("export").addEventListener("click", () => run(exportPdf));
el("recover-save").addEventListener("click", () => run(async () => {
  await flushForNavigation();
  await refreshProject();
  view?.focus();
}));
el("build-status").addEventListener("click", toggleBuildPanel);
el("issues-tab").addEventListener("click", () => showBuildPanel("issues"));
el("log-tab").addEventListener("click", () => showBuildPanel("log"));
el("close-log").addEventListener("click", () => { el("build-log").hidden = true; });
viewButtons.forEach(button => button.addEventListener("click", () => showView(button.dataset.view!)));
tabBar.addEventListener("keydown", event => {
  if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
  event.preventDefault();
  const step = event.key === "ArrowRight" ? 1 : -1;
  if (event.altKey && activeFile) {
    const path = activeFile.path;
    const other = tabs[tabs.indexOf(path) + step];
    if (other && pinnedTabs.has(path) === pinnedTabs.has(other)) reorderTab(path, other, step < 0, true);
  } else {
    run(() => cycleTabs(step, false));
  }
});

function reorderTab(path: string, target: string | undefined, before: boolean, focus = false) {
  if (path === target) return;
  const remaining = tabs.filter(item => item !== path);
  const fixed = remaining.filter(item => pinnedTabs.has(item)).length;
  const pinned = pinnedTabs.has(path);
  const minimum = pinned ? 0 : fixed;
  const maximum = pinned ? fixed : remaining.length;
  const index = target ? remaining.indexOf(target) : -1;
  const insertion = index < 0 ? maximum : Math.max(minimum, Math.min(maximum, index + (before ? 0 : 1)));
  remaining.splice(insertion, 0, path);
  if (remaining.every((item, position) => tabs[position] === item)) return;
  tabs = remaining;
  persistTabs();
  renderTabs(focus, true);
}

function tabDropTarget(event: DragEvent) {
  const item = (event.target as Element).closest<HTMLElement>("[data-tab]");
  const bounds = item?.getBoundingClientRect();
  return { item, before: !!bounds && event.clientX < bounds.left + bounds.width / 2 };
}

tabBar.addEventListener("dragover", event => {
  if (!event.dataTransfer || !entryDrag || entryDrag.kind === "folder") return;
  event.preventDefault();
  event.stopPropagation();
  event.dataTransfer.dropEffect = entryDrag.kind === "tab" ? "move" : "copy";
  tabBar.querySelectorAll(".drag-before, .drag-after").forEach(item => item.classList.remove("drag-before", "drag-after"));
  const { item, before } = tabDropTarget(event);
  if (item?.dataset.tab !== entryDrag.path) item?.classList.add(before ? "drag-before" : "drag-after");
  const bounds = tabBar.getBoundingClientRect();
  if (event.clientX < bounds.left + 26) tabBar.scrollLeft -= 18;
  if (event.clientX > bounds.right - 26) tabBar.scrollLeft += 18;
});
tabBar.addEventListener("drop", event => {
  const drag = entryDrag;
  if (!drag || drag.kind === "folder") return;
  event.preventDefault();
  event.stopPropagation();
  const { item, before } = tabDropTarget(event);
  const target = item?.dataset.tab;
  clearEntryDrag();
  run(async () => {
    if (drag.kind === "file") {
      const file = workspace.files.find(file => file.path === drag.path);
      if (!file) return;
      await openFile(file);
      if (activeFile?.path !== drag.path) return;
    }
    reorderTab(drag.path, target, before);
  });
});

function folderAt(target: EventTarget | null) {
  if (!(target instanceof Element)) return;
  const tree = target.closest<HTMLElement>("#files-section");
  if (!tree) return;
  const row = target.closest<HTMLElement>("[data-folder]");
  return { folder: row?.dataset.folder?.slice(0, -1) ?? "", indicator: row ?? tree };
}

function externalDrag(event: DragEvent) { return !entryDrag && event.dataTransfer?.types.includes("Files"); }

document.addEventListener("dragover", event => {
  if (!event.dataTransfer || dialog.open || quick.open) return;
  const target = folderAt(event.target);
  if (entryDrag?.kind === "file" || entryDrag?.kind === "folder") {
    document.querySelectorAll(".drag-target").forEach(element => element.classList.remove("drag-target"));
    if (!target || target.folder === entryDrag.path || target.folder.startsWith(entryDrag.path + "/") ||
        directoryOf(entryDrag.path) === target.folder) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    target.indicator.classList.add("drag-target");
    return;
  }
  if (!externalDrag(event)) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "copy";
  const hint = el("drop-hint");
  hint.querySelector("span")!.textContent = workspace.project
    ? target?.folder ? "Import into " + target.folder : "Drop a folder to open it, or files to import"
    : "Drop a project folder or LaTeX file";
  hint.hidden = false;
  document.querySelectorAll(".drag-target").forEach(element => element.classList.remove("drag-target"));
  target?.indicator.classList.add("drag-target");
});
document.addEventListener("dragend", clearEntryDrag);
document.addEventListener("dragleave", event => {
  if (!event.relatedTarget && (event.clientX <= 0 || event.clientY <= 0 || event.clientX >= innerWidth || event.clientY >= innerHeight)) {
    if (entryDrag) document.querySelectorAll(".drag-target").forEach(element => element.classList.remove("drag-target"));
    else clearEntryDrag();
  }
});
document.addEventListener("drop", event => {
  const drag = entryDrag;
  const target = folderAt(event.target);
  const external = externalDrag(event);
  const files = [...event.dataTransfer?.files ?? []];
  clearEntryDrag();
  if (external || drag) event.preventDefault();
  if (dialog.open || quick.open) return;
  if (drag && target && drag.kind !== "tab" && drag.path !== target.folder &&
      !target.folder.startsWith(drag.path + "/") && directoryOf(drag.path) !== target.folder) {
    if (target.folder) collapse.delete(target.folder + "/");
    run(() => moveEntry(drag.path, joins(target.folder, fileName(drag.path))));
  } else if (external && files.length) {
    run(async () => {
      const id = workspace.project?.id;
      let initialFile: string | undefined;
      await changeProject(async () => {
        const dropped = await api.dropFiles(id, target?.folder ?? "", files);
        if (dropped?.kind === "project") {
          initialFile = dropped.openFile;
          return dropped.workspace;
        }
        if (dropped?.kind === "import") {
          if (target?.folder) collapse.delete(target.folder + "/");
          await applyFileChanges(dropped.workspace);
          if (dropped.added.length) {
            invalidatePreview();
            queueSync();
            queueCompile();
          }
          importedMessage(dropped);
        }
        return null;
      });
      if (initialFile) await openFile(workspace.files.find(file => file.path === initialFile));
    });
  }
});
el("files-section").addEventListener("contextmenu", event => {
  if (!workspace.project || (event.target as Element).closest(".tree-row")) return;
  showEntryMenu(event, [["New file…", () => newFile()], ["New folder…", () => newFolder()], ["Import files…", () => importFiles()]]);
});

divider.addEventListener("pointerdown", event => {
  if (event.button !== 0 || !event.isPrimary || divider.hasPointerCapture(event.pointerId)) return;
  divider.setPointerCapture(event.pointerId);
  divider.classList.add("dragging");
});
divider.addEventListener("pointermove", event => {
  if (!divider.hasPointerCapture(event.pointerId)) return;
  const box = panes.getBoundingClientRect();
  const share = splitDirection === "side" ? (event.clientX - box.left) / box.width : (event.clientY - box.top) / box.height;
  resizeSplit(share * 100, false);
});
divider.addEventListener("lostpointercapture", () => {
  divider.classList.remove("dragging");
  resizeSplit(split);
});
divider.addEventListener("dblclick", () => resizeSplit(52));
divider.addEventListener("keydown", event => {
  const sizes: Record<string, number> = splitDirection === "side"
    ? { ArrowLeft: split - 2, ArrowRight: split + 2, Home: 34, End: 66 }
    : { ArrowUp: split - 2, ArrowDown: split + 2, Home: 34, End: 66 };
  if (!Object.hasOwn(sizes, event.key)) return;
  event.preventDefault();
  resizeSplit(sizes[event.key]);
});

api.onPrepareClose(() => {
  if (recovering) { void api.close(false); return; }
  const readOnly = view?.state.readOnly ?? false;
  setReadOnly(view, true);
  void flushForNavigation().then(() => api.close(true)).catch(error => {
    setReadOnly(view, readOnly);
    if (error !== saveCancelled) notify(message(error), true);
    void api.close(false);
  });
});
const commands: Record<string, () => void | Promise<unknown>> = {
  new: newProject, "new-file": newFile, open: openFolder, import: importFiles, settings: openSettings,
  shortcuts: openShortcuts, "quick-open": openQuickPalette, save: flush, build: build,
  find: findInFile, "project-search": openProjectSearch, "goto-line": goToLine, "insert-block": openInsert,
  "focus-mode": toggleFocusMode, "close-tab": closeTab, "reopen-tab": reopenTab,
  "next-tab": () => cycleTabs(1), "previous-tab": () => cycleTabs(-1),
  "source-view": () => showView("editor"), "split-view": () => showView("split"), "pdf-view": () => showView("preview"),
  "toggle-sidebar": () => showSidebar(main.classList.contains("sidebar-hidden")),
  "pdf-fit": () => preview.fit(), "reveal-pdf": () => revealPdf(), issues: toggleBuildPanel,
  export: exportPdf, sync: () => sync(true),
};
function dispatchCommand(command: string) {
  if (dialog.open || quick.open || recovering || !Object.hasOwn(commands, command)) return;
  run(commands[command]);
}
api.onCommand(dispatchCommand);

window.addEventListener("online", () => {
  if (syncRetries) scheduleSync(0);
});
window.addEventListener("focus", () => {
  if (!switching && !switchingFile && !applying && !recovering && !dialog.open && !quick.open) {
    run(refreshProject);
  }
});
showSidebar(localStorage.getItem("sidebar") !== "closed");
showView(localStorage.getItem("view") ?? "split");
setSplitDirection(localStorage.getItem("split-direction") ?? "side", false);
renderStatus();
run(async () => {
  const { preferences, ...workspace } = await api.start();
  await setPreferences(preferences);
  await loadWorkspace(workspace, true);
});
