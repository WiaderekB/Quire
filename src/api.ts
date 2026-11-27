import type { TemplateId } from "../desktop/templates.mjs";
import type { Heading, SourceLocation, SymbolLocation } from "../desktop/latex-symbols.mjs";

export type Engine = "pdflatex" | "xelatex" | "lualatex";
export type Project = {
  id: string;
  name: string;
  root: string;
  main: string | null;
  engine: Engine;
  connection: { url: string; web: string; auto: boolean } | null;
};
export type ProjectFile = { path: string; editable: boolean; stamp: string };
export type Workspace = {
  project: Project | null; files: ProjectFile[]; recent: Project[]; folders?: string[];
  preview?: Uint8Array; previewStale?: boolean; syncAvailable?: boolean; issues?: BuildIssue[];
};
export type Source = { text: string; version: string };
export type Appearance = "system" | "light" | "dark";
export type Preferences = {
  appearance: Appearance;
  editorSize: number;
  tabSize: 2 | 4 | 8;
  lineNumberMode: "off" | "absolute" | "relative";
  lineWrapping: boolean;
  autoCompile: boolean;
  compileDelay: 600 | 1000 | 1600;
  vimMode: boolean;
  editorFont: "plex" | "system";
  lineHeight: 1.4 | 1.65 | 1.85;
  autoCloseBrackets: boolean;
  activeLine: boolean;
  shortcuts: Record<string, string>;
};
export const defaultPreferences: Preferences = {
  appearance: "system", editorSize: 14, tabSize: 2, lineNumberMode: "absolute", lineWrapping: true,
  autoCompile: false, compileDelay: 1000, vimMode: false, editorFont: "plex", lineHeight: 1.65,
  autoCloseBrackets: true, activeLine: true, shortcuts: {},
};
export type BuildIssue = { path: string; line: number | null; severity: "error" | "warning"; message: string };
export type BuildResult =
  ({ ok: true; bytes: Uint8Array; name: string } | { ok: false; message: string }) &
  { log: string; issues: BuildIssue[]; syncAvailable: boolean };
export type ProjectSymbols = { outline: Heading[]; labels: SymbolLocation[]; citations: SymbolLocation[] };
export type ProjectMatch = SourceLocation & { excerpt: string; offset: number; length: number };
export type PdfPoint = { page: number; x: number; y: number };
export type PdfLocation = PdfPoint & { width: number; height: number };
export type ImportedFiles = { workspace: Workspace; added: string[]; skipped: string[]; error?: string };
export type DropResult = ({ kind: "import" } & ImportedFiles) | { kind: "project"; workspace: Workspace; openFile?: string };

export interface QuireApi {
  platform: string;
  start(): Promise<Workspace & { preferences: Preferences }>;
  savePreferences(preferences: Preferences): Promise<Preferences>;
  captureShortcuts(active: boolean): Promise<void>;
  copyMcpConfig(id: string, write: boolean): Promise<void>;
  openFolder(): Promise<Workspace | null>;
  selectProject(id: string): Promise<Workspace>;
  newProject(details: {
    name: string; title: string; author: string; course: string; template: TemplateId;
  }): Promise<Workspace>;
  connect(link: string, token: string, name: string): Promise<Workspace>;
  configureConnection(id: string, token: string, auto: boolean): Promise<Project>;
  openOverleaf(id: string): Promise<void>;
  reveal(id: string, relative?: string): Promise<void>;
  refresh(id: string): Promise<Workspace>;
  projectSymbols(id: string): Promise<ProjectSymbols>;
  searchProject(id: string, query: string, options: { caseSensitive: boolean; wholeWord: boolean }): Promise<{ matches: ProjectMatch[]; truncated: boolean }>;
  read(id: string, relative: string): Promise<Source>;
  save(id: string, relative: string, contents: string, version: string): Promise<string>;
  recoverSource(id: string, relative: string, contents: string, reason: string): Promise<boolean>;
  createFile(id: string, relative: string): Promise<Workspace>;
  createFolder(id: string, parent: string, name: string): Promise<Workspace>;
  moveEntry(id: string, from: string, to: string): Promise<Workspace>;
  trashEntry(id: string, relative: string): Promise<Workspace | null>;
  importFiles(id: string, folder: string): Promise<ImportedFiles | null>;
  dropFiles(id: string | undefined, folder: string, files: File[]): Promise<DropResult | null>;
  configureBuild(id: string, relative: string, engine: Engine): Promise<Project>;
  fetch(id: string): Promise<void>;
  integrate(id: string): Promise<{ conflicts: string[]; changed: boolean; needsPush: boolean }>;
  push(id: string): Promise<void>;
  build(id: string): Promise<BuildResult>;
  syncToPdf(id: string, relative: string, line: number, column: number): Promise<PdfLocation | null>;
  syncToSource(id: string, page: number, x: number, y: number): Promise<SourceLocation | null>;
  exportPdf(id: string): Promise<boolean>;
  close(confirm: boolean): Promise<void>;
  onCommand(callback: (name: string) => void): void;
  onPrepareClose(callback: () => void): void;
}

export const api = (window as Window & { quire?: QuireApi }).quire!;
