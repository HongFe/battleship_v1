export type ProjectileType = 'normal' | 'splash' | 'piercing' | 'lightning' | 'homing' | 'flame' | 'rail' | 'plasma' | 'laser' | 'chain' | 'burst';
export type ItemType = 'weapon' | 'armor' | 'special';
export type ShipId =
  | 'patrolboat' | 'destroyer' | 'cruiser' | 'battleship' | 'submarine' | 'carrier'
  | 'turtleship' | 'panokseon' | 'galleon' | 'pirate' | 'viking' | 'trireme'
  | 'yamato' | 'iowa' | 'hood' | 'akagi' | 'pyotr'
  | 'blackpearl' | 'flyingdutchman' | 'royalfortune'
  | 'kraken' | 'phoenix' | 'ghostship' | 'thundership'
  | 'medic' | 'seawitch' | 'hwacha' | 'warcrier';

export type Nation = 'KOR' | 'JPN' | 'USA' | 'GER' | 'GBR' | 'RUS' | 'FRA' | 'HISTORIC' | 'PIRATE' | 'MYTH';

export type ShipRole = 'tank' | 'dps' | 'speed' | 'artillery' | 'support';
export type ShipTier = 1 | 2 | 3 | 4 | 5;
export type WeaponCategory = 'sniper' | 'rapid' | 'splash' | 'pierce' | 'homing' | 'chain' | 'flame' | 'beam';

export type SkillType =
  | 'fire_breath'    // turtleship — cone of fire from front
  | 'salvo'          // battleship — fire all weapons immediately
  | 'berserk'        // viking — attack speed buff
  | 'plunder'        // pirate — heal large amount
  | 'ram'            // trireme — speed boost + collision damage
  | 'dash'           // patrolboat — brief speed burst
  | 'plane_burst'    // carrier — launch extra planes
  | 'stealth'        // submarine — temporary invisibility
  | 'broadside'      // galleon — fire all cannons in one wave
  | 'volley'         // panokseon — area attack in front
  | 'smoke_screen'   // cruiser — damage reduction
  | 'tracer_round'   // destroyer — single high-dmg shot
  | 'heal_aura'      // healer — restore ally HP in radius
  | 'net_throw'      // CC — slow enemies in area
  | 'war_cry';       // buff — boost nearby allies speed+damage

export interface SkillConfig {
  type: SkillType;
  cooldown: number;       // seconds
  duration?: number;      // seconds (for buffs)
  damage?: number;
  range?: number;
  displayName: string;
}

export interface ShipConfig {
  id: ShipId;
  displayName: string;
  hp: number;
  speed: number;
  armor: number;
  slots: { weapon: number; armor: number; special: number };
  cost: number;
  spriteName: string;
  nation?: Nation;
  era?: string;
  flavor?: string;
  role?: ShipRole;     // tank / dps / speed / artillery
  tier?: ShipTier;     // 1-5
  skill?: SkillConfig;
}

export interface WeaponItemConfig {
  id: string;
  displayName: string;
  type: 'weapon';
  category?: WeaponCategory;
  damage: number;
  range: number;
  attackSpeed: number;
  projectileType: ProjectileType;
  projectileSpeed: number;
  splashRadius: number;
  cost: number;
  spriteName: string;
  description: string;
}

export interface ArmorItemConfig {
  id: string;
  displayName: string;
  type: 'armor';
  armorBonus: number;
  hpBonus: number;
  effect: string | null;
  effectParams?: Record<string, number>;
  cost: number;
  spriteName: string;
  description: string;
}

export interface SpecialItemConfig {
  id: string;
  displayName: string;
  type: 'special';
  speedMultiplier?: number;
  cost: number;
  spriteName: string;
  description: string;
}

export type ItemConfig = WeaponItemConfig | ArmorItemConfig | SpecialItemConfig;

export interface RecipeConfig {
  id: string;
  displayName: string;
  ingredients: string[];
  resultItem: Omit<WeaponItemConfig, 'id' | 'displayName' | 'cost'>;
}

export interface BalanceConfig {
  ships: Record<ShipId, ShipConfig>;
  items: Record<string, ItemConfig>;
  recipes: RecipeConfig[];
  economy: {
    startingGold: number;
    creepKillGold: number;
    shipKillGold: number;
    passiveGoldPerInterval: number;
    passiveGoldInterval: number;
  };
  map: {
    worldWidth: number;
    worldHeight: number;
    safeZoneInitialRadius: number;
    safeZoneShrinkStart: number;
    safeZoneShrinkInterval: number;
    safeZoneShrinkAmount: number;
    safeZoneDamagePerSecond: number;
    creepSpawnInterval: number;
    creepHp: number;
    creepSpeed: number;
  };
}
