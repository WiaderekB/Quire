export type Engine = "pdflatex" | "xelatex" | "lualatex";
export type Project = {
  id: string;
  name: string;
  root: string;
  main: string | null;
  engine: Engine;
  connection: { url: string; web: string; auto: boolean } | null;
};
export type ProjectFile = { path: string; editable: boolean };
export type Workspace = { project: Project | null; files: ProjectFile[]; recent: Project[]; preview?: Uint8Array };
export type Source = { text: string; version: string };
export type BuildResult =
  | { ok: true; bytes: Uint8Array; name: string; log: string }
  | { ok: false; message: string; log: string };

export interface QuireApi {
  platform: string;
  start(): Promise<Workspace>;
  openFolder(): Promise<Workspace | null>;
  selectProject(id: string): Promise<Workspace>;
  newProject(name: string): Promise<Workspace>;
  connect(link: string, token: string, name: string): Promise<Workspace>;
  configureConnection(id: string, token: string, auto: boolean): Promise<Project>;
  openOverleaf(id: string): Promise<void>;
  reveal(id: string, relative?: string): Promise<void>;
  refresh(id: string): Promise<Workspace>;
  read(id: string, relative: string): Promise<Source>;
  save(id: string, relative: string, contents: string, version: string): Promise<string>;
  createFile(id: string, relative: string): Promise<Workspace>;
  configureBuild(id: string, relative: string, engine: Engine): Promise<Project>;
  fetch(id: string): Promise<void>;
  integrate(id: string): Promise<{ conflicts: string[]; changed: boolean; needsPush: boolean }>;
  push(id: string): Promise<void>;
  build(id: string): Promise<BuildResult>;
  exportPdf(id: string): Promise<boolean>;
  close(confirm: boolean): Promise<void>;
  onCommand(callback: (name: string) => void): void;
  onPrepareClose(callback: () => void): void;
}

export const api = (window as Window & { quire?: QuireApi }).quire!;
