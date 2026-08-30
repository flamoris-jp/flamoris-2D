import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { dirname, extname, resolve, sep } from "node:path";

const require = createRequire(import.meta.url);
const root = process.cwd();
const port = Number(process.env.FLAMORIS_2D_PORT || 4173);
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png" };
const agPsdBundle = resolve(dirname(require.resolve("ag-psd")), "bundle.js");

function sendFile(file, response) {
  if (!statSync(file).isFile()) throw new Error("Not a file");
  response.writeHead(200, { "Content-Type": types[extname(file)] || "application/octet-stream" });
  createReadStream(file).pipe(response);
}

createServer((request, response) => {
  const pathname = request.url === "/" ? "/index.html" : new URL(request.url, "http://localhost").pathname;
  try {
    if (pathname === "/vendor/ag-psd.js") {
      sendFile(agPsdBundle, response);
      return;
    }

    const file = resolve(root, `.${pathname}`);
    if (file !== root && !file.startsWith(`${root}${sep}`)) {
      response.writeHead(403).end("Forbidden");
      return;
    }
    sendFile(file, response);
  } catch {
    response.writeHead(404).end("Not found");
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`FLAMORIS 2D: http://127.0.0.1:${port}`);
});
