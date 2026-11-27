export const shortcutDefaults = {
  new: "CmdOrCtrl+Shift+N", open: "CmdOrCtrl+O", "new-file": "CmdOrCtrl+N",
  import: "CmdOrCtrl+Alt+I", save: "CmdOrCtrl+S", export: "CmdOrCtrl+Shift+S",
  build: "CmdOrCtrl+Enter", find: "CmdOrCtrl+F", "project-search": "CmdOrCtrl+Alt+F",
  "quick-open": "CmdOrCtrl+K", "goto-line": "CmdOrCtrl+L", "insert-block": "CmdOrCtrl+Shift+I",
  "reveal-pdf": "CmdOrCtrl+Alt+Enter", sync: "CmdOrCtrl+Shift+R", settings: "CmdOrCtrl+,",
  "close-tab": "CmdOrCtrl+W", "reopen-tab": "CmdOrCtrl+Shift+T",
  "source-view": "CmdOrCtrl+1", "split-view": "CmdOrCtrl+2", "pdf-view": "CmdOrCtrl+3",
  "toggle-sidebar": "CmdOrCtrl+B", "focus-mode": "CmdOrCtrl+Shift+F",
  "previous-tab": "Ctrl+Shift+Tab", "next-tab": "Ctrl+Tab", "pdf-fit": "CmdOrCtrl+0",
  shortcuts: "CmdOrCtrl+/", issues: "CmdOrCtrl+Shift+M",
};

export const shortcutGroups = [
  ["Workspace", [
    ["quick-open", "Quick Open"], ["new", "New project"], ["open", "Open folder"], ["new-file", "New file"],
    ["import", "Import files"], ["close-tab", "Close tab"], ["reopen-tab", "Reopen closed tab"],
    ["previous-tab", "Previous tab"], ["next-tab", "Next tab"], ["toggle-sidebar", "Toggle sidebar"],
    ["focus-mode", "Focus mode"], ["settings", "Settings"], ["shortcuts", "Keyboard shortcuts"],
  ]],
  ["Editor", [
    ["save", "Save source"], ["find", "Find in file"], ["project-search", "Search project"], ["goto-line", "Go to line"],
    ["insert-block", "Insert LaTeX block"], ["reveal-pdf", "Reveal source in PDF"],
  ]],
  ["PDF and Overleaf", [
    ["build", "Compile"], ["issues", "Build issues"], ["export", "Save PDF"], ["pdf-fit", "Fit PDF page"],
    ["source-view", "Source view"], ["split-view", "Split view"], ["pdf-view", "PDF view"], ["sync", "Sync Overleaf"],
  ]],
];

export const customCommands = new Set([
  "quick-open", "reopen-tab", "project-search", "goto-line", "insert-block", "reveal-pdf",
  "build", "issues", "focus-mode", "sync",
]);

const modifiers = ["CmdOrCtrl", "Ctrl", "Alt", "Shift"];
const appReserved = [
  "CmdOrCtrl+A", "CmdOrCtrl+C", "CmdOrCtrl+H", "CmdOrCtrl+M", "CmdOrCtrl+Q", "CmdOrCtrl+V",
  "CmdOrCtrl+X", "CmdOrCtrl+Z", "CmdOrCtrl+Shift+Z", "CmdOrCtrl+Shift+W",
];

export function resolveShortcut(command, custom) {
  return custom?.[command] ?? shortcutDefaults[command];
}

export function validateShortcuts(custom, mac) {
  if (!custom || typeof custom !== "object" || Array.isArray(custom)) throw new Error("Choose valid keyboard shortcuts.");
  const result = {};
  for (const [command, accelerator] of Object.entries(custom)) {
    if (!customCommands.has(command) || typeof accelerator !== "string") throw new Error("Choose valid keyboard shortcuts.");
    const keys = accelerator.split("+");
    const key = keys.pop();
    if (keys.length < 1 || new Set(keys).size !== keys.length || keys.some(part => !modifiers.includes(part)) ||
        (!keys.includes("CmdOrCtrl") && !keys.includes("Ctrl")) || !/^(?:[A-Z0-9/,.;'\\\[\]-]|Enter|Space|Tab|Backspace|Up|Down|Left|Right)$/.test(key)) {
      throw new Error("Use a shortcut with Command or Control.");
    }
    const normalized = modifiers.filter(modifier => keys.includes(modifier)).concat(key).join("+");
    if (normalized !== shortcutDefaults[command]) result[command] = normalized;
  }
  const keyFor = accelerator => {
    const parts = accelerator.split("+");
    const key = parts.pop();
    const canonical = new Set(parts.map(part => !mac && part === "CmdOrCtrl" ? "Ctrl" : part));
    return [...canonical].sort().concat(key).join("+");
  };
  const used = new Map(appReserved.map(accelerator => [keyFor(accelerator), "a system command"]));
  const titles = new Map(shortcutGroups.flatMap(group => group[1]));
  for (const command of Object.keys(shortcutDefaults)) {
    const code = keyFor(resolveShortcut(command, result));
    if (used.has(code)) throw new Error(`${titles.get(command)} uses the same shortcut as ${used.get(code)}.`);
    used.set(code, titles.get(command));
  }
  return result;
}

export function displayShortcut(accelerator = "", mac = false) {
  const glyphs = { CmdOrCtrl: "⌘", Ctrl: "⌃", Alt: "⌥", Shift: "⇧", Enter: "↵", Tab: "⇥", Left: "←", Right: "→", Up: "↑", Down: "↓" };
  return accelerator.split("+").map(key => mac ? glyphs[key] ?? key : key === "CmdOrCtrl" ? "Ctrl" : key).join(mac ? "" : "+");
}
