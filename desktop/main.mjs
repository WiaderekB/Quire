import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeTheme, net, protocol, safeStorage, shell } from "electron";
import { randomUUID } from "node:crypto";
import { cp, lstat, mkdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { atomicWrite, createSource, listFiles, listWorkspace, projectPath, readSource, saveSource, withProjectWrite } from "./files.mjs";
import { compileProject } from "./latex.mjs";
import { pdfToSource, sourceToPdf } from "./synctex.mjs";
import { indexProject, searchSources } from "./project-navigation.mjs";
import { importProjectFiles, moveProjectEntry, projectEntry, relocatePath, validProjectName } from "./project-files.mjs";
import { resolveShortcut, validateShortcuts } from "./shortcuts.mjs";
import { projectTemplate } from "./templates.mjs";
import {
  cloneOverleaf, fetchOverleaf, integrateOverleaf, parseOverleafLink, pushOverleaf,
} from "./overleaf.mjs";

const appRoot = fileURLToPath(new URL("../", import.meta.url));
const example = path.join(appRoot, "example");
const renderer = path.join(appRoot, "dist");
const origin = "quire://app";
const isMac = process.platform === "darwin";
const engines = ["pdflatex", "xelatex", "lualatex"];
const appearances = ["system", "light", "dark"];
let window;
let state;
let statePath;
let projectHome;
let stateWrites = Promise.resolve();
let approvedClose = false;
let requestedClose = false;
let requestedQuit = false;
const temporaryTokens = new Map();
const projectWrites = new Map();
const previews = new Map();
const symbolIndexes = new Map();

app.setName("Quire");
if (!app.isPackaged && process.env.QUIRE_DATA_DIR) app.setPath("userData", path.resolve(process.env.QUIRE_DATA_DIR));
protocol.registerSchemesAsPrivileged([{
  scheme: "quire",
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
}]);

function saveState() {
  const content = JSON.stringify(state, null, 2);
  const operation = stateWrites.catch(() => {}).then(() => atomicWrite(statePath, content));
  stateWrites = operation;
  return operation;
}

function serialize(id, callback) {
  const operation = (projectWrites.get(id) ?? Promise.resolve()).catch(() => {}).then(callback);
  projectWrites.set(id, operation);
  return operation.finally(() => {
    if (projectWrites.get(id) === operation) projectWrites.delete(id);
  });
}

function getProject(id) {
  const project = state.projects.find(entry => entry.id === id);
  if (!project) throw new Error("Open a project first.");
  return project;
}

function publicProject(project) {
  const { connection, ...publicData } = project;
  return {
    ...publicData,
    connection: connection ? { url: connection.url, web: connection.web, auto: connection.auto !== false } : null,
  };
}

function recentProjects() {
  return state.projects.map(publicProject);
}

function preferences() {
  const {
    appearance, editorSize, tabSize, lineNumbers, lineNumberMode, lineWrapping, autoCompile,
    compileDelay, vimMode, editorFont, lineHeight, autoCloseBrackets, activeLine, shortcuts,
  } = state.preferences ?? {};
  let custom = {};
  try { custom = validateShortcuts(shortcuts ?? {}, isMac); } catch { /* Restore the defaults for invalid stored shortcuts. */ }
  return {
    appearance: appearances.includes(appearance) ? appearance : "system",
    editorSize: Number.isInteger(editorSize) && editorSize >= 11 && editorSize <= 22 ? editorSize : 14,
    tabSize: [2, 4, 8].includes(tabSize) ? tabSize : 2,
    lineNumberMode: ["off", "absolute", "relative"].includes(lineNumberMode) ? lineNumberMode : lineNumbers === false ? "off" : "absolute",
    lineWrapping: lineWrapping !== false,
    autoCompile: autoCompile === true,
    compileDelay: [600, 1000, 1600].includes(compileDelay) ? compileDelay : 1000,
    vimMode: vimMode === true,
    editorFont: editorFont === "system" ? "system" : "plex",
    lineHeight: [1.4, 1.65, 1.85].includes(lineHeight) ? lineHeight : 1.65,
    autoCloseBrackets: autoCloseBrackets !== false,
    activeLine: activeLine !== false,
    shortcuts: custom,
  };
}

function windowBackground() {
  return nativeTheme.shouldUseDarkColors ? "#222222" : "#fafafa";
}

function validateName(value) {
  const name = typeof value === "string" ? value.trim() : "";
  if (name.length < 1 || name.length > 80 || /[\u0000-\u001f]/.test(name)) {
    throw new Error("Enter a project name between 1 and 80 characters.");
  }
  return name;
}

function optionalMetadata(value) {
  if (typeof value !== "string" || value.length > 160 || /[\u0000-\u001f]/.test(value)) {
    throw new Error("Use a single line of up to 160 characters for document details.");
  }
  return value.trim();
}

function checkMainDocument(project, files) {
  if (!files.some(file => file.path === project.main)) {
    project.main = files.find(file => file.path === "main.tex")?.path ??
      files.find(file => file.path.toLowerCase().endsWith(".tex"))?.path ?? null;
  }
}

function currentPreview(project, preview, files) {
  return !!preview && preview.main === project.main && preview.engine === project.engine &&
    preview.files.length === files.length &&
    preview.files.every((file, index) => file.path === files[index].path && file.stamp === files[index].stamp);
}

function describeWorkspace(project, { files, folders }, includePreview = true) {
  const preview = previews.get(project.id);
  return {
    project: publicProject(project), files, folders, recent: recentProjects(), preview: includePreview ? preview?.bytes : undefined,
    previewStale: !!preview && !currentPreview(project, preview, files),
    syncAvailable: !!preview?.mapping,
    issues: includePreview ? preview?.issues : undefined,
  };
}

async function activate(project) {
  const entries = await listWorkspace(project.root);
  checkMainDocument(project, entries.files);
  state.active = project.id;
  state.projects = [project, ...state.projects.filter(entry => entry.id !== project.id)];
  await saveState();
  return describeWorkspace(project, entries);
}

async function samplePreview(project, files) {
  const originals = (await listFiles(example)).filter(file => file.path !== "preview.pdf");
  if (originals.length !== files.length ||
      !originals.every((file, index) => file.path === files[index].path)) return;
  try {
    const unchanged = (await Promise.all(files.map(async ({ path: relative }) =>
      (await readFile(path.join(project.root, relative))).equals(await readFile(path.join(example, relative))),
    ))).every(Boolean);
    if (unchanged) return new Uint8Array(await readFile(path.join(example, "preview.pdf")));
  } catch (error) {
    if (!["ENOENT", "EACCES"].includes(error.code)) throw error;
  }
}

async function openProjectFolder(directory) {
  const root = await realpath(directory);
  const existing = state.projects.find(project => project.root === root);
  return activate(existing ?? { id: randomUUID(), name: path.basename(root), root, main: null, engine: "pdflatex" });
}

async function addProjectFiles(project, folder, paths) {
  return serialize(project.id, () => withProjectWrite(project.root, async () => {
    const result = await importProjectFiles(project.root, folder, paths);
    return { ...result, workspace: await activate(project) };
  }));
}

async function syncMapping(id) {
  const project = getProject(id);
  const preview = previews.get(id);
  if (!preview?.mapping) throw new Error("Compile the project to enable jumps between source and PDF.");
  if (!currentPreview(project, preview, await listFiles(project.root, "", true))) {
    throw new Error("Compile the current version before jumping between source and PDF.");
  }
  return { project, mapping: preview.mapping, preview };
}

async function setToken(project, token) {
  if (typeof token !== "string" || !token.trim() || token.length > 1024) {
    throw new Error("Enter a Git authentication token from Overleaf.");
  }
  const value = token.trim();
  temporaryTokens.set(project.id, value);
  delete project.connection.encryptedToken;
  try {
    if (!await safeStorage.isAsyncEncryptionAvailable()) return;
    if (!isMac && ["basic_text", "unknown"].includes(safeStorage.getSelectedStorageBackend())) return;
    project.connection.encryptedToken = (await safeStorage.encryptStringAsync(value)).toString("base64");
  } catch {
    // Keep the token in memory when the system keyring is unavailable.
  }
}

function connectionFor(id) {
  const project = getProject(id);
  if (!project.connection) throw new Error("Connect this project to Overleaf first.");
  return project;
}

async function projectToken(project) {
  const temporary = temporaryTokens.get(project.id);
  if (temporary) return temporary;
  try {
    if (project.connection.encryptedToken && await safeStorage.isAsyncEncryptionAvailable()) {
      const { result } = await safeStorage.decryptStringAsync(Buffer.from(project.connection.encryptedToken, "base64"));
      if (result) {
        temporaryTokens.set(project.id, result);
        return result;
      }
    }
  } catch {
    // A changed or locked system keyring can require a new token.
  }
  throw new Error("Enter your Overleaf token in Connection settings.");
}

async function initialize() {
  const data = app.getPath("userData");
  projectHome = path.join(data, "Projects");
  await mkdir(projectHome, { recursive: true });
  projectHome = await realpath(projectHome);
  statePath = path.join(path.dirname(projectHome), "workspace.json");
  try {
    state = JSON.parse(await readFile(statePath, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    const root = path.join(projectHome, "field-notes");
    await cp(example, root, {
      recursive: true,
      filter: source => path.basename(source) !== "preview.pdf",
    });
    state = {
      active: "field-notes",
      projects: [{ id: "field-notes", name: "Field Notes", root, main: "main.tex", engine: "pdflatex" }],
    };
    await saveState();
  }
}

const actions = {
  async start() {
    const project = getProject(state.active);
    try {
      const workspace = await activate(project);
      workspace.preferences = preferences();
      if (!workspace.preview && project.id === "field-notes" && project.main === "main.tex" && project.engine === "pdflatex") {
        const bytes = await samplePreview(project, workspace.files);
        if (bytes) {
          previews.set(project.id, { bytes, name: "field-notes.pdf", main: project.main, engine: project.engine, files: workspace.files });
          workspace.preview = bytes;
        }
      }
      return workspace;
    } catch (error) {
      if (["ENOENT", "EACCES"].includes(error.code)) {
        return { project: null, files: [], recent: recentProjects(), preferences: preferences() };
      }
      throw error;
    }
  },
  async savePreferences(next) {
    const { appearance, editorSize, tabSize, lineNumberMode, lineWrapping, autoCompile, compileDelay,
      vimMode, editorFont, lineHeight, autoCloseBrackets, activeLine, shortcuts } = next ?? {};
    if (!appearances.includes(appearance) || !Number.isInteger(editorSize) || editorSize < 11 || editorSize > 22 ||
        ![2, 4, 8].includes(tabSize) || !["off", "absolute", "relative"].includes(lineNumberMode) ||
        ![600, 1000, 1600].includes(compileDelay) || !["plex", "system"].includes(editorFont) ||
        ![1.4, 1.65, 1.85].includes(lineHeight) ||
        [lineWrapping, autoCompile, vimMode, autoCloseBrackets, activeLine].some(value => typeof value !== "boolean")) {
      throw new Error("Choose valid appearance and editor settings.");
    }
    const previous = state.preferences;
    const custom = validateShortcuts(shortcuts, isMac);
    state.preferences = { appearance, editorSize, tabSize, lineNumberMode, lineWrapping, autoCompile, compileDelay,
      vimMode, editorFont, lineHeight, autoCloseBrackets, activeLine, shortcuts: custom };
    try {
      await saveState();
    } catch (error) {
      state.preferences = previous;
      throw error;
    }
    nativeTheme.themeSource = appearance;
    configureMenu();
    return preferences();
  },
  captureShortcuts(active) {
    window?.webContents.setIgnoreMenuShortcuts(active === true);
  },
  copyMcpConfig(id, write) {
    const project = getProject(id);
    const server = app.isPackaged
      ? path.join(process.resourcesPath, "mcp", "quire-mcp.mjs")
      : path.join(renderer, "mcp", "quire-mcp.mjs");
    const args = [server, "--project", project.root];
    if (write === true) args.push("--write");
    clipboard.writeText(JSON.stringify({ mcpServers: { quire: { command: "node", args } } }, null, 2));
  },
  async openFolder() {
    const result = await dialog.showOpenDialog(window, { title: "Open a LaTeX project", properties: ["openDirectory"] });
    if (result.canceled) return null;
    return openProjectFolder(result.filePaths[0]);
  },
  selectProject(id) {
    return activate(getProject(id));
  },
  async newProject(details) {
    const name = validateName(details?.name);
    const contents = projectTemplate({
      title: optionalMetadata(details.title) || name,
      author: optionalMetadata(details.author),
      course: optionalMetadata(details.course),
      template: details.template,
    });
    const id = randomUUID();
    const root = path.join(projectHome, id);
    await mkdir(root);
    try {
      await writeFile(path.join(root, "main.tex"), contents);
      return await activate({ id, name, root, main: "main.tex", engine: "pdflatex" });
    } catch (error) {
      await rm(root, { force: true, recursive: true });
      throw error;
    }
  },
  async connect(link, token, value) {
    const remote = parseOverleafLink(link);
    if (state.projects.some(project => project.connection?.url === remote.url)) {
      throw new Error("This project is already connected. Open it from Recent projects.");
    }
    const id = randomUUID();
    const staging = path.join(projectHome, `.clone-${id}`);
    const root = path.join(projectHome, id);
    const project = { id, name: validateName(value), root, main: null, engine: "pdflatex", connection: remote };
    await setToken(project, token);
    try {
      project.connection.branch = await cloneOverleaf(projectHome, staging, remote.url, await projectToken(project));
      await rename(staging, root);
      return await activate(project);
    } catch (error) {
      temporaryTokens.delete(id);
      await rm(staging, { force: true, recursive: true });
      await rm(root, { force: true, recursive: true });
      throw error;
    }
  },
  async configureConnection(id, token, auto) {
    const project = connectionFor(id);
    if (token) await setToken(project, token);
    project.connection.auto = auto === true;
    await saveState();
    return publicProject(project);
  },
  async reveal(id, relative) {
    const project = getProject(id);
    if (relative) {
      shell.showItemInFolder(await projectPath(project.root, relative));
    } else {
      const error = await shell.openPath(project.root);
      if (error) throw new Error(error);
    }
  },
  async openOverleaf(id) {
    await shell.openExternal(connectionFor(id).connection.web);
  },
  async refresh(id) {
    const project = getProject(id);
    const entries = await listWorkspace(project.root);
    const previous = project.main;
    checkMainDocument(project, entries.files);
    if (project.main !== previous) await saveState();
    return describeWorkspace(project, entries, false);
  },
  searchProject(id, query, options) {
    return searchSources(getProject(id).root, query, options);
  },
  projectSymbols(id) {
    const { root, main } = getProject(id);
    let entry = symbolIndexes.get(id);
    if (!entry) symbolIndexes.set(id, entry = { cache: new Map(), pending: Promise.resolve() });
    const update = entry.pending.catch(() => {}).then(() => indexProject(root, main, entry.cache));
    entry.pending = update;
    return update;
  },
  async read(id, relative) {
    const file = await projectPath(getProject(id).root, relative, { editable: true });
    return readSource(file);
  },
  save(id, relative, contents, version) {
    return serialize(id, async () => {
      const { root } = getProject(id);
      const file = await projectPath(root, relative, { editable: true });
      return saveSource(file, contents, version, root);
    });
  },
  async recoverSource(id, relative, contents, reason) {
    const project = getProject(id);
    const name = path.basename(relative);
    const choice = await dialog.showMessageBox(window, {
      type: "warning", title: "Unsaved changes", message: `Changes to ${name} could not be saved.`,
      detail: `${reason}\n\nSave your edits to a separate file, or discard them and keep the version on disk.`,
      buttons: ["Save a copy…", "Discard edits", "Cancel"], defaultId: 0, cancelId: 2, noLink: true,
    });
    if (choice.response !== 0) return choice.response === 1;
    const ext = path.extname(name);
    const result = await dialog.showSaveDialog(window, {
      title: "Save a copy of your edits",
      defaultPath: path.join(app.getPath("documents"), `${path.basename(name, ext)} recovered${ext}`),
    });
    if (result.canceled) return false;
    const destination = path.join(await realpath(path.dirname(result.filePath)), path.basename(result.filePath));
    const original = path.join(project.root, relative);
    if (destination === original || await realpath(destination).catch(() => null) === original) {
      throw new Error("Choose a different file for the recovered copy.");
    }
    await atomicWrite(destination, contents);
    return true;
  },
  createFile(id, relative) {
    return serialize(id, async () => {
      const project = getProject(id);
      await withProjectWrite(project.root, () => createSource(project.root, relative));
      return activate(project);
    });
  },
  createFolder(id, parent, name) {
    const project = getProject(id);
    if (!validProjectName(name)) throw new Error("Enter a valid folder name.");
    return serialize(id, () => withProjectWrite(project.root, async () => {
      const { file } = await projectEntry(project.root, parent, true);
      await mkdir(path.join(file, name)).catch(error => {
        if (error.code === "EEXIST") throw new Error("A file or folder with that name already exists here.");
        throw error;
      });
      return activate(project);
    }));
  },
  moveEntry(id, from, to) {
    const project = getProject(id);
    return serialize(id, () => withProjectWrite(project.root, async () => {
      await moveProjectEntry(project.root, from, to);
      project.main = relocatePath(project.main, from, to);
      return activate(project);
    }));
  },
  async trashEntry(id, relative) {
    const project = getProject(id);
    const choice = await dialog.showMessageBox(window, {
      type: "warning", title: "Move to Trash", message: `Move “${path.basename(relative)}” to Trash?`,
      detail: project.connection ? "After synchronization, this item will also be removed from the Overleaf project." : "",
      buttons: ["Cancel", "Move to Trash"], defaultId: 0, cancelId: 0, noLink: true,
    });
    if (choice.response !== 1) return null;
    return serialize(id, () => withProjectWrite(project.root, async () => {
      const { file } = await projectEntry(project.root, relative);
      await shell.trashItem(file);
      return activate(project);
    }));
  },
  async importFiles(id, folder) {
    const project = getProject(id);
    const result = await dialog.showOpenDialog(window, { title: "Import files into the project", properties: ["openFile", "multiSelections"] });
    if (result.canceled) return null;
    return addProjectFiles(project, folder, result.filePaths);
  },
  async dropFiles(id, folder, paths) {
    if (!Array.isArray(paths) || paths.length === 0 || paths.length > 100 ||
        paths.some(file => typeof file !== "string" || !path.isAbsolute(file))) return null;
    if (paths.length === 1) {
      const info = await lstat(paths[0]);
      if (info.isDirectory()) return { kind: "project", workspace: await openProjectFolder(paths[0]) };
      if (!id && info.isFile() && /\.tex$/i.test(paths[0])) {
        return { kind: "project", workspace: await openProjectFolder(path.dirname(paths[0])), openFile: path.basename(paths[0]) };
      }
    }
    if (!id) throw new Error("Open a project to import files into it.");
    return { kind: "import", ...await addProjectFiles(getProject(id), folder, paths) };
  },
  async configureBuild(id, relative, engine) {
    const project = getProject(id);
    await projectPath(project.root, relative, { editable: true });
    if (!relative.toLowerCase().endsWith(".tex") || !engines.includes(engine)) {
      throw new Error("Choose a TeX main document and a LaTeX engine.");
    }
    const previous = { main: project.main, engine: project.engine };
    project.main = relative;
    project.engine = engine;
    try {
      await saveState();
    } catch (error) {
      Object.assign(project, previous);
      throw error;
    }
    return publicProject(project);
  },
  async fetch(id) {
    const project = connectionFor(id);
    return fetchOverleaf(project.root, project.connection, await projectToken(project));
  },
  integrate(id) {
    const project = connectionFor(id);
    return serialize(id, () => integrateOverleaf(project.root, project.connection));
  },
  async push(id) {
    const project = connectionFor(id);
    return pushOverleaf(project.root, project.connection, await projectToken(project));
  },
  async build(id) {
    const project = getProject(id);
    const { root, main, engine } = project;
    if (!main) throw new Error("Add a .tex file to build this project.");
    const files = await listFiles(root, "", true);
    const { mapping, ...result } = await compileProject(root, main, engine);
    if (result.ok) previews.set(id, { bytes: result.bytes, name: result.name, main, engine, files, mapping, issues: result.issues });
    return { ...result, syncAvailable: !!mapping };
  },
  async syncToPdf(id, relative, line, column) {
    if (!Number.isInteger(line) || line < 1 || !Number.isInteger(column) || column < 1) return null;
    const { project, mapping, preview } = await syncMapping(id);
    await projectPath(project.root, relative, { editable: true });
    const location = await sourceToPdf(mapping, relative, line, column);
    return previews.get(id) === preview ? location : null;
  },
  async syncToSource(id, page, x, y) {
    if (!Number.isInteger(page) || page < 1 || !Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0) return null;
    const { project, mapping, preview } = await syncMapping(id);
    const location = await pdfToSource(mapping, page, x, y);
    if (!location || previews.get(id) !== preview) return null;
    await projectPath(project.root, location.path, { editable: true });
    return location;
  },
  async exportPdf(id) {
    const project = getProject(id);
    const preview = previews.get(id);
    if (!currentPreview(project, preview, await listFiles(project.root, "", true))) {
      throw new Error("Build the current document before exporting.");
    }
    const result = await dialog.showSaveDialog(window, {
      title: "Save PDF", defaultPath: preview.name, filters: [{ name: "PDF", extensions: ["pdf"] }],
    });
    if (result.canceled) return false;
    await atomicWrite(result.filePath, preview.bytes, 0o644);
    return true;
  },
  async close(confirm) {
    if (confirm) {
      await Promise.allSettled(projectWrites.values());
      await stateWrites;
    }
    requestedClose = false;
    if (confirm && window) {
      approvedClose = true;
      window.close();
      if (requestedQuit) app.quit();
    }
    requestedQuit = false;
  },
};

function configureMenu() {
  const custom = preferences().shortcuts;
  function command(label, name) {
    return { label, accelerator: resolveShortcut(name, custom), click: () => window?.webContents.send("quire:command", name) };
  }
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(isMac ? [{ label: "Quire", submenu: [
      { role: "about" },
      command("Settings…", "settings"),
      { type: "separator" },
      { role: "services" },
      { type: "separator" },
      { role: "hide" }, { role: "hideOthers" }, { role: "unhide" },
      { type: "separator" }, { role: "quit" },
    ] }] : []),
    { label: "File", submenu: [
      command("New Project…", "new"),
      command("Open Folder…", "open"),
      command("New File…", "new-file"),
      command("Import Files…", "import"),
      { type: "separator" },
      command("Save", "save"),
      command("Save PDF…", "export"),
      command("Build", "build"),
      command("Find in File…", "find"),
      command("Search Project…", "project-search"),
      command("Quick Open…", "quick-open"),
      command("Go to Line…", "goto-line"),
      command("Insert LaTeX Block…", "insert-block"),
      command("Reveal Source in PDF", "reveal-pdf"),
      command("Sync Overleaf", "sync"),
      ...(isMac ? [] : [command("Settings…", "settings")]),
      { type: "separator" },
      command("Close Tab", "close-tab"),
      command("Reopen Closed Tab", "reopen-tab"),
      { role: "close", label: "Close Window", accelerator: "CmdOrCtrl+Shift+W" },
    ] },
    { role: "editMenu" },
    { label: "View", submenu: [
      command("Source", "source-view"),
      command("Split", "split-view"),
      command("PDF", "pdf-view"),
      command("Toggle Sidebar", "toggle-sidebar"),
      command("Focus Mode", "focus-mode"),
      { type: "separator" },
      command("Previous Tab", "previous-tab"),
      command("Next Tab", "next-tab"),
      { type: "separator" },
      command("Fit PDF Page", "pdf-fit"),
      command("Build Issues", "issues"),
      command("Keyboard Shortcuts", "shortcuts"),
    ] },
    { role: "windowMenu" },
  ]));
}

function createWindow() {
  approvedClose = false;
  requestedClose = false;
  window = new BrowserWindow({
    title: "Quire",
    width: 1440,
    height: 920,
    minWidth: 820,
    minHeight: 560,
    backgroundColor: windowBackground(),
    titleBarStyle: isMac ? "hiddenInset" : "default",
    ...(isMac ? { trafficLightPosition: { x: 18, y: 23 } } : {}),
    webPreferences: {
      preload: path.join(appRoot, "desktop", "preload.cjs"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  if (!isMac) window.setAutoHideMenuBar(true);
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", event => event.preventDefault());
  window.on("close", event => {
    if (approvedClose) return;
    event.preventDefault();
    if (!requestedClose) {
      requestedClose = true;
      window.webContents.send("quire:prepare-close");
    }
  });
  window.on("closed", () => { window = null; });
  void window.loadURL(`${origin}/index.html`);
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => window?.focus());
  app.on("before-quit", () => { requestedQuit = true; });
  app.whenReady().then(async () => {
    protocol.handle("quire", request => {
      const url = new URL(request.url);
      const asset = path.resolve(renderer, "." + decodeURIComponent(url.pathname));
      if (url.host !== "app" || !asset.startsWith(renderer + path.sep)) return new Response(null, { status: 404 });
      return net.fetch(pathToFileURL(asset).href);
    });
    await initialize();
    nativeTheme.themeSource = preferences().appearance;
    nativeTheme.on("updated", () => window?.setBackgroundColor(windowBackground()));
    if (isMac && !app.isPackaged) app.dock.setIcon(path.join(appRoot, "assets", "icon.png"));
    for (const [action, handler] of Object.entries(actions)) {
      ipcMain.handle(`quire:${action}`, async (event, ...args) => {
        if (event.sender !== window?.webContents || event.senderFrame !== event.sender.mainFrame ||
            !event.senderFrame.url.startsWith(origin + "/")) {
          return { ok: false, error: "This action is only available in the Quire window." };
        }
        try {
          return { ok: true, value: await handler(...args) };
        } catch (error) {
          return { ok: false, error: error.message || "This operation could not finish.", code: error.code };
        }
      });
    }
    configureMenu();
    createWindow();
    app.on("activate", () => { if (!window) createWindow(); });
  }).catch(error => {
    dialog.showErrorBox("Quire couldn’t start", error.message);
    app.exit(1);
  });
  app.on("window-all-closed", () => { if (!isMac) app.quit(); });
}
