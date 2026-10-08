import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
const root = resolve(import.meta.dirname);
const files = new Set(['index.html', 'style.css', 'app.js', 'model.js', 'audio.js', 'storage.js', 'favicon.svg']);
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml' };
const port = Number(process.env.CUEMIX_PORT || 4173);
http.createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  const file = path === '/' ? 'index.html' : path.slice(1);
  if (!files.has(file)) { res.writeHead(404); res.end('Not found'); return; }
  try { const data = await readFile(resolve(root, file)); res.writeHead(200, { 'Content-Type': mime[extname(file)], 'Cache-Control': 'no-store' }); res.end(data); }
  catch { res.writeHead(500); res.end('Unable to read file'); }
}).listen(port, '127.0.0.1', () => console.log(`CueMix: http://127.0.0.1:${port}`));
