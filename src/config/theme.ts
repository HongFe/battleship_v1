/**
 * Pirate-noir design tokens.
 * Single source of truth for colors, fonts, text styles.
 * Inspired by Pirates of the Caribbean / Sea of Thieves / Black Flag.
 */

export const Colors = {
  // === Background ===
  abyss: '#050B14',
  deepSea: '#0A1520',
  midSea: '#152432',
  shallowSea: '#1B3A5C',

  // === Wood (UI panels) ===
  darkWood: '#1F1108',
  midWood: '#3D2817',
  woodGrain: '#4A2D1A',
  lightWood: '#6B4423',
  agedWood: '#8B5A2B',

  // === Metal/Iron ===
  iron: '#2C2520',
  rustyIron: '#3D332C',
  polishedIron: '#5C5048',
  brass: '#8B6F22',
  brassLight: '#B89046',

  // === Parchment ===
  parchment: '#E8D7B8',
  paperEdge: '#9C8866',
  ink: '#1A1208',
  faded: '#A89D7E',

  // === Gold (treasure / accent) ===
  rustGold: '#8B6F22',
  treasureGold: '#D4A847',
  brightGold: '#F2C84B',
  goldGlow: '#FFD966',

  // === Blood (damage / danger / enemy) ===
  coalRed: '#3D0A0A',
  bloodRed: '#8B1A1A',
  fireRed: '#C0392B',
  brightRed: '#E84545',

  // === Sea / Cool accents ===
  deepBlue: '#1B3A5C',
  navyBlue: '#2E5680',
  teal: '#3DA9C7',
  foam: '#B8D4E0',

  // === Bone / Light text ===
  bone: '#EFE5C9',
  cream: '#F5EBD0',
  fog: '#5C6F7A',
  ash: '#7A8590',
};

/** Hex versions for Phaser tint / fillStyle */
export const Hex = {
  abyss: 0x050B14,
  deepSea: 0x0A1520,
  midSea: 0x152432,
  shallowSea: 0x1B3A5C,

  darkWood: 0x1F1108,
  midWood: 0x3D2817,
  woodGrain: 0x4A2D1A,
  lightWood: 0x6B4423,
  agedWood: 0x8B5A2B,

  iron: 0x2C2520,
  rustyIron: 0x3D332C,
  polishedIron: 0x5C5048,
  brass: 0x8B6F22,
  brassLight: 0xB89046,

  parchment: 0xE8D7B8,
  paperEdge: 0x9C8866,
  ink: 0x1A1208,
  faded: 0xA89D7E,

  rustGold: 0x8B6F22,
  treasureGold: 0xD4A847,
  brightGold: 0xF2C84B,
  goldGlow: 0xFFD966,

  coalRed: 0x3D0A0A,
  bloodRed: 0x8B1A1A,
  fireRed: 0xC0392B,
  brightRed: 0xE84545,

  deepBlue: 0x1B3A5C,
  navyBlue: 0x2E5680,
  teal: 0x3DA9C7,
  foam: 0xB8D4E0,

  bone: 0xEFE5C9,
  cream: 0xF5EBD0,
  fog: 0x5C6F7A,
  ash: 0x7A8590,
};

export const Fonts = {
  /** Big dramatic display — pirate flag style */
  display: '"Pirata One", "Black Han Sans", serif',
  /** Strong heading — used for HUD labels, button text */
  heading: '"Black Han Sans", "Pirata One", sans-serif',
  /** Body text — readable serif */
  body: '"Noto Serif KR", "Cinzel", serif',
  /** Numbers / stat displays */
  numeric: '"Cinzel", "Black Han Sans", serif',
};

/** Helper to build text style objects with consistent defaults */
export function textStyle(opts: {
  font?: 'display' | 'heading' | 'body' | 'numeric';
  size: number;
  color?: string;
  stroke?: string;
  strokeWidth?: number;
  bold?: boolean;
  shadow?: boolean;
}): Phaser.Types.GameObjects.Text.TextStyle {
  const style: Phaser.Types.GameObjects.Text.TextStyle = {
    fontFamily: Fonts[opts.font ?? 'heading'],
    fontSize: `${opts.size}px`,
    color: opts.color ?? Colors.parchment,
  };
  if (opts.stroke) {
    style.stroke = opts.stroke;
    style.strokeThickness = opts.strokeWidth ?? 2;
  }
  if (opts.bold) style.fontStyle = 'bold';
  if (opts.shadow) {
    style.shadow = {
      offsetX: 1,
      offsetY: 2,
      color: '#000000',
      blur: 4,
      stroke: false,
      fill: true,
    };
  }
  return style;
}
