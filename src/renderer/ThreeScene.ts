/**
 * Three.js 3D rendering layer.
 * Renders behind Phaser canvas — water, ships, lighting, particles.
 * Game logic stays 100% in Phaser; this is visual only.
 *
 * Coordinate mapping: Phaser (x,y) → Three (x, 0, y)
 *   Phaser X = Three X (horizontal)
 *   Phaser Y = Three Z (depth/vertical in top-down)
 *   Three Y = height (up)
 */

import * as THREE from 'three';
import { createWaterMaterial } from './WaterMaterial';
import { createShipMesh, ShipMeshType } from './ShipMesh';

const SCALE = 0.1; // Phaser pixels → Three.js units

export class ThreeScene {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private clock: THREE.Clock;
  private water!: THREE.Mesh;
  private waterMaterial!: THREE.ShaderMaterial;
  private shipMeshes: Map<number, THREE.Group> = new Map();
  private towerMeshes: Map<number, THREE.Mesh> = new Map();
  private distantIslands!: THREE.Group;
  private cloudLayer!: THREE.Group;
  private sunGlare!: THREE.Sprite;
  private canvas: HTMLCanvasElement;

  // Camera follow target (synced from Phaser player)
  private cameraTargetX: number = 0;
  private cameraTargetZ: number = 0;

  constructor() {
    // Create Three.js canvas BEHIND Phaser
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'three-canvas';
    this.canvas.style.position = 'fixed';
    this.canvas.style.top = '0';
    this.canvas.style.left = '0';
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.canvas.style.zIndex = '-1';
    document.body.prepend(this.canvas);

    // Renderer
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: false,
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    // Scene — 360° equirectangular skybox
    this.scene = new THREE.Scene();
    this.scene.background = this.createSkyGradient(); // fallback until HDR loads
    new THREE.TextureLoader().load('/textures/sky/clear_blue_sky.jpg', (tex) => {
      tex.mapping = THREE.EquirectangularReflectionMapping;
      tex.colorSpace = THREE.SRGBColorSpace;
      this.scene.background = tex;
      this.scene.environment = tex; // IBL reflections on any PBR material
    });
    this.scene.fog = new THREE.Fog(0x9FD3FF, 180, 360);

    // Camera — tilted top-down (2.5D feel)
    this.camera = new THREE.PerspectiveCamera(
      45,
      window.innerWidth / window.innerHeight,
      0.1,
      500,
    );
    // Camera position: higher up for wider view
    this.camera.position.set(0, 55, 28);
    this.camera.lookAt(0, 0, 0);

    this.clock = new THREE.Clock();

    this.setupLighting();
    this.setupWater();
    this.setupDistantIslands();
    this.setupClouds();
    this.setupSunGlare();

    // Handle resize
    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });
  }

  private setupLighting(): void {
    // Ambient — bright neutral fill (toon look needs flat, even lighting)
    const ambient = new THREE.AmbientLight(0xFFFBF0, 0.95);
    this.scene.add(ambient);

    // Hemisphere — MUCH weaker so blue sky doesn't wash out ship tops
    const hemi = new THREE.HemisphereLight(0xCFE8FF, 0xFFE0B0, 0.25);
    this.scene.add(hemi);

    // Key sun — clean white, punchy for Brawl Stars-style crisp shadows
    const sun = new THREE.DirectionalLight(0xFFF5D8, 2.2);
    sun.position.set(-30, 60, -20);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 140;
    sun.shadow.camera.left = -50;
    sun.shadow.camera.right = 50;
    sun.shadow.camera.top = 50;
    sun.shadow.camera.bottom = -50;
    sun.shadow.bias = -0.0005;
    sun.shadow.radius = 4;
    this.scene.add(sun);

    // Rim light — warm fill, opposite side, subtle so ship colors stay punchy
    const rim = new THREE.DirectionalLight(0xFFDCA8, 0.35);
    rim.position.set(30, 25, 25);
    this.scene.add(rim);
  }

  private createSkyGradient(): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = 16; c.height = 256;
    const ctx = c.getContext('2d')!;
    const g = ctx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, '#FFD8E8');   // soft pink top
    g.addColorStop(0.45, '#C8E6FF'); // pale sky blue
    g.addColorStop(1, '#A6E0D8');    // mint horizon
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 16, 256);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.mapping = THREE.EquirectangularReflectionMapping;
    return tex;
  }

  /** Ring of hazy low-poly islands on the distant horizon for depth. */
  private setupDistantIslands(): void {
    this.distantIslands = new THREE.Group();
    const radius = 180;
    const count = 9;
    const mat = new THREE.MeshBasicMaterial({
      color: 0x7FA8C8,
      fog: true,
      transparent: true,
      opacity: 0.85,
    });
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + Math.random() * 0.3;
      const r = radius + Math.random() * 40;
      const w = 18 + Math.random() * 28;
      const h = 4 + Math.random() * 6;
      const d = 12 + Math.random() * 18;
      // Stack a couple of boxes for silhouette variety
      const group = new THREE.Group();
      const base = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      base.position.y = h / 2;
      group.add(base);
      const peak = new THREE.Mesh(new THREE.ConeGeometry(w * 0.35, h * 1.4, 6), mat);
      peak.position.set((Math.random() - 0.5) * w * 0.3, h + h * 0.7, (Math.random() - 0.5) * d * 0.3);
      group.add(peak);
      group.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
      group.rotation.y = Math.random() * Math.PI;
      this.distantIslands.add(group);
    }
    this.scene.add(this.distantIslands);
  }

  /** Low-drift flat cloud billboards above the play area. */
  private setupClouds(): void {
    this.cloudLayer = new THREE.Group();
    const tex = this.makeCloudTexture();
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      fog: false,
    });
    for (let i = 0; i < 14; i++) {
      const size = 28 + Math.random() * 36;
      const geo = new THREE.PlaneGeometry(size, size * 0.55);
      const cloud = new THREE.Mesh(geo, mat);
      cloud.rotation.x = -Math.PI / 2;
      cloud.position.set(
        (Math.random() - 0.5) * 320,
        38 + Math.random() * 14,
        (Math.random() - 0.5) * 320,
      );
      (cloud.userData as Record<string, number>).drift = 0.6 + Math.random() * 0.8;
      this.cloudLayer.add(cloud);
    }
    this.scene.add(this.cloudLayer);
  }

  private makeCloudTexture(): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 128;
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, 256, 128);
    // Blob out a few overlapping soft circles for a puffy shape
    const blobs = [
      [60, 72, 38], [108, 58, 46], [160, 70, 42],
      [200, 80, 32], [82, 92, 28], [140, 96, 24],
    ] as const;
    for (const [x, y, r] of blobs) {
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(255,255,255,0.95)');
      g.addColorStop(0.6, 'rgba(255,255,255,0.55)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  /** Additive sun glare billboard — camera-facing, follows sun direction. */
  private setupSunGlare(): void {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const ctx = c.getContext('2d')!;
    const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
    g.addColorStop(0, 'rgba(255,240,200,1)');
    g.addColorStop(0.3, 'rgba(255,220,150,0.6)');
    g.addColorStop(1, 'rgba(255,200,100,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 256);
    const tex = new THREE.CanvasTexture(c);
    const mat = new THREE.SpriteMaterial({
      map: tex,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
      fog: false,
    });
    this.sunGlare = new THREE.Sprite(mat);
    this.sunGlare.scale.set(60, 60, 1);
    this.sunGlare.position.set(-90, 70, -60);
    this.scene.add(this.sunGlare);
  }

  private setupWater(): void {
    // Large water plane
    const waterGeo = new THREE.PlaneGeometry(300, 300, 220, 220);
    waterGeo.rotateX(-Math.PI / 2); // lay flat (XZ plane)
    this.waterMaterial = createWaterMaterial();
    this.water = new THREE.Mesh(waterGeo, this.waterMaterial);
    this.water.receiveShadow = true;
    this.scene.add(this.water);
  }

  /** Create or update a 3D ship mesh for a game entity */
  syncShip(id: number, x: number, y: number, heading: number, shipType: string, team: number, isDead: boolean): void {
    let mesh = this.shipMeshes.get(id);

    if (!mesh) {
      const type: ShipMeshType =
        shipType === 'kraken' ? 'kraken' :
        shipType === 'phoenix' ? 'phoenix' :
        shipType === 'ghostship' ? 'ghost' :
        shipType === 'thundership' ? 'thunder' :
        shipType.includes('battleship') || shipType.includes('yamato') || shipType.includes('iowa') ||
        shipType.includes('hood') || shipType.includes('pyotr') ? 'battleship' :
        shipType.includes('carrier') || shipType.includes('akagi') ? 'carrier' :
        shipType.includes('submarine') || shipType.includes('kursk') ? 'submarine' :
        shipType.includes('cruiser') || shipType.includes('medic') || shipType.includes('seawitch') ? 'cruiser' :
        shipType.includes('patrol') ? 'patrol' :
        'destroyer';

      mesh = createShipMesh(type, team, shipType);
      mesh.castShadow = true;
      this.scene.add(mesh);
      this.shipMeshes.set(id, mesh);
    }

    if (isDead) {
      mesh.visible = false;
      return;
    }

    mesh.visible = true;
    const tx = x * SCALE;
    const tz = y * SCALE;
    // Smooth lerp toward target position
    mesh.position.x += (tx - mesh.position.x) * 0.15;
    mesh.position.z += (tz - mesh.position.z) * 0.15;
    // Gentle bobbing on water
    mesh.position.y = Math.sin(this.clock.getElapsedTime() * 1.5 + id * 0.7) * 0.12;
    // Heading (Phaser heading 0=right, Three rotation around Y)
    mesh.rotation.y = -heading + Math.PI / 2;
    // Slight roll when turning
    const targetRoll = Math.sin(this.clock.getElapsedTime() * 0.8 + id) * 0.03;
    mesh.rotation.z = targetRoll;
  }

  /** Sync tower */
  syncTower(id: number, x: number, y: number, team: number, isNexus: boolean, isDead: boolean): void {
    let mesh = this.towerMeshes.get(id);
    if (!mesh) {
      const geo = isNexus
        ? new THREE.CylinderGeometry(1.5, 2, 3, 8)
        : new THREE.CylinderGeometry(0.8, 1.2, 2, 6);
      const color = team === 0 ? 0x6FB2FF : 0xFF7A7A;
      const mat = new THREE.MeshToonMaterial({ color });
      mesh = new THREE.Mesh(geo, mat);
      mesh.position.y = isNexus ? 1.5 : 1;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.scene.add(mesh);
      this.towerMeshes.set(id, mesh);
    }
    mesh.visible = !isDead;
    mesh.position.x = x * SCALE;
    mesh.position.z = y * SCALE;
  }

  /** Update camera to follow target */
  setCameraTarget(x: number, y: number): void {
    this.cameraTargetX = x * SCALE;
    this.cameraTargetZ = y * SCALE;
  }

  /** Spawn a simple explosion effect at position */
  spawnExplosion(x: number, y: number): void {
    const px = x * SCALE;
    const pz = y * SCALE;

    // Flash sphere
    const geo = new THREE.SphereGeometry(1, 8, 8);
    const mat = new THREE.MeshBasicMaterial({ color: 0xFF8833, transparent: true, opacity: 1 });
    const flash = new THREE.Mesh(geo, mat);
    flash.position.set(px, 1, pz);
    this.scene.add(flash);

    // Animate with clock
    const startTime = this.clock.getElapsedTime();
    const animate = () => {
      const elapsed = this.clock.getElapsedTime() - startTime;
      if (elapsed > 0.5) {
        this.scene.remove(flash);
        geo.dispose();
        mat.dispose();
        return;
      }
      flash.scale.setScalar(1 + elapsed * 6);
      mat.opacity = 1 - elapsed * 2;
      requestAnimationFrame(animate);
    };
    animate();
  }

  /** Main render loop — call from GameScene.update() */
  render(): void {
    const delta = this.clock.getDelta();
    const time = this.clock.getElapsedTime();

    // Update water shader time + camera (for specular/fresnel)
    if (this.waterMaterial.uniforms) {
      this.waterMaterial.uniforms['uTime'].value = time;
      this.waterMaterial.uniforms['uCamPos'].value.copy(this.camera.position);
    }

    // Move water plane to follow camera (infinite ocean feel)
    this.water.position.x = this.cameraTargetX;
    this.water.position.z = this.cameraTargetZ;

    // Distant islands & clouds & sun glare follow camera target so they stay on horizon
    this.distantIslands.position.x = this.cameraTargetX;
    this.distantIslands.position.z = this.cameraTargetZ;
    this.cloudLayer.position.x = this.cameraTargetX;
    this.cloudLayer.position.z = this.cameraTargetZ;
    this.sunGlare.position.set(this.cameraTargetX - 90, 70, this.cameraTargetZ - 60);

    // Drift clouds slowly
    for (const cloud of this.cloudLayer.children) {
      const drift = (cloud.userData as Record<string, number>).drift ?? 0.8;
      cloud.position.x -= delta * drift;
      // Wrap around when drifting too far
      if (cloud.position.x - this.cameraTargetX < -180) {
        cloud.position.x = this.cameraTargetX + 180;
        cloud.position.z = this.cameraTargetZ + (Math.random() - 0.5) * 320;
      }
    }

    // Smooth camera follow
    const camOffsetY = 55;
    const camOffsetZ = 28;
    this.camera.position.x += (this.cameraTargetX - this.camera.position.x) * 0.06;
    this.camera.position.z += (this.cameraTargetZ + camOffsetZ - this.camera.position.z) * 0.06;
    this.camera.position.y = camOffsetY;
    this.camera.lookAt(this.cameraTargetX, 0, this.cameraTargetZ);

    this.renderer.render(this.scene, this.camera);
  }

  destroy(): void {
    this.renderer.dispose();
    this.canvas.remove();
  }
}
