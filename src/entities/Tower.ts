import Phaser from 'phaser';
import { Projectile } from './Projectile';

let __towerIdCounter = 1;

/** Static defense structure. Auto-fires projectiles at nearby enemies. */
export class Tower {
  public x: number;
  public y: number;
  public hp: number;
  public maxHp: number;
  public team: number;
  public isDead: boolean = false;
  public active: boolean = true;
  public range: number;
  public damage: number;
  public attackSpeed: number; // shots per second
  public isNexus: boolean;
  public __id: number = __towerIdCounter++;

  private cooldown: number = 0;
  private scene: Phaser.Scene;
  private base: Phaser.GameObjects.Graphics;
  private body: Phaser.GameObjects.Graphics;
  private hpBar: Phaser.GameObjects.Graphics;
  private label: Phaser.GameObjects.Text;
  private shadow: Phaser.GameObjects.Graphics;

  constructor(scene: Phaser.Scene, x: number, y: number, team: number, isNexus: boolean = false) {
    this.scene = scene;
    this.x = x;
    this.y = y;
    this.team = team;
    this.isNexus = isNexus;

    if (isNexus) {
      this.hp = this.maxHp = 8000;
      this.range = 380;
      this.damage = 200;
      this.attackSpeed = 0.8;
    } else {
      this.hp = this.maxHp = 3500;
      this.range = 400;
      this.damage = 120;
      this.attackSpeed = 1.0;
    }

    this.shadow = scene.add.graphics().setDepth(3.5);
    this.base = scene.add.graphics().setDepth(4);
    this.body = scene.add.graphics().setDepth(5);
    this.hpBar = scene.add.graphics().setDepth(10);
    this.label = scene.add.text(x, y - (isNexus ? 50 : 38), isNexus ? 'NEXUS' : 'Tower', {
      fontSize: isNexus ? '13px' : '10px',
      color: team === 0 ? '#66CCFF' : '#FF6666',
      fontFamily: 'monospace',
      fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(10);

    this.draw();
  }

  private draw(): void {
    const sh = this.shadow;
    const b = this.base;
    const body = this.body;
    sh.clear();
    b.clear();
    body.clear();

    const teamColor = this.team === 0 ? 0x4A8ECC : 0xCC4A4A;
    const teamDark = this.team === 0 ? 0x1F4A7C : 0x7C1F1F;
    const teamLight = this.team === 0 ? 0x88CCFF : 0xFFAA88;

    const baseR = this.isNexus ? 38 : 26;
    const towerR = this.isNexus ? 26 : 18;

    // Soft drop shadow on water
    sh.fillStyle(0x000018, 0.5);
    sh.fillEllipse(this.x + 5, this.y + 8, baseR * 2.1, baseR * 1.3);

    // Stone platform base
    b.fillStyle(0x333B44, 1);
    b.fillCircle(this.x, this.y, baseR);
    b.lineStyle(2, 0x555F6B, 1);
    b.strokeCircle(this.x, this.y, baseR);
    // Inner ring
    b.fillStyle(0x222830, 1);
    b.fillCircle(this.x, this.y, baseR - 6);

    // Team-colored tower body
    body.fillStyle(teamDark, 1);
    body.fillCircle(this.x, this.y, towerR);
    body.fillStyle(teamColor, 1);
    body.fillCircle(this.x, this.y, towerR - 3);
    // Inner core
    body.fillStyle(teamLight, 0.8);
    body.fillCircle(this.x, this.y, towerR - 8);

    // Cannon turret (dark square on top)
    body.fillStyle(0x222222, 1);
    body.fillCircle(this.x, this.y, 5);
    body.fillStyle(0x444444, 1);
    body.fillCircle(this.x - 1, this.y - 1, 3);

    if (this.isNexus) {
      // Nexus crystal marker (spikes)
      body.fillStyle(0xFFDD66, 1);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const px = this.x + Math.cos(a) * (towerR - 4);
        const py = this.y + Math.sin(a) * (towerR - 4);
        body.fillRect(px - 1.5, py - 1.5, 3, 3);
      }
    }

    // Subtle range ring
    body.lineStyle(1, teamColor, 0.08);
    body.strokeCircle(this.x, this.y, this.range);

    this.drawHp();
  }

  private drawHp(): void {
    const g = this.hpBar;
    g.clear();
    const barW = this.isNexus ? 70 : 50;
    const barH = this.isNexus ? 8 : 5;
    const barX = this.x - barW / 2;
    const barY = this.y - (this.isNexus ? 45 : 33);

    g.fillStyle(0x000000, 0.6);
    g.fillRoundedRect(barX, barY, barW, barH, 2);
    const ratio = this.hp / this.maxHp;
    const color = ratio > 0.5 ? 0x3DC47E : ratio > 0.25 ? 0xF5A623 : 0xE84545;
    g.fillStyle(color, 0.95);
    g.fillRoundedRect(barX + 1, barY + 1, (barW - 2) * ratio, barH - 2, 1);
    // Gloss
    g.fillStyle(0xFFFFFF, 0.25);
    g.fillRoundedRect(barX + 1, barY + 1, (barW - 2) * ratio, (barH - 2) / 2, 1);
  }

  takeDamage(amount: number): void {
    if (this.isDead) return;
    this.hp -= amount;
    if (this.hp <= 0) {
      this.hp = 0;
      this.die();
    } else {
      this.drawHp();
    }
  }

  private die(): void {
    this.isDead = true;
    this.active = false;

    // Big explosion
    const scale = this.isNexus ? 5 : 3.5;
    const boom = this.scene.add.sprite(this.x, this.y, 'explosion_1').setDepth(9).setScale(scale);
    boom.play('explosion_anim');
    boom.once('animationcomplete', () => boom.destroy());

    // Lingering fire
    const fire = this.scene.add.sprite(this.x, this.y, 'fire_1').setDepth(9).setScale(scale * 0.8);
    fire.play('fire_anim');
    this.scene.tweens.add({
      targets: fire,
      alpha: 0,
      delay: 1200,
      duration: 800,
      onComplete: () => fire.destroy(),
    });

    this.base.setVisible(false);
    this.body.setVisible(false);
    this.hpBar.setVisible(false);
    this.label.setVisible(false);
    this.shadow.setVisible(false);
  }

  /** Called every frame. Finds nearest enemy in range and fires. */
  update(delta: number, enemies: { x: number; y: number; team: number; isDead: boolean }[], projectiles: Projectile[]): void {
    if (this.isDead) return;
    this.cooldown -= delta / 1000;
    if (this.cooldown > 0) return;

    const targets = enemies.filter(e => !e.isDead && e.team !== this.team);
    const inRange = targets.filter(e =>
      Phaser.Math.Distance.Between(this.x, this.y, e.x, e.y) <= this.range
    );
    if (inRange.length === 0) return;

    const target = inRange.reduce((best, e) => {
      const d = Phaser.Math.Distance.Between(this.x, this.y, e.x, e.y);
      const bd = Phaser.Math.Distance.Between(this.x, this.y, best.x, best.y);
      return d < bd ? e : best;
    });

    // Spawn projectile (a beefy normal cannonball)
    const proj = new Projectile(
      this.scene,
      this.x, this.y,
      target.x, target.y,
      550,          // projectile speed
      this.damage,
      'normal',
      0,
      this.team,
    );
    projectiles.push(proj);
    this.cooldown = 1 / this.attackSpeed;
  }

  destroy(): void {
    this.shadow?.destroy();
    this.base?.destroy();
    this.body?.destroy();
    this.hpBar?.destroy();
    this.label?.destroy();
  }
}
