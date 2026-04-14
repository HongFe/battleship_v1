import Phaser from 'phaser';
import { Colors, Hex, Fonts, textStyle } from '../config/theme';
import { AudioManager } from '../utils/AudioManager';
import { UserProfile } from '../utils/UserProfile';
import { RankingAPI, RankingEntry } from '../utils/RankingAPI';

export class TitleScene extends Phaser.Scene {
  private cloudGfx!: Phaser.GameObjects.Graphics;
  private rainGfx!: Phaser.GameObjects.Graphics;
  private lightningGfx!: Phaser.GameObjects.Graphics;
  private stormTime: number = 0;
  private nextLightningAt: number = 3000;
  private rainDrops: { x: number; y: number; speed: number }[] = [];
  private heroShip!: Phaser.GameObjects.Image;
  private heroWake!: Phaser.GameObjects.Graphics;
  private titleText!: Phaser.GameObjects.Text;
  private flashRect!: Phaser.GameObjects.Rectangle;

  constructor() {
    super({ key: 'TitleScene' });
  }

  create(): void {
    const w = this.scale.width;
    const h = this.scale.height;

    // === Layer 0: deep stormy sky background ===
    const bg = this.add.graphics().setDepth(0);
    bg.fillGradientStyle(Hex.abyss, Hex.abyss, Hex.deepSea, Hex.midSea, 1);
    bg.fillRect(0, 0, w, h);

    // === Layer 1: storm clouds (animated) ===
    this.cloudGfx = this.add.graphics().setDepth(1);

    // === Layer 2: ocean waves at horizon ===
    const ocean = this.add.graphics().setDepth(2);
    ocean.fillStyle(Hex.midSea, 0.95);
    ocean.fillRect(0, h * 0.55, w, h * 0.45);
    ocean.fillStyle(Hex.deepSea, 0.6);
    ocean.fillRect(0, h * 0.55, w, h * 0.45);
    // Distant horizon line
    ocean.lineStyle(1, Hex.fog, 0.4);
    ocean.lineBetween(0, h * 0.55, w, h * 0.55);

    // === Layer 3: hero pirate ship sailing ===
    this.heroWake = this.add.graphics().setDepth(3);
    this.heroShip = this.add.image(w * 0.7, h * 0.72, 'ship_pirate')
      .setDepth(4)
      .setScale(0.85)
      .setRotation(-Math.PI / 2 + 0.15); // facing left, slight tilt
    // Gentle bobbing
    this.tweens.add({
      targets: this.heroShip,
      y: { from: h * 0.72 - 4, to: h * 0.72 + 4 },
      rotation: { from: -Math.PI / 2 + 0.10, to: -Math.PI / 2 + 0.20 },
      duration: 2400,
      ease: 'Sine.InOut',
      yoyo: true,
      repeat: -1,
    });

    // === Layer 4: lightning ===
    this.lightningGfx = this.add.graphics().setDepth(5);

    // === Layer 5: rain ===
    this.rainGfx = this.add.graphics().setDepth(6);
    for (let i = 0; i < 80; i++) {
      this.rainDrops.push({
        x: Math.random() * w,
        y: Math.random() * h,
        speed: 400 + Math.random() * 300,
      });
    }

    // === Layer 6: vignette (dark edges) ===
    this.add.image(0, 0, 'vignette')
      .setOrigin(0, 0)
      .setDisplaySize(w, h)
      .setDepth(7);

    // === Layer 7: TITLE — massive Pirata One ===
    // Decorative skull above title
    const skull = this.add.text(w / 2, h * 0.18, '☠', {
      fontFamily: Fonts.display,
      fontSize: '80px',
      color: Colors.bone,
    }).setOrigin(0.5).setDepth(10).setAlpha(0.85);
    this.tweens.add({
      targets: skull,
      alpha: { from: 0.7, to: 1 },
      duration: 2000,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.InOut',
    });

    this.titleText = this.add.text(w / 2, h * 0.32, 'BLACK TIDE', {
      fontFamily: Fonts.display,
      fontSize: '72px',
      color: Colors.parchment,
      stroke: '#000000',
      strokeThickness: 6,
      shadow: { offsetX: 0, offsetY: 6, color: '#000000', blur: 10, fill: true },
    }).setOrigin(0.5).setDepth(10);

    // Subtitle in Korean
    this.add.text(w / 2, h * 0.32 + 50, '검은 조류 — 해적의 항해', {
      fontFamily: Fonts.heading,
      fontSize: '20px',
      color: Colors.treasureGold,
      stroke: '#000000',
      strokeThickness: 3,
    }).setOrigin(0.5).setDepth(10);

    // Decorative line with anchors
    const decoLine = this.add.graphics().setDepth(10);
    decoLine.lineStyle(2, Hex.brass, 0.7);
    decoLine.lineBetween(w * 0.3, h * 0.42, w * 0.7, h * 0.42);
    this.add.text(w * 0.5, h * 0.42, '⚓', {
      fontFamily: Fonts.display, fontSize: '18px', color: Colors.brassLight,
    }).setOrigin(0.5).setDepth(11).setBackgroundColor(Colors.deepSea);

    // === Layer 8: BUTTONS — wax seal style ===
    this.createWaxButton(w / 2, h * 0.58, '⛵  단일 항해  ⛵', 'SET SAIL', () => {
      this.transitionTo('GameScene', { selectedShip: 'patrolboat' });
    });

    this.createWaxButton(w / 2, h * 0.58 + 90, '☠  멀티 약탈  ☠', 'PLUNDER 2v2', () => {
      this.transitionTo('LobbyScene');
    });

    // === Player profile ===
    const userName = UserProfile.getName();
    const rank = UserProfile.getRankTitle();
    const stats = UserProfile.getStats();
    const isTest = UserProfile.isTestAccount();
    const friendCode = UserProfile.getFriendCode();

    this.add.text(w / 2, h * 0.58 + 165, `${rank}  ${userName}${isTest ? ' (테스트)' : ''}`, {
      fontFamily: Fonts.heading,
      fontSize: '16px',
      color: isTest ? Colors.brightGold : Colors.parchment,
      stroke: '#000000',
      strokeThickness: 3,
    }).setOrigin(0.5).setDepth(10);

    // Friend code + stats
    this.add.text(w / 2, h * 0.58 + 188, `ID: #${friendCode}`, {
      fontFamily: Fonts.numeric,
      fontSize: '12px',
      color: Colors.brightGold,
      stroke: '#000000',
      strokeThickness: 2,
    }).setOrigin(0.5).setDepth(10);

    if (stats.gamesPlayed > 0) {
      this.add.text(w / 2, h * 0.58 + 206, `${stats.gamesPlayed}전 ${stats.wins}승 · 최고 Wave ${stats.bestWave} · 총 ☠${stats.totalKills}`, {
        fontFamily: Fonts.body,
        fontSize: '11px',
        color: Colors.fog,
      }).setOrigin(0.5).setDepth(10);
    }

    // === Server ranking (async load) ===
    this.loadRankingBoard(w, h);

    // Tagline + version
    this.add.text(w / 2, h - 35, '"항해를 시작하라, 선장이여..."', {
      fontFamily: Fonts.body,
      fontSize: '13px',
      color: Colors.fog,
      fontStyle: 'italic',
    }).setOrigin(0.5).setDepth(10);

    this.add.text(w - 10, h - 12, 'v0.3.0 · BLACK TIDE', {
      fontFamily: Fonts.numeric,
      fontSize: '10px',
      color: Colors.faded,
    }).setOrigin(1, 1).setDepth(10);

    // === Flash overlay (for lightning) ===
    this.flashRect = this.add.rectangle(0, 0, w, h, 0xFFFFFF, 0)
      .setOrigin(0, 0).setDepth(20);

    // Fade in
    this.cameras.main.fadeIn(800, 5, 11, 20);

    // Title intro animation
    this.titleText.setScale(1.4).setAlpha(0);
    this.tweens.add({
      targets: this.titleText,
      scale: 1,
      alpha: 1,
      duration: 1200,
      ease: 'Back.Out',
    });
  }

  /** Wax-seal style button (gold + red ring) */
  private createWaxButton(cx: number, cy: number, label: string, sub: string, onClick: () => void): void {
    const w = 300;
    const h = 64;

    const btn = this.add.graphics().setDepth(10);
    const drawBtn = (hover: boolean) => {
      btn.clear();
      // Outer brass ring
      btn.fillStyle(hover ? Hex.brassLight : Hex.brass, 1);
      btn.fillRoundedRect(cx - w / 2 - 4, cy - h / 2 - 4, w + 8, h + 8, 12);
      // Inner wood plate
      btn.fillStyle(hover ? Hex.lightWood : Hex.midWood, 1);
      btn.fillRoundedRect(cx - w / 2, cy - h / 2, w, h, 10);
      // Inner shadow
      btn.lineStyle(1, Hex.darkWood, 0.6);
      btn.strokeRoundedRect(cx - w / 2 + 2, cy - h / 2 + 2, w - 4, h - 4, 9);
      // Top gloss
      btn.fillStyle(Hex.brassLight, 0.18);
      btn.fillRoundedRect(cx - w / 2 + 4, cy - h / 2 + 4, w - 8, 6, 4);
      // Studs (rivets)
      btn.fillStyle(Hex.iron, 1);
      [-1, 1].forEach(sx =>
        [-1, 1].forEach(sy => {
          btn.fillCircle(cx + sx * (w / 2 - 12), cy + sy * (h / 2 - 12), 3);
          btn.fillStyle(Hex.brassLight, 0.4);
          btn.fillCircle(cx + sx * (w / 2 - 12) - 1, cy + sy * (h / 2 - 12) - 1, 1);
          btn.fillStyle(Hex.iron, 1);
        }),
      );
    };
    drawBtn(false);

    const labelText = this.add.text(cx, cy - 8, label, {
      fontFamily: Fonts.display,
      fontSize: '22px',
      color: Colors.parchment,
      stroke: '#000000',
      strokeThickness: 3,
    }).setOrigin(0.5).setDepth(11);

    const subText = this.add.text(cx, cy + 15, sub, {
      fontFamily: Fonts.heading,
      fontSize: '11px',
      color: Colors.brightGold,
    }).setOrigin(0.5).setDepth(11);

    const hit = this.add.rectangle(cx, cy, w, h, 0x000000, 0)
      .setInteractive({ useHandCursor: true }).setDepth(12);

    hit.on('pointerover', () => {
      drawBtn(true);
      labelText.setScale(1.04);
      subText.setScale(1.04);
    });
    hit.on('pointerout', () => {
      drawBtn(false);
      labelText.setScale(1);
      subText.setScale(1);
    });
    hit.on('pointerdown', () => {
      AudioManager.resume();
      AudioManager.click();
      onClick();
    });
  }

  private transitionTo(sceneKey: string, data?: any): void {
    this.cameras.main.fadeOut(500, 5, 11, 20);
    this.time.delayedCall(500, () => {
      this.scene.start(sceneKey, data);
    });
  }

  update(_time: number, delta: number): void {
    this.stormTime += delta;
    const w = this.scale.width;
    const h = this.scale.height;

    // === Storm clouds ===
    const c = this.cloudGfx;
    c.clear();
    for (let i = 0; i < 5; i++) {
      const offset = (this.stormTime * 0.02 + i * 200) % (w + 400) - 200;
      const cy = 60 + i * 25;
      c.fillStyle(0x0A0A12, 0.5);
      c.fillEllipse(offset, cy, 280, 60);
      c.fillStyle(0x18181F, 0.4);
      c.fillEllipse(offset + 30, cy - 8, 220, 50);
    }

    // === Rain ===
    const r = this.rainGfx;
    r.clear();
    r.lineStyle(1, 0x88AABB, 0.4);
    for (const drop of this.rainDrops) {
      drop.y += drop.speed * delta / 1000;
      if (drop.y > h) {
        drop.y = -10;
        drop.x = Math.random() * w;
      }
      r.lineBetween(drop.x, drop.y, drop.x - 4, drop.y + 12);
    }

    // === Lightning ===
    if (this.stormTime > this.nextLightningAt) {
      this.triggerLightning();
      this.nextLightningAt = this.stormTime + 4000 + Math.random() * 5000;
    }

    // === Hero ship wake ===
    const wake = this.heroWake;
    wake.clear();
    wake.fillStyle(0x88AACC, 0.3);
    for (let i = 0; i < 8; i++) {
      const t = (this.stormTime * 0.001 + i * 0.4) % 8;
      const wx = this.heroShip.x + 50 + t * 12;
      const wy = this.heroShip.y + Math.sin(t * 2) * 3;
      const size = 6 - t * 0.6;
      wake.fillCircle(wx, wy, Math.max(1, size));
    }
  }

  private async loadRankingBoard(w: number, h: number): Promise<void> {
    const rankings = await RankingAPI.getTopRankings(5);
    if (rankings.length === 0) return;

    // Small ranking panel at bottom-left
    const px = 12;
    const py = h - 140;
    const pw = 180;

    const bg = this.add.graphics().setDepth(10);
    bg.fillStyle(0x0A1520, 0.8);
    bg.fillRoundedRect(px, py, pw, 105, 6);
    bg.lineStyle(1, 0xD4A847, 0.6);
    bg.strokeRoundedRect(px, py, pw, 105, 6);

    this.add.text(px + pw / 2, py + 8, '🏆 RANKING', {
      fontFamily: Fonts.display,
      fontSize: '13px',
      color: Colors.brightGold,
      stroke: '#000000',
      strokeThickness: 2,
    }).setOrigin(0.5, 0).setDepth(11);

    rankings.slice(0, 5).forEach((entry: RankingEntry, i: number) => {
      const ey = py + 28 + i * 15;
      const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
      const name = entry.name.length > 8 ? entry.name.slice(0, 8) + '..' : entry.name;
      this.add.text(px + 8, ey, `${medal} ${name}`, {
        fontFamily: Fonts.body,
        fontSize: '10px',
        color: i < 3 ? Colors.parchment : Colors.fog,
      }).setDepth(11);

      this.add.text(px + pw - 8, ey, `${entry.score}pt`, {
        fontFamily: Fonts.numeric,
        fontSize: '10px',
        color: Colors.brightGold,
      }).setOrigin(1, 0).setDepth(11);
    });
  }

  private triggerLightning(): void {
    const w = this.scale.width;
    const h = this.scale.height;

    // Flash white
    this.flashRect.setAlpha(0.6);
    this.tweens.add({
      targets: this.flashRect,
      alpha: 0,
      duration: 150,
      ease: 'Quad.Out',
    });

    // Draw zigzag bolt
    const lg = this.lightningGfx;
    lg.clear();
    lg.lineStyle(3, 0xFFFFFF, 1);
    lg.beginPath();
    let x = 100 + Math.random() * (w - 200);
    let y = 0;
    lg.moveTo(x, y);
    while (y < h * 0.5) {
      x += (Math.random() - 0.5) * 60;
      y += 20 + Math.random() * 30;
      lg.lineTo(x, y);
    }
    lg.strokePath();
    // Glow
    lg.lineStyle(8, 0xCCBBFF, 0.3);
    lg.strokePath();

    this.tweens.add({
      targets: lg,
      alpha: { from: 1, to: 0 },
      duration: 250,
      onComplete: () => {
        lg.clear();
        lg.setAlpha(1);
      },
    });
  }
}
