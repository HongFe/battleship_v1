# 🎨 Sprite Replacement Guide

현재 배들은 **Three.js 프로시저럴 메시** + **Canvas 2D 프로시저럴**로 그려져 있습니다.
나중에 이미지 에셋으로 교체할 때 이 가이드를 따르세요.

## 📐 2D Sprite (Phaser용 — HUD/미니맵/상점 프리뷰)

### 포맷
- **PNG**, 투명 배경
- 배가 **위를 향한 상태** (north-facing)
- Phaser가 rotation으로 회전시킴

### 추천 크기 (ship type별)

| Ship Type | 권장 크기 | 비고 |
|-----------|----------|------|
| Patrol (통통배) | 64 × 128 px | 가장 작음 |
| Destroyer | 80 × 200 px | |
| Cruiser | 100 × 240 px | |
| Battleship | 120 × 300 px | |
| Carrier | 140 × 340 px | 넓고 평평 |
| Submarine | 70 × 230 px | 가늘고 김 |
| Kraken | 160 × 320 px | 촉수 포함 |
| Phoenix | 130 × 280 px | 날개 포함 |
| Ghost Ship | 100 × 260 px | 반투명 효과 |
| Thunder | 130 × 300 px | |

### 파일 이름 규칙
```
public/textures/ships/{shipId}.png
```
예: `public/textures/ships/kraken.png`

### 적용 방법
1. PNG 파일을 `public/textures/ships/`에 넣음
2. `src/scenes/BootScene.ts`에서 로드:
```typescript
this.load.image('ship_kraken_custom', 'textures/ships/kraken.png');
```
3. `docs/balance.json`에서 spriteName 변경:
```json
"kraken": { ..., "spriteName": "ship_kraken_custom" }
```

## 🧊 3D Model (Three.js용)

### 포맷
- **GLB** (GLTF Binary) 추천
- Blender에서 export 가능

### 교체 방법
```typescript
// src/renderer/ShipMesh.ts에서
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const loader = new GLTFLoader();
loader.load('models/kraken.glb', (gltf) => {
  group.add(gltf.scene);
});
```

## 🖼 Sprite Sheet (여러 배 한 장에)

### 포맷
```
spritesheet.png (1024 x 2048)
spritesheet.json (좌표 데이터)
```

### JSON 형식
```json
{
  "frames": {
    "kraken": { "x": 0, "y": 0, "w": 160, "h": 320 },
    "phoenix": { "x": 160, "y": 0, "w": 130, "h": 280 },
    ...
  }
}
```

### Phaser 로드
```typescript
this.load.atlas('ships', 'textures/spritesheet.png', 'textures/spritesheet.json');
// 사용: this.add.image(x, y, 'ships', 'kraken');
```

## 🤖 AI 이미지 생성 프롬프트

### ChatGPT DALL-E용
```
Top-down view game sprite of a [ship type],
transparent background,
[size]px, dark naval color palette,
low-poly flat shading style,
single ship only, no text, no shadow,
centered in frame
```

### Midjourney용
```
/imagine top-down view battleship game sprite,
[ship description],
transparent background, pixel art style,
game asset, centered --ar 1:2 --v 6
```

### 예시: Kraken
```
Top-down view game sprite of a giant sea monster kraken ship,
tentacles extending from sides, single glowing yellow eye,
dark purple hull covered in barnacles,
transparent background, 160x320px,
low-poly game art style, centered
```
