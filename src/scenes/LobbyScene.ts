import Phaser from 'phaser';
import { NetworkManager, RoomData, RoomPlayer, RoomSummary } from '../network/NetworkManager';

type Mode = 'menu' | 'create' | 'join' | 'joinCode' | 'room' | 'connecting' | 'error';

/** Strip HTML-sensitive and control characters from user input */
function sanitize(raw: string): string {
  return raw.replace(/[<>&"'/\\]/g, '').replace(/[\x00-\x1F\x7F]/g, '').trim();
}

export class LobbyScene extends Phaser.Scene {
  private mode: Mode = 'connecting';
  private nameInput: HTMLInputElement | null = null;
  private roomInput: HTMLInputElement | null = null;
  private titleInput: HTMLInputElement | null = null;
  private statusText!: Phaser.GameObjects.Text;
  private uiObjects: Phaser.GameObjects.GameObject[] = [];
  private htmlElements: HTMLElement[] = [];
  private shutdownCalled: boolean = false;
  private roomList: RoomSummary[] = [];
  private roomListRefreshTimer: Phaser.Time.TimerEvent | null = null;
  private pendingJoinName: string = 'Captain';

  constructor() {
    super({ key: 'LobbyScene' });
  }

  create(): void {
    const w = this.scale.width;
    const h = this.scale.height;

    this.add.rectangle(w / 2, h / 2, w, h, 0x0A1628);

    // Background animated waves
    for (let i = 0; i < 5; i++) {
      const wave = this.add.graphics();
      wave.fillStyle(0x0F3250, 0.2);
      wave.fillRect(0, h * 0.3 + i * 50, w, 30);
      this.tweens.add({
        targets: wave,
        x: { from: -30, to: 30 },
        duration: 3000 + i * 400,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.InOut',
      });
    }

    // Title
    this.add.text(w / 2, 40, '⚓ MULTIPLAYER LOBBY', {
      fontSize: '24px',
      fontFamily: 'monospace',
      color: '#F5A623',
      fontStyle: 'bold',
    }).setOrigin(0.5, 0);

    // Status line
    this.statusText = this.add.text(w / 2, h - 40, '', {
      fontSize: '12px',
      fontFamily: 'monospace',
      color: '#8BA8CC',
    }).setOrigin(0.5, 0.5);

    // Back button
    this.createBackButton();

    // Always clean up on shutdown (covers both connect-success and connect-fail paths)
    this.shutdownCalled = false;
    this.events.once('shutdown', () => {
      this.shutdownCalled = true;
      this.cleanupHtml();
      NetworkManager.removeAllListeners('room_joined');
      NetworkManager.removeAllListeners('room_update');
      NetworkManager.removeAllListeners('join_failed');
      NetworkManager.removeAllListeners('game_started');
      NetworkManager.removeAllListeners('player_left');
    });

    // Connect to server
    this.setMode('connecting');
    this.setStatus('서버 연결 중...');

    NetworkManager.connect()
      .then(() => {
        if (this.shutdownCalled) return;
        this.setStatus(`연결됨 (ID: ${NetworkManager.playerId.slice(0, 6)})`);
        this.setMode('menu');
        this.setupEvents();
      })
      .catch((err) => {
        if (this.shutdownCalled) return;
        console.error(err);
        this.setStatus('서버 연결 실패');
        this.setMode('error');
      });
  }

  private setupEvents(): void {
    NetworkManager.on('room_joined', (room: RoomData) => {
      this.setMode('room');
      this.setStatus(`방 입장: ${room.id}`);
    });
    NetworkManager.on('room_update', () => {
      if (this.mode === 'room') this.renderRoom();
    });
    NetworkManager.on('join_failed', (reason: string) => {
      this.setStatus(`입장 실패: ${reason}`);
      this.setMode('menu');
    });
    NetworkManager.on('game_started', () => {
      this.cleanupHtml();
      NetworkManager.removeAllListeners('room_joined');
      NetworkManager.removeAllListeners('room_update');
      NetworkManager.removeAllListeners('join_failed');
      NetworkManager.removeAllListeners('game_started');
      NetworkManager.removeAllListeners('player_left');
      this.cameras.main.fadeOut(300);
      this.time.delayedCall(300, () => {
        this.scene.start('GameScene', { multiplayer: true });
      });
    });
    NetworkManager.on('player_left', () => {
      if (this.mode === 'room') this.renderRoom();
    });
    NetworkManager.on('room_list', (list: RoomSummary[]) => {
      this.roomList = list;
      if (this.mode === 'join') this.renderJoinList();
    });
  }

  private setStatus(text: string): void {
    this.statusText.setText(text);
  }

  private setMode(mode: Mode): void {
    this.mode = mode;
    this.clearUI();

    switch (mode) {
      case 'connecting':
      case 'error':
        // Just status text
        break;
      case 'menu':
        this.renderMenu();
        break;
      case 'create':
        this.renderCreateForm();
        break;
      case 'join':
        this.renderJoinList();
        this.startRoomListRefresh();
        break;
      case 'joinCode':
        this.renderJoinForm();
        break;
      case 'room':
        this.renderRoom();
        break;
    }
  }

  private clearUI(): void {
    for (const obj of this.uiObjects) obj.destroy();
    this.uiObjects = [];
    this.cleanupHtml();
    if (this.roomListRefreshTimer) {
      this.roomListRefreshTimer.remove(false);
      this.roomListRefreshTimer = null;
    }
  }

  private startRoomListRefresh(): void {
    NetworkManager.listRooms();
    this.roomListRefreshTimer = this.time.addEvent({
      delay: 3000,
      loop: true,
      callback: () => NetworkManager.listRooms(),
    });
  }

  private cleanupHtml(): void {
    for (const el of this.htmlElements) {
      el.parentElement?.removeChild(el);
    }
    this.htmlElements = [];
    this.nameInput = null;
    this.roomInput = null;
    this.titleInput = null;
  }

  private addUI(obj: Phaser.GameObjects.GameObject): void {
    this.uiObjects.push(obj);
  }

  // ============ MENU ============

  private renderMenu(): void {
    const w = this.scale.width;
    const h = this.scale.height;

    this.addUI(this.add.text(w / 2, h * 0.25, 'CHOOSE OPTION', {
      fontSize: '18px',
      fontFamily: 'monospace',
      color: '#E8F4FF',
    }).setOrigin(0.5));

    // Create Room button
    this.makeButton(w / 2, h * 0.4, 240, 56, 'CREATE ROOM', 0x3DC47E, () => {
      this.setMode('create');
    });

    // Join Room button
    this.makeButton(w / 2, h * 0.4 + 80, 240, 56, 'JOIN ROOM', 0x4A9ECC, () => {
      this.setMode('join');
    });
  }

  // ============ CREATE FORM ============

  private renderCreateForm(): void {
    const w = this.scale.width;
    const h = this.scale.height;

    const label = (y: number, txt: string) => this.addUI(this.add.text(w / 2, y, txt, {
      fontSize: '13px', fontFamily: 'monospace', color: '#8BA8CC',
    }).setOrigin(0.5));

    // Captain name
    label(h * 0.22, 'CAPTAIN NAME');
    this.nameInput = this.createHtmlInput(w / 2 - 120, h * 0.22 + 16, 240, 40, 'Captain', 16);

    // Room title
    label(h * 0.42, 'ROOM TITLE');
    this.titleInput = this.createHtmlInput(w / 2 - 120, h * 0.42 + 16, 240, 40, '함대 이름', 24);

    this.makeButton(w / 2, h * 0.65, 240, 56, 'CREATE', 0x3DC47E, () => {
      if (!NetworkManager.connected) {
        this.setStatus('서버 연결이 끊겼습니다. 새로고침 후 다시 시도하세요.');
        return;
      }
      const name = sanitize(this.nameInput?.value || '') || 'Captain';
      const title = sanitize(this.titleInput?.value || '') || `${name}의 방`;
      this.setStatus('방 만드는 중...');
      NetworkManager.createRoom(name, title);
      // If server doesn't answer within 5 seconds, surface an error so the
      // click doesn't look like a dead button.
      this.time.delayedCall(5000, () => {
        if (this.mode === 'create') {
          this.setStatus('서버 응답 없음 — 새로고침 후 다시 시도하세요.');
        }
      });
    });

    this.makeButton(w / 2, h * 0.65 + 70, 240, 50, 'BACK', 0x666666, () => {
      this.setMode('menu');
    });
  }

  // ============ JOIN LIST (room browser) ============

  private renderJoinList(): void {
    this.clearUIOnly();
    const w = this.scale.width;
    const h = this.scale.height;

    this.addUI(this.add.text(w / 2, h * 0.15, 'OPEN ROOMS', {
      fontSize: '18px',
      fontFamily: 'monospace',
      color: '#E8F4FF',
      fontStyle: 'bold',
    }).setOrigin(0.5));

    // Name input (persists between refreshes via pendingJoinName)
    this.addUI(this.add.text(w / 2, h * 0.15 + 28, 'YOUR NAME', {
      fontSize: '10px',
      fontFamily: 'monospace',
      color: '#8BA8CC',
    }).setOrigin(0.5));
    if (!this.nameInput) {
      this.nameInput = this.createHtmlInput(w / 2 - 100, h * 0.15 + 42, 200, 32, 'Captain', 16);
      this.nameInput.value = this.pendingJoinName;
      this.nameInput.addEventListener('input', () => {
        this.pendingJoinName = sanitize(this.nameInput?.value || '') || 'Captain';
      });
    }

    // List area
    const listX = 20;
    const listY = h * 0.30;
    const listW = w - 40;
    const listH = h * 0.50;

    const listBg = this.add.graphics();
    listBg.fillStyle(0x0E1A30, 0.9);
    listBg.fillRoundedRect(listX, listY, listW, listH, 10);
    listBg.lineStyle(2, 0x2E6DA4, 0.6);
    listBg.strokeRoundedRect(listX, listY, listW, listH, 10);
    this.addUI(listBg);

    if (this.roomList.length === 0) {
      this.addUI(this.add.text(w / 2, listY + listH / 2, '열린 방이 없습니다\n방을 만들어보세요', {
        fontSize: '13px',
        fontFamily: 'monospace',
        color: '#6A7A94',
        align: 'center',
      }).setOrigin(0.5));
    } else {
      const rowH = 46;
      const maxRows = Math.floor((listH - 20) / rowH);
      this.roomList.slice(0, maxRows).forEach((r, i) => {
        const ry = listY + 10 + i * rowH;
        const rowBg = this.add.graphics();
        rowBg.fillStyle(0x132240, 0.9);
        rowBg.fillRoundedRect(listX + 10, ry, listW - 20, rowH - 6, 6);
        rowBg.lineStyle(1, 0x2E6DA4, 0.4);
        rowBg.strokeRoundedRect(listX + 10, ry, listW - 20, rowH - 6, 6);
        this.addUI(rowBg);

        // Room code (small, top-left)
        this.addUI(this.add.text(listX + 24, ry + 6, r.id, {
          fontSize: '11px',
          fontFamily: 'monospace',
          color: '#FFD700',
          fontStyle: 'bold',
        }).setOrigin(0, 0));

        // Title (large, center-left)
        const titleText = r.title || '함대';
        this.addUI(this.add.text(listX + 70, ry + rowH / 2 - 3, titleText, {
          fontSize: '14px',
          fontFamily: 'monospace',
          color: '#E8F4FF',
          fontStyle: 'bold',
        }).setOrigin(0, 0.5));

        // Host name (small, below title)
        this.addUI(this.add.text(listX + 70, ry + rowH - 12, `★ ${r.hostName}`, {
          fontSize: '10px',
          fontFamily: 'monospace',
          color: '#8BA8CC',
        }).setOrigin(0, 0.5));

        // Player count
        const pcColor = r.playerCount >= r.maxPlayers ? '#CC4A4A' : '#3DC47E';
        this.addUI(this.add.text(listX + listW - 100, ry + rowH / 2 - 3,
          `${r.playerCount}/${r.maxPlayers}`, {
          fontSize: '13px',
          fontFamily: 'monospace',
          color: pcColor,
          fontStyle: 'bold',
        }).setOrigin(0, 0.5));

        // Join button
        const btnX = listX + listW - 50;
        const btnY = ry + rowH / 2 - 3;
        const bg = this.add.graphics();
        bg.fillStyle(0x4A9ECC, 1);
        bg.fillRoundedRect(btnX - 24, btnY - 12, 48, 24, 5);
        this.addUI(bg);
        this.addUI(this.add.text(btnX, btnY, 'JOIN', {
          fontSize: '11px',
          fontFamily: 'monospace',
          color: '#FFFFFF',
          fontStyle: 'bold',
        }).setOrigin(0.5));

        const hit = this.add.rectangle(listX + 10, ry, listW - 20, rowH - 6, 0, 0)
          .setOrigin(0, 0)
          .setInteractive({ useHandCursor: true });
        hit.on('pointerdown', () => {
          const name = sanitize(this.nameInput?.value || '') || 'Captain';
          NetworkManager.joinRoom(r.id, name);
        });
        this.addUI(hit);
      });
    }

    // Bottom buttons: Refresh, Join by code, Back
    const btnY = h * 0.30 + h * 0.50 + 30;
    this.makeButton(w / 2 - 120, btnY, 100, 44, '↻ REFRESH', 0x2E6DA4, () => {
      NetworkManager.listRooms();
    });
    this.makeButton(w / 2, btnY, 120, 44, 'CODE...', 0x666666, () => {
      this.setMode('joinCode');
    });
    this.makeButton(w / 2 + 120, btnY, 100, 44, 'BACK', 0x444444, () => {
      this.setMode('menu');
    });
  }

  /** Clear Phaser UI objects but keep HTML inputs & timer alive (avoids flicker on refresh). */
  private clearUIOnly(): void {
    for (const obj of this.uiObjects) obj.destroy();
    this.uiObjects = [];
  }

  // ============ JOIN BY CODE (fallback for private rooms) ============

  private renderJoinForm(): void {
    const w = this.scale.width;
    const h = this.scale.height;

    this.addUI(this.add.text(w / 2, h * 0.2, 'ENTER YOUR NAME', {
      fontSize: '14px',
      fontFamily: 'monospace',
      color: '#E8F4FF',
    }).setOrigin(0.5));

    this.nameInput = this.createHtmlInput(w / 2 - 120, h * 0.25, 240, 40, 'Captain', 16);

    this.addUI(this.add.text(w / 2, h * 0.4, 'ROOM CODE', {
      fontSize: '14px',
      fontFamily: 'monospace',
      color: '#E8F4FF',
    }).setOrigin(0.5));

    this.roomInput = this.createHtmlInput(w / 2 - 120, h * 0.45, 240, 50, 'XXXX', 4, true);

    this.makeButton(w / 2, h * 0.6, 240, 56, 'JOIN', 0x4A9ECC, () => {
      const name = sanitize(this.nameInput?.value || '') || 'Captain';
      const roomId = sanitize(this.roomInput?.value || '').toUpperCase();
      if (!/^[A-Z0-9]{4}$/.test(roomId)) {
        this.setStatus('방 코드 4자리를 입력하세요');
        return;
      }
      NetworkManager.joinRoom(roomId, name);
    });

    this.makeButton(w / 2, h * 0.6 + 70, 240, 50, 'BACK', 0x666666, () => {
      this.setMode('menu');
    });
  }

  // ============ ROOM ============

  private renderRoom(): void {
    this.clearUI();
    const w = this.scale.width;
    const h = this.scale.height;
    const room = NetworkManager.room;
    if (!room) return;

    // Room code
    this.addUI(this.add.text(w / 2, 80, `ROOM CODE`, {
      fontSize: '12px',
      fontFamily: 'monospace',
      color: '#8BA8CC',
    }).setOrigin(0.5));

    this.addUI(this.add.text(w / 2, 100, room.id, {
      fontSize: '36px',
      fontFamily: 'monospace',
      color: '#FFD700',
      fontStyle: 'bold',
    }).setOrigin(0.5));

    this.addUI(this.add.text(w / 2, 140, '↑ 친구에게 이 코드를 알려주세요 ↑', {
      fontSize: '11px',
      fontFamily: 'monospace',
      color: '#8BA8CC',
    }).setOrigin(0.5));

    // Two team panels (BLUE / RED)
    const panelW = (w - 60) / 2;
    const panelH = 200;
    const panelY = 170;

    this.drawTeamPanel(20, panelY, panelW, panelH, 0, room);
    this.drawTeamPanel(40 + panelW, panelY, panelW, panelH, 1, room);

    // Ship is chosen in-game via the shop — no pre-select in lobby.
    const me = NetworkManager.getMe();
    if (me) {
      const readyY = panelY + panelH + 40;
      const isReady = me.ready;
      this.makeButton(
        w / 2, readyY, 240, 50,
        isReady ? '✓ READY' : 'NOT READY',
        isReady ? 0x3DC47E : 0xE84545,
        () => NetworkManager.setReady(!isReady),
      );

      // Start button (host only)
      if (NetworkManager.isHost()) {
        const allReady = room.players.every(p => p.ready) && room.players.length >= 2;
        this.makeButton(
          w / 2, readyY + 65, 240, 56,
          allReady ? 'START GAME' : `WAITING... (${room.players.length}/2+)`,
          allReady ? 0xF5A623 : 0x444444,
          () => {
            if (allReady) NetworkManager.startGame();
          },
        );
      } else {
        this.addUI(this.add.text(w / 2, readyY + 65, 'Waiting for host to start...', {
          fontSize: '12px',
          fontFamily: 'monospace',
          color: '#8BA8CC',
        }).setOrigin(0.5));
      }
    }
  }

  private drawTeamPanel(x: number, y: number, w: number, h: number, team: number, room: RoomData): void {
    const teamColor = team === 0 ? 0x4A8ECC : 0xCC4A4A;
    const teamLabel = team === 0 ? 'BLUE FLEET' : 'RED FLEET';
    const teamPlayers = room.players.filter(p => p.team === team);

    const g = this.add.graphics();
    g.fillStyle(0x132240, 0.9);
    g.fillRoundedRect(x, y, w, h, 10);
    g.lineStyle(3, teamColor, 0.9);
    g.strokeRoundedRect(x, y, w, h, 10);
    this.addUI(g);

    this.addUI(this.add.text(x + w / 2, y + 12, teamLabel, {
      fontSize: '14px',
      fontFamily: 'monospace',
      color: '#E8F4FF',
      fontStyle: 'bold',
    }).setOrigin(0.5, 0));

    this.addUI(this.add.text(x + w / 2, y + 32, `${teamPlayers.length}/2`, {
      fontSize: '11px',
      fontFamily: 'monospace',
      color: '#8BA8CC',
    }).setOrigin(0.5, 0));

    // Player list
    const me = NetworkManager.getMe();
    teamPlayers.forEach((p, i) => {
      const py = y + 60 + i * 36;
      const isMe = p.id === me?.id;
      const isHost = p.id === room.hostId;

      const playerBg = this.add.graphics();
      playerBg.fillStyle(isMe ? 0x1E3357 : 0x0E1A30, 0.9);
      playerBg.fillRoundedRect(x + 8, py, w - 16, 30, 5);
      this.addUI(playerBg);

      const status = p.ready ? '✓' : '○';
      const statusColor = p.ready ? '#3DC47E' : '#666666';
      this.addUI(this.add.text(x + 16, py + 15, status, {
        fontSize: '14px',
        fontFamily: 'monospace',
        color: statusColor,
        fontStyle: 'bold',
      }).setOrigin(0, 0.5));

      this.addUI(this.add.text(x + 36, py + 15, p.name + (isHost ? ' ★' : ''), {
        fontSize: '11px',
        fontFamily: 'monospace',
        color: isMe ? '#FFDD66' : '#E8F4FF',
        fontStyle: isMe ? 'bold' : 'normal',
      }).setOrigin(0, 0.5));

      this.addUI(this.add.text(x + w - 16, py + 15, p.shipId.slice(0, 4).toUpperCase(), {
        fontSize: '9px',
        fontFamily: 'monospace',
        color: '#8BA8CC',
      }).setOrigin(1, 0.5));
    });

    // Switch team button (only if it's not your team)
    if (me && me.team !== team && teamPlayers.length < 2) {
      const switchY = y + h - 24;
      const btnG = this.add.graphics();
      btnG.fillStyle(teamColor, 0.4);
      btnG.fillRoundedRect(x + w / 2 - 50, switchY - 12, 100, 24, 6);
      this.addUI(btnG);

      this.addUI(this.add.text(x + w / 2, switchY, 'JOIN', {
        fontSize: '11px',
        fontFamily: 'monospace',
        color: '#E8F4FF',
        fontStyle: 'bold',
      }).setOrigin(0.5));

      const hit = this.add.rectangle(x + w / 2, switchY, 100, 24, 0x000000, 0).setInteractive();
      hit.on('pointerdown', () => NetworkManager.setTeam(team));
      this.addUI(hit);
    }
  }

  // ============ HELPERS ============

  private makeButton(
    cx: number, cy: number, w: number, h: number,
    label: string, color: number, onClick: () => void,
  ): void {
    const g = this.add.graphics();
    g.fillStyle(color, 1);
    g.fillRoundedRect(cx - w / 2, cy - h / 2, w, h, 10);
    g.lineStyle(2, 0xFFFFFF, 0.3);
    g.strokeRoundedRect(cx - w / 2, cy - h / 2, w, h, 10);
    this.addUI(g);

    this.addUI(this.add.text(cx, cy, label, {
      fontSize: '15px',
      fontFamily: 'monospace',
      color: '#FFFFFF',
      fontStyle: 'bold',
    }).setOrigin(0.5));

    const hit = this.add.rectangle(cx, cy, w, h, 0x000000, 0)
      .setInteractive({ useHandCursor: true });
    hit.on('pointerdown', onClick);
    this.addUI(hit);
  }

  private createHtmlInput(
    x: number, y: number, w: number, h: number,
    placeholder: string, maxLen: number, upper: boolean = false,
  ): HTMLInputElement {
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = placeholder;
    input.maxLength = maxLen;
    input.style.position = 'absolute';
    input.style.left = `${x}px`;
    input.style.top = `${y}px`;
    input.style.width = `${w}px`;
    input.style.height = `${h}px`;
    input.style.background = '#132240';
    input.style.border = '2px solid #2E6DA4';
    input.style.borderRadius = '8px';
    input.style.color = '#FFD700';
    input.style.fontSize = upper ? '24px' : '16px';
    input.style.fontFamily = 'monospace';
    input.style.textAlign = 'center';
    input.style.outline = 'none';
    input.style.zIndex = '999';
    input.style.fontWeight = 'bold';
    input.style.boxSizing = 'border-box';
    if (upper) {
      input.style.letterSpacing = '8px';
      input.addEventListener('input', () => {
        input.value = input.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
      });
    }
    document.body.appendChild(input);
    this.htmlElements.push(input);
    setTimeout(() => input.focus(), 100);
    return input;
  }

  private createBackButton(): void {
    const back = this.add.text(20, 20, '← BACK', {
      fontSize: '14px',
      fontFamily: 'monospace',
      color: '#8BA8CC',
      fontStyle: 'bold',
    }).setInteractive({ useHandCursor: true });

    back.on('pointerdown', () => {
      if (this.mode === 'room') {
        NetworkManager.leaveRoom();
        this.setMode('menu');
      } else if (this.mode === 'create' || this.mode === 'join') {
        this.setMode('menu');
      } else {
        this.cleanupHtml();
        this.scene.start('TitleScene');
      }
    });
  }
}
