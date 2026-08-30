import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const root = process.cwd();
const port = Number(process.env.FLAMORIS_2D_PORT || 4173);
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png" };

createServer((request, response) => {
  const pathname = request.url === "/" ? "/index.html" : new URL(request.url, "http://localhost").pathname;
  const file = normalize(join(root, pathname));
  if (!file.startsWith(root)) {
    response.writeHead(403).end("Forbidden");
    return;
  }
  try {
    if (!statSync(file).isFile()) throw new Error("Not a file");
    response.writeHead(200, { "Content-Type": types[extname(file)] || "application/octet-stream" });
    createReadStream(file).pipe(response);
  } catch {
    response.writeHead(404).end("Not found");
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`FLAMORIS 2D: http://127.0.0.1:${port}`);
});
