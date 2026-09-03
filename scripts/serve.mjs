import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };

createServer(async (req, res) => {
  try {
    const pathname = req.url === "/" ? "/index.html" : req.url.split("?")[0];
    const relative = normalize(pathname).replace(/^[/\\]+/, "");
    const file = join(root, relative);
    const body = await readFile(file);
    res.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}).listen(Number(process.env.PORT ?? 4173), () => {
  console.log(`fractal fixture on http://localhost:${process.env.PORT ?? 4173}`);
});
