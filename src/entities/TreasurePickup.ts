import Phaser from 'phaser';
import { Ship } from './Ship';
import { EventBus } from '../utils/EventBus';
import { Hex } from '../config/theme';
import { AudioManager } from '../utils/AudioManager';

/** Hidden treasure crate scattered on the map.
 * Touch with player ship to gain gold + small heal.
 * Respawns after a cooldown. Visible on minimap when active. */
export class TreasurePickup {
  public x: number;
  public y: number;
  public active: boolean = true;
  public goldAmount: number;
  public healPercent: number;

  private respawnTimer: number = 0;
  private readonly RESPAWN_TIME = 50; // seconds
  private scene: Phaser.Scene;
  private graphic: Phaser.GameObjects.Graphics;
  private glowGraphic: Phaser.GameObjects.Graphics;
  private pulseTime: number = 0;

  constructor(scene: Phaser.Scene, x: number, y: number, gold: number = 250, healPercent: number = 0.15) {
    this.scene = scene;
    this.x = x;
    this.y = y;
    this.goldAmount = gold;
    this.healPercent = healPercent;

    this.glowGraphic = scene.add.graphics().setDepth(3);
    this.graphic = scene.add.graphics().setDepth(4);
    this.draw();
  }

  private draw(): void {
    const g = this.graphic;
    g.clear();
    if (!this.active) {
      g.setVisible(false);
      this.glowGraphic.setVisible(false);
      return;
    }
    g.setVisible(true);
    this.glowGraphic.setVisible(true);

    // Soft golden glow around crate
    const glow = this.glowGraphic;
    glow.clear();
    glow.fillStyle(Hex.brightGold, 0.08);
    glow.fillCircle(this.x, this.y, 28);
    glow.fillStyle(Hex.brightGold, 0.15);
    glow.fillCircle(this.x, this.y, 16);

    // Shadow
    g.fillStyle(0x000000, 0.4);
    g.fillRoundedRect(this.x - 10, this.y - 6 + 2, 20, 14, 3);

    // Wooden crate body
    g.fillStyle(Hex.lightWood, 1);
    g.fillRoundedRect(this.x - 10, this.y - 8, 20, 14, 3);
    g.fillStyle(Hex.agedWood, 1);
    g.fillRoundedRect(this.x - 9, this.y - 7, 18, 12, 2);
    // Brass lock/clasp
    g.fillStyle(Hex.brightGold, 1);
    g.fillRect(this.x - 2, this.y - 8, 4, 3);
    // Gold shimmer dot
    g.fillStyle(0xFFFF88, 0.9);
    g.fillCircle(this.x, this.y - 1, 2);
    // Plank lines
    g.lineStyle(0.5, Hex.darkWood, 0.8);
    g.lineBetween(this.x - 9, this.y - 2, this.x + 9, this.y - 2);
  }

  update(delta: number, player: Ship): void {
    if (!this.active) {
      // Respawn countdown
      this.respawnTimer -= delta / 1000;
      if (this.respawnTimer <= 0) {
        this.active = true;
        this.draw();
      }
      return;
    }

    // Pulsing glow animation
    this.pulseTime += delta;
    const glowAlpha = 0.12 + Math.sin(this.pulseTime * 0.004) * 0.06;
    const glow = this.glowGraphic;
    glow.clear();
    glow.fillStyle(Hex.brightGold, glowAlpha);
    glow.fillCircle(this.x, this.y, 28);
    glow.fillStyle(Hex.brightGold, glowAlpha * 2);
    glow.fillCircle(this.x, this.y, 14);

    // Check player proximity
    if (player.isDead) return;
    const dist = Phaser.Math.Distance.Between(this.x, this.y, player.x, player.y);
    if (dist < 45) {
      this.collect(player);
    }
  }

  private collect(player: Ship): void {
    // Award gold + heal
    player.gold += this.goldAmount;
    player.heal(player.maxHp * this.healPercent);
    this.active = false;
    this.respawnTimer = this.RESPAWN_TIME;
    this.draw();

    // VFX: gold coins flying up
    for (let i = 0; i < 6; i++) {
      const coin = this.scene.add.text(
        this.x + Phaser.Math.Between(-12, 12),
        this.y - 10,
        '⚜',
        { fontSize: '14px', color: '#FFD700' },
      ).setDepth(15).setOrigin(0.5);
      this.scene.tweens.add({
        targets: coin,
        y: coin.y - 40 - Phaser.Math.Between(0, 20),
        alpha: 0,
        duration: 800,
        ease: 'Cubic.Out',
        onComplete: () => coin.destroy(),
      });
    }

    EventBus.emit('gold-changed', player.gold);
    EventBus.emit('toast', `💰 보물 +${this.goldAmount}g!`, '#FFD700');
    AudioManager.pickup();
  }

  destroy(): void {
    this.graphic?.destroy();
    this.glowGraphic?.destroy();
  }
}
