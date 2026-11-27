import type { Appearance, Preferences } from "./api";
import { field, select, value } from "./controls";
import { icon } from "./icons";
import type { Icon } from "./icons";
import { customCommands, displayShortcut, resolveShortcut, shortcutGroups, validateShortcuts } from "../desktop/shortcuts.mjs";

const themes: Array<[Appearance, string]> = [["system", "System"], ["light", "Light"], ["dark", "Dark"]];
const punctuation: Record<string, string> = {
  Slash: "/", Comma: ",", Period: ".", Semicolon: ";", Quote: "'", Backslash: "\\",
  BracketLeft: "[", BracketRight: "]", Minus: "-",
};

function acceleratorFor(event: KeyboardEvent, mac: boolean) {
  const main = mac ? event.metaKey : event.ctrlKey;
  if (!main && !event.ctrlKey) return null;
  const key = /^Key[A-Z]$/.test(event.code) || /^Digit[0-9]$/.test(event.code) ? event.code.at(-1) :
    punctuation[event.code] ?? ({ " ": "Space", ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right" } as Record<string, string>)[event.key] ??
    (/^(Enter|Tab|Backspace)$/.test(event.key) ? event.key : undefined);
  if (!key) return null;
  return [main && "CmdOrCtrl", mac && event.ctrlKey && "Ctrl", event.altKey && "Alt", event.shiftKey && "Shift", key]
    .filter(Boolean).join("+");
}

function preferencesCheckbox(label: string, name: string, checked: boolean) {
  const option = field(label, name, { type: "checkbox", checked });
  option.classList.add("checkbox-field");
  return option;
}

function appearanceChoices(current: Appearance) {
  const choices = document.createElement("div");
  choices.className = "appearance-choices";
  for (const [mode, name] of themes) {
    const choice = field(name, "appearance", { type: "radio", value: mode, checked: mode === current });
    choice.className = "appearance-choice";
    const sample = document.createElement("span");
    sample.className = `theme-sample ${mode}`;
    sample.setAttribute("aria-hidden", "true");
    sample.innerHTML = "<i></i><i></i>";
    choice.insertBefore(sample, choice.firstChild);
    choices.append(choice);
  }
  return choices;
}

export function settingsView(
  preferences: Preferences,
  options: { section?: string; mac: boolean; mcp?: () => void; connection?: () => void; capture: (active: boolean) => void },
) {
  const root = document.createElement("div");
  root.className = "settings-layout";
  const nav = document.createElement("nav");
  nav.setAttribute("aria-label", "Settings categories");
  const body = document.createElement("div");
  body.className = "settings-body";
  const filter = document.createElement("input");
  filter.className = "settings-filter";
  filter.type = "search";
  filter.placeholder = "Search settings…";
  filter.setAttribute("aria-label", "Search settings");
  const panel = document.createElement("div");
  panel.className = "settings-content";
  const empty = document.createElement("p");
  empty.className = "settings-hint";
  empty.textContent = "No settings match.";
  empty.hidden = true;
  body.append(filter, panel, empty);
  root.append(nav, body);

  const categories = new Map<string, { button: HTMLButtonElement; section: HTMLElement }>();
  let current = options.section ?? "appearance";
  let bindings = { ...preferences.shortcuts };
  let record: HTMLButtonElement | null = null;
  const keyButtons = new Map<string, HTMLButtonElement>();
  const keyStatus = document.createElement("p");
  keyStatus.className = "settings-hint";
  keyStatus.textContent = "Select a shortcut to record a new key combination.";
  keyStatus.setAttribute("aria-live", "polite");

  function category(id: string, label: string, symbol: Icon, contents: HTMLElement[]) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "settings-nav-button";
    button.innerHTML = icon(symbol);
    button.append(label);
    button.addEventListener("click", () => { current = id; filter.value = ""; updateFilter(); });
    const section = document.createElement("section");
    section.className = "settings-category";
    const heading = document.createElement("h3");
    heading.textContent = label;
    section.append(heading, ...contents);
    categories.set(id, { button, section });
    nav.append(button);
    panel.append(section);
  }

  category("appearance", "Appearance", "columns2", [appearanceChoices(preferences.appearance)]);
  category("editor", "Editor", "fileCode", [
    select("Keymap", "keymap", [["standard", "Standard"], ["vim", "Vim"]], preferences.vimMode ? "vim" : "standard"),
    select("Editor font", "font", [["plex", "IBM Plex Mono"], ["system", "System monospace"]], preferences.editorFont),
    select("Text size", "size", Array.from({ length: 12 }, (_, index) => [String(index + 11), `${index + 11} px`]), String(preferences.editorSize)),
    select("Line spacing", "spacing", [["1.4", "Compact"], ["1.65", "Standard"], ["1.85", "Relaxed"]], String(preferences.lineHeight)),
    select("Indentation", "tab-size", [["2", "2 spaces"], ["4", "4 spaces"], ["8", "8 spaces"]], String(preferences.tabSize)),
    select("Line numbers", "line-numbers", [["absolute", "Absolute"], ["relative", "Relative"], ["off", "Off"]], preferences.lineNumberMode),
    preferencesCheckbox("Wrap long lines", "lineWrapping", preferences.lineWrapping),
    preferencesCheckbox("Highlight active line", "activeLine", preferences.activeLine),
    preferencesCheckbox("Auto-close brackets", "autoCloseBrackets", preferences.autoCloseBrackets),
  ]);
  category("build", "Build", "play", [
    preferencesCheckbox("Compile automatically after edits", "autoCompile", preferences.autoCompile),
    select("Delay after typing", "build-delay", [["600", "0.6 seconds"], ["1000", "1 second"], ["1600", "1.6 seconds"]], String(preferences.compileDelay)),
  ]);

  function showBinding(command: string, button: HTMLButtonElement) {
    button.textContent = displayShortcut(resolveShortcut(command, bindings), options.mac);
  }
  function finishRecording() {
    if (!record) return;
    record.classList.remove("recording");
    showBinding(record.dataset.command!, record);
    record = null;
    options.capture(false);
  }

  const shortcuts = document.createElement("div");
  shortcuts.className = "settings-keymap";
  for (const [group, commands] of shortcutGroups) {
    const heading = document.createElement("h4");
    heading.textContent = group;
    shortcuts.append(heading);
    for (const [command, title] of commands) {
      const row = document.createElement("div");
      row.className = "keymap-row";
      row.dataset.setting = title;
      const name = document.createElement("span");
      name.textContent = title;
      row.append(name);
      if (customCommands.has(command)) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "keycap";
        button.dataset.command = command;
        button.setAttribute("aria-label", `Change shortcut for ${title}`);
        showBinding(command, button);
        keyButtons.set(command, button);
        button.addEventListener("click", () => {
          if (record === button) { finishRecording(); return; }
          finishRecording();
          record = button;
          button.classList.add("recording");
          button.textContent = "Press keys…";
          options.capture(true);
        });
        button.addEventListener("blur", () => { if (record === button) finishRecording(); });
        button.addEventListener("keydown", event => {
          if (record !== button) return;
          event.preventDefault();
          event.stopPropagation();
          if (event.key === "Escape") { finishRecording(); return; }
          const accelerator = acceleratorFor(event, options.mac);
          if (!accelerator) return;
          try {
            bindings = validateShortcuts({ ...bindings, [command]: accelerator }, options.mac);
            keyStatus.textContent = `${title} shortcut updated.`;
            finishRecording();
          } catch (error) {
            keyStatus.textContent = (error as Error).message;
          }
        });
        row.append(button);
      } else {
        const key = document.createElement("kbd");
        key.textContent = displayShortcut(resolveShortcut(command, bindings), options.mac);
        row.append(key);
      }
      shortcuts.append(row);
    }
  }
  const reset = document.createElement("button");
  reset.type = "button";
  reset.className = "text-link";
  reset.textContent = "Restore default shortcuts";
  reset.addEventListener("click", () => {
    finishRecording();
    bindings = {};
    keyButtons.forEach((button, command) => showBinding(command, button));
    keyStatus.textContent = "Default shortcuts restored.";
  });
  category("shortcuts", "Shortcuts", "list", [keyStatus, shortcuts, reset]);

  const integrations = ([["MCP for AI", options.mcp], ["Overleaf connection", options.connection]] as const)
    .flatMap(([title, callback]) => {
      if (!callback) return [];
      const button = document.createElement("button");
      button.type = "button";
      button.className = "secondary-button settings-integration";
      button.textContent = title;
      button.addEventListener("click", callback);
      return [button];
    });
  if (integrations.length) category("integrations", "Integrations", "cloud", integrations);

  function updateFilter() {
    const query = filter.value.trim().toLocaleLowerCase();
    let visible = false;
    for (const [id, item] of categories) {
      const wholeSection = !query || item.button.textContent.toLocaleLowerCase().includes(query);
      const options = [...item.section.children].slice(1);
      for (const child of options) {
        const element = child as HTMLElement;
        if (element === shortcuts) {
          const rows = [...shortcuts.querySelectorAll<HTMLElement>(".keymap-row")];
          let group: HTMLElement | null = null;
          for (const row of rows) {
            if (row.previousElementSibling?.tagName === "H4") {
              group = row.previousElementSibling as HTMLElement;
              group.hidden = true;
            }
            row.hidden = !wholeSection && !row.textContent.toLocaleLowerCase().includes(query);
            if (!row.hidden && group) group.hidden = false;
          }
          element.hidden = !rows.some(row => !row.hidden);
        } else {
          element.hidden = !wholeSection && !element.textContent.toLocaleLowerCase().includes(query);
        }
      }
      const selected = id === current;
      item.button.classList.toggle("selected", selected);
      item.button.setAttribute("aria-current", selected ? "page" : "false");
      item.section.hidden = query ? !options.some(child => !(child as HTMLElement).hidden) : !selected;
      visible ||= !item.section.hidden;
    }
    empty.hidden = visible;
  }
  filter.addEventListener("input", updateFilter);
  if (!categories.has(current)) current = "appearance";
  updateFilter();

  return {
    root, filter, finishRecording,
    collect(data: FormData): Preferences {
      return {
        appearance: value(data, "appearance") as Appearance,
        editorSize: Number(value(data, "size")),
        tabSize: Number(value(data, "tab-size")) as Preferences["tabSize"],
        lineNumberMode: value(data, "line-numbers") as Preferences["lineNumberMode"],
        lineWrapping: data.has("lineWrapping"),
        autoCompile: data.has("autoCompile"),
        compileDelay: Number(value(data, "build-delay")) as Preferences["compileDelay"],
        vimMode: value(data, "keymap") === "vim",
        editorFont: value(data, "font") as Preferences["editorFont"],
        lineHeight: Number(value(data, "spacing")) as Preferences["lineHeight"],
        autoCloseBrackets: data.has("autoCloseBrackets"),
        activeLine: data.has("activeLine"),
        shortcuts: bindings,
      };
    },
  };
}
