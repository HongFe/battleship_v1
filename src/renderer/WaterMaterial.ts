/**
 * Semi-realistic stylized water.
 * Vertex-displaced multi-octave waves + analytic normals, Blinn-Phong specular,
 * Fresnel edge glow, high-frequency micro ripples, and foam on crests.
 */

import * as THREE from 'three';

const vertexShader = /* glsl */ `
  uniform float uTime;
  varying vec2 vUv;
  varying float vWaveHeight;
  varying vec3 vWorldPos;
  varying vec3 vNormal;

  // Keep in sync with fragment sampler for consistent derivatives
  float waveSum(vec2 p, float t) {
    float w  = sin(p.x * 0.18 + t * 1.1) * 0.55;
          w += sin(p.y * 0.14 + t * 0.8) * 0.65;
          w += sin((p.x + p.y) * 0.10 + t * 1.4) * 0.45;
          w += sin((p.x * 1.3 - p.y * 0.7) * 0.22 + t * 1.8) * 0.25;
          w += sin((p.x * 0.6 + p.y * 1.1) * 0.33 + t * 2.2) * 0.18;
    return w;
  }

  void main() {
    vUv = uv;
    vec3 pos = position;

    // World XZ for consistent waves regardless of plane position
    vec2 wp = (modelMatrix * vec4(pos, 1.0)).xz;
    float h = waveSum(wp, uTime);

    // Finite-difference normal (proper lighting without per-vertex normal attribs)
    float e = 0.6;
    float hx = waveSum(wp + vec2(e, 0.0), uTime);
    float hz = waveSum(wp + vec2(0.0, e), uTime);
    vec3 n = normalize(vec3(h - hx, e, h - hz));

    pos.y = h;
    vWaveHeight = h;
    vWorldPos = (modelMatrix * vec4(pos, 1.0)).xyz;
    vNormal = n;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform float uTime;
  uniform vec3 uSunDir;
  uniform vec3 uCamPos;
  varying vec2 vUv;
  varying float vWaveHeight;
  varying vec3 vWorldPos;
  varying vec3 vNormal;

  // Cheap hash-based value noise for micro ripple normal detail
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p);
    float a = hash(i), b = hash(i + vec2(1,0));
    float c = hash(i + vec2(0,1)), d = hash(i + vec2(1,1));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }

  void main() {
    // Ocean palette — deeper, richer than before
    vec3 deepColor    = vec3(0.04, 0.18, 0.34);
    vec3 midColor     = vec3(0.10, 0.42, 0.62);
    vec3 shallowColor = vec3(0.35, 0.78, 0.92);
    vec3 foamColor    = vec3(1.00, 1.00, 0.97);

    // Depth-based base color from wave height
    float heightNorm = smoothstep(-0.6, 0.8, vWaveHeight);
    vec3 base = mix(deepColor, midColor, heightNorm);
    base = mix(base, shallowColor, heightNorm * heightNorm);

    // Micro ripple normal perturbation — two scrolling noise layers
    vec2 rp1 = vWorldPos.xz * 0.45 + vec2(uTime * 0.35, uTime * 0.25);
    vec2 rp2 = vWorldPos.xz * 0.95 + vec2(-uTime * 0.22, uTime * 0.31);
    float r1 = vnoise(rp1), r2 = vnoise(rp2);
    vec3 ripple = normalize(vec3((r1 - 0.5) * 0.9, 1.0, (r2 - 0.5) * 0.9));
    vec3 N = normalize(vNormal * 0.7 + ripple * 0.3);

    // Lighting — Blinn-Phong against sun
    vec3 L = normalize(uSunDir);
    vec3 V = normalize(uCamPos - vWorldPos);
    vec3 H = normalize(L + V);

    float diff = clamp(dot(N, L), 0.0, 1.0);
    float spec = pow(clamp(dot(N, H), 0.0, 1.0), 64.0);

    // Fresnel (Schlick) — brighter at grazing angles
    float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 3.0);

    vec3 sunCol = vec3(1.00, 0.95, 0.82);
    vec3 skyCol = vec3(0.62, 0.82, 1.00);

    vec3 color = base * (0.55 + 0.45 * diff);            // diffuse shading
    color = mix(color, skyCol, fres * 0.55);             // horizon / fresnel
    color += sunCol * spec * 1.8;                         // sun glints

    // Foam on wave crests + tiny sparkle variation
    float foamMask = smoothstep(0.55, 1.05, vWaveHeight);
    float foamNoise = vnoise(vWorldPos.xz * 1.2 + uTime * 0.4);
    color = mix(color, foamColor, foamMask * (0.6 + 0.4 * foamNoise));

    // Caustic-like high-frequency sparkle on peaks facing sun
    float glint = pow(max(0.0, dot(N, L)), 48.0) * smoothstep(0.2, 0.7, vWaveHeight);
    color += glint * vec3(1.0, 0.95, 0.78) * 0.9;

    gl_FragColor = vec4(color, 1.0);
  }
`;

export function createWaterMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime:   { value: 0 },
      uSunDir: { value: new THREE.Vector3(-0.4, 0.8, -0.3).normalize() },
      uCamPos: { value: new THREE.Vector3(0, 55, 28) },
    },
    vertexShader,
    fragmentShader,
    transparent: false,
    side: THREE.DoubleSide,
  });
}
