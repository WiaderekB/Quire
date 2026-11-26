import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import {
  cloneOverleaf, fetchOverleaf, integrateOverleaf, parseOverleafLink, pushOverleaf,
} from "../desktop/overleaf.mjs";

const run = promisify(execFile);

function serveGit(root, token) {
  return async request => {
    const url = new URL(request.url, "https://localhost");
    if (request.headers.authorization !== "Basic " + Buffer.from(`git:${token}`).toString("base64")) {
      return { status: 401, headers: { "WWW-Authenticate": 'Basic realm="Test"' }, body: "" };
    }
    if (!url.pathname.startsWith("/git/123abc/")) return { status: 404, headers: {}, body: "" };
    const process = spawn("git", ["http-backend"], {
      env: {
        GIT_PROJECT_ROOT: root,
        GIT_HTTP_EXPORT_ALL: "1",
        PATH_INFO: url.pathname.slice(4),
        QUERY_STRING: url.search.slice(1),
        REQUEST_METHOD: request.method,
        CONTENT_TYPE: request.headers["content-type"] || "",
        CONTENT_LENGTH: request.headers["content-length"] || "",
        HTTP_GIT_PROTOCOL: request.headers["git-protocol"] || "",
        REMOTE_USER: "git",
      },
    });
    request.pipe(process.stdin);
    const output = [];
    for await (const chunk of process.stdout) output.push(chunk);
    const response = Buffer.concat(output);
    const separator = response.indexOf("\r\n\r\n");
    assert.ok(separator > 0, "git http-backend returned headers");
    const headers = Object.fromEntries(response.subarray(0, separator).toString().split("\r\n").map(line => {
      const boundary = line.indexOf(":");
      return [line.slice(0, boundary).toLowerCase(), line.slice(boundary + 1).trim()];
    }));
    const status = Number(headers.status?.split(" ")[0] || 200);
    delete headers.status;
    return { status, headers, body: response.subarray(separator + 4) };
  };
}

test("an authenticated Overleaf sync publishes both sides and preserves overlaps", async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "quire-sync-test-"));
  const bare = path.join(root, "123abc");
  const author = path.join(root, "author");
  const local = path.join(root, "local");
  const key = path.join(root, "key.pem");
  const cert = path.join(root, "cert.pem");
  const token = "test-token";
  const previousCa = process.env.GIT_SSL_CAINFO;
  t.after(async () => {
    if (previousCa === undefined) delete process.env.GIT_SSL_CAINFO;
    else process.env.GIT_SSL_CAINFO = previousCa;
    await rm(root, { force: true, recursive: true });
  });

  const git = async (cwd, ...args) => (await run("git", [
    "-c", "user.name=Coauthor", "-c", "user.email=coauthor@example.test", "-c", "commit.gpgsign=false",
    "-c", "core.hooksPath=/dev/null", ...args,
  ], { cwd })).stdout;
  const source = (cwd, content) => writeFile(path.join(cwd, "main.tex"), content);
  await run("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=localhost",
    "-addext", "subjectAltName=IP:127.0.0.1", "-keyout", key, "-out", cert]);
  await git(root, "init", "--bare", "-b", "master", bare);
  await git(bare, "config", "http.receivepack", "true");
  await git(root, "clone", bare, author);
  await source(author, "First paragraph.\n\nA middle paragraph.\n\nLast paragraph.\n");
  await git(author, "add", ".");
  await git(author, "commit", "-m", "Create draft");
  await git(author, "push");

  const handle = serveGit(root, token);
  const server = https.createServer({ key: await readFile(key), cert: await readFile(cert) }, (request, response) => {
    void handle(request).then(({ status, headers, body }) => {
      response.writeHead(status, headers).end(body);
    }).catch(error => response.writeHead(500).end(error.message));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => {
    server.close(resolve);
    server.closeAllConnections();
  }));
  process.env.GIT_SSL_CAINFO = cert;

  const connection = parseOverleafLink(`https://127.0.0.1:${server.address().port}/project/123abc`);
  await assert.rejects(cloneOverleaf(root, local, connection.url, "bad-token"), /denied access/);
  connection.branch = await cloneOverleaf(root, local, connection.url, token);
  assert.equal(connection.branch, "master");

  const change = async (cwd, previous, next) =>
    source(cwd, (await readFile(path.join(cwd, "main.tex"), "utf8")).replace(previous, next));

  await change(local, "First paragraph.", "Quire’s first paragraph.");
  await change(author, "Last paragraph.", "Coauthor’s last paragraph.");
  await git(author, "commit", "-am", "Edit the last paragraph");
  await git(author, "push");
  await fetchOverleaf(local, connection, token);
  assert.deepEqual(await integrateOverleaf(local, connection), { conflicts: [], changed: true, needsPush: true });
  await pushOverleaf(local, connection, token);
  const pushed = await git(bare, "show", "master:main.tex");
  assert.match(pushed, /Quire’s first paragraph/);
  assert.match(pushed, /Coauthor’s last paragraph/);

  await git(author, "pull", "--ff-only");
  await change(local, "Quire’s first paragraph.", "Second Quire draft.");
  await change(author, "Quire’s first paragraph.", "Overlapping cloud draft.");
  await git(author, "commit", "-am", "Edit the first paragraph");
  await git(author, "push");
  await fetchOverleaf(local, connection, token);
  assert.deepEqual(await integrateOverleaf(local, connection), { conflicts: ["main.tex"], changed: false, needsPush: false });
  assert.match(await readFile(path.join(local, "main.tex"), "utf8"), /Second Quire draft/);
  assert.match(await git(bare, "show", "master:main.tex"), /Overlapping cloud draft/);
  assert.equal(await git(local, "status", "--porcelain"), "");
});
