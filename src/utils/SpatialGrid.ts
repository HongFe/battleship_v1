import Phaser from 'phaser';

export interface GridEntity {
  x: number;
  y: number;
  active: boolean;
  team: number;
}

export class SpatialGrid<T extends GridEntity> {
  private cells: Map<string, T[]> = new Map();
  private cellSize: number;

  constructor(cellSize = 300) {
    this.cellSize = cellSize;
  }

  private getKey(x: number, y: number): string {
    return `${Math.floor(x / this.cellSize)},${Math.floor(y / this.cellSize)}`;
  }

  update(entities: T[]): void {
    this.cells.clear();
    for (const e of entities) {
      if (!e.active) continue;
      const key = this.getKey(e.x, e.y);
      if (!this.cells.has(key)) this.cells.set(key, []);
      this.cells.get(key)!.push(e);
    }
  }

  queryRadius(x: number, y: number, radius: number): T[] {
    const result: T[] = [];
    const minCx = Math.floor((x - radius) / this.cellSize);
    const maxCx = Math.floor((x + radius) / this.cellSize);
    const minCy = Math.floor((y - radius) / this.cellSize);
    const maxCy = Math.floor((y + radius) / this.cellSize);

    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cy = minCy; cy <= maxCy; cy++) {
        const entities = this.cells.get(`${cx},${cy}`) ?? [];
        for (const e of entities) {
          const dist = Phaser.Math.Distance.Between(x, y, e.x, e.y);
          if (dist <= radius) result.push(e);
        }
      }
    }
    return result;
  }
}
