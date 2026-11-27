const { contextBridge, ipcRenderer } = require("electron");

const actions = [
  "start", "openFolder", "selectProject", "newProject", "connect", "configureConnection",
  "openOverleaf", "reveal", "refresh", "read", "save", "recoverSource", "createFile", "configureBuild",
  "fetch", "integrate", "push", "build", "exportPdf", "savePreferences", "copyMcpConfig", "close",
];
const api = Object.fromEntries(actions.map(action => [
  action,
  async (...args) => {
    const result = await ipcRenderer.invoke(`quire:${action}`, ...args);
    // Structured clone preserves Error.message, but drops custom properties.
    if (!result.ok && result.code === "SYNC_RETRY") return Promise.reject({ message: result.error, code: result.code });
    if (!result.ok) throw new Error(result.error);
    return result.value;
  },
]));

contextBridge.exposeInMainWorld("quire", {
  ...api,
  platform: process.platform,
  onCommand: callback => ipcRenderer.on("quire:command", (_event, name) => callback(name)),
  onPrepareClose: callback => ipcRenderer.on("quire:prepare-close", () => callback()),
});
