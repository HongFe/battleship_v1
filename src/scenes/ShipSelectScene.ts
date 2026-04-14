import Phaser from 'phaser';
import { BalanceConfig, ShipId } from '../config/types';

export class ShipSelectScene extends Phaser.Scene {
  constructor() {
    super({ key: 'ShipSelectScene' });
  }

  create(): void {
    const w = this.scale.width;
    const h = this.scale.height;
    const balance = this.cache.json.get('balance') as BalanceConfig;

    this.add.rectangle(w / 2, h / 2, w, h, 0x0A1628);

    // Title
    this.add.text(w / 2, 50, 'SELECT YOUR SHIP', {
      fontSize: '28px',
      fontFamily: 'monospace',
      color: '#F5A623',
      fontStyle: 'bold',
    }).setOrigin(0.5);

    const shipIds: ShipId[] = ['destroyer', 'cruiser', 'battleship'];
    const colors: Partial<Record<ShipId, number>> = {
      destroyer: 0x4A9ECC,
      cruiser: 0x6B8E5A,
      battleship: 0x8B7355,
    };

    const cardWidth = Math.min(w * 0.85, 300);
    const cardHeight = 150;
    const startY = 120;

    shipIds.forEach((shipId, i) => {
      const ship = balance.ships[shipId];
      const color = colors[shipId] ?? 0x4A9ECC;
      const cardY = startY + i * (cardHeight + 20);

      // Card background
      const card = this.add.graphics();
      card.fillStyle(0x132240, 0.9);
      card.fillRoundedRect(w / 2 - cardWidth / 2, cardY, cardWidth, cardHeight, 10);
      card.lineStyle(2, color, 0.7);
      card.strokeRoundedRect(w / 2 - cardWidth / 2, cardY, cardWidth, cardHeight, 10);

      // Ship preview (triangle)
      const previewX = w / 2 - cardWidth / 2 + 50;
      const previewY = cardY + cardHeight / 2;
      const shipPreview = this.add.graphics();
      shipPreview.fillStyle(color, 1);
      const size = shipId === 'battleship' ? 30 : shipId === 'cruiser' ? 25 : 20;
      shipPreview.fillTriangle(
        previewX, previewY - size,
        previewX - size * 0.7, previewY + size,
        previewX + size * 0.7, previewY + size,
      );

      // Ship name
      this.add.text(w / 2 + 10, cardY + 20, ship.displayName, {
        fontSize: '20px',
        fontFamily: 'monospace',
        color: '#E8F4FF',
        fontStyle: 'bold',
      }).setOrigin(0.5, 0);

      // Stats
      const statsX = w / 2 - 20;
      const statsY = cardY + 55;
      const stats = [
        `HP: ${ship.hp}`,
        `SPD: ${ship.speed}`,
        `ARM: ${ship.armor}`,
        `SLOTS: ${ship.slots.weapon}W/${ship.slots.armor}A/${ship.slots.special}S`,
      ];

      stats.forEach((stat, j) => {
        this.add.text(statsX, statsY + j * 20, stat, {
          fontSize: '13px',
          fontFamily: 'monospace',
          color: '#8BA8CC',
        });
      });

      // Stat bars
      const barX = statsX + 130;
      const maxHp = 1200;
      const maxSpd = 240;

      // HP bar
      this.drawStatBar(barX, statsY + 4, ship.hp / maxHp, 0x3DC47E);
      // Speed bar
      this.drawStatBar(barX, statsY + 24, ship.speed / maxSpd, 0x4A9ECC);

      // Interactive hit area
      const hitArea = this.add.rectangle(
        w / 2, cardY + cardHeight / 2,
        cardWidth, cardHeight, 0x000000, 0,
      ).setInteractive({ useHandCursor: true });

      hitArea.on('pointerover', () => {
        card.clear();
        card.fillStyle(0x1E3357, 0.95);
        card.fillRoundedRect(w / 2 - cardWidth / 2, cardY, cardWidth, cardHeight, 10);
        card.lineStyle(2, 0xF5A623, 1);
        card.strokeRoundedRect(w / 2 - cardWidth / 2, cardY, cardWidth, cardHeight, 10);
      });

      hitArea.on('pointerout', () => {
        card.clear();
        card.fillStyle(0x132240, 0.9);
        card.fillRoundedRect(w / 2 - cardWidth / 2, cardY, cardWidth, cardHeight, 10);
        card.lineStyle(2, color, 0.7);
        card.strokeRoundedRect(w / 2 - cardWidth / 2, cardY, cardWidth, cardHeight, 10);
      });

      hitArea.on('pointerdown', () => {
        this.cameras.main.fadeOut(300);
        this.time.delayedCall(300, () => {
          this.scene.start('GameScene', { selectedShip: shipId });
        });
      });
    });

    this.cameras.main.fadeIn(300);
  }

  private drawStatBar(x: number, y: number, ratio: number, color: number): void {
    const g = this.add.graphics();
    const barW = 60;
    g.fillStyle(0x000000, 0.4);
    g.fillRect(x, y, barW, 8);
    g.fillStyle(color, 0.9);
    g.fillRect(x, y, barW * ratio, 8);
  }
}
