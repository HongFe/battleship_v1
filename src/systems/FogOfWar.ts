import Phaser from 'phaser';

/**
 * Grid-based Fog of War system.
 * - HIDDEN (0): never seen → near-black
 * - EXPLORED (1): previously seen but no current vision → semi-transparent gray
 * - VISIBLE (2): currently in vision range → fully clear
 *
 * Updates every few frames for performance. Only renders cells near camera.
 */
export class FogOfWar {
  private cellSize: number;
  private cols: number;
  private rows: number;
  private explored: Uint8Array;       // permanent: 0=hidden, 1=explored
  private visible: Uint8Array;        // per-frame: 0=not visible, 1=visible
  private fogGraphics: Phaser.GameObjects.Graphics;
  private frameCounter: number = 0;
  private readonly UPDATE_INTERVAL = 4; // update every N frames

  constructor(scene: Phaser.Scene, mapW: number, mapH: number, cellSize = 55) {
    this.cellSize = cellSize;
    this.cols = Math.ceil(mapW / cellSize);
    this.rows = Math.ceil(mapH / cellSize);
    this.explored = new Uint8Array(this.cols * this.rows);
    this.visible = new Uint8Array(this.cols * this.rows);
    this.fogGraphics = scene.add.graphics().setDepth(45); // above game, below vignette
  }

  /** Call every frame. Pass all units that provide vision. */
  update(
    cam: Phaser.Cameras.Scene2D.Camera,
    visionSources: { x: number; y: number; range: number }[],
  ): void {
    this.frameCounter++;
    if (this.frameCounter % this.UPDATE_INTERVAL !== 0) return;

    // Reset frame visibility
    this.visible.fill(0);

    // Mark visible cells around each vision source
    for (const src of visionSources) {
      this.revealCircle(src.x, src.y, src.range);
    }

    // Render fog overlay (only camera-visible cells)
    this.render(cam);
  }

  /** Mark cells within radius as visible + explored */
  private revealCircle(x: number, y: number, range: number): void {
    const cxMin = Math.max(0, Math.floor((x - range) / this.cellSize));
    const cxMax = Math.min(this.cols - 1, Math.floor((x + range) / this.cellSize));
    const cyMin = Math.max(0, Math.floor((y - range) / this.cellSize));
    const cyMax = Math.min(this.rows - 1, Math.floor((y + range) / this.cellSize));

    for (let cy = cyMin; cy <= cyMax; cy++) {
      for (let cx = cxMin; cx <= cxMax; cx++) {
        const cellCenterX = cx * this.cellSize + this.cellSize / 2;
        const cellCenterY = cy * this.cellSize + this.cellSize / 2;
        const dx = cellCenterX - x;
        const dy = cellCenterY - y;
        if (dx * dx + dy * dy <= range * range) {
          const idx = cy * this.cols + cx;
          this.visible[idx] = 1;
          this.explored[idx] = 1;
        }
      }
    }
  }

  /** Render fog cells only within camera viewport */
  private render(cam: Phaser.Cameras.Scene2D.Camera): void {
    const g = this.fogGraphics;
    g.clear();

    const viewLeft = cam.scrollX - this.cellSize;
    const viewTop = cam.scrollY - this.cellSize;
    const viewRight = cam.scrollX + cam.width / cam.zoom + this.cellSize;
    const viewBottom = cam.scrollY + cam.height / cam.zoom + this.cellSize;

    const minCx = Math.max(0, Math.floor(viewLeft / this.cellSize));
    const maxCx = Math.min(this.cols - 1, Math.floor(viewRight / this.cellSize));
    const minCy = Math.max(0, Math.floor(viewTop / this.cellSize));
    const maxCy = Math.min(this.rows - 1, Math.floor(viewBottom / this.cellSize));

    // Batch by fog type for fewer style changes
    // Pass 1: explored (semi-transparent gray)
    g.fillStyle(0x0A1520, 0.5);
    for (let cy = minCy; cy <= maxCy; cy++) {
      for (let cx = minCx; cx <= maxCx; cx++) {
        const idx = cy * this.cols + cx;
        if (this.visible[idx] === 0 && this.explored[idx] === 1) {
          g.fillRect(cx * this.cellSize, cy * this.cellSize, this.cellSize, this.cellSize);
        }
      }
    }

    // Pass 2: hidden (near-black)
    g.fillStyle(0x050B14, 0.92);
    for (let cy = minCy; cy <= maxCy; cy++) {
      for (let cx = minCx; cx <= maxCx; cx++) {
        const idx = cy * this.cols + cx;
        if (this.explored[idx] === 0) {
          g.fillRect(cx * this.cellSize, cy * this.cellSize, this.cellSize, this.cellSize);
        }
      }
    }
  }

  destroy(): void {
    this.fogGraphics?.destroy();
  }
}
