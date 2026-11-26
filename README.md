# Quire

Quire is a local-first LaTeX editor for macOS and Linux. It opens ordinary folders, saves source as you type, and compiles to an in-app PDF preview. The editor includes LaTeX highlighting, command completion, snippets, file search, and a clickable outline.

## Run locally

Install Node.js 24 and pnpm 11, then run these commands.

```sh
pnpm install --frozen-lockfile
pnpm start
```

Quire opens with an editable sample paper and its PDF. Use the project name in the title bar to create a project or open an existing folder. Editing and saving work offline. To compile offline, install `latexmk` and the TeX packages your project uses. MacTeX and TeX Live both work. [MacTeX](https://tug.org/mactex/), [TeX Live](https://tug.org/texlive/).

**Compile** uses pdfLaTeX by default. The sliders above the editor let you choose the main document, XeLaTeX, or LuaLaTeX. The PDF toolbar saves a copy of the latest successful build. Build outputs stay outside the source folder until you export them.

| Action | macOS | Linux |
| --- | --- | --- |
| Compile | ⌘ Return | Ctrl Enter |
| Find in file | ⌘ F | Ctrl F |
| Open project folder | ⌘ O | Ctrl O |
| Create a file | ⌘ N | Ctrl N |

## Connect an Overleaf project

1. In the Overleaf project, find **Integrations → Git** and confirm you have Git access. Create a Git authentication token in Overleaf Account Settings.
2. In Quire, choose **Connect Overleaf**. Enter a project name, the HTTPS project or Git URL, and your token.
3. Edit as usual. **Saved locally** confirms the source is on disk. **Synced with Overleaf** confirms the cloud sync completed. Quire syncs automatically after edits settle and checks for incoming changes while the project is open. Use **Sync Overleaf** to sync immediately or turn automatic sync off in **Connection settings**.

Git is required for Overleaf connections. Overleaf Cloud requires premium Git access. A self-hosted Overleaf Server Pro installation needs Git Bridge enabled. The connection uses the original project and supports both current and legacy default branch names. [Overleaf Git integration](https://docs.overleaf.com/integrations-and-add-ons/git-integration-and-github-synchronization/git-integration), [authentication tokens](https://docs.overleaf.com/integrations-and-add-ons/git-integration-and-github-synchronization/git-integration/git-integration-authentication-tokens), [Server Pro Git Bridge](https://docs.overleaf.com/on-premises/configuration/overleaf-toolkit/server-pro-only-configuration/git-integration).

Quire keeps editing and saving to disk when Overleaf is unreachable. If edits overlap, Quire stops the sync with both versions preserved. Use **Show project folder** to open the clone and resolve the conflict with Git before retrying sync. Quire uses the system keyring for persistent token storage when available. In other sessions, enter the token again in **Connection settings**.

Quire's own hosted service is planned for a later version.

## Build and verify

```sh
pnpm build
pnpm test
```

The sync regression test uses Git and OpenSSL to run a disposable HTTPS remote. It checks authentication, publication of coauthor and local edits, and preservation of both versions when edits overlap.

These commands build local distributables.

```sh
# macOS Apple silicon developer build with an ad hoc signature
pnpm package --mac --arm64 -c.mac.identity=- -c.mac.hardenedRuntime=false

# On Linux, build an AppImage and a portable archive for the host architecture
pnpm package --linux

# Build a Linux x64 portable archive from another platform
pnpm package --linux tar.gz --x64
```

Build outputs appear in `release/`. Extract the Linux archive and run the `quire` executable inside. Public macOS distribution will need Developer ID signing and notarization.
