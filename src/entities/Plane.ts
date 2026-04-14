import Phaser from 'phaser';

interface PlaneTarget {
  x: number;
  y: number;
  active: boolean;
  isDead?: boolean;
  team: number;
}

/**
 * Carrier-launched fighter plane.
 * Flies above the water (visual depth = 7, above ships).
 * Locks onto nearest enemy ship/creep, kamikaze contact attack.
 */
export class Plane extends Phaser.GameObjects.Sprite {
  public hp: number = 40;
  public maxHp: number = 40;
  public ownerTeam: number;
  public team: number;
  public damage: number = 60;
  public planeSpeed: number = 220;
  public lifetime: number = 16000;
  public planeActive: boolean = true;

  private age: number = 0;
  private currentHeading: number;
  private shadowGraphic: Phaser.GameObjects.Graphics;

  constructor(scene: Phaser.Scene, x: number, y: number, ownerTeam: number, initialHeading: number) {
    super(scene, x, y, 'ship_plane');
    this.ownerTeam = ownerTeam;
    this.team = ownerTeam;
    this.currentHeading = initialHeading;

    scene.add.existing(this);
    this.setDepth(7); // above ships and projectiles
    this.setOrigin(0.5);
    this.setScale(0.7);

    // Tint by team
    this.setTint(ownerTeam === 0 ? 0xCCDDFF : 0xFFCCCC);

    // Shadow on water
    this.shadowGraphic = scene.add.graphics().setDepth(2);
  }

  takeDamage(amount: number): boolean {
    this.hp -= amount;
    if (this.hp <= 0) {
      this.kill();
      return true;
    }
    return false;
  }

  /** Update: pursue nearest enemy and contact attack */
  updatePlane(delta: number, targets: PlaneTarget[]): void {
    if (!this.planeActive) return;

    this.age += delta;
    if (this.age > this.lifetime) {
      this.kill();
      return;
    }

    // Filter to enemy targets
    const enemies = targets.filter(t => t.active && !t.isDead && t.team !== this.ownerTeam);

    if (enemies.length > 0) {
      // Find nearest
      const nearest = enemies.reduce((best, t) => {
        const d = Phaser.Math.Distance.Between(this.x, this.y, t.x, t.y);
        const bd = Phaser.Math.Distance.Between(this.x, this.y, best.x, best.y);
        return d < bd ? t : best;
      });

      // Smoothly steer toward target
      const targetAngle = Phaser.Math.Angle.Between(this.x, this.y, nearest.x, nearest.y);
      let diff = targetAngle - this.currentHeading;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      const turnRate = 4 * delta / 1000;
      this.currentHeading += Phaser.Math.Clamp(diff, -turnRate, turnRate);

      // Contact damage
      const dist = Phaser.Math.Distance.Between(this.x, this.y, nearest.x, nearest.y);
      if (dist < 28) {
        // Apply damage if it's a Ship-like object with takeDamage
        const t = nearest as any;
        if (typeof t.takeDamage === 'function') {
          t.takeDamage(this.damage);
        }
        this.spawnExplosion();
        this.kill();
        return;
      }
    }

    // Move forward along heading
    this.x += Math.cos(this.currentHeading) * this.planeSpeed * delta / 1000;
    this.y += Math.sin(this.currentHeading) * this.planeSpeed * delta / 1000;
    this.setRotation(this.currentHeading + Math.PI / 2);

    // Draw shadow slightly offset (gives sense of altitude)
    const sg = this.shadowGraphic;
    sg.clear();
    sg.fillStyle(0x000000, 0.3);
    sg.fillEllipse(this.x + 6, this.y + 6, 24, 10);
  }

  private spawnExplosion(): void {
    const boom = this.scene.add.sprite(this.x, this.y, 'explosion_1').setDepth(8).setScale(1.5);
    boom.play('explosion_anim');
    boom.once('animationcomplete', () => boom.destroy());
  }

  private kill(): void {
    this.planeActive = false;
    this.setVisible(false);
    this.shadowGraphic?.setVisible(false);
  }

  destroy(fromScene?: boolean): void {
    this.shadowGraphic?.destroy();
    super.destroy(fromScene);
  }
}
