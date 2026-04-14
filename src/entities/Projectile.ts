import Phaser from 'phaser';
import { ProjectileType } from '../config/types';

export interface HomingTarget {
  x: number;
  y: number;
  active: boolean;
  isDead?: boolean;
}

export class Projectile extends Phaser.GameObjects.Graphics {
  public speed: number;
  public damage: number;
  public projectileType: ProjectileType;
  public splashRadius: number;
  public ownerTeam: number;
  public target: { x: number; y: number } | null;
  public homingTarget: HomingTarget | null = null;
  public active: boolean = true;
  public chainsRemaining: number = 0;
  public hasHit: Set<number> = new Set();

  private lifespan: number = 4000;
  private age: number = 0;
  private vx: number;
  private vy: number;
  private trail: { x: number; y: number; age: number }[] = [];
  // For arc trajectory (splash/plasma artillery feel)
  private arcStartX: number = 0;
  private arcStartY: number = 0;
  private arcTotalDist: number = 0;
  private arcHeight: number = 0;
  private hasArc: boolean = false;
  private arcOffset: number = 0;
  // Range cap & travel tracking
  public maxRange: number = 9999;
  private traveledDist: number = 0;
  private spawnX: number;
  private spawnY: number;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    targetX: number,
    targetY: number,
    speed: number,
    damage: number,
    projectileType: ProjectileType,
    splashRadius: number,
    ownerTeam: number,
  ) {
    super(scene, { x, y });
    this.speed = speed;
    this.damage = damage;
    this.projectileType = projectileType;
    this.splashRadius = splashRadius;
    this.ownerTeam = ownerTeam;
    this.target = { x: targetX, y: targetY };
    this.spawnX = x;
    this.spawnY = y;

    // Type-specific lifespan (cosmetic cap, real range cap in update)
    if (projectileType === 'flame') this.lifespan = 600;
    else if (projectileType === 'rail') this.lifespan = 800;
    else if (projectileType === 'laser') this.lifespan = 600;

    scene.add.existing(this);
    this.setDepth(4);

    const angle = Phaser.Math.Angle.Between(x, y, targetX, targetY);
    this.vx = Math.cos(angle) * speed;
    this.vy = Math.sin(angle) * speed;

    // Arc trajectory for splash/plasma (artillery shells lob upward then down)
    if (projectileType === 'splash' || projectileType === 'plasma') {
      this.hasArc = true;
      this.arcStartX = x;
      this.arcStartY = y;
      this.arcTotalDist = Phaser.Math.Distance.Between(x, y, targetX, targetY);
      this.arcHeight = Math.min(60, this.arcTotalDist * 0.3);
    }

    this.spawnMuzzleFlash(scene, x, y);
  }

  setHomingTarget(target: HomingTarget): void {
    this.homingTarget = target;
  }

  private spawnMuzzleFlash(scene: Phaser.Scene, x: number, y: number): void {
    // Additive glow blob (gives the bright "lens flare" feel)
    const tints: Record<ProjectileType, number> = {
      normal: 0xFFDD66,
      splash: 0xFF8844,
      piercing: 0xCCEEFF,
      lightning: 0xCCBBFF,
      homing: 0xFFAA66,
      flame: 0xFF6622,
      rail: 0x44DDFF,
      plasma: 0x66FFAA,
      laser: 0xFF3366,
      chain: 0xCCBBFF,
      burst: 0xFFCC44,
    };
    const tint = tints[this.projectileType] ?? 0xFFDD66;
    const size = this.projectileType === 'rail' ? 30
      : this.projectileType === 'plasma' ? 26
      : this.projectileType === 'flame' ? 22
      : 20;

    const glow = scene.add.image(x, y, 'glow')
      .setDepth(6)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setTint(tint)
      .setScale(size / 64);

    scene.tweens.add({
      targets: glow,
      alpha: 0,
      scaleX: glow.scaleX * 1.8,
      scaleY: glow.scaleY * 1.8,
      duration: 220,
      ease: 'Cubic.Out',
      onComplete: () => glow.destroy(),
    });

    // Small bright spark on top
    const spark = scene.add.graphics({ x: 0, y: 0 }).setDepth(6);
    spark.fillStyle(0xFFFFFF, 0.95);
    spark.fillCircle(x, y, 3);
    scene.tweens.add({
      targets: spark,
      alpha: 0,
      duration: 120,
      onComplete: () => spark.destroy(),
    });
  }

  update(delta: number): void {
    if (!this.active) return;

    this.age += delta;
    if (this.age > this.lifespan) {
      this.deactivate();
      return;
    }

    // Range cap — fully stop at weapon's max range
    if (this.traveledDist >= this.maxRange) {
      this.deactivate();
      return;
    }

    // Auto-homing for ALL projectiles (except flame which goes straight)
    // Different turn rates per projectile type for visual feel
    if (this.projectileType !== 'flame' && this.homingTarget && this.homingTarget.active && !this.homingTarget.isDead) {
      const desiredAngle = Phaser.Math.Angle.Between(this.x, this.y, this.homingTarget.x, this.homingTarget.y);
      const currentAngle = Math.atan2(this.vy, this.vx);
      let diff = desiredAngle - currentAngle;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;

      // Turn rate: high for direct fire, lower for arced
      const turnRatePerSec =
        this.projectileType === 'rail' || this.projectileType === 'laser' ? 16 :
        this.projectileType === 'normal' || this.projectileType === 'piercing' ? 12 :
        this.projectileType === 'splash' || this.projectileType === 'plasma' ? 5 :
        this.projectileType === 'homing' ? 8 :
        10;
      const turnRate = turnRatePerSec * delta / 1000;
      const newAngle = currentAngle + Phaser.Math.Clamp(diff, -turnRate, turnRate);
      this.vx = Math.cos(newAngle) * this.speed;
      this.vy = Math.sin(newAngle) * this.speed;
    }

    this.trail.push({ x: this.x, y: this.y, age: 0 });
    if (this.trail.length > 12) this.trail.shift();

    const dx = this.vx * delta / 1000;
    const dy = this.vy * delta / 1000;
    this.x += dx;
    this.y += dy;
    this.traveledDist = Phaser.Math.Distance.Between(this.spawnX, this.spawnY, this.x, this.y);

    // Apply parabolic arc visual offset (top-down "lob" feel)
    if (this.hasArc && this.arcTotalDist > 0) {
      const traveled = Phaser.Math.Distance.Between(this.arcStartX, this.arcStartY, this.x, this.y);
      const progress = Phaser.Math.Clamp(traveled / this.arcTotalDist, 0, 1);
      // Sin curve: 0 at start, peak at midpoint, 0 at end
      this.arcOffset = Math.sin(progress * Math.PI) * this.arcHeight;
    }

    this.clear();
    this.drawTrail(delta);
    this.drawProjectile();

    if (this.target && !this.homingTarget) {
      const dist = Phaser.Math.Distance.Between(this.x, this.y, this.target.x, this.target.y);
      if (dist < 8 && (this.projectileType === 'splash' || this.projectileType === 'plasma')) {
        this.deactivate();
      }
    }
  }

  private drawTrail(delta: number): void {
    const trailColors: Record<ProjectileType, number> = {
      normal: 0xFFEE88,
      splash: 0xFF8855,
      piercing: 0xAADDFF,
      lightning: 0xBB99FF,
      homing: 0xFFAA66,
      flame: 0xFF8833,
      rail: 0x66DDFF,
      plasma: 0x66FFAA,
      laser: 0xFF6699,
      chain: 0xCCBBFF,
      burst: 0xFFCC44,
    };
    const color = trailColors[this.projectileType] ?? 0xFFEE88;

    for (let i = 0; i < this.trail.length; i++) {
      const t = this.trail[i];
      t.age += delta;
      const life = 1 - i / this.trail.length;
      const size = this.projectileType === 'plasma' ? 4 * life : 2 * life;
      this.fillStyle(color, life * 0.4);
      this.fillCircle(t.x - this.x, t.y - this.y, size);
    }
  }

  private drawProjectile(): void {
    switch (this.projectileType) {
      case 'splash': {
        // Shadow on water at logical position
        this.fillStyle(0x000000, 0.35);
        this.fillEllipse(0, 0, 8, 4);
        // Projectile lifted by arc offset
        const ay = -this.arcOffset;
        this.fillStyle(0x222222, 1);
        this.fillCircle(0, ay, 5);
        this.fillStyle(0xFF6B35, 0.9);
        this.fillCircle(0, ay, 3);
        // Highlight
        this.fillStyle(0xFFFFFF, 0.6);
        this.fillCircle(-1, ay - 1, 1);
        break;
      }

      case 'lightning':
        this.fillStyle(0x9370DB, 0.9);
        this.fillCircle(0, 0, 4);
        this.lineStyle(2, 0xBB99FF, 0.5);
        this.strokeCircle(0, 0, 7);
        this.lineStyle(1, 0xDDCCFF, 0.3);
        this.strokeCircle(0, 0, 10);
        // Random sparks
        for (let i = 0; i < 3; i++) {
          const a = Math.random() * Math.PI * 2;
          this.lineStyle(1, 0xFFFFFF, 0.6);
          this.lineBetween(0, 0, Math.cos(a) * 8, Math.sin(a) * 8);
        }
        break;

      case 'piercing': {
        const angle = Math.atan2(this.vy, this.vx);
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        this.fillStyle(0xAADDFF, 1);
        this.fillTriangle(
          cos * 8, sin * 8,
          -sin * 3, cos * 3,
          sin * 3, -cos * 3,
        );
        this.fillStyle(0xFFFFFF, 0.3);
        this.fillCircle(-cos * 6, -sin * 6, 2);
        break;
      }

      case 'flame': {
        const flicker = 0.7 + Math.random() * 0.3;
        // Outer flame
        this.fillStyle(0xFF3300, 0.5 * flicker);
        this.fillCircle(0, 0, 7);
        this.fillStyle(0xFF8800, 0.7 * flicker);
        this.fillCircle(0, 0, 5);
        this.fillStyle(0xFFDD00, 0.9 * flicker);
        this.fillCircle(0, 0, 3);
        this.fillStyle(0xFFFFFF, 0.6 * flicker);
        this.fillCircle(0, 0, 1.5);
        break;
      }

      case 'rail': {
        // Bright beam-like projectile
        const angle = Math.atan2(this.vy, this.vx);
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        this.lineStyle(4, 0x44DDFF, 0.4);
        this.lineBetween(-cos * 20, -sin * 20, cos * 8, sin * 8);
        this.lineStyle(2, 0xFFFFFF, 0.9);
        this.lineBetween(-cos * 18, -sin * 18, cos * 6, sin * 6);
        this.fillStyle(0xFFFFFF, 1);
        this.fillCircle(0, 0, 3);
        this.fillStyle(0x44DDFF, 0.6);
        this.fillCircle(0, 0, 6);
        break;
      }

      case 'plasma': {
        const pulse = 0.8 + Math.sin(this.age * 0.02) * 0.2;
        const ay = -this.arcOffset;
        // Shadow
        this.fillStyle(0x003322, 0.4);
        this.fillEllipse(0, 0, 12, 5);
        // Plasma orb (lifted)
        this.fillStyle(0x33FF99, 0.4 * pulse);
        this.fillCircle(0, ay, 10);
        this.fillStyle(0x66FFAA, 0.7 * pulse);
        this.fillCircle(0, ay, 7);
        this.fillStyle(0xCCFFEE, 0.9 * pulse);
        this.fillCircle(0, ay, 4);
        this.fillStyle(0xFFFFFF, pulse);
        this.fillCircle(0, ay, 2);
        break;
      }

      case 'laser': {
        const angle = Math.atan2(this.vy, this.vx);
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        this.lineStyle(3, 0xFF3366, 0.4);
        this.lineBetween(-cos * 12, -sin * 12, cos * 4, sin * 4);
        this.lineStyle(1.5, 0xFFFFFF, 1);
        this.lineBetween(-cos * 10, -sin * 10, cos * 3, sin * 3);
        this.fillStyle(0xFF6699, 0.8);
        this.fillCircle(0, 0, 2);
        break;
      }

      case 'chain': {
        this.fillStyle(0x9988FF, 0.9);
        this.fillCircle(0, 0, 3);
        this.lineStyle(2, 0xCCBBFF, 0.5);
        this.strokeCircle(0, 0, 6);
        // Crackling
        for (let i = 0; i < 2; i++) {
          const a = Math.random() * Math.PI * 2;
          this.lineStyle(1, 0xFFFFFF, 0.7);
          this.lineBetween(0, 0, Math.cos(a) * 5, Math.sin(a) * 5);
        }
        break;
      }

      case 'burst':
        this.fillStyle(0xFFCC44, 1);
        this.fillCircle(0, 0, 3);
        this.fillStyle(0xFFFFFF, 0.4);
        this.fillCircle(-1, -1, 1.5);
        break;

      case 'homing': {
        const angle = Math.atan2(this.vy, this.vx);
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        // Missile body
        this.fillStyle(0x666666, 1);
        this.fillTriangle(
          cos * 8, sin * 8,
          -sin * 3, cos * 3,
          sin * 3, -cos * 3,
        );
        this.fillStyle(0xCCCCCC, 1);
        this.fillRect(-cos * 6 - 1, -sin * 6 - 1, 2, 2);
        // Exhaust flame
        this.fillStyle(0xFFAA00, 0.9);
        this.fillCircle(-cos * 8, -sin * 8, 3);
        this.fillStyle(0xFFFF66, 0.6);
        this.fillCircle(-cos * 8, -sin * 8, 1.5);
        break;
      }

      default:
        // normal cannonball
        this.fillStyle(0xFFDD44, 1);
        this.fillCircle(0, 0, 3.5);
        this.fillStyle(0xFFFFFF, 0.3);
        this.fillCircle(-1, -1, 1.5);
        break;
    }
  }

  deactivate(): void {
    this.active = false;
    this.setVisible(false);
  }

  destroy(fromScene?: boolean): void {
    super.destroy(fromScene);
  }
}
