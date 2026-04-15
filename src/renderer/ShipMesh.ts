/**
 * Low-poly ship mesh factory — UPGRADED version.
 * Ships = detailed geometry blocks with proper silhouettes.
 * Minecraft-esque but with more shape variety.
 *
 * Easy to swap out later: just replace createShipMesh() return
 * with a loaded GLTF/OBJ model.
 */

import * as THREE from 'three';

export type ShipMeshType = 'patrol' | 'destroyer' | 'cruiser' | 'battleship' | 'carrier' | 'submarine' | 'phoenix' | 'ghost' | 'kraken' | 'thunder';

/** Nation/team color palettes — pastel/vibrant cartoon tones */
function getTeamColors(team: number) {
  // Brawl Stars-style: high-saturation, poster-like hues
  if (team === 0) return { hull: 0x2C7FE8, deck: 0x1A4FB8, accent: 0xFFE066, metal: 0xB8C8E0 };
  if (team === 1) return { hull: 0xE83838, deck: 0xA81818, accent: 0xFFD24D, metal: 0xE0B8B8 };
  return { hull: 0xE8B040, deck: 0x8A5A1A, accent: 0xFFF0B0, metal: 0xC8A878 };
}

// Shared 3-band gradient for crisp cartoon banding
let _toonGrad: THREE.DataTexture | null = null;
function getToonGradient(): THREE.DataTexture {
  if (_toonGrad) return _toonGrad;
  // 2-step hard band — Brawl Stars-style crisp cel shade
  const data = new Uint8Array([110, 110, 110, 255, 255, 255, 255, 255]);
  const tex = new THREE.DataTexture(data, 2, 1, THREE.RGBAFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  _toonGrad = tex;
  return tex;
}

function mat(color: number, opts?: {
  metalness?: number; roughness?: number; emissive?: number;
  opacity?: number; emissiveIntensity?: number;
}): THREE.MeshToonMaterial {
  // Tiny self-emissive tint keeps ships saturated against the blue fog/sky
  const defaultEmissive = opts?.emissive ?? color;
  const m = new THREE.MeshToonMaterial({
    color,
    gradientMap: getToonGradient(),
    emissive: defaultEmissive,
    emissiveIntensity: opts?.emissiveIntensity ?? 0.12,
    transparent: (opts?.opacity ?? 1) < 1,
    opacity: opts?.opacity ?? 1,
  });
  return m;
}

/** Tapered hull shape (wider at center, narrow at bow/stern) */
function createHullShape(length: number, width: number, height: number, bowTaper = 0.3): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  const hw = width / 2;
  const hl = length / 2;
  const bt = hl * bowTaper;

  // Hull cross-section (top-down shape, extruded for height)
  shape.moveTo(0, hl);           // bow tip
  shape.lineTo(hw, hl - bt);     // bow right
  shape.lineTo(hw, -hl + bt);    // stern right
  shape.lineTo(hw * 0.8, -hl);   // stern right corner
  shape.lineTo(-hw * 0.8, -hl);  // stern left corner
  shape.lineTo(-hw, -hl + bt);   // stern left
  shape.lineTo(-hw, hl - bt);    // bow left
  shape.closePath();

  const extrudeSettings = { depth: height, bevelEnabled: false };
  const geo = new THREE.ExtrudeGeometry(shape, extrudeSettings);
  // Rotate so Y is up
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, height / 2, 0);
  return geo;
}

/** Add turret group (base + twin barrels) */
function addTurret(group: THREE.Group, x: number, y: number, z: number, size: number, metalColor: number): void {
  // Turret base (octagonal cylinder)
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(size, size * 1.1, size * 0.4, 8),
    mat(metalColor, { metalness: 0.6, roughness: 0.3 }),
  );
  base.position.set(x, y, z);
  group.add(base);

  // Twin barrels
  const barrelLen = size * 2.8;
  const barrelR = size * 0.12;
  [-size * 0.25, size * 0.25].forEach(offset => {
    const barrel = new THREE.Mesh(
      new THREE.CylinderGeometry(barrelR, barrelR, barrelLen, 6),
      mat(0x2A2A2A, { metalness: 0.7, roughness: 0.2 }),
    );
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(x + offset, y + size * 0.15, z + barrelLen / 2);
    group.add(barrel);
  });
}

/** Add mast/antenna tower */
function addMast(group: THREE.Group, x: number, baseY: number, z: number, height: number): void {
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.03, 0.05, height, 4),
    mat(0x555555, { metalness: 0.5 }),
  );
  pole.position.set(x, baseY + height / 2, z);
  group.add(pole);

  // Cross beam
  const beam = new THREE.Mesh(
    new THREE.BoxGeometry(0.6, 0.03, 0.03),
    mat(0x444444),
  );
  beam.position.set(x, baseY + height * 0.7, z);
  group.add(beam);

  // Radar dish (small sphere)
  const dish = new THREE.Mesh(
    new THREE.SphereGeometry(0.08, 6, 4),
    mat(0x888888, { metalness: 0.6 }),
  );
  dish.position.set(x, baseY + height, z);
  group.add(dish);
}

/** Add smoke stack */
function addStack(group: THREE.Group, x: number, baseY: number, z: number, radius: number, height: number): void {
  const stack = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 0.8, radius, height, 6),
    mat(0x3A3A3A, { metalness: 0.3 }),
  );
  stack.position.set(x, baseY + height / 2, z);
  group.add(stack);

  // Soot cap
  const cap = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 0.9, radius * 0.8, height * 0.15, 6),
    mat(0x111111),
  );
  cap.position.set(x, baseY + height, z);
  group.add(cap);
}

/**
 * Attempt to load a Brawl Stars-style top-down PNG for this shipId.
 * When the texture exists (drop files into /public/textures/ships_gen/), we
 * overlay it as a flat deck billboard on top of the 3D hull. Missing files
 * fail silently and we keep the pure-geometry look.
 */
const _texCache = new Map<string, THREE.Texture | null>();
function tryLoadTopdownTexture(shipId: string, group: THREE.Group, footprint: { length: number; width: number; y: number }): void {
  if (_texCache.has(shipId)) {
    const cached = _texCache.get(shipId);
    if (cached) attachTopdownPlane(group, cached, footprint);
    return;
  }
  const url = `/textures/ships_gen/${shipId}.png`;
  new THREE.TextureLoader().load(
    url,
    (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.magFilter = THREE.LinearFilter;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.anisotropy = 8;
      _texCache.set(shipId, tex);
      attachTopdownPlane(group, tex, footprint);
    },
    undefined,
    () => { _texCache.set(shipId, null); },
  );
}

function attachTopdownPlane(group: THREE.Group, tex: THREE.Texture, fp: { length: number; width: number; y: number }): void {
  // Painted plane fully replaces the 3D silhouette from the top-down view.
  // Upscale generously (×2.2) to cover turrets/bridge that sit above the hull.
  // rotateX(-π/2) puts plane flat in XZ with normal +Y; texture +V → world -Z
  // which matches the ship's bow direction in local space.
  const geo = new THREE.PlaneGeometry(fp.width * 2.2, fp.length * 2.2);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    alphaTest: 0.12,
    depthTest: false, // always draw over 3D ship parts below
    depthWrite: false,
    fog: false,
  });
  const plane = new THREE.Mesh(geo, mat);
  // Float above the tallest superstructure so nothing peeks through the edges
  plane.position.y = fp.y + 2.5;
  plane.renderOrder = 10;
  plane.name = 'topdownPainted';
  group.add(plane);
}

export function createShipMesh(type: ShipMeshType, team: number, shipId?: string): THREE.Group {
  const c = getTeamColors(team);
  const group = new THREE.Group();

  switch (type) {
    case 'patrol': {
      // === 통통배: small wooden fishing boat ===
      const hull = new THREE.Mesh(createHullShape(2.2, 0.9, 0.3, 0.4), mat(0x7A5030));
      group.add(hull);
      // Cabin
      const cabin = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.4, 0.6), mat(0xEEDDBB));
      cabin.position.set(0, 0.5, -0.2);
      group.add(cabin);
      // Cabin roof
      const roof = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.06, 0.65), mat(0x8B6B3A));
      roof.position.set(0, 0.72, -0.2);
      group.add(roof);
      // Motor
      const motor = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.25, 0.3), mat(0x2A2A2A, { metalness: 0.5 }));
      motor.position.set(0, 0.2, -1.0);
      group.add(motor);
      break;
    }

    case 'destroyer': {
      // === Sleek modern destroyer ===
      const hull = new THREE.Mesh(createHullShape(3.5, 1.1, 0.35, 0.35), mat(c.hull));
      group.add(hull);
      // Deck plate
      const deck = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.04, 2.8), mat(c.deck));
      deck.position.set(0, 0.37, 0);
      group.add(deck);
      // Bridge
      const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.55, 0.9), mat(c.metal));
      bridge.position.set(0, 0.65, -0.3);
      group.add(bridge);
      // Bridge windows
      const windows = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.08, 0.5), mat(0x1A2A3A, { emissive: 0x0A1520 }));
      windows.position.set(0, 0.75, -0.1);
      group.add(windows);
      addMast(group, 0, 0.9, -0.3, 1.0);
      addTurret(group, 0, 0.42, 0.9, 0.22, c.metal);
      addStack(group, 0, 0.5, 0.2, 0.12, 0.4);
      break;
    }

    case 'cruiser': {
      // === Heavy cruiser ===
      const hull = new THREE.Mesh(createHullShape(4.0, 1.4, 0.4, 0.3), mat(c.hull));
      group.add(hull);
      const deck = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.04, 3.2), mat(c.deck));
      deck.position.set(0, 0.42, 0);
      group.add(deck);
      // Large bridge
      const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.7, 1.1), mat(c.metal));
      bridge.position.set(0, 0.75, -0.2);
      group.add(bridge);
      const windows = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.08, 0.6), mat(0x1A2A3A));
      windows.position.set(0, 0.9, 0);
      group.add(windows);
      addMast(group, 0, 1.1, -0.2, 1.2);
      addTurret(group, 0, 0.46, 1.2, 0.28, c.metal);
      addTurret(group, 0, 0.46, -1.4, 0.24, c.metal);
      addStack(group, -0.15, 0.55, 0.3, 0.13, 0.45);
      addStack(group, 0.15, 0.55, 0.3, 0.13, 0.45);
      break;
    }

    case 'battleship': {
      // === Massive dreadnought ===
      const hull = new THREE.Mesh(createHullShape(5.5, 1.9, 0.5, 0.25), mat(c.hull));
      group.add(hull);
      const deck = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.04, 4.5), mat(c.deck));
      deck.position.set(0, 0.52, 0);
      group.add(deck);
      // Massive command tower
      const tower = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.3, 1.5), mat(c.metal));
      tower.position.set(0, 1.0, -0.3);
      group.add(tower);
      // Tower windows (multiple rows)
      for (let i = 0; i < 3; i++) {
        const win = new THREE.Mesh(new THREE.BoxGeometry(1.02, 0.06, 0.5), mat(0x0F1A28));
        win.position.set(0, 0.6 + i * 0.2, -0.1);
        group.add(win);
      }
      addMast(group, 0, 1.65, -0.3, 1.5);
      // 3 main turrets
      addTurret(group, 0, 0.56, 2.0, 0.38, c.metal);
      addTurret(group, 0, 0.56, 1.2, 0.34, c.metal);
      addTurret(group, 0, 0.56, -2.0, 0.32, c.metal);
      // Side secondary turrets
      addTurret(group, -0.7, 0.48, 0.5, 0.15, c.metal);
      addTurret(group, 0.7, 0.48, 0.5, 0.15, c.metal);
      addStack(group, 0, 0.7, 0.3, 0.18, 0.6);
      break;
    }

    case 'carrier': {
      // === Aircraft carrier — flat deck with island ===
      const hull = new THREE.Mesh(createHullShape(6.0, 2.3, 0.35, 0.2), mat(0x3A4248));
      group.add(hull);
      // Flight deck (dark)
      const flightDeck = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.06, 5.5), mat(0x1A1F24));
      flightDeck.position.set(0, 0.38, 0);
      group.add(flightDeck);
      // Center line (yellow)
      const centerLine = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.07, 5.0), mat(0xD4A847, { emissive: 0x442200 }));
      centerLine.position.set(0, 0.41, 0);
      group.add(centerLine);
      // Dashed markings
      for (let i = -4; i <= 4; i += 2) {
        const dash = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.072, 0.3), mat(0xFFFFFF));
        dash.position.set(0, 0.42, i * 0.5);
        group.add(dash);
      }
      // Island superstructure (right side)
      const island = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.9, 1.2), mat(0x556068));
      island.position.set(0.85, 0.8, 0);
      group.add(island);
      const islandWin = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.06, 0.5), mat(0x0F1A28));
      islandWin.position.set(0.85, 1.0, 0.1);
      group.add(islandWin);
      addMast(group, 0.85, 1.25, 0, 0.8);
      // Aircraft on deck (tiny flat boxes)
      const planeMat = mat(0x888888, { metalness: 0.4 });
      [[-0.3, 1.5], [-0.3, -1.5], [-0.3, 0.5], [0.3, -0.5]].forEach(([px, pz]) => {
        const plane = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.04, 0.2), planeMat);
        plane.position.set(px, 0.42, pz);
        group.add(plane);
        // Wings
        const wing = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.03, 0.5), planeMat);
        wing.position.set(px, 0.44, pz);
        group.add(wing);
      });
      break;
    }

    case 'submarine': {
      // === Sleek submarine ===
      const hull = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.4, 3.0, 4, 8),
        mat(0x1A2028, { metalness: 0.4, roughness: 0.5 }),
      );
      hull.rotation.x = Math.PI / 2;
      hull.position.y = 0;
      group.add(hull);
      // Conning tower
      const tower = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.5, 0.5), mat(0x2A3038));
      tower.position.set(0, 0.35, 0);
      group.add(tower);
      // Periscope
      const peri = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.6, 4), mat(0x666666));
      peri.position.set(0, 0.65, 0);
      group.add(peri);
      // Diving planes (small fins)
      [-1, 1].forEach(side => {
        const fin = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.04, 0.15), mat(0x1A2028));
        fin.position.set(side * 0.45, 0, 0.8);
        group.add(fin);
      });
      break;
    }

    case 'phoenix': {
      // === Phoenix — burning ship, emissive glow ===
      const hull = new THREE.Mesh(createHullShape(4.2, 1.5, 0.4, 0.35), mat(0x882222, { emissive: 0x331100, emissiveIntensity: 0.5 }));
      group.add(hull);
      // Fire core (glowing sphere)
      const core = new THREE.Mesh(
        new THREE.SphereGeometry(0.6, 8, 8),
        mat(0xFF6622, { emissive: 0xFF4400, emissiveIntensity: 2, metalness: 0, roughness: 0.3 }),
      );
      core.position.set(0, 0.8, 0);
      group.add(core);
      // Inner glow ring
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.8, 0.08, 6, 12),
        mat(0xFF8844, { emissive: 0xFF4400, emissiveIntensity: 1.5, opacity: 0.7 }),
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.set(0, 0.5, 0);
      group.add(ring);
      // Wing-like fins
      [-1, 1].forEach(side => {
        const fin = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.08, 1.5), mat(0xAA3322, { emissive: 0x441100 }));
        fin.position.set(side * 0.8, 0.35, -0.3);
        fin.rotation.z = side * 0.3;
        group.add(fin);
      });
      addTurret(group, 0, 0.5, 1.3, 0.25, 0x555555);
      addTurret(group, 0, 0.5, -1.3, 0.25, 0x555555);
      break;
    }

    case 'ghost': {
      // === Ghost Ship — translucent, eerie ===
      const hull = new THREE.Mesh(
        createHullShape(3.8, 1.3, 0.35, 0.4),
        mat(0x2A3A30, { emissive: 0x112218, opacity: 0.6 }),
      );
      group.add(hull);
      // Ghost glow core
      const glow = new THREE.Mesh(
        new THREE.SphereGeometry(0.5, 8, 6),
        mat(0x44FF88, { emissive: 0x22CC44, emissiveIntensity: 2, metalness: 0, opacity: 0.5 }),
      );
      glow.position.set(0, 0.6, 0);
      group.add(glow);
      // Tattered masts (thin, crooked)
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.05, 1.5, 4), mat(0x3A2A1A, { opacity: 0.7 }));
      mast.position.set(0, 1.0, 0.3);
      mast.rotation.z = 0.1;
      group.add(mast);
      const mast2 = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.05, 1.2, 4), mat(0x3A2A1A, { opacity: 0.6 }));
      mast2.position.set(0, 0.9, -0.5);
      mast2.rotation.z = -0.15;
      group.add(mast2);
      // Tattered sail (semi-transparent plane)
      const sail = new THREE.Mesh(
        new THREE.PlaneGeometry(0.8, 0.6),
        mat(0x5A6A50, { opacity: 0.4 }),
      );
      sail.position.set(0, 1.2, 0.3);
      group.add(sail);
      break;
    }

    case 'kraken': {
      // === Kraken — sea monster ship, organic ===
      const hull = new THREE.Mesh(createHullShape(5.0, 2.2, 0.6, 0.2), mat(0x2A1A30, { roughness: 0.8 }));
      group.add(hull);
      // Eye (center dome)
      const eye = new THREE.Mesh(
        new THREE.SphereGeometry(0.5, 8, 8),
        mat(0xFFDD00, { emissive: 0xAA8800, emissiveIntensity: 1.5, metalness: 0 }),
      );
      eye.position.set(0, 0.8, 0.5);
      group.add(eye);
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.2, 6, 6), mat(0x000000));
      pupil.position.set(0, 0.9, 0.7);
      group.add(pupil);
      // Tentacles (curved cylinders at sides)
      for (let i = 0; i < 6; i++) {
        const side = i < 3 ? -1 : 1;
        const idx = i % 3;
        const tentacle = new THREE.Mesh(
          new THREE.CylinderGeometry(0.08, 0.15, 2.0, 6),
          mat(0x4A2A5A, { roughness: 0.9 }),
        );
        tentacle.position.set(side * 1.0, 0.3, -0.5 + idx * 1.0);
        tentacle.rotation.z = side * 0.6;
        tentacle.rotation.x = 0.3 - idx * 0.15;
        group.add(tentacle);
      }
      // Barnacles
      for (let i = 0; i < 8; i++) {
        const barn = new THREE.Mesh(
          new THREE.SphereGeometry(0.08, 4, 4),
          mat(0x6A5A4A),
        );
        barn.position.set(
          (Math.random() - 0.5) * 1.8,
          0.35 + Math.random() * 0.2,
          (Math.random() - 0.5) * 3,
        );
        group.add(barn);
      }
      break;
    }

    case 'thunder': {
      // === Zeus Thunder Ship — electric, metallic ===
      const hull = new THREE.Mesh(createHullShape(5.0, 1.8, 0.45, 0.3), mat(0x3A4050, { metalness: 0.5 }));
      group.add(hull);
      const deck = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.04, 4.0), mat(0x2A3040));
      deck.position.set(0, 0.47, 0);
      group.add(deck);
      // Tesla coil tower (center)
      const coil = new THREE.Mesh(
        new THREE.CylinderGeometry(0.15, 0.25, 1.5, 8),
        mat(0x888899, { metalness: 0.7, roughness: 0.2 }),
      );
      coil.position.set(0, 1.0, 0);
      group.add(coil);
      // Electric orb at top
      const orb = new THREE.Mesh(
        new THREE.SphereGeometry(0.25, 8, 8),
        mat(0x9999FF, { emissive: 0x6666FF, emissiveIntensity: 3, metalness: 0 }),
      );
      orb.position.set(0, 1.8, 0);
      group.add(orb);
      // Lightning rods (4 corners)
      [-0.6, 0.6].forEach(x => {
        [-1, 1].forEach(z => {
          const rod = new THREE.Mesh(
            new THREE.CylinderGeometry(0.02, 0.04, 0.8, 4),
            mat(0x777788, { metalness: 0.6 }),
          );
          rod.position.set(x, 0.8, z * 1.5);
          group.add(rod);
        });
      });
      addTurret(group, 0, 0.5, 1.8, 0.3, 0x555566);
      addTurret(group, 0, 0.5, -1.8, 0.3, 0x555566);
      addTurret(group, -0.65, 0.48, 0.5, 0.18, 0x555566);
      addTurret(group, 0.65, 0.48, 0.5, 0.18, 0x555566);
      break;
    }

    default: {
      const hull = new THREE.Mesh(createHullShape(3.0, 1.0, 0.35), mat(c.hull));
      group.add(hull);
      addTurret(group, 0, 0.42, 0.6, 0.2, c.metal);
    }
  }

  // Apply shadow settings + cartoon outline (back-face hull) to all meshes
  const outlineMat = new THREE.MeshBasicMaterial({
    color: 0x08101C,
    side: THREE.BackSide,
    fog: false, // keep outline crisp so ships don't blend into sky haze
  });
  const meshes: THREE.Mesh[] = [];
  group.traverse(child => {
    const m = child as THREE.Mesh;
    if (m.isMesh) {
      m.castShadow = true;
      m.receiveShadow = true;
      meshes.push(m);
    }
  });
  meshes.forEach(m => {
    // Skip outline on the painted top-down plane (would double-darken)
    if (m.name === 'topdownPainted') return;
    const outline = new THREE.Mesh(m.geometry, outlineMat);
    outline.position.copy(m.position);
    outline.rotation.copy(m.rotation);
    outline.scale.copy(m.scale).multiplyScalar(1.09);
    outline.castShadow = false;
    outline.receiveShadow = false;
    group.add(outline);
  });

  // Attempt to overlay a Brawl Stars-style painted top-down texture if available.
  if (shipId) {
    const footprint = getFootprint(type);
    tryLoadTopdownTexture(shipId, group, footprint);
  }

  return group;
}

/** Rough bounding footprint per mesh archetype for the top-down paint plane. */
function getFootprint(type: ShipMeshType): { length: number; width: number; y: number } {
  switch (type) {
    case 'patrol':    return { length: 2.6, width: 1.1, y: 0.75 };
    case 'destroyer': return { length: 4.0, width: 1.3, y: 0.90 };
    case 'cruiser':   return { length: 4.8, width: 1.5, y: 1.00 };
    case 'battleship':return { length: 6.2, width: 1.9, y: 1.20 };
    case 'carrier':   return { length: 6.6, width: 2.1, y: 1.10 };
    case 'submarine': return { length: 4.4, width: 1.2, y: 0.50 };
    case 'phoenix':   return { length: 5.0, width: 1.8, y: 1.10 };
    case 'ghost':     return { length: 4.8, width: 1.6, y: 1.00 };
    case 'kraken':    return { length: 6.4, width: 2.2, y: 1.00 };
    case 'thunder':   return { length: 5.2, width: 1.7, y: 1.10 };
    default:          return { length: 4.0, width: 1.4, y: 1.00 };
  }
}
