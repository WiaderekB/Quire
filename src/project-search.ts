import { api } from "./api";
import type { ProjectMatch } from "./api";

export function projectSearch(root: HTMLElement, open: (match: ProjectMatch) => void, dismiss: () => void) {
  const form = root.querySelector("form")!;
  const input = root.querySelector<HTMLInputElement>("input[type=search]")!;
  const filters = [...root.querySelectorAll<HTMLButtonElement>("[data-filter]")];
  const summary = root.querySelector<HTMLElement>(".search-summary")!;
  const results = root.querySelector<HTMLElement>(".search-results")!;
  let id: string | undefined;
  let generation = 0;
  let timer = 0;

  function clear(label: string) {
    results.replaceChildren();
    summary.textContent = label;
  }

  function schedule() {
    clearTimeout(timer);
    const revision = ++generation;
    const query = input.value;
    const current = id;
    if (!current || !query.trim()) {
      clear(current ? "Enter text to search this project." : "Open a project first.");
      return;
    }
    timer = window.setTimeout(async () => {
      clear("Searching…");
      try {
        const enabled = (name: string) => filters.find(button => button.dataset.filter === name)?.getAttribute("aria-pressed") === "true";
        const data = await api.searchProject(current, query, { caseSensitive: enabled("case"), wholeWord: enabled("word") });
        if (revision !== generation) return;
        summary.textContent = data.matches.length
          ? `${data.matches.length}${data.truncated ? "+" : ""} ${data.matches.length === 1 ? "match" : "matches"}`
          : "No matches.";
        const fragment = document.createDocumentFragment();
        let previous = "";
        for (const match of data.matches) {
          if (match.path !== previous) {
            const heading = document.createElement("h3");
            heading.title = match.path;
            heading.textContent = match.path;
            fragment.append(heading);
            previous = match.path;
          }
          const button = document.createElement("button");
          button.type = "button";
          button.className = "search-result";
          button.setAttribute("aria-label", `${match.path}, line ${match.line}: ${match.excerpt}`);
          const number = document.createElement("small");
          number.textContent = String(match.line);
          const preview = document.createElement("span");
          const hit = document.createElement("mark");
          hit.textContent = match.excerpt.slice(match.offset, match.offset + match.length);
          preview.append(match.excerpt.slice(0, match.offset), hit, match.excerpt.slice(match.offset + match.length));
          button.append(number, preview);
          button.addEventListener("click", () => open(match));
          fragment.append(button);
        }
        results.replaceChildren(fragment);
      } catch (error) {
        if (revision === generation) clear((error as Error).message);
      }
    }, 160);
  }

  input.addEventListener("input", schedule);
  filters.forEach(button => button.addEventListener("click", () => {
    button.setAttribute("aria-pressed", String(button.getAttribute("aria-pressed") !== "true"));
    schedule();
  }));
  form.addEventListener("submit", event => {
    event.preventDefault();
    results.querySelector("button")?.click();
  });
  root.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      event.preventDefault();
      dismiss();
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const buttons = [...results.querySelectorAll("button")];
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = current + (event.key === "ArrowDown" ? 1 : -1);
    if (buttons[next]) buttons[next].focus();
    else if (next < 0) input.focus();
    event.preventDefault();
  });

  return {
    open(idOfProject: string, selection?: string) {
      if (idOfProject !== id) input.value = "";
      id = idOfProject;
      if (selection && !/[\r\n]/.test(selection)) input.value = selection.slice(0, 160);
      root.hidden = false;
      input.focus();
      input.select();
      schedule();
    },
    close() { ++generation; clearTimeout(timer); root.hidden = true; },
    refresh() { if (!root.hidden && input.value) schedule(); },
  };
}
