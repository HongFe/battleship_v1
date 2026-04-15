import Phaser from 'phaser';
import { BalanceConfig, ItemConfig, ShipId, WeaponCategory, WeaponItemConfig, Nation } from '../config/types';
import { EventBus } from '../utils/EventBus';
import { Colors, Hex, Fonts } from '../config/theme';
import { AudioManager } from '../utils/AudioManager';
import { UserProfile } from '../utils/UserProfile';
import { RankingAPI } from '../utils/RankingAPI';
import { NetworkManager } from '../network/NetworkManager';

interface ChatEntry {
  from: string;
  team: number;
  text: string;
  bornAt: number;
}

interface HUDData {
  hp: number;
  maxHp: number;
  gold: number;
  kills: number;
  alive: number;
  gameTime: number;
}

type ShopCategory = 'weapon' | 'armor' | 'special' | 'ships';

export class UIScene extends Phaser.Scene {
  private hpBar!: Phaser.GameObjects.Graphics;
  private hpText!: Phaser.GameObjects.Text;
  private goldText!: Phaser.GameObjects.Text;
  private killText!: Phaser.GameObjects.Text;
  private aliveText!: Phaser.GameObjects.Text;
  private timerText!: Phaser.GameObjects.Text;
  private waveText!: Phaser.GameObjects.Text;
  private itemSlots: Phaser.GameObjects.Graphics[] = [];
  private itemTexts: Phaser.GameObjects.Text[] = [];
  private itemIcons: Phaser.GameObjects.Image[] = [];

  // Shop
  private shopOpen: boolean = false;
  // Swipe/drag state for shop horizontal scroll
  private shopDragActive: boolean = false;
  private shopDragStartX: number = 0;
  private shopDragStartScroll: number = 0;
  private shopWasDragged: boolean = false;
  // Multiplayer chat overlay state
  private chatLog: ChatEntry[] = [];
  private chatText!: Phaser.GameObjects.Text;
  private chatInput: HTMLInputElement | null = null;
  private chatButtonHit?: Phaser.GameObjects.Rectangle;
  private shopElements: Phaser.GameObjects.GameObject[] = [];
  private currentCategory: ShopCategory = 'weapon';
  private currentWeaponCategory: WeaponCategory | 'all' = 'all';
  private currentNation: Nation | 'all' = 'all';
  private shopScrollX: number = 0;
  private shopScrollMax: number = 0;
  private balance!: BalanceConfig;

  // Game over
  private gameOverContainer!: Phaser.GameObjects.Container;

  // Minimap
  private minimap!: Phaser.GameObjects.Graphics;

  // Wave notification
  private waveNotice!: Phaser.GameObjects.Text;

  // Respawn overlay
  private respawnGroup: Phaser.GameObjects.GameObject[] = [];
  private respawnText: Phaser.GameObjects.Text | null = null;

  // HUD collapse (mobile-friendly)
  private topHudObjects: Phaser.GameObjects.GameObject[] = [];
  private hudCollapsed: boolean = false;
  private hudToggleBtn!: Phaser.GameObjects.Container;

  constructor() {
    super({ key: 'UIScene' });
  }

  create(): void {
    this.balance = this.cache.json.get('balance') as BalanceConfig;
    // Reset state on restart
    this.shopOpen = false;
    this.itemSlots = [];
    this.itemTexts = [];
    this.shopElements = [];
    this.currentCategory = 'weapon';
    this.currentWeaponCategory = 'all';
    this.currentNation = 'all';
    this.shopScrollX = 0;
    this.shopScrollMax = 0;
    this.shopDragActive = false;
    this.shopWasDragged = false;
    this.chatLog = [];
    this.setupShopSwipe();
    this.setupChat();
    const w = this.scale.width;
    const h = this.scale.height;

    // === TOP HUD — single thin strip on all screens (wood plates removed) ===
    const topObjs: Phaser.GameObjects.GameObject[] = [];
    {
      // Single 34px-tall strip: [HP bar + %] [timer+tide] [gold] [kills]
      const stripBg = this.add.graphics().setScrollFactor(0).setDepth(99);
      stripBg.fillStyle(0x0A1628, 0.78);
      stripBg.fillRect(0, 0, w, 34);
      stripBg.lineStyle(1, Hex.brass, 0.6);
      stripBg.lineBetween(0, 34, w, 34);
      topObjs.push(stripBg);

      this.hpBar = this.add.graphics().setScrollFactor(0).setDepth(100);
      topObjs.push(this.hpBar);

      this.hpText = this.add.text(8, 19, 'HP', {
        fontFamily: Fonts.numeric, fontSize: '10px', color: Colors.parchment,
        stroke: '#000', strokeThickness: 2,
      }).setOrigin(0, 0.5).setScrollFactor(0).setDepth(101);
      topObjs.push(this.hpText);

      this.timerText = this.add.text(w / 2, 12, '0:00', {
        fontFamily: Fonts.numeric, fontSize: '12px', color: Colors.parchment,
        stroke: '#000', strokeThickness: 2, fontStyle: 'bold',
      }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(101);
      topObjs.push(this.timerText);

      this.waveText = this.add.text(w / 2, 24, 'I', {
        fontFamily: Fonts.display, fontSize: '9px', color: Colors.brightGold,
        stroke: '#000', strokeThickness: 2,
      }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(101);
      topObjs.push(this.waveText);

      this.goldText = this.add.text(w - 8, 9, '⚜ 500', {
        fontFamily: Fonts.display, fontSize: '12px', color: Colors.brightGold,
        stroke: '#000', strokeThickness: 2,
      }).setOrigin(1, 0).setScrollFactor(0).setDepth(101);
      topObjs.push(this.goldText);

      this.killText = this.add.text(w - 8, 21, '☠ 0', {
        fontFamily: Fonts.display, fontSize: '10px', color: Colors.bone,
        stroke: '#000', strokeThickness: 2,
      }).setOrigin(1, 0).setScrollFactor(0).setDepth(101);
      topObjs.push(this.killText);

      // Crew count hidden to save space; reachable later if needed
      this.aliveText = this.add.text(-99, -99, '', { fontSize: '1px' }).setVisible(false);
    }

    this.topHudObjects = topObjs;

    // Wave notification (center, fades in/out)
    this.waveNotice = this.add.text(w / 2, h * 0.3, '', {
      fontSize: '42px', fontFamily: Fonts.display, color: Colors.brightGold,
      stroke: '#000000', strokeThickness: 5,
      shadow: { offsetX: 0, offsetY: 4, color: '#000000', blur: 8, fill: true },
    }).setOrigin(0.5).setScrollFactor(0).setDepth(150).setAlpha(0);

    // === MINIMAP ===
    this.minimap = this.add.graphics().setScrollFactor(0).setDepth(100);

    // === HUD COLLAPSE TOGGLE — lets mobile users hide top bar when it blocks view
    this.createHudToggle(w);

    // === BOTTOM ===
    this.createItemSlots(w, h);
    this.createShopButton(w, h);
    this.createSkillButton(w, h);
    // Shop is built dynamically on toggle (no static container)
    this.createGameOverOverlay(w, h);

    // Events
    EventBus.on('hud-update', this.updateHUD, this);
    EventBus.on('gold-changed', (gold: number) => {
      this.goldText.setText(`GOLD: ${gold}`);
      // Defer shop re-render to next tick — never destroy buttons mid-click handler
      if (this.shopOpen) {
        this.time.delayedCall(0, () => {
          if (this.shopOpen) this.renderShopContent();
        });
      }
    });
    EventBus.on('items-changed', (items: ItemConfig[]) => {
      this.updateItemSlots(items);
    });
    EventBus.on('ship-changed', () => {
      // Force slot rebuild on next items update
      this.currentSlotCount = -1;
      const gameScene = this.scene.get('GameScene') as any;
      if (gameScene?.player) {
        this.updateItemSlots(gameScene.player.getAllItems());
      }
      if (this.shopOpen) this.renderShopContent();
    });
    EventBus.on('wave-spawned', (waveNum: number) => {
      this.showWaveNotice(waveNum);
    });
    EventBus.on('toast', (msg: string, color?: string) => {
      this.showToast(msg, color);
    });
    EventBus.on('respawn-start', (duration: number) => {
      this.showRespawnOverlay(duration);
    });
    EventBus.on('respawn-tick', (remaining: number) => {
      if (this.respawnText) this.respawnText.setText(`${Math.ceil(remaining)}`);
    });
    EventBus.on('respawn-complete', () => {
      this.hideRespawnOverlay();
    });
    EventBus.on('level-up', (level: number) => {
      // No popup — just a toast notification
      AudioManager.skill();
      EventBus.emit('toast', `⭐ Lv.${level}! HP+6% DMG+5% REGEN+1.5`, '#FFD700');
    });
    EventBus.on('afk-triggered', () => {
      this.showAfkOverlay();
    });
    EventBus.on('game-over', this.showGameOver, this);

    this.events.once('shutdown', () => {
      EventBus.off('hud-update', this.updateHUD, this);
      EventBus.off('gold-changed');
      EventBus.off('items-changed');
      EventBus.off('ship-changed');
      EventBus.off('wave-spawned');
      EventBus.off('toast');
      EventBus.off('respawn-start');
      EventBus.off('respawn-tick');
      EventBus.off('respawn-complete');
      EventBus.off('level-up');
      EventBus.off('afk-triggered');
      EventBus.off('game-over', this.showGameOver, this);
    });
  }

  /** Small chevron button at top-right that hides/shows the top HUD (+ minimap). */
  private createHudToggle(w: number): void {
    const size = 26;
    // Anchor below minimap area — always tappable even when HUD is collapsed
    const x = w - size - 6;
    const y = 170; // below minimap (100px) with margin; still visible in collapsed mode

    const container = this.add.container(x, y).setScrollFactor(0).setDepth(200);

    const bg = this.add.graphics();
    bg.fillStyle(0x0A1628, 0.85);
    bg.fillRoundedRect(0, 0, size, size, 5);
    bg.lineStyle(1.5, Hex.brass, 0.9);
    bg.strokeRoundedRect(0, 0, size, size, 5);
    container.add(bg);

    const arrow = this.add.text(size / 2, size / 2, '▴', {
      fontFamily: '"Noto Sans KR", sans-serif',
      fontSize: '16px',
      color: '#F5D97A',
    }).setOrigin(0.5);
    container.add(arrow);

    const hit = this.add.rectangle(size / 2, size / 2, size, size, 0, 0)
      .setInteractive({ useHandCursor: true });
    container.add(hit);

    hit.on('pointerdown', () => {
      this.hudCollapsed = !this.hudCollapsed;
      arrow.setText(this.hudCollapsed ? '▾' : '▴');
      for (const obj of this.topHudObjects) {
        (obj as Phaser.GameObjects.Image).setVisible(!this.hudCollapsed);
      }
      this.minimap.setVisible(!this.hudCollapsed);
    });

    this.hudToggleBtn = container;
  }

  /** Draw a weathered wood plate with brass rivets — pirate UI panel */
  private drawWoodPlate(x: number, y: number, w: number, h: number): Phaser.GameObjects.Graphics {
    const g = this.add.graphics().setScrollFactor(0).setDepth(99);
    // Outer dark wood frame
    g.fillStyle(Hex.darkWood, 0.95);
    g.fillRoundedRect(x - 2, y - 2, w + 4, h + 4, 6);
    // Mid-tone wood plate
    g.fillStyle(Hex.midWood, 0.92);
    g.fillRoundedRect(x, y, w, h, 5);
    // Wood grain hint (horizontal lines)
    g.lineStyle(1, Hex.woodGrain, 0.5);
    for (let i = 0; i < 4; i++) {
      g.lineBetween(x + 4, y + 8 + i * (h / 5), x + w - 4, y + 8 + i * (h / 5));
    }
    // Brass rivets in corners
    const rivet = (rx: number, ry: number) => {
      g.fillStyle(Hex.brass, 1);
      g.fillCircle(rx, ry, 2.5);
      g.fillStyle(Hex.brassLight, 1);
      g.fillCircle(rx - 0.6, ry - 0.6, 1);
    };
    rivet(x + 5, y + 5);
    rivet(x + w - 5, y + 5);
    rivet(x + 5, y + h - 5);
    rivet(x + w - 5, y + h - 5);
    // Brass border
    g.lineStyle(1.5, Hex.brass, 0.85);
    g.strokeRoundedRect(x, y, w, h, 5);
    // Top edge highlight
    g.lineStyle(1, Hex.brassLight, 0.4);
    g.lineBetween(x + 6, y + 2, x + w - 6, y + 2);
    return g;
  }

  update(_time: number, delta: number): void {
    // Smoothly lerp displayed HP/Gold toward target
    const dt = delta / 1000;
    const hpLerp = 1 - Math.exp(-6 * dt);   // ~6 units/sec catch-up
    const goldLerp = 1 - Math.exp(-10 * dt);
    this.displayedHp += (this.targetHp - this.displayedHp) * hpLerp;
    this.displayedGold += (this.targetGold - this.displayedGold) * goldLerp;

    // Snap when close
    if (Math.abs(this.targetHp - this.displayedHp) < 0.5) this.displayedHp = this.targetHp;
    if (Math.abs(this.targetGold - this.displayedGold) < 1) this.displayedGold = this.targetGold;

    // Render HP bar — sits inside the thin top strip, scales with screen width
    if (this.targetMaxHp > 0) {
      const barW = Math.min(this.scale.width - 180, 220);
      const barH = 9;
      const barX = 30;
      const barY = 14;
      const narrow = true; // strip layout uses % label
      const hpRatio = Phaser.Math.Clamp(this.displayedHp / this.targetMaxHp, 0, 1);
      const targetRatio = Phaser.Math.Clamp(this.targetHp / this.targetMaxHp, 0, 1);
      const hpColor = hpRatio > 0.5 ? Hex.bloodRed : hpRatio > 0.25 ? Hex.fireRed : Hex.brightRed;

      this.hpBar.clear();
      this.hpBar.fillStyle(Hex.darkWood, 1);
      this.hpBar.fillRoundedRect(barX, barY, barW, barH, 3);
      this.hpBar.fillStyle(Hex.iron, 0.8);
      this.hpBar.fillRoundedRect(barX + 1, barY + 1, barW - 2, barH - 2, 2);
      // Lag indicator (lighter ghost) — shows where HP was, drains slowly
      if (hpRatio > targetRatio) {
        this.hpBar.fillStyle(0xFFAA66, 0.5);
        this.hpBar.fillRoundedRect(barX + 1, barY + 1, (barW - 2) * hpRatio, barH - 2, 2);
      }
      // Real HP fill
      this.hpBar.fillStyle(hpColor, 1);
      this.hpBar.fillRoundedRect(barX + 1, barY + 1, (barW - 2) * targetRatio, barH - 2, 2);
      this.hpBar.fillStyle(0xFFFFFF, 0.18);
      this.hpBar.fillRoundedRect(barX + 1, barY + 1, (barW - 2) * targetRatio, (barH - 2) / 2, 2);
      this.hpBar.lineStyle(1, Hex.brass, 0.9);
      this.hpBar.strokeRoundedRect(barX, barY, barW, barH, 3);

      if (narrow) {
        const pct = Math.round((this.displayedHp / this.targetMaxHp) * 100);
        this.hpText.setText(`${pct}%`);
      } else {
        this.hpText.setText(`HP ${Math.ceil(this.displayedHp)} / ${Math.ceil(this.targetMaxHp)}`);
      }
    }
    this.goldText.setText(`⚜ ${Math.floor(this.displayedGold)}`);
  }

  // ========== AFK OVERLAY ==========
  private showAfkOverlay(): void {
    const w = this.scale.width;
    const h = this.scale.height;

    const dim = this.add.rectangle(0, 0, w, h, 0x000000, 0.75)
      .setOrigin(0, 0).setScrollFactor(0).setDepth(480);

    this.add.text(w / 2, h * 0.35, '💤 AFK', {
      fontFamily: Fonts.display, fontSize: '70px',
      color: Colors.fog, stroke: '#000000', strokeThickness: 6,
    }).setOrigin(0.5).setScrollFactor(0).setDepth(481);

    this.add.text(w / 2, h * 0.48, '선장이 자리를 비웠습니다\n컴퓨터가 대신 조종합니다', {
      fontFamily: Fonts.heading, fontSize: '16px',
      color: Colors.parchment, align: 'center',
      stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0.5).setScrollFactor(0).setDepth(481);

    this.add.text(w / 2, h * 0.6, '잠시 후 타이틀 화면으로 돌아갑니다...', {
      fontFamily: Fonts.body, fontSize: '12px',
      color: Colors.fog, fontStyle: 'italic',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(481);
  }

  // ========== LEVEL UP UI ==========
  private levelUpElements: Phaser.GameObjects.GameObject[] = [];

  private showLevelUpChoices(level: number): void {
    // Clear any existing
    this.hideLevelUpChoices();

    const w = this.scale.width;
    const h = this.scale.height;
    AudioManager.skill();

    // Toast
    EventBus.emit('toast', `⭐ Level ${level}! 스킬을 선택하세요`, '#FFD700');

    // 4 upgrade buttons horizontally at center-top
    const choices: { type: 'hp' | 'regen' | 'damage' | 'skill'; icon: string; label: string; desc: string; color: number }[] = [
      { type: 'hp', icon: '💚', label: '선체 강화', desc: '+12% 최대 HP', color: 0x3DC47E },
      { type: 'regen', icon: '💧', label: '자동 수리', desc: '+4 HP/초', color: 0x4A9ECC },
      { type: 'damage', icon: '⚔', label: '화력 증강', desc: '+10% 공격력', color: 0xE84545 },
      { type: 'skill', icon: '🔱', label: '스킬 숙련', desc: '-12% 쿨다운', color: 0xF5A623 },
    ];

    const btnW = 85;
    const btnH = 100;
    const gap = 10;
    const totalW = choices.length * btnW + (choices.length - 1) * gap;
    const startX = (w - totalW) / 2;
    const btnY = h * 0.12;

    // Dim background strip
    const strip = this.add.graphics().setScrollFactor(0).setDepth(400);
    strip.fillStyle(0x000000, 0.7);
    strip.fillRect(0, btnY - 20, w, btnH + 40);
    this.levelUpElements.push(strip);

    // Title
    const title = this.add.text(w / 2, btnY - 12, `⭐ LEVEL ${level} — CHOOSE UPGRADE ⭐`, {
      fontFamily: Fonts.display, fontSize: '16px', color: Colors.brightGold,
      stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0.5).setScrollFactor(0).setDepth(401);
    this.levelUpElements.push(title);

    choices.forEach((ch, i) => {
      const x = startX + i * (btnW + gap);
      const y = btnY + 8;

      // Button background
      const bg = this.add.graphics().setScrollFactor(0).setDepth(401);
      bg.fillStyle(Hex.midWood, 0.95);
      bg.fillRoundedRect(x, y, btnW, btnH, 8);
      bg.lineStyle(2, ch.color, 0.9);
      bg.strokeRoundedRect(x, y, btnW, btnH, 8);
      bg.fillStyle(0xFFFFFF, 0.15);
      bg.fillRoundedRect(x, y, btnW, 3, 8);
      this.levelUpElements.push(bg);

      // Icon
      this.levelUpElements.push(this.add.text(x + btnW / 2, y + 18, ch.icon, {
        fontSize: '26px',
      }).setOrigin(0.5).setScrollFactor(0).setDepth(402));

      // Label
      this.levelUpElements.push(this.add.text(x + btnW / 2, y + 50, ch.label, {
        fontFamily: Fonts.heading, fontSize: '12px', color: Colors.parchment,
      }).setOrigin(0.5).setScrollFactor(0).setDepth(402));

      // Desc
      this.levelUpElements.push(this.add.text(x + btnW / 2, y + 68, ch.desc, {
        fontFamily: Fonts.body, fontSize: '9px', color: Colors.fog,
      }).setOrigin(0.5).setScrollFactor(0).setDepth(402));

      // Hit area
      const hit = this.add.rectangle(x + btnW / 2, y + btnH / 2, btnW, btnH, 0x000000, 0)
        .setScrollFactor(0).setDepth(403).setInteractive();
      hit.on('pointerdown', () => {
        const gameScene = this.scene.get('GameScene') as any;
        if (gameScene?.player) {
          gameScene.player.applyUpgrade(ch.type);
          EventBus.emit('items-changed', gameScene.player.getAllItems());
          AudioManager.pickup();
          EventBus.emit('toast', `${ch.icon} ${ch.label} 적용!`, '#3DC47E');
        }
        this.hideLevelUpChoices();
      });
      this.levelUpElements.push(hit);
    });
  }

  private hideLevelUpChoices(): void {
    for (const obj of this.levelUpElements) {
      obj.destroy();
    }
    this.levelUpElements = [];
  }

  private showRespawnOverlay(duration: number): void {
    this.hideRespawnOverlay();
    const w = this.scale.width;
    const h = this.scale.height;

    // Dim background
    const dim = this.add.rectangle(0, 0, w, h, 0x000000, 0.55)
      .setOrigin(0, 0).setScrollFactor(0).setDepth(450);
    this.respawnGroup.push(dim);

    // Title — "SUNK"
    const title = this.add.text(w / 2, h * 0.32, '☠ SUNK ☠', {
      fontFamily: Fonts.display, fontSize: '54px',
      color: Colors.bloodRed, stroke: '#000000', strokeThickness: 6,
      shadow: { offsetX: 0, offsetY: 4, color: '#000000', blur: 8, fill: true },
    }).setOrigin(0.5).setScrollFactor(0).setDepth(451).setAlpha(0);
    this.respawnGroup.push(title);
    this.tweens.add({ targets: title, alpha: 1, duration: 400 });

    // Subtitle
    const sub = this.add.text(w / 2, h * 0.42, '재출항 준비중...', {
      fontFamily: Fonts.heading, fontSize: '18px',
      color: Colors.parchment, stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0.5).setScrollFactor(0).setDepth(451);
    this.respawnGroup.push(sub);

    // Big countdown number
    this.respawnText = this.add.text(w / 2, h * 0.55, `${Math.ceil(duration)}`, {
      fontFamily: Fonts.display, fontSize: '120px',
      color: Colors.brightGold, stroke: '#000000', strokeThickness: 8,
      shadow: { offsetX: 0, offsetY: 6, color: '#000000', blur: 12, fill: true },
    }).setOrigin(0.5).setScrollFactor(0).setDepth(451);
    this.respawnGroup.push(this.respawnText);

    // Pulse animation on countdown
    this.tweens.add({
      targets: this.respawnText,
      scale: { from: 0.85, to: 1.15 },
      duration: 800,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.InOut',
    });

    const hint = this.add.text(w / 2, h * 0.7, '부상병이 회복되면 본거지에서 다시 출항합니다', {
      fontFamily: Fonts.body, fontSize: '12px',
      color: Colors.fog, fontStyle: 'italic',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(451);
    this.respawnGroup.push(hint);
  }

  private hideRespawnOverlay(): void {
    for (const obj of this.respawnGroup) {
      this.tweens.killTweensOf(obj);
      obj.destroy();
    }
    this.respawnGroup = [];
    this.respawnText = null;
  }

  /** Show floating toast text near top-center */
  private showToast(message: string, color: string = '#3DC47E'): void {
    const w = this.scale.width;
    const h = this.scale.height;
    const t = this.add.text(w / 2, h * 0.18, message, {
      fontSize: '16px',
      fontFamily: '"Noto Sans KR", sans-serif',
      color,
      fontStyle: 'bold',
      stroke: '#000000',
      strokeThickness: 3,
    }).setOrigin(0.5).setScrollFactor(0).setDepth(300);

    this.tweens.add({
      targets: t,
      y: t.y - 30,
      alpha: 0,
      duration: 1500,
      ease: 'Quad.Out',
      onComplete: () => t.destroy(),
    });
  }

  private updateHUD(data: HUDData): void {
    // Store targets — update() handles smooth lerp toward these
    this.targetHp = data.hp;
    this.targetMaxHp = data.maxHp;
    this.targetGold = data.gold;
    if (this.displayedHp === 0) this.displayedHp = data.hp;
    if (this.displayedGold === 0) this.displayedGold = data.gold;

    this.killText.setText(`☠ ${data.kills}`);
    this.aliveText.setText(`⚓ Crew ${Math.max(0, data.alive - 1)}`);

    // Level/XP display (next to HP bar)
    const gameRef = this.scene.get('GameScene') as any;
    if (gameRef?.player && this.hpText) {
      const lvl = gameRef.player.level ?? 1;
      const xp = gameRef.player.xp ?? 0;
      const nextXp = gameRef.player.xpForNextLevel ?? 100;
      this.hpText.setText(`Lv.${lvl} HP ${Math.ceil(this.displayedHp)} / ${Math.ceil(this.targetMaxHp)}`);
      // Mini XP bar under HP bar
      if (nextXp > 0) {
        const xpBarW = 206;
        const xpBarX = 20;
        const xpBarY = 54;
        const xpRatio = Phaser.Math.Clamp(xp / nextXp, 0, 1);
        this.hpBar.fillStyle(Hex.darkWood, 0.8);
        this.hpBar.fillRoundedRect(xpBarX, xpBarY, xpBarW, 5, 1);
        this.hpBar.fillStyle(Hex.brightGold, 0.9);
        this.hpBar.fillRoundedRect(xpBarX, xpBarY, xpBarW * xpRatio, 5, 1);
      }
    }

    // Skill button cooldown
    const gs = this.scene.get('GameScene') as any;
    if (gs?.player && this.skillButtonGfx) {
      const cd = gs.player.skillCooldown ?? 0;
      const skill = gs.player.config?.skill;
      const maxCd = skill?.cooldown ?? 1;
      const ratio = Phaser.Math.Clamp(cd / maxCd, 0, 1);
      const label = skill?.displayName ?? '스킬';
      this.drawSkillButton(ratio, label);
      this.skillCooldownText.setText(cd > 0 ? `${Math.ceil(cd)}s` : '');
    }

    const mins = Math.floor(data.gameTime / 60);
    const secs = Math.floor(data.gameTime % 60);
    this.timerText.setText(`${mins}:${secs.toString().padStart(2, '0')}`);

    const gameScene = this.scene.get('GameScene') as any;
    if (gameScene) {
      if (gameScene.isMultiplayer) {
        this.waveText.setVisible(false);
      } else {
        this.waveText.setVisible(true);
        const roman = ['Ⅰ', 'Ⅱ', 'Ⅲ', 'Ⅳ', 'Ⅴ', 'Ⅵ', 'Ⅶ', 'Ⅷ', 'Ⅸ', 'Ⅹ'];
        const n = gameScene.waveNumber || 1;
        const r = roman[n - 1] ?? `${n}`;
        this.waveText.setText(`TIDE ${r}`);
      }
    }

    this.drawMinimap();
  }

  private drawMinimap(): void {
    const mm = this.minimap;
    mm.clear();

    const w = this.scale.width;
    const narrow = w < 500;
    const size = narrow ? 72 : 100;
    const mx = w - size - 8;
    const my = narrow ? 62 : 60;

    mm.fillStyle(0x0A1628, 0.85);
    mm.fillRoundedRect(mx, my, size, size, 4);
    mm.lineStyle(1, 0x2A4A7A, 0.8);
    mm.strokeRoundedRect(mx, my, size, size, 4);

    const gameScene = this.scene.get('GameScene') as any;
    if (!gameScene || !gameScene.player) return;

    const mapW = this.balance.map.worldWidth;
    const mapH = this.balance.map.worldHeight;
    const scale = size / mapW;

    // Islands
    if (gameScene.islands) {
      for (const island of gameScene.islands) {
        const color = island.type === 'rocks' ? 0x666666 : 0x4A7A3A;
        mm.fillStyle(color, 0.7);
        mm.fillCircle(mx + island.x * scale, my + island.y * scale, island.radius * scale);
      }
    }

    // Safe zone
    if (gameScene.safeZoneRadius) {
      mm.lineStyle(1, 0xE84545, 0.4);
      mm.strokeCircle(mx + (mapW / 2) * scale, my + (mapH / 2) * scale, gameScene.safeZoneRadius * scale);
    }

    // Towers + Nexus
    for (const tower of gameScene.towers ?? []) {
      if (tower.isDead) continue;
      const color = tower.team === 0 ? 0x66CCFF : 0xFF4444;
      mm.fillStyle(color, 1);
      const r = tower.isNexus ? 4 : 2.5;
      mm.fillRect(mx + tower.x * scale - r / 2, my + tower.y * scale - r / 2, r, r);
      if (tower.isNexus) {
        mm.lineStyle(1, 0xFFDD66, 1);
        mm.strokeRect(mx + tower.x * scale - r / 2 - 1, my + tower.y * scale - r / 2 - 1, r + 2, r + 2);
      }
    }

    // Allies (blue)
    for (const ally of gameScene.allies ?? []) {
      if (ally.isDead) continue;
      mm.fillStyle(0x66CCFF, 0.9);
      mm.fillCircle(mx + ally.x * scale, my + ally.y * scale, 2);
    }

    // Enemies (red)
    for (const enemy of gameScene.enemies ?? []) {
      if (enemy.isDead) continue;
      mm.fillStyle(0xFF4444, 0.9);
      mm.fillCircle(mx + enemy.x * scale, my + enemy.y * scale, 2);
    }

    // Creeps
    for (const creep of gameScene.creeps ?? []) {
      if (!creep.active) continue;
      mm.fillStyle(0xAA6644, 0.5);
      mm.fillCircle(mx + creep.x * scale, my + creep.y * scale, 1);
    }

    // Pirate NPCs (purple dots)
    for (const pirate of [...(gameScene.pirateNPCs ?? []), ...(gameScene.pirateBosses ?? [])]) {
      if (pirate.isDead) continue;
      const isBoss = (gameScene.pirateBosses ?? []).includes(pirate);
      mm.fillStyle(isBoss ? 0xFFAA00 : 0xAA44CC, 0.9);
      const r = isBoss ? 3.5 : 2;
      mm.fillCircle(mx + pirate.x * scale, my + pirate.y * scale, r);
      if (isBoss) {
        mm.lineStyle(1, 0xFFDD66, 1);
        mm.strokeCircle(mx + pirate.x * scale, my + pirate.y * scale, r + 1);
      }
    }

    // Treasure pickups (gold diamond)
    for (const tp of gameScene.treasures ?? []) {
      if (!tp.active) continue;
      mm.fillStyle(Hex.brightGold, 1);
      const tx = mx + tp.x * scale;
      const ty = my + tp.y * scale;
      // Diamond shape
      mm.fillTriangle(tx, ty - 2.5, tx - 2, ty, tx + 2, ty);
      mm.fillTriangle(tx, ty + 2.5, tx - 2, ty, tx + 2, ty);
    }

    // Player (yellow, larger)
    if (!gameScene.player.isDead) {
      mm.fillStyle(0xFFDD00, 1);
      mm.fillCircle(mx + gameScene.player.x * scale, my + gameScene.player.y * scale, 3.5);
      mm.lineStyle(1, 0x000000, 1);
      mm.strokeCircle(mx + gameScene.player.x * scale, my + gameScene.player.y * scale, 3.5);
    }
  }

  private showWaveNotice(waveNum: number): void {
    this.waveNotice.setText(`⚔  TIDE ${waveNum}  ⚔`);
    this.waveNotice.setAlpha(0);
    this.tweens.add({
      targets: this.waveNotice,
      alpha: 1,
      duration: 300,
      yoyo: true,
      hold: 800,
      onComplete: () => this.waveNotice.setAlpha(0),
    });
  }

  // ========== SKILL BUTTON ==========

  private skillButtonGfx!: Phaser.GameObjects.Graphics;
  private skillButtonText!: Phaser.GameObjects.Text;
  private skillCooldownText!: Phaser.GameObjects.Text;

  private createSkillButton(w: number, h: number): void {
    const btnSize = 64;
    const btnX = 18;
    const btnY = h - btnSize - 150;

    this.skillButtonGfx = this.add.graphics().setScrollFactor(0).setDepth(100);

    this.skillButtonText = this.add.text(btnX + btnSize / 2, btnY + btnSize / 2 - 4, '스킬', {
      fontSize: '11px', fontFamily: '"Noto Sans KR", sans-serif', color: '#FFFFFF', fontStyle: 'bold',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(101);

    this.skillCooldownText = this.add.text(btnX + btnSize / 2, btnY + btnSize / 2 + 10, '', {
      fontSize: '13px', fontFamily: '"Noto Sans KR", sans-serif', color: '#FFDD66', fontStyle: 'bold',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(101);

    const hit = this.add.rectangle(btnX + btnSize / 2, btnY + btnSize / 2, btnSize, btnSize, 0x000000, 0)
      .setInteractive().setScrollFactor(0).setDepth(102);
    hit.on('pointerdown', () => EventBus.emit('use-skill'));

    // Keyboard shortcut: SPACE
    this.input.keyboard?.on('keydown-SPACE', () => EventBus.emit('use-skill'));

    // Update every frame via HUD update
    this.skillButtonGfx.setData('x', btnX);
    this.skillButtonGfx.setData('y', btnY);
    this.skillButtonGfx.setData('size', btnSize);
    this.drawSkillButton(0, '스킬');
  }

  private drawSkillButton(cooldownRatio: number, label: string): void {
    const g = this.skillButtonGfx;
    const x = g.getData('x') as number;
    const y = g.getData('y') as number;
    const size = g.getData('size') as number;
    g.clear();

    const ready = cooldownRatio <= 0;
    const cx = x + size / 2;
    const cy = y + size / 2;
    const r = size / 2 - 2;

    // Outer wood ring
    g.fillStyle(Hex.darkWood, 1);
    g.fillCircle(cx, cy, r + 2);
    // Brass border
    g.lineStyle(2, ready ? Hex.brightGold : Hex.fog, 0.95);
    g.strokeCircle(cx, cy, r + 1);

    // Inner background (red when ready, dark grey otherwise)
    if (ready) {
      // Pulsing glow when ready
      const pulse = 0.8 + Math.sin(this.time.now * 0.005) * 0.15;
      g.fillStyle(Hex.bloodRed, pulse);
      g.fillCircle(cx, cy, r);
      g.fillStyle(Hex.fireRed, 0.6);
      g.fillCircle(cx - r * 0.2, cy - r * 0.3, r * 0.5);
    } else {
      g.fillStyle(Hex.iron, 0.9);
      g.fillCircle(cx, cy, r);
    }

    // Radial cooldown sweep (clockwise from top, like LoL)
    if (cooldownRatio > 0) {
      g.fillStyle(0x000000, 0.65);
      g.beginPath();
      g.moveTo(cx, cy);
      const startAngle = -Math.PI / 2;
      const endAngle = startAngle + cooldownRatio * Math.PI * 2;
      g.arc(cx, cy, r, startAngle, endAngle, false);
      g.closePath();
      g.fillPath();
    }

    // Inner highlight ring
    g.lineStyle(1, ready ? 0xFFFFFF : 0x666666, ready ? 0.4 : 0.2);
    g.strokeCircle(cx, cy, r - 3);

    this.skillButtonText.setText(label.length > 8 ? label.slice(0, 8) : label);
    this.skillButtonText.setColor(ready ? '#FFFFFF' : '#888888');
  }

  // ========== ITEM SLOTS (dynamic - matches current ship's total slots) ==========

  private slotSize: number = 44;
  private slotGap: number = 5;
  private currentSlotCount: number = 0;

  // Animated displayed values (lerp toward target)
  private displayedHp: number = 0;
  private displayedGold: number = 0;
  private itemSlotHits: Phaser.GameObjects.Rectangle[] = [];
  private targetHp: number = 0;
  private targetMaxHp: number = 0;
  private targetGold: number = 0;

  /** Tear down old slots and create new ones for the given count. */
  private rebuildItemSlots(count: number): void {
    for (const g of this.itemSlots) g.destroy();
    for (const t of this.itemTexts) t.destroy();
    for (const h of this.itemSlotHits) h.destroy();
    for (const img of this.itemIcons) img.destroy();
    this.itemSlots = [];
    this.itemTexts = [];
    this.itemSlotHits = [];
    this.itemIcons = [];

    const w = this.scale.width;
    const h = this.scale.height;
    // Adapt slot size if too many to fit
    this.slotSize = count >= 11 ? 38 : count >= 7 ? 42 : 48;
    this.slotGap = count >= 11 ? 4 : 6;

    const totalW = count * this.slotSize + (count - 1) * this.slotGap;
    const startX = (w - totalW) / 2;
    const slotY = h - this.slotSize - 130;

    for (let i = 0; i < count; i++) {
      const x = startX + i * (this.slotSize + this.slotGap);
      const g = this.add.graphics().setScrollFactor(0).setDepth(100);
      g.fillStyle(0x132240, 0.9);
      g.fillRoundedRect(x, slotY, this.slotSize, this.slotSize, 5);
      g.lineStyle(1.5, 0x2A4A7A, 0.8);
      g.strokeRoundedRect(x, slotY, this.slotSize, this.slotSize, 5);
      this.itemSlots.push(g);

      // Icon image (hidden until an item is equipped in this slot)
      const icon = this.add.image(x + this.slotSize / 2, slotY + this.slotSize / 2, '__missing__')
        .setScrollFactor(0).setDepth(101).setVisible(false);
      this.itemIcons.push(icon);

      // Abbreviated label (shown as fallback when no icon texture)
      const txt = this.add.text(x + this.slotSize / 2, slotY + this.slotSize - 8, '', {
        fontSize: count >= 11 ? '8px' : '9px',
        fontFamily: '"Noto Sans KR", sans-serif', color: '#E8F4FF',
        align: 'center', wordWrap: { width: this.slotSize - 4 }, fontStyle: 'bold',
        stroke: '#000000', strokeThickness: 2,
      }).setOrigin(0.5, 1).setScrollFactor(0).setDepth(102);
      this.itemTexts.push(txt);

      // Hit area for selling — click equipped item to sell
      const hit = this.add.rectangle(x + this.slotSize / 2, slotY + this.slotSize / 2,
        this.slotSize, this.slotSize, 0x000000, 0,
      ).setScrollFactor(0).setDepth(102).setInteractive();
      const slotIdx = i;
      hit.on('pointerdown', () => {
        EventBus.emit('sell-item', slotIdx);
      });
      this.itemSlotHits.push(hit);
    }
    this.currentSlotCount = count;
  }

  private createItemSlots(_w: number, _h: number): void {
    // Initial: 4 slots (will be updated when ship loads)
    this.rebuildItemSlots(4);
  }

  private updateItemSlots(items: ItemConfig[]): void {
    // Determine the player's current total slot count
    const gameScene = this.scene.get('GameScene') as any;
    const slots = gameScene?.player?.config?.slots;
    const targetCount = slots ? (slots.weapon + slots.armor + slots.special) : 4;

    if (targetCount !== this.currentSlotCount) {
      this.rebuildItemSlots(targetCount);
    }

    const w = this.scale.width;
    const h = this.scale.height;
    const totalW = this.currentSlotCount * this.slotSize + (this.currentSlotCount - 1) * this.slotGap;
    const startX = (w - totalW) / 2;
    const slotY = h - this.slotSize - 130;

    for (let i = 0; i < this.currentSlotCount; i++) {
      const x = startX + i * (this.slotSize + this.slotGap);
      const g = this.itemSlots[i];
      g.clear();

      if (i < items.length) {
        const item = items[i];
        const typeColors: Record<string, number> = {
          weapon: 0xE84545, armor: 0x4A9ECC, special: 0xF5A623,
        };
        const fillColors: Record<string, number> = {
          weapon: 0x2A1515, armor: 0x152A3A, special: 0x2A2010,
        };
        g.fillStyle(fillColors[item.type] ?? 0x1E3357, 0.95);
        g.fillRoundedRect(x, slotY, this.slotSize, this.slotSize, 5);
        g.lineStyle(1.5, typeColors[item.type] ?? 0x2A4A7A, 0.9);
        g.strokeRoundedRect(x, slotY, this.slotSize, this.slotSize, 5);

        // Icon (Whisk PNG preferred, procedural canvas fallback)
        const iconKey = this.iconKeyForItem(item);
        const icon = this.itemIcons[i];
        if (this.textures.exists(iconKey)) {
          icon.setTexture(iconKey).setVisible(true);
          const tex = this.textures.get(iconKey);
          const src = tex?.getSourceImage() as HTMLImageElement | undefined;
          const target = this.slotSize - 8;
          const iconScale = src ? target / Math.max(src.width, src.height) : 1;
          icon.setScale(iconScale);
          icon.setPosition(x + this.slotSize / 2, slotY + this.slotSize / 2 - 3);
        } else {
          icon.setVisible(false);
        }

        // Small name label at bottom of slot (kept for readability)
        const abbr = item.displayName.split(' ').map(w => w[0]).join('').slice(0, 3);
        this.itemTexts[i].setText(abbr);
        this.itemTexts[i].setColor('#E8F4FF');
        this.itemTexts[i].setPosition(x + this.slotSize / 2, slotY + this.slotSize - 2);
      } else {
        g.fillStyle(0x132240, 0.9);
        g.fillRoundedRect(x, slotY, this.slotSize, this.slotSize, 5);
        g.lineStyle(1.5, 0x2A4A7A, 0.5);
        g.strokeRoundedRect(x, slotY, this.slotSize, this.slotSize, 5);
        this.itemTexts[i].setText('');
        this.itemIcons[i].setVisible(false);
      }
    }
  }

  // ========== SHOP ==========

  private createShopButton(w: number, h: number): void {
    const btnSize = 56;
    const btnX = w - btnSize - 15;
    const btnY = h - btnSize - 150;

    const g = this.add.graphics().setScrollFactor(0).setDepth(100);
    g.fillStyle(0xF5A623, 1);
    g.fillRoundedRect(btnX, btnY, btnSize, btnSize, 10);
    g.lineStyle(2, 0xC47D0E, 1);
    g.strokeRoundedRect(btnX, btnY, btnSize, btnSize, 10);

    this.add.text(btnX + btnSize / 2, btnY + btnSize / 2, '상점', {
      fontSize: '13px', fontFamily: '"Noto Sans KR", sans-serif', color: '#0A1628', fontStyle: 'bold',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(101);

    const hitArea = this.add.rectangle(
      btnX + btnSize / 2, btnY + btnSize / 2,
      btnSize, btnSize, 0x000000, 0,
    ).setInteractive().setScrollFactor(0).setDepth(102);
    hitArea.on('pointerdown', () => {
      AudioManager.resume();
      AudioManager.click();
      this.toggleShop();
    });
  }

  /** Bottom margin so the shop panel clears mobile browser chrome + skill/shop buttons. */
  private shopPanelBottomMargin(): number {
    return 90;
  }

  /** Get the y-position where the shop panel begins (top edge). */
  private shopPanelTop(): number {
    return this.scale.height * 0.50; // compact panel — about 40% of viewport
  }

  private createShopOverlay(_w: number, _h: number): void {
    // No-op: shop is built dynamically in toggleShop / renderShopContent.
    // This avoids using Containers (which had broken input hit testing for children).
  }

  private addShopElement<T extends Phaser.GameObjects.GameObject>(obj: T): T {
    this.shopElements.push(obj);
    return obj;
  }

  private renderShopBackground(): void {
    const w = this.scale.width;
    const h = this.scale.height;
    const panelTop = this.shopPanelTop();
    const panelBottomY = h - this.shopPanelBottomMargin();
    const panelH = panelBottomY - panelTop;

    // Dim screen
    const dim = this.add.rectangle(0, 0, w, h, 0x000000, 0.5)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(200);
    this.addShopElement(dim);

    // Panel background
    const bg = this.add.graphics().setScrollFactor(0).setDepth(201);
    bg.fillStyle(0x0A1628, 0.97);
    bg.fillRoundedRect(0, panelTop, w, panelH, { tl: 16, tr: 16, bl: 0, br: 0 });
    bg.lineStyle(2, 0xF5A623, 0.7);
    bg.strokeRoundedRect(0, panelTop, w, panelH, { tl: 16, tr: 16, bl: 0, br: 0 });
    this.addShopElement(bg);

    // Title
    const title = this.add.text(15, panelTop + 12, '⚓ NAVAL SHOP', {
      fontSize: '20px', fontFamily: '"Noto Sans KR", sans-serif', color: '#F5A623', fontStyle: 'bold',
    }).setScrollFactor(0).setDepth(202);
    this.addShopElement(title);

    // Close button (rectangle hit area + visuals)
    const closeX = w - 30;
    const closeY = panelTop + 22;
    const closeBg = this.add.graphics().setScrollFactor(0).setDepth(202);
    closeBg.fillStyle(0xE84545, 0.95);
    closeBg.fillCircle(closeX, closeY, 16);
    closeBg.lineStyle(2, 0xFFFFFF, 0.5);
    closeBg.strokeCircle(closeX, closeY, 16);
    this.addShopElement(closeBg);

    const closeText = this.add.text(closeX, closeY, 'X', {
      fontSize: '18px', fontFamily: '"Noto Sans KR", sans-serif', color: '#FFFFFF', fontStyle: 'bold',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(203);
    this.addShopElement(closeText);

    const closeHit = this.add.rectangle(closeX, closeY, 36, 36, 0x000000, 0)
      .setScrollFactor(0)
      .setDepth(203)
      .setInteractive();
    closeHit.on('pointerdown', () => this.toggleShop());
    this.addShopElement(closeHit);

    // Tab buttons
    this.renderTabs(w, panelTop);
  }

  private renderTabs(w: number, panelTop: number): void {
    const tabs: { cat: ShopCategory; label: string }[] = [
      { cat: 'weapon', label: '무기' },
      { cat: 'armor', label: '방어구' },
      { cat: 'special', label: '특수' },
      { cat: 'ships', label: '배' },
    ];
    const tabW = (w - 30) / tabs.length;
    const tabY = panelTop + 50;

    for (let i = 0; i < tabs.length; i++) {
      const t = tabs[i];
      const x = 15 + i * tabW;
      const isActive = t.cat === this.currentCategory;

      const bg = this.add.graphics().setScrollFactor(0).setDepth(202);
      bg.fillStyle(isActive ? 0xF5A623 : 0x1A3A5C, 0.95);
      bg.fillRoundedRect(x + 2, tabY, tabW - 4, 30, 6);
      if (isActive) {
        bg.lineStyle(2, 0xFFDD66, 1);
        bg.strokeRoundedRect(x + 2, tabY, tabW - 4, 30, 6);
      }
      this.addShopElement(bg);

      const text = this.add.text(x + tabW / 2, tabY + 15, t.label, {
        fontSize: '12px', fontFamily: '"Noto Sans KR", sans-serif',
        color: isActive ? '#0A1628' : '#8BA8CC', fontStyle: 'bold',
      }).setOrigin(0.5).setScrollFactor(0).setDepth(203);
      this.addShopElement(text);

      const hit = this.add.rectangle(x + tabW / 2, tabY + 15, tabW - 4, 30, 0x000000, 0)
        .setScrollFactor(0)
        .setDepth(204)
        .setInteractive();
      hit.on('pointerdown', () => {
        this.currentCategory = t.cat;
        this.shopScrollX = 0;
        this.time.delayedCall(0, () => this.renderShopContent());
      });
      this.addShopElement(hit);
    }
  }

  private renderShopContent(): void {
    // Destroy old elements & rebuild
    for (const obj of this.shopElements) obj.destroy();
    this.shopElements = [];

    if (!this.shopOpen) return;

    // Background + tabs
    this.renderShopBackground();

    const w = this.scale.width;
    const h = this.scale.height;
    const panelTop = this.shopPanelTop();
    const panelBottom = h - this.shopPanelBottomMargin() - 10;

    const gameScene = this.scene.get('GameScene') as any;
    const playerGold = gameScene?.player?.gold ?? 0;

    if (this.currentCategory === 'ships') {
      this.renderShipsTab(w, panelTop, panelBottom, playerGold, gameScene);
      return;
    }

    // Filter items by base type and sort cheapest -> most expensive (left to right)
    let items = Object.values(this.balance.items)
      .filter(i => i.type === this.currentCategory)
      .sort((a, b) => a.cost - b.cost);

    let contentTop = panelTop + 95;
    if (this.currentCategory === 'weapon') {
      // Weapon subcategory pills
      contentTop = this.renderWeaponPills(w, panelTop) + 12;
      // Filter further by selected weapon category
      if (this.currentWeaponCategory !== 'all') {
        items = items.filter(i => (i as WeaponItemConfig).category === this.currentWeaponCategory);
      }
    }

    this.renderItemsTab(items, w, contentTop, panelBottom, playerGold);
  }

  /** Nation filter pills for SHIPS tab */
  private renderNationPills(w: number, panelTop: number): number {
    const pills: { nation: Nation | 'all'; label: string }[] = [
      { nation: 'all', label: 'ALL' },
      { nation: 'KOR', label: '🇰🇷' },
      { nation: 'USA', label: '🇺🇸' },
      { nation: 'JPN', label: '🇯🇵' },
      { nation: 'GER', label: '🇩🇪' },
      { nation: 'GBR', label: '🇬🇧' },
      { nation: 'RUS', label: '🇷🇺' },
      { nation: 'PIRATE', label: '☠' },
      { nation: 'HISTORIC', label: '⚔' },
      { nation: 'MYTH', label: '🐉' },
    ];
    const pillH = 26;
    const gap = 4;
    const padding = 12;
    const availW = w - padding * 2;
    const pillW = (availW - gap * (pills.length - 1)) / pills.length;
    const py = panelTop + 88;

    for (let i = 0; i < pills.length; i++) {
      const p = pills[i];
      const px = padding + i * (pillW + gap);
      const isActive = this.currentNation === p.nation;

      const bg = this.add.graphics().setScrollFactor(0).setDepth(202);
      bg.fillStyle(isActive ? 0xD4A847 : 0x2A1A10, 0.95);
      bg.fillRoundedRect(px, py, pillW, pillH, 5);
      if (isActive) {
        bg.lineStyle(2, 0xFFDD66, 1);
        bg.strokeRoundedRect(px, py, pillW, pillH, 5);
      } else {
        bg.lineStyle(1, 0x6B4423, 0.8);
        bg.strokeRoundedRect(px, py, pillW, pillH, 5);
      }
      this.addShopElement(bg);

      const text = this.add.text(px + pillW / 2, py + pillH / 2, p.label, {
        fontSize: '11px', fontFamily: '"Noto Sans KR", sans-serif',
        color: isActive ? '#0A1208' : '#D4A847', fontStyle: 'bold',
      }).setOrigin(0.5).setScrollFactor(0).setDepth(203);
      this.addShopElement(text);

      const hit = this.add.rectangle(px + pillW / 2, py + pillH / 2, pillW, pillH, 0x000000, 0)
        .setScrollFactor(0).setDepth(204).setInteractive();
      hit.on('pointerdown', () => {
        this.currentNation = p.nation;
        this.shopScrollX = 0;
        this.time.delayedCall(0, () => this.renderShopContent());
      });
      this.addShopElement(hit);
    }

    return py + pillH;
  }

  /** Render weapon subcategory filter pills. Returns y-position of the pill row bottom. */
  private renderWeaponPills(w: number, panelTop: number): number {
    const pills: { cat: WeaponCategory | 'all'; label: string }[] = [
      { cat: 'all', label: 'ALL' },
      { cat: 'sniper', label: '저격' },
      { cat: 'rapid', label: '연발' },
      { cat: 'splash', label: '폭발' },
      { cat: 'pierce', label: '관통' },
      { cat: 'homing', label: '유도' },
      { cat: 'chain', label: '체인' },
      { cat: 'flame', label: '화염' },
      { cat: 'beam', label: '빔' },
    ];
    const pillH = 24;
    const gap = 4;
    const padding = 12;
    const availW = w - padding * 2;
    const pillW = (availW - gap * (pills.length - 1)) / pills.length;
    const py = panelTop + 90;

    for (let i = 0; i < pills.length; i++) {
      const p = pills[i];
      const px = padding + i * (pillW + gap);
      const isActive = this.currentWeaponCategory === p.cat;

      const bg = this.add.graphics().setScrollFactor(0).setDepth(202);
      bg.fillStyle(isActive ? 0xE84545 : 0x2A1A1A, 0.95);
      bg.fillRoundedRect(px, py, pillW, pillH, 4);
      if (isActive) {
        bg.lineStyle(1.5, 0xFFAAAA, 1);
        bg.strokeRoundedRect(px, py, pillW, pillH, 4);
      }
      this.addShopElement(bg);

      const text = this.add.text(px + pillW / 2, py + pillH / 2, p.label, {
        fontSize: '11px', fontFamily: '"Noto Sans KR", sans-serif',
        color: isActive ? '#FFFFFF' : '#AA8888', fontStyle: 'bold',
      }).setOrigin(0.5).setScrollFactor(0).setDepth(203);
      this.addShopElement(text);

      const hit = this.add.rectangle(px + pillW / 2, py + pillH / 2, pillW, pillH, 0x000000, 0)
        .setScrollFactor(0).setDepth(204).setInteractive();
      hit.on('pointerdown', () => {
        this.currentWeaponCategory = p.cat;
        this.shopScrollX = 0;
        this.time.delayedCall(0, () => this.renderShopContent());
      });
      this.addShopElement(hit);
    }

    return py + pillH;
  }

  private renderItemsTab(items: ItemConfig[], w: number, contentTop: number, panelBottom: number, playerGold: number): void {
    const cardW = 100;
    const cardH = panelBottom - contentTop - 16;
    const gap = 8;
    const sideMargin = 36; // space for arrow buttons

    // Total width and clamp scroll
    const totalW = items.length * (cardW + gap) - gap;
    const viewW = w - sideMargin * 2;
    this.shopScrollMax = Math.max(0, totalW - viewW);
    this.shopScrollX = Phaser.Math.Clamp(this.shopScrollX, 0, this.shopScrollMax);

    items.forEach((item, idx) => {
      const cx = sideMargin + idx * (cardW + gap) - this.shopScrollX;
      const cy = contentTop + 8;

      // Skip cards far off-screen for performance
      if (cx + cardW < 0 || cx > w) return;

      const typeFill: Record<string, number> = {
        weapon: 0x2A1515, armor: 0x152A3A, special: 0x2A2010,
      };
      const typeBorder: Record<string, number> = {
        weapon: 0xE84545, armor: 0x4A9ECC, special: 0xF5A623,
      };
      const canAfford = playerGold >= item.cost;

      // Card background
      const card = this.add.graphics().setScrollFactor(0).setDepth(202);
      card.fillStyle(typeFill[item.type] ?? 0x132240, canAfford ? 0.95 : 0.6);
      card.fillRoundedRect(cx, cy, cardW, cardH, 8);
      card.lineStyle(2, typeBorder[item.type] ?? 0x2A4A7A, canAfford ? 0.9 : 0.4);
      card.strokeRoundedRect(cx, cy, cardW, cardH, 8);
      // Top bevel highlight
      card.lineStyle(1, 0xFFFFFF, 0.15);
      card.lineBetween(cx + 4, cy + 2, cx + cardW - 4, cy + 2);
      this.addShopElement(card);

      // Icon at top — auto-scale so big PNGs (Whisk 512²) don't blow up the card
      const iconKey = this.iconKeyForItem(item);
      if (iconKey && this.textures.exists(iconKey)) {
        const icon = this.add.image(cx + cardW / 2, cy + 30, iconKey)
          .setScrollFactor(0).setDepth(203);
        const iconTex = this.textures.get(iconKey);
        const iconSrc = iconTex?.getSourceImage() as HTMLImageElement | undefined;
        if (iconSrc) {
          const boxSize = 42; // smaller icon for compact card
          const s = boxSize / Math.max(iconSrc.width, iconSrc.height);
          icon.setScale(s);
        } else {
          icon.setScale(0.7);
        }
        if (!canAfford) icon.setAlpha(0.4);
        this.addShopElement(icon);
      }

      // Name
      this.addShopElement(this.add.text(cx + cardW / 2, cy + 58, item.displayName, {
        fontSize: '10px', fontFamily: '"Noto Sans KR", sans-serif',
        color: canAfford ? '#E8F4FF' : '#666666', fontStyle: 'bold',
        wordWrap: { width: cardW - 6 }, align: 'center',
      }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(203));

      // Stats line — compact Korean labels
      let statsLine = '';
      if (item.type === 'weapon') {
        const wp = item as any;
        statsLine = `공${wp.damage} 사${wp.range}\n${wp.attackSpeed.toFixed(1)}/s`;
      } else if (item.type === 'armor') {
        const a = item as any;
        const parts: string[] = [];
        if (a.armorBonus) parts.push(`방+${a.armorBonus}`);
        if (a.hpBonus) parts.push(`HP+${a.hpBonus}`);
        statsLine = parts.join(' ');
      } else if (item.type === 'special') {
        const s = item as any;
        if (s.speedMultiplier && s.speedMultiplier !== 1) {
          statsLine = `속도 x${s.speedMultiplier}`;
        }
      }
      this.addShopElement(this.add.text(cx + cardW / 2, cy + 92, statsLine, {
        fontSize: '9px', fontFamily: '"Noto Sans KR", sans-serif', color: '#FFAA66',
        align: 'center',
      }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(203));

      // Cost (sits clearly above the BUY button)
      this.addShopElement(this.add.text(cx + cardW / 2, cy + cardH - 52, `${item.cost}g`, {
        fontSize: '14px', fontFamily: '"Noto Sans KR", sans-serif',
        color: canAfford ? '#FFD700' : '#666666', fontStyle: 'bold',
      }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(203));

      // Buy button
      const btnW = cardW - 16;
      const btnH = 22;
      const btnX = cx + 8;
      const btnY = cy + cardH - btnH - 6;
      const btnBg = this.add.graphics().setScrollFactor(0).setDepth(203);
      btnBg.fillStyle(canAfford ? 0x3DC47E : 0x444444, 0.95);
      btnBg.fillRoundedRect(btnX, btnY, btnW, btnH, 5);
      this.addShopElement(btnBg);
      this.addShopElement(this.add.text(btnX + btnW / 2, btnY + btnH / 2, '구매', {
        fontSize: '13px', fontFamily: '"Noto Sans KR", sans-serif',
        color: canAfford ? '#0A1628' : '#888888', fontStyle: 'bold',
      }).setOrigin(0.5).setScrollFactor(0).setDepth(204));
      if (canAfford) {
        const hit = this.add.rectangle(
          btnX + btnW / 2, btnY + btnH / 2,
          btnW, btnH, 0x000000, 0,
        ).setScrollFactor(0).setDepth(205).setInteractive();
        hit.on('pointerup', () => {
          if (this.shopWasDragged) return;
          EventBus.emit('buy-item', item.id);
        });
        this.addShopElement(hit);
      }
    });

    // Scroll arrows
    this.renderScrollArrows(w, contentTop, cardH);
  }

  /** Determine which icon texture to use for an item.
   * Prefers the Whisk-generated `weapon_gen_{cat}.png` when loaded, otherwise
   * falls back to the procedural `icon_{cat}` canvas texture from BootScene. */
  private iconKeyForItem(item: ItemConfig): string {
    const pick = (cat: string): string => {
      const gen = `weapon_gen_${cat}`;
      return this.textures.exists(gen) ? gen : `icon_${cat}`;
    };
    if (item.type === 'armor') return pick('armor');
    if (item.type === 'special') return pick('special');
    const weapon = item as any;
    if (weapon.category) return pick(weapon.category);
    const pt = weapon.projectileType;
    if (pt === 'splash' || pt === 'plasma') return pick('splash');
    if (pt === 'piercing' || pt === 'rail') return pick('pierce');
    if (pt === 'homing') return pick('homing');
    if (pt === 'lightning' || pt === 'chain') return pick('chain');
    if (pt === 'flame') return pick('flame');
    if (pt === 'laser') return pick('beam');
    return pick('rapid');
  }

  /** Render < and > arrow buttons for horizontal scroll */
  private renderScrollArrows(w: number, contentTop: number, cardH: number): void {
    const arrowY = contentTop + 8 + cardH / 2;
    const arrowSize = 40;

    // Left arrow
    if (this.shopScrollX > 0) {
      const lBg = this.add.graphics().setScrollFactor(0).setDepth(206);
      lBg.fillStyle(0x1A3A5C, 0.9);
      lBg.fillCircle(arrowSize / 2 + 4, arrowY, arrowSize / 2);
      lBg.lineStyle(2, 0xF5A623, 0.7);
      lBg.strokeCircle(arrowSize / 2 + 4, arrowY, arrowSize / 2);
      this.addShopElement(lBg);

      this.addShopElement(this.add.text(arrowSize / 2 + 4, arrowY, '◀', {
        fontSize: '20px', fontFamily: '"Noto Sans KR", sans-serif', color: '#F5A623', fontStyle: 'bold',
      }).setOrigin(0.5).setScrollFactor(0).setDepth(207));

      const lHit = this.add.rectangle(arrowSize / 2 + 4, arrowY, arrowSize, arrowSize, 0x000000, 0)
        .setScrollFactor(0).setDepth(208).setInteractive();
      lHit.on('pointerdown', () => {
        this.shopScrollX = Math.max(0, this.shopScrollX - 280);
        // Defer re-render so click handler finishes before elements are destroyed
        this.time.delayedCall(0, () => this.renderShopContent());
      });
      this.addShopElement(lHit);
    }

    // Right arrow
    if (this.shopScrollX < this.shopScrollMax) {
      const rX = w - arrowSize / 2 - 4;
      const rBg = this.add.graphics().setScrollFactor(0).setDepth(206);
      rBg.fillStyle(0x1A3A5C, 0.9);
      rBg.fillCircle(rX, arrowY, arrowSize / 2);
      rBg.lineStyle(2, 0xF5A623, 0.7);
      rBg.strokeCircle(rX, arrowY, arrowSize / 2);
      this.addShopElement(rBg);

      this.addShopElement(this.add.text(rX, arrowY, '▶', {
        fontSize: '20px', fontFamily: '"Noto Sans KR", sans-serif', color: '#F5A623', fontStyle: 'bold',
      }).setOrigin(0.5).setScrollFactor(0).setDepth(207));

      const rHit = this.add.rectangle(rX, arrowY, arrowSize, arrowSize, 0x000000, 0)
        .setScrollFactor(0).setDepth(208).setInteractive();
      rHit.on('pointerdown', () => {
        this.shopScrollX = Math.min(this.shopScrollMax, this.shopScrollX + 280);
        this.time.delayedCall(0, () => this.renderShopContent());
      });
      this.addShopElement(rHit);
    }
  }

  private renderShipsTab(w: number, panelTop: number, panelBottom: number, playerGold: number, gameScene: any): void {
    // Render nation pills first, get content top
    const contentTop = this.renderNationPills(w, panelTop) + 12;

    const order: ShipId[] = [
      'patrolboat',
      'trireme', 'viking', 'destroyer',
      'cruiser', 'pirate', 'galleon', 'panokseon', 'submarine', 'blackpearl', 'royalfortune',
      'medic', 'hwacha', 'warcrier',
      'battleship', 'hood', 'iowa', 'turtleship', 'pyotr', 'carrier', 'flyingdutchman',
      'seawitch',
      'yamato', 'akagi',
      'kraken', 'phoenix', 'ghostship', 'thundership',
    ];
    let ships = order
      .filter(id => this.balance.ships[id])
      .map(id => ({ id, cost: this.balance.ships[id].cost ?? 0 }))
      .sort((a, b) => a.cost - b.cost);

    // Filter by nation if selected
    if (this.currentNation !== 'all') {
      ships = ships.filter(s => this.balance.ships[s.id].nation === this.currentNation);
    }

    const cardW = 175;
    const cardH = panelBottom - contentTop - 8;
    const gap = 12;
    const sideMargin = 48;

    const totalW = ships.length * (cardW + gap) - gap;
    const viewW = w - sideMargin * 2;
    this.shopScrollMax = Math.max(0, totalW - viewW);
    this.shopScrollX = Phaser.Math.Clamp(this.shopScrollX, 0, this.shopScrollMax);

    const currentShipId = gameScene?.player?.config?.id;
    const flags: Partial<Record<ShipId, string>> = {
      patrolboat: '🇰🇷', destroyer: '🇰🇷', panokseon: '🇰🇷', turtleship: '🇰🇷',
      cruiser: '🇬🇧', hood: '🇬🇧',
      submarine: '🇷🇺', pyotr: '🇷🇺',
      battleship: '🇩🇪',
      carrier: '🇺🇸', iowa: '🇺🇸',
      yamato: '🇯🇵', akagi: '🇯🇵',
      pirate: '☠', blackpearl: '☠', flyingdutchman: '🐙', royalfortune: '👑',
      viking: '⚔', trireme: '👁', galleon: '⛵',
      kraken: '🐙', phoenix: '🔥', ghostship: '👻', thundership: '⚡',
      medic: '💚', seawitch: '🕸', hwacha: '🇰🇷', warcrier: '🥁',
    };

    ships.forEach((s, i) => {
      const cfg = this.balance.ships[s.id];
      const cx = sideMargin + i * (cardW + gap) - this.shopScrollX;
      const cy = contentTop;
      if (cx + cardW < 0 || cx > w) return;

      const isCurrent = currentShipId === s.id;
      const canAfford = playerGold >= s.cost && !isCurrent;

      const card = this.add.graphics().setScrollFactor(0).setDepth(202);
      card.fillStyle(isCurrent ? 0x1F4A7C : 0x152A3A, canAfford || isCurrent ? 0.95 : 0.6);
      card.fillRoundedRect(cx, cy, cardW, cardH, 8);
      card.lineStyle(2, isCurrent ? 0xFFDD66 : (canAfford ? 0x4A9ECC : 0x2A4A7A), 0.9);
      card.strokeRoundedRect(cx, cy, cardW, cardH, 8);
      // Top bevel
      card.lineStyle(1, 0xFFFFFF, 0.15);
      card.lineBetween(cx + 4, cy + 2, cx + cardW - 4, cy + 2);
      this.addShopElement(card);

      // Ship sprite preview (fits within ~40% of card height, respects aspect ratio)
      // Whisk PNGs are 1024² square while procedural HQ sprites are tall thin —
      // scale by the longer dimension so both fit inside the same visual box.
      const previewX = cx + cardW / 2;
      const previewY = cy + 12 + cardH * 0.25;
      const genKey = `ship_gen_${s.id}`;
      const spriteKey = this.textures.exists(genKey) ? genKey : cfg.spriteName;
      const previewSprite = this.add.image(previewX, previewY, spriteKey)
        .setScrollFactor(0).setDepth(203);
      const tex = this.textures.get(spriteKey);
      const src = tex?.getSourceImage() as HTMLImageElement | undefined;
      if (src) {
        const boxW = cardW - 28;
        const boxH = cardH * 0.42;
        const scale = Math.min(boxW / src.width, boxH / src.height);
        previewSprite.setScale(scale);
      }
      this.addShopElement(previewSprite);

      // Tier + Role badge
      const tierLabel = cfg.tier ? `T${cfg.tier}` : '';
      const roleIcons: Record<string, string> = {
        tank: '🛡', dps: '⚔', speed: '💨', artillery: '🎯', support: '💚',
      };
      const roleIcon = cfg.role ? roleIcons[cfg.role] ?? '' : '';
      const tierColors: Record<number, string> = {
        1: Colors.fog, 2: Colors.foam, 3: Colors.brightGold, 4: Colors.fireRed, 5: '#FF44FF',
      };
      const tierColor = cfg.tier ? tierColors[cfg.tier] ?? Colors.parchment : Colors.parchment;

      // Tier badge at top-right of card
      if (tierLabel) {
        this.addShopElement(this.add.text(cx + cardW - 6, cy + 6, tierLabel, {
          fontFamily: Fonts.numeric, fontSize: '11px', color: tierColor, fontStyle: 'bold',
          stroke: '#000000', strokeThickness: 2,
        }).setOrigin(1, 0).setScrollFactor(0).setDepth(204));
      }

      // Name with flag + role icon
      this.addShopElement(this.add.text(cx + cardW / 2, cy + cardH * 0.46, `${flags[s.id] ?? ''} ${cfg.displayName}`, {
        fontFamily: Fonts.display, fontSize: '13px', color: tierColor, fontStyle: 'bold',
        align: 'center', wordWrap: { width: cardW - 8 },
        stroke: '#000000', strokeThickness: 2,
      }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(203));

      // Role + Era line
      const roleText = cfg.role ? `${roleIcon} ${cfg.role.toUpperCase()}` : '';
      const eraText = cfg.era ?? '';
      const subLine = [roleText, eraText].filter(Boolean).join(' · ');
      if (subLine) {
        this.addShopElement(this.add.text(cx + cardW / 2, cy + cardH * 0.55, subLine, {
          fontFamily: Fonts.body, fontSize: '8px', color: Colors.faded, fontStyle: 'italic',
        }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(203));
      }

      // Stats inline
      this.addShopElement(this.add.text(cx + cardW / 2, cy + cardH * 0.63, `HP ${cfg.hp}  SPD ${cfg.speed}  ARM ${cfg.armor}`, {
        fontFamily: Fonts.numeric, fontSize: '10px', color: Colors.brightGold,
      }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(203));

      // Slots
      this.addShopElement(this.add.text(cx + cardW / 2, cy + cardH * 0.71, `${cfg.slots.weapon}W · ${cfg.slots.armor}A · ${cfg.slots.special}S`, {
        fontFamily: Fonts.numeric, fontSize: '9px', color: Colors.foam,
      }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(203));

      // Skill preview (most important for buying decision)
      if (cfg.skill) {
        const skillIcons: Record<string, string> = {
          dash: '💨', berserk: '⚡', ram: '🔱', plunder: '🩹', salvo: '💥',
          fire_breath: '🔥', stealth: '🌊', broadside: '⚔', volley: '🏹',
          smoke_screen: '💨', tracer_round: '🎯', plane_burst: '✈',
          heal_aura: '💚', net_throw: '🕸', war_cry: '🥁',
        };
        const icon = skillIcons[cfg.skill.type] ?? '⭐';
        this.addShopElement(this.add.text(cx + cardW / 2, cy + cardH * 0.79,
          `${icon} ${cfg.skill.displayName}`, {
          fontFamily: Fonts.heading, fontSize: '10px', color: '#FFDD66',
          align: 'center',
          stroke: '#000000', strokeThickness: 2,
        }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(203));
      }

      // Flavor text (historical context)
      if (cfg.flavor) {
        this.addShopElement(this.add.text(cx + cardW / 2, cy + cardH * 0.86, cfg.flavor, {
          fontFamily: Fonts.body, fontSize: '7px', color: Colors.fog,
          align: 'center', wordWrap: { width: cardW - 12 },
          fontStyle: 'italic',
        }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(203));
      }

      // Bottom: cost or EQUIPPED + buy button
      if (isCurrent) {
        this.addShopElement(this.add.text(cx + cardW / 2, cy + cardH - 14, '장착중', {
          fontSize: '11px', fontFamily: '"Noto Sans KR", sans-serif', color: '#FFDD66', fontStyle: 'bold',
        }).setOrigin(0.5).setScrollFactor(0).setDepth(203));
      } else {
        // Cost
        this.addShopElement(this.add.text(cx + cardW / 2, cy + cardH - 32, `${s.cost}g`, {
          fontSize: '12px', fontFamily: '"Noto Sans KR", sans-serif',
          color: canAfford ? '#FFD700' : '#666666', fontStyle: 'bold',
        }).setOrigin(0.5).setScrollFactor(0).setDepth(203));

        // Buy button
        const btnW = cardW - 16;
        const btnH = 22;
        const btnX = cx + 8;
        const btnY = cy + cardH - btnH - 5;
        const buyBg = this.add.graphics().setScrollFactor(0).setDepth(203);
        buyBg.fillStyle(canAfford ? 0x3DC47E : 0x444444, 0.95);
        buyBg.fillRoundedRect(btnX, btnY, btnW, btnH, 5);
        this.addShopElement(buyBg);
        this.addShopElement(this.add.text(btnX + btnW / 2, btnY + btnH / 2, '구매', {
          fontSize: '12px', fontFamily: '"Noto Sans KR", sans-serif',
          color: canAfford ? '#0A1628' : '#888888', fontStyle: 'bold',
        }).setOrigin(0.5).setScrollFactor(0).setDepth(204));
        if (canAfford) {
          const hit = this.add.rectangle(
            btnX + btnW / 2, btnY + btnH / 2,
            btnW, btnH, 0x000000, 0,
          ).setScrollFactor(0).setDepth(205).setInteractive();
          hit.on('pointerup', () => {
            if (this.shopWasDragged) return;
            EventBus.emit('buy-ship', { shipId: s.id, cost: s.cost });
          });
          this.addShopElement(hit);
        }
      }
    });

    this.renderScrollArrows(w, contentTop - 8, cardH);
  }

  private toggleShop(): void {
    this.shopOpen = !this.shopOpen;
    // Snap open/close — no slide animation. renderShopContent() handles
    // build (when open) and tear-down (when closed).
    this.renderShopContent();
  }

  /** Install pointer drag listeners so users can swipe through shop cards
   *  (touch or mouse drag). Only reacts while the shop is open and the
   *  pointer is in the shop panel area. */
  private setupShopSwipe(): void {
    const DRAG_THRESHOLD = 6;

    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (!this.shopOpen) return;
      const panelTop = this.shopPanelTop();
      if (p.y < panelTop + 60) return; // let tabs handle their own clicks
      this.shopDragActive = true;
      this.shopWasDragged = false;
      this.shopDragStartX = p.x;
      this.shopDragStartScroll = this.shopScrollX;
    });

    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (!this.shopDragActive) return;
      const dx = p.x - this.shopDragStartX;
      if (!this.shopWasDragged && Math.abs(dx) > DRAG_THRESHOLD) {
        this.shopWasDragged = true;
      }
      if (this.shopWasDragged) {
        this.shopScrollX = Phaser.Math.Clamp(
          this.shopDragStartScroll - dx, 0, this.shopScrollMax,
        );
        this.renderShopContent();
      }
    });

    this.input.on('pointerup', () => {
      this.shopDragActive = false;
      // Keep shopWasDragged true for a tick so BUY pointerup ignores the gesture
      this.time.delayedCall(30, () => { this.shopWasDragged = false; });
    });
  }

  // ========== MULTIPLAYER CHAT ==========

  /** Install chat overlay — only wires listeners once the game is running.
   *  Shows nothing if this isn't a multiplayer session. */
  private setupChat(): void {
    const gameScene = this.scene.get('GameScene') as any;
    const isMulti = !!gameScene?.isMultiplayer;
    if (!isMulti) return;

    // Message log — 4 most recent messages, top-left, above minimap area
    this.chatText = this.add.text(10, 44, '', {
      fontSize: '12px',
      fontFamily: '"Noto Sans KR", sans-serif',
      color: '#FFFFFF',
      backgroundColor: '#0A1628AA',
      padding: { left: 6, right: 6, top: 3, bottom: 3 },
      wordWrap: { width: 260 },
    }).setScrollFactor(0).setDepth(120).setAlpha(0.9);

    // Speech-bubble button — to the left of the shop button
    const h = this.scale.height;
    const w = this.scale.width;
    const btnSize = 48;
    const btnX = w - btnSize - 85;
    const btnY = h - btnSize - 150;
    const g = this.add.graphics().setScrollFactor(0).setDepth(100);
    g.fillStyle(0x2E6DA4, 1);
    g.fillRoundedRect(btnX, btnY, btnSize, btnSize, 10);
    g.lineStyle(2, 0x88CCEE, 0.8);
    g.strokeRoundedRect(btnX, btnY, btnSize, btnSize, 10);
    this.add.text(btnX + btnSize / 2, btnY + btnSize / 2, '💬', {
      fontSize: '22px',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(101);
    this.chatButtonHit = this.add.rectangle(btnX + btnSize / 2, btnY + btnSize / 2, btnSize, btnSize, 0, 0)
      .setScrollFactor(0).setDepth(102).setInteractive();
    this.chatButtonHit.on('pointerdown', () => this.openChatInput());

    // Keyboard shortcut: Enter to open chat
    this.input.keyboard?.on('keydown-ENTER', () => {
      if (!this.chatInput) this.openChatInput();
    });

    // Receive chat messages (reattach safe: removeAllListeners clears prior)
    NetworkManager.removeAllListeners('chat');
    NetworkManager.on('chat', (m: { from: string; team: number; text: string }) => {
      this.pushChat(m.from, m.team, m.text);
    });

    // Periodic cleanup so old messages fade away without a new message push
    this.time.addEvent({ delay: 1000, loop: true, callback: () => this.redrawChat() });
  }

  private pushChat(from: string, team: number, text: string): void {
    this.chatLog.push({ from, team, text, bornAt: this.time.now });
    if (this.chatLog.length > 6) this.chatLog.shift();
    this.redrawChat();
  }

  private redrawChat(): void {
    if (!this.chatText) return;
    const lines: string[] = [];
    const now = this.time.now;
    for (const e of this.chatLog) {
      const age = now - e.bornAt;
      if (age > 10000) continue;
      const prefix = e.team === 0 ? '🔵' : '🔴';
      lines.push(`${prefix} ${e.from}: ${e.text}`);
    }
    this.chatText.setText(lines.join('\n'));
  }

  private openChatInput(): void {
    if (this.chatInput) return;
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.maxLength = 120;
    inp.placeholder = '메시지 입력 (Enter 전송, Esc 취소)';
    inp.style.position = 'absolute';
    inp.style.left = '10px';
    inp.style.bottom = '80px';
    inp.style.width = 'calc(100% - 20px)';
    inp.style.maxWidth = '420px';
    inp.style.height = '40px';
    inp.style.padding = '0 10px';
    inp.style.background = '#0A1628EE';
    inp.style.border = '2px solid #2E6DA4';
    inp.style.borderRadius = '6px';
    inp.style.color = '#FFFFFF';
    inp.style.fontSize = '15px';
    inp.style.fontFamily = 'monospace';
    inp.style.zIndex = '999';
    inp.style.outline = 'none';
    document.body.appendChild(inp);
    this.chatInput = inp;
    setTimeout(() => inp.focus(), 30);

    const close = () => {
      inp.parentElement?.removeChild(inp);
      this.chatInput = null;
    };
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const text = inp.value.trim();
        if (text) NetworkManager.sendChat(text);
        close();
      } else if (e.key === 'Escape') {
        close();
      }
    });
    inp.addEventListener('blur', () => {
      // Close on blur so a tap outside dismisses the input cleanly on mobile
      setTimeout(close, 150);
    });
  }

  // ========== GAME OVER ==========

  private createGameOverOverlay(w: number, h: number): void {
    this.gameOverContainer = this.add.container(0, 0).setScrollFactor(0).setDepth(500).setVisible(false);
    const bg = this.add.graphics();
    bg.fillStyle(0x000000, 0.85);
    bg.fillRect(0, 0, w, h);
    this.gameOverContainer.add(bg);
  }

  private showGameOver(data: { won: boolean; placement: number; kills: number; gold: number; time: number }): void {
    AudioManager.gameOver(data.won);

    // Save to persistent profile (local)
    const gameScene = this.scene.get('GameScene') as any;
    const shipId = gameScene?.player?.config?.id ?? 'patrolboat';
    UserProfile.saveGame({
      kills: data.kills,
      wave: data.placement,
      gold: data.gold,
      won: data.won,
      shipId,
    });

    // Submit to server ranking (async, silent fail OK)
    RankingAPI.submitScore({
      userId: UserProfile.getUserId(),
      name: UserProfile.getName(),
      kills: data.kills,
      wave: data.placement,
      gold: data.gold,
      won: data.won,
      shipId,
    }).then(result => {
      if (result?.rank) {
        EventBus.emit('toast', `🏆 서버 랭킹 #${result.rank}!`, '#FFD700');
      }
    });
    const w = this.scale.width;
    const h = this.scale.height;
    this.gameOverContainer.setVisible(true);

    // Black overlay (slowly fades in)
    const overlay = this.add.rectangle(0, 0, w, h, 0x000000, 0)
      .setOrigin(0, 0).setScrollFactor(0).setDepth(500);
    this.gameOverContainer.add(overlay);
    this.tweens.add({ targets: overlay, fillAlpha: 0.85, duration: 800 });

    // Decorative skull/anchor above title
    const decoIcon = this.add.text(w / 2, h * 0.18, data.won ? '⚓' : '☠', {
      fontFamily: Fonts.display,
      fontSize: '90px',
      color: data.won ? Colors.brightGold : Colors.bloodRed,
    }).setOrigin(0.5).setScrollFactor(0).setDepth(501).setAlpha(0).setScale(0.5);
    this.gameOverContainer.add(decoIcon);
    this.tweens.add({
      targets: decoIcon, alpha: 1, scale: 1,
      duration: 700, delay: 400, ease: 'Back.Out',
    });

    // Massive title
    const title = this.add.text(w / 2, h * 0.32, data.won ? '승리' : '패배', {
      fontFamily: Fonts.display,
      fontSize: '80px',
      color: data.won ? Colors.brightGold : Colors.bloodRed,
      stroke: '#000000',
      strokeThickness: 8,
      shadow: { offsetX: 0, offsetY: 6, color: '#000000', blur: 12, fill: true },
    }).setOrigin(0.5).setScrollFactor(0).setDepth(501).setAlpha(0).setScale(1.6);
    this.gameOverContainer.add(title);
    this.tweens.add({
      targets: title, alpha: 1, scale: 1,
      duration: 900, delay: 700, ease: 'Back.Out',
    });

    // Korean subtitle
    const subtitle = this.add.text(w / 2, h * 0.32 + 60, data.won ? '바다는 그대의 것!' : '바다 깊이 잠들다...', {
      fontFamily: Fonts.heading,
      fontSize: '20px',
      color: data.won ? Colors.brightGold : Colors.fog,
      stroke: '#000000',
      strokeThickness: 3,
      fontStyle: 'italic',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(501).setAlpha(0);
    this.gameOverContainer.add(subtitle);
    this.tweens.add({ targets: subtitle, alpha: 1, duration: 800, delay: 1300 });

    // Decorative line
    const line = this.add.graphics().setScrollFactor(0).setDepth(501);
    line.lineStyle(2, Hex.brass, 0.7);
    line.lineBetween(w * 0.25, h * 0.46, w * 0.75, h * 0.46);
    this.gameOverContainer.add(line);

    // Stats panel (parchment-style)
    const panelW = 320;
    const panelH = 160;
    const panelX = w / 2 - panelW / 2;
    const panelY = h * 0.5;
    const panel = this.add.graphics().setScrollFactor(0).setDepth(501).setAlpha(0);
    panel.fillStyle(Hex.darkWood, 0.95);
    panel.fillRoundedRect(panelX - 4, panelY - 4, panelW + 8, panelH + 8, 8);
    panel.fillStyle(Hex.midWood, 1);
    panel.fillRoundedRect(panelX, panelY, panelW, panelH, 6);
    panel.lineStyle(2, Hex.brass, 0.85);
    panel.strokeRoundedRect(panelX, panelY, panelW, panelH, 6);
    // Brass rivets
    [-1, 1].forEach(sx => [-1, 1].forEach(sy => {
      panel.fillStyle(Hex.brass, 1);
      panel.fillCircle(panelX + panelW / 2 + sx * (panelW / 2 - 8), panelY + panelH / 2 + sy * (panelH / 2 - 8), 3);
    }));
    this.gameOverContainer.add(panel);
    this.tweens.add({ targets: panel, alpha: 1, duration: 600, delay: 1500 });

    // Stats with icons (animated reveal)
    const statsItems = [
      { icon: '⚔', label: '킬수', value: data.kills.toString() },
      { icon: '⚜', label: '골드', value: data.gold.toString() },
      { icon: '🌊', label: '라운드', value: data.placement.toString() },
      { icon: '⏱', label: '시간', value: `${Math.floor(data.time / 60)}:${Math.floor(data.time % 60).toString().padStart(2, '0')}` },
    ];

    statsItems.forEach((stat, i) => {
      const sy = panelY + 18 + i * 32;
      const labelText = this.add.text(panelX + 20, sy, `${stat.icon}  ${stat.label}`, {
        fontFamily: Fonts.heading,
        fontSize: '15px',
        color: Colors.parchment,
      }).setScrollFactor(0).setDepth(502).setAlpha(0);
      this.gameOverContainer.add(labelText);

      const valueText = this.add.text(panelX + panelW - 20, sy, stat.value, {
        fontFamily: Fonts.numeric,
        fontSize: '17px',
        color: Colors.brightGold,
        fontStyle: 'bold',
      }).setOrigin(1, 0).setScrollFactor(0).setDepth(502).setAlpha(0);
      this.gameOverContainer.add(valueText);

      this.tweens.add({
        targets: [labelText, valueText],
        alpha: 1,
        x: '+=10',
        duration: 500,
        delay: 1700 + i * 150,
        ease: 'Cubic.Out',
      });
    });

    // Play again button (wax seal style)
    const btnY = h * 0.85;
    const btnW = 240;
    const btnH = 56;
    const btn = this.add.graphics().setScrollFactor(0).setDepth(501).setAlpha(0);
    btn.fillStyle(Hex.brass, 1);
    btn.fillRoundedRect(w / 2 - btnW / 2 - 4, btnY - btnH / 2 - 4, btnW + 8, btnH + 8, 12);
    btn.fillStyle(Hex.midWood, 1);
    btn.fillRoundedRect(w / 2 - btnW / 2, btnY - btnH / 2, btnW, btnH, 10);
    btn.lineStyle(2, Hex.brassLight, 1);
    btn.strokeRoundedRect(w / 2 - btnW / 2, btnY - btnH / 2, btnW, btnH, 10);
    // Rivets
    [-1, 1].forEach(sx => [-1, 1].forEach(sy => {
      btn.fillStyle(Hex.iron, 1);
      btn.fillCircle(w / 2 + sx * (btnW / 2 - 12), btnY + sy * (btnH / 2 - 12), 3);
    }));
    this.gameOverContainer.add(btn);

    const btnLabel = this.add.text(w / 2, btnY - 8, '⚓ HOIST AGAIN ⚓', {
      fontFamily: Fonts.display,
      fontSize: '20px',
      color: Colors.parchment,
      stroke: '#000000',
      strokeThickness: 3,
    }).setOrigin(0.5).setScrollFactor(0).setDepth(502).setAlpha(0);
    this.gameOverContainer.add(btnLabel);

    const btnSub = this.add.text(w / 2, btnY + 14, '다시 시작', {
      fontFamily: Fonts.heading,
      fontSize: '11px',
      color: Colors.brightGold,
    }).setOrigin(0.5).setScrollFactor(0).setDepth(502).setAlpha(0);
    this.gameOverContainer.add(btnSub);

    this.tweens.add({
      targets: [btn, btnLabel, btnSub], alpha: 1,
      duration: 600, delay: 2400,
    });

    // Hit area
    const hit = this.add.rectangle(w / 2, btnY, btnW, btnH, 0x000000, 0)
      .setScrollFactor(0).setDepth(503).setInteractive();
    this.gameOverContainer.add(hit);
    hit.on('pointerdown', () => {
      AudioManager.click();
      this.scene.stop('GameScene');
      this.scene.stop('UIScene');
      this.scene.start('TitleScene');
    });
  }
}
