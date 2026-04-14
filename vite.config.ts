import { defineConfig } from 'vite';
import { WebSocketServer } from 'ws';
import { setupGameServer, handleApiRequest } from './server/gameServer';

const isGHPages = process.env.DEPLOY === 'gh-pages';

export default defineConfig({
  base: isGHPages ? '/battleship_v1/' : '/',
  server: {
    host: true,
    port: 3000,
  },
  plugins: [
    {
      name: 'battleship-game-server',
      configureServer(server) {
        // WebSocket for multiplayer
        const wss = new WebSocketServer({ noServer: true });
        setupGameServer(wss);

        server.httpServer?.on('upgrade', (req, socket, head) => {
          if (req.url === '/game-ws') {
            wss.handleUpgrade(req, socket, head, (ws) => {
              wss.emit('connection', ws, req);
            });
          }
        });

        // REST API for rankings (same port, no extra server)
        server.middlewares.use((req, res, next) => {
          if (req.url?.startsWith('/api/')) {
            let body = '';
            req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
            req.on('end', () => {
              const handled = handleApiRequest(req, res as any, body);
              if (!handled) next();
            });
          } else {
            next();
          }
        });
      },
    },
  ],
});
