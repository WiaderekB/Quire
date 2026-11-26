import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, net, protocol, safeStorage, shell } from "electron";
import { randomUUID } from "node:crypto";
import { cp, mkdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { atomicWrite, createSource, listFiles, projectPath, readSource, saveSource } from "./files.mjs";
import { compileProject } from "./latex.mjs";
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
  const { appearance, editorSize } = state.preferences ?? {};
  return {
    appearance: appearances.includes(appearance) ? appearance : "system",
    editorSize: Number.isInteger(editorSize) && editorSize >= 12 && editorSize <= 18 ? editorSize : 14,
  };
}

function windowBackground() {
  return nativeTheme.shouldUseDarkColors ? "#1d201e" : "#fafaf7";
}

function validateName(value) {
  const name = typeof value === "string" ? value.trim() : "";
  if (name.length < 1 || name.length > 80 || /[\u0000-\u001f]/.test(name)) {
    throw new Error("Enter a project name between 1 and 80 characters.");
  }
  return name;
}

function projectTemplate(title) {
  const escapes = { "\\": "\\textbackslash{}", "^": "\\textasciicircum{}", "~": "\\textasciitilde{}" };
  const safe = title.replace(/[\\#$%&_{}^~]/g, character => escapes[character] ?? "\\" + character);
  return [
    "\\documentclass[11pt,a4paper]{article}",
    "",
    `\\title{${safe}}`,
    "\\author{}",
    "\\date{}",
    "",
    "\\begin{document}",
    "\\maketitle",
    "",
    "\\section{Introduction}",
    "",
    "\\end{document}",
    "",
  ].join("\n");
}

async function activate(project) {
  const files = await listFiles(project.root);
  if (!files.some(file => file.path === project.main)) {
    project.main = files.find(file => file.path === "main.tex")?.path ??
      files.find(file => file.path.toLowerCase().endsWith(".tex"))?.path ?? null;
  }
  state.active = project.id;
  state.projects = [project, ...state.projects.filter(entry => entry.id !== project.id)];
  await saveState();
  return {
    project: publicProject(project), files, recent: recentProjects(), preview: previews.get(project.id)?.bytes,
  };
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
      if (project.id === "field-notes" && project.main === "main.tex") {
        const files = await listFiles(project.root);
        const unchanged = files.length === 3 && (await Promise.all(files.map(async file =>
          (await readFile(path.join(project.root, file.path))).equals(await readFile(path.join(example, file.path))),
        ))).every(Boolean);
        if (unchanged) {
          const bytes = new Uint8Array(await readFile(path.join(example, "preview.pdf")));
          previews.set(project.id, { bytes, name: "field-notes.pdf" });
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
  async savePreferences(appearance, editorSize) {
    if (!appearances.includes(appearance) || !Number.isInteger(editorSize) || editorSize < 12 || editorSize > 18) {
      throw new Error("Choose a valid appearance and text size.");
    }
    const previous = state.preferences;
    state.preferences = { appearance, editorSize };
    try {
      await saveState();
    } catch (error) {
      state.preferences = previous;
      throw error;
    }
    nativeTheme.themeSource = appearance;
    return preferences();
  },
  async openFolder() {
    const result = await dialog.showOpenDialog(window, { title: "Open a LaTeX project", properties: ["openDirectory"] });
    if (result.canceled) return null;
    const root = await realpath(result.filePaths[0]);
    const existing = state.projects.find(project => project.root === root);
    return activate(existing ?? {
      id: randomUUID(), name: path.basename(root), root, main: null, engine: "pdflatex",
    });
  },
  selectProject(id) {
    return activate(getProject(id));
  },
  async newProject(value) {
    const name = validateName(value);
    const id = randomUUID();
    const root = path.join(projectHome, id);
    await mkdir(root);
    try {
      await writeFile(path.join(root, "main.tex"), projectTemplate(name));
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
    return activate(getProject(id));
  },
  async read(id, relative) {
    const file = await projectPath(getProject(id).root, relative, { editable: true });
    return readSource(file);
  },
  save(id, relative, contents, version) {
    return serialize(id, async () => {
      const file = await projectPath(getProject(id).root, relative, { editable: true });
      return saveSource(file, contents, version);
    });
  },
  createFile(id, relative) {
    return serialize(id, async () => {
      const project = getProject(id);
      await createSource(project.root, relative);
      return activate(project);
    });
  },
  async configureBuild(id, relative, engine) {
    const project = getProject(id);
    await projectPath(project.root, relative, { editable: true });
    if (!relative.toLowerCase().endsWith(".tex") || !engines.includes(engine)) {
      throw new Error("Choose a TeX main document and a LaTeX engine.");
    }
    project.main = relative;
    project.engine = engine;
    await saveState();
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
    if (!project.main) throw new Error("Add a .tex file to build this project.");
    const result = await compileProject(project.root, project.main, project.engine);
    if (result.ok) {
      previews.set(id, { bytes: result.bytes, name: result.name });
    }
    return result;
  },
  async exportPdf(id) {
    const preview = previews.get(id);
    if (!preview) throw new Error("Build the project before exporting.");
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
  function command(label, accelerator, name) {
    return { label, accelerator, click: () => window?.webContents.send("quire:command", name) };
  }
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(isMac ? [{ label: "Quire", submenu: [
      { role: "about" },
      command("Settings…", "CmdOrCtrl+,", "settings"),
      { type: "separator" },
      { role: "services" },
      { type: "separator" },
      { role: "hide" }, { role: "hideOthers" }, { role: "unhide" },
      { type: "separator" }, { role: "quit" },
    ] }] : []),
    { label: "File", submenu: [
      command("New Project…", "CmdOrCtrl+Shift+N", "new"),
      command("Open Folder…", "CmdOrCtrl+O", "open"),
      command("New File…", "CmdOrCtrl+N", "new-file"),
      { type: "separator" },
      command("Save", "CmdOrCtrl+S", "save"),
      command("Build", "CmdOrCtrl+Enter", "build"),
      command("Find in File…", "CmdOrCtrl+F", "find"),
      ...(isMac ? [] : [command("Settings…", "CmdOrCtrl+,", "settings")]),
      { type: "separator" }, { role: "close" },
    ] },
    { role: "editMenu" },
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
          return { ok: false, error: error.message || "This operation could not finish." };
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
