import { createServer } from 'http';
import { readFile, stat } from 'fs/promises';
import { extname, join, normalize, resolve } from 'path';
import { WebSocketServer } from 'ws';
import { setupGameServer, handleApiRequest } from './gameServer';

const PORT = Number(process.env.PORT) || 3000;
const DIST = resolve(process.cwd(), 'dist');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
};

async function serveStatic(urlPath: string): Promise<{ code: number; body: Buffer | string; type: string }> {
  const clean = normalize(decodeURIComponent(urlPath.split('?')[0])).replace(/^(\.\.[/\\])+/, '');
  let filePath = join(DIST, clean);
  if (!filePath.startsWith(DIST)) return { code: 403, body: 'forbidden', type: 'text/plain' };

  try {
    const s = await stat(filePath);
    if (s.isDirectory()) filePath = join(filePath, 'index.html');
  } catch {
    filePath = join(DIST, 'index.html');
  }

  try {
    const buf = await readFile(filePath);
    const type = MIME[extname(filePath).toLowerCase()] || 'application/octet-stream';
    return { code: 200, body: buf, type };
  } catch {
    try {
      const buf = await readFile(join(DIST, 'index.html'));
      return { code: 200, body: buf, type: 'text/html; charset=utf-8' };
    } catch {
      return { code: 404, body: 'not found', type: 'text/plain' };
    }
  }
}

const server = createServer((req, res) => {
  const url = req.url ?? '/';

  if (url.startsWith('/api/')) {
    let body = '';
    req.on('data', (c: Buffer) => { body += c.toString(); });
    req.on('end', () => {
      const handled = handleApiRequest(req, res as any, body);
      if (!handled) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('not found');
      }
    });
    return;
  }

  serveStatic(url).then(({ code, body, type }) => {
    res.writeHead(code, { 'Content-Type': type });
    res.end(body);
  });
});

const wss = new WebSocketServer({ noServer: true });
setupGameServer(wss);

server.on('upgrade', (req, socket, head) => {
  if (req.url === '/game-ws') {
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  } else {
    socket.destroy();
  }
});

server.listen(PORT, () => {
  console.log(`Battleship server listening on :${PORT}`);
});
