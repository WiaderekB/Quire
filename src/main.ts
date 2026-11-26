import "@fontsource/ibm-plex-mono/latin-400.css";
import "@fontsource/ibm-plex-mono/latin-500.css";
import "./style.css";
import { openSearchPanel } from "@codemirror/search";
import type { EditorView, ViewUpdate } from "@codemirror/view";
import { api } from "./api";
import type { Engine, ProjectFile, Source, Workspace } from "./api";
import { createEditor, getHeadings, revealLine, setReadOnly } from "./editor";
import { icon, iconButton } from "./icons";
import type { Icon } from "./icons";
import { Preview } from "./preview";

const mac = api.platform === "darwin";
const shortcut = mac ? "⌘↵" : "Ctrl+↵";
const app = document.querySelector<HTMLElement>("#app")!;
app.classList.toggle("mac", mac);
app.innerHTML = `
  <header class="topbar">
    <div class="brand">
      <span class="brand-mark" aria-hidden="true">${icon("bookOpen")}</span>
      <span>Quire</span>
    </div>
    <div class="project-picker">
      <button id="project-menu" class="project-button" aria-expanded="false" aria-controls="project-popover">
        <span id="project-name">Projects</span>${icon("chevronDown")}
      </button>
      <div id="project-popover" class="popover" hidden></div>
    </div>
    <div class="top-actions">
      <button id="cloud-button" class="cloud-button">${icon("cloud")}<span>Connect Overleaf</span></button>
      <div class="toolbar-divider"></div>
      <button class="icon-button sidebar-toggle" id="toggle-sidebar" title="Toggle sidebar" aria-label="Toggle sidebar" aria-pressed="true">${icon("panelLeft")}</button>
      <div class="view-switch" role="group" aria-label="Workspace view">
        <button data-view="editor" title="Source only" aria-label="Source only" aria-pressed="false">${icon("fileCode")}</button>
        <button data-view="split" title="Source and preview" aria-label="Source and preview" aria-pressed="true">${icon("columns2")}</button>
        <button data-view="preview" title="Preview only" aria-label="Preview only" aria-pressed="false">${icon("fileText")}</button>
      </div>
      <button id="build" class="compile-button" title="Compile (${shortcut})">${icon("play")}<span>Compile</span><kbd>${shortcut}</kbd></button>
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
      <button id="reveal-project" class="reveal-project">${icon("folderOpen")}<span>Show project folder</span>${icon("externalLink")}</button>
    </aside>
    <section class="source-pane" aria-label="Source editor">
      <div class="pane-bar source-bar">
        <div class="file-tab" id="file-tab" hidden>
          ${icon("fileCode")}<span id="filename"></span><i id="dirty-dot" title="Unsaved changes" hidden></i>
        </div>
        <button id="build-settings" class="icon-button" title="Compiler settings" aria-label="Compiler settings">${icon("settings")}</button>
      </div>
      <div id="editor" class="editor"></div>
      <div id="editor-empty" class="empty-state" hidden></div>
    </section>
    <section class="preview-pane" aria-label="PDF preview">
      <div class="pane-bar preview-bar">
        <div class="pane-title">${icon("fileText")}<span>PDF Preview</span></div>
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
  </main>
  <footer class="statusbar">
    <div class="status-slot"><span id="save-status" role="status"></span><span id="sync-status" role="status" hidden></span></div>
    <div class="status-slot status-details">
      <span id="cursor" class="cursor"></span>
      <button id="build-status" class="status-button" title="Show build log"></button>
      <span id="page-count" class="page-count"></span>
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
  </dialog>`;

const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id)! as T;
const main = app.querySelector<HTMLElement>("main")!;
const editorHost = el("editor");
const dialog = el<HTMLDialogElement>("dialog");
const form = el<HTMLFormElement>("dialog-form");
const popover = el("project-popover");
const collapse = new Set<string>();
const openedFiles = new Map<string, string>();
const viewButtons = [...app.querySelectorAll<HTMLButtonElement>(".view-switch button")];
let workspace: Workspace = { project: null, files: [], recent: [] };
let view: EditorView | undefined;
let source: Source | undefined;
let activeFile: ProjectFile | undefined;
let saveTimer: number | undefined;
let saveInProgress: Promise<void> | undefined;
let autoSyncTimer: number | undefined;
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

const preview = new Preview(el("preview-scroll"), el("paper-stack"), (page, pages, zoom) => {
  el("page-count").textContent = pages ? `${page} / ${pages}` : "";
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

function showView(mode: string) {
  if (!["editor", "split", "preview"].includes(mode)) mode = "split";
  main.dataset.view = mode;
  localStorage.setItem("view", mode);
  for (const button of viewButtons) button.setAttribute("aria-pressed", String(button.dataset.view === mode));
  if (mode !== "preview") view?.requestMeasure();
}

function showSidebar(show: boolean) {
  main.classList.toggle("sidebar-hidden", !show);
  el("toggle-sidebar").setAttribute("aria-pressed", String(show));
  localStorage.setItem("sidebar", show ? "open" : "closed");
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
  el("dirty-dot").hidden = !savePending;
  setStatus("sync-status", syncError ? "circleAlert" : syncing ? "refresh" : "cloudCheck", syncMessage,
    syncError ? "error" : syncing ? "working" : "");
  el("sync-status").title = syncMessage;
  setStatus("build-status", buildError ? "circleAlert" : building ? "refresh" : buildStale ? null : "check", buildMessage,
    buildError ? "error" : building ? "working" : buildStale ? "" : "good");
  el<HTMLButtonElement>("build-status").disabled = !currentBuildLog;
  el<HTMLButtonElement>("build").disabled = !workspace.project?.main || building || applying;
  el<HTMLButtonElement>("new-file").disabled = !workspace.project || applying || switching || switchingFile;
  el<HTMLButtonElement>("build-settings").disabled = !workspace.project || !workspace.files.some(file => /\.tex$/i.test(file.path));
  el<HTMLButtonElement>("reveal-project").hidden = !workspace.project;
  const cloud = el<HTMLButtonElement>("cloud-button");
  const connected = !!workspace.project?.connection;
  const label = connected ? syncing ? "Syncing…" : "Sync Overleaf" : "Connect Overleaf";
  if (cloud.textContent !== label) cloud.innerHTML = icon(connected ? "refresh" : "cloud") + `<span>${label}</span>`;
  cloud.disabled = (connected && !!syncingProject) || switching;
  cloud.classList.toggle("working", syncing);
}

function fileName(path: string) {
  return path.split("/").at(-1)!;
}

function fileSymbol(path: string): Icon {
  return /\.(tex|cls|sty)$/i.test(path) ? "fileCode" : /\.bib$/i.test(path) ? "bookOpen" : "file";
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
    const marker = document.createElement("span");
    marker.setAttribute("aria-hidden", "true");
    marker.textContent = "§";
    button.append(marker, document.createTextNode(heading.title));
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
    view?.destroy();
    view = undefined;
    source = loaded;
    activeFile = file;
    el("file-tab").hidden = !file;
    el("filename").textContent = file ? fileName(file.path) : "";
    el("filename").title = file?.path ?? "";
    el("editor-empty").hidden = true;
    saveError = "";
    savePending = false;
    if (project && file) {
      openedFiles.set(project.id, file.path);
      if (loaded) {
        if (focus && main.dataset.view === "preview") showView("split");
        view = createEditor(editorHost, file.path, loaded.text, edited);
        if (focus) view.focus();
      } else {
        editorPlaceholder(fileSymbol(file.path), fileName(file.path), "Open this file with another app from the project folder.",
          textButton("Show file", () => run(() => api.reveal(project.id, file.path))));
      }
    } else if (project) {
      editorPlaceholder("fileCode", "Start with a source file", "Add a .tex file to write and compile.",
        textButton("New file", newFile, "primary-button"));
    } else {
      editorPlaceholder("folderOpen", "Open a project", "Choose a folder or create a LaTeX project.",
        textButton("Open folder", () => run(openFolder), "primary-button"));
    }
  } finally {
    setReadOnly(view, applying);
    switchingFile = false;
    renderFiles();
    renderOutline();
    renderCursor();
    renderStatus();
  }
}

async function loadWorkspace(next: Workspace, first = false) {
  const remembered = next.project && openedFiles.get(next.project.id);
  view?.destroy();
  view = undefined;
  source = undefined;
  activeFile = undefined;
  workspace = next;
  collapse.clear();
  clearTimeout(autoSyncTimer);
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
}

async function showPdf(bytes?: Uint8Array) {
  el("preview-empty").hidden = !!bytes;
  try {
    await preview.load(bytes);
  } catch (error) {
    el("preview-empty").hidden = false;
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
        const file = fresh.files.find(entry => entry.path === previous) ?? fresh.files.find(entry => entry.path === fresh.project?.main);
        await openFile(file, { reload: true, focus: hadFocus === true });
        if (preview.hasDocument) {
          buildMessage = "Preview needs compilation";
          buildStale = true;
        }
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

async function build() {
  const project = workspace.project;
  if (!project?.main || building || switching || switchingFile || applying) return;
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
    if (main.dataset.view === "editor") showView("split");
    if (result.ok) {
      await showPdf(result.bytes);
      buildStale = editCount !== revision;
      buildMessage = buildStale ? "Preview needs compilation" : "PDF up to date";
      el("build-log").hidden = true;
    } else {
      buildError = true;
      buildMessage = "Build failed";
      el("build-log").hidden = false;
      notify(result.message, true);
    }
  } catch (error) {
    buildError = true;
    buildMessage = "Build failed";
    notify(message(error), true);
  } finally {
    building = false;
    renderStatus();
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
}) {
  if (dialog.open) return;
  closeMenu();
  el("dialog-icon").innerHTML = icon(options.symbol);
  el("dialog-title").textContent = options.title;
  el("dialog-description").textContent = options.description;
  el("dialog-description").hidden = !options.description;
  el("dialog-fields").replaceChildren(...options.fields);
  el("dialog-error").hidden = true;
  el<HTMLButtonElement>("confirm-dialog").textContent = options.label;
  dialogAction = options.submit;
  dialog.showModal();
  dialog.querySelector<HTMLElement>("input, select")?.focus();
}

const value = (data: FormData, name: string) => String(data.get(name) ?? "").trim();

function newProject() {
  showDialog({
    title: "New project", symbol: "folder", label: "Create project", description: "Start a LaTeX project on this device.",
    fields: [field("Project name", "name", { placeholder: "Untitled paper", required: true, maxLength: 80 })],
    submit: data => changeProject(() => api.newProject(value(data, "name"))),
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
el("reveal-project").addEventListener("click", () => run(() => api.reveal(workspace.project!.id)));
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

api.onPrepareClose(() => {
  setReadOnly(view, true);
  void flush().then(() => api.close(true)).catch(error => {
    setReadOnly(view, false);
    notify(message(error), true);
    void api.close(false);
  });
});
api.onCommand(command => {
  if (dialog.open) return;
  if (command === "new") newProject();
  if (command === "new-file") newFile();
  if (command === "open") run(openFolder);
  if (command === "save") run(flush);
  if (command === "build") void build();
  if (command === "find" && view) {
    if (main.dataset.view === "preview") showView("split");
    openSearchPanel(view);
  }
});

window.setInterval(() => {
  if (workspace.project?.connection?.auto && (!syncError || /unreachable|rejected/i.test(syncMessage))) void sync(false);
}, 60_000);
window.addEventListener("online", () => {
  if (workspace.project?.connection?.auto && syncError && /unreachable/i.test(syncMessage)) void sync(false);
});
showSidebar(localStorage.getItem("sidebar") !== "closed");
showView(localStorage.getItem("view") ?? "split");
renderStatus();
run(async () => loadWorkspace(await api.start(), true));
