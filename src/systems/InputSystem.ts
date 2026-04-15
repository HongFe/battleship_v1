import Phaser from 'phaser';

export class InputSystem {
  private scene: Phaser.Scene;
  private joystickBase: Phaser.GameObjects.Graphics;
  private joystickThumb: Phaser.GameObjects.Graphics;
  private joystickHint: Phaser.GameObjects.Graphics;
  private touchId: number | null = null;
  private startPos: Phaser.Math.Vector2 = new Phaser.Math.Vector2();
  public direction: Phaser.Math.Vector2 = new Phaser.Math.Vector2();
  public isActive: boolean = false;

  // Keyboard
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private keys!: { W: Phaser.Input.Keyboard.Key; A: Phaser.Input.Keyboard.Key; S: Phaser.Input.Keyboard.Key; D: Phaser.Input.Keyboard.Key };
  private keyboardActive: boolean = false;

  private readonly DEAD_ZONE = 20;
  private readonly MAX_DISTANCE = 60;

  /** Timestamp of last user input (ms). Used for AFK detection. */
  public lastInputTime: number = Date.now();

  constructor(scene: Phaser.Scene) {
    this.scene = scene;

    this.joystickBase = scene.add.graphics()
      .setScrollFactor(0)
      .setDepth(1000)
      .setVisible(false);

    this.joystickThumb = scene.add.graphics()
      .setScrollFactor(0)
      .setDepth(1001)
      .setVisible(false);

    // Faint hint stick — always visible bottom-right so mobile users know
    // they can drag from anywhere here to steer
    this.joystickHint = scene.add.graphics()
      .setScrollFactor(0)
      .setDepth(999);
    this.drawHint();
    scene.scale.on('resize', () => this.drawHint());

    this.setupTouch();
    this.setupKeyboard();
  }

  private drawHint(): void {
    const w = this.scene.scale.width;
    const h = this.scene.scale.height;
    const cx = w - 90;
    const cy = h - 205;
    const r = 50;
    const g = this.joystickHint;
    g.clear();
    // Outer ring
    g.lineStyle(2, 0xFFFFFF, 0.18);
    g.strokeCircle(cx, cy, r);
    // Soft fill
    g.fillStyle(0xFFFFFF, 0.06);
    g.fillCircle(cx, cy, r);
    // Inner thumb hint
    g.fillStyle(0xFFFFFF, 0.16);
    g.fillCircle(cx, cy, 18);
    // Tiny directional arrows
    const arrow = (ax: number, ay: number, dx: number, dy: number) => {
      g.lineStyle(1.5, 0xFFFFFF, 0.25);
      g.lineBetween(ax, ay, ax + dx, ay + dy);
    };
    arrow(cx, cy - r * 0.55, 0, -6);
    arrow(cx, cy + r * 0.55, 0, 6);
    arrow(cx - r * 0.55, cy, -6, 0);
    arrow(cx + r * 0.55, cy, 6, 0);
  }

  private setupKeyboard(): void {
    if (!this.scene.input.keyboard) return;
    this.cursors = this.scene.input.keyboard.createCursorKeys();
    this.keys = this.scene.input.keyboard.addKeys('W,A,S,D') as any;
  }

  /** Call from scene update() — reads keyboard state and updates direction/active */
  pollKeyboard(): void {
    if (!this.cursors || !this.keys) return;
    let dx = 0, dy = 0;
    if (this.cursors.left?.isDown || this.keys.A.isDown) dx -= 1;
    if (this.cursors.right?.isDown || this.keys.D.isDown) dx += 1;
    if (this.cursors.up?.isDown || this.keys.W.isDown) dy -= 1;
    if (this.cursors.down?.isDown || this.keys.S.isDown) dy += 1;

    if (dx !== 0 || dy !== 0) {
      const len = Math.sqrt(dx * dx + dy * dy);
      this.direction.set(dx / len, dy / len);
      this.keyboardActive = true;
      this.lastInputTime = Date.now();
      // Touch joystick takes priority if both pressed
      if (this.touchId === null) {
        this.isActive = true;
      }
    } else {
      if (this.keyboardActive) {
        this.keyboardActive = false;
        if (this.touchId === null) {
          this.isActive = false;
          this.direction.set(0, 0);
        }
      }
    }
  }

  private setupTouch(): void {
    this.scene.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (pointer.y < this.scene.scale.height * 0.6) return;
      if (this.touchId !== null) return;

      this.touchId = pointer.id;
      this.startPos.set(pointer.x, pointer.y);
      this.isActive = true;
      this.lastInputTime = Date.now();

      this.drawJoystickBase(pointer.x, pointer.y);
      this.drawJoystickThumb(pointer.x, pointer.y);
      this.joystickBase.setVisible(true);
      this.joystickThumb.setVisible(true);
      this.joystickHint.setVisible(false);
    });

    this.scene.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (pointer.id !== this.touchId) return;

      const dx = pointer.x - this.startPos.x;
      const dy = pointer.y - this.startPos.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < this.DEAD_ZONE) {
        this.direction.set(0, 0);
        this.drawJoystickThumb(this.startPos.x, this.startPos.y);
        return;
      }

      const clampDist = Math.min(dist, this.MAX_DISTANCE);
      const angle = Math.atan2(dy, dx);
      this.direction.set(Math.cos(angle), Math.sin(angle));

      const thumbX = this.startPos.x + Math.cos(angle) * clampDist;
      const thumbY = this.startPos.y + Math.sin(angle) * clampDist;
      this.drawJoystickThumb(thumbX, thumbY);
    });

    const onPointerUp = (pointer: Phaser.Input.Pointer) => {
      if (pointer.id !== this.touchId) return;
      this.touchId = null;
      this.joystickBase.setVisible(false);
      this.joystickThumb.setVisible(false);
      this.joystickHint.setVisible(true);
      // Keyboard may still be active
      if (!this.keyboardActive) {
        this.isActive = false;
        this.direction.set(0, 0);
      }
    };

    this.scene.input.on('pointerup', onPointerUp);
    this.scene.input.on('pointerupoutside', onPointerUp);
  }

  private drawJoystickBase(x: number, y: number): void {
    this.joystickBase.clear();
    this.joystickBase.fillStyle(0xFFFFFF, 0.15);
    this.joystickBase.fillCircle(x, y, 50);
    this.joystickBase.lineStyle(2, 0xFFFFFF, 0.2);
    this.joystickBase.strokeCircle(x, y, 50);
  }

  private drawJoystickThumb(x: number, y: number): void {
    this.joystickThumb.clear();
    this.joystickThumb.fillStyle(0xFFFFFF, 0.4);
    this.joystickThumb.fillCircle(x, y, 22);
  }

  destroy(): void {
    this.joystickBase.destroy();
    this.joystickThumb.destroy();
    this.joystickHint.destroy();
  }
}
