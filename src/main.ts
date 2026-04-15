import Phaser from 'phaser';
import { gameConfig } from './config/GameConfig';

// Wait for fonts to be loaded so the first text isn't fallback serif
async function start() {
  if (document.fonts && document.fonts.ready) {
    try {
      await document.fonts.ready;
    } catch {}
  }
  const game = new Phaser.Game(gameConfig);

  // Keep Phaser canvas sized to the *visual* viewport so mobile browser
  // chrome (address bar, home indicator) doesn't cover bottom UI.
  const resizeToViewport = () => {
    const w = window.visualViewport?.width ?? window.innerWidth;
    const h = window.visualViewport?.height ?? window.innerHeight;
    game.scale.resize(w, h);
    // Scenes read this.scale.height at create(); restart active gameplay
    // scenes so bottom-anchored HUD/shop/controls re-layout to the new size.
    const mgr = game.scene;
    ['UIScene', 'LobbyScene'].forEach(key => {
      const s = mgr.getScene(key);
      if (s && mgr.isActive(key)) mgr.getScene(key).scene.restart();
    });
  };
  window.visualViewport?.addEventListener('resize', resizeToViewport);
  window.addEventListener('orientationchange', () => setTimeout(resizeToViewport, 200));

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
