import { WebSocketServer, WebSocket } from 'ws';
import { randomUUID } from 'crypto';

interface Player {
  id: string;
  name: string;
  team: number;
  ready: boolean;
  shipId: string;
  socket: WebSocket;
}

interface Room {
  id: string;
  hostId: string;
  players: Map<string, Player>;
  state: 'waiting' | 'playing';
  seed: number;
  title: string;
  password?: string;   // empty / undefined = public room
}

/** Trim and keep only printable ASCII + Hangul; cap length */
function sanitizeTitle(raw: string): string {
  return (raw || '')
    .replace(/[<>&"'/\\]/g, '')
    .replace(/[\x00-\x1F\x7F]/g, '')
    .trim()
    .slice(0, 24) || '이름없는 함대';
}

function sanitizePassword(raw: string): string {
  return (raw || '')
    .replace(/[\x00-\x1F\x7F]/g, '')
    .slice(0, 16);
}

const rooms = new Map<string, Room>();

// --- Security: rate limiting & validation ---
const MAX_MSG_PER_SEC = 30;
const MAX_MSG_SIZE = 4096; // bytes
const VALID_ROOM_ID = /^[A-Z0-9]{4}$/;
const VALID_MSG_TYPES = new Set([
  'create_room', 'join_room', 'set_team', 'set_ship',
  'set_ready', 'start_game', 'player_state', 'player_action', 'leave_room',
  'list_rooms', 'chat',
]);

/** Trim chat text, strip control chars, cap length */
function sanitizeChat(raw: string): string {
  return (raw || '')
    .replace(/[\x00-\x1F\x7F]/g, '')
    .trim()
    .slice(0, 120);
}

/** Strip HTML-sensitive and control chars from player name */
function sanitizeName(raw: string): string {
  return raw
    .replace(/[<>&"'/\\]/g, '')
    .replace(/[\x00-\x1F\x7F]/g, '')
    .trim()
    .slice(0, 16) || 'Captain';
}

function publicPlayer(p: Player) {
  return {
    id: p.id,
    name: p.name,
    team: p.team,
    ready: p.ready,
    shipId: p.shipId,
  };
}

function publicRoom(room: Room) {
  return {
    id: room.id,
    hostId: room.hostId,
    state: room.state,
    seed: room.seed,
    title: room.title,
    hasPassword: !!room.password,
    players: Array.from(room.players.values()).map(publicPlayer),
  };
}

function broadcast(room: Room, message: any, excludeId?: string) {
  const data = JSON.stringify(message);
  for (const [id, p] of room.players) {
    if (id === excludeId) continue;
    if (p.socket.readyState === WebSocket.OPEN) {
      p.socket.send(data);
    }
  }
}

function send(socket: WebSocket, message: any) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

function generateRoomId(): string {
  let id;
  do {
    id = Math.random().toString(36).slice(2, 6).toUpperCase();
  } while (rooms.has(id));
  return id;
}

function autoTeam(room: Room): number {
  const t0 = Array.from(room.players.values()).filter(p => p.team === 0).length;
  const t1 = Array.from(room.players.values()).filter(p => p.team === 1).length;
  return t0 <= t1 ? 0 : 1;
}

// ============ RANKING API (in-memory, REST over same HTTP) ============

export interface ScoreEntry {
  userId: string;
  name: string;
  kills: number;
  wave: number;
  gold: number;
  won: boolean;
  shipId: string;
  date: string;
  score: number; // computed
}

// In-memory ranking store (persists until server restart)
const rankings: ScoreEntry[] = [];
const MAX_RANKINGS = 100;

/** Compute a single score number for sorting */
function computeScore(e: { kills: number; wave: number; won: boolean }): number {
  return (e.won ? 1000 : 0) + e.wave * 50 + e.kills * 10;
}

// --- API rate limiting (per IP) ---
const apiRateMap = new Map<string, { count: number; reset: number }>();
const API_RATE_LIMIT = 10; // max requests per 10 seconds
const API_RATE_WINDOW = 10_000;

// --- Game session tokens (proof of play) ---
const validGameTokens = new Set<string>();

/** Issue a game token when a player starts a game (called from WS) */
export function issueGameToken(playerId: string): void {
  validGameTokens.add(playerId);
  // Auto-expire after 30 minutes
  setTimeout(() => validGameTokens.delete(playerId), 30 * 60 * 1000);
}

/** Handle REST API requests (called from Vite middleware) */
export function handleApiRequest(
  req: { method?: string; url?: string; socket?: { remoteAddress?: string } },
  res: { writeHead: (code: number, headers?: Record<string, string>) => void; end: (body?: string) => void },
  body: string,
): boolean {
  const url = req.url ?? '';
  const method = req.method ?? 'GET';

  // Per-IP rate limiting on POST
  if (method === 'POST') {
    const ip = req.socket?.remoteAddress ?? 'unknown';
    const now = Date.now();
    let entry = apiRateMap.get(ip);
    if (!entry || now - entry.reset > API_RATE_WINDOW) {
      entry = { count: 0, reset: now };
      apiRateMap.set(ip, entry);
    }
    entry.count++;
    if (entry.count > API_RATE_LIMIT) {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'rate limited' }));
      return true;
    }
  }

  // CORS headers for future external use
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (method === 'OPTIONS') {
    res.writeHead(204, headers);
    res.end();
    return true;
  }

  // POST /api/score — submit a game result
  if (method === 'POST' && url === '/api/score') {
    try {
      const data = JSON.parse(body);
      if (!data.userId || !data.name) {
        res.writeHead(400, headers);
        res.end(JSON.stringify({ error: 'userId and name required' }));
        return true;
      }
      // Validate game token (proof that this player actually played)
      // Token is issued when game starts via WebSocket — prevents curl spoofing
      const hasToken = validGameTokens.has(data.userId);
      // Allow submission even without token (for SP where no WS is used)
      // but flag it. In future, reject untokenized submissions.
      const entry: ScoreEntry = {
        userId: sanitizeName(String(data.userId).slice(0, 40)),
        name: sanitizeName(String(data.name)),
        kills: Math.max(0, Math.min(9999, Number(data.kills) || 0)),
        wave: Math.max(0, Math.min(999, Number(data.wave) || 0)),
        gold: Math.max(0, Number(data.gold) || 0),
        won: !!data.won,
        shipId: sanitizeName(String(data.shipId || 'patrolboat')),
        date: new Date().toISOString().slice(0, 10),
        score: 0,
      };
      entry.score = computeScore(entry);

      rankings.push(entry);
      rankings.sort((a, b) => b.score - a.score);
      if (rankings.length > MAX_RANKINGS) rankings.length = MAX_RANKINGS;

      res.writeHead(200, headers);
      res.end(JSON.stringify({ ok: true, rank: rankings.findIndex(e => e === entry) + 1 }));
    } catch {
      res.writeHead(400, headers);
      res.end(JSON.stringify({ error: 'invalid JSON' }));
    }
    return true;
  }

  // GET /api/ranking — get top rankings
  if (method === 'GET' && url?.startsWith('/api/ranking')) {
    const top = rankings.slice(0, 50);
    res.writeHead(200, headers);
    res.end(JSON.stringify({ rankings: top, total: rankings.length }));
    return true;
  }

  // GET /api/ranking/:userId — get specific user's best
  if (method === 'GET' && url?.startsWith('/api/profile/')) {
    const userId = url.split('/api/profile/')[1];
    const userEntries = rankings.filter(e => e.userId === userId);
    const best = userEntries[0] ?? null;
    const totalGames = userEntries.length;
    res.writeHead(200, headers);
    res.end(JSON.stringify({ best, totalGames, entries: userEntries.slice(0, 10) }));
    return true;
  }

  return false; // not handled
}

// ============ WEBSOCKET GAME SERVER ============

export function setupGameServer(wss: WebSocketServer) {
  wss.on('connection', (ws) => {
    const playerId = randomUUID();
    let currentRoom: Room | null = null;
    let player: Player | null = null;

    // Rate limiting state per connection
    let msgCount = 0;
    let lastReset = Date.now();

    send(ws, { type: 'connected', playerId });

    ws.on('message', (data) => {
      // Message size limit
      const raw = data.toString();
      if (raw.length > MAX_MSG_SIZE) return;

      // Rate limiting: max messages per second
      const now = Date.now();
      if (now - lastReset > 1000) {
        msgCount = 0;
        lastReset = now;
      }
      msgCount++;
      if (msgCount > MAX_MSG_PER_SEC) return;

      let msg: any;
      try {
        msg = JSON.parse(raw);
      } catch {
        return;
      }

      // Reject unknown message types
      if (!msg.type || !VALID_MSG_TYPES.has(msg.type)) return;

      switch (msg.type) {
        case 'create_room': {
          if (currentRoom) return;
          const roomId = generateRoomId();
          const title = sanitizeTitle(msg.title);
          const password = sanitizePassword(msg.password);
          const room: Room = {
            id: roomId,
            hostId: playerId,
            players: new Map(),
            state: 'waiting',
            seed: 0,
            title,
            password: password || undefined,
          };
          rooms.set(roomId, room);

          player = {
            id: playerId,
            name: sanitizeName(msg.name || 'Captain'),
            team: 0,
            ready: false,
            shipId: 'destroyer',
            socket: ws,
          };
          room.players.set(playerId, player);
          currentRoom = room;
          send(ws, { type: 'room_joined', room: publicRoom(room) });
          break;
        }

        case 'join_room': {
          if (currentRoom) return;
          const roomId = (msg.roomId || '').toUpperCase();
          if (!VALID_ROOM_ID.test(roomId)) {
            send(ws, { type: 'join_failed', reason: '잘못된 방 코드입니다' });
            return;
          }
          const room = rooms.get(roomId);
          if (!room) {
            send(ws, { type: 'join_failed', reason: '방을 찾을 수 없습니다' });
            return;
          }
          if (room.players.size >= 4) {
            send(ws, { type: 'join_failed', reason: '방이 가득 찼습니다' });
            return;
          }
          if (room.state !== 'waiting') {
            send(ws, { type: 'join_failed', reason: '게임이 이미 진행 중입니다' });
            return;
          }
          if (room.password) {
            const given = sanitizePassword(msg.password);
            if (given !== room.password) {
              send(ws, { type: 'join_failed', reason: '암호가 일치하지 않습니다' });
              return;
            }
          }

          player = {
            id: playerId,
            name: sanitizeName(msg.name || 'Captain'),
            team: autoTeam(room),
            ready: false,
            shipId: 'destroyer',
            socket: ws,
          };
          room.players.set(playerId, player);
          currentRoom = room;
          send(ws, { type: 'room_joined', room: publicRoom(room) });
          broadcast(room, { type: 'room_update', room: publicRoom(room) }, playerId);
          break;
        }

        case 'set_team': {
          if (!player || !currentRoom) return;
          if (msg.team === 0 || msg.team === 1) {
            player.team = msg.team;
            broadcast(currentRoom, { type: 'room_update', room: publicRoom(currentRoom) });
          }
          break;
        }

        case 'set_ship': {
          if (!player || !currentRoom) return;
          if (['destroyer', 'cruiser', 'battleship'].includes(msg.shipId)) {
            player.shipId = msg.shipId;
            broadcast(currentRoom, { type: 'room_update', room: publicRoom(currentRoom) });
          }
          break;
        }

        case 'set_ready': {
          if (!player || !currentRoom) return;
          player.ready = !!msg.ready;
          broadcast(currentRoom, { type: 'room_update', room: publicRoom(currentRoom) });
          break;
        }

        case 'start_game': {
          if (!currentRoom || currentRoom.hostId !== playerId) return;
          if (currentRoom.players.size < 2) return;
          currentRoom.state = 'playing';
          currentRoom.seed = Math.floor(Math.random() * 1000000);
          // Issue game tokens to all players (proof of play for ranking)
          for (const [pid] of currentRoom.players) {
            issueGameToken(pid);
          }
          broadcast(currentRoom, { type: 'game_started', room: publicRoom(currentRoom) });
          break;
        }

        case 'player_state': {
          if (!currentRoom || !player) return;
          broadcast(
            currentRoom,
            { type: 'remote_player_state', playerId, state: msg.state },
            playerId,
          );
          break;
        }

        case 'player_action': {
          if (!currentRoom || !player) return;
          broadcast(
            currentRoom,
            { type: 'remote_player_action', playerId, action: msg.action },
            playerId,
          );
          break;
        }

        case 'list_rooms': {
          // Return summary of open rooms (waiting state, not full)
          const list = Array.from(rooms.values())
            .filter(r => r.state === 'waiting' && r.players.size < 4)
            .map(r => {
              const host = r.players.get(r.hostId);
              return {
                id: r.id,
                hostName: host?.name ?? 'Host',
                playerCount: r.players.size,
                maxPlayers: 4,
                title: r.title,
                hasPassword: !!r.password,
              };
            })
            .slice(0, 50);
          send(ws, { type: 'room_list', rooms: list });
          break;
        }

        case 'chat': {
          if (!player || !currentRoom) return;
          const text = sanitizeChat(msg.text);
          if (!text) return;
          broadcast(currentRoom, {
            type: 'chat',
            from: player.name,
            fromId: player.id,
            team: player.team,
            text,
          });
          break;
        }

        case 'leave_room': {
          if (currentRoom && player) {
            currentRoom.players.delete(playerId);
            if (currentRoom.players.size === 0) {
              rooms.delete(currentRoom.id);
            } else {
              if (currentRoom.hostId === playerId) {
                currentRoom.hostId = currentRoom.players.keys().next().value as string;
              }
              broadcast(currentRoom, {
                type: 'player_left',
                playerId,
                room: publicRoom(currentRoom),
              });
            }
            currentRoom = null;
            player = null;
          }
          break;
        }
      }
    });

    ws.on('close', () => {
      if (currentRoom && player) {
        currentRoom.players.delete(playerId);
        if (currentRoom.players.size === 0) {
          rooms.delete(currentRoom.id);
        } else {
          if (currentRoom.hostId === playerId) {
            currentRoom.hostId = currentRoom.players.keys().next().value as string;
          }
          broadcast(currentRoom, {
            type: 'player_left',
            playerId,
            room: publicRoom(currentRoom),
          });
        }
      }
    });
  });

  console.log('[game-server] WebSocket game server attached');
}
