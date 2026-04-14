import Phaser from 'phaser';
import { BalanceConfig, ShipId, ItemConfig, WeaponItemConfig } from '../config/types';
import { Ship } from '../entities/Ship';
import { Creep } from '../entities/Creep';
import { Plane } from '../entities/Plane';
import { Tower } from '../entities/Tower';
import { Projectile } from '../entities/Projectile';
import { TreasurePickup } from '../entities/TreasurePickup';
import { AutoAttackSystem } from '../systems/AutoAttackSystem';
import { InputSystem } from '../systems/InputSystem';
import { FogOfWar } from '../systems/FogOfWar';
import { EventBus } from '../utils/EventBus';
import { NetworkManager, RemotePlayerState } from '../network/NetworkManager';
import { AudioManager } from '../utils/AudioManager';
import { UserProfile } from '../utils/UserProfile';

interface Island {
  x: number;
  y: number;
  radius: number;
  type: 'large' | 'medium' | 'small' | 'rocks';
  trees: { x: number; y: number; size: number }[];
  // Per-vertex radial offsets for irregular natural shape
  shape: number[];
  // Slight axial stretch for variety
  stretchX: number;
  stretchY: number;
  rotation: number;
}

interface WaveStrip {
  yOffset: number;
  speed: number;
  amplitude: number;
  phase: number;
}

export class GameScene extends Phaser.Scene {
  public player!: Ship;
  public allies: Ship[] = [];
  public enemies: Ship[] = [];
  public pirateNPCs: Ship[] = [];           // team 2 — roaming pirates
  public pirateBosses: Ship[] = [];          // team 2 — guarded shop bosses
  public bossShopLoot: Map<number, { x: number; y: number; claimed: boolean; respawnTimer: number }> = new Map();
  public creeps: Creep[] = [];
  public planes: Plane[] = [];
  public towers: Tower[] = [];
  public treasures: TreasurePickup[] = [];
  public playerNexus!: Tower;
  public enemyNexus!: Tower;
  public autoAttack!: AutoAttackSystem;
  private inputSystem!: InputSystem;
  private fog!: FogOfWar;
  private balance!: BalanceConfig;

  // Terrain
  private islands: Island[] = [];
  private terrainGraphics!: Phaser.GameObjects.Graphics;

  // Ocean
  private oceanTile!: Phaser.GameObjects.TileSprite;
  private oceanOverlay!: Phaser.GameObjects.Graphics;
  private waveGraphics!: Phaser.GameObjects.Graphics;
  private waves: WaveStrip[] = [];
  private waveTime: number = 0;

  // Safe zone
  public safeZoneRadius!: number;
  private safeZoneGraphics!: Phaser.GameObjects.Graphics;
  private safeZoneTimer: number = 0;
  private gameTime: number = 0;

  // Economy
  private passiveGoldTimer: number = 0;
  private creepSpawnTimer: number = 0;

  // Bot AI
  private botAITimer: number = 0;

  // Wave system
  public waveNumber: number = 1;
  private waveTimer: number = 0;
  private readonly WAVE_INTERVAL = 22;

  // Game state
  private gameOver: boolean = false;
  private aliveCount: number = 0;

  // Respawn
  private respawnPending: boolean = false;
  private respawnTimer: number = 0;
  private readonly RESPAWN_DURATION = 5;

  // AFK detection
  private afkTriggered: boolean = false;
  private readonly AFK_TIMEOUT = 180_000; // 3 minutes in ms

  // Multiplayer
  public isMultiplayer: boolean = false;
  private remoteShips: Map<string, Ship> = new Map();
  private remoteTargets: Map<string, RemotePlayerState> = new Map();
  private netSendTimer: number = 0;
  private readonly NET_SEND_INTERVAL = 100; // ms

  constructor() {
    super({ key: 'GameScene' });
  }

  init(data: { selectedShip?: ShipId; multiplayer?: boolean }): void {
    this.balance = this.cache.json.get('balance') as BalanceConfig;
    this.gameOver = false;
    this.respawnPending = false;
    this.respawnTimer = 0;
    this.afkTriggered = false;
    this.allies = [];
    this.enemies = [];
    this.creeps = [];
    this.planes = [];
    this.towers = [];
    this.treasures = [];
    this.pirateNPCs = [];
    this.pirateBosses = [];
    this.bossShopLoot = new Map();
    this.islands = [];
    this.waves = [];
    this.waveNumber = 1;
    this.waveTimer = 0;
    this.isMultiplayer = !!data.multiplayer;
    this.remoteShips = new Map();
    this.remoteTargets = new Map();
    this.netSendTimer = 0;

    const mapW = this.balance.map.worldWidth;
    const mapH = this.balance.map.worldHeight;

    this.physics.world.setBounds(0, 0, mapW, mapH);

    // Use deterministic seed in multiplayer so all clients get same terrain
    if (this.isMultiplayer && NetworkManager.room) {
      this.seedRandom(NetworkManager.room.seed);
    } else {
      this.seededRng = Math.random;
    }

    this.generateIslands(mapW, mapH);
    this.generateWaves(mapH);

    if (this.isMultiplayer) {
      this.initMultiplayer();
    } else {
      // Single player — LoL-style layout
      const playerBaseX = mapW * 0.5;
      const playerBaseY = mapH * 0.85;
      const enemyBaseX = mapW * 0.5;
      const enemyBaseY = mapH * 0.15;

      const spawn = this.findSafeSpawn(playerBaseX, playerBaseY - 80, mapW, mapH);
      const shipConfig = this.balance.ships[data.selectedShip ?? 'patrolboat'];
      this.player = new Ship(this, spawn.x, spawn.y, shipConfig, 0, false);
      this.player.gold = UserProfile.getStartingGold(this.balance.economy.startingGold);
      this.player.equipItem(this.balance.items['rapid_gun'] as WeaponItemConfig);

      // Spawn nexus + towers for both bases
      this.spawnBases(playerBaseX, playerBaseY, enemyBaseX, enemyBaseY);

      // Both sides start with equal forces — player is the tipping factor
      this.spawnAllyWave(4);
      this.spawnEnemyWave(4);
      this.aliveCount = 1 + this.allies.length;
    }
  }

  private initMultiplayer(): void {
    const room = NetworkManager.room;
    if (!room) return;
    const mapW = this.balance.map.worldWidth;
    const mapH = this.balance.map.worldHeight;

    // Create a ship for each room player
    // Place team 0 on left, team 1 on right
    const team0Players = room.players.filter(p => p.team === 0);
    const team1Players = room.players.filter(p => p.team === 1);

    const me = room.players.find(p => p.id === NetworkManager.playerId);
    const myTeam = me ? me.team : 0;

    const placePlayer = (p: any, team: number, idx: number, total: number) => {
      const baseX = team === 0 ? mapW * 0.25 : mapW * 0.75;
      const baseY = mapH * (0.35 + (total > 1 ? idx * 0.3 : 0));
      const spawn = this.findSafeSpawn(baseX, baseY, mapW, mapH);
      const cfg = this.balance.ships[p.shipId as ShipId];
      const isMe = p.id === NetworkManager.playerId;
      const ship = new Ship(this, spawn.x, spawn.y, cfg, team, !isMe);
      ship.netPlayerId = p.id;
      ship.isRemoteOwned = !isMe;
      ship.gold = this.balance.economy.startingGold;
      ship.equipItem(this.balance.items['rapid_gun'] as WeaponItemConfig);
      // Face center
      ship.heading = Phaser.Math.Angle.Between(spawn.x, spawn.y, mapW / 2, mapH / 2);
      ship.targetHeading = ship.heading;

      if (isMe) {
        this.player = ship;
      } else {
        this.remoteShips.set(p.id, ship);
        // allies = same team as me, enemies = opposite team
        if (team === myTeam) {
          this.allies.push(ship);
        } else {
          this.enemies.push(ship);
        }
      }
    };

    team0Players.forEach((p, i) => placePlayer(p, 0, i, team0Players.length));
    team1Players.forEach((p, i) => placePlayer(p, 1, i, team1Players.length));

    // aliveCount = alive players on my team (including me)
    const myTeamPlayers = myTeam === 0 ? team0Players : team1Players;
    this.aliveCount = myTeamPlayers.length;
  }

  // Simple seedable random for deterministic terrain across MP clients
  private seededRng: () => number = Math.random;
  private seedRandom(seed: number): void {
    let state = seed || 1;
    this.seededRng = () => {
      state = (state * 1664525 + 1013904223) | 0;
      return ((state >>> 0) % 1000000) / 1000000;
    };
  }
  private srand(min: number, max: number): number {
    return min + this.seededRng() * (max - min);
  }

  /** Create nexus + towers + defensive terrain for both bases */
  private spawnBases(pX: number, pY: number, eX: number, eY: number): void {
    const mapW = this.balance.map.worldWidth;

    // Player (team 0) base — bottom of map
    this.playerNexus = new Tower(this, pX, pY, 0, true);
    this.towers.push(this.playerNexus);
    this.towers.push(new Tower(this, pX - mapW * 0.18, pY - 90, 0, false));
    this.towers.push(new Tower(this, pX + mapW * 0.18, pY - 90, 0, false));
    this.towers.push(new Tower(this, pX, pY - 220, 0, false));

    // Defensive terrain — rocks/islands flanking player base (narrow entrance)
    this.islands.push(this.createIsland(pX - mapW * 0.3, pY + 30, 55, 'rocks'));
    this.islands.push(this.createIsland(pX + mapW * 0.3, pY + 30, 55, 'rocks'));
    this.islands.push(this.createIsland(pX - mapW * 0.15, pY + 60, 35, 'rocks'));
    this.islands.push(this.createIsland(pX + mapW * 0.15, pY + 60, 35, 'rocks'));
    // Side walls (force approach from center)
    this.islands.push(this.createIsland(pX - mapW * 0.28, pY - 40, 45, 'small'));
    this.islands.push(this.createIsland(pX + mapW * 0.28, pY - 40, 45, 'small'));

    // Enemy (team 1) base — top of map (mirrored)
    this.enemyNexus = new Tower(this, eX, eY, 1, true);
    this.towers.push(this.enemyNexus);
    this.towers.push(new Tower(this, eX - mapW * 0.18, eY + 90, 1, false));
    this.towers.push(new Tower(this, eX + mapW * 0.18, eY + 90, 1, false));
    this.towers.push(new Tower(this, eX, eY + 220, 1, false));

    // Enemy base defensive terrain
    this.islands.push(this.createIsland(eX - mapW * 0.3, eY - 30, 55, 'rocks'));
    this.islands.push(this.createIsland(eX + mapW * 0.3, eY - 30, 55, 'rocks'));
    this.islands.push(this.createIsland(eX - mapW * 0.15, eY - 60, 35, 'rocks'));
    this.islands.push(this.createIsland(eX + mapW * 0.15, eY - 60, 35, 'rocks'));
    this.islands.push(this.createIsland(eX - mapW * 0.28, eY + 40, 45, 'small'));
    this.islands.push(this.createIsland(eX + mapW * 0.28, eY + 40, 45, 'small'));
  }

  /** Shared tier/ship pool selection based on wave number */
  private getWavePools(): { weapons: string[]; ships: ShipId[] } {
    const wave = this.waveNumber;
    const tier1 = ['rapid_gun', 'pop_gun', 'spear_gun', 'flare_gun', 'tesla_spark'];
    const tier2 = ['rapid_gun', 'vulcan', 'flak_cannon', 'flame_cannon', 'mortar', 'spear_gun'];
    const tier3 = ['marksman_rifle', 'gatling', 'tesla_coil', 'heavy_mortar', 'torpedo', 'mini_missile'];
    const tier4 = ['long_rifle', 'thunder_cannon', 'plasma_cannon', 'lance', 'heavy_laser', 'missile_launcher'];
    const tier5 = ['heavy_sniper', 'railgun', 'mega_tesla', 'nuke_launcher', 'smart_bomb', 'plasma_gatling', 'inferno'];

    let weapons: string[];
    if (wave <= 1) weapons = tier1;
    else if (wave <= 3) weapons = [...tier1, ...tier2];
    else if (wave <= 5) weapons = [...tier2, ...tier3];
    else if (wave <= 7) weapons = [...tier3, ...tier4];
    else if (wave <= 9) weapons = [...tier4, ...tier5];
    else weapons = tier5;

    const ships: ShipId[] = wave <= 1
      ? ['patrolboat', 'patrolboat', 'destroyer']
      : wave <= 2
      ? ['patrolboat', 'destroyer', 'destroyer', 'trireme', 'viking']
      : wave <= 4
      ? ['destroyer', 'destroyer', 'cruiser', 'pirate']
      : wave <= 6
      ? ['cruiser', 'submarine', 'pirate', 'galleon']
      : wave <= 8
      ? ['cruiser', 'battleship', 'submarine', 'galleon', 'panokseon']
      : ['battleship', 'battleship', 'carrier', 'turtleship', 'yamato'];

    return { weapons, ships };
  }

  private spawnAllyWave(count: number): void {
    const mapW = this.balance.map.worldWidth;
    const mapH = this.balance.map.worldHeight;
    const { weapons, ships } = this.getWavePools();

    const baseX = this.playerNexus?.x ?? mapW / 2;
    const baseY = this.playerNexus?.y ?? mapH * 0.85;

    for (let i = 0; i < count; i++) {
      const shipId = ships[Phaser.Math.Between(0, ships.length - 1)];
      const cfg = this.balance.ships[shipId];
      const sx = baseX + Phaser.Math.Between(-200, 200);
      const sy = baseY - 100 + Phaser.Math.Between(-50, 50);
      const spawn = this.findSafeSpawn(
        Phaser.Math.Clamp(sx, 100, mapW - 100),
        Phaser.Math.Clamp(sy, 100, mapH - 100),
        mapW, mapH,
      );
      const ally = new Ship(this, spawn.x, spawn.y, cfg, 0, true);
      ally.gold = 300;
      ally.heading = -Math.PI / 2;
      ally.targetHeading = -Math.PI / 2;
      for (let j = 0; j < cfg.slots.weapon; j++) {
        const w = weapons[Phaser.Math.Between(0, weapons.length - 1)];
        ally.equipItem({ ...this.balance.items[w] } as WeaponItemConfig);
      }
      this.allies.push(ally);
    }
  }

  private spawnEnemyWave(count: number): void {
    const mapW = this.balance.map.worldWidth;
    const mapH = this.balance.map.worldHeight;
    const { weapons: pool, ships: shipPool } = this.getWavePools();

    // Spawn near enemy base (top)
    const baseX = this.enemyNexus?.x ?? mapW / 2;
    const baseY = this.enemyNexus?.y ?? mapH * 0.15;

    for (let i = 0; i < count; i++) {
      const shipId = shipPool[Phaser.Math.Between(0, shipPool.length - 1)];
      const cfg = this.balance.ships[shipId];
      const ex = baseX + Phaser.Math.Between(-220, 220);
      const ey = baseY + 100 + Phaser.Math.Between(-50, 80);
      const spawn = this.findSafeSpawn(
        Phaser.Math.Clamp(ex, 150, mapW - 150),
        Phaser.Math.Clamp(ey, 150, mapH - 150),
        mapW, mapH,
      );
      const enemy = new Ship(this, spawn.x, spawn.y, cfg, 1, true);
      enemy.gold = 300;
      // Face south (toward player base)
      enemy.heading = Math.PI / 2;
      enemy.targetHeading = Math.PI / 2;
      // Gentler HP scaling: 1.0x at wave 1 → 2.0x by wave 10
      const hpMul = 1.0 + Math.min(this.waveNumber * 0.1, 1.0);
      enemy.maxHp = Math.floor(cfg.hp * hpMul);
      enemy.currentHp = enemy.maxHp;
      for (let j = 0; j < cfg.slots.weapon; j++) {
        const w = pool[Phaser.Math.Between(0, pool.length - 1)];
        enemy.equipItem({ ...this.balance.items[w] } as WeaponItemConfig);
      }
      this.enemies.push(enemy);
    }
  }

  create(): void {
    const mapW = this.balance.map.worldWidth;
    const mapH = this.balance.map.worldHeight;

    // Layer 0: Procedural seamless water tile background
    this.oceanTile = this.add.tileSprite(0, 0, mapW, mapH, 'water_proc')
      .setOrigin(0, 0)
      .setDepth(0)
      .setTileScale(1, 1);

    // Layer 0.5: Subtle dark overlay for depth + grid
    this.oceanOverlay = this.add.graphics().setDepth(0.5);
    this.drawOceanOverlay(mapW, mapH);

    // Layer 1: Animated waves
    this.waveGraphics = this.add.graphics().setDepth(1);

    // Layer 2: Terrain (islands, rocks)
    this.terrainGraphics = this.add.graphics().setDepth(3);
    this.drawTerrain();

    // Layer 9: Safe zone overlay
    this.safeZoneRadius = this.balance.map.safeZoneInitialRadius;
    this.safeZoneGraphics = this.add.graphics().setDepth(9);

    // Systems
    this.autoAttack = new AutoAttackSystem(this);
    this.inputSystem = new InputSystem(this);
    this.fog = new FogOfWar(this, mapW, mapH);

    // Camera
    this.cameras.main.startFollow(this.player, true, 0.06, 0.06);
    this.cameras.main.setZoom(1.6);
    this.cameras.main.setBounds(0, 0, mapW, mapH);

    // === Modern post-processing FX (Phaser 3.60+ FX pipeline) ===
    try {
      // Subtle bloom — bright pixels (cannons, explosions, gold) glow
      this.cameras.main.postFX.addBloom(0xFFFFFF, 1, 1, 0.6, 1.4);
      // Cinematic color grading: slight teal-orange contrast boost
      const colorMatrix = this.cameras.main.postFX.addColorMatrix();
      colorMatrix.contrast(0.08);
      colorMatrix.saturate(0.15);
      colorMatrix.brightness(1.02);
    } catch {
      // FX pipeline not available — skip
    }

    // Cinematic screen vignette (above safe-zone, below HUD scene)
    this.add.image(0, 0, 'vignette')
      .setOrigin(0, 0)
      .setDisplaySize(this.scale.width, this.scale.height)
      .setScrollFactor(0)
      .setDepth(50);

    this.spawnCreeps();
    this.spawnTreasures();
    this.spawnPirateFleet();
    this.scene.launch('UIScene');
    this.cameras.main.fadeIn(500);

    // Initial sync: tell UI which slots the player has
    this.time.delayedCall(50, () => {
      EventBus.emit('ship-changed', this.player.config.id);
      EventBus.emit('items-changed', this.player.getAllItems());
      EventBus.emit('gold-changed', this.player.gold);
    });

    EventBus.on('buy-item', (itemId: string) => {
      const item = this.balance.items[itemId];
      if (!item) {
        EventBus.emit('toast', `❌ Unknown item: ${itemId}`, '#E84545');
        return;
      }
      if (this.player.gold < item.cost) {
        EventBus.emit('toast', `❌ Not enough gold (need ${item.cost}g)`, '#E84545');
        return;
      }
      const ok = this.player.equipItem(item);
      if (ok) {
        this.player.gold -= item.cost;
        EventBus.emit('gold-changed', this.player.gold);
        EventBus.emit('items-changed', this.player.getAllItems());
        EventBus.emit('toast', `✓ ${item.displayName} 장착!`, '#3DC47E');
        AudioManager.pickup();
      } else {
        EventBus.emit('toast', `❌ ${item.displayName} 장착 실패`, '#E84545');
      }
    });

    EventBus.on('use-skill', () => this.activatePlayerSkill());

    EventBus.on('sell-item', (index: number) => {
      const item = this.player.removeItemAt(index);
      if (item) {
        const refund = Math.floor(item.cost * 0.5);
        this.player.gold += refund;
        EventBus.emit('gold-changed', this.player.gold);
        EventBus.emit('items-changed', this.player.getAllItems());
        EventBus.emit('toast', `💸 ${item.displayName} 매각 +${refund}g`, '#F5A623');
        AudioManager.pickup();
      }
    });

    EventBus.on('buy-ship', (data: { shipId: ShipId; cost: number }) => {
      if (this.player.gold < data.cost) {
        EventBus.emit('toast', `❌ Not enough gold (need ${data.cost}g)`, '#E84545');
        return;
      }
      if (this.player.config.id === data.shipId) {
        EventBus.emit('toast', `이미 장착중`, '#F5A623');
        return;
      }
      this.player.gold -= data.cost;
      this.upgradePlayerShip(data.shipId);
      const cfg = this.balance.ships[data.shipId];
      EventBus.emit('toast', `⚓ ${cfg.displayName} 진수!`, '#FFD700');
    });

    // ===== Multiplayer event handlers =====
    if (this.isMultiplayer) {
      NetworkManager.on('remote_player_state', this.handleRemoteState, this);
      NetworkManager.on('remote_player_action', this.handleRemoteAction, this);
      NetworkManager.on('player_left', this.handlePlayerLeft, this);

      // When my projectile hits a remote ship, tell them
      EventBus.on('ship-hit', (data: { ship: Ship; damage: number }) => {
        if (!this.isMultiplayer) return;
        if (data.ship === this.player) return; // Don't broadcast self-hits
        if (data.ship.netPlayerId) {
          NetworkManager.sendPlayerAction({
            type: 'hit',
            targetId: data.ship.netPlayerId,
            damage: data.damage,
          });
        }
      });
    }

    this.events.once('shutdown', () => {
      EventBus.off('buy-item');
      EventBus.off('buy-ship');
      EventBus.off('use-skill');
      EventBus.off('sell-item');
      EventBus.off('ship-hit');
      if (this.isMultiplayer) {
        NetworkManager.off('remote_player_state', this.handleRemoteState, this);
        NetworkManager.off('remote_player_action', this.handleRemoteAction, this);
        NetworkManager.off('player_left', this.handlePlayerLeft, this);
        NetworkManager.leaveRoom();
      }
    });
  }

  // ========== MULTIPLAYER NETWORK HANDLERS ==========

  private handleRemoteState(playerId: string, state: RemotePlayerState): void {
    this.remoteTargets.set(playerId, state);
    const ship = this.remoteShips.get(playerId);
    if (!ship || ship.isDead) return;
    // Update HP directly (authoritative from owner)
    ship.currentHp = state.hp;
    ship.maxHp = state.maxHp;
    // Update equipped weapons if changed
    const currentWeapons = ship.getWeapons().map(w => w.id);
    const sameWeapons = currentWeapons.length === state.weapons.length &&
      currentWeapons.every((w, i) => w === state.weapons[i]);
    if (!sameWeapons) {
      // Re-equip from scratch (clear and add)
      (ship as any).equippedWeapons = [];
      for (const wId of state.weapons) {
        const item = this.balance.items[wId];
        if (item && item.type === 'weapon') {
          ship.equipItem(item);
        }
      }
    }
  }

  private handleRemoteAction(playerId: string, action: any): void {
    if (action.type === 'hit') {
      // I was hit by remote player's projectile
      if (action.targetId === NetworkManager.playerId && !this.player.isDead) {
        this.player.takeDamage(action.damage);
      }
    } else if (action.type === 'death') {
      const ship = this.remoteShips.get(playerId);
      if (ship && !ship.isDead) {
        ship.die();
      }
    }
  }

  private handlePlayerLeft(playerId: string): void {
    const ship = this.remoteShips.get(playerId);
    if (ship) {
      ship.die();
      this.remoteShips.delete(playerId);
    }
    this.remoteTargets.delete(playerId);
  }

  private sendMyState(): void {
    if (!this.isMultiplayer || this.player.isDead) return;
    NetworkManager.sendPlayerState({
      x: this.player.x,
      y: this.player.y,
      heading: this.player.heading,
      throttle: this.player.throttle,
      hp: this.player.currentHp,
      maxHp: this.player.maxHp,
      weapons: this.player.getWeapons().map(w => w.id),
    });
  }

  private updateRemoteShips(delta: number): void {
    const dt = delta / 1000;
    for (const [pid, ship] of this.remoteShips) {
      if (ship.isDead) continue;
      const target = this.remoteTargets.get(pid);
      if (!target) continue;

      // Lerp position smoothly toward target
      const lerpFactor = 1 - Math.exp(-12 * dt); // fast catchup
      ship.x += (target.x - ship.x) * lerpFactor;
      ship.y += (target.y - ship.y) * lerpFactor;

      // Smooth heading interpolation
      let dh = target.heading - ship.heading;
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      ship.heading += dh * lerpFactor;
      ship.targetHeading = target.heading;
      ship.throttle = target.throttle;

      // Update body velocity for wake/feel
      const body = ship.body as Phaser.Physics.Arcade.Body;
      if (body) {
        body.velocity.x = Math.cos(ship.heading) * ship.effectiveSpeed * ship.throttle;
        body.velocity.y = Math.sin(ship.heading) * ship.effectiveSpeed * ship.throttle;
      }
    }
  }

  // ========== TERRAIN GENERATION ==========

  private generateIslands(mapW: number, mapH: number): void {
    // Smaller, more numerous islands scattered naturally.
    // Pre-defined island clusters that don't block routes too much.

    // 1 medium central island (smaller than before)
    this.islands.push(this.createIsland(mapW * 0.5, mapH * 0.42, 65, 'medium'));

    // A few small named islands
    const smallSpots: [number, number][] = [
      [0.18, 0.25], [0.82, 0.22], [0.25, 0.75], [0.78, 0.78],
      [0.15, 0.55], [0.88, 0.5], [0.5, 0.85], [0.45, 0.15],
      [0.35, 0.5], [0.65, 0.55],
    ];
    for (const [fx, fy] of smallSpots) {
      const r = this.srand(28, 50);
      this.islands.push(this.createIsland(mapW * fx, mapH * fy, r, 'small'));
    }

    // Tiny islets
    for (let i = 0; i < 6; i++) {
      this.islands.push(this.createIsland(
        this.srand(180, mapW - 180),
        this.srand(180, mapH - 180),
        this.srand(15, 25),
        'small',
      ));
    }

    // Rock clusters / reefs (hazards)
    for (let i = 0; i < 12; i++) {
      this.islands.push(this.createIsland(
        this.srand(150, mapW - 150),
        this.srand(150, mapH - 150),
        this.srand(10, 18),
        'rocks',
      ));
    }
  }

  private createIsland(x: number, y: number, radius: number, type: Island['type']): Island {
    // Pre-compute irregular shape vertices for natural look
    const segments = 18;
    const shape: number[] = [];
    for (let i = 0; i < segments; i++) {
      // Multi-octave noise for organic edge
      const a = (i / segments) * Math.PI * 2;
      const n =
        Math.sin(a * 3.1 + x * 0.013) * 0.18 +
        Math.cos(a * 5.3 + y * 0.011) * 0.10 +
        Math.sin(a * 7.7 + x * 0.007) * 0.06;
      shape.push(1 + n);
    }
    // Random stretch + rotation per island for variety
    const stretchX = this.srand(0.75, 1.25);
    const stretchY = this.srand(0.75, 1.25);
    const rotation = this.srand(0, Math.PI * 2);

    const trees: { x: number; y: number; size: number }[] = [];
    if (type !== 'rocks') {
      const treeCount = type === 'small' ? this.srand(2, 4) : 5;
      for (let i = 0; i < treeCount; i++) {
        const angle = this.srand(0, Math.PI * 2);
        const dist = this.srand(0, radius * 0.55);
        trees.push({
          x: x + Math.cos(angle) * dist * stretchX,
          y: y + Math.sin(angle) * dist * stretchY,
          size: this.srand(4, 8),
        });
      }
    }
    return { x, y, radius, type, trees, shape, stretchX, stretchY, rotation };
  }

  private generateWaves(mapH: number): void {
    for (let y = 0; y < mapH; y += 40) {
      this.waves.push({
        yOffset: y,
        speed: Phaser.Math.FloatBetween(15, 35),
        amplitude: Phaser.Math.FloatBetween(3, 8),
        phase: Phaser.Math.FloatBetween(0, Math.PI * 2),
      });
    }
  }

  private drawOceanOverlay(w: number, h: number): void {
    const g = this.oceanOverlay;
    // Subtle dark vignette toward edges (depth feel)
    g.fillStyle(0x000022, 0.15);
    g.fillRect(0, 0, w, h);

    // Subtle grid for navigation feel
    g.lineStyle(1, 0x1A3A5C, 0.12);
    for (let x = 0; x <= w; x += 200) {
      g.lineBetween(x, 0, x, h);
    }
    for (let y = 0; y <= h; y += 200) {
      g.lineBetween(0, y, w, y);
    }

    // Compass rose at center
    this.drawCompassRose(g, w / 2, h / 2);

    // Map border
    g.lineStyle(4, 0x2A4A7A, 0.6);
    g.strokeRect(2, 2, w - 4, h - 4);
    g.lineStyle(1, 0x4A7AAA, 0.3);
    g.strokeRect(8, 8, w - 16, h - 16);
  }

  private drawCompassRose(g: Phaser.GameObjects.Graphics, cx: number, cy: number): void {
    const size = 30;
    g.lineStyle(1, 0x2A4A7A, 0.15);
    // N-S
    g.lineBetween(cx, cy - size, cx, cy + size);
    // E-W
    g.lineBetween(cx - size, cy, cx + size, cy);
    // Diagonals
    g.lineBetween(cx - size * 0.7, cy - size * 0.7, cx + size * 0.7, cy + size * 0.7);
    g.lineBetween(cx + size * 0.7, cy - size * 0.7, cx - size * 0.7, cy + size * 0.7);
    // Circle
    g.strokeCircle(cx, cy, size);
    g.strokeCircle(cx, cy, size * 0.4);
  }

  private drawTerrain(): void {
    const g = this.terrainGraphics;
    g.clear();

    // First pass: drop shadows under everything (cast toward bottom-right by sun)
    for (const island of this.islands) {
      this.drawIslandShadow(g, island);
    }
    // Second pass: actual island bodies
    for (const island of this.islands) {
      if (island.type === 'rocks') {
        this.drawRocks(g, island);
      } else {
        this.drawIsland(g, island);
      }
    }
  }

  private drawIslandShadow(g: Phaser.GameObjects.Graphics, island: Island): void {
    // Soft dark drop shadow offset toward bottom-right (sun from upper-left)
    const offsetX = 8;
    const offsetY = 12;
    g.fillStyle(0x000018, 0.45);
    if (island.type === 'rocks') {
      g.fillCircle(island.x + offsetX, island.y + offsetY, island.radius * 0.85);
    } else {
      // Use island's pre-computed irregular shape, slightly larger
      this.fillIslandShape(g, {
        ...island,
        x: island.x + offsetX,
        y: island.y + offsetY,
      }, 1.05);
    }
  }

  private drawIsland(g: Phaser.GameObjects.Graphics, island: Island): void {
    const { x, y, radius } = island;

    // Shallow water halo (transparent ring around island)
    g.fillStyle(0x4D9DC8, 0.25);
    this.fillIslandShape(g, island, 1.35);

    // Beach (lighter sand)
    g.fillStyle(0xE8D9A8, 0.95);
    this.fillIslandShape(g, island, 1.0);

    // Inner sand (darker tan)
    g.fillStyle(0xC8A878, 0.9);
    this.fillIslandShape(g, island, 0.85);

    // Grass / land
    g.fillStyle(0x5A8A3A, 0.95);
    this.fillIslandShape(g, island, 0.7);

    // Inner darker grass
    g.fillStyle(0x3A6A2A, 0.6);
    this.fillIslandShape(g, island, 0.45);

    // Trees
    for (const tree of island.trees) {
      g.fillStyle(0x1F3A12, 0.4);
      g.fillCircle(tree.x + 1.5, tree.y + 1.5, tree.size);
      g.fillStyle(0x3A8A2A, 0.95);
      g.fillCircle(tree.x, tree.y, tree.size);
      g.fillStyle(0x6ACA4A, 0.5);
      g.fillCircle(tree.x - tree.size * 0.25, tree.y - tree.size * 0.25, tree.size * 0.45);
    }

    // Center rock outcrop on bigger islands
    if (radius > 40) {
      g.fillStyle(0x666666, 0.5);
      g.fillCircle(x + radius * 0.15, y - radius * 0.1, 4);
      g.fillStyle(0x888888, 0.4);
      g.fillCircle(x + radius * 0.12, y - radius * 0.13, 2);
    }
  }

  private drawRocks(g: Phaser.GameObjects.Graphics, island: Island): void {
    const { x, y, radius } = island;

    // Danger water halo
    g.fillStyle(0x4D9DC8, 0.18);
    g.fillCircle(x, y, radius * 1.4);

    // Foam ring
    g.lineStyle(1.5, 0xCCEEFF, 0.4);
    g.strokeCircle(x, y, radius * 1.1);

    // 2-4 small rocks (deterministic positions from shape array)
    const rockCount = 2 + Math.floor((island.shape[0] || 1) * 2);
    for (let i = 0; i < rockCount; i++) {
      const a = (i / rockCount) * Math.PI * 2 + island.rotation;
      const d = radius * 0.4 * (0.5 + (island.shape[i] || 1) * 0.3);
      const rx = x + Math.cos(a) * d;
      const ry = y + Math.sin(a) * d;
      const rs = radius * 0.35 * (0.7 + (island.shape[i + 1] || 1) * 0.2);
      // Shadow
      g.fillStyle(0x000000, 0.25);
      g.fillCircle(rx + 1, ry + 1, rs);
      // Rock body
      g.fillStyle(0x5A5A5A, 0.95);
      g.fillCircle(rx, ry, rs);
      // Highlight
      g.fillStyle(0x888888, 0.5);
      g.fillCircle(rx - rs * 0.3, ry - rs * 0.3, rs * 0.5);
    }
  }

  /** Fill island using its pre-computed irregular shape vertices */
  private fillIslandShape(g: Phaser.GameObjects.Graphics, island: Island, scale: number): void {
    const segments = island.shape.length;
    const cosR = Math.cos(island.rotation);
    const sinR = Math.sin(island.rotation);
    g.beginPath();
    for (let i = 0; i <= segments; i++) {
      const idx = i % segments;
      const a = (i / segments) * Math.PI * 2;
      const r = island.radius * scale * island.shape[idx];
      // Stretch then rotate
      let lx = Math.cos(a) * r * island.stretchX;
      let ly = Math.sin(a) * r * island.stretchY;
      const px = island.x + lx * cosR - ly * sinR;
      const py = island.y + lx * sinR + ly * cosR;
      if (i === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    }
    g.closePath();
    g.fillPath();
  }

  private findSafeSpawn(preferX: number, preferY: number, mapW: number, mapH: number): { x: number; y: number } {
    for (let attempt = 0; attempt < 30; attempt++) {
      const x = preferX + Phaser.Math.Between(-200, 200) * (attempt > 5 ? 2 : 1);
      const y = preferY + Phaser.Math.Between(-200, 200) * (attempt > 5 ? 2 : 1);
      const cx = Phaser.Math.Clamp(x, 100, mapW - 100);
      const cy = Phaser.Math.Clamp(y, 100, mapH - 100);
      if (!this.isOnIsland(cx, cy)) return { x: cx, y: cy };
    }
    return { x: preferX, y: preferY };
  }

  isOnIsland(x: number, y: number): boolean {
    for (const island of this.islands) {
      const dist = Phaser.Math.Distance.Between(x, y, island.x, island.y);
      const collisionRadius = island.type === 'rocks' ? island.radius * 0.8 : island.radius * 1.0;
      if (dist < collisionRadius) return true;
    }
    return false;
  }

  // ========== WAVE ANIMATION ==========

  private drawWaves(delta: number): void {
    this.waveTime += delta / 1000;
    const g = this.waveGraphics;
    g.clear();

    // Only draw waves visible to camera for performance
    const cam = this.cameras.main;
    const viewTop = cam.scrollY - 50;
    const viewBottom = cam.scrollY + cam.height / cam.zoom + 50;
    const viewLeft = cam.scrollX - 50;
    const viewRight = cam.scrollX + cam.width / cam.zoom + 50;

    for (const wave of this.waves) {
      if (wave.yOffset < viewTop || wave.yOffset > viewBottom) continue;

      const y = wave.yOffset + Math.sin(this.waveTime * wave.speed * 0.1 + wave.phase) * wave.amplitude;
      g.lineStyle(1, 0x4A8AB0, 0.12);

      g.beginPath();
      const startX = Math.max(0, Math.floor(viewLeft / 80) * 80);
      const endX = Math.min(this.balance.map.worldWidth, viewRight);
      for (let x = startX; x < endX; x += 4) {
        const wx = x + Math.sin(this.waveTime * 0.5 + x * 0.01 + wave.phase) * wave.amplitude * 2;
        const wy = y + Math.sin(this.waveTime * 0.8 + x * 0.02) * wave.amplitude * 0.5;
        if (x === startX) g.moveTo(wx, wy);
        else g.lineTo(wx, wy);
      }
      g.strokePath();
    }

    // Foam patches near islands
    for (const island of this.islands) {
      if (island.x < viewLeft - 200 || island.x > viewRight + 200 ||
          island.y < viewTop - 200 || island.y > viewBottom + 200) continue;

      const foamCount = island.type === 'rocks' ? 4 : island.type === 'large' ? 6 : 3;
      for (let i = 0; i < foamCount; i++) {
        const angle = (i / foamCount) * Math.PI * 2 + this.waveTime * 0.2;
        const dist = island.radius * (island.type === 'rocks' ? 1.3 : 1.15);
        const fx = island.x + Math.cos(angle) * dist + Math.sin(this.waveTime + i) * 3;
        const fy = island.y + Math.sin(angle) * dist + Math.cos(this.waveTime + i) * 3;
        g.fillStyle(0xFFFFFF, 0.08 + Math.sin(this.waveTime * 2 + i) * 0.03);
        g.fillCircle(fx, fy, 4 + Math.sin(this.waveTime + i * 2) * 2);
      }
    }
  }

  // ========== MAIN UPDATE ==========

  update(time: number, delta: number): void {
    if (this.gameOver) return;

    this.gameTime += delta / 1000;

    // Respawn countdown
    if (this.respawnPending) {
      this.respawnTimer -= delta / 1000;
      EventBus.emit('respawn-tick', this.respawnTimer);
      if (this.respawnTimer <= 0) {
        this.respawnPlayer();
        this.respawnPending = false;
      }
    }

    const allShips = [this.player, ...this.allies, ...this.enemies, ...this.pirateNPCs, ...this.pirateBosses];
    const mapW = this.balance.map.worldWidth;
    const mapH = this.balance.map.worldHeight;

    // AFK detection — 3 min no input → bot takes over
    if (!this.afkTriggered && !this.gameOver) {
      const idleMs = Date.now() - this.inputSystem.lastInputTime;
      if (idleMs > this.AFK_TIMEOUT) {
        this.triggerAfk();
        return;
      }
    }

    // ---- Player steering ----
    this.inputSystem.pollKeyboard();
    if (!this.player.isDead) {
      if (this.inputSystem.isActive) {
        this.player.throttle = 1;
        this.player.targetHeading = Math.atan2(
          this.inputSystem.direction.y,
          this.inputSystem.direction.x,
        );
      } else {
        this.player.throttle *= 0.96;
        if (this.player.throttle < 0.01) this.player.throttle = 0;
      }
      this.player.applyMovement(delta);
      this.checkIslandCollision(this.player);
    }

    if (this.isMultiplayer) {
      // MP: lerp remote ships toward target state
      this.updateRemoteShips(delta);

      // Send my state at intervals
      this.netSendTimer += delta;
      if (this.netSendTimer >= this.NET_SEND_INTERVAL) {
        this.netSendTimer = 0;
        this.sendMyState();
      }
    } else {
      // SP: Bot AI + wave spawning
      this.botAITimer += delta;
      if (this.botAITimer > 600) {
        this.botAITimer = 0;
        this.updateBotAI();
      }
      for (const bot of [...this.allies, ...this.enemies]) {
        if (!bot.isDead) {
          bot.applyMovement(delta);
          this.checkIslandCollision(bot);
        }
      }

      this.waveTimer += delta / 1000;
      if (this.waveTimer >= this.WAVE_INTERVAL) {
        this.waveTimer = 0;
        this.waveNumber++;
        this.allies = this.allies.filter(s => !s.isDead);
        this.enemies = this.enemies.filter(s => !s.isDead);
        // Both sides get EQUAL reinforcements (front line stays even)
        const waveCount = Math.min(2 + Math.floor(this.waveNumber * 0.5), 6);
        this.spawnAllyWave(waveCount);
        this.spawnEnemyWave(waveCount);
        EventBus.emit('wave-spawned', this.waveNumber);
      }
    }

    // ---- Update visuals (all ships) ----
    for (const ship of allShips) {
      if (!ship.isDead) ship.updateVisuals(delta);
    }

    // Waves
    this.drawWaves(delta);

    // Creeps
    for (const creep of this.creeps) {
      creep.update(delta, mapW, mapH);
    }

    // Combat
    const activeShips = allShips.filter(s => !s.isDead);
    this.autoAttack.update(delta, activeShips, this.creeps.filter(c => c.active), this.towers);

    // Update treasure pickups
    if (!this.player.isDead) {
      for (const tp of this.treasures) {
        tp.update(delta, this.player);
      }
    }

    // Pirate NPC movement (separate from lane bot AI)
    this.updatePirateAI(delta);

    // Check boss kills → drop rare loot
    this.checkBossDrops();

    // Base healing zone — heal near own nexus
    if (!this.player.isDead && this.playerNexus && !this.playerNexus.isDead) {
      const distToBase = Phaser.Math.Distance.Between(
        this.player.x, this.player.y,
        this.playerNexus.x, this.playerNexus.y,
      );
      if (distToBase < 250) {
        // Heal 3% maxHP per second while in base zone
        this.player.heal(this.player.maxHp * 0.03 * delta / 1000);
      }
    }

    // Carrier plane launches
    for (const ship of activeShips) {
      if (ship.config.id !== 'carrier') continue;
      ship.planeSpawnTimer += delta;
      if (ship.planeSpawnTimer >= 8000) {
        ship.planeSpawnTimer = 0;
        // Launch 2 planes off the deck
        for (let i = 0; i < 2; i++) {
          const offset = (i - 0.5) * 30;
          const px = ship.x + Math.cos(ship.heading + Math.PI / 2) * offset;
          const py = ship.y + Math.sin(ship.heading + Math.PI / 2) * offset;
          const plane = new Plane(this, px, py, ship.team, ship.heading);
          this.planes.push(plane);
        }
      }
    }

    // Update planes
    if (this.planes.length > 0) {
      const planeTargets = [
        ...activeShips.filter(s => !s.isDead),
        ...this.creeps.filter(c => c.active),
      ];
      this.planes = this.planes.filter(p => {
        if (!p.planeActive) {
          p.destroy();
          return false;
        }
        p.updatePlane(delta, planeTargets as any);
        return true;
      });
    }

    // Economy
    this.passiveGoldTimer += delta / 1000;
    if (this.passiveGoldTimer >= this.balance.economy.passiveGoldInterval) {
      this.passiveGoldTimer = 0;
      if (!this.player.isDead) {
        this.player.gold += this.balance.economy.passiveGoldPerInterval;
        EventBus.emit('gold-changed', this.player.gold);
      }
    }

    // Creep respawn
    this.creepSpawnTimer += delta / 1000;
    if (this.creepSpawnTimer >= this.balance.map.creepSpawnInterval) {
      this.creepSpawnTimer = 0;
      this.creeps = this.creeps.filter(c => {
        if (!c.active) { c.destroy(); return false; }
        return true;
      });
      if (this.creeps.length < 12) this.spawnCreeps();
    }

    // Safe zone
    if (this.gameTime >= this.balance.map.safeZoneShrinkStart) {
      this.safeZoneTimer += delta / 1000;
      if (this.safeZoneTimer >= this.balance.map.safeZoneShrinkInterval) {
        this.safeZoneTimer = 0;
        this.safeZoneRadius = Math.max(100, this.safeZoneRadius - this.balance.map.safeZoneShrinkAmount);
      }
      const cx = mapW / 2;
      const cy = mapH / 2;
      for (const ship of activeShips) {
        const dist = Phaser.Math.Distance.Between(ship.x, ship.y, cx, cy);
        if (dist > this.safeZoneRadius) {
          ship.takeDamage(this.balance.map.safeZoneDamagePerSecond * delta / 1000);
        }
      }
    }
    this.drawSafeZone();

    this.checkGameState(allShips);

    // Fog of War — gather vision sources from player's team
    const visionSources: { x: number; y: number; range: number }[] = [];
    if (!this.player.isDead) {
      visionSources.push({ x: this.player.x, y: this.player.y, range: 350 });
    }
    for (const ally of this.allies) {
      if (!ally.isDead) visionSources.push({ x: ally.x, y: ally.y, range: 250 });
    }
    for (const tower of this.towers) {
      if (!tower.isDead && tower.team === this.player.team) {
        visionSources.push({ x: tower.x, y: tower.y, range: tower.isNexus ? 350 : 300 });
      }
    }
    this.fog.update(this.cameras.main, visionSources);

    EventBus.emit('hud-update', {
      hp: this.player.currentHp,
      maxHp: this.player.maxHp,
      gold: this.player.gold,
      kills: this.player.kills,
      alive: this.aliveCount,
      gameTime: this.gameTime,
    });
  }

  // ========== ISLAND COLLISION ==========

  private checkIslandCollision(ship: Ship): void {
    for (const island of this.islands) {
      const dist = Phaser.Math.Distance.Between(ship.x, ship.y, island.x, island.y);
      const collisionR = island.type === 'rocks' ? island.radius * 0.7 : island.radius * 0.9;
      if (dist < collisionR) {
        // Push ship out
        const angle = Phaser.Math.Angle.Between(island.x, island.y, ship.x, ship.y);
        const pushDist = collisionR - dist + 5;
        ship.x += Math.cos(angle) * pushDist;
        ship.y += Math.sin(angle) * pushDist;
        // Reduce velocity on collision
        const body = ship.body as Phaser.Physics.Arcade.Body;
        body.velocity.x *= 0.3;
        body.velocity.y *= 0.3;
        // Damage from rocks
        if (island.type === 'rocks') {
          ship.takeDamage(2);
        }
      }
    }
  }

  // ========== BOT AI ==========

  private updateBotAI(): void {
    const allBots = [...this.allies, ...this.enemies];

    for (const bot of allBots) {
      if (bot.isDead) continue;

      // Each bot pushes toward the OPPOSITE team's nexus
      const pushTarget = bot.team === 0 ? this.enemyNexus : this.playerNexus;
      const fallbackTargetX = pushTarget?.x ?? 0;
      const fallbackTargetY = pushTarget?.y ?? 0;

      let targetX = fallbackTargetX;
      let targetY = fallbackTargetY;

      // Look for nearby enemies/towers to engage
      const allShips = [this.player, ...allBots];
      const nearbyEnemies = allShips
        .filter(s => s !== bot && !s.isDead && s.team !== bot.team);
      const enemyTowers = this.towers.filter(t => !t.isDead && t.team !== bot.team);

      const candidates: { x: number; y: number }[] = [...nearbyEnemies, ...enemyTowers];

      // Find closest target within engagement range
      const range = bot.maxRange || 200;
      let closest: { x: number; y: number } | null = null;
      let closestDist = Infinity;
      for (const c of candidates) {
        const d = Phaser.Math.Distance.Between(bot.x, bot.y, c.x, c.y);
        if (d < range * 1.2 && d < closestDist) {
          closest = c;
          closestDist = d;
        }
      }

      if (closest) {
        const angle = Phaser.Math.Angle.Between(bot.x, bot.y, closest.x, closest.y);
        if (closestDist > range * 0.85) {
          // Approach to optimal range
          targetX = closest.x;
          targetY = closest.y;
        } else if (closestDist < range * 0.5) {
          // Back off
          targetX = bot.x - Math.cos(angle) * 80;
          targetY = bot.y - Math.sin(angle) * 80;
        } else {
          // Strafe
          const perp = angle + Math.PI / 2;
          const dir = (bot.__id % 2 === 0 ? 1 : -1);
          targetX = bot.x + Math.cos(perp) * 60 * dir;
          targetY = bot.y + Math.sin(perp) * 60 * dir;
        }
      }

      // Avoid islands
      for (const island of this.islands) {
        const dist = Phaser.Math.Distance.Between(targetX, targetY, island.x, island.y);
        if (dist < island.radius * 1.8) {
          const avoidAngle = Phaser.Math.Angle.Between(island.x, island.y, bot.x, bot.y);
          targetX = island.x + Math.cos(avoidAngle) * island.radius * 2.2;
          targetY = island.y + Math.sin(avoidAngle) * island.radius * 2.2;
        }
      }

      bot.targetHeading = Phaser.Math.Angle.Between(bot.x, bot.y, targetX, targetY);
      bot.throttle = 0.85 + Phaser.Math.FloatBetween(0, 0.15);
    }
  }

  // ========== SPAWNS ==========

  private spawnCreeps(): void {
    const mapW = this.balance.map.worldWidth;
    const mapH = this.balance.map.worldHeight;

    // Regular lane creeps (edges — weaker)
    const lanePoints = [
      { x: mapW * 0.2, y: mapH * 0.35 },
      { x: mapW * 0.8, y: mapH * 0.35 },
      { x: mapW * 0.2, y: mapH * 0.65 },
      { x: mapW * 0.8, y: mapH * 0.65 },
    ];
    for (const sp of lanePoints) {
      for (let i = 0; i < 2; i++) {
        const spawn = this.findSafeSpawn(sp.x + Phaser.Math.Between(-60, 60), sp.y + Phaser.Math.Between(-60, 60), mapW, mapH);
        const creep = new Creep(this, spawn.x, spawn.y, this.balance.map.creepHp, this.balance.map.creepSpeed);
        this.creeps.push(creep);
      }
    }

    // === JUNGLE CAMPS (center zone — elite mobs, worth more gold) ===
    const jungleCamps = [
      // Left jungle
      { x: mapW * 0.25, y: mapH * 0.5, elite: true },
      // Center jungle (main objective)
      { x: mapW * 0.5, y: mapH * 0.5, elite: true },
      // Right jungle
      { x: mapW * 0.75, y: mapH * 0.5, elite: true },
      // Minor camps
      { x: mapW * 0.35, y: mapH * 0.42, elite: false },
      { x: mapW * 0.65, y: mapH * 0.42, elite: false },
      { x: mapW * 0.35, y: mapH * 0.58, elite: false },
      { x: mapW * 0.65, y: mapH * 0.58, elite: false },
    ];
    for (const camp of jungleCamps) {
      const spawn = this.findSafeSpawn(camp.x, camp.y, mapW, mapH);
      if (camp.elite) {
        // Elite mob — tougher, worth 200g, moves slowly
        const eliteCreep = new Creep(this, spawn.x, spawn.y, 500, 25);
        this.creeps.push(eliteCreep);
      }
      // Regular creeps around each camp
      for (let i = 0; i < 2; i++) {
        const cx = spawn.x + Phaser.Math.Between(-40, 40);
        const cy = spawn.y + Phaser.Math.Between(-40, 40);
        const creep = new Creep(this, cx, cy, this.balance.map.creepHp, this.balance.map.creepSpeed);
        this.creeps.push(creep);
      }
    }
  }

  /** Spawn pirate NPC faction — roaming pirates + boss-guarded shops */
  private spawnPirateFleet(): void {
    const mapW = this.balance.map.worldWidth;
    const mapH = this.balance.map.worldHeight;

    const pirateWeapons = ['rapid_gun', 'mortar', 'flame_cannon', 'flak_cannon', 'spear_gun', 'tesla_spark'];
    const bossWeapons = ['heavy_mortar', 'missile_launcher', 'plasma_cannon', 'heavy_laser', 'railgun'];

    // === ROAMING PIRATE PACKS (map edges — pirate waters) ===
    const roamZones: { x: number; y: number; count: number; shipIds: ShipId[] }[] = [
      // West pirate waters
      { x: mapW * 0.08, y: mapH * 0.3, count: 2, shipIds: ['pirate', 'viking'] },
      { x: mapW * 0.08, y: mapH * 0.7, count: 2, shipIds: ['pirate', 'trireme'] },
      // East pirate waters
      { x: mapW * 0.92, y: mapH * 0.3, count: 2, shipIds: ['pirate', 'viking'] },
      { x: mapW * 0.92, y: mapH * 0.7, count: 2, shipIds: ['trireme', 'pirate'] },
      // Center ocean patrol
      { x: mapW * 0.5, y: mapH * 0.35, count: 1, shipIds: ['galleon'] },
      { x: mapW * 0.5, y: mapH * 0.65, count: 1, shipIds: ['galleon'] },
    ];

    for (const zone of roamZones) {
      for (let i = 0; i < zone.count; i++) {
        const sid = zone.shipIds[i % zone.shipIds.length];
        const cfg = this.balance.ships[sid];
        if (!cfg) continue;
        const px = zone.x + Phaser.Math.Between(-80, 80);
        const py = zone.y + Phaser.Math.Between(-80, 80);
        const spawn = this.findSafeSpawn(px, py, mapW, mapH);
        const pirate = new Ship(this, spawn.x, spawn.y, cfg, 2, true);
        pirate.heading = Phaser.Math.FloatBetween(0, Math.PI * 2);
        pirate.targetHeading = pirate.heading;
        // Buff pirate HP
        pirate.maxHp = Math.floor(cfg.hp * 1.3);
        pirate.currentHp = pirate.maxHp;
        for (let j = 0; j < cfg.slots.weapon; j++) {
          const w = pirateWeapons[Phaser.Math.Between(0, pirateWeapons.length - 1)];
          pirate.equipItem({ ...this.balance.items[w] } as WeaponItemConfig);
        }
        this.pirateNPCs.push(pirate);
      }
    }

    // === BOSS-GUARDED TREASURE SHOPS ===
    const bossLocations = [
      { x: mapW * 0.12, y: mapH * 0.5, shipId: 'blackpearl' as ShipId },     // West boss
      { x: mapW * 0.88, y: mapH * 0.5, shipId: 'flyingdutchman' as ShipId },  // East boss
      { x: mapW * 0.5, y: mapH * 0.15, shipId: 'royalfortune' as ShipId },    // North boss (near enemy base)
    ];

    for (let i = 0; i < bossLocations.length; i++) {
      const loc = bossLocations[i];
      const cfg = this.balance.ships[loc.shipId];
      if (!cfg) continue;
      const boss = new Ship(this, loc.x, loc.y, cfg, 2, true);
      // Boss is MUCH tougher
      boss.maxHp = Math.floor(cfg.hp * 3);
      boss.currentHp = boss.maxHp;
      boss.heading = Phaser.Math.FloatBetween(0, Math.PI * 2);
      boss.targetHeading = boss.heading;
      // Heavy boss weapons
      for (let j = 0; j < cfg.slots.weapon; j++) {
        const w = bossWeapons[Phaser.Math.Between(0, bossWeapons.length - 1)];
        boss.equipItem({ ...this.balance.items[w] } as WeaponItemConfig);
      }
      this.pirateBosses.push(boss);
      // Track loot location for this boss
      this.bossShopLoot.set(boss.__id, { x: loc.x, y: loc.y, claimed: false, respawnTimer: 0 });
    }
  }

  /** Place treasure crates hidden around the map (near islands, in coves) */
  private spawnTreasures(): void {
    const mapW = this.balance.map.worldWidth;
    const mapH = this.balance.map.worldHeight;

    // Place crates near islands — feels like discovering treasure on islands
    const spots = [
      // Left side treasures
      { x: mapW * 0.12, y: mapH * 0.38, gold: 300 },
      { x: mapW * 0.18, y: mapH * 0.62, gold: 250 },
      // Right side treasures
      { x: mapW * 0.88, y: mapH * 0.38, gold: 300 },
      { x: mapW * 0.82, y: mapH * 0.62, gold: 250 },
      // Center area (risky — near combat zone, high reward)
      { x: mapW * 0.4, y: mapH * 0.5, gold: 400 },
      { x: mapW * 0.6, y: mapH * 0.5, gold: 400 },
      // Near bases (small, easy to reach)
      { x: mapW * 0.35, y: mapH * 0.8, gold: 150 },
      { x: mapW * 0.65, y: mapH * 0.8, gold: 150 },
    ];

    for (const spot of spots) {
      const tp = new TreasurePickup(this, spot.x, spot.y, spot.gold);
      this.treasures.push(tp);
    }
  }

  // ========== SAFE ZONE ==========

  private drawSafeZone(): void {
    const g = this.safeZoneGraphics;
    g.clear();

    const mapW = this.balance.map.worldWidth;
    const mapH = this.balance.map.worldHeight;
    const cx = mapW / 2;
    const cy = mapH / 2;

    if (this.gameTime >= this.balance.map.safeZoneShrinkStart - 30) {
      g.fillStyle(0xE84545, 0.06);
      g.fillRect(0, 0, mapW, mapH);
      g.fillStyle(0x0D2137, 0.06);
      g.fillCircle(cx, cy, this.safeZoneRadius);
      g.lineStyle(3, 0xE84545, 0.5);
      g.strokeCircle(cx, cy, this.safeZoneRadius);
      // Pulsing inner warning
      const pulse = 0.3 + Math.sin(this.gameTime * 3) * 0.1;
      g.lineStyle(1, 0xFFFFFF, pulse);
      const nextR = Math.max(100, this.safeZoneRadius - this.balance.map.safeZoneShrinkAmount);
      g.strokeCircle(cx, cy, nextR);
    }
  }

  // ========== GAME STATE ==========

  private checkGameState(allShips: Ship[]): void {
    const alive = allShips.filter(s => !s.isDead);
    const myTeam = this.player.team;
    this.aliveCount = alive.filter(s => s.team === myTeam).length;

    // Award kills (find nearest enemy as "killer")
    for (const ship of allShips) {
      if (ship.isDead && ship.active === false && !(ship as any).__killAwarded) {
        (ship as any).__killAwarded = true;
        const killers = allShips.filter(s => s !== ship && !s.isDead && s.team !== ship.team);
        if (killers.length > 0) {
          const killer = killers.reduce((closest, e) => {
            const d1 = Phaser.Math.Distance.Between(ship.x, ship.y, e.x, e.y);
            const d2 = Phaser.Math.Distance.Between(ship.x, ship.y, closest.x, closest.y);
            return d1 < d2 ? e : closest;
          });
          killer.gold += this.balance.economy.shipKillGold;
          killer.kills++;
          if (killer === this.player) {
            EventBus.emit('gold-changed', this.player.gold);
            // XP from kill
            const xpGain = ship.team === 2 ? 60 : 100;
            if (this.player.addXp(xpGain)) {
              EventBus.emit('level-up', this.player.level);
            }
          }
        }
      }
    }

    // === Win/Lose conditions ===
    // SP win: enemy nexus dead
    // SP lose: player nexus dead (player ship death = respawn, not game over)
    if (!this.gameOver && !this.isMultiplayer) {
      if (this.enemyNexus && this.enemyNexus.isDead) {
        this.gameOver = true;
        this.time.delayedCall(1500, () => {
          EventBus.emit('game-over', {
            won: true,
            placement: 1,
            kills: this.player.kills,
            gold: this.player.gold,
            time: this.gameTime,
          });
        });
        return;
      }
      if (this.playerNexus && this.playerNexus.isDead) {
        this.gameOver = true;
        this.time.delayedCall(1500, () => {
          EventBus.emit('game-over', {
            won: false,
            placement: this.waveNumber,
            kills: this.player.kills,
            gold: this.player.gold,
            time: this.gameTime,
          });
        });
        return;
      }
      // Player ship died → trigger respawn (NOT game over)
      if (this.player.isDead && !this.respawnPending) {
        this.respawnPending = true;
        this.respawnTimer = this.RESPAWN_DURATION;
        EventBus.emit('respawn-start', this.RESPAWN_DURATION);
      }
    }

    // MP: player death = game over (no nexus in MP for now)
    if (this.isMultiplayer && this.player.isDead && !this.gameOver) {
      this.gameOver = true;
      NetworkManager.sendPlayerAction({ type: 'death' });
      this.time.delayedCall(1500, () => {
        EventBus.emit('game-over', {
          won: false,
          placement: this.waveNumber,
          kills: this.player.kills,
          gold: this.player.gold,
          time: this.gameTime,
        });
      });
    }
    if (this.isMultiplayer && !this.gameOver) {
      const aliveEnemies = this.enemies.filter(s => !s.isDead);
      const aliveAllies = this.allies.filter(s => !s.isDead);
      if (aliveEnemies.length === 0 && (aliveAllies.length > 0 || !this.player.isDead)) {
        this.gameOver = true;
        this.time.delayedCall(1000, () => {
          EventBus.emit('game-over', {
            won: true,
            placement: 1,
            kills: this.player.kills,
            gold: this.player.gold,
            time: this.gameTime,
          });
        });
      }
    }
  }

  // ========== SHIP UPGRADE ==========

  /** AFK triggered — bot takes over, save stats, go to title */
  private triggerAfk(): void {
    this.afkTriggered = true;

    // Convert player to bot (AI takes over)
    if (!this.player.isDead) {
      this.player.isBot = true;
      this.allies.push(this.player);
    }

    // Save stats
    UserProfile.saveGame({
      kills: this.player.kills,
      wave: this.waveNumber,
      gold: this.player.gold,
      won: false,
      shipId: this.player.config.id,
    });

    // Show AFK overlay
    EventBus.emit('afk-triggered');

    // Return to title after 4 seconds
    this.time.delayedCall(4000, () => {
      this.scene.stop('UIScene');
      this.scene.start('TitleScene');
    });
  }

  /** Respawn the player at base with previous loadout */
  private respawnPlayer(): void {
    const cfg = this.player.config;
    const items = this.player.getAllItems();
    const gold = this.player.gold;
    const kills = this.player.kills;

    this.player.destroy();

    const mapW = this.balance.map.worldWidth;
    const mapH = this.balance.map.worldHeight;
    const baseX = this.playerNexus?.x ?? mapW / 2;
    const baseY = this.playerNexus?.y ?? mapH * 0.85;
    const spawn = this.findSafeSpawn(baseX, baseY - 80, mapW, mapH);

    this.player = new Ship(this, spawn.x, spawn.y, cfg, 0, false);
    this.player.gold = gold;
    this.player.kills = kills;
    this.player.heading = -Math.PI / 2;
    this.player.targetHeading = -Math.PI / 2;
    for (const item of items) {
      this.player.equipItem(item);
    }

    // Camera follow new player
    this.cameras.main.startFollow(this.player, true, 0.06, 0.06);

    EventBus.emit('respawn-complete');
    EventBus.emit('items-changed', this.player.getAllItems());
    EventBus.emit('gold-changed', this.player.gold);
    EventBus.emit('toast', '⚓ Respawned at base', '#3DC47E');
  }

  // ========== PIRATE NPC AI ==========

  /** Pirates patrol their zone and chase nearby human players */
  private updatePirateAI(delta: number): void {
    const allPirates = [...this.pirateNPCs, ...this.pirateBosses];
    for (const pirate of allPirates) {
      if (pirate.isDead) continue;

      // Find nearest HUMAN player (non-bot, any team)
      const humanShips = [this.player].filter(s => !s.isDead);
      let target: Ship | null = null;
      let targetDist = Infinity;
      for (const h of humanShips) {
        const d = Phaser.Math.Distance.Between(pirate.x, pirate.y, h.x, h.y);
        if (d < targetDist) {
          target = h;
          targetDist = d;
        }
      }

      // Boss pirates stay near their shop (leash radius)
      const isBoss = this.pirateBosses.includes(pirate);
      const lootInfo = this.bossShopLoot.get(pirate.__id);
      const homeX = lootInfo?.x ?? pirate.x;
      const homeY = lootInfo?.y ?? pirate.y;
      const leashRadius = isBoss ? 250 : 400;

      let tx: number, ty: number;

      if (target && targetDist < (isBoss ? 300 : 450)) {
        // Chase player
        const range = pirate.maxRange || 200;
        if (targetDist > range * 0.85) {
          tx = target.x;
          ty = target.y;
        } else {
          // In range — strafe around player
          const angle = Phaser.Math.Angle.Between(pirate.x, pirate.y, target.x, target.y);
          const perp = angle + Math.PI / 2;
          tx = pirate.x + Math.cos(perp) * 60;
          ty = pirate.y + Math.sin(perp) * 60;
        }

        // Leash check — boss won't go too far from home
        if (isBoss) {
          const distFromHome = Phaser.Math.Distance.Between(tx, ty, homeX, homeY);
          if (distFromHome > leashRadius) {
            tx = homeX + Phaser.Math.Between(-50, 50);
            ty = homeY + Phaser.Math.Between(-50, 50);
          }
        }
      } else {
        // No target — wander near home
        tx = homeX + Math.cos(this.gameTime * 0.3 + pirate.__id) * 80;
        ty = homeY + Math.sin(this.gameTime * 0.4 + pirate.__id) * 60;
      }

      pirate.targetHeading = Phaser.Math.Angle.Between(pirate.x, pirate.y, tx, ty);
      pirate.throttle = target && targetDist < 400 ? 1.0 : 0.4;
      pirate.applyMovement(delta);
      pirate.updateVisuals(delta);
    }
  }

  /** When a boss pirate dies, drop rare loot */
  private checkBossDrops(): void {
    const rareWeapons = ['railgun', 'plasma_cannon', 'nuke_launcher', 'mega_tesla',
      'smart_bomb', 'orbital_cannon', 'heavy_sniper', 'inferno'];

    for (const boss of this.pirateBosses) {
      const loot = this.bossShopLoot.get(boss.__id);
      if (!loot) continue;

      if (boss.isDead && !loot.claimed) {
        loot.claimed = true;
        // Award player big gold + rare weapon
        if (!this.player.isDead) {
          this.player.gold += 800;
          const weaponId = rareWeapons[Phaser.Math.Between(0, rareWeapons.length - 1)];
          const weapon = this.balance.items[weaponId];
          if (weapon) {
            this.player.equipItem({ ...weapon } as WeaponItemConfig);
            EventBus.emit('items-changed', this.player.getAllItems());
            EventBus.emit('toast', `👑 해적왕의 보물! +800g + ${weapon.displayName}!`, '#FFD700');
          }
          EventBus.emit('gold-changed', this.player.gold);
          AudioManager.pickup();
        }
      }
    }
  }

  /** Activate the player's signature skill (called from UI button or key) */
  activatePlayerSkill(): void {
    if (!this.player || this.player.isDead) return;
    const skill = this.player.config.skill;
    if (!skill) return;
    if (this.player.skillCooldown > 0) {
      EventBus.emit('toast', `⏱ ${Math.ceil(this.player.skillCooldown)}s cooldown`, '#F5A623');
      return;
    }

    // Buff-type skills handled inside Ship.useSkill()
    const used = this.player.useSkill();
    if (!used) return;
    AudioManager.skill();

    const heading = this.player.heading;

    switch (skill.type) {
      case 'fire_breath': {
        // Cone of flame projectiles from front of ship
        const front = this.player.getCannonWorldPos(0);
        const range = skill.range ?? 280;
        for (let i = 0; i < 14; i++) {
          const offset = (i - 6.5) * 0.07;
          const angle = heading + offset;
          const aimX = front.x + Math.cos(angle) * range;
          const aimY = front.y + Math.sin(angle) * range;
          const p = new Projectile(this, front.x, front.y, aimX, aimY, 380, (skill.damage ?? 280) / 6, 'flame', 0, this.player.team);
          p.maxRange = range;
          this.autoAttack.projectiles.push(p);
        }
        EventBus.emit('toast', '🐲 화염 분사!', '#FF6622');
        break;
      }
      case 'salvo': {
        // Reset all weapon cooldowns so they fire next frame
        const weapons = this.player.getWeapons();
        const map = (this.autoAttack as any).cooldowns as Map<Ship, number[]>;
        const arr = map.get(this.player);
        if (arr) for (let i = 0; i < arr.length; i++) arr[i] = 0;
        EventBus.emit('toast', `💥 전 포 일제사격! (${weapons.length})`, '#FFDD66');
        break;
      }
      case 'broadside': {
        // Same as salvo
        const map = (this.autoAttack as any).cooldowns as Map<Ship, number[]>;
        const arr = map.get(this.player);
        if (arr) for (let i = 0; i < arr.length; i++) arr[i] = 0;
        EventBus.emit('toast', '⚔ 측면 일제사격!', '#FFDD66');
        break;
      }
      case 'volley': {
        const front = this.player.getCannonWorldPos(0);
        const range = skill.range ?? 280;
        const dmg = skill.damage ?? 60;
        for (let i = 0; i < 16; i++) {
          const offset = (i - 7.5) * 0.07;
          const angle = heading + offset;
          const aimX = front.x + Math.cos(angle) * range;
          const aimY = front.y + Math.sin(angle) * range;
          const p = new Projectile(this, front.x, front.y, aimX, aimY, 600, dmg, 'piercing', 0, this.player.team);
          p.maxRange = range;
          this.autoAttack.projectiles.push(p);
        }
        EventBus.emit('toast', '🏹 화살 비!', '#FFDD66');
        break;
      }
      case 'tracer_round': {
        const front = this.player.getCannonWorldPos(0);
        const range = skill.range ?? 500;
        const aimX = front.x + Math.cos(heading) * range;
        const aimY = front.y + Math.sin(heading) * range;
        const p = new Projectile(this, front.x, front.y, aimX, aimY, 1500, skill.damage ?? 350, 'rail', 0, this.player.team);
        p.maxRange = range;
        this.autoAttack.projectiles.push(p);
        EventBus.emit('toast', '🎯 일격필살!', '#FF3366');
        break;
      }
      case 'plane_burst': {
        // Launch 4 planes immediately
        for (let i = 0; i < 4; i++) {
          const offset = (i - 1.5) * 35;
          const px = this.player.x + Math.cos(heading + Math.PI / 2) * offset;
          const py = this.player.y + Math.sin(heading + Math.PI / 2) * offset;
          const plane = new Plane(this, px, py, this.player.team, heading);
          this.planes.push(plane);
        }
        EventBus.emit('toast', '✈ 비상 출격!', '#88CCFF');
        break;
      }
      case 'plunder':
        EventBus.emit('toast', '🩹 약탈! HP +40%', '#3DC47E');
        break;
      case 'berserk':
        EventBus.emit('toast', '⚡ 광전사 모드!', '#FF6633');
        break;
      case 'dash':
        EventBus.emit('toast', '💨 대시!', '#88CCFF');
        break;
      case 'ram':
        EventBus.emit('toast', '🔱 충각 돌격!', '#FFAA66');
        break;
      case 'smoke_screen':
        EventBus.emit('toast', '💨 연막 전개!', '#888888');
        break;
      case 'stealth':
        EventBus.emit('toast', '🌊 잠항!', '#4499AA');
        break;

      case 'heal_aura': {
        // Heal all allies within radius
        const healRange = skill.range ?? 250;
        const healAmount = skill.damage ?? 200;
        const allShipsList = [this.player, ...this.allies];
        let healed = 0;
        for (const s of allShipsList) {
          if (s.isDead) continue;
          const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, s.x, s.y);
          if (d <= healRange) {
            s.heal(healAmount);
            healed++;
            // Green heal VFX per ship
            const healGfx = this.add.graphics().setDepth(8);
            healGfx.fillStyle(0x3DC47E, 0.5);
            healGfx.fillCircle(s.x, s.y, 20);
            this.tweens.add({ targets: healGfx, alpha: 0, scaleX: 2, scaleY: 2, duration: 600, onComplete: () => healGfx.destroy() });
          }
        }
        // Heal zone ring VFX
        const ring = this.add.graphics().setDepth(7);
        ring.lineStyle(3, 0x3DC47E, 0.7);
        ring.strokeCircle(this.player.x, this.player.y, healRange);
        this.tweens.add({ targets: ring, alpha: 0, duration: 800, onComplete: () => ring.destroy() });
        EventBus.emit('toast', `💚 함대 수리! ${healed}척 +${healAmount}HP`, '#3DC47E');
        break;
      }

      case 'net_throw': {
        // Slow all enemies in area (50% speed reduction for duration)
        const netRange = skill.range ?? 300;
        const netDuration = (skill.duration ?? 4) * 1000;
        const allEnemies = [...this.enemies, ...this.pirateNPCs, ...this.pirateBosses];
        let netted = 0;
        for (const e of allEnemies) {
          if (e.isDead) continue;
          const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, e.x, e.y);
          if (d <= netRange) {
            // Apply slow via dash remaining (repurpose as slow — negative speed)
            e.dashRemaining = -(skill.duration ?? 4); // negative = slow mode
            netted++;
          }
        }
        // Net VFX — crosshatch circle
        const netGfx = this.add.graphics().setDepth(7);
        netGfx.lineStyle(2, 0x88AACC, 0.6);
        netGfx.strokeCircle(this.player.x, this.player.y, netRange);
        // Crosshatch lines
        for (let i = -netRange; i < netRange; i += 30) {
          netGfx.lineBetween(this.player.x + i, this.player.y - netRange, this.player.x + i + 40, this.player.y + netRange);
        }
        this.tweens.add({ targets: netGfx, alpha: 0, duration: 2000, onComplete: () => netGfx.destroy() });
        EventBus.emit('toast', `🕸 그물 투척! ${netted}척 속박!`, '#88AACC');
        break;
      }

      case 'war_cry': {
        // Buff nearby allies — speed + damage boost for duration
        const cryRange = 300;
        const cryDuration = skill.duration ?? 6;
        const allShipsList = [this.player, ...this.allies];
        let buffed = 0;
        for (const s of allShipsList) {
          if (s.isDead) continue;
          const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, s.x, s.y);
          if (d <= cryRange) {
            s.berserkRemaining = cryDuration; // reuse berserk for attack speed buff
            s.dashRemaining = cryDuration * 0.5; // slight speed boost
            buffed++;
          }
        }
        // War cry VFX — expanding golden ring
        const cryGfx = this.add.graphics().setDepth(7);
        cryGfx.lineStyle(4, 0xFFD700, 0.8);
        cryGfx.strokeCircle(this.player.x, this.player.y, 50);
        this.tweens.add({
          targets: cryGfx, scaleX: cryRange / 50, scaleY: cryRange / 50, alpha: 0,
          duration: 800, onComplete: () => cryGfx.destroy(),
        });
        EventBus.emit('toast', `🥁 전쟁의 북! ${buffed}척 강화!`, '#FFD700');
        break;
      }
    }
    EventBus.emit('skill-used');
  }

  upgradePlayerShip(newShipId: ShipId): boolean {
    const newConfig = this.balance.ships[newShipId];
    if (!newConfig) return false;

    const oldPlayer = this.player;
    const items = oldPlayer.getAllItems();
    const gold = oldPlayer.gold;
    const kills = oldPlayer.kills;

    // Destroy old player
    oldPlayer.destroy();

    // Spawn new ship at base (not current position) — like dry-dock launch
    const mapW = this.balance.map.worldWidth;
    const mapH = this.balance.map.worldHeight;
    const baseX = this.playerNexus?.x ?? mapW / 2;
    const baseY = this.playerNexus?.y ?? mapH * 0.85;
    const spawn = this.findSafeSpawn(baseX, baseY - 80, mapW, mapH);

    this.player = new Ship(this, spawn.x, spawn.y, newConfig, 0, false);
    this.player.gold = gold;
    this.player.kills = kills;
    this.player.heading = -Math.PI / 2;       // facing toward enemy base
    this.player.targetHeading = -Math.PI / 2;

    // Re-equip items (respecting new slot limits)
    for (const item of items) {
      this.player.equipItem(item);
    }

    // Update camera follow
    this.cameras.main.startFollow(this.player, true, 0.06, 0.06);

    // Snap camera to new position immediately to avoid jarring scroll
    this.cameras.main.centerOn(this.player.x, this.player.y);

    EventBus.emit('items-changed', this.player.getAllItems());
    EventBus.emit('gold-changed', this.player.gold);
    EventBus.emit('ship-changed', newShipId);
    return true;
  }
}
