import Phaser from 'phaser';
import balanceData from '../../docs/balance.json';

export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: 'BootScene' });
  }

  preload(): void {
    this.cache.json.add('balance', balanceData);

    // Loading bar
    const w = this.scale.width;
    const h = this.scale.height;
    const bar = this.add.graphics();
    const box = this.add.graphics();
    box.fillStyle(0x132240, 0.8);
    box.fillRect(w * 0.2, h / 2 - 15, w * 0.6, 30);

    this.load.on('progress', (value: number) => {
      bar.clear();
      bar.fillStyle(0xF5A623, 1);
      bar.fillRect(w * 0.2 + 5, h / 2 - 10, (w * 0.6 - 10) * value, 20);
    });

    this.load.on('complete', () => {
      bar.destroy();
      box.destroy();
    });

    // === Asset loading ===
    const T = 'textures';
    // Ships
    this.load.image('ship_destroyer', `${T}/ships/destroyer.png`);
    this.load.image('ship_cruiser', `${T}/ships/cruiser.png`);
    this.load.image('ship_battleship', `${T}/ships/battleship.png`);
    this.load.image('ship_submarine', `${T}/ships/submarine.png`);
    this.load.image('ship_rescue', `${T}/ships/rescue.png`);
    this.load.image('ship_plane', `${T}/ships/plane.png`);

    // Weapons
    this.load.image('weapon_destroyer', `${T}/weapons/destroyer_w.png`);
    this.load.image('weapon_cruiser', `${T}/weapons/cruiser_w.png`);
    this.load.image('weapon_battleship', `${T}/weapons/battleship_w.png`);
    this.load.image('weapon_submarine', `${T}/weapons/submarine_w.png`);

    // Map
    this.load.image('water_tile', `${T}/map/water.png`);
    this.load.image('tiled_sea', `${T}/map/tiled_sea.png`);

    // Effects (explosion 11 frames, fire 4 frames)
    for (let i = 1; i <= 11; i++) {
      this.load.image(`explosion_${i}`, `${T}/effects/explosion_${i}.png`);
    }
    for (let i = 1; i <= 4; i++) {
      this.load.image(`fire_${i}`, `${T}/effects/fire_${i}.png`);
    }

    // UI
    this.load.image('crosshair', `${T}/ui/crosshair.png`);

    // === AI-generated top-down ship PNGs (Whisk-sourced) ===
    // Loaded under key `ship_gen_{id}`. Shop + gameplay prefer these when present;
    // missing files silently fall back to the procedural ship_*_hq sprites.
    const genIds = [
      'patrolboat', 'destroyer', 'cruiser', 'battleship', 'carrier', 'submarine',
      'yamato', 'iowa', 'hood', 'akagi', 'pyotr', 'turtleship', 'panokseon',
      'galleon', 'trireme', 'viking', 'pirate',
      'kraken', 'phoenix', 'ghostship', 'thundership',
      'medic', 'seawitch',
    ];
    for (const id of genIds) {
      this.load.image(`ship_gen_${id}`, `${T}/ships_gen/${id}.png`);
    }

    // AI-generated weapon/equipment icons (Whisk-sourced).
    // Loaded as `weapon_gen_{cat}`; shop prefers these over procedural icons.
    const weaponCats = ['sniper', 'rapid', 'splash', 'pierce', 'homing', 'chain', 'flame', 'beam', 'armor', 'special'];
    for (const cat of weaponCats) {
      this.load.image(`weapon_gen_${cat}`, `${T}/weapons_gen/${cat}.png`);
    }
  }

  create(): void {
    // Pixel-art friendly: nearest-neighbor scaling for sharp pixels
    // (Only used for raster assets we still want pixelated — most ships
    // are now procedural high-res with smooth LINEAR filtering.)
    const pixelKeys = [
      'ship_plane', 'ship_rescue',
      'weapon_destroyer', 'weapon_cruiser', 'weapon_battleship', 'weapon_submarine',
      'water_tile', 'tiled_sea', 'crosshair',
    ];
    for (const key of pixelKeys) {
      const tex = this.textures.get(key);
      if (tex) tex.setFilter(Phaser.Textures.FilterMode.NEAREST);
    }
    for (let i = 1; i <= 11; i++) {
      const tex = this.textures.get(`explosion_${i}`);
      if (tex) tex.setFilter(Phaser.Textures.FilterMode.NEAREST);
    }
    for (let i = 1; i <= 4; i++) {
      const tex = this.textures.get(`fire_${i}`);
      if (tex) tex.setFilter(Phaser.Textures.FilterMode.NEAREST);
    }

    // Generate a procedural seamless water tile (avoids "carpet" pattern from
    // tiling a sprite sheet that contains multiple variants).
    this.generateWaterTexture();

    // Cinematic vignette overlay (radial gradient, transparent center, dark edges)
    this.generateVignetteTexture();

    // Soft glow blob for muzzle flashes / explosions
    this.generateGlowTexture();

    // Procedural item icons (one per weapon category + armor + special)
    this.generateItemIcons();

    // Historical ship sprites (procedural, top-down)
    this.generateHistoricalShips();

    // Realistic high-res procedural modern ships (replaces pixel art)
    this.generateRealisticShips();

    // Build animations
    this.anims.create({
      key: 'explosion_anim',
      frames: Array.from({ length: 11 }, (_, i) => ({ key: `explosion_${i + 1}` })),
      frameRate: 22,
      repeat: 0,
    });

    this.anims.create({
      key: 'fire_anim',
      frames: Array.from({ length: 4 }, (_, i) => ({ key: `fire_${i + 1}` })),
      frameRate: 8,
      repeat: -1,
    });

    this.scene.start('TitleScene');
  }

  /** Generate a seamless tileable water texture procedurally.
   * Sea-like noise with deep/shallow gradient and subtle ripples. */
  private generateWaterTexture(): void {
    const SIZE = 256;
    const canvas = document.createElement('canvas');
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext('2d')!;
    const img = ctx.createImageData(SIZE, SIZE);

    // Seamless tileable noise via cosine wraparound
    const sampleNoise = (x: number, y: number): number => {
      const u = x / SIZE;
      const v = y / SIZE;
      // Multiple octaves of seamless cosine noise
      let n = 0;
      n += Math.sin(u * Math.PI * 2 * 3 + 0.5) * Math.cos(v * Math.PI * 2 * 3 + 1.2) * 0.5;
      n += Math.sin(u * Math.PI * 2 * 6 + 2.1) * Math.cos(v * Math.PI * 2 * 6 + 0.8) * 0.25;
      n += Math.sin(u * Math.PI * 2 * 12 + 1.7) * Math.cos(v * Math.PI * 2 * 12 + 2.4) * 0.125;
      n += Math.sin(u * Math.PI * 2 * 24 + 3.1) * Math.cos(v * Math.PI * 2 * 24 + 0.3) * 0.0625;
      return n;
    };

    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const n = sampleNoise(x, y);
        // Base ocean color: deep blue
        const baseR = 18;
        const baseG = 52;
        const baseB = 88;
        // Highlight color: lighter teal
        const hiR = 60;
        const hiG = 110;
        const hiB = 150;
        // n in roughly -1..1
        const t = Math.max(0, Math.min(1, (n + 0.6) / 1.2));
        const r = Math.floor(baseR + (hiR - baseR) * t);
        const g = Math.floor(baseG + (hiG - baseG) * t);
        const b = Math.floor(baseB + (hiB - baseB) * t);
        const idx = (y * SIZE + x) * 4;
        img.data[idx] = r;
        img.data[idx + 1] = g;
        img.data[idx + 2] = b;
        img.data[idx + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    if (this.textures.exists('water_proc')) this.textures.remove('water_proc');
    this.textures.addCanvas('water_proc', canvas);
  }

  /** Cinematic radial vignette: transparent center, dark edges */
  private generateVignetteTexture(): void {
    const SIZE = 512;
    const canvas = document.createElement('canvas');
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext('2d')!;
    const grad = ctx.createRadialGradient(
      SIZE / 2, SIZE / 2, SIZE * 0.25,
      SIZE / 2, SIZE / 2, SIZE * 0.75,
    );
    grad.addColorStop(0, 'rgba(0, 0, 0, 0)');
    grad.addColorStop(0.6, 'rgba(0, 0, 20, 0.15)');
    grad.addColorStop(1, 'rgba(0, 0, 30, 0.65)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, SIZE, SIZE);
    if (this.textures.exists('vignette')) this.textures.remove('vignette');
    this.textures.addCanvas('vignette', canvas);
  }

  /** Soft circular glow blob for additive lighting */
  private generateGlowTexture(): void {
    const SIZE = 128;
    const canvas = document.createElement('canvas');
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext('2d')!;
    const grad = ctx.createRadialGradient(
      SIZE / 2, SIZE / 2, 0,
      SIZE / 2, SIZE / 2, SIZE / 2,
    );
    grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
    grad.addColorStop(0.3, 'rgba(255, 220, 100, 0.7)');
    grad.addColorStop(1, 'rgba(255, 200, 50, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, SIZE, SIZE);
    if (this.textures.exists('glow')) this.textures.remove('glow');
    this.textures.addCanvas('glow', canvas);
  }

  // ============ ITEM ICONS ============

  private makeIcon(key: string, draw: (ctx: CanvasRenderingContext2D, S: number) => void): void {
    const SIZE = 64;
    const canvas = document.createElement('canvas');
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext('2d')!;
    // Background tile (rounded square frame)
    ctx.fillStyle = 'rgba(20, 30, 50, 0.0)';
    ctx.fillRect(0, 0, SIZE, SIZE);
    draw(ctx, SIZE);
    if (this.textures.exists(key)) this.textures.remove(key);
    this.textures.addCanvas(key, canvas);
  }

  private generateItemIcons(): void {
    const S = 64;

    // === SNIPER: long single barrel ===
    this.makeIcon('icon_sniper', (ctx) => {
      // Body
      ctx.fillStyle = '#3A4A5C';
      ctx.fillRect(8, S/2 - 8, 14, 16);
      // Long barrel
      ctx.fillStyle = '#88AACC';
      ctx.fillRect(22, S/2 - 3, S - 28, 6);
      // Scope
      ctx.fillStyle = '#222';
      ctx.fillRect(14, S/2 - 14, 8, 6);
      ctx.fillStyle = '#88FFFF';
      ctx.fillRect(15, S/2 - 13, 6, 2);
      // Highlight
      ctx.fillStyle = '#CCEEFF';
      ctx.fillRect(22, S/2 - 3, S - 28, 1);
    });

    // === RAPID: 3 stacked barrels ===
    this.makeIcon('icon_rapid', (ctx) => {
      ctx.fillStyle = '#553322';
      ctx.fillRect(6, S/2 - 14, 8, 28);
      ctx.fillStyle = '#AA6633';
      for (let i = 0; i < 3; i++) {
        ctx.fillRect(14, S/2 - 11 + i * 8, S - 20, 5);
      }
      // muzzle highlights
      ctx.fillStyle = '#FFCC44';
      for (let i = 0; i < 3; i++) {
        ctx.fillRect(S - 8, S/2 - 10 + i * 8, 4, 3);
      }
    });

    // === SPLASH: round bomb with fuse ===
    this.makeIcon('icon_splash', (ctx) => {
      // Bomb body
      ctx.fillStyle = '#222';
      ctx.beginPath();
      ctx.arc(S/2, S/2 + 4, 18, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#444';
      ctx.beginPath();
      ctx.arc(S/2 - 4, S/2 + 1, 5, 0, Math.PI * 2);
      ctx.fill();
      // Fuse
      ctx.strokeStyle = '#888';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(S/2, S/2 - 14);
      ctx.lineTo(S/2 + 8, S/2 - 22);
      ctx.stroke();
      // Spark
      ctx.fillStyle = '#FFAA00';
      ctx.beginPath();
      ctx.arc(S/2 + 9, S/2 - 22, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.arc(S/2 + 9, S/2 - 22, 2, 0, Math.PI * 2);
      ctx.fill();
    });

    // === PIERCE: arrow/spear pointing right ===
    this.makeIcon('icon_pierce', (ctx) => {
      // Shaft
      ctx.fillStyle = '#998866';
      ctx.fillRect(8, S/2 - 2, S - 24, 4);
      // Tip (triangle)
      ctx.fillStyle = '#DDEEFF';
      ctx.beginPath();
      ctx.moveTo(S - 4, S/2);
      ctx.lineTo(S - 18, S/2 - 9);
      ctx.lineTo(S - 18, S/2 + 9);
      ctx.closePath();
      ctx.fill();
      // Tail fletching
      ctx.fillStyle = '#CC4444';
      ctx.beginPath();
      ctx.moveTo(8, S/2 - 7);
      ctx.lineTo(2, S/2);
      ctx.lineTo(8, S/2 + 7);
      ctx.closePath();
      ctx.fill();
    });

    // === HOMING: missile with fins ===
    this.makeIcon('icon_homing', (ctx) => {
      // Body
      ctx.fillStyle = '#888888';
      ctx.fillRect(8, S/2 - 6, S - 22, 12);
      // Nose cone
      ctx.fillStyle = '#CCCCCC';
      ctx.beginPath();
      ctx.moveTo(S - 4, S/2);
      ctx.lineTo(S - 14, S/2 - 8);
      ctx.lineTo(S - 14, S/2 + 8);
      ctx.closePath();
      ctx.fill();
      // Fins (top + bottom)
      ctx.fillStyle = '#666666';
      ctx.beginPath();
      ctx.moveTo(8, S/2 - 6);
      ctx.lineTo(0, S/2 - 14);
      ctx.lineTo(14, S/2 - 6);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(8, S/2 + 6);
      ctx.lineTo(0, S/2 + 14);
      ctx.lineTo(14, S/2 + 6);
      ctx.fill();
      // Exhaust flame
      ctx.fillStyle = '#FFAA00';
      ctx.fillRect(2, S/2 - 4, 6, 8);
      ctx.fillStyle = '#FFFF66';
      ctx.fillRect(0, S/2 - 2, 4, 4);
      // Window
      ctx.fillStyle = '#88DDFF';
      ctx.fillRect(S - 22, S/2 - 2, 4, 4);
    });

    // === CHAIN: lightning bolt ===
    this.makeIcon('icon_chain', (ctx) => {
      ctx.fillStyle = '#CCBBFF';
      ctx.beginPath();
      ctx.moveTo(S/2 - 4, 6);
      ctx.lineTo(S/2 + 8, S/2 - 6);
      ctx.lineTo(S/2, S/2);
      ctx.lineTo(S/2 + 10, S - 6);
      ctx.lineTo(S/2 - 4, S/2 + 6);
      ctx.lineTo(S/2 + 4, S/2 - 2);
      ctx.lineTo(S/2 - 8, S/2 - 2);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      // Glow dots
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(S/2 - 3, 8, 2, 2);
      ctx.fillRect(S/2 + 6, S - 12, 2, 2);
    });

    // === FLAME: stylized flame shape ===
    this.makeIcon('icon_flame', (ctx) => {
      // Outer flame
      ctx.fillStyle = '#FF3300';
      ctx.beginPath();
      ctx.moveTo(S/2, 4);
      ctx.bezierCurveTo(S/2 + 18, S/2 - 4, S/2 + 14, S - 8, S/2, S - 4);
      ctx.bezierCurveTo(S/2 - 14, S - 8, S/2 - 18, S/2 - 4, S/2, 4);
      ctx.fill();
      // Mid flame
      ctx.fillStyle = '#FF8800';
      ctx.beginPath();
      ctx.moveTo(S/2, 12);
      ctx.bezierCurveTo(S/2 + 12, S/2, S/2 + 9, S - 10, S/2, S - 8);
      ctx.bezierCurveTo(S/2 - 9, S - 10, S/2 - 12, S/2, S/2, 12);
      ctx.fill();
      // Inner flame
      ctx.fillStyle = '#FFDD00';
      ctx.beginPath();
      ctx.moveTo(S/2, 22);
      ctx.bezierCurveTo(S/2 + 6, S/2 + 4, S/2 + 4, S - 14, S/2, S - 12);
      ctx.bezierCurveTo(S/2 - 4, S - 14, S/2 - 6, S/2 + 4, S/2, 22);
      ctx.fill();
    });

    // === BEAM: laser beam horizontal ===
    this.makeIcon('icon_beam', (ctx) => {
      // Emitter body
      ctx.fillStyle = '#444466';
      ctx.fillRect(6, S/2 - 12, 16, 24);
      ctx.fillStyle = '#666688';
      ctx.fillRect(8, S/2 - 10, 12, 20);
      // Lens
      ctx.fillStyle = '#FF3366';
      ctx.beginPath();
      ctx.arc(20, S/2, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.arc(20, S/2, 3, 0, Math.PI * 2);
      ctx.fill();
      // Beam
      const grad = ctx.createLinearGradient(20, S/2, S - 4, S/2);
      grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
      grad.addColorStop(0.5, 'rgba(255, 100, 150, 0.8)');
      grad.addColorStop(1, 'rgba(255, 50, 100, 0)');
      ctx.fillStyle = grad;
      ctx.fillRect(20, S/2 - 3, S - 24, 6);
    });

    // === ARMOR: shield ===
    this.makeIcon('icon_armor', (ctx) => {
      // Shield outline
      ctx.fillStyle = '#2A4A7A';
      ctx.beginPath();
      ctx.moveTo(S/2, 6);
      ctx.lineTo(S - 12, 14);
      ctx.lineTo(S - 12, S/2 + 4);
      ctx.quadraticCurveTo(S - 12, S - 8, S/2, S - 4);
      ctx.quadraticCurveTo(12, S - 8, 12, S/2 + 4);
      ctx.lineTo(12, 14);
      ctx.closePath();
      ctx.fill();
      // Shield inside
      ctx.fillStyle = '#4A8AC0';
      ctx.beginPath();
      ctx.moveTo(S/2, 12);
      ctx.lineTo(S - 16, 18);
      ctx.lineTo(S - 16, S/2 + 4);
      ctx.quadraticCurveTo(S - 16, S - 12, S/2, S - 8);
      ctx.quadraticCurveTo(16, S - 12, 16, S/2 + 4);
      ctx.lineTo(16, 18);
      ctx.closePath();
      ctx.fill();
      // Cross
      ctx.fillStyle = '#FFDD66';
      ctx.fillRect(S/2 - 2, 18, 4, 22);
      ctx.fillRect(S/2 - 8, 26, 16, 4);
    });

    // === SPECIAL: gear/cog ===
    this.makeIcon('icon_special', (ctx) => {
      const cx = S/2;
      const cy = S/2;
      // Gear teeth
      ctx.fillStyle = '#888';
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const x = cx + Math.cos(a) * 22;
        const y = cy + Math.sin(a) * 22;
        ctx.beginPath();
        ctx.arc(x, y, 5, 0, Math.PI * 2);
        ctx.fill();
      }
      // Outer ring
      ctx.fillStyle = '#666';
      ctx.beginPath();
      ctx.arc(cx, cy, 20, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#AAA';
      ctx.beginPath();
      ctx.arc(cx, cy, 16, 0, Math.PI * 2);
      ctx.fill();
      // Center hole
      ctx.fillStyle = '#222';
      ctx.beginPath();
      ctx.arc(cx, cy, 6, 0, Math.PI * 2);
      ctx.fill();
      // Highlight
      ctx.strokeStyle = '#CCEEFF';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx - 4, cy - 4, 14, Math.PI * 1.0, Math.PI * 1.5);
      ctx.stroke();
    });
  }

  // ============ HISTORICAL SHIP SPRITES ============

  /** Make a top-down ship texture. Canvas is W x H, ship points UP. */
  private makeShip(key: string, W: number, H: number, draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void): void {
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d')!;
    draw(ctx, W, H);
    if (this.textures.exists(key)) this.textures.remove(key);
    this.textures.addCanvas(key, canvas);
  }

  private generateHistoricalShips(): void {
    // ===== 거북선 (Turtle Ship) =====
    // Iconic Korean ironclad with dragon head, spiked roof, cannon ports
    this.makeShip('ship_turtleship', 64, 160, (ctx, W, H) => {
      const cx = W / 2;
      // Hull shadow under
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.beginPath();
      ctx.ellipse(cx + 1, H * 0.55, W * 0.42, H * 0.42, 0, 0, Math.PI * 2);
      ctx.fill();

      // Wooden hull (oval)
      ctx.fillStyle = '#5C3A1A';
      ctx.beginPath();
      ctx.ellipse(cx, H * 0.55, W * 0.4, H * 0.4, 0, 0, Math.PI * 2);
      ctx.fill();
      // Hull plank lines
      ctx.strokeStyle = '#3A2410';
      ctx.lineWidth = 1;
      for (let i = -2; i <= 2; i++) {
        ctx.beginPath();
        ctx.ellipse(cx, H * 0.55 + i * 6, W * 0.38, H * 0.38, 0, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Green spiked roof (turtle shell back)
      const grad = ctx.createRadialGradient(cx, H * 0.5, 5, cx, H * 0.5, 28);
      grad.addColorStop(0, '#5C8A3A');
      grad.addColorStop(1, '#2A5A1A');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.ellipse(cx, H * 0.55, W * 0.32, H * 0.34, 0, 0, Math.PI * 2);
      ctx.fill();

      // Iron spikes (dots in pattern)
      ctx.fillStyle = '#888888';
      const spikes = [
        [cx - 8, H * 0.35], [cx + 8, H * 0.35],
        [cx - 12, H * 0.5], [cx, H * 0.5], [cx + 12, H * 0.5],
        [cx - 8, H * 0.65], [cx + 8, H * 0.65],
        [cx, H * 0.45], [cx, H * 0.6],
      ];
      for (const [sx, sy] of spikes) {
        ctx.beginPath();
        ctx.arc(sx, sy, 2.5, 0, Math.PI * 2);
        ctx.fill();
        // highlight
        ctx.fillStyle = '#CCCCCC';
        ctx.beginPath();
        ctx.arc(sx - 0.6, sy - 0.6, 1, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#888888';
      }

      // Dragon head at bow (top, pointing up)
      ctx.fillStyle = '#AA1A1A';
      ctx.beginPath();
      ctx.moveTo(cx, 4);
      ctx.lineTo(cx - 12, 22);
      ctx.lineTo(cx - 6, 26);
      ctx.lineTo(cx, 22);
      ctx.lineTo(cx + 6, 26);
      ctx.lineTo(cx + 12, 22);
      ctx.closePath();
      ctx.fill();
      // Dragon eyes
      ctx.fillStyle = '#FFFF00';
      ctx.fillRect(cx - 5, 14, 2, 2);
      ctx.fillRect(cx + 3, 14, 2, 2);
      // Dragon teeth (white tips)
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(cx - 1, 22, 2, 3);

      // Cannon ports on sides (port + starboard)
      ctx.fillStyle = '#1A1010';
      for (let i = 0; i < 4; i++) {
        const py = H * 0.4 + i * 12;
        ctx.fillRect(cx - W * 0.4 + 2, py, 4, 4);
        ctx.fillRect(cx + W * 0.4 - 6, py, 4, 4);
      }

      // Stern decoration (golden trim at bottom)
      ctx.fillStyle = '#DDAA22';
      ctx.fillRect(cx - 8, H - 12, 16, 3);
    });

    // ===== 판옥선 (Panokseon) =====
    // Two-tier Korean sail warship with painted hull
    this.makeShip('ship_panokseon', 60, 170, (ctx, W, H) => {
      const cx = W / 2;
      // Shadow
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.beginPath();
      ctx.ellipse(cx + 1, H * 0.55 + 2, W * 0.42, H * 0.45, 0, 0, Math.PI * 2);
      ctx.fill();

      // Hull base (wide curved)
      ctx.fillStyle = '#7A4A22';
      ctx.beginPath();
      ctx.moveTo(cx, 8);
      ctx.bezierCurveTo(cx + W * 0.45, H * 0.2, cx + W * 0.45, H * 0.85, cx, H - 6);
      ctx.bezierCurveTo(cx - W * 0.45, H * 0.85, cx - W * 0.45, H * 0.2, cx, 8);
      ctx.closePath();
      ctx.fill();

      // Red trim
      ctx.fillStyle = '#AA2222';
      ctx.fillRect(cx - W * 0.4, H * 0.35, W * 0.8, 3);
      ctx.fillRect(cx - W * 0.4, H * 0.65, W * 0.8, 3);

      // Blue middle band
      ctx.fillStyle = '#2244AA';
      ctx.fillRect(cx - W * 0.35, H * 0.42, W * 0.7, 14);

      // Upper deck (raised area)
      ctx.fillStyle = '#5A3015';
      ctx.fillRect(cx - W * 0.3, H * 0.42, W * 0.6, H * 0.16);

      // Mast (single tall pole)
      ctx.fillStyle = '#3A2010';
      ctx.fillRect(cx - 1.5, H * 0.25, 3, H * 0.5);

      // Square sail (folded look)
      ctx.fillStyle = '#EEDDAA';
      ctx.fillRect(cx - W * 0.32, H * 0.3, W * 0.64, H * 0.18);
      ctx.strokeStyle = '#AA8855';
      ctx.lineWidth = 1;
      // Sail panels
      for (let i = 1; i < 4; i++) {
        ctx.beginPath();
        ctx.moveTo(cx - W * 0.32 + i * (W * 0.16), H * 0.3);
        ctx.lineTo(cx - W * 0.32 + i * (W * 0.16), H * 0.48);
        ctx.stroke();
      }

      // Cannon dots on hull
      ctx.fillStyle = '#1A1010';
      for (let i = 0; i < 3; i++) {
        const py = H * 0.55 + i * 10;
        ctx.fillRect(cx - W * 0.42, py, 4, 3);
        ctx.fillRect(cx + W * 0.42 - 4, py, 4, 3);
      }

      // Bow ornament (dragon-like)
      ctx.fillStyle = '#DDAA22';
      ctx.beginPath();
      ctx.moveTo(cx, 4);
      ctx.lineTo(cx - 5, 14);
      ctx.lineTo(cx + 5, 14);
      ctx.closePath();
      ctx.fill();
    });

    // ===== Galleon (Spanish/European) =====
    this.makeShip('ship_galleon', 60, 180, (ctx, W, H) => {
      const cx = W / 2;
      // Shadow
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.beginPath();
      ctx.ellipse(cx + 1, H * 0.55 + 2, W * 0.4, H * 0.45, 0, 0, Math.PI * 2);
      ctx.fill();

      // Curved hull (galleon shape)
      ctx.fillStyle = '#6A3A1A';
      ctx.beginPath();
      ctx.moveTo(cx, 6);
      ctx.bezierCurveTo(cx + W * 0.42, H * 0.18, cx + W * 0.45, H * 0.7, cx + W * 0.32, H - 8);
      ctx.lineTo(cx - W * 0.32, H - 8);
      ctx.bezierCurveTo(cx - W * 0.45, H * 0.7, cx - W * 0.42, H * 0.18, cx, 6);
      ctx.closePath();
      ctx.fill();

      // Hull plank lines
      ctx.strokeStyle = '#4A2410';
      ctx.lineWidth = 0.5;
      for (let i = 0; i < 6; i++) {
        ctx.beginPath();
        ctx.moveTo(cx - W * 0.4, H * 0.2 + i * 14);
        ctx.lineTo(cx + W * 0.4, H * 0.2 + i * 14);
        ctx.stroke();
      }

      // Yellow trim
      ctx.fillStyle = '#DDAA33';
      ctx.fillRect(cx - W * 0.4, H * 0.2, W * 0.8, 2);
      ctx.fillRect(cx - W * 0.4, H * 0.85, W * 0.8, 2);

      // 3 masts (3 circles for top-down view)
      const mastPositions = [H * 0.25, H * 0.5, H * 0.75];
      for (const my of mastPositions) {
        // Sail (rectangle behind mast)
        ctx.fillStyle = '#EEEEDD';
        ctx.fillRect(cx - W * 0.35, my - 8, W * 0.7, 16);
        ctx.strokeStyle = '#AAAA88';
        ctx.lineWidth = 0.5;
        ctx.strokeRect(cx - W * 0.35, my - 8, W * 0.7, 16);
        // Mast
        ctx.fillStyle = '#3A2010';
        ctx.beginPath();
        ctx.arc(cx, my, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }

      // Cannon ports (rows of dark squares)
      ctx.fillStyle = '#1A1010';
      for (let i = 0; i < 5; i++) {
        const py = H * 0.3 + i * 10;
        ctx.fillRect(cx - W * 0.42, py, 3, 3);
        ctx.fillRect(cx + W * 0.42 - 3, py, 3, 3);
      }

      // Spanish flag at stern
      ctx.fillStyle = '#FFCC22';
      ctx.fillRect(cx - 4, H - 12, 8, 5);
      ctx.fillStyle = '#CC2222';
      ctx.fillRect(cx - 4, H - 12, 8, 1);
      ctx.fillRect(cx - 4, H - 8, 8, 1);
    });

    // ===== Pirate Frigate =====
    this.makeShip('ship_pirate', 56, 170, (ctx, W, H) => {
      const cx = W / 2;
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.beginPath();
      ctx.ellipse(cx + 1, H * 0.55 + 2, W * 0.4, H * 0.45, 0, 0, Math.PI * 2);
      ctx.fill();

      // Black hull
      ctx.fillStyle = '#1A1A1A';
      ctx.beginPath();
      ctx.moveTo(cx, 6);
      ctx.bezierCurveTo(cx + W * 0.42, H * 0.2, cx + W * 0.42, H * 0.8, cx, H - 6);
      ctx.bezierCurveTo(cx - W * 0.42, H * 0.8, cx - W * 0.42, H * 0.2, cx, 6);
      ctx.closePath();
      ctx.fill();

      // Plank lines
      ctx.strokeStyle = '#333333';
      ctx.lineWidth = 0.5;
      for (let i = 0; i < 6; i++) {
        ctx.beginPath();
        ctx.moveTo(cx - W * 0.4, H * 0.2 + i * 14);
        ctx.lineTo(cx + W * 0.4, H * 0.2 + i * 14);
        ctx.stroke();
      }

      // Red trim
      ctx.fillStyle = '#882222';
      ctx.fillRect(cx - W * 0.38, H * 0.2, W * 0.76, 1);
      ctx.fillRect(cx - W * 0.38, H * 0.82, W * 0.76, 1);

      // 2 masts with white sails
      const masts = [H * 0.32, H * 0.62];
      for (const my of masts) {
        ctx.fillStyle = '#F5F5E8';
        ctx.fillRect(cx - W * 0.32, my - 9, W * 0.64, 18);
        // Sail wear marks
        ctx.fillStyle = '#DDD8C8';
        ctx.fillRect(cx - W * 0.3, my - 6, W * 0.6, 3);
        ctx.fillStyle = '#3A2010';
        ctx.beginPath();
        ctx.arc(cx, my, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }

      // Skull on the foresail
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.arc(cx, H * 0.32, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#FFF';
      ctx.fillRect(cx - 1, H * 0.32 - 1, 1, 1);
      ctx.fillRect(cx, H * 0.32 - 1, 1, 1);
      ctx.fillRect(cx - 1, H * 0.32 + 1, 3, 1);

      // Cannon ports
      ctx.fillStyle = '#000000';
      for (let i = 0; i < 4; i++) {
        const py = H * 0.3 + i * 12;
        ctx.fillRect(cx - W * 0.42, py, 3, 3);
        ctx.fillRect(cx + W * 0.42 - 3, py, 3, 3);
      }
    });

    // ===== Viking Longship =====
    this.makeShip('ship_viking', 44, 180, (ctx, W, H) => {
      const cx = W / 2;
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.beginPath();
      ctx.ellipse(cx + 1, H * 0.5 + 2, W * 0.4, H * 0.46, 0, 0, Math.PI * 2);
      ctx.fill();

      // Long narrow hull
      ctx.fillStyle = '#6A4A22';
      ctx.beginPath();
      ctx.moveTo(cx, 4);
      ctx.bezierCurveTo(cx + W * 0.4, H * 0.15, cx + W * 0.4, H * 0.85, cx, H - 4);
      ctx.bezierCurveTo(cx - W * 0.4, H * 0.85, cx - W * 0.4, H * 0.15, cx, 4);
      ctx.closePath();
      ctx.fill();

      // Plank lines
      ctx.strokeStyle = '#4A2A10';
      ctx.lineWidth = 0.5;
      for (let i = 0; i < 8; i++) {
        ctx.beginPath();
        ctx.moveTo(cx - W * 0.38, H * 0.18 + i * 12);
        ctx.lineTo(cx + W * 0.38, H * 0.18 + i * 12);
        ctx.stroke();
      }

      // Round shields on sides (alternating colors)
      const shieldColors = ['#CC2222', '#DDAA22', '#2266AA'];
      for (let i = 0; i < 7; i++) {
        const sy = H * 0.22 + i * 18;
        const color = shieldColors[i % shieldColors.length];
        // Shield outer
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(cx - W * 0.4 + 1, sy, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(cx + W * 0.4 - 1, sy, 5, 0, Math.PI * 2);
        ctx.fill();
        // Shield boss (center)
        ctx.fillStyle = '#888';
        ctx.beginPath();
        ctx.arc(cx - W * 0.4 + 1, sy, 1.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(cx + W * 0.4 - 1, sy, 1.5, 0, Math.PI * 2);
        ctx.fill();
      }

      // Single mast at center
      ctx.fillStyle = '#3A2010';
      ctx.beginPath();
      ctx.arc(cx, H * 0.5, 3, 0, Math.PI * 2);
      ctx.fill();
      // Square red sail
      ctx.fillStyle = '#CC3322';
      ctx.fillRect(cx - W * 0.3, H * 0.4, W * 0.6, H * 0.2);
      // Sail stripes
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(cx - W * 0.3, H * 0.43, W * 0.6, 2);
      ctx.fillRect(cx - W * 0.3, H * 0.5, W * 0.6, 2);
      ctx.fillRect(cx - W * 0.3, H * 0.57, W * 0.6, 2);

      // Dragon head at bow (top)
      ctx.fillStyle = '#AA3322';
      ctx.beginPath();
      ctx.moveTo(cx, 1);
      ctx.lineTo(cx - 5, 12);
      ctx.lineTo(cx + 5, 12);
      ctx.closePath();
      ctx.fill();
      // Dragon eye
      ctx.fillStyle = '#FFFF00';
      ctx.fillRect(cx - 1, 7, 2, 2);

      // Curved stern
      ctx.fillStyle = '#5A3A12';
      ctx.beginPath();
      ctx.arc(cx, H - 2, 4, 0, Math.PI);
      ctx.fill();
    });

    // ===== Trireme (Greek/Roman galley) =====
    this.makeShip('ship_trireme', 40, 180, (ctx, W, H) => {
      const cx = W / 2;
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.beginPath();
      ctx.ellipse(cx + 1, H * 0.5 + 2, W * 0.4, H * 0.45, 0, 0, Math.PI * 2);
      ctx.fill();

      // Sleek dark hull
      ctx.fillStyle = '#3A2A1A';
      ctx.beginPath();
      ctx.moveTo(cx, 2);
      ctx.bezierCurveTo(cx + W * 0.38, H * 0.18, cx + W * 0.38, H * 0.85, cx + 4, H - 4);
      ctx.lineTo(cx - 4, H - 4);
      ctx.bezierCurveTo(cx - W * 0.38, H * 0.85, cx - W * 0.38, H * 0.18, cx, 2);
      ctx.closePath();
      ctx.fill();

      // White hull stripes
      ctx.fillStyle = '#EEEEDD';
      ctx.fillRect(cx - W * 0.36, H * 0.25, W * 0.72, 2);
      ctx.fillRect(cx - W * 0.36, H * 0.5, W * 0.72, 2);
      ctx.fillRect(cx - W * 0.36, H * 0.75, W * 0.72, 2);

      // Three rows of oars (lines on sides)
      ctx.strokeStyle = '#998866';
      ctx.lineWidth = 1;
      for (let i = 0; i < 12; i++) {
        const oy = H * 0.18 + i * 11;
        // Port oars
        ctx.beginPath();
        ctx.moveTo(cx - W * 0.38, oy);
        ctx.lineTo(cx - W * 0.6, oy + 2);
        ctx.stroke();
        // Starboard oars
        ctx.beginPath();
        ctx.moveTo(cx + W * 0.38, oy);
        ctx.lineTo(cx + W * 0.6, oy + 2);
        ctx.stroke();
      }

      // Bronze ram at bow
      ctx.fillStyle = '#BB8833';
      ctx.beginPath();
      ctx.moveTo(cx, 0);
      ctx.lineTo(cx - 5, 10);
      ctx.lineTo(cx + 5, 10);
      ctx.closePath();
      ctx.fill();
      // Ram tip
      ctx.fillStyle = '#DDAA44';
      ctx.fillRect(cx - 1, 1, 2, 4);

      // Eye painted on bow (Greek tradition)
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.arc(cx - 6, 18, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(cx + 6, 18, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.arc(cx - 6, 18, 1.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(cx + 6, 18, 1.5, 0, Math.PI * 2);
      ctx.fill();

      // Single mast with small sail (folded)
      ctx.fillStyle = '#3A2010';
      ctx.beginPath();
      ctx.arc(cx, H * 0.5, 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#DDDDCC';
      ctx.fillRect(cx - W * 0.25, H * 0.42, W * 0.5, 14);
    });
  }

  // ============ REALISTIC HIGH-RES PROCEDURAL SHIPS ============
  // High-resolution canvas ships with smooth gradients, soft shadows,
  // and anti-aliased edges. Uses LINEAR filter for crisp downsampling.

  private makeShipHQ(key: string, w: number, h: number, draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void): void {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    draw(ctx, w, h);
    if (this.textures.exists(key)) this.textures.remove(key);
    this.textures.addCanvas(key, canvas);
    // LINEAR filter for smooth scaling — explicitly NOT nearest
    const tex = this.textures.get(key);
    if (tex) tex.setFilter(Phaser.Textures.FilterMode.LINEAR);
  }

  /** Reusable: draw a soft drop shadow on water under the ship body */
  private drawWaterShadow(ctx: CanvasRenderingContext2D, cx: number, cy: number, hullW: number, hullH: number): void {
    ctx.save();
    const grad = ctx.createRadialGradient(cx + 4, cy + 6, hullW * 0.2, cx + 4, cy + 6, hullW * 1.1);
    grad.addColorStop(0, 'rgba(0, 5, 20, 0.55)');
    grad.addColorStop(0.6, 'rgba(0, 5, 20, 0.2)');
    grad.addColorStop(1, 'rgba(0, 5, 20, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(cx + 4, cy + 6, hullW * 0.6, hullH * 0.55, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /** Subtle plating lines across the deck */
  private drawPlating(ctx: CanvasRenderingContext2D, x1: number, x2: number, yStart: number, yEnd: number, count: number): void {
    ctx.save();
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.25)';
    ctx.lineWidth = 0.8;
    for (let i = 0; i < count; i++) {
      const t = i / (count - 1);
      const y = yStart + (yEnd - yStart) * t;
      ctx.beginPath();
      ctx.moveTo(x1, y);
      ctx.lineTo(x2, y);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** Refined twin-barrel turret with shadow + gradient + barrels */
  private drawTurretRefined(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, barrelLen: number, dir: 1 | -1 = 1): void {
    // Drop shadow
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.beginPath();
    ctx.arc(cx + 1.5, cy + 2, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Base radial gradient (light upper-left, dark bottom-right)
    const grad = ctx.createRadialGradient(cx - r * 0.4, cy - r * 0.5, 0, cx, cy, r * 1.2);
    grad.addColorStop(0, '#9BA5AE');
    grad.addColorStop(0.4, '#5A6470');
    grad.addColorStop(0.85, '#2A3038');
    grad.addColorStop(1, '#15191E');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();

    // Inner highlight ring
    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.85, 0, Math.PI * 2);
    ctx.stroke();
    // Outer dark border
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();

    // Twin barrels (two parallel)
    const offset = r * 0.35;
    const barrelW = 2.8;
    [-offset, offset].forEach(off => {
      // Shadow
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(cx + off - barrelW / 2 + 0.5, cy - barrelLen * dir + (dir > 0 ? 0 : barrelLen), barrelW, barrelLen);
      // Body
      const bg = ctx.createLinearGradient(cx + off - barrelW / 2, 0, cx + off + barrelW / 2, 0);
      bg.addColorStop(0, '#1A1F26');
      bg.addColorStop(0.5, '#3D4450');
      bg.addColorStop(1, '#1A1F26');
      ctx.fillStyle = bg;
      ctx.fillRect(cx + off - barrelW / 2, cy - barrelLen * dir + (dir > 0 ? 0 : barrelLen), barrelW, barrelLen);
      // Muzzle ring
      const muzzleY = cy - barrelLen * dir + (dir > 0 ? 0 : barrelLen) + (dir < 0 ? barrelLen - 1 : 0);
      ctx.fillStyle = '#0A0D12';
      ctx.fillRect(cx + off - barrelW / 2, muzzleY, barrelW, 1.5);
    });
  }

  /** Parameterized battleship drawer — produces variants for famous nations */
  private drawBattleshipVariant(
    ctx: CanvasRenderingContext2D,
    W: number,
    H: number,
    cfg: {
      hullDark: string;
      hullMid: string;
      hullLight: string;
      platingDark: string;
      forwardTurrets: number;     // 1-3 main turrets at bow
      midTurrets: number;          // 0-6 secondary side guns
      rearTurrets: number;         // 0-3 main turrets at stern
      towerStyle: 'modern' | 'pagoda' | 'classic';
      stackCount: number;          // 0-2 smoke stacks
      accentStripe: string;        // small national accent color
      accentDot?: boolean;         // red sun dot for Yamato
      wideHull?: boolean;
    },
  ): void {
    const cx = W / 2;
    const cy = H / 2;
    const widthMul = cfg.wideHull === false ? 0.95 : 1;

    // 1. Drop shadow on water
    this.drawWaterShadow(ctx, cx, cy + 6, W * 0.6 * widthMul, H * 0.55);

    // 2. Hull silhouette
    ctx.beginPath();
    ctx.moveTo(cx, H * 0.03);
    ctx.bezierCurveTo(cx + W * 0.36 * widthMul, H * 0.12, cx + W * 0.42 * widthMul, H * 0.3, cx + W * 0.42 * widthMul, H * 0.6);
    ctx.bezierCurveTo(cx + W * 0.42 * widthMul, H * 0.88, cx + W * 0.36 * widthMul, H * 0.96, cx + W * 0.32 * widthMul, H * 0.98);
    ctx.lineTo(cx - W * 0.32 * widthMul, H * 0.98);
    ctx.bezierCurveTo(cx - W * 0.36 * widthMul, H * 0.96, cx - W * 0.42 * widthMul, H * 0.88, cx - W * 0.42 * widthMul, H * 0.6);
    ctx.bezierCurveTo(cx - W * 0.42 * widthMul, H * 0.3, cx - W * 0.36 * widthMul, H * 0.12, cx, H * 0.03);
    ctx.closePath();

    // 3. Hull base — multi-stop gradient (dark → mid → dark)
    const hullGrad = ctx.createLinearGradient(0, 0, W, 0);
    hullGrad.addColorStop(0, cfg.hullDark);
    hullGrad.addColorStop(0.25, cfg.hullMid);
    hullGrad.addColorStop(0.5, cfg.hullLight);
    hullGrad.addColorStop(0.75, cfg.hullMid);
    hullGrad.addColorStop(1, cfg.hullDark);
    ctx.save();
    ctx.fillStyle = hullGrad;
    ctx.fill();

    // 4. Top sun overlay
    const topLight = ctx.createLinearGradient(0, 0, 0, H);
    topLight.addColorStop(0, 'rgba(255, 250, 240, 0.18)');
    topLight.addColorStop(0.4, 'rgba(0, 0, 0, 0)');
    topLight.addColorStop(1, 'rgba(0, 0, 0, 0.4)');
    ctx.fillStyle = topLight;
    ctx.fill();
    ctx.restore();

    // 5. Plating lines (refined — closer spacing, varying alpha)
    ctx.save();
    ctx.strokeStyle = cfg.platingDark;
    ctx.lineWidth = 0.6;
    ctx.globalAlpha = 0.6;
    for (let i = 0; i < 18; i++) {
      const y = H * 0.1 + i * (H * 0.84 / 17);
      ctx.beginPath();
      ctx.moveTo(cx - W * 0.38 * widthMul, y);
      ctx.lineTo(cx + W * 0.38 * widthMul, y);
      ctx.stroke();
    }
    ctx.restore();

    // 6. Vertical seam at center
    ctx.save();
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(cx, H * 0.05);
    ctx.lineTo(cx, H * 0.95);
    ctx.stroke();
    ctx.restore();

    // 7. Subtle weathering stains
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(cx + W * 0.25 * widthMul, H * 0.55, 4, 14);
    ctx.fillRect(cx - W * 0.28 * widthMul, H * 0.4, 3, 12);
    ctx.fillRect(cx + W * 0.18 * widthMul, H * 0.7, 3, 10);
    ctx.restore();

    // 8. Forward main turrets (stacked at bow)
    const turretSizes = [16, 14, 12];
    let yCursor = H * 0.13;
    for (let i = 0; i < cfg.forwardTurrets; i++) {
      const sz = turretSizes[i] ?? 12;
      this.drawTurretRefined(ctx, cx, yCursor, sz, sz + 6, 1);
      yCursor += sz + 8;
    }

    // 9. Massive command tower
    const tY = yCursor + 4;
    const tH = H * 0.28;
    const tW = W * 0.42 * widthMul;
    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(cx - tW / 2 + 2, tY + 2, tW, tH);
    // Tower body
    const tGrad = ctx.createLinearGradient(0, tY, 0, tY + tH);
    tGrad.addColorStop(0, '#7A848E');
    tGrad.addColorStop(0.3, '#4F5860');
    tGrad.addColorStop(1, '#22282E');
    ctx.fillStyle = tGrad;
    if (cfg.towerStyle === 'pagoda') {
      // Pagoda style — stepped tower (Japanese WWII signature)
      const steps = 4;
      for (let i = 0; i < steps; i++) {
        const w = tW * (1 - i * 0.18);
        const yy = tY + i * (tH / steps);
        const hh = tH / steps;
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(cx - w / 2 + 1, yy + 1, w, hh);
        const sg = ctx.createLinearGradient(0, yy, 0, yy + hh);
        sg.addColorStop(0, '#7A848E');
        sg.addColorStop(0.4, '#4F5860');
        sg.addColorStop(1, '#22282E');
        ctx.fillStyle = sg;
        ctx.fillRect(cx - w / 2, yy, w, hh);
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.fillRect(cx - w / 2, yy, w, 1);
      }
    } else if (cfg.towerStyle === 'classic') {
      // Classic British box tower
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(cx - tW / 2 + 1.5, tY + 1.5, tW, tH);
      ctx.fillStyle = tGrad;
      ctx.fillRect(cx - tW / 2, tY, tW, tH);
      // Tripod mast (signature British)
      ctx.strokeStyle = '#1A1A1A';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(cx, tY + tH * 0.3);
      ctx.lineTo(cx - 8, tY - 5);
      ctx.moveTo(cx, tY + tH * 0.3);
      ctx.lineTo(cx + 8, tY - 5);
      ctx.moveTo(cx, tY + tH * 0.3);
      ctx.lineTo(cx, tY - 12);
      ctx.stroke();
    } else {
      // Modern angular tower
      ctx.fillRect(cx - tW / 2, tY, tW, tH);
    }
    // Top highlight
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.fillRect(cx - tW / 2, tY, tW, 2);
    // Bridge windows
    ctx.fillStyle = '#0F1A28';
    ctx.fillRect(cx - tW / 2 + 5, tY + 5, tW - 10, 4);
    ctx.fillRect(cx - tW / 2 + 5, tY + 12, tW - 10, 4);
    if (cfg.towerStyle === 'modern') {
      ctx.fillRect(cx - tW / 2 + 5, tY + 19, tW - 10, 3);
    }

    // 10. Smoke stacks
    if (cfg.stackCount > 0) {
      const stackY = tY + tH * 0.55;
      for (let i = 0; i < cfg.stackCount; i++) {
        const sx = cx + (i - (cfg.stackCount - 1) / 2) * 14;
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(sx - 5, stackY, 10, 14);
        const sg = ctx.createLinearGradient(0, stackY, 0, stackY + 14);
        sg.addColorStop(0, '#65686C');
        sg.addColorStop(1, '#1A1A1F');
        ctx.fillStyle = sg;
        ctx.fillRect(sx - 4, stackY, 8, 13);
        // Black soot top
        ctx.fillStyle = '#0A0A0A';
        ctx.fillRect(sx - 4, stackY, 8, 2);
      }
    }

    // 11. Tall radar mast (modern only)
    if (cfg.towerStyle === 'modern') {
      ctx.fillStyle = '#1A1A1A';
      ctx.fillRect(cx - 1.5, tY - 18, 3, 22);
      ctx.fillRect(cx - 6, tY - 14, 12, 1.5);
      ctx.fillRect(cx - 4, tY - 8, 8, 1.5);
      // Radar dish
      ctx.fillStyle = '#888';
      ctx.beginPath();
      ctx.arc(cx, tY - 18, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // 12. Side mid turrets (secondary guns)
    const midStartY = tY + tH + 8;
    for (let i = 0; i < cfg.midTurrets; i++) {
      const isLeft = i % 2 === 0;
      const row = Math.floor(i / 2);
      const sx = cx + (isLeft ? -W * 0.28 * widthMul : W * 0.28 * widthMul);
      const sy = midStartY + row * 16;
      this.drawTurretRefined(ctx, sx, sy, 7, 12, 1);
    }

    // 13. Rear turrets (stacked at stern)
    let rearY = H * 0.92;
    for (let i = 0; i < cfg.rearTurrets; i++) {
      const sz = turretSizes[i] ?? 12;
      this.drawTurretRefined(ctx, cx, rearY, sz, sz + 6, -1);
      rearY -= sz + 8;
    }

    // 14. National accent stripe at stern
    ctx.fillStyle = cfg.accentStripe;
    ctx.fillRect(cx - 8, H * 0.96, 16, 2);

    // 15. Hinomaru (red sun dot for Japanese ships)
    if (cfg.accentDot) {
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.arc(cx, H * 0.6, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#CC1A2D';
      ctx.beginPath();
      ctx.arc(cx, H * 0.6, 4, 0, Math.PI * 2);
      ctx.fill();
    }

    // 16. Top hull highlight (catches light)
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(cx + 1, H * 0.05);
    ctx.bezierCurveTo(cx + W * 0.35 * widthMul, H * 0.13, cx + W * 0.4 * widthMul, H * 0.5, cx + W * 0.4 * widthMul, H * 0.85);
    ctx.stroke();
    ctx.restore();

    // 17. Bow wake (V-shape water foam)
    ctx.save();
    ctx.fillStyle = 'rgba(220, 230, 240, 0.4)';
    ctx.beginPath();
    ctx.moveTo(cx, H * 0.02);
    ctx.lineTo(cx - W * 0.42 * widthMul, H * 0.18);
    ctx.lineTo(cx - W * 0.32 * widthMul, H * 0.1);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx, H * 0.02);
    ctx.lineTo(cx + W * 0.42 * widthMul, H * 0.18);
    ctx.lineTo(cx + W * 0.32 * widthMul, H * 0.1);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  /** Draw a turret as a circle with gradient (legacy simple version) */
  private drawTurret(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, baseColor: string, barrelLen: number, barrelDir: 1 | -1 = 1): void {
    // Base circle gradient
    const grad = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.4, 0, cx, cy, r);
    grad.addColorStop(0, '#888888');
    grad.addColorStop(0.6, baseColor);
    grad.addColorStop(1, '#222222');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    // Outer ring
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 1;
    ctx.stroke();
    // Barrel(s)
    ctx.fillStyle = '#222';
    ctx.fillRect(cx - 1.5, cy - barrelLen * barrelDir, 3, barrelLen * Math.abs(barrelDir));
    ctx.fillStyle = '#444';
    ctx.fillRect(cx - 0.5, cy - barrelLen * barrelDir, 1, barrelLen * Math.abs(barrelDir));
  }

  private generateRealisticShips(): void {
    // === 통통배 (Patrolboat) — small wooden fishing boat ===
    this.makeShipHQ('ship_patrolboat_hq', 80, 160, (ctx, W, H) => {
      const cx = W / 2;
      const cy = H / 2;

      // Drop shadow on water
      this.drawWaterShadow(ctx, cx, cy + 4, W * 0.55, H * 0.5);

      // Hull silhouette — pointed bow, flat stern
      ctx.beginPath();
      ctx.moveTo(cx, H * 0.06);                                     // bow tip
      ctx.bezierCurveTo(cx + W * 0.42, H * 0.22, cx + W * 0.42, H * 0.85, cx + W * 0.36, H * 0.93);
      ctx.lineTo(cx - W * 0.36, H * 0.93);                          // flat stern
      ctx.bezierCurveTo(cx - W * 0.42, H * 0.85, cx - W * 0.42, H * 0.22, cx, H * 0.06);
      ctx.closePath();

      // Hull gradient — wood brown with darker edges
      const hullGrad = ctx.createLinearGradient(0, 0, W, 0);
      hullGrad.addColorStop(0, '#3A1F0E');
      hullGrad.addColorStop(0.3, '#6B3D1A');
      hullGrad.addColorStop(0.5, '#8B5A2B');
      hullGrad.addColorStop(0.7, '#6B3D1A');
      hullGrad.addColorStop(1, '#3A1F0E');
      ctx.save();
      ctx.fillStyle = hullGrad;
      ctx.fill();

      // Top lighting overlay
      const topLight = ctx.createLinearGradient(0, 0, 0, H);
      topLight.addColorStop(0, 'rgba(255, 220, 180, 0.18)');
      topLight.addColorStop(0.4, 'rgba(255, 220, 180, 0)');
      topLight.addColorStop(1, 'rgba(0, 0, 0, 0.25)');
      ctx.fillStyle = topLight;
      ctx.fill();
      ctx.restore();

      // Plank lines
      this.drawPlating(ctx, cx - W * 0.38, cx + W * 0.38, H * 0.18, H * 0.9, 8);

      // Inner deck (slightly inset and darker)
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(cx, H * 0.16);
      ctx.bezierCurveTo(cx + W * 0.32, H * 0.28, cx + W * 0.32, H * 0.78, cx + W * 0.27, H * 0.86);
      ctx.lineTo(cx - W * 0.27, H * 0.86);
      ctx.bezierCurveTo(cx - W * 0.32, H * 0.78, cx - W * 0.32, H * 0.28, cx, H * 0.16);
      ctx.closePath();
      ctx.fillStyle = 'rgba(20, 10, 0, 0.35)';
      ctx.fill();
      ctx.restore();

      // White-painted cabin
      const cabX = cx - W * 0.22;
      const cabY = H * 0.38;
      const cabW = W * 0.44;
      const cabH = H * 0.22;
      // Cabin shadow
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(cabX + 2, cabY + 2, cabW, cabH);
      // Cabin body
      const cabGrad = ctx.createLinearGradient(0, cabY, 0, cabY + cabH);
      cabGrad.addColorStop(0, '#F5EFD8');
      cabGrad.addColorStop(0.5, '#D8CDA8');
      cabGrad.addColorStop(1, '#9E8E68');
      ctx.fillStyle = cabGrad;
      ctx.fillRect(cabX, cabY, cabW, cabH);
      // Cabin window strip
      const winGrad = ctx.createLinearGradient(0, cabY + 5, 0, cabY + cabH * 0.55);
      winGrad.addColorStop(0, '#1A2A3A');
      winGrad.addColorStop(0.5, '#3D5872');
      winGrad.addColorStop(1, '#1A2A3A');
      ctx.fillStyle = winGrad;
      ctx.fillRect(cabX + 3, cabY + 4, cabW - 6, cabH * 0.4);
      // Window divider
      ctx.fillStyle = '#888';
      ctx.fillRect(cabX + cabW / 2 - 0.5, cabY + 4, 1, cabH * 0.4);
      // Cabin roof highlight
      ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.fillRect(cabX, cabY, cabW, 1.5);

      // Outboard motor at stern
      ctx.fillStyle = '#1A1A1A';
      ctx.fillRect(cx - 8, H * 0.85, 16, 14);
      // Motor cover
      const motorGrad = ctx.createLinearGradient(0, H * 0.85, 0, H * 0.99);
      motorGrad.addColorStop(0, '#4A4A50');
      motorGrad.addColorStop(0.5, '#2A2A30');
      motorGrad.addColorStop(1, '#1A1A1F');
      ctx.fillStyle = motorGrad;
      ctx.fillRect(cx - 7, H * 0.86, 14, 12);
      // Motor highlight
      ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
      ctx.fillRect(cx - 7, H * 0.86, 14, 1.5);
      // Propeller indicator (small metallic dot)
      ctx.fillStyle = '#888';
      ctx.fillRect(cx - 1, H * 0.96, 2, 3);

      // Bow rope cleat
      ctx.fillStyle = '#4A4A4A';
      ctx.beginPath();
      ctx.arc(cx, H * 0.14, 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#888';
      ctx.beginPath();
      ctx.arc(cx - 0.5, H * 0.135, 1, 0, Math.PI * 2);
      ctx.fill();

      // Top edge highlight (catches light from upper-left)
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 240, 200, 0.6)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(cx + 2, H * 0.08);
      ctx.bezierCurveTo(cx + W * 0.4, H * 0.22, cx + W * 0.4, H * 0.6, cx + W * 0.36, H * 0.85);
      ctx.stroke();
      ctx.restore();

      // Subtle weathering — small darker patches
      ctx.save();
      ctx.fillStyle = 'rgba(0, 0, 0, 0.18)';
      ctx.fillRect(cx + W * 0.15, H * 0.7, 4, 8);
      ctx.fillRect(cx - W * 0.2, H * 0.55, 3, 6);
      ctx.restore();
    });

    // === DESTROYER — sleek modern naval destroyer ===
    this.makeShipHQ('ship_destroyer_hq', 110, 320, (ctx, W, H) => {
      const cx = W / 2;
      const cy = H / 2;

      this.drawWaterShadow(ctx, cx, cy + 4, W * 0.5, H * 0.5);

      // Sleek hull — sharp pointed bow, narrow midbody, flat stern
      ctx.beginPath();
      ctx.moveTo(cx, H * 0.04);
      ctx.bezierCurveTo(cx + W * 0.28, H * 0.13, cx + W * 0.36, H * 0.25, cx + W * 0.36, H * 0.5);
      ctx.bezierCurveTo(cx + W * 0.36, H * 0.85, cx + W * 0.32, H * 0.95, cx + W * 0.28, H * 0.97);
      ctx.lineTo(cx - W * 0.28, H * 0.97);
      ctx.bezierCurveTo(cx - W * 0.32, H * 0.95, cx - W * 0.36, H * 0.85, cx - W * 0.36, H * 0.5);
      ctx.bezierCurveTo(cx - W * 0.36, H * 0.25, cx - W * 0.28, H * 0.13, cx, H * 0.04);
      ctx.closePath();

      // Steel gray hull gradient
      const hullGrad = ctx.createLinearGradient(0, 0, W, 0);
      hullGrad.addColorStop(0, '#2A3038');
      hullGrad.addColorStop(0.5, '#5A6470');
      hullGrad.addColorStop(1, '#2A3038');
      ctx.save();
      ctx.fillStyle = hullGrad;
      ctx.fill();
      // Top light
      const topLight = ctx.createLinearGradient(0, 0, 0, H);
      topLight.addColorStop(0, 'rgba(220, 230, 240, 0.2)');
      topLight.addColorStop(0.5, 'rgba(255, 255, 255, 0)');
      topLight.addColorStop(1, 'rgba(0, 0, 0, 0.3)');
      ctx.fillStyle = topLight;
      ctx.fill();
      ctx.restore();

      // Plating
      this.drawPlating(ctx, cx - W * 0.34, cx + W * 0.34, H * 0.12, H * 0.92, 10);

      // Deck stripe (slightly darker inset)
      ctx.fillStyle = 'rgba(20, 25, 30, 0.55)';
      ctx.beginPath();
      ctx.moveTo(cx, H * 0.1);
      ctx.bezierCurveTo(cx + W * 0.22, H * 0.18, cx + W * 0.27, H * 0.5, cx + W * 0.22, H * 0.93);
      ctx.lineTo(cx - W * 0.22, H * 0.93);
      ctx.bezierCurveTo(cx - W * 0.27, H * 0.5, cx - W * 0.22, H * 0.18, cx, H * 0.1);
      ctx.closePath();
      ctx.fill();

      // Forward main gun (turret 1) at front
      this.drawTurret(ctx, cx, H * 0.22, 11, '#3D4248', 18, 1);

      // Bridge / superstructure (rectangular block in middle)
      const bridgeY = H * 0.36;
      const bridgeH = H * 0.22;
      const bridgeW = W * 0.36;
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(cx - bridgeW / 2 + 1.5, bridgeY + 1.5, bridgeW, bridgeH);
      const brGrad = ctx.createLinearGradient(0, bridgeY, 0, bridgeY + bridgeH);
      brGrad.addColorStop(0, '#7A8388');
      brGrad.addColorStop(0.4, '#4A5258');
      brGrad.addColorStop(1, '#2A3035');
      ctx.fillStyle = brGrad;
      ctx.fillRect(cx - bridgeW / 2, bridgeY, bridgeW, bridgeH);
      // Bridge top highlight
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillRect(cx - bridgeW / 2, bridgeY, bridgeW, 1.5);
      // Bridge windows
      ctx.fillStyle = '#1A2A3A';
      ctx.fillRect(cx - bridgeW / 2 + 3, bridgeY + 4, bridgeW - 6, 4);

      // Radar mast (thin tower)
      ctx.fillStyle = '#222';
      ctx.fillRect(cx - 1, bridgeY - 8, 2, 10);
      // Radar dish (top)
      ctx.fillStyle = '#777';
      ctx.beginPath();
      ctx.arc(cx, bridgeY - 8, 3, 0, Math.PI * 2);
      ctx.fill();

      // Smoke stack
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(cx - 5, H * 0.62, 10, 8);
      const stackGrad = ctx.createLinearGradient(0, H * 0.62, 0, H * 0.7);
      stackGrad.addColorStop(0, '#5A5A60');
      stackGrad.addColorStop(1, '#2A2A30');
      ctx.fillStyle = stackGrad;
      ctx.fillRect(cx - 4, H * 0.62, 8, 7);

      // Rear gun turret
      this.drawTurret(ctx, cx, H * 0.78, 9, '#3D4248', 14, -1);

      // Top edge highlight on hull
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx + 1, H * 0.05);
      ctx.bezierCurveTo(cx + W * 0.27, H * 0.13, cx + W * 0.34, H * 0.5, cx + W * 0.34, H * 0.85);
      ctx.stroke();
      ctx.restore();
    });

    // === CRUISER — wider with multiple turrets ===
    this.makeShipHQ('ship_cruiser_hq', 130, 350, (ctx, W, H) => {
      const cx = W / 2;
      const cy = H / 2;

      this.drawWaterShadow(ctx, cx, cy + 4, W * 0.55, H * 0.52);

      ctx.beginPath();
      ctx.moveTo(cx, H * 0.04);
      ctx.bezierCurveTo(cx + W * 0.32, H * 0.13, cx + W * 0.4, H * 0.28, cx + W * 0.4, H * 0.55);
      ctx.bezierCurveTo(cx + W * 0.4, H * 0.86, cx + W * 0.34, H * 0.95, cx + W * 0.3, H * 0.97);
      ctx.lineTo(cx - W * 0.3, H * 0.97);
      ctx.bezierCurveTo(cx - W * 0.34, H * 0.95, cx - W * 0.4, H * 0.86, cx - W * 0.4, H * 0.55);
      ctx.bezierCurveTo(cx - W * 0.4, H * 0.28, cx - W * 0.32, H * 0.13, cx, H * 0.04);
      ctx.closePath();

      const hullGrad = ctx.createLinearGradient(0, 0, W, 0);
      hullGrad.addColorStop(0, '#26333E');
      hullGrad.addColorStop(0.5, '#506478');
      hullGrad.addColorStop(1, '#26333E');
      ctx.save();
      ctx.fillStyle = hullGrad;
      ctx.fill();
      const topLight = ctx.createLinearGradient(0, 0, 0, H);
      topLight.addColorStop(0, 'rgba(220, 230, 240, 0.2)');
      topLight.addColorStop(0.5, 'rgba(0, 0, 0, 0)');
      topLight.addColorStop(1, 'rgba(0, 0, 0, 0.3)');
      ctx.fillStyle = topLight;
      ctx.fill();
      ctx.restore();

      this.drawPlating(ctx, cx - W * 0.38, cx + W * 0.38, H * 0.12, H * 0.92, 10);

      // Forward turret
      this.drawTurret(ctx, cx, H * 0.18, 13, '#3A4250', 22, 1);

      // Bridge
      const bY = H * 0.32;
      const bH = H * 0.26;
      const bW = W * 0.42;
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(cx - bW / 2 + 1.5, bY + 1.5, bW, bH);
      const brGrad = ctx.createLinearGradient(0, bY, 0, bY + bH);
      brGrad.addColorStop(0, '#7A8590');
      brGrad.addColorStop(0.4, '#475058');
      brGrad.addColorStop(1, '#27303A');
      ctx.fillStyle = brGrad;
      ctx.fillRect(cx - bW / 2, bY, bW, bH);
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillRect(cx - bW / 2, bY, bW, 2);
      // Bridge windows
      ctx.fillStyle = '#1A2A3A';
      ctx.fillRect(cx - bW / 2 + 4, bY + 5, bW - 8, 5);
      // Twin smoke stacks
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(cx - 7, bY + bH * 0.4, 6, 10);
      ctx.fillRect(cx + 1, bY + bH * 0.4, 6, 10);
      const stk = ctx.createLinearGradient(0, bY + bH * 0.4, 0, bY + bH * 0.4 + 10);
      stk.addColorStop(0, '#5A5A60');
      stk.addColorStop(1, '#222');
      ctx.fillStyle = stk;
      ctx.fillRect(cx - 6, bY + bH * 0.4, 5, 9);
      ctx.fillRect(cx + 2, bY + bH * 0.4, 5, 9);

      // Mast
      ctx.fillStyle = '#222';
      ctx.fillRect(cx - 1, bY - 12, 2, 14);

      // Rear turrets (2)
      this.drawTurret(ctx, cx, H * 0.7, 11, '#3A4250', 18, -1);
      this.drawTurret(ctx, cx, H * 0.86, 9, '#3A4250', 14, -1);
    });

    // === BATTLESHIP CLASS — parameterized variants ===
    // KMS Bismarck (Germany, 1939) — flagship of Nazi Kriegsmarine
    this.makeShipHQ('ship_battleship_hq', 170, 420, (ctx, W, H) => {
      this.drawBattleshipVariant(ctx, W, H, {
        hullDark: '#22303A', hullMid: '#4F5C6A', hullLight: '#7A8590',
        platingDark: '#1A2228',
        forwardTurrets: 2, midTurrets: 4, rearTurrets: 2,
        towerStyle: 'modern', stackCount: 1,
        accentStripe: '#1A1A1A', // German Iron Cross dark
      });
    });

    // 🇯🇵 Yamato (1940) — largest battleship ever built, 18.1" guns
    this.makeShipHQ('ship_yamato_hq', 200, 460, (ctx, W, H) => {
      this.drawBattleshipVariant(ctx, W, H, {
        hullDark: '#1F2A35', hullMid: '#456070', hullLight: '#7BA0B5',
        platingDark: '#162028',
        forwardTurrets: 3, midTurrets: 4, rearTurrets: 2,
        towerStyle: 'pagoda', stackCount: 1,
        accentStripe: '#CC1A2D', // Hinomaru red
        accentDot: true,
      });
    });

    // 🇺🇸 USS Iowa (1942) — fast battleship, sleek design
    this.makeShipHQ('ship_iowa_hq', 175, 440, (ctx, W, H) => {
      this.drawBattleshipVariant(ctx, W, H, {
        hullDark: '#252D35', hullMid: '#5A6670', hullLight: '#8590A0',
        platingDark: '#1B2028',
        forwardTurrets: 2, midTurrets: 4, rearTurrets: 1,
        towerStyle: 'modern', stackCount: 2,
        accentStripe: '#FFFFFF',
        wideHull: false, // sleeker
      });
    });

    // 🇬🇧 HMS Hood (1920) — battlecruiser, lighter armor, faster
    this.makeShipHQ('ship_hood_hq', 165, 430, (ctx, W, H) => {
      this.drawBattleshipVariant(ctx, W, H, {
        hullDark: '#2A3540', hullMid: '#52606C', hullLight: '#7A8794',
        platingDark: '#1F2830',
        forwardTurrets: 2, midTurrets: 2, rearTurrets: 2,
        towerStyle: 'classic', stackCount: 2,
        accentStripe: '#0033A0', // Royal Navy blue
      });
    });

    // 🇷🇺 Pyotr Velikiy — Kirov-class nuclear battlecruiser
    this.makeShipHQ('ship_pyotr_hq', 170, 430, (ctx, W, H) => {
      this.drawBattleshipVariant(ctx, W, H, {
        hullDark: '#2B362C', hullMid: '#4F5E48', hullLight: '#7A8870',
        platingDark: '#1F2820',
        forwardTurrets: 1, midTurrets: 6, rearTurrets: 1,
        towerStyle: 'modern', stackCount: 1,
        accentStripe: '#CC0000', // Soviet red
      });
    });

    // === SUBMARINE — sleek black cigar with conning tower ===
    this.makeShipHQ('ship_submarine_hq', 90, 320, (ctx, W, H) => {
      const cx = W / 2;
      const cy = H / 2;

      this.drawWaterShadow(ctx, cx, cy + 4, W * 0.5, H * 0.55);

      // Pointed both ends, very thin
      ctx.beginPath();
      ctx.moveTo(cx, H * 0.02);
      ctx.bezierCurveTo(cx + W * 0.32, H * 0.12, cx + W * 0.36, H * 0.5, cx + W * 0.32, H * 0.88);
      ctx.bezierCurveTo(cx + W * 0.18, H * 0.96, cx - W * 0.18, H * 0.96, cx - W * 0.32, H * 0.88);
      ctx.bezierCurveTo(cx - W * 0.36, H * 0.5, cx - W * 0.32, H * 0.12, cx, H * 0.02);
      ctx.closePath();

      // Almost-black gradient (matte)
      const hullGrad = ctx.createLinearGradient(0, 0, W, 0);
      hullGrad.addColorStop(0, '#0A0E14');
      hullGrad.addColorStop(0.5, '#252A32');
      hullGrad.addColorStop(1, '#0A0E14');
      ctx.save();
      ctx.fillStyle = hullGrad;
      ctx.fill();
      const topLight = ctx.createLinearGradient(0, 0, 0, H);
      topLight.addColorStop(0, 'rgba(120, 140, 160, 0.18)');
      topLight.addColorStop(0.5, 'rgba(0, 0, 0, 0)');
      topLight.addColorStop(1, 'rgba(0, 0, 0, 0.4)');
      ctx.fillStyle = topLight;
      ctx.fill();
      ctx.restore();

      // Plating (subtle)
      this.drawPlating(ctx, cx - W * 0.32, cx + W * 0.32, H * 0.1, H * 0.92, 12);

      // Conning tower (raised box in middle)
      const tY = H * 0.4;
      const tH = H * 0.18;
      const tW = W * 0.28;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(cx - tW / 2 + 1, tY + 1, tW, tH);
      const tGrad = ctx.createLinearGradient(0, tY, 0, tY + tH);
      tGrad.addColorStop(0, '#3A4048');
      tGrad.addColorStop(0.5, '#1A1F24');
      tGrad.addColorStop(1, '#0A0D10');
      ctx.fillStyle = tGrad;
      ctx.fillRect(cx - tW / 2, tY, tW, tH);
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.fillRect(cx - tW / 2, tY, tW, 1);
      // Periscope
      ctx.fillStyle = '#222';
      ctx.fillRect(cx - 1, tY - 7, 2, 8);
      ctx.fillStyle = '#666';
      ctx.fillRect(cx - 2, tY - 8, 4, 1.5);

      // Diving planes (small triangles on sides)
      ctx.fillStyle = '#1A1F24';
      ctx.beginPath();
      ctx.moveTo(cx - W * 0.32, H * 0.62);
      ctx.lineTo(cx - W * 0.42, H * 0.66);
      ctx.lineTo(cx - W * 0.32, H * 0.7);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(cx + W * 0.32, H * 0.62);
      ctx.lineTo(cx + W * 0.42, H * 0.66);
      ctx.lineTo(cx + W * 0.32, H * 0.7);
      ctx.fill();

      // Top edge sheen
      ctx.save();
      ctx.strokeStyle = 'rgba(180, 200, 220, 0.3)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx + 1, H * 0.04);
      ctx.bezierCurveTo(cx + W * 0.3, H * 0.12, cx + W * 0.34, H * 0.5, cx + W * 0.3, H * 0.88);
      ctx.stroke();
      ctx.restore();
    });

    // === CARRIER — long flat-deck with island ===
    this.makeShipHQ('ship_carrier_hq', 180, 440, (ctx, W, H) => {
      const cx = W / 2;
      const cy = H / 2;

      this.drawWaterShadow(ctx, cx, cy + 6, W * 0.6, H * 0.55);

      // Rectangular long flat deck
      ctx.beginPath();
      ctx.moveTo(cx - W * 0.2, H * 0.04);
      ctx.bezierCurveTo(cx + W * 0.1, H * 0.04, cx + W * 0.42, H * 0.08, cx + W * 0.42, H * 0.18);
      ctx.lineTo(cx + W * 0.42, H * 0.88);
      ctx.bezierCurveTo(cx + W * 0.42, H * 0.95, cx + W * 0.3, H * 0.98, cx + W * 0.1, H * 0.98);
      ctx.lineTo(cx - W * 0.1, H * 0.98);
      ctx.bezierCurveTo(cx - W * 0.3, H * 0.98, cx - W * 0.42, H * 0.95, cx - W * 0.42, H * 0.88);
      ctx.lineTo(cx - W * 0.42, H * 0.18);
      ctx.bezierCurveTo(cx - W * 0.42, H * 0.08, cx - W * 0.1, H * 0.04, cx - W * 0.2, H * 0.04);
      ctx.closePath();

      // Steel gray
      const hullGrad = ctx.createLinearGradient(0, 0, W, 0);
      hullGrad.addColorStop(0, '#2A323A');
      hullGrad.addColorStop(0.5, '#525E68');
      hullGrad.addColorStop(1, '#2A323A');
      ctx.save();
      ctx.fillStyle = hullGrad;
      ctx.fill();
      ctx.restore();

      // Flight deck (darker overlay covering most of ship)
      ctx.save();
      ctx.fillStyle = '#1A1F24';
      ctx.beginPath();
      ctx.rect(cx - W * 0.36, H * 0.08, W * 0.72, H * 0.88);
      ctx.fill();
      // Center stripe (yellow take-off line)
      ctx.fillStyle = '#D4A847';
      ctx.fillRect(cx - 1, H * 0.1, 2, H * 0.84);
      // Dashed center line
      ctx.fillStyle = '#FFFFFF';
      for (let i = 0; i < 12; i++) {
        ctx.fillRect(cx - 0.5, H * 0.12 + i * (H * 0.07), 1, H * 0.025);
      }
      ctx.restore();

      // Island superstructure (right side of deck)
      const isX = cx + W * 0.22;
      const isY = H * 0.32;
      const isW = W * 0.16;
      const isH = H * 0.22;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(isX + 1.5, isY + 1.5, isW, isH);
      const isGrad = ctx.createLinearGradient(0, isY, 0, isY + isH);
      isGrad.addColorStop(0, '#7A848E');
      isGrad.addColorStop(0.4, '#4F5860');
      isGrad.addColorStop(1, '#22282E');
      ctx.fillStyle = isGrad;
      ctx.fillRect(isX, isY, isW, isH);
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillRect(isX, isY, isW, 1.5);
      // Island windows
      ctx.fillStyle = '#142030';
      ctx.fillRect(isX + 2, isY + 4, isW - 4, 3);
      // Mast on island
      ctx.fillStyle = '#222';
      ctx.fillRect(isX + isW / 2 - 1, isY - 12, 2, 14);
      ctx.fillRect(isX + isW / 2 - 4, isY - 8, 8, 1);

      // Aircraft outlines on deck (placeholder planes)
      ctx.fillStyle = 'rgba(180, 180, 180, 0.6)';
      const drawPlane = (x: number, y: number, sz: number) => {
        // Body
        ctx.fillRect(x - 1, y - sz, 2, sz * 2);
        // Wings
        ctx.fillRect(x - sz, y - sz * 0.2, sz * 2, 1.5);
        // Tail
        ctx.fillRect(x - sz * 0.4, y + sz * 0.6, sz * 0.8, 1);
      };
      drawPlane(cx - W * 0.18, H * 0.18, 5);
      drawPlane(cx - W * 0.05, H * 0.18, 5);
      drawPlane(cx - W * 0.18, H * 0.65, 5);
      drawPlane(cx - W * 0.05, H * 0.65, 5);
      drawPlane(cx - W * 0.18, H * 0.78, 5);
      drawPlane(cx - W * 0.05, H * 0.78, 5);
    });

    // === REDRAWN HISTORICAL SHIPS (high-res, realistic) ===
    this.generateHistoricalShipsHQ();

    // === Pirate ship varieties ===
    this.generatePirateShips();

    // === 🇯🇵 Akagi (1927) — Imperial Japanese carrier, Pearl Harbor flagship ===
    this.makeShipHQ('ship_akagi_hq', 175, 430, (ctx, W, H) => {
      const cx = W / 2;
      const cy = H / 2;

      this.drawWaterShadow(ctx, cx, cy + 6, W * 0.6, H * 0.55);

      // Hull silhouette
      ctx.beginPath();
      ctx.moveTo(cx - W * 0.18, H * 0.04);
      ctx.bezierCurveTo(cx + W * 0.1, H * 0.04, cx + W * 0.4, H * 0.08, cx + W * 0.4, H * 0.18);
      ctx.lineTo(cx + W * 0.4, H * 0.88);
      ctx.bezierCurveTo(cx + W * 0.4, H * 0.95, cx + W * 0.28, H * 0.98, cx + W * 0.1, H * 0.98);
      ctx.lineTo(cx - W * 0.1, H * 0.98);
      ctx.bezierCurveTo(cx - W * 0.28, H * 0.98, cx - W * 0.4, H * 0.95, cx - W * 0.4, H * 0.88);
      ctx.lineTo(cx - W * 0.4, H * 0.18);
      ctx.bezierCurveTo(cx - W * 0.4, H * 0.08, cx - W * 0.1, H * 0.04, cx - W * 0.18, H * 0.04);
      ctx.closePath();

      // Hull — slightly tan/khaki Imperial Japanese paint
      const hullGrad = ctx.createLinearGradient(0, 0, W, 0);
      hullGrad.addColorStop(0, '#2A2A24');
      hullGrad.addColorStop(0.5, '#5A5448');
      hullGrad.addColorStop(1, '#2A2A24');
      ctx.save();
      ctx.fillStyle = hullGrad;
      ctx.fill();
      ctx.restore();

      // Wooden flight deck (warm brown — Akagi had wooden deck)
      ctx.save();
      const deckGrad = ctx.createLinearGradient(0, 0, W, 0);
      deckGrad.addColorStop(0, '#3A2818');
      deckGrad.addColorStop(0.5, '#6B4A28');
      deckGrad.addColorStop(1, '#3A2818');
      ctx.fillStyle = deckGrad;
      ctx.fillRect(cx - W * 0.36, H * 0.08, W * 0.72, H * 0.88);
      // Plank lines along length
      ctx.strokeStyle = 'rgba(0,0,0,0.4)';
      ctx.lineWidth = 0.5;
      for (let i = -3; i <= 3; i++) {
        ctx.beginPath();
        ctx.moveTo(cx + i * W * 0.1, H * 0.1);
        ctx.lineTo(cx + i * W * 0.1, H * 0.94);
        ctx.stroke();
      }
      // Center landing line
      ctx.fillStyle = '#FFFFFF';
      for (let i = 0; i < 14; i++) {
        ctx.fillRect(cx - 0.5, H * 0.12 + i * (H * 0.06), 1, H * 0.025);
      }
      ctx.restore();

      // Hinomaru on deck (Japanese red sun)
      ctx.save();
      ctx.fillStyle = '#F5EBD0';
      ctx.beginPath();
      ctx.arc(cx, H * 0.5, 14, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#CC1A2D';
      ctx.beginPath();
      ctx.arc(cx, H * 0.5, 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Island superstructure (LEFT side — Akagi was unique with port-side island!)
      const isX = cx - W * 0.32;
      const isY = H * 0.4;
      const isW = W * 0.14;
      const isH = H * 0.18;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(isX + 1.5, isY + 1.5, isW, isH);
      const isGrad = ctx.createLinearGradient(0, isY, 0, isY + isH);
      isGrad.addColorStop(0, '#7A848E');
      isGrad.addColorStop(0.4, '#4F5860');
      isGrad.addColorStop(1, '#22282E');
      ctx.fillStyle = isGrad;
      ctx.fillRect(isX, isY, isW, isH);
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillRect(isX, isY, isW, 1.5);
      ctx.fillStyle = '#142030';
      ctx.fillRect(isX + 2, isY + 4, isW - 4, 3);
      // Mast
      ctx.fillStyle = '#222';
      ctx.fillRect(isX + isW / 2 - 1, isY - 12, 2, 14);

      // Aircraft (zero fighters)
      ctx.fillStyle = 'rgba(180, 180, 180, 0.7)';
      const drawZero = (x: number, y: number, sz: number) => {
        ctx.fillRect(x - 1, y - sz, 2, sz * 2);
        ctx.fillRect(x - sz, y - sz * 0.2, sz * 2, 1.5);
        ctx.fillRect(x - sz * 0.4, y + sz * 0.6, sz * 0.8, 1);
        // Red dot wings
        ctx.fillStyle = '#CC1A2D';
        ctx.fillRect(x - sz + 1, y - sz * 0.2, 1.5, 1.5);
        ctx.fillRect(x + sz - 2.5, y - sz * 0.2, 1.5, 1.5);
        ctx.fillStyle = 'rgba(180, 180, 180, 0.7)';
      };
      drawZero(cx + W * 0.15, H * 0.18, 5);
      drawZero(cx - W * 0.05, H * 0.18, 5);
      drawZero(cx + W * 0.15, H * 0.78, 5);
      drawZero(cx - W * 0.05, H * 0.78, 5);
      drawZero(cx + W * 0.15, H * 0.88, 5);
    });
  }

  // ============ HIGH-RES HISTORICAL SHIPS (redrawn from scratch) ============

  /** Helper: draw a wooden hull with plank gradient + plating */
  private drawWoodenHull(
    ctx: CanvasRenderingContext2D,
    cx: number, hullW: number, topY: number, botY: number,
    bowSharpness: number, // 0=round bow, 1=very pointed
    palette: { dark: string; mid: string; light: string },
  ): void {
    const bowY = topY;
    const sternY = botY;
    const midY = (topY + botY) / 2;

    // Hull silhouette using bezier
    ctx.beginPath();
    ctx.moveTo(cx, bowY);
    ctx.bezierCurveTo(
      cx + hullW * (0.5 - bowSharpness * 0.2), bowY + (botY - topY) * 0.15,
      cx + hullW * 0.55, midY,
      cx + hullW * 0.5, sternY - (botY - topY) * 0.05,
    );
    ctx.lineTo(cx - hullW * 0.5, sternY - (botY - topY) * 0.05);
    ctx.bezierCurveTo(
      cx - hullW * 0.55, midY,
      cx - hullW * (0.5 - bowSharpness * 0.2), bowY + (botY - topY) * 0.15,
      cx, bowY,
    );
    ctx.closePath();

    // Hull horizontal gradient
    const hullGrad = ctx.createLinearGradient(cx - hullW * 0.55, 0, cx + hullW * 0.55, 0);
    hullGrad.addColorStop(0, palette.dark);
    hullGrad.addColorStop(0.25, palette.mid);
    hullGrad.addColorStop(0.5, palette.light);
    hullGrad.addColorStop(0.75, palette.mid);
    hullGrad.addColorStop(1, palette.dark);
    ctx.save();
    ctx.fillStyle = hullGrad;
    ctx.fill();

    // Top sun overlay
    const topLight = ctx.createLinearGradient(0, topY, 0, botY);
    topLight.addColorStop(0, 'rgba(255, 240, 200, 0.18)');
    topLight.addColorStop(0.4, 'rgba(0, 0, 0, 0)');
    topLight.addColorStop(1, 'rgba(0, 0, 0, 0.4)');
    ctx.fillStyle = topLight;
    ctx.fill();
    ctx.restore();

    // Plank lines (horizontal)
    ctx.save();
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.lineWidth = 0.6;
    const planks = 14;
    for (let i = 1; i < planks; i++) {
      const y = topY + ((botY - topY) * i) / planks;
      ctx.beginPath();
      ctx.moveTo(cx - hullW * 0.5, y);
      ctx.lineTo(cx + hullW * 0.5, y);
      ctx.stroke();
    }
    ctx.restore();
  }

  private generateHistoricalShipsHQ(): void {
    // === 🇰🇷 거북선 (Turtle Ship HQ) ===
    this.makeShipHQ('ship_turtleship_hq', 140, 340, (ctx, W, H) => {
      const cx = W / 2;
      this.drawWaterShadow(ctx, cx, H / 2 + 6, W * 0.55, H * 0.5);

      // Wooden hull
      this.drawWoodenHull(ctx, cx, W * 0.84, H * 0.05, H * 0.97, 0.3, {
        dark: '#1F1006', mid: '#4F2F18', light: '#6B4022',
      });

      // Iron-spiked roof (turtle shell back)
      const shellGrad = ctx.createRadialGradient(cx - 8, H * 0.42, 5, cx, H * 0.5, 50);
      shellGrad.addColorStop(0, '#7AAA4A');
      shellGrad.addColorStop(0.5, '#3A6822');
      shellGrad.addColorStop(1, '#1F3A12');
      ctx.fillStyle = shellGrad;
      ctx.beginPath();
      ctx.ellipse(cx, H * 0.55, W * 0.34, H * 0.36, 0, 0, Math.PI * 2);
      ctx.fill();
      // Shell hexagon pattern
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.4)';
      ctx.lineWidth = 0.6;
      for (let row = 0; row < 5; row++) {
        for (let col = -2; col <= 2; col++) {
          const px = cx + col * 14 + (row % 2) * 7;
          const py = H * 0.32 + row * 18;
          if (Phaser.Math.Distance.Between(px, py, cx, H * 0.55) < W * 0.32) {
            ctx.beginPath();
            ctx.arc(px, py, 6, 0, Math.PI * 2);
            ctx.stroke();
          }
        }
      }

      // Iron spikes (highlighted dots)
      const spikes: [number, number][] = [
        [-12, -8], [12, -8], [0, -2], [-18, 4], [18, 4], [-6, 8], [6, 8],
        [-12, 18], [12, 18], [0, 24], [-18, 32], [18, 32],
      ];
      for (const [dx, dy] of spikes) {
        const sx = cx + dx;
        const sy = H * 0.5 + dy;
        // Shadow
        ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
        ctx.beginPath();
        ctx.arc(sx + 0.6, sy + 0.6, 2.5, 0, Math.PI * 2);
        ctx.fill();
        // Body
        ctx.fillStyle = '#888';
        ctx.beginPath();
        ctx.arc(sx, sy, 2.5, 0, Math.PI * 2);
        ctx.fill();
        // Highlight
        ctx.fillStyle = '#DDD';
        ctx.beginPath();
        ctx.arc(sx - 0.7, sy - 0.7, 1, 0, Math.PI * 2);
        ctx.fill();
      }

      // Dragon head (bow)
      const dhX = cx;
      const dhY = H * 0.06;
      ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
      ctx.beginPath();
      ctx.moveTo(dhX + 1, dhY + 1);
      ctx.lineTo(dhX - 14, dhY + 22);
      ctx.lineTo(dhX + 14, dhY + 22);
      ctx.fill();
      // Dragon head body
      const dragGrad = ctx.createLinearGradient(0, dhY, 0, dhY + 24);
      dragGrad.addColorStop(0, '#CC2222');
      dragGrad.addColorStop(0.5, '#882222');
      dragGrad.addColorStop(1, '#5A1111');
      ctx.fillStyle = dragGrad;
      ctx.beginPath();
      ctx.moveTo(dhX, dhY);
      ctx.lineTo(dhX - 14, dhY + 22);
      ctx.lineTo(dhX - 6, dhY + 26);
      ctx.lineTo(dhX, dhY + 22);
      ctx.lineTo(dhX + 6, dhY + 26);
      ctx.lineTo(dhX + 14, dhY + 22);
      ctx.closePath();
      ctx.fill();
      // Dragon eyes (yellow)
      ctx.fillStyle = '#FFFF00';
      ctx.fillRect(dhX - 5, dhY + 12, 2.5, 2.5);
      ctx.fillRect(dhX + 2.5, dhY + 12, 2.5, 2.5);
      // Dragon teeth (white)
      ctx.fillStyle = '#FFF';
      ctx.fillRect(dhX - 1.5, dhY + 22, 1.5, 4);
      ctx.fillRect(dhX + 1, dhY + 22, 1.5, 4);

      // Cannon ports on sides
      ctx.fillStyle = '#0A0A0A';
      for (let i = 0; i < 5; i++) {
        const py = H * 0.3 + i * 14;
        ctx.fillRect(cx - W * 0.46, py, 5, 5);
        ctx.fillRect(cx + W * 0.46 - 5, py, 5, 5);
        // Brass port rim
        ctx.fillStyle = '#BB8833';
        ctx.fillRect(cx - W * 0.46 - 0.5, py - 0.5, 6, 1);
        ctx.fillRect(cx - W * 0.46 - 0.5, py + 5, 6, 1);
        ctx.fillRect(cx + W * 0.46 - 5.5, py - 0.5, 6, 1);
        ctx.fillRect(cx + W * 0.46 - 5.5, py + 5, 6, 1);
        ctx.fillStyle = '#0A0A0A';
      }

      // Stern golden trim
      ctx.fillStyle = '#DDAA33';
      ctx.fillRect(cx - 14, H - 18, 28, 3);
      ctx.fillStyle = '#FFCC44';
      ctx.fillRect(cx - 14, H - 18, 28, 1);

      // Bow wake
      ctx.save();
      ctx.fillStyle = 'rgba(220, 230, 240, 0.45)';
      ctx.beginPath();
      ctx.moveTo(cx, H * 0.04);
      ctx.lineTo(cx - W * 0.42, H * 0.18);
      ctx.lineTo(cx - W * 0.32, H * 0.1);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(cx, H * 0.04);
      ctx.lineTo(cx + W * 0.42, H * 0.18);
      ctx.lineTo(cx + W * 0.32, H * 0.1);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    });

    // === 🇰🇷 판옥선 (Panokseon HQ) ===
    this.makeShipHQ('ship_panokseon_hq', 140, 340, (ctx, W, H) => {
      const cx = W / 2;
      this.drawWaterShadow(ctx, cx, H / 2 + 6, W * 0.55, H * 0.5);

      this.drawWoodenHull(ctx, cx, W * 0.84, H * 0.05, H * 0.97, 0.4, {
        dark: '#2A1810', mid: '#5A3018', light: '#8B5A2B',
      });

      // Korean red trim bands
      ctx.fillStyle = '#CC1A2D';
      ctx.fillRect(cx - W * 0.4, H * 0.32, W * 0.8, 4);
      ctx.fillRect(cx - W * 0.4, H * 0.68, W * 0.8, 4);
      ctx.fillStyle = '#2244AA';
      ctx.fillRect(cx - W * 0.4, H * 0.36, W * 0.8, 4);
      ctx.fillRect(cx - W * 0.4, H * 0.64, W * 0.8, 4);

      // Upper deck (raised wooden platform)
      const deckGrad = ctx.createLinearGradient(0, H * 0.42, 0, H * 0.58);
      deckGrad.addColorStop(0, '#5A3018');
      deckGrad.addColorStop(1, '#3A1810');
      ctx.fillStyle = deckGrad;
      ctx.fillRect(cx - W * 0.32, H * 0.42, W * 0.64, H * 0.16);
      // Deck plank lines
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.4)';
      ctx.lineWidth = 0.5;
      for (let i = 0; i < 4; i++) {
        ctx.beginPath();
        ctx.moveTo(cx - W * 0.3, H * 0.45 + i * 8);
        ctx.lineTo(cx + W * 0.3, H * 0.45 + i * 8);
        ctx.stroke();
      }

      // Mast (single tall)
      ctx.fillStyle = '#2A1810';
      ctx.fillRect(cx - 2, H * 0.18, 4, H * 0.6);
      ctx.fillStyle = '#3A2010';
      ctx.fillRect(cx - 1, H * 0.18, 1.5, H * 0.6);
      // Mast top decoration
      ctx.fillStyle = '#DDAA33';
      ctx.fillRect(cx - 4, H * 0.16, 8, 3);

      // Square sail (cream colored, with panel divisions)
      const sailGrad = ctx.createLinearGradient(0, H * 0.22, 0, H * 0.42);
      sailGrad.addColorStop(0, '#F0E0B0');
      sailGrad.addColorStop(0.5, '#D8C898');
      sailGrad.addColorStop(1, '#A88858');
      ctx.fillStyle = sailGrad;
      ctx.fillRect(cx - W * 0.34, H * 0.22, W * 0.68, H * 0.2);
      // Sail panel divisions (vertical)
      ctx.strokeStyle = 'rgba(120, 80, 40, 0.6)';
      ctx.lineWidth = 0.7;
      for (let i = 1; i < 5; i++) {
        ctx.beginPath();
        ctx.moveTo(cx - W * 0.34 + i * (W * 0.68 / 5), H * 0.22);
        ctx.lineTo(cx - W * 0.34 + i * (W * 0.68 / 5), H * 0.42);
        ctx.stroke();
      }
      // Sail horizontal reinforcements
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.moveTo(cx - W * 0.34, H * 0.27 + i * 5);
        ctx.lineTo(cx + W * 0.34, H * 0.27 + i * 5);
        ctx.stroke();
      }

      // Cannon ports
      ctx.fillStyle = '#0A0A0A';
      for (let i = 0; i < 4; i++) {
        const py = H * 0.74 + i * 7;
        ctx.fillRect(cx - W * 0.46, py, 5, 4);
        ctx.fillRect(cx + W * 0.46 - 5, py, 5, 4);
      }

      // Bow ornament (golden dragon style)
      ctx.fillStyle = '#DDAA33';
      ctx.beginPath();
      ctx.moveTo(cx, H * 0.04);
      ctx.lineTo(cx - 8, H * 0.13);
      ctx.lineTo(cx + 8, H * 0.13);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#FFCC44';
      ctx.fillRect(cx - 2, H * 0.07, 4, 3);
    });

    // === ⛵ Spanish Galleon HQ ===
    this.makeShipHQ('ship_galleon_hq', 150, 360, (ctx, W, H) => {
      const cx = W / 2;
      this.drawWaterShadow(ctx, cx, H / 2 + 6, W * 0.6, H * 0.55);

      this.drawWoodenHull(ctx, cx, W * 0.86, H * 0.05, H * 0.97, 0.35, {
        dark: '#2A1810', mid: '#6B3D1A', light: '#9C5A28',
      });

      // Spanish red+yellow trim
      ctx.fillStyle = '#FFCC22';
      ctx.fillRect(cx - W * 0.42, H * 0.18, W * 0.84, 3);
      ctx.fillRect(cx - W * 0.42, H * 0.85, W * 0.84, 3);
      ctx.fillStyle = '#CC2222';
      ctx.fillRect(cx - W * 0.42, H * 0.21, W * 0.84, 2);
      ctx.fillRect(cx - W * 0.42, H * 0.83, W * 0.84, 2);

      // 3 masts with sails
      const masts = [H * 0.2, H * 0.45, H * 0.7];
      for (let i = 0; i < masts.length; i++) {
        const my = masts[i];
        // Sail (large square)
        const sailGrad = ctx.createLinearGradient(0, my - 12, 0, my + 12);
        sailGrad.addColorStop(0, '#F8F0DC');
        sailGrad.addColorStop(0.5, '#E8DBB0');
        sailGrad.addColorStop(1, '#B59E70');
        ctx.fillStyle = sailGrad;
        ctx.fillRect(cx - W * 0.36, my - 13, W * 0.72, 24);
        // Sail wear
        ctx.strokeStyle = 'rgba(120, 90, 50, 0.5)';
        ctx.lineWidth = 0.6;
        for (let j = 0; j < 4; j++) {
          ctx.beginPath();
          ctx.moveTo(cx - W * 0.36 + j * 30, my - 13);
          ctx.lineTo(cx - W * 0.36 + j * 30, my + 11);
          ctx.stroke();
        }
        // Mast (top-down circle + line)
        ctx.fillStyle = '#3A2010';
        ctx.beginPath();
        ctx.arc(cx, my, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#5A3018';
        ctx.beginPath();
        ctx.arc(cx - 0.5, my - 0.5, 1.5, 0, Math.PI * 2);
        ctx.fill();
      }

      // Cannon ports (2 rows)
      ctx.fillStyle = '#0A0A0A';
      for (let i = 0; i < 6; i++) {
        const py = H * 0.25 + i * 10;
        ctx.fillRect(cx - W * 0.48, py, 4, 4);
        ctx.fillRect(cx + W * 0.48 - 4, py, 4, 4);
      }

      // Spanish flag at stern
      ctx.fillStyle = '#FFCC22';
      ctx.fillRect(cx - 6, H - 16, 12, 8);
      ctx.fillStyle = '#CC2222';
      ctx.fillRect(cx - 6, H - 16, 12, 2);
      ctx.fillRect(cx - 6, H - 10, 12, 2);
    });

    // === ☠ Pirate Frigate HQ ===
    this.makeShipHQ('ship_pirate_hq', 130, 330, (ctx, W, H) => {
      const cx = W / 2;
      this.drawWaterShadow(ctx, cx, H / 2 + 6, W * 0.55, H * 0.55);

      this.drawWoodenHull(ctx, cx, W * 0.84, H * 0.05, H * 0.97, 0.4, {
        dark: '#0A0A0A', mid: '#1F1F1F', light: '#3A3A3A',
      });

      // Red trim line
      ctx.fillStyle = '#882222';
      ctx.fillRect(cx - W * 0.42, H * 0.2, W * 0.84, 2);
      ctx.fillRect(cx - W * 0.42, H * 0.85, W * 0.84, 2);
      ctx.fillStyle = '#CC2222';
      ctx.fillRect(cx - W * 0.42, H * 0.22, W * 0.84, 1);

      // 2 masts
      const masts = [H * 0.28, H * 0.62];
      for (const my of masts) {
        const sailGrad = ctx.createLinearGradient(0, my - 13, 0, my + 13);
        sailGrad.addColorStop(0, '#F0E8D0');
        sailGrad.addColorStop(0.5, '#D8CDA8');
        sailGrad.addColorStop(1, '#9A8855');
        ctx.fillStyle = sailGrad;
        ctx.fillRect(cx - W * 0.34, my - 13, W * 0.68, 26);
        // Wear marks
        ctx.fillStyle = 'rgba(180, 160, 100, 0.4)';
        ctx.fillRect(cx - W * 0.32, my - 11, W * 0.64, 1.5);
        ctx.fillRect(cx - W * 0.32, my - 5, W * 0.64, 1.5);
        // Mast circle
        ctx.fillStyle = '#3A2010';
        ctx.beginPath();
        ctx.arc(cx, my, 3, 0, Math.PI * 2);
        ctx.fill();
      }

      // Skull & crossbones on foresail
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.arc(cx, H * 0.28, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#FFF';
      // Skull eyes
      ctx.fillRect(cx - 2, H * 0.28 - 1.5, 1.5, 1.5);
      ctx.fillRect(cx + 0.5, H * 0.28 - 1.5, 1.5, 1.5);
      // Skull jaw
      ctx.fillRect(cx - 1.5, H * 0.28 + 1, 3, 1);
      // Crossbones
      ctx.strokeStyle = '#FFF';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx - 6, H * 0.28 - 5);
      ctx.lineTo(cx + 6, H * 0.28 + 5);
      ctx.moveTo(cx + 6, H * 0.28 - 5);
      ctx.lineTo(cx - 6, H * 0.28 + 5);
      ctx.stroke();

      // Cannon ports
      ctx.fillStyle = '#000';
      for (let i = 0; i < 5; i++) {
        const py = H * 0.3 + i * 12;
        ctx.fillRect(cx - W * 0.48, py, 4, 4);
        ctx.fillRect(cx + W * 0.48 - 4, py, 4, 4);
      }
    });

    // === ⚔ Viking Longship HQ ===
    this.makeShipHQ('ship_viking_hq', 100, 360, (ctx, W, H) => {
      const cx = W / 2;
      this.drawWaterShadow(ctx, cx, H / 2 + 4, W * 0.45, H * 0.55);

      this.drawWoodenHull(ctx, cx, W * 0.84, H * 0.04, H * 0.96, 0.6, {
        dark: '#2A1808', mid: '#5A3018', light: '#7C4222',
      });

      // Plank lines extra (Viking ships have prominent plank overlap)
      ctx.save();
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
      ctx.lineWidth = 0.7;
      for (let i = 0; i < 12; i++) {
        const y = H * 0.12 + i * (H * 0.7 / 11);
        ctx.beginPath();
        ctx.moveTo(cx - W * 0.45, y);
        ctx.lineTo(cx + W * 0.45, y);
        ctx.stroke();
      }
      ctx.restore();

      // Round shields on port + starboard (alternating colors)
      const shieldColors = ['#CC2222', '#DDAA22', '#2266AA', '#22AA66'];
      for (let i = 0; i < 8; i++) {
        const sy = H * 0.18 + i * 22;
        const color = shieldColors[i % shieldColors.length];
        const drawShield = (sx: number) => {
          // Shadow
          ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
          ctx.beginPath();
          ctx.arc(sx + 0.7, sy + 0.7, 6, 0, Math.PI * 2);
          ctx.fill();
          // Outer
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(sx, sy, 6, 0, Math.PI * 2);
          ctx.fill();
          // Inner ring
          ctx.fillStyle = '#3A2010';
          ctx.beginPath();
          ctx.arc(sx, sy, 4, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(sx, sy, 3, 0, Math.PI * 2);
          ctx.fill();
          // Center boss
          ctx.fillStyle = '#888';
          ctx.beginPath();
          ctx.arc(sx, sy, 1.8, 0, Math.PI * 2);
          ctx.fill();
        };
        drawShield(cx - W * 0.45);
        drawShield(cx + W * 0.45);
      }

      // Single mast with red sail
      const my = H * 0.5;
      ctx.fillStyle = '#3A2010';
      ctx.beginPath();
      ctx.arc(cx, my, 3.5, 0, Math.PI * 2);
      ctx.fill();
      // Square red sail with stripes
      const sailGrad = ctx.createLinearGradient(0, my - 18, 0, my + 18);
      sailGrad.addColorStop(0, '#DD3322');
      sailGrad.addColorStop(0.5, '#AA2218');
      sailGrad.addColorStop(1, '#771810');
      ctx.fillStyle = sailGrad;
      ctx.fillRect(cx - W * 0.36, my - 18, W * 0.72, 36);
      // White stripes
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(cx - W * 0.36, my - 12, W * 0.72, 2);
      ctx.fillRect(cx - W * 0.36, my, W * 0.72, 2);
      ctx.fillRect(cx - W * 0.36, my + 12, W * 0.72, 2);

      // Dragon head at bow
      ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
      ctx.beginPath();
      ctx.moveTo(cx + 1, H * 0.02 + 1);
      ctx.lineTo(cx - 6, H * 0.13 + 1);
      ctx.lineTo(cx + 6, H * 0.13 + 1);
      ctx.fill();
      const dGrad = ctx.createLinearGradient(0, 0, 0, H * 0.13);
      dGrad.addColorStop(0, '#CC3322');
      dGrad.addColorStop(1, '#771810');
      ctx.fillStyle = dGrad;
      ctx.beginPath();
      ctx.moveTo(cx, H * 0.02);
      ctx.lineTo(cx - 6, H * 0.13);
      ctx.lineTo(cx + 6, H * 0.13);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#FFFF00';
      ctx.fillRect(cx - 1.5, H * 0.07, 1.5, 1.5);
      ctx.fillRect(cx + 0.5, H * 0.07, 1.5, 1.5);

      // Curved stern (raised dragon tail)
      ctx.fillStyle = '#5A3015';
      ctx.beginPath();
      ctx.moveTo(cx - 5, H - 4);
      ctx.bezierCurveTo(cx - 3, H - 12, cx + 3, H - 12, cx + 5, H - 4);
      ctx.fill();
    });

    // === 👁 Greek Trireme HQ ===
    this.makeShipHQ('ship_trireme_hq', 95, 360, (ctx, W, H) => {
      const cx = W / 2;
      this.drawWaterShadow(ctx, cx, H / 2 + 4, W * 0.42, H * 0.55);

      // Sleek dark hull
      this.drawWoodenHull(ctx, cx, W * 0.78, H * 0.02, H * 0.97, 0.7, {
        dark: '#1A140A', mid: '#3A2A1A', light: '#5A4030',
      });

      // White hull stripes (Greek pattern)
      ctx.fillStyle = '#EEE5C8';
      ctx.fillRect(cx - W * 0.4, H * 0.18, W * 0.8, 3);
      ctx.fillRect(cx - W * 0.4, H * 0.5, W * 0.8, 3);
      ctx.fillRect(cx - W * 0.4, H * 0.82, W * 0.8, 3);
      // Blue accent
      ctx.fillStyle = '#3A6AAA';
      ctx.fillRect(cx - W * 0.4, H * 0.21, W * 0.8, 1);
      ctx.fillRect(cx - W * 0.4, H * 0.53, W * 0.8, 1);
      ctx.fillRect(cx - W * 0.4, H * 0.85, W * 0.8, 1);

      // 3 rows of oars (lines on sides) — extending OUT
      ctx.strokeStyle = '#9A8866';
      ctx.lineWidth = 1.2;
      for (let i = 0; i < 14; i++) {
        const oy = H * 0.18 + i * 16;
        // Port (left)
        ctx.beginPath();
        ctx.moveTo(cx - W * 0.4, oy);
        ctx.lineTo(cx - W * 0.55, oy + 3);
        ctx.stroke();
        // Starboard
        ctx.beginPath();
        ctx.moveTo(cx + W * 0.4, oy);
        ctx.lineTo(cx + W * 0.55, oy + 3);
        ctx.stroke();
      }

      // Bronze ram at bow
      ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
      ctx.beginPath();
      ctx.moveTo(cx + 1, 1);
      ctx.lineTo(cx - 7, 13);
      ctx.lineTo(cx + 7, 13);
      ctx.fill();
      const ramGrad = ctx.createLinearGradient(0, 0, 0, 14);
      ramGrad.addColorStop(0, '#FFCC44');
      ramGrad.addColorStop(0.5, '#BB8833');
      ramGrad.addColorStop(1, '#5A3018');
      ctx.fillStyle = ramGrad;
      ctx.beginPath();
      ctx.moveTo(cx, 0);
      ctx.lineTo(cx - 7, 12);
      ctx.lineTo(cx + 7, 12);
      ctx.closePath();
      ctx.fill();
      // Ram tip highlight
      ctx.fillStyle = '#FFEEAA';
      ctx.fillRect(cx - 1, 1, 2, 5);

      // Eye painted on bow (Greek tradition — apotropaic mark)
      const eyeY = H * 0.1;
      // Port eye
      ctx.fillStyle = '#EEE5C8';
      ctx.beginPath();
      ctx.ellipse(cx - 8, eyeY, 4, 3, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.arc(cx - 8, eyeY, 1.5, 0, Math.PI * 2);
      ctx.fill();
      // Starboard eye
      ctx.fillStyle = '#EEE5C8';
      ctx.beginPath();
      ctx.ellipse(cx + 8, eyeY, 4, 3, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.arc(cx + 8, eyeY, 1.5, 0, Math.PI * 2);
      ctx.fill();

      // Single mast with small sail (folded)
      const my = H * 0.5;
      ctx.fillStyle = '#3A2010';
      ctx.beginPath();
      ctx.arc(cx, my, 2, 0, Math.PI * 2);
      ctx.fill();
      const sailGrad = ctx.createLinearGradient(0, my - 8, 0, my + 8);
      sailGrad.addColorStop(0, '#E8DCAA');
      sailGrad.addColorStop(1, '#9A8855');
      ctx.fillStyle = sailGrad;
      ctx.fillRect(cx - W * 0.3, my - 8, W * 0.6, 16);
      // Sail panels
      ctx.strokeStyle = 'rgba(120, 90, 40, 0.4)';
      ctx.lineWidth = 0.5;
      for (let i = 1; i < 4; i++) {
        ctx.beginPath();
        ctx.moveTo(cx - W * 0.3 + i * 16, my - 8);
        ctx.lineTo(cx - W * 0.3 + i * 16, my + 8);
        ctx.stroke();
      }
    });
  }

  // ============ PIRATE SHIP VARIETIES ============

  /** Helper for pirate ships — adds a sail with given fill */
  private drawPirateSail(ctx: CanvasRenderingContext2D, cx: number, sailW: number, my: number, sailH: number, dark: string, mid: string, light: string): void {
    const grad = ctx.createLinearGradient(0, my - sailH / 2, 0, my + sailH / 2);
    grad.addColorStop(0, light);
    grad.addColorStop(0.5, mid);
    grad.addColorStop(1, dark);
    ctx.fillStyle = grad;
    ctx.fillRect(cx - sailW / 2, my - sailH / 2, sailW, sailH);
    // Wear stripes
    ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
    ctx.fillRect(cx - sailW / 2, my - sailH * 0.3, sailW, 1.5);
    ctx.fillRect(cx - sailW / 2, my + sailH * 0.2, sailW, 1.5);
    // Mast circle (top-down)
    ctx.fillStyle = '#3A2010';
    ctx.beginPath();
    ctx.arc(cx, my, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  private generatePirateShips(): void {
    // === ☠ Black Pearl — Jack Sparrow's legendary fast ship ===
    this.makeShipHQ('ship_blackpearl_hq', 130, 360, (ctx, W, H) => {
      const cx = W / 2;
      this.drawWaterShadow(ctx, cx, H / 2 + 6, W * 0.55, H * 0.55);

      // Sleek dark hull
      this.drawWoodenHull(ctx, cx, W * 0.84, H * 0.04, H * 0.97, 0.5, {
        dark: '#050505', mid: '#161616', light: '#2A2A2A',
      });

      // Gold accent line
      ctx.fillStyle = '#D4A847';
      ctx.fillRect(cx - W * 0.42, H * 0.18, W * 0.84, 1.5);
      ctx.fillRect(cx - W * 0.42, H * 0.85, W * 0.84, 1.5);

      // 3 black sails (Pearl is famous for black sails)
      this.drawPirateSail(ctx, cx, W * 0.7, H * 0.22, 24, '#050505', '#1A1A1A', '#2A2A2A');
      this.drawPirateSail(ctx, cx, W * 0.7, H * 0.5, 28, '#050505', '#1A1A1A', '#2A2A2A');
      this.drawPirateSail(ctx, cx, W * 0.7, H * 0.78, 22, '#050505', '#1A1A1A', '#2A2A2A');

      // Skull on center sail (red eyes — cursed)
      ctx.fillStyle = '#0A0A0A';
      ctx.beginPath();
      ctx.arc(cx, H * 0.5, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#CC2222';
      ctx.fillRect(cx - 2.5, H * 0.5 - 1.5, 1.5, 1.5);
      ctx.fillRect(cx + 1, H * 0.5 - 1.5, 1.5, 1.5);
      ctx.fillStyle = '#FFF';
      ctx.fillRect(cx - 1.5, H * 0.5 + 1.5, 3, 1);

      // Cannon ports — many (Pearl has heavy broadsides)
      ctx.fillStyle = '#0A0A0A';
      for (let i = 0; i < 7; i++) {
        const py = H * 0.3 + i * 9;
        ctx.fillRect(cx - W * 0.48, py, 4, 4);
        ctx.fillRect(cx + W * 0.48 - 4, py, 4, 4);
        // Brass rim
        ctx.fillStyle = '#8B6F22';
        ctx.fillRect(cx - W * 0.48 - 0.5, py - 0.5, 5, 1);
        ctx.fillRect(cx - W * 0.48 - 0.5, py + 4, 5, 1);
        ctx.fillRect(cx + W * 0.48 - 4.5, py - 0.5, 5, 1);
        ctx.fillRect(cx + W * 0.48 - 4.5, py + 4, 5, 1);
        ctx.fillStyle = '#0A0A0A';
      }

      // Glowing red lanterns at bow & stern
      const drawLantern = (lx: number, ly: number) => {
        ctx.fillStyle = '#CC2222';
        ctx.beginPath();
        ctx.arc(lx, ly, 2.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#FFAA00';
        ctx.beginPath();
        ctx.arc(lx, ly, 1.5, 0, Math.PI * 2);
        ctx.fill();
      };
      drawLantern(cx, H * 0.06);
      drawLantern(cx, H - 8);
    });

    // === ☠ Flying Dutchman — Davy Jones' cursed ghost ship ===
    this.makeShipHQ('ship_flyingdutchman_hq', 140, 370, (ctx, W, H) => {
      const cx = W / 2;
      this.drawWaterShadow(ctx, cx, H / 2 + 6, W * 0.6, H * 0.55);

      // Hull — diseased green-black with barnacles
      this.drawWoodenHull(ctx, cx, W * 0.86, H * 0.04, H * 0.97, 0.4, {
        dark: '#0A1810', mid: '#1F3022', light: '#384A30',
      });

      // Coral / barnacle growths (greenish patches on hull)
      ctx.save();
      const patches: [number, number, number][] = [
        [cx - W * 0.3, H * 0.25, 6],
        [cx + W * 0.32, H * 0.4, 5],
        [cx - W * 0.28, H * 0.55, 7],
        [cx + W * 0.3, H * 0.7, 5],
        [cx - W * 0.32, H * 0.85, 6],
      ];
      for (const [px, py, sz] of patches) {
        const grad = ctx.createRadialGradient(px, py, 0, px, py, sz);
        grad.addColorStop(0, 'rgba(80, 120, 60, 0.7)');
        grad.addColorStop(0.6, 'rgba(40, 80, 30, 0.4)');
        grad.addColorStop(1, 'rgba(20, 40, 10, 0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(px, py, sz, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      // Tattered/torn sails — green-grey, ragged edges
      const drawTatteredSail = (sy: number, sailH: number) => {
        const sailW = W * 0.7;
        const grad = ctx.createLinearGradient(0, sy - sailH / 2, 0, sy + sailH / 2);
        grad.addColorStop(0, '#5A6A50');
        grad.addColorStop(0.5, '#3A4A30');
        grad.addColorStop(1, '#1A2A18');
        ctx.fillStyle = grad;
        // Main sail rect
        ctx.fillRect(cx - sailW / 2, sy - sailH / 2, sailW, sailH);
        // Tear holes
        ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
        ctx.beginPath();
        ctx.arc(cx - 8, sy - 2, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(cx + 6, sy + 4, 2.5, 0, Math.PI * 2);
        ctx.fill();
        // Ragged bottom edge
        for (let i = 0; i < 6; i++) {
          const tx = cx - sailW / 2 + i * (sailW / 6) + 4;
          ctx.fillStyle = 'rgba(20, 30, 15, 1)';
          ctx.beginPath();
          ctx.moveTo(tx, sy + sailH / 2);
          ctx.lineTo(tx + 4, sy + sailH / 2 + 3);
          ctx.lineTo(tx + 8, sy + sailH / 2);
          ctx.fill();
        }
        // Mast
        ctx.fillStyle = '#2A1810';
        ctx.beginPath();
        ctx.arc(cx, sy, 3, 0, Math.PI * 2);
        ctx.fill();
      };
      drawTatteredSail(H * 0.22, 28);
      drawTatteredSail(H * 0.5, 30);
      drawTatteredSail(H * 0.78, 26);

      // Ghostly green glow on deck (from inside)
      ctx.save();
      const gloGrad = ctx.createRadialGradient(cx, H * 0.5, 5, cx, H * 0.5, 30);
      gloGrad.addColorStop(0, 'rgba(80, 200, 100, 0.45)');
      gloGrad.addColorStop(1, 'rgba(80, 200, 100, 0)');
      ctx.fillStyle = gloGrad;
      ctx.beginPath();
      ctx.arc(cx, H * 0.5, 30, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Cannon ports — also green-glowing
      ctx.fillStyle = '#0A1810';
      for (let i = 0; i < 6; i++) {
        const py = H * 0.32 + i * 11;
        ctx.fillRect(cx - W * 0.48, py, 4, 4);
        ctx.fillRect(cx + W * 0.48 - 4, py, 4, 4);
        // Green glow inside ports
        ctx.fillStyle = '#5AFA8A';
        ctx.fillRect(cx - W * 0.48 + 1, py + 1, 2, 2);
        ctx.fillRect(cx + W * 0.48 - 3, py + 1, 2, 2);
        ctx.fillStyle = '#0A1810';
      }

      // Tentacle decoration at bow (Davy Jones theme)
      ctx.save();
      ctx.strokeStyle = '#1A2820';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx - 6, H * 0.05);
      ctx.bezierCurveTo(cx - 12, H * 0.1, cx - 14, H * 0.13, cx - 8, H * 0.16);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx + 6, H * 0.05);
      ctx.bezierCurveTo(cx + 12, H * 0.1, cx + 14, H * 0.13, cx + 8, H * 0.16);
      ctx.stroke();
      ctx.restore();
    });

    // === 👑 Royal Fortune — Bartholomew Roberts' flagship ===
    this.makeShipHQ('ship_royalfortune_hq', 140, 360, (ctx, W, H) => {
      const cx = W / 2;
      this.drawWaterShadow(ctx, cx, H / 2 + 6, W * 0.58, H * 0.55);

      // Rich crimson hull (ostentatious)
      this.drawWoodenHull(ctx, cx, W * 0.86, H * 0.04, H * 0.97, 0.45, {
        dark: '#3A0808', mid: '#7C1818', light: '#A02828',
      });

      // Gold trim (heavy decoration)
      ctx.fillStyle = '#FFCC44';
      ctx.fillRect(cx - W * 0.42, H * 0.18, W * 0.84, 2);
      ctx.fillRect(cx - W * 0.42, H * 0.85, W * 0.84, 2);
      ctx.fillStyle = '#D4A847';
      ctx.fillRect(cx - W * 0.42, H * 0.2, W * 0.84, 1);
      ctx.fillRect(cx - W * 0.42, H * 0.83, W * 0.84, 1);
      // Gold accent stripe down center
      ctx.fillStyle = '#D4A847';
      ctx.fillRect(cx - 1, H * 0.2, 2, H * 0.65);

      // 3 sails — cream with red trim (Royal colors)
      const drawRoyalSail = (sy: number, sailH: number) => {
        const sailW = W * 0.72;
        const grad = ctx.createLinearGradient(0, sy - sailH / 2, 0, sy + sailH / 2);
        grad.addColorStop(0, '#F8F0DC');
        grad.addColorStop(0.5, '#E0D0A8');
        grad.addColorStop(1, '#A89868');
        ctx.fillStyle = grad;
        ctx.fillRect(cx - sailW / 2, sy - sailH / 2, sailW, sailH);
        // Red horizontal stripe in middle
        ctx.fillStyle = '#A02828';
        ctx.fillRect(cx - sailW / 2, sy - 2, sailW, 4);
        ctx.fillStyle = '#FFCC44';
        ctx.fillRect(cx - sailW / 2, sy - 3, sailW, 1);
        ctx.fillRect(cx - sailW / 2, sy + 2, sailW, 1);
        // Mast
        ctx.fillStyle = '#3A2010';
        ctx.beginPath();
        ctx.arc(cx, sy, 3, 0, Math.PI * 2);
        ctx.fill();
      };
      drawRoyalSail(H * 0.22, 28);
      drawRoyalSail(H * 0.5, 32);
      drawRoyalSail(H * 0.78, 26);

      // Crown on center sail (pirate king symbol)
      ctx.fillStyle = '#FFCC44';
      ctx.beginPath();
      ctx.moveTo(cx - 6, H * 0.5 + 6);
      ctx.lineTo(cx - 6, H * 0.5 + 1);
      ctx.lineTo(cx - 3, H * 0.5 - 2);
      ctx.lineTo(cx - 1.5, H * 0.5 + 1);
      ctx.lineTo(cx, H * 0.5 - 3);
      ctx.lineTo(cx + 1.5, H * 0.5 + 1);
      ctx.lineTo(cx + 3, H * 0.5 - 2);
      ctx.lineTo(cx + 6, H * 0.5 + 1);
      ctx.lineTo(cx + 6, H * 0.5 + 6);
      ctx.closePath();
      ctx.fill();
      // Gem on crown
      ctx.fillStyle = '#CC2222';
      ctx.fillRect(cx - 1, H * 0.5 + 2, 2, 2);

      // Many cannon ports (heavy frigate)
      ctx.fillStyle = '#0A0A0A';
      for (let i = 0; i < 7; i++) {
        const py = H * 0.28 + i * 10;
        ctx.fillRect(cx - W * 0.48, py, 4, 4);
        ctx.fillRect(cx + W * 0.48 - 4, py, 4, 4);
        // Heavy brass rim
        ctx.fillStyle = '#FFCC44';
        ctx.fillRect(cx - W * 0.48 - 1, py - 1, 6, 1);
        ctx.fillRect(cx - W * 0.48 - 1, py + 4, 6, 1);
        ctx.fillRect(cx + W * 0.48 - 5, py - 1, 6, 1);
        ctx.fillRect(cx + W * 0.48 - 5, py + 4, 6, 1);
        ctx.fillStyle = '#0A0A0A';
      }

      // Pirate flag at stern (skull on red)
      ctx.fillStyle = '#1A1A1A';
      ctx.fillRect(cx - 6, H - 14, 12, 8);
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.arc(cx, H - 10, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#1A1A1A';
      ctx.fillRect(cx - 1, H - 11, 0.8, 1);
      ctx.fillRect(cx + 0.5, H - 11, 0.8, 1);
    });
  }
}
