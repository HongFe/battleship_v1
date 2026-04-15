import Phaser from 'phaser';
import { ShipConfig, WeaponItemConfig, ArmorItemConfig, SpecialItemConfig, ItemConfig } from '../config/types';
import { AudioManager } from '../utils/AudioManager';
import { EventBus } from '../utils/EventBus';

let __shipIdCounter = 1;

// NPC-only range nerf: strong AI ships fire from 70% of base weapon range
// so they don't overwhelm the player with kiting sniper fire.
const STRONG_NPC_SHIPS = new Set([
  'battleship', 'iowa', 'yamato', 'hood', 'akagi', 'carrier',
  'turtleship', 'kraken', 'thundership', 'phoenix', 'pyotr', 'ghostship',
]);

// Some hand-painted ship textures aren't drawn pointing up. Apply a
// per-ship rotation offset (in radians) so forward == heading direction.
const SHIP_SPRITE_ROT_OFFSET: Record<string, number> = {
  pirate: Math.PI,           // bow drawn at bottom
  panokseon: Math.PI / 2,    // drawn broadside (horizontal)
  hood: -Math.PI / 2,        // drawn horizontal, bow right
  submarine: -Math.PI / 2,   // drawn horizontal, bow right
  yamato: -Math.PI / 2,      // drawn horizontal, bow right
  medic: -Math.PI / 2,       // drawn broadside, bow right
  carrier: Math.PI / 2,      // drawn horizontal, bow left
};

export class Ship extends Phaser.Physics.Arcade.Sprite {
  public config: ShipConfig;
  public currentHp: number;
  public maxHp: number;
  public team: number;
  public gold: number = 0;
  public kills: number = 0;
  public isBot: boolean;
  public isDead: boolean = false;
  public netPlayerId: string = ''; // Multiplayer: which network player owns this ship
  public isRemoteOwned: boolean = false; // Multiplayer: authoritative state comes from network
  public __id: number = __shipIdCounter++;

  // Heading & momentum
  public heading: number = -Math.PI / 2; // facing up initially
  public targetHeading: number = -Math.PI / 2;
  public throttle: number = 0; // 0~1

  // Carrier: timer for spawning planes
  public planeSpawnTimer: number = 0;

  // === Level & XP ===
  public xp: number = 0;
  public level: number = 1;
  public static readonly XP_TABLE = [0, 100, 250, 450, 700, 1000, 1400, 1900, 2500, 3200];
  // Chosen upgrades (stacked)
  public hpBonusPct: number = 0;          // +% max HP per point
  public levelRegenPerSec: number = 0;    // HP/sec from leveling
  public damageBonusPct: number = 0;      // +% weapon damage per point
  public skillCdReductPct: number = 0;    // -% skill cooldown per point

  // Skill state
  public skillCooldown: number = 0;       // seconds remaining
  public berserkRemaining: number = 0;     // sec — viking 2x attackSpeed
  public dashRemaining: number = 0;        // sec — speed boost
  public smokeRemaining: number = 0;       // sec — damage reduction
  public stealthRemaining: number = 0;     // sec — invisibility
  public ramRemaining: number = 0;         // sec — ram boost

  private equippedWeapons: WeaponItemConfig[] = [];
  private equippedArmors: ArmorItemConfig[] = [];
  private equippedSpecials: SpecialItemConfig[] = [];

  private healthBar: Phaser.GameObjects.Graphics;
  private nameText: Phaser.GameObjects.Text;
  private overlayGraphics: Phaser.GameObjects.Graphics;
  private wakeGraphics: Phaser.GameObjects.Graphics;
  /** When true, the ship is currently hidden from the viewer's team (fog of war) */
  public hiddenByFog: boolean = false;
  private wakeParticles: { x: number; y: number; alpha: number; age: number }[] = [];
  private shadowSprite: Phaser.GameObjects.Sprite;
  private rimLight: Phaser.GameObjects.Sprite;

  // Effective hull length (for wake/HP bar offset). Derived from sprite.
  private hullLength: number;
  private hullWidth: number;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    config: ShipConfig,
    team: number,
    isBot: boolean = false,
  ) {
    // Prefer the Whisk-generated top-down PNG (public/textures/ships_gen/*.png,
    // preloaded in BootScene as `ship_gen_{id}`) when available; otherwise
    // fall back to the procedural HQ sprite from balance.json.
    const genKey = `ship_gen_${config.id}`;
    const spriteKey = scene.textures.exists(genKey)
      ? genKey
      : (config.spriteName || `ship_${config.id}`);
    super(scene, x, y, spriteKey);
    this.config = config;
    this.currentHp = config.hp;
    this.maxHp = config.hp;
    this.team = team;
    this.isBot = isBot;

    // Target visual hull length per ship type
    const targetHullLength =
      config.id === 'kraken' ? 155 :
      config.id === 'thundership' ? 145 :
      config.id === 'phoenix' ? 135 :
      config.id === 'ghostship' ? 120 :
      config.id === 'seawitch' ? 115 :
      config.id === 'warcrier' ? 105 :
      config.id === 'medic' ? 85 :
      config.id === 'hwacha' ? 100 :
      config.id === 'yamato' ? 140 :
      config.id === 'akagi' ? 132 :
      config.id === 'carrier' ? 130 :
      config.id === 'iowa' ? 120 :
      config.id === 'pyotr' ? 115 :
      config.id === 'battleship' ? 110 :
      config.id === 'hood' ? 115 :
      config.id === 'turtleship' ? 105 :
      config.id === 'galleon' ? 110 :
      config.id === 'panokseon' ? 105 :
      config.id === 'pirate' ? 105 :
      config.id === 'flyingdutchman' ? 115 :  // cursed, larger
      config.id === 'royalfortune' ? 110 :    // royal frigate
      config.id === 'blackpearl' ? 105 :      // sleek
      config.id === 'viking' ? 115 :
      config.id === 'trireme' ? 115 :
      config.id === 'submarine' ? 95 :
      config.id === 'cruiser' ? 80 :
      config.id === 'destroyer' ? 65 :
      config.id === 'patrolboat' ? 50 :
      60;

    const tex = scene.textures.get(spriteKey);
    const src = tex.getSourceImage() as HTMLImageElement;
    const srcLen = src.height; // sprites are taller than wide (point up)
    const srcWid = src.width;
    const scale = targetHullLength / srcLen;
    this.setScale(scale);
    this.setOrigin(0.5, 0.5);
    this.hullLength = targetHullLength;
    this.hullWidth = srcWid * scale;

    // Team + class tint
    let tintBase = team === 0 ? 0xCCDDFF : 0xFFCCCC;
    if (config.id === 'carrier') tintBase = team === 0 ? 0xEEEEFF : 0xFFEEEE;
    if (config.id === 'submarine') tintBase = team === 0 ? 0x99AACC : 0xCC9999;
    if (config.id === 'patrolboat') tintBase = team === 0 ? 0xAACCEE : 0xEEAAAA;
    // Historical ships have rich procedural colors — only mild team tint
    const isHistorical = ['turtleship', 'panokseon', 'galleon', 'pirate', 'viking', 'trireme'].includes(config.id);
    if (isHistorical) {
      tintBase = team === 0 ? 0xDDEEFF : 0xFFDDDD;
    }
    // Whisk-painted sprites already carry rich hand-painted color — apply only
    // the faintest team hint so reds still read as friendly/enemy.
    if (spriteKey === genKey) {
      tintBase = team === 0 ? 0xEAF2FF : 0xFFEAEA;
    }
    this.setTint(tintBase);

    scene.add.existing(this);
    scene.physics.add.existing(this);
    this.setDepth(5);

    // Drop shadow on water (lower depth, dark, offset)
    this.shadowSprite = scene.add.sprite(x + 6, y + 9, spriteKey)
      .setOrigin(0.5)
      .setScale(scale * 1.05)
      .setTint(0x000020)
      .setAlpha(0.45)
      .setDepth(3.5);

    // Rim light overlay (suggests sun from upper-left)
    this.rimLight = scene.add.sprite(x - 1, y - 2, spriteKey)
      .setOrigin(0.5)
      .setScale(scale)
      .setTint(0xFFFFEE)
      .setAlpha(0.18)
      .setDepth(5.5)
      .setBlendMode(Phaser.BlendModes.ADD);

    this.setCollideWorldBounds(true);
    (this.body as Phaser.Physics.Arcade.Body).setDrag(0, 0);
    (this.body as Phaser.Physics.Arcade.Body).setMaxVelocity(400, 400);

    // Body collision is a square slightly smaller than the hull
    const bodySize = Math.max(this.hullLength, this.hullWidth) * 0.7;
    this.body!.setSize(bodySize / scale, bodySize / scale);

    // Wake & overlays
    this.wakeGraphics = scene.add.graphics().setDepth(2);
    this.overlayGraphics = scene.add.graphics().setDepth(6);
    this.healthBar = scene.add.graphics().setDepth(10);

    // Name tag
    let label: string;
    if (!isBot) {
      label = '⚓ ' + config.displayName;
    } else if (team === 0) {
      label = 'Ally';
    } else {
      label = 'Enemy';
    }
    const labelColor = team === 0 ? (isBot ? '#88BBEE' : '#FFDD66') : '#EE6666';
    this.nameText = scene.add.text(x, y - this.hullLength * 0.5 - 18, label, {
      fontSize: '10px',
      color: labelColor,
      fontFamily: 'monospace',
      fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(10);

    if (isBot) {
      this.heading = Phaser.Math.FloatBetween(0, Math.PI * 2);
      this.targetHeading = this.heading;
    }
  }

  getWeapons(): WeaponItemConfig[] {
    return this.equippedWeapons;
  }

  getAllItems(): ItemConfig[] {
    return [...this.equippedWeapons, ...this.equippedArmors, ...this.equippedSpecials];
  }

  get totalArmor(): number {
    return this.config.armor +
      this.equippedArmors.reduce((sum, a) => sum + a.armorBonus, 0);
  }

  get effectiveSpeed(): number {
    const multiplier = this.equippedSpecials
      .filter(s => s.speedMultiplier)
      .reduce((m, s) => m * (s.speedMultiplier ?? 1), 1);
    let speed = this.config.speed * multiplier;
    // Active buffs
    if (this.dashRemaining > 0) speed *= 2.0;
    else if (this.dashRemaining < 0) speed *= 0.4; // NET SLOW effect
    if (this.ramRemaining > 0) speed *= 1.8;
    return speed;
  }

  /** Multiplier applied to weapon attackSpeed (1 = normal) */
  get attackSpeedMultiplier(): number {
    return this.berserkRemaining > 0 ? 2.0 : 1.0;
  }

  get maxRange(): number {
    if (this.equippedWeapons.length === 0) return 0;
    const base = Math.max(...this.equippedWeapons.map(w => w.range));
    if (this.isBot && STRONG_NPC_SHIPS.has(this.config.id)) return base * 0.7;
    return base;
  }

  get turnRate(): number {
    if (this.config.id === 'kraken') return 0.6;       // colossal sea monster
    if (this.config.id === 'thundership') return 0.9;
    if (this.config.id === 'phoenix') return 1.4;      // agile fire bird
    if (this.config.id === 'ghostship') return 2.2;    // ethereal, fast turn
    if (this.config.id === 'yamato') return 0.8;
    if (this.config.id === 'akagi') return 0.9;
    if (this.config.id === 'carrier') return 1.0;
    if (this.config.id === 'turtleship') return 1.0;
    if (this.config.id === 'battleship') return 1.2;
    if (this.config.id === 'pyotr') return 1.4;        // nuclear, agile
    if (this.config.id === 'iowa') return 1.6;         // fast bb
    if (this.config.id === 'hood') return 1.7;         // battlecruiser
    if (this.config.id === 'galleon') return 1.3;
    if (this.config.id === 'panokseon') return 1.5;
    if (this.config.id === 'submarine') return 1.6;
    if (this.config.id === 'pirate') return 1.7;
    if (this.config.id === 'royalfortune') return 1.5;
    if (this.config.id === 'flyingdutchman') return 1.3; // ghostly, slow turn
    if (this.config.id === 'blackpearl') return 2.0;     // legendary fast
    if (this.config.id === 'cruiser') return 1.8;
    if (this.config.id === 'destroyer') return 2.4;
    if (this.config.id === 'trireme') return 2.6;
    if (this.config.id === 'viking') return 2.8;
    return 3.0; // patrolboat
  }

  /** Remove an item at the given index. Returns the item if found. */
  removeItemAt(index: number): ItemConfig | null {
    const all = this.getAllItems();
    if (index < 0 || index >= all.length) return null;
    const item = all[index];
    if (item.type === 'weapon') {
      const wi = this.equippedWeapons.indexOf(item as WeaponItemConfig);
      if (wi >= 0) this.equippedWeapons.splice(wi, 1);
    } else if (item.type === 'armor') {
      const ai = this.equippedArmors.indexOf(item as ArmorItemConfig);
      if (ai >= 0) {
        this.equippedArmors.splice(ai, 1);
        this.recalcMaxHp();
      }
    } else if (item.type === 'special') {
      const si = this.equippedSpecials.indexOf(item as SpecialItemConfig);
      if (si >= 0) this.equippedSpecials.splice(si, 1);
    }
    return item;
  }

  /** Equip an item. If the relevant slot is full, replaces the oldest item.
   * Always succeeds (returns true) so buying is never silently blocked. */
  /** Reason string returned when a purchase is rejected so the UI can show a
   *  specific message (full weapon slots vs. already-owned armor/special). */
  canEquipReason(item: ItemConfig): null | 'weapons_full' | 'armor_owned' | 'special_owned' {
    const slots = this.config.slots;
    if (item.type === 'weapon' && this.equippedWeapons.length >= slots.weapon) return 'weapons_full';
    if (item.type === 'armor' && this.equippedArmors.length >= 1) return 'armor_owned';
    if (item.type === 'special' && this.equippedSpecials.length >= 1) return 'special_owned';
    return null;
  }

  equipItem(item: ItemConfig): boolean {
    if (this.canEquipReason(item) !== null) return false;
    if (item.type === 'weapon') {
      this.equippedWeapons.push(item as WeaponItemConfig);
      return true;
    }
    if (item.type === 'armor') {
      this.equippedArmors.push(item as ArmorItemConfig);
      this.maxHp = this.config.hp + this.equippedArmors.reduce((s, a) => s + a.hpBonus, 0);
      this.currentHp = Math.min(this.currentHp + (item as ArmorItemConfig).hpBonus, this.maxHp);
      return true;
    }
    if (item.type === 'special') {
      this.equippedSpecials.push(item as SpecialItemConfig);
      return true;
    }
    return false;
  }

  takeDamage(rawDamage: number): void {
    if (this.isDead) return;
    if (this.isRemoteOwned) return;
    let reduced = Math.max(1, rawDamage - this.totalArmor * 0.3);
    if (this.smokeRemaining > 0) reduced *= 0.5;       // smoke screen
    if (this.stealthRemaining > 0) reduced *= 0.3;     // stealth dive
    this.currentHp -= reduced;
    if (this.currentHp <= 0) {
      this.currentHp = 0;
      this.die();
    }
  }

  heal(amount: number): void {
    this.currentHp = Math.min(this.currentHp + amount, this.maxHp);
  }

  die(): void {
    this.isDead = true;
    this.active = false;

    // Big explosion at death
    const scale = this.config.id === 'battleship' ? 4 : this.config.id === 'cruiser' ? 3 : 2.5;
    const boom = this.scene.add.sprite(this.x, this.y, 'explosion_1').setDepth(9).setScale(scale);
    boom.play('explosion_anim');
    boom.once('animationcomplete', () => boom.destroy());

    // Linger fire for a moment
    const fire = this.scene.add.sprite(this.x, this.y, 'fire_1').setDepth(9).setScale(scale * 0.7);
    fire.play('fire_anim');
    this.scene.tweens.add({
      targets: fire,
      alpha: 0,
      delay: 800,
      duration: 700,
      onComplete: () => fire.destroy(),
    });

    // Phoenix revive — if this is a phoenix ship, revive at 50% HP once
    if (this.config.id === 'phoenix' && !(this as any).__phoenixUsed) {
      (this as any).__phoenixUsed = true;
      this.isDead = false;
      this.active = true;
      this.currentHp = Math.floor(this.maxHp * 0.5);
      this.setVisible(true);
      this.overlayGraphics.setVisible(true);
      this.healthBar.setVisible(true);
      this.nameText.setVisible(true);
      this.wakeGraphics.setVisible(true);
      this.shadowSprite.setVisible(true);
      this.rimLight.setVisible(true);
      this.body!.enable = true;
      // Fire explosion VFX as "rebirth"
      const rebirth = this.scene.add.sprite(this.x, this.y, 'explosion_1').setDepth(9).setScale(5).setTint(0xFF6622);
      rebirth.play('explosion_anim');
      rebirth.once('animationcomplete', () => rebirth.destroy());
      EventBus.emit('toast', '🔥 Phoenix rises! HP 50% 부활!', '#FF6622');
      AudioManager.explosion();
      return; // Don't die
    }

    // Camera shake — distance-aware. Player death = full effect.
    const cam = this.scene.cameras.main;
    const player = (this.scene as any).player;
    if (this === player) {
      cam.shake(this.config.id === 'battleship' || this.config.id === 'turtleship' ? 400 : 250, 0.015);
      cam.flash(150, 200, 80, 30, false);
      AudioManager.explosion();
    } else if (player && !player.isDead) {
      const dist = Phaser.Math.Distance.Between(this.x, this.y, player.x, player.y);
      const MAX = 500;
      if (dist <= MAX) {
        const falloff = 1 - dist / MAX;
        cam.shake(150, 0.006 * falloff);
        // Only play explosion audio if very close
        if (dist < 250) AudioManager.explosion();
      }
    }

    this.setVisible(false);
    this.overlayGraphics.setVisible(false);
    this.healthBar.setVisible(false);
    this.nameText.setVisible(false);
    this.wakeGraphics.setVisible(false);
    this.shadowSprite.setVisible(false);
    this.rimLight.setVisible(false);
    this.body!.enable = false;
  }

  applyMovement(delta: number): void {
    if (this.isDead) return;

    const dt = delta / 1000;

    let angleDiff = this.targetHeading - this.heading;
    while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
    while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

    const maxTurn = this.turnRate * dt;
    if (Math.abs(angleDiff) < maxTurn) {
      this.heading = this.targetHeading;
    } else {
      this.heading += Math.sign(angleDiff) * maxTurn;
    }
    while (this.heading > Math.PI) this.heading -= Math.PI * 2;
    while (this.heading < -Math.PI) this.heading += Math.PI * 2;

    const maxSpeed = this.effectiveSpeed;
    const targetVx = Math.cos(this.heading) * maxSpeed * this.throttle;
    const targetVy = Math.sin(this.heading) * maxSpeed * this.throttle;

    const body = this.body as Phaser.Physics.Arcade.Body;
    const lerpRate = 2.5;
    const factor = 1 - Math.exp(-lerpRate * dt);
    body.velocity.x += (targetVx - body.velocity.x) * factor;
    body.velocity.y += (targetVy - body.velocity.y) * factor;

    // Wake particles disabled — testers found the dot spray distracting.
    const speed = body.velocity.length();
    if (false && speed > 15) {
      const wakeDist = this.hullLength * 0.5;
      this.wakeParticles.push({
        x: this.x - Math.cos(this.heading) * wakeDist,
        y: this.y - Math.sin(this.heading) * wakeDist,
        alpha: 0.4 * (speed / maxSpeed),
        age: 0,
      });
      if (speed > maxSpeed * 0.5) {
        const perpAngle = this.heading + Math.PI / 2;
        this.wakeParticles.push({
          x: this.x - Math.cos(this.heading) * wakeDist * 0.7 + Math.cos(perpAngle) * this.hullWidth * 0.4,
          y: this.y - Math.sin(this.heading) * wakeDist * 0.7 + Math.sin(perpAngle) * this.hullWidth * 0.4,
          alpha: 0.2,
          age: 0,
        });
        this.wakeParticles.push({
          x: this.x - Math.cos(this.heading) * wakeDist * 0.7 - Math.cos(perpAngle) * this.hullWidth * 0.4,
          y: this.y - Math.sin(this.heading) * wakeDist * 0.7 - Math.sin(perpAngle) * this.hullWidth * 0.4,
          alpha: 0.2,
          age: 0,
        });
      }
    }
  }

  updateVisuals(delta: number): void {
    if (this.isDead) return;

    // Sprite renders itself; just rotate it.
    // Sprite art points UP, Phaser rotation 0 = right, so add PI/2.
    // Some ships have per-sprite orientation fixes.
    const extraRot = SHIP_SPRITE_ROT_OFFSET[this.config.id] ?? 0;
    // Kraken tentacle sway — subtle rotation wobble while moving, so the
    // creature feels alive rather than sliding stiffly.
    let wobble = 0;
    if (this.config.id === 'kraken') {
      const speed = (this.body as Phaser.Physics.Arcade.Body)?.velocity.length() ?? 0;
      const intensity = Math.min(speed / 60, 1);
      wobble = Math.sin(this.scene.time.now * 0.006) * 0.12 * intensity;
      const pulse = 1 + Math.sin(this.scene.time.now * 0.008) * 0.035 * intensity;
      this.setScale(pulse);
    }
    const rot = this.heading + Math.PI / 2 + extraRot + wobble;
    this.setRotation(rot);

    // Sync shadow & rim light
    this.shadowSprite.setPosition(this.x + 6, this.y + 9);
    this.shadowSprite.setRotation(rot);
    this.rimLight.setPosition(this.x - 1, this.y - 2);
    this.rimLight.setRotation(rot);

    // Wake particles removed — previous dot spray was visually noisy
    // and unpopular with testers. Keep the update call shape in case
    // we want to reintroduce a subtle trail later.
    this.drawOverlay();

    // Health bar above ship
    const hg = this.healthBar;
    hg.clear();
    const barWidth = Math.max(50, this.hullLength + 10);
    const barHeight = 5;
    const barX = this.x - barWidth / 2;
    const barY = this.y - this.hullLength * 0.55 - 16;

    hg.fillStyle(0x000000, 0.5);
    hg.fillRoundedRect(barX, barY, barWidth, barHeight, 2);
    const hpRatio = this.currentHp / this.maxHp;
    const hpColor = hpRatio > 0.5 ? 0x3DC47E : hpRatio > 0.25 ? 0xF5A623 : 0xE84545;
    hg.fillStyle(hpColor, 0.95);
    hg.fillRoundedRect(barX + 1, barY + 1, (barWidth - 2) * hpRatio, barHeight - 2, 1);

    this.nameText.setPosition(this.x, barY - 10);
  }

  /** Draw small overlays on top of sprite: weapon glow + team flag */
  private drawOverlay(): void {
    const g = this.overlayGraphics;
    g.clear();

    const cos = Math.cos(this.heading);
    const sin = Math.sin(this.heading);
    const rot = (fx: number, fy: number) => ({
      x: this.x + fx * cos - fy * sin,
      y: this.y + fx * sin + fy * cos,
    });

    // Active weapon turrets glow (subtle)
    const cannons = this.getCannonPositions();
    for (let i = 0; i < Math.min(this.equippedWeapons.length, cannons.length); i++) {
      const cp = cannons[i];
      const p = rot(cp.fx, cp.fy);
      g.fillStyle(0xFFAA00, 0.25);
      g.fillCircle(p.x, p.y, 4);
    }

    // Team color stripe at stern (so allies/enemies easy to tell)
    const stripeBack = rot(-this.hullLength * 0.45, 0);
    const flagColor = this.team === 0 ? 0x66CCFF : 0xFF4444;
    g.fillStyle(flagColor, 0.85);
    g.fillCircle(stripeBack.x, stripeBack.y, 3.5);
    g.lineStyle(1, 0xFFFFFF, 0.6);
    g.strokeCircle(stripeBack.x, stripeBack.y, 3.5);
  }

  /** Cannon positions in local frame (relative to ship center, sprite-up).
   * fx is along the ship's forward axis (positive = bow). */
  getCannonPositions(): { fx: number; fy: number; barrelLen: number }[] {
    const L = this.hullLength;
    const W = this.hullWidth;

    switch (this.config.id) {
      // ===== MYTHOLOGICAL T5 =====
      case 'kraken':
        // 4 slots — tentacles in all directions
        return [
          { fx: L * 0.35, fy: 0, barrelLen: 14 },
          { fx: 0, fy: -W * 0.5, barrelLen: 12 },
          { fx: 0, fy: W * 0.5, barrelLen: 12 },
          { fx: -L * 0.35, fy: 0, barrelLen: 14 },
        ];
      case 'phoenix':
        // 5 slots — fire ports all around
        return [
          { fx: L * 0.35, fy: 0, barrelLen: 12 },
          { fx: L * 0.1, fy: -W * 0.4, barrelLen: 10 },
          { fx: L * 0.1, fy: W * 0.4, barrelLen: 10 },
          { fx: -L * 0.2, fy: -W * 0.35, barrelLen: 10 },
          { fx: -L * 0.2, fy: W * 0.35, barrelLen: 10 },
        ];
      case 'ghostship':
        // 5 slots — phantom broadside
        return [
          { fx: L * 0.3, fy: 0, barrelLen: 10 },
          { fx: L * 0.1, fy: -W * 0.45, barrelLen: 8 },
          { fx: L * 0.1, fy: W * 0.45, barrelLen: 8 },
          { fx: -L * 0.15, fy: -W * 0.45, barrelLen: 8 },
          { fx: -L * 0.15, fy: W * 0.45, barrelLen: 8 },
        ];
      case 'thundership':
        // 6 slots — lightning batteries
        return [
          { fx: L * 0.35, fy: 0, barrelLen: 14 },
          { fx: L * 0.15, fy: -W * 0.4, barrelLen: 10 },
          { fx: L * 0.15, fy: W * 0.4, barrelLen: 10 },
          { fx: -L * 0.1, fy: 0, barrelLen: 12 },
          { fx: -L * 0.3, fy: -W * 0.35, barrelLen: 10 },
          { fx: -L * 0.3, fy: W * 0.35, barrelLen: 10 },
        ];
      // ===== Famous nation battleships =====
      case 'yamato':
        // 6 slots — 3 forward, 1 mid, 2 rear
        return [
          { fx: L * 0.34, fy: 0, barrelLen: 16 },
          { fx: L * 0.22, fy: 0, barrelLen: 14 },
          { fx: L * 0.1, fy: 0, barrelLen: 12 },
          { fx: 0, fy: 0, barrelLen: 10 },
          { fx: -L * 0.25, fy: 0, barrelLen: 14 },
          { fx: -L * 0.38, fy: 0, barrelLen: 12 },
        ];
      case 'iowa':
        // 5 slots — 2 forward, 2 mid, 1 rear
        return [
          { fx: L * 0.32, fy: 0, barrelLen: 14 },
          { fx: L * 0.18, fy: 0, barrelLen: 12 },
          { fx: 0, fy: -W * 0.4, barrelLen: 9 },
          { fx: 0, fy: W * 0.4, barrelLen: 9 },
          { fx: -L * 0.32, fy: 0, barrelLen: 14 },
        ];
      case 'hood':
        // 4 slots — 2 forward, 2 rear (classic British)
        return [
          { fx: L * 0.3, fy: 0, barrelLen: 12 },
          { fx: L * 0.18, fy: 0, barrelLen: 10 },
          { fx: -L * 0.18, fy: 0, barrelLen: 12 },
          { fx: -L * 0.3, fy: 0, barrelLen: 10 },
        ];
      case 'akagi':
        // 3 slots — port + starboard + bow
        return [
          { fx: L * 0.35, fy: 0, barrelLen: 8 },
          { fx: 0, fy: -W * 0.45, barrelLen: 6 },
          { fx: 0, fy: W * 0.45, barrelLen: 6 },
        ];
      case 'pyotr':
        // 5 slots — 1 fwd, 3 mid, 1 rear (modern Soviet)
        return [
          { fx: L * 0.32, fy: 0, barrelLen: 12 },
          { fx: L * 0.05, fy: -W * 0.4, barrelLen: 8 },
          { fx: L * 0.05, fy: W * 0.4, barrelLen: 8 },
          { fx: -L * 0.15, fy: 0, barrelLen: 10 },
          { fx: -L * 0.32, fy: 0, barrelLen: 12 },
        ];
      // ===== Modern ships =====
      case 'carrier':
        // 4 weapon slots: front + back + 2 sides
        return [
          { fx: L * 0.35, fy: 0, barrelLen: 8 },
          { fx: -L * 0.35, fy: 0, barrelLen: 8 },
          { fx: 0, fy: -W * 0.4, barrelLen: 6 },
          { fx: 0, fy: W * 0.4, barrelLen: 6 },
        ];
      case 'battleship':
        // 5 weapon slots: 3 main turrets + 2 broadside
        return [
          { fx: L * 0.32, fy: 0, barrelLen: 14 },
          { fx: L * 0.1, fy: -W * 0.4, barrelLen: 8 },
          { fx: L * 0.1, fy: W * 0.4, barrelLen: 8 },
          { fx: -L * 0.1, fy: 0, barrelLen: 10 },
          { fx: -L * 0.32, fy: 0, barrelLen: 10 },
        ];
      case 'submarine':
        // 3 weapon slots
        return [
          { fx: L * 0.3, fy: 0, barrelLen: 10 },
          { fx: 0, fy: 0, barrelLen: 8 },
          { fx: -L * 0.25, fy: 0, barrelLen: 8 },
        ];
      case 'cruiser':
        // 3 weapon slots
        return [
          { fx: L * 0.25, fy: 0, barrelLen: 10 },
          { fx: 0, fy: -W * 0.3, barrelLen: 8 },
          { fx: -L * 0.2, fy: 0, barrelLen: 9 },
        ];
      case 'destroyer':
        // 2 weapon slots
        return [
          { fx: L * 0.18, fy: -W * 0.15, barrelLen: 8 },
          { fx: L * 0.18, fy: W * 0.15, barrelLen: 8 },
        ];
      // ===== Historical ships =====
      case 'turtleship':
        // 6 weapon slots — dragon head + 4 broadsides + stern
        return [
          { fx: L * 0.4, fy: 0, barrelLen: 8 },              // dragon head
          { fx: L * 0.15, fy: -W * 0.45, barrelLen: 6 },      // port front
          { fx: L * 0.15, fy: W * 0.45, barrelLen: 6 },        // starboard front
          { fx: -L * 0.15, fy: -W * 0.45, barrelLen: 6 },     // port rear
          { fx: -L * 0.15, fy: W * 0.45, barrelLen: 6 },       // starboard rear
          { fx: -L * 0.4, fy: 0, barrelLen: 6 },               // stern
        ];
      case 'galleon':
        // 4 weapon slots — broadside cannons
        return [
          { fx: L * 0.25, fy: -W * 0.4, barrelLen: 6 },
          { fx: L * 0.05, fy: -W * 0.45, barrelLen: 6 },
          { fx: -L * 0.15, fy: -W * 0.4, barrelLen: 6 },
          { fx: L * 0.05, fy: W * 0.45, barrelLen: 6 },
        ];
      case 'panokseon':
        // 4 weapon slots
        return [
          { fx: L * 0.25, fy: 0, barrelLen: 8 },
          { fx: 0, fy: -W * 0.4, barrelLen: 6 },
          { fx: 0, fy: W * 0.4, barrelLen: 6 },
          { fx: -L * 0.25, fy: 0, barrelLen: 8 },
        ];
      case 'pirate':
        return [
          { fx: L * 0.2, fy: -W * 0.4, barrelLen: 6 },
          { fx: 0, fy: -W * 0.45, barrelLen: 6 },
          { fx: -L * 0.15, fy: W * 0.4, barrelLen: 6 },
        ];
      case 'blackpearl':
        // 4 slots — broadside
        return [
          { fx: L * 0.2, fy: -W * 0.45, barrelLen: 6 },
          { fx: L * 0.2, fy: W * 0.45, barrelLen: 6 },
          { fx: -L * 0.2, fy: -W * 0.45, barrelLen: 6 },
          { fx: -L * 0.2, fy: W * 0.45, barrelLen: 6 },
        ];
      case 'flyingdutchman':
        // 4 slots — heavy broadside
        return [
          { fx: L * 0.25, fy: -W * 0.45, barrelLen: 7 },
          { fx: L * 0.25, fy: W * 0.45, barrelLen: 7 },
          { fx: -L * 0.25, fy: -W * 0.45, barrelLen: 7 },
          { fx: -L * 0.25, fy: W * 0.45, barrelLen: 7 },
        ];
      case 'royalfortune':
        // 5 slots — heavy frigate
        return [
          { fx: L * 0.3, fy: -W * 0.4, barrelLen: 7 },
          { fx: L * 0.1, fy: -W * 0.45, barrelLen: 7 },
          { fx: -L * 0.1, fy: -W * 0.45, barrelLen: 7 },
          { fx: -L * 0.3, fy: -W * 0.4, barrelLen: 7 },
          { fx: 0, fy: W * 0.45, barrelLen: 7 },
        ];
      case 'viking':
        // 2 weapon slots
        return [
          { fx: L * 0.3, fy: 0, barrelLen: 6 },
          { fx: -L * 0.3, fy: 0, barrelLen: 6 },
        ];
      case 'trireme':
        // 2 weapon slots
        return [
          { fx: L * 0.4, fy: 0, barrelLen: 5 },
          { fx: 0, fy: -W * 0.35, barrelLen: 5 },
        ];
      case 'patrolboat':
      default:
        return [
          { fx: L * 0.2, fy: 0, barrelLen: 7 },
        ];
    }
  }

  getCannonWorldPos(index: number): { x: number; y: number } {
    const positions = this.getCannonPositions();
    const cp = positions[index % positions.length];
    const cos = Math.cos(this.heading);
    const sin = Math.sin(this.heading);
    const totalLen = cp.fx + cp.barrelLen;
    return {
      x: this.x + totalLen * cos - cp.fy * sin,
      y: this.y + totalLen * sin + cp.fy * cos,
    };
  }

  private drawWake(delta: number): void {
    const wg = this.wakeGraphics;
    wg.clear();

    const maxAge = 1200;
    this.wakeParticles = this.wakeParticles.filter(p => {
      p.age += delta;
      return p.age < maxAge;
    });

    if (this.wakeParticles.length > 30) {
      this.wakeParticles = this.wakeParticles.slice(-30);
    }

    for (const p of this.wakeParticles) {
      const life = 1 - p.age / maxAge;
      const alpha = p.alpha * life;
      const size = 2 + (1 - life) * 6;
      wg.fillStyle(0xCCEEFF, alpha * 0.8);
      wg.fillCircle(p.x, p.y, size);
      wg.fillStyle(0x6CBBDD, alpha * 0.5);
      wg.fillCircle(p.x, p.y, size * 0.6);
    }
  }

  preUpdate(time: number, delta: number): void {
    super.preUpdate(time, delta);
    const dt = delta / 1000;
    for (const armor of this.equippedArmors) {
      if (armor.effect === 'regen' && armor.effectParams) {
        this.heal(armor.effectParams['hpPerSecond'] * dt);
      }
    }
    // Level-up regen (independent of items)
    if (this.levelRegenPerSec > 0) {
      this.heal(this.levelRegenPerSec * dt);
    }
    // Tick down skill cooldown + buff timers
    if (this.skillCooldown > 0) this.skillCooldown = Math.max(0, this.skillCooldown - dt);
    if (this.berserkRemaining > 0) this.berserkRemaining = Math.max(0, this.berserkRemaining - dt);
    if (this.dashRemaining > 0) this.dashRemaining = Math.max(0, this.dashRemaining - dt);
    else if (this.dashRemaining < 0) this.dashRemaining = Math.min(0, this.dashRemaining + dt); // slow wears off
    if (this.smokeRemaining > 0) this.smokeRemaining = Math.max(0, this.smokeRemaining - dt);
    if (this.stealthRemaining > 0) {
      this.stealthRemaining = Math.max(0, this.stealthRemaining - dt);
      this.setAlpha(this.stealthRemaining > 0 ? 0.35 : 1);
    }
    if (this.ramRemaining > 0) this.ramRemaining = Math.max(0, this.ramRemaining - dt);
  }

  /** Add XP and check for level up. Auto-applies balanced stat boosts. */
  addXp(amount: number): boolean {
    this.xp += amount;
    const maxLevel = Ship.XP_TABLE.length;
    if (this.level >= maxLevel) return false;
    const needed = Ship.XP_TABLE[this.level] ?? Infinity;
    if (this.xp >= needed) {
      this.level++;
      // Auto-apply balanced boosts (no popup, no choice)
      this.hpBonusPct += 0.06;          // +6% max HP
      this.levelRegenPerSec += 1.5;      // +1.5 HP/sec
      this.damageBonusPct += 0.05;       // +5% damage
      this.skillCdReductPct += 0.04;     // -4% skill cooldown
      this.recalcMaxHp();
      this.heal(this.maxHp * 0.06);      // heal the bonus
      return true;
    }
    return false;
  }

  /** XP needed for next level */
  get xpForNextLevel(): number {
    if (this.level >= Ship.XP_TABLE.length) return 0;
    return Ship.XP_TABLE[this.level] ?? 0;
  }

  /** Apply a level-up upgrade choice */
  applyUpgrade(type: 'hp' | 'regen' | 'damage' | 'skill'): void {
    switch (type) {
      case 'hp':
        this.hpBonusPct += 0.12; // +12% max HP
        this.recalcMaxHp();
        this.heal(this.maxHp * 0.12); // heal the bonus amount
        break;
      case 'regen':
        this.levelRegenPerSec += 4; // +4 HP/sec
        break;
      case 'damage':
        this.damageBonusPct += 0.10; // +10% damage
        break;
      case 'skill':
        this.skillCdReductPct += 0.12; // -12% skill cooldown
        break;
    }
  }

  /** Recalculate maxHp including level bonuses + armor bonuses */
  private recalcMaxHp(): void {
    const baseHp = this.config.hp;
    const armorHp = this.equippedArmors.reduce((s, a) => s + a.hpBonus, 0);
    this.maxHp = Math.floor((baseHp + armorHp) * (1 + this.hpBonusPct));
  }

  /** Override the text label above the ship — used in multiplayer so each
   *  ship shows its owning player's captain name instead of a generic tag. */
  setDisplayName(name: string): void {
    if (!name) return;
    this.nameText.setText(name);
  }

  /** Toggle this ship's visibility based on the viewer team's fog of war.
   *  Dead ships stay hidden regardless (death hides them already). */
  setHiddenByFog(hidden: boolean): void {
    if (this.isDead) return;
    if (this.hiddenByFog === hidden) return;
    this.hiddenByFog = hidden;
    this.setVisible(!hidden);
    this.overlayGraphics.setVisible(!hidden);
    this.healthBar.setVisible(!hidden);
    this.nameText.setVisible(!hidden);
    this.wakeGraphics.setVisible(!hidden);
    this.shadowSprite.setVisible(!hidden);
    this.rimLight.setVisible(!hidden);
  }

  /** Activate the ship's signature skill. Returns true if used. */
  useSkill(): boolean {
    if (this.isDead || this.skillCooldown > 0) return false;
    const skill = this.config.skill;
    if (!skill) return false;

    switch (skill.type) {
      case 'dash':
        this.dashRemaining = skill.duration ?? 2;
        break;
      case 'berserk':
        this.berserkRemaining = skill.duration ?? 5;
        break;
      case 'smoke_screen':
        this.smokeRemaining = skill.duration ?? 5;
        break;
      case 'stealth':
        this.stealthRemaining = skill.duration ?? 5;
        break;
      case 'ram':
        this.ramRemaining = skill.duration ?? 3;
        break;
      case 'plunder':
        // Heal 40% of max HP
        this.heal(this.maxHp * 0.4);
        break;
      case 'heal_aura':
      case 'net_throw':
      case 'war_cry':
        // These are handled externally by GameScene (need access to other ships)
        break;
      // fire_breath / salvo / broadside / volley / tracer_round / plane_burst
      // are handled externally by GameScene since they spawn projectiles/planes
      // (this method just sets cooldown — the scene listens via event)
    }

    this.skillCooldown = skill.cooldown * (1 - this.skillCdReductPct);
    this.spawnSkillFlash();
    return true;
  }

  /** Tier-scaled burst effect when a ship fires its signature skill.
   * Higher tier ships get brighter, larger, longer-lingering auras. */
  private spawnSkillFlash(): void {
    const scene = this.scene as Phaser.Scene;
    if (!scene) return;
    const tier = this.config.tier ?? 1;
    const baseR = 40 + tier * 18;
    const flashColor = this.team === 0 ? 0x88DDFF : 0xFF9977;

    // Core bright flash
    const core = scene.add.graphics().setDepth(5).setBlendMode(Phaser.BlendModes.ADD);
    core.fillStyle(0xFFFFFF, 0.9);
    core.fillCircle(this.x, this.y, 14 + tier * 4);
    scene.tweens.add({
      targets: core, alpha: 0, duration: 260, ease: 'Cubic.Out',
      onComplete: () => core.destroy(),
    });

    // Expanding rings — one per tier step
    for (let i = 0; i < tier; i++) {
      const ring = scene.add.graphics().setDepth(4).setBlendMode(Phaser.BlendModes.ADD);
      const delay = i * 70;
      ring.lineStyle(3, flashColor, 0.85);
      ring.strokeCircle(this.x, this.y, 10);
      scene.tweens.add({
        targets: ring,
        alpha: 0,
        duration: 520,
        delay,
        ease: 'Cubic.Out',
        onUpdate: (tw) => {
          const p = tw.progress;
          ring.clear();
          ring.lineStyle(3, flashColor, 0.85 * (1 - p));
          ring.strokeCircle(this.x, this.y, 10 + p * baseR);
        },
        onComplete: () => ring.destroy(),
      });
    }

    // Sparks for tier 3+
    if (tier >= 3) {
      const sparkCount = 6 + tier * 2;
      for (let i = 0; i < sparkCount; i++) {
        const ang = (i / sparkCount) * Math.PI * 2 + Math.random() * 0.4;
        const dist = baseR * 0.6 + Math.random() * 20;
        const sx = this.x + Math.cos(ang) * 6;
        const sy = this.y + Math.sin(ang) * 6;
        const spark = scene.add.graphics().setDepth(5).setBlendMode(Phaser.BlendModes.ADD);
        spark.fillStyle(flashColor, 0.95);
        spark.fillCircle(sx, sy, 3);
        scene.tweens.add({
          targets: spark,
          x: Math.cos(ang) * dist,
          y: Math.sin(ang) * dist,
          alpha: 0,
          duration: 450 + Math.random() * 200,
          ease: 'Cubic.Out',
          onComplete: () => spark.destroy(),
        });
      }
    }
  }

  destroy(fromScene?: boolean): void {
    this.overlayGraphics?.destroy();
    this.healthBar?.destroy();
    this.nameText?.destroy();
    this.wakeGraphics?.destroy();
    this.shadowSprite?.destroy();
    this.rimLight?.destroy();
    super.destroy(fromScene);
  }
}
