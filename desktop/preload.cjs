const { contextBridge, ipcRenderer, webUtils } = require("electron");

const actions = [
  "start", "openFolder", "selectProject", "newProject", "connect", "configureConnection",
  "openOverleaf", "reveal", "refresh", "read", "save", "recoverSource", "createFile", "configureBuild",
  "fetch", "integrate", "push", "build", "exportPdf", "savePreferences", "copyMcpConfig", "close",
  "searchProject", "projectSymbols", "syncToPdf", "syncToSource", "captureShortcuts",
  "moveEntry", "trashEntry", "importFiles", "createFolder",
];
async function invoke(action, ...args) {
  const result = await ipcRenderer.invoke(`quire:${action}`, ...args);
  // Structured clone preserves Error.message, but drops custom properties.
  if (!result.ok && result.code === "SYNC_RETRY") return Promise.reject({ message: result.error, code: result.code });
  if (!result.ok) throw new Error(result.error);
  return result.value;
}
const api = Object.fromEntries(actions.map(action => [
  action, (...args) => invoke(action, ...args),
]));

contextBridge.exposeInMainWorld("quire", {
  ...api,
  dropFiles: (id, folder, files) => invoke("dropFiles", id, folder, files.map(file => webUtils.getPathForFile(file)).filter(Boolean)),
  platform: process.platform,
  onCommand: callback => ipcRenderer.on("quire:command", (_event, name) => callback(name)),
  onPrepareClose: callback => ipcRenderer.on("quire:prepare-close", () => callback()),
});
