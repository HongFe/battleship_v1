import Phaser from 'phaser';

export class Creep extends Phaser.GameObjects.Graphics {
  public hp: number;
  public maxHp: number;
  public speed: number;
  public team: number = -1;
  public active: boolean = true;
  public goldValue: number = 50;   // gold awarded on kill
  public isElite: boolean = false;  // elite creeps are bigger + worth more

  private moveTimer: number = 0;
  private moveDir: Phaser.Math.Vector2;
  private heading: number;

  constructor(scene: Phaser.Scene, x: number, y: number, hp: number, speed: number) {
    super(scene, { x, y });
    this.hp = hp;
    this.maxHp = hp;
    this.speed = speed;
    this.heading = Phaser.Math.FloatBetween(0, Math.PI * 2);
    this.moveDir = new Phaser.Math.Vector2(
      Math.cos(this.heading),
      Math.sin(this.heading),
    );

    scene.add.existing(this);
    this.setDepth(4);

    // Elite creeps are marked visually and worth more gold
    if (hp >= 400) {
      this.isElite = true;
      this.goldValue = 200;
    }
    this.draw();
  }

  private draw(): void {
    this.clear();
    const cos = Math.cos(this.heading);
    const sin = Math.sin(this.heading);
    const rot = (fx: number, fy: number) => ({
      x: fx * cos - fy * sin,
      y: fx * sin + fy * cos,
    });

    // Small pirate skiff shape
    const bow = rot(14, 0);
    const portFore = rot(5, -7);
    const portAft = rot(-12, -6);
    const sternPort = rot(-14, -3);
    const stern = rot(-14, 0);
    const sternStarboard = rot(-14, 3);
    const starboardAft = rot(-12, 6);
    const starboardFore = rot(5, 7);

    // Hull shadow
    this.fillStyle(0x000000, 0.15);
    this.beginPath();
    this.moveTo(bow.x + 1, bow.y + 1);
    this.lineTo(portFore.x + 1, portFore.y + 1);
    this.lineTo(portAft.x + 1, portAft.y + 1);
    this.lineTo(stern.x + 1, stern.y + 1);
    this.lineTo(starboardAft.x + 1, starboardAft.y + 1);
    this.lineTo(starboardFore.x + 1, starboardFore.y + 1);
    this.closePath();
    this.fillPath();

    // Hull
    this.fillStyle(0x8B4513, 1);
    this.beginPath();
    this.moveTo(bow.x, bow.y);
    this.lineTo(portFore.x, portFore.y);
    this.lineTo(portAft.x, portAft.y);
    this.lineTo(sternPort.x, sternPort.y);
    this.lineTo(stern.x, stern.y);
    this.lineTo(sternStarboard.x, sternStarboard.y);
    this.lineTo(starboardAft.x, starboardAft.y);
    this.lineTo(starboardFore.x, starboardFore.y);
    this.closePath();
    this.fillPath();

    // Deck stripe
    this.lineStyle(1, 0xAA7744, 0.5);
    const deckL = rot(-5, -4);
    const deckR = rot(-5, 4);
    this.lineBetween(deckL.x, deckL.y, deckR.x, deckR.y);

    // Mast & sail
    const mastBase = rot(-2, 0);
    const mastTop = rot(-2, -12);
    this.lineStyle(1, 0x654321, 1);
    this.lineBetween(mastBase.x, mastBase.y, mastTop.x, mastTop.y);
    // Ragged sail
    const sailTL = rot(2, -10);
    const sailTR = rot(-6, -10);
    const sailBL = rot(3, -3);
    const sailBR = rot(-7, -3);
    this.fillStyle(0xDDCCAA, 0.6);
    this.beginPath();
    this.moveTo(sailTL.x, sailTL.y);
    this.lineTo(sailTR.x, sailTR.y);
    this.lineTo(sailBR.x, sailBR.y);
    this.lineTo(sailBL.x, sailBL.y);
    this.closePath();
    this.fillPath();

    // Skull mark
    this.fillStyle(0xFFFFFF, 0.5);
    this.fillCircle(rot(-2, -6.5).x, rot(-2, -6.5).y, 1.5);

    // HP bar
    const ratio = this.hp / this.maxHp;
    this.fillStyle(0x000000, 0.5);
    this.fillRect(-14, -20, 28, 3);
    this.fillStyle(0xCC4444, 1);
    this.fillRect(-14, -20, 28 * ratio, 3);
  }

  takeDamage(amount: number): boolean {
    this.hp -= amount;
    if (this.hp <= 0) {
      this.hp = 0;
      this.active = false;
      this.setVisible(false);
      return true;
    }
    this.draw();
    return false;
  }

  update(delta: number, worldWidth: number, worldHeight: number): void {
    if (!this.active) return;

    this.moveTimer += delta;
    if (this.moveTimer > 3000) {
      this.moveTimer = 0;
      this.heading += Phaser.Math.FloatBetween(-0.8, 0.8);
      this.moveDir.set(Math.cos(this.heading), Math.sin(this.heading));
    }

    this.x += this.moveDir.x * this.speed * delta / 1000;
    this.y += this.moveDir.y * this.speed * delta / 1000;

    // Bounce off edges
    if (this.x < 80 || this.x > worldWidth - 80) {
      this.moveDir.x *= -1;
      this.heading = Math.atan2(this.moveDir.y, this.moveDir.x);
    }
    if (this.y < 80 || this.y > worldHeight - 80) {
      this.moveDir.y *= -1;
      this.heading = Math.atan2(this.moveDir.y, this.moveDir.x);
    }

    this.x = Phaser.Math.Clamp(this.x, 50, worldWidth - 50);
    this.y = Phaser.Math.Clamp(this.y, 50, worldHeight - 50);

    this.draw();
  }
}
