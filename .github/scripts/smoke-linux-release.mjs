import { spawn } from "node:child_process";
import { on, once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const executable = process.argv[2];
if (!executable) throw new Error("Pass the path to the extracted Quire executable.");

const profile = await mkdtemp(path.join(tmpdir(), "quire-release-"));
const app = spawn(executable, ["--remote-debugging-port=0", `--user-data-dir=${profile}`], {
  stdio: ["ignore", "inherit", "pipe"],
});
const closed = once(app, "close").catch(() => {});
let output = "";
let launchError;
let socket;
let request = 0;
app.on("error", error => { launchError = error; });
app.stderr.on("data", chunk => {
  output = (output + chunk).slice(-16_000);
  process.stderr.write(chunk);
});

async function waitFor(check, description, timeout = 25_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (launchError) throw launchError;
    if (app.exitCode !== null || app.signalCode !== null) {
      throw new Error(`Quire exited before ${description} (${app.exitCode ?? app.signalCode}).`);
    }
    const value = await check();
    if (value) return value;
    await delay(150);
  }
  throw new Error(`Timed out waiting for ${description}.`);
}

async function evaluate(expression) {
  const id = ++request;
  const messages = on(socket, "message", { signal: AbortSignal.timeout(5_000) });
  socket.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression, returnByValue: true } }));
  for await (const [{ data }] of messages) {
    const message = JSON.parse(data);
    if (message.id !== id) continue;
    if (message.error) throw new Error(message.error.message);
    if (message.result.exceptionDetails) throw new Error(message.result.exceptionDetails.text);
    return message.result.result.value;
  }
}

try {
  const port = await waitFor(() => /DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//.exec(output)?.[1], "the DevTools port");
  const page = await waitFor(async () => {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(5_000) });
    if (!response.ok) throw new Error(`DevTools returned HTTP ${response.status}.`);
    const targets = await response.json();
    return targets.find(target => target.type === "page" && target.url === "quire://app/index.html");
  }, "the Quire window");

  socket = new WebSocket(page.webSocketDebuggerUrl);
  await once(socket, "open", { signal: AbortSignal.timeout(5_000) });
  await waitFor(() => evaluate(`
    document.querySelector("#project-name")?.textContent === "Field Notes" &&
    document.querySelector(".cm-content")?.isContentEditable &&
    !!document.querySelector(".pdf-page canvas")
  `), "the example project, editor, and PDF preview");
  console.log("Quire opened the example project with the editor and PDF preview.");

  await evaluate('document.querySelector("#build").click()');
  await waitFor(async () => {
    const status = await evaluate('document.querySelector("#build-status")?.textContent.trim()');
    if (status === "Build failed") {
      throw new Error(await evaluate('document.querySelector("#build-issues")?.textContent.trim()') || status);
    }
    return status === "PDF up to date" && await evaluate('!!document.querySelector(".textLayer span")');
  }, "a successful LaTeX build with selectable PDF text", 65_000);
  console.log("Quire compiled the example in the packaged app and rendered the new PDF.");
} finally {
  socket?.close();
  app.kill();
  await closed;
  await rm(profile, { recursive: true, force: true });
}
