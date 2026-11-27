# Quire user guide

## Working in the editor

**Compile** uses pdfLaTeX by default. Open the arrow next to it to choose the main document, XeLaTeX, or LuaLaTeX. If the source or compiler settings change, compile again before exporting from the PDF toolbar. Build outputs stay outside the source folder until you export them.

Open **Settings** to search Appearance, Editor, Build, and Shortcuts. The editor supports two fonts, three line spacings, absolute or relative line numbers, soft wrapping, and configurable indentation. To change a shortcut, select the key combination next to its action in **Settings → Shortcuts** and press the replacement.

Use **Quick Open** to switch projects, find recent files, or execute a command. Enter `>` for commands or `@` for the project outline. **Search Project** finds literal text across visible source files. Select a result to open the file and place the cursor on the match.

Drag tabs to reorder them. Use a tab’s context menu to pin it and **Reopen Closed Tab** to bring it back. Drop a folder from your file manager to open a project. Drop files to copy them in, or drag a project item onto a folder to move it. File moves can require updates to LaTeX references such as `\input`.

Select a template preview when creating a project, then fill in the title, author, and course. Use the plus button above the source editor to insert a section, equation, or table. Use completion inside `\ref{}` or `\cite{}` to pick a key from the project. Hold Option or Alt and click a key to jump to its definition.

Choose **Settings → Editor → Keymap → Vim** for modal editing and relative numbers if desired. `:w` saves, `:wq` saves and closes the tab, and `:bn` or `:bp` switches tabs. **Focus Mode** hides the sidebar and preview and restores the previous layout on exit.

## Navigating the PDF

Use the split-layout button in the PDF toolbar to switch between side-by-side and stacked panels, and drag the divider to resize them. Select a page number to jump to that page. Hold Command on macOS or Control on Linux and click in the source or compiled PDF to jump to the corresponding location. This uses the `synctex` command from your TeX distribution and requires a current build.

Turn on **Compile automatically after edits** in Settings for a refreshed PDF after each pause in typing. If a build fails, your last successful PDF stays visible.

Open **Build Issues** to see errors and warnings. Selecting a located problem takes you to its line. The **Log** tab contains the compiler output.

If an external edit prevents saving, choose **Recover edits…** to save your draft to a separate file or discard it and use the disk version. You can also cancel and keep editing the draft.

| Action | macOS | Linux |
| --- | --- | --- |
| Compile | ⌘ Return | Ctrl Enter |
| Find in file | ⌘ F | Ctrl F |
| Search project | ⌘ Option F | Ctrl Alt F |
| Settings | ⌘ , | Ctrl , |
| Keyboard shortcuts | ⌘ / | Ctrl / |
| Quick open | ⌘ K | Ctrl K |
| Focus mode | ⌘ Shift F | Ctrl Shift F |
| Go to line | ⌘ L | Ctrl L |
| Insert LaTeX block | ⌘ Shift I | Ctrl Shift I |
| Open project folder | ⌘ O | Ctrl O |
| Create a file | ⌘ N | Ctrl N |
| Close tab | ⌘ W | Ctrl W |
| Reopen closed tab | ⌘ Shift T | Ctrl Shift T |
| Next or previous tab | Ctrl Tab or Ctrl Shift Tab | Ctrl Tab or Ctrl Shift Tab |
| Source, Split, or PDF | ⌘ 1, 2, or 3 | Ctrl 1, 2, or 3 |
| Toggle sidebar | ⌘ B | Ctrl B |
| Save PDF | ⌘ Shift S | Ctrl Shift S |
| Reveal source in PDF | ⌘ Option Return | Ctrl Alt Enter |
| Build Issues | ⌘ Shift M | Ctrl Shift M |
| Sync Overleaf | ⌘ Shift R | Ctrl Shift R |

## Connect an Overleaf project

1. In the Overleaf project, find **Integrations → Git** and confirm you have Git access. Create a Git authentication token in Overleaf Account Settings.
2. In Quire, choose **Connect Overleaf**. Enter a project name, the HTTPS project or Git URL, and your token.
3. Edit as usual. **Saved locally** confirms the source is on disk. **Synced with Overleaf** confirms the cloud sync completed. Quire syncs automatically after edits settle and checks for incoming changes while the project is open. Use **Sync Overleaf** to sync immediately or turn automatic sync off in **Connection settings**.

Git is required for Overleaf connections. Overleaf Cloud requires premium Git access. A self-hosted Overleaf Server Pro installation needs Git Bridge enabled. The connection uses the original project and supports both current and legacy default branch names. [Overleaf Git integration](https://docs.overleaf.com/integrations-and-add-ons/git-integration-and-github-synchronization/git-integration), [authentication tokens](https://docs.overleaf.com/integrations-and-add-ons/git-integration-and-github-synchronization/git-integration/git-integration-authentication-tokens), [Server Pro Git Bridge](https://docs.overleaf.com/on-premises/configuration/overleaf-toolkit/server-pro-only-configuration/git-integration).

Quire keeps editing and saving to disk when Overleaf is unreachable. If edits overlap, Quire stops the sync with both versions preserved. Use **Show project folder** in the project menu to open the clone and resolve the conflict with Git before retrying sync. Quire uses the system keyring for persistent token storage when available. In other sessions, enter the token again in **Connection settings**.

Automatic sync retries temporary connection failures. It syncs changes to already tracked files and adds visible project files that Git does not ignore. New hidden files, generated LaTeX files, and symbolic links stay local. Project configuration files such as `.gitignore` and `.latexmkrc` can be added.

Quire's own hosted service is planned for a later version.

## Connect an AI client over MCP

Install Node.js 24. Open a project, then choose **Settings → MCP for AI → Copy configuration**. Add the entry to the MCP configuration in your AI client. If the client cannot find `node`, set its command to the absolute path to the Node.js executable.

The configuration starts a local stdio server for the selected folder. It lets the client list visible source files and read line ranges. Check **Allow source edits** before copying the configuration to also enable revision-checked text replacements. The server edits local files. Return to the Quire window to refresh the open file, then use the usual sync controls for an Overleaf project.

Any compatible client can also launch the standalone server with this command.

```sh
node /absolute/path/to/quire-mcp.mjs --project "/absolute/path/to/latex-project"
```

Append `--write` if you want the client to be able to edit that project. The server is included in the installers and at `dist/mcp/quire-mcp.mjs` after a source build.
