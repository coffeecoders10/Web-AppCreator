// Usage: npm run fixture [-- --port 8080 --host 127.0.0.1]
// Serves tests/fixtures/navigation-site/ with the extra routes the fixture needs
// (/redirect-out, /redirect-same, /echo). This is test infrastructure inside the repository, not an
// external service. Generated apps only load HTTPS, so to try the fixture on a device, put this
// server behind an HTTPS tunnel or copy the two HTML files to any HTTPS static host.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const option = (name, fallback) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : fallback);
const port = Number(option("port", 8080));
const host = option("host", "127.0.0.1");
const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "tests", "fixtures", "navigation-site");

const files = { "/": "index.html", "/index.html": "index.html", "/page2.html": "page2.html" };

createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host}`);
  const send = (status, type, body, headers = {}) => {
    response.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store", ...headers });
    response.end(body);
  };

  if (url.pathname === "/redirect-out") return send(302, "text/plain", "", { Location: "https://example.org/" });
  if (url.pathname === "/redirect-same") return send(302, "text/plain", "", { Location: "/page2.html" });

  if (url.pathname === "/echo") {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString("utf-8").replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c]);
    return send(200, "text/html; charset=utf-8", `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><h1>Echo</h1><p>${request.method} body: <code>${body}</code></p><a href="/">Back</a>`);
  }

  const file = files[url.pathname];
  if (!file) return send(404, "text/plain", "Not found");
  send(200, "text/html; charset=utf-8", await readFile(path.join(dir, file)));
}).listen(port, host, () => console.log(`Fixture on http://${host}:${port}/ (Ctrl+C to stop)`));
