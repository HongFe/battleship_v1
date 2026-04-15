import Phaser from 'phaser';
import { Ship } from '../entities/Ship';
import { Creep } from '../entities/Creep';
import { Tower } from '../entities/Tower';
import { Projectile } from '../entities/Projectile';
import { WeaponItemConfig } from '../config/types';
import { EventBus } from '../utils/EventBus';
import { Fonts } from '../config/theme';
import { AudioManager } from '../utils/AudioManager';

interface Targetable {
  x: number;
  y: number;
  active: boolean;
  team: number;
  isDead?: boolean;
}

export class AutoAttackSystem {
  private cooldowns: Map<Ship, number[]> = new Map();
  private scene: Phaser.Scene;
  public projectiles: Projectile[] = [];

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  update(delta: number, ships: Ship[], creeps: Creep[], towers: Tower[] = []): void {
    // Clean up dead projectiles
    this.projectiles = this.projectiles.filter(p => {
      if (!p.active) {
        p.destroy();
        return false;
      }
      return true;
    });

    // Drop cooldown entries for ships that no longer exist / are dead
    for (const s of this.cooldowns.keys()) {
      if (!s.active || s.isDead) this.cooldowns.delete(s);
    }

    // Update existing projectiles
    for (const proj of this.projectiles) {
      proj.update(delta);
    }

    // Towers fire too
    for (const tower of towers) {
      if (tower.isDead) continue;
      tower.update(delta, ships, this.projectiles);
    }

    // Check projectile hits (now also against towers)
    this.checkHits(ships, creeps, towers);

    // Fire new projectiles from ships
    for (const ship of ships) {
      if (!ship.active || ship.isDead) continue;

      const weapons = ship.getWeapons();
      if (weapons.length === 0) continue;

      if (!this.cooldowns.has(ship)) {
        this.cooldowns.set(ship, weapons.map(() => 0));
      }
      const cds = this.cooldowns.get(ship)!;
      while (cds.length < weapons.length) cds.push(0);

      weapons.forEach((weapon, idx) => {
        cds[idx] -= delta / 1000;
        if (cds[idx] > 0) return;

        // === Faction-aware targeting ===
        // Pirates (team 2): ONLY attack non-bot players
        // Lane bots (isBot, team 0/1): IGNORE pirates (team 2)
        // Human player: can attack everything except own team
        let allTargets: Targetable[];
        if (ship.team === 2) {
          // Pirate NPC: only target human players
          allTargets = ships.filter(s => s !== ship && !s.isBot && s.active && !s.isDead) as Targetable[];
        } else if (ship.isBot) {
          // Lane bot: target opposite team only (skip team 2 pirates)
          allTargets = [
            ...ships.filter(s => s !== ship && s.team !== ship.team && s.team !== 2 && s.active && !s.isDead),
            ...creeps.filter(c => c.active),
            ...towers.filter(t => !t.isDead && t.team !== ship.team && t.team !== 2),
          ];
        } else {
          // Human player: can attack enemies + pirates + creeps + towers
          allTargets = [
            ...ships.filter(s => s !== ship && s.team !== ship.team && s.active && !s.isDead),
            ...creeps.filter(c => c.active),
            ...towers.filter(t => !t.isDead && t.team !== ship.team),
          ];
        }

        const inRange = allTargets.filter(t =>
          Phaser.Math.Distance.Between(ship.x, ship.y, t.x, t.y) <= weapon.range
        );

        if (inRange.length === 0) return;

        const target = inRange.reduce((nearest, t) => {
          const d = Phaser.Math.Distance.Between(ship.x, ship.y, t.x, t.y);
          const nd = Phaser.Math.Distance.Between(ship.x, ship.y, nearest.x, nearest.y);
          return d < nd ? t : nearest;
        });

        // Apply level-up damage bonus to a copy of weapon config
        const effectiveWeapon = ship.damageBonusPct > 0
          ? { ...weapon, damage: Math.floor(weapon.damage * (1 + ship.damageBonusPct)) }
          : weapon;
        this.fireWeapon(ship, idx, effectiveWeapon, target);
        const mult = ship.attackSpeedMultiplier;
        cds[idx] = 1 / (weapon.attackSpeed * mult);
      });
    }
  }

  /** Helper to spawn one projectile with range cap + auto-homing to guarantee hit */
  private spawnProjectile(
    cannonX: number, cannonY: number,
    targetX: number, targetY: number,
    speed: number, damage: number,
    type: any, splashRadius: number,
    ownerTeam: number,
    maxRange: number,
    homingTarget?: Targetable,
  ): Projectile {
    const proj = new Projectile(
      this.scene,
      cannonX, cannonY,
      targetX, targetY,
      speed, damage, type, splashRadius, ownerTeam,
    );
    proj.maxRange = maxRange;
    if (homingTarget) proj.setHomingTarget(homingTarget as any);
    this.projectiles.push(proj);
    return proj;
  }

  private fireWeapon(ship: Ship, weaponIdx: number, weapon: WeaponItemConfig, target: Targetable): void {
    const cannonPos = ship.getCannonWorldPos(weaponIdx);
    const range = weapon.range;

    // Audio: only play sound for the player ship to avoid sound spam
    if ((this.scene as any).player === ship) {
      AudioManager.cannonFire();
    }

    // Cost-tiered fancy muzzle flourish — expensive weapons get a bigger burst
    this.spawnCostMuzzle(cannonPos.x, cannonPos.y, weapon);

    // Sniper tracer (any sniper-category weapon adds a bright instant tracer line)
    if (weapon.category === 'sniper') {
      this.spawnTracerLine(cannonPos.x, cannonPos.y, target.x, target.y, 0xCCEEFF);
    }
    // Beam-category weapons get a brief continuous beam line
    if (weapon.category === 'beam' || weapon.projectileType === 'laser') {
      this.spawnBeamLine(cannonPos.x, cannonPos.y, target.x, target.y);
    }

    if (weapon.projectileType === 'burst') {
      // 5-pellet spread, all home to target so most hit
      for (let i = 0; i < 5; i++) {
        const offset = (i - 2) * 0.10;
        const angle = Phaser.Math.Angle.Between(cannonPos.x, cannonPos.y, target.x, target.y) + offset;
        const aimX = cannonPos.x + Math.cos(angle) * range;
        const aimY = cannonPos.y + Math.sin(angle) * range;
        this.spawnProjectile(cannonPos.x, cannonPos.y, aimX, aimY,
          weapon.projectileSpeed, weapon.damage, 'burst', 0, ship.team, range, target);
      }
      return;
    }

    if (weapon.projectileType === 'flame') {
      // Cone of flame — no homing, short range cap
      const baseAngle = Phaser.Math.Angle.Between(cannonPos.x, cannonPos.y, target.x, target.y);
      for (let i = 0; i < 3; i++) {
        const offset = Phaser.Math.FloatBetween(-0.18, 0.18);
        const angle = baseAngle + offset;
        const aimX = cannonPos.x + Math.cos(angle) * range;
        const aimY = cannonPos.y + Math.sin(angle) * range;
        this.spawnProjectile(cannonPos.x, cannonPos.y, aimX, aimY,
          weapon.projectileSpeed * Phaser.Math.FloatBetween(0.85, 1.1),
          weapon.damage, 'flame', 0, ship.team, range);
      }
      return;
    }

    if (weapon.projectileType === 'rail') {
      this.spawnProjectile(cannonPos.x, cannonPos.y, target.x, target.y,
        weapon.projectileSpeed, weapon.damage, 'rail', 0, ship.team, range, target);
      this.spawnBeamFlash(cannonPos.x, cannonPos.y, target.x, target.y);
      return;
    }

    if (weapon.projectileType === 'chain') {
      const proj = this.spawnProjectile(cannonPos.x, cannonPos.y, target.x, target.y,
        weapon.projectileSpeed, weapon.damage, 'chain', 0, ship.team, range, target);
      proj.chainsRemaining = 3;
      return;
    }

    // Default: normal/splash/plasma/piercing/homing/lightning — all auto-home
    this.spawnProjectile(
      cannonPos.x, cannonPos.y, target.x, target.y,
      weapon.projectileSpeed, weapon.damage,
      weapon.projectileType, weapon.splashRadius, ship.team, range, target,
    );
  }

  /** Expensive weapons get a bigger, lingering muzzle burst + shockwave ring.
   *  cost < 400  -> nothing extra
   *  cost 400-800 -> small ring
   *  cost 800-1400 -> ring + bright core
   *  cost 1400+   -> ring + core + radial sparks */
  private spawnCostMuzzle(x: number, y: number, weapon: WeaponItemConfig): void {
    const cost = weapon.cost ?? 0;
    if (cost < 400) return;

    const tierCol = cost >= 1400 ? 0xFFEE88
      : cost >= 800 ? 0xCCEEFF
      : 0xFFCC66;
    const ringR = 18 + Math.min(30, cost / 60);

    // Shockwave ring
    const ring = this.scene.add.graphics().setDepth(6).setBlendMode(Phaser.BlendModes.ADD);
    this.scene.tweens.add({
      targets: ring, alpha: 0, duration: 380, ease: 'Cubic.Out',
      onUpdate: (tw) => {
        const p = tw.progress;
        ring.clear();
        ring.lineStyle(2.5, tierCol, 0.9 * (1 - p));
        ring.strokeCircle(x, y, 6 + p * ringR);
      },
      onComplete: () => ring.destroy(),
    });

    // Bright core for mid+ tier
    if (cost >= 800) {
      const core = this.scene.add.image(x, y, 'glow')
        .setDepth(7).setBlendMode(Phaser.BlendModes.ADD)
        .setTint(tierCol).setScale(0.5);
      this.scene.tweens.add({
        targets: core, alpha: 0, scaleX: 1.4, scaleY: 1.4,
        duration: 280, ease: 'Cubic.Out',
        onComplete: () => core.destroy(),
      });
    }

    // Radial sparks for top-tier
    if (cost >= 1400) {
      const count = 8;
      for (let i = 0; i < count; i++) {
        const ang = (i / count) * Math.PI * 2 + Math.random() * 0.3;
        const dist = 26 + Math.random() * 18;
        const sp = this.scene.add.graphics().setDepth(7).setBlendMode(Phaser.BlendModes.ADD);
        sp.fillStyle(tierCol, 1);
        sp.fillCircle(x, y, 2.5);
        this.scene.tweens.add({
          targets: sp,
          x: Math.cos(ang) * dist,
          y: Math.sin(ang) * dist,
          alpha: 0,
          duration: 340 + Math.random() * 140,
          ease: 'Cubic.Out',
          onComplete: () => sp.destroy(),
        });
      }
    }
  }

  private spawnBeamFlash(x1: number, y1: number, x2: number, y2: number): void {
    const beam = this.scene.add.graphics({ x: 0, y: 0 }).setDepth(7);
    beam.lineStyle(4, 0x44DDFF, 0.5);
    beam.lineBetween(x1, y1, x2, y2);
    beam.lineStyle(2, 0xFFFFFF, 0.9);
    beam.lineBetween(x1, y1, x2, y2);
    this.scene.tweens.add({
      targets: beam,
      alpha: 0,
      duration: 250,
      onComplete: () => beam.destroy(),
    });
  }

  /** Thin instant tracer line for sniper weapons */
  private spawnTracerLine(x1: number, y1: number, x2: number, y2: number, color: number): void {
    const tracer = this.scene.add.graphics({ x: 0, y: 0 }).setDepth(7);
    // Outer glow line
    tracer.lineStyle(3, color, 0.4);
    tracer.lineBetween(x1, y1, x2, y2);
    // Sharp inner line
    tracer.lineStyle(1, 0xFFFFFF, 0.95);
    tracer.lineBetween(x1, y1, x2, y2);
    this.scene.tweens.add({
      targets: tracer,
      alpha: 0,
      duration: 180,
      ease: 'Quad.Out',
      onComplete: () => tracer.destroy(),
    });
  }

  /** Solid laser beam for beam-category weapons */
  private spawnBeamLine(x1: number, y1: number, x2: number, y2: number): void {
    const beam = this.scene.add.graphics({ x: 0, y: 0 }).setDepth(7);
    // Wide pink/red glow
    beam.lineStyle(6, 0xFF3366, 0.3);
    beam.lineBetween(x1, y1, x2, y2);
    beam.lineStyle(3, 0xFF6699, 0.7);
    beam.lineBetween(x1, y1, x2, y2);
    beam.lineStyle(1, 0xFFFFFF, 1);
    beam.lineBetween(x1, y1, x2, y2);
    this.scene.tweens.add({
      targets: beam,
      alpha: 0,
      duration: 220,
      ease: 'Quad.Out',
      onComplete: () => beam.destroy(),
    });
  }

  private checkHits(ships: Ship[], creeps: Creep[], towers: Tower[] = []): void {
    for (const proj of this.projectiles) {
      if (!proj.active) continue;

      // Check tower hits first (enemy towers take big hits)
      let hitTower = false;
      for (const tower of towers) {
        if (tower.isDead || tower.team === proj.ownerTeam) continue;
        const dist = Phaser.Math.Distance.Between(proj.x, proj.y, tower.x, tower.y);
        const hitR = tower.isNexus ? 38 : 26;
        if (dist < hitR) {
          tower.takeDamage(proj.damage);
          this.spawnHitEffect(proj.x, proj.y, proj.projectileType);
          if (proj.projectileType !== 'piercing' && proj.projectileType !== 'rail') {
            proj.deactivate();
          }
          hitTower = true;
          break;
        }
      }
      if (hitTower && !proj.active) continue;

      // Check ship hits
      for (const ship of ships) {
        if (!ship.active || ship.isDead || ship.team === proj.ownerTeam) continue;
        if (proj.hasHit.has(ship.__id)) continue;
        const hitRadius = ship.config.id === 'battleship' ? 32 : ship.config.id === 'cruiser' ? 26 : 20;
        const dist = Phaser.Math.Distance.Between(proj.x, proj.y, ship.x, ship.y);
        if (dist < hitRadius) {
          const hpBefore = ship.currentHp;
          ship.takeDamage(proj.damage);
          const actualDmg = Math.max(0, hpBefore - ship.currentHp);
          const isPlayer = ship === (this.scene as any).player;
          this.spawnDamageNumber(ship.x, ship.y, actualDmg, isPlayer);
          this.shakeOnHit(ship.x, ship.y, proj.damage, isPlayer);
          // Audio: hit only for player damage (not bot vs bot to avoid spam)
          if (isPlayer) AudioManager.hit();
          EventBus.emit('ship-hit', { ship, damage: proj.damage });
          this.spawnHitEffect(proj.x, proj.y, proj.projectileType);

          // Splash damage
          if ((proj.projectileType === 'splash' || proj.projectileType === 'plasma' || proj.projectileType === 'homing') && proj.splashRadius > 0) {
            this.spawnSplashEffect(proj.x, proj.y, proj.splashRadius, proj.projectileType);
            for (const other of ships) {
              if (other === ship || !other.active || other.isDead || other.team === proj.ownerTeam) continue;
              const sd = Phaser.Math.Distance.Between(proj.x, proj.y, other.x, other.y);
              if (sd <= proj.splashRadius) {
                other.takeDamage(proj.damage * 0.5);
              }
            }
          }

          // Chain lightning
          if (proj.projectileType === 'chain' && proj.chainsRemaining > 0) {
            this.spawnChainBolt(proj.x, proj.y, ship.x, ship.y);
            this.tryChain(ship, ships, creeps, proj);
          }

          // Piercing/rail keeps going
          if (proj.projectileType !== 'piercing' && proj.projectileType !== 'rail') {
            proj.deactivate();
          } else {
            proj.hasHit.add(ship.__id);
          }
          break;
        }
      }

      if (!proj.active) continue;

      // Check creep hits
      for (const creep of creeps) {
        if (!creep.active) continue;
        const dist = Phaser.Math.Distance.Between(proj.x, proj.y, creep.x, creep.y);
        if (dist < 16) {
          const killed = creep.takeDamage(proj.damage);
          if (killed) {
            const owner = ships.find(s => s.team === proj.ownerTeam && s.active);
            if (owner) {
              owner.gold += creep.goldValue;
              // XP from creep kill
              const xpGain = creep.isElite ? 80 : 20;
              if (owner.addXp(xpGain)) {
                EventBus.emit('level-up', owner.level);
              }
            }
          }
          this.spawnHitEffect(proj.x, proj.y, proj.projectileType);
          if (proj.projectileType !== 'piercing' && proj.projectileType !== 'rail') {
            proj.deactivate();
          }
          break;
        }
      }
    }
  }

  private tryChain(fromShip: Ship, ships: Ship[], _creeps: Creep[], proj: Projectile): void {
    // Find nearest enemy within chain range
    const chainRange = 180;
    const candidates = ships.filter(s =>
      s !== fromShip &&
      s.active &&
      !s.isDead &&
      s.team !== proj.ownerTeam &&
      Phaser.Math.Distance.Between(fromShip.x, fromShip.y, s.x, s.y) <= chainRange
    );
    if (candidates.length === 0) return;

    const next = candidates.reduce((closest, s) => {
      const d = Phaser.Math.Distance.Between(fromShip.x, fromShip.y, s.x, s.y);
      const cd = Phaser.Math.Distance.Between(fromShip.x, fromShip.y, closest.x, closest.y);
      return d < cd ? s : closest;
    });

    const newProj = new Projectile(
      this.scene,
      fromShip.x, fromShip.y,
      next.x, next.y,
      proj.speed,
      proj.damage * 0.7,
      'chain',
      0,
      proj.ownerTeam,
    );
    newProj.chainsRemaining = proj.chainsRemaining - 1;
    this.projectiles.push(newProj);
  }

  private spawnChainBolt(x1: number, y1: number, x2: number, y2: number): void {
    const g = this.scene.add.graphics({ x: 0, y: 0 }).setDepth(7);
    // Jagged lightning
    const segments = 5;
    g.lineStyle(2, 0xCCBBFF, 0.9);
    g.beginPath();
    g.moveTo(x1, y1);
    for (let i = 1; i < segments; i++) {
      const t = i / segments;
      const px = x1 + (x2 - x1) * t + Phaser.Math.FloatBetween(-8, 8);
      const py = y1 + (y2 - y1) * t + Phaser.Math.FloatBetween(-8, 8);
      g.lineTo(px, py);
    }
    g.lineTo(x2, y2);
    g.strokePath();
    g.lineStyle(1, 0xFFFFFF, 1);
    g.lineBetween(x1, y1, x2, y2);

    this.scene.tweens.add({
      targets: g,
      alpha: 0,
      duration: 200,
      onComplete: () => g.destroy(),
    });
  }

  private spawnHitEffect(x: number, y: number, type: string): void {
    // Bright additive glow on every hit (gives 3D "burst" feel)
    const glowTints: Record<string, number> = {
      splash: 0xFF8844, plasma: 0x66FFAA, rail: 0xCCEEFF,
      flame: 0xFF6622, lightning: 0xCCBBFF, chain: 0xCCBBFF,
      laser: 0xFF6699, normal: 0xFFDD66, piercing: 0xCCEEFF,
      homing: 0xFFAA66, burst: 0xFFCC44,
    };
    const glowTint = glowTints[type] ?? 0xFFDD66;
    const glowSize = (type === 'splash' || type === 'plasma') ? 50
      : (type === 'rail' || type === 'flame') ? 35
      : 24;

    const glow = this.scene.add.image(x, y, 'glow')
      .setDepth(8)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setTint(glowTint)
      .setScale(glowSize / 64);
    this.scene.tweens.add({
      targets: glow,
      alpha: 0,
      scaleX: glow.scaleX * 2,
      scaleY: glow.scaleY * 2,
      duration: 280,
      ease: 'Cubic.Out',
      onComplete: () => glow.destroy(),
    });

    // Big impacts → also play explosion sprite anim
    if (type === 'splash' || type === 'plasma' || type === 'rail') {
      const sprite = this.scene.add.sprite(x, y, 'explosion_1').setDepth(8);
      sprite.setScale(type === 'rail' ? 1.6 : 2.2);
      if (type === 'plasma') sprite.setTint(0x88FFCC);
      else if (type === 'rail') sprite.setTint(0xCCEEFF);
      sprite.play('explosion_anim');
      sprite.once('animationcomplete', () => sprite.destroy());
      return;
    }

    // Lightning sparks
    if (type === 'lightning' || type === 'chain') {
      const g = this.scene.add.graphics({ x: 0, y: 0 }).setDepth(8);
      for (let i = 0; i < 6; i++) {
        const a = Math.random() * Math.PI * 2;
        const len = 10 + Math.random() * 6;
        g.lineStyle(1.5, 0xFFFFFF, 0.9);
        g.lineBetween(x, y, x + Math.cos(a) * len, y + Math.sin(a) * len);
      }
      this.scene.tweens.add({
        targets: g, alpha: 0, duration: 200,
        onComplete: () => g.destroy(),
      });
    }
  }

  private spawnSplashEffect(x: number, y: number, radius: number, type: string): void {
    // Outer shockwave ring (procedural)
    const g = this.scene.add.graphics({ x: 0, y: 0 }).setDepth(7);
    const color = type === 'plasma' ? 0x33FF99 : 0xFF6B35;
    g.lineStyle(3, color, 0.6);
    g.strokeCircle(x, y, radius);
    g.lineStyle(1, 0xFFFFFF, 0.5);
    g.strokeCircle(x, y, radius * 0.6);
    this.scene.tweens.add({
      targets: g,
      alpha: 0,
      scaleX: 1.4,
      scaleY: 1.4,
      duration: 450,
      onComplete: () => g.destroy(),
    });
  }

  /** Floating damage number that arcs upward and fades */
  private spawnDamageNumber(x: number, y: number, damage: number, isPlayer: boolean): void {
    if (damage < 1) return;
    const isCrit = damage >= 200;
    const color = isPlayer ? '#FF4444' : isCrit ? '#FFDD44' : '#FFEEDD';
    const size = isCrit ? 22 : Math.min(20, 12 + Math.sqrt(damage) * 0.5);

    const txt = this.scene.add.text(x, y - 18, `${Math.ceil(damage)}`, {
      fontFamily: Fonts.display,
      fontSize: `${size}px`,
      color,
      stroke: '#000000',
      strokeThickness: 3,
    }).setOrigin(0.5).setDepth(15);

    // Random horizontal jitter
    const jx = Phaser.Math.FloatBetween(-12, 12);
    this.scene.tweens.add({
      targets: txt,
      x: txt.x + jx,
      y: txt.y - 38,
      alpha: { from: 1, to: 0 },
      scaleX: { from: 1.4, to: 1 },
      scaleY: { from: 1.4, to: 1 },
      duration: 850,
      ease: 'Cubic.Out',
      onComplete: () => txt.destroy(),
    });
  }

  /** Camera shake on big impacts — only when player is near combat */
  private shakeOnHit(hitX: number, hitY: number, damage: number, isPlayer: boolean): void {
    const player = (this.scene as any).player;
    if (!player || player.isDead) return;
    const cam = this.scene.cameras.main;

    if (isPlayer) {
      // Player took the hit — full shake
      const intensity = 0.008 * (1 + Math.min(damage / 200, 2));
      cam.shake(180, intensity);
      return;
    }

    // Other ship hit — distance-based fall-off
    const dist = Phaser.Math.Distance.Between(hitX, hitY, player.x, player.y);
    const MAX_SHAKE_DIST = 450; // anything farther = no shake at all
    if (dist > MAX_SHAKE_DIST) return;

    const falloff = 1 - dist / MAX_SHAKE_DIST;        // 1 close → 0 far
    const intensity = 0.0035 * falloff * (1 + Math.min(damage / 300, 1.5));
    if (intensity < 0.0008) return; // imperceptible — skip
    cam.shake(80, intensity);
  }

  cleanup(): void {
    for (const proj of this.projectiles) {
      proj.destroy();
    }
    this.projectiles = [];
    this.cooldowns.clear();
  }
}
