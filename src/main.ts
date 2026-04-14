import Phaser from 'phaser';
import { gameConfig } from './config/GameConfig';

// Wait for fonts to be loaded so the first text isn't fallback serif
async function start() {
  if (document.fonts && document.fonts.ready) {
    try {
      await document.fonts.ready;
    } catch {}
  }
  new Phaser.Game(gameConfig);
  // Fade out the boot splash once Phaser has started
  setTimeout(() => {
    const el = document.getElementById('boot-splash');
    if (el) {
      el.classList.add('hidden');
      setTimeout(() => el.remove(), 700);
    }
  }, 200);
}
start();
