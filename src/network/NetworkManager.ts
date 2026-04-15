import Phaser from 'phaser';

export interface RoomPlayer {
  id: string;
  name: string;
  team: number;
  ready: boolean;
  shipId: string;
}

export interface RoomData {
  id: string;
  hostId: string;
  state: 'waiting' | 'playing';
  seed: number;
  players: RoomPlayer[];
}

export interface RoomSummary {
  id: string;
  hostName: string;
  playerCount: number;
  maxPlayers: number;
}

export interface RemotePlayerState {
  x: number;
  y: number;
  heading: number;
  throttle: number;
  hp: number;
  maxHp: number;
  weapons: string[];
}

class NetworkManagerClass extends Phaser.Events.EventEmitter {
  private ws: WebSocket | null = null;
  public connected: boolean = false;
  public playerId: string = '';
  public room: RoomData | null = null;
  public playerName: string = '';

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.connected && this.ws?.readyState === WebSocket.OPEN) {
        resolve();
        return;
      }

      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const url = `${proto}://${location.host}/game-ws`;
      this.ws = new WebSocket(url);

      const timeout = setTimeout(() => {
        reject(new Error('Connection timeout'));
      }, 5000);

      this.ws.onopen = () => {
        this.connected = true;
        clearTimeout(timeout);
        // Wait for 'connected' message before resolving
      };

      this.ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === 'connected') {
            this.playerId = msg.playerId;
            clearTimeout(timeout);
            resolve();
          }
          this.handleMessage(msg);
        } catch (err) {
          console.error('Bad message:', err);
        }
      };

      this.ws.onclose = () => {
        this.connected = false;
        this.emit('disconnected');
      };

      this.ws.onerror = (e) => {
        clearTimeout(timeout);
        this.connected = false;
        reject(e);
      };
    });
  }

  private handleMessage(msg: any) {
    switch (msg.type) {
      case 'connected':
        this.emit('ready');
        break;
      case 'room_joined':
        this.room = msg.room;
        this.emit('room_joined', msg.room);
        break;
      case 'room_update':
        this.room = msg.room;
        this.emit('room_update', msg.room);
        break;
      case 'join_failed':
        this.emit('join_failed', msg.reason);
        break;
      case 'game_started':
        this.room = msg.room;
        this.emit('game_started', msg.room);
        break;
      case 'remote_player_state':
        this.emit('remote_player_state', msg.playerId, msg.state);
        break;
      case 'remote_player_action':
        this.emit('remote_player_action', msg.playerId, msg.action);
        break;
      case 'room_list':
        this.emit('room_list', msg.rooms);
        break;
      case 'player_left':
        this.room = msg.room;
        this.emit('player_left', msg.playerId, msg.room);
        break;
    }
  }

  send(msg: any): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  createRoom(name: string): void {
    this.playerName = name;
    this.send({ type: 'create_room', name });
  }

  joinRoom(roomId: string, name: string): void {
    this.playerName = name;
    this.send({ type: 'join_room', roomId, name });
  }

  listRooms(): void {
    this.send({ type: 'list_rooms' });
  }

  leaveRoom(): void {
    this.send({ type: 'leave_room' });
    this.room = null;
  }

  setTeam(team: number): void {
    this.send({ type: 'set_team', team });
  }

  setShip(shipId: string): void {
    this.send({ type: 'set_ship', shipId });
  }

  setReady(ready: boolean): void {
    this.send({ type: 'set_ready', ready });
  }

  startGame(): void {
    this.send({ type: 'start_game' });
  }

  sendPlayerState(state: RemotePlayerState): void {
    this.send({ type: 'player_state', state });
  }

  sendPlayerAction(action: any): void {
    this.send({ type: 'player_action', action });
  }

  isHost(): boolean {
    return this.room?.hostId === this.playerId;
  }

  getMe(): RoomPlayer | undefined {
    return this.room?.players.find(p => p.id === this.playerId);
  }
}

export const NetworkManager = new NetworkManagerClass();
