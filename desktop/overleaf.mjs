import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

export function parseOverleafLink(input) {
  let url;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error("Paste an Overleaf project link or its Git URL.");
  }
  const parts = url.pathname.split("/").filter(Boolean);
  if (url.protocol !== "https:" || url.password || (url.username && url.username !== "git") ||
      url.search || url.hash || !/^[a-z\d]+$/i.test(parts.at(-1) ?? "")) {
    throw new Error("Use an HTTPS Overleaf project or Git URL without an embedded token.");
  }
  const cloudWeb = ["overleaf.com", "www.overleaf.com"].includes(url.host);
  const cloudGit = url.host === "git.overleaf.com";
  const projectId = parts.at(-1);
  if ((cloudWeb && parts.length === 2 && parts[0] === "project") || (cloudGit && parts.length === 1)) {
    return {
      url: `https://git.overleaf.com/${projectId}`,
      web: `https://www.overleaf.com/project/${projectId}`,
    };
  }
  if (!cloudWeb && !cloudGit && parts.length === 2 && ["project", "git"].includes(parts[0])) {
    return {
      url: `${url.origin}/git/${projectId}`,
      web: `${url.origin}/project/${projectId}`,
    };
  }
  throw new Error("Use the project URL or the HTTPS address under Integrations → Git.");
}

async function git(cwd, args, authentication) {
  const config = {
    "core.hooksPath": "/dev/null",
    "core.fsmonitor": "false",
    "core.fileMode": "false",
    "commit.gpgsign": "false",
    "user.name": "Quire",
    "user.email": "quire@users.noreply.github.com",
    "credential.helper": "",
    "http.followRedirects": "false",
    "protocol.file.allow": "never",
    "protocol.ext.allow": "never",
  };
  if (authentication) {
    config[`http.${authentication.url}.extraHeader`] =
      `Authorization: Basic ${Buffer.from(`git:${authentication.token}`).toString("base64")}`;
  }
  const entries = Object.entries(config);
  const env = {
    ...process.env,
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_SYSTEM: "/dev/null",
    GIT_CONFIG_COUNT: String(entries.length),
    GIT_TERMINAL_PROMPT: "0",
    GIT_EDITOR: "true",
    GIT_SEQUENCE_EDITOR: "true",
    LC_ALL: "C",
  };
  for (const [index, [key, value]] of entries.entries()) {
    env[`GIT_CONFIG_KEY_${index}`] = key;
    env[`GIT_CONFIG_VALUE_${index}`] = value;
  }
  try {
    const { stdout } = await run("git", args, { cwd, env, maxBuffer: 4 * 1024 * 1024, timeout: 90_000 });
    return stdout;
  } catch (error) {
    if (error.code === "ENOENT") throw new Error("Install Git to connect an Overleaf project.");
    if (error.killed || /resolve host|failed to connect|could not connect|network is unreachable/i.test(error.stderr)) {
      throw new Error("Overleaf is unreachable. Your local files are available offline.");
    }
    if (/authentication failed|terminal prompts disabled|401|403|repository .*not found/i.test(error.stderr)) {
      throw new Error("Overleaf denied access. Check the project’s Git access and your token.");
    }
    const message = error.stderr?.trim().split("\n").filter(line => !line.startsWith("hint:")).slice(-3).join("\n");
    throw new Error(message || "Git could not finish this operation.");
  }
}

export async function cloneOverleaf(root, destination, url, token) {
  await git(root, ["clone", "--no-tags", "--single-branch", "--", url, destination], { url, token });
  const branch = (await git(destination, ["symbolic-ref", "--short", "HEAD"])).trim();
  if (!branch) throw new Error("This Overleaf project has no default branch.");
  return branch;
}

export async function fetchOverleaf(root, connection, token) {
  await git(root, ["fetch", "--no-tags", "--", connection.url, `refs/heads/${connection.branch}`], {
    url: connection.url, token,
  });
}

export async function integrateOverleaf(root, connection) {
  const branch = (await git(root, ["symbolic-ref", "--short", "HEAD"])).trim();
  if (branch !== connection.branch) throw new Error(`Switch the project back to the ${connection.branch} branch to sync.`);
  await git(root, ["add", "-A", "--", "."]);
  if ((await git(root, ["status", "--porcelain=v1", "-z"])).length) {
    await git(root, ["commit", "-m", "Save edits from Quire"]);
  }
  const before = (await git(root, ["rev-parse", "HEAD"])).trim();
  try {
    await git(root, ["rebase", "--no-autostash", "--no-rebase-merges", "FETCH_HEAD"]);
  } catch (error) {
    const conflicts = (await git(root, ["diff", "--name-only", "--diff-filter=U", "-z"])).split("\0").filter(Boolean);
    if (!conflicts.length) throw error;
    await git(root, ["rebase", "--abort"]);
    return { conflicts, changed: false, needsPush: false };
  }
  const head = (await git(root, ["rev-parse", "HEAD"])).trim();
  const remote = (await git(root, ["rev-parse", "FETCH_HEAD"])).trim();
  return { conflicts: [], changed: before !== head, needsPush: head !== remote };
}

export async function pushOverleaf(root, connection, token) {
  await git(root, ["push", "--", connection.url, `HEAD:refs/heads/${connection.branch}`], {
    url: connection.url, token,
  });
}
