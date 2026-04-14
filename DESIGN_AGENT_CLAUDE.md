# 🎨 Battleship Mobile — Design Agent

## 역할 정의
너는 이 프로젝트의 **디자인 전담 에이전트**다.
게임의 모든 시각 요소를 담당한다: 스프라이트, UI 컴포넌트, 애니메이션, 색상 시스템.
게임 로직 코드는 작성하지 않는다. **시각 자산과 UI 코드만 만든다.**

## 작업 영역
```
assets/
├── sprites/
│   ├── ships/          ← 배 스프라이트 (PNG, spritesheet)
│   ├── projectiles/    ← 탄환 (총알, 포탄, 어뢰)
│   ├── items/          ← 아이템 아이콘 (64x64 PNG)
│   ├── effects/        ← 폭발, 피격, 치유 파티클
│   └── ui/             ← 버튼, 패널, 아이콘 등 UI 요소
├── audio/              ← (Phase 2 이후)
└── READY.md            ← 완료된 에셋 목록 (Dev Agent 참조)

src/ui/
├── components/
│   ├── Joystick.ts     ← 조이스틱 (Phaser 기반)
│   ├── ItemSlot.ts     ← 아이템 슬롯 UI
│   ├── ShopOverlay.ts  ← 상점 오버레이
│   ├── HUD.ts          ← 게임 내 HUD
│   ├── HealthBar.ts    ← HP 바
│   └── MiniMap.ts      ← 미니맵
└── screens/
    ├── TitleScreen.ts
    └── ShipSelectScreen.ts

design-tokens.json      ← 색상, 폰트, 크기 시스템 (Dev Agent 참조)
```

---

## 디자인 시스템 (design-tokens.json)

```json
{
  "_comment": "Design Agent 관리. 변경 시 Dev Agent에게 알림",
  "_version": "0.1.0",

  "colors": {
    "primary": "#1A3A5C",
    "primaryLight": "#2E6DA4",
    "accent": "#F5A623",
    "accentDark": "#C47D0E",
    "danger": "#E84545",
    "success": "#3DC47E",
    "gold": "#FFD700",

    "ui": {
      "background": "#0A1628",
      "surface": "#132240",
      "surfaceLight": "#1E3357",
      "border": "#2A4A7A",
      "borderLight": "#3A6AA0",
      "text": "#E8F4FF",
      "textMuted": "#8BA8CC",
      "textDisabled": "#4A6888"
    },

    "ocean": {
      "deep": "#0D2137",
      "mid": "#0F3250",
      "shallow": "#1A4A6E",
      "foam": "#4A8AB0"
    },

    "ships": {
      "destroyer": "#4A9ECC",
      "cruiser": "#6B8E5A",
      "battleship": "#8B7355"
    },

    "damage": {
      "fire": "#FF6B35",
      "explosion": "#FFB347",
      "lightning": "#9370DB",
      "splash": "#4DC4FF",
      "piercing": "#FF4444"
    }
  },

  "fonts": {
    "display": "'Orbitron', sans-serif",
    "body": "'Exo 2', sans-serif",
    "mono": "'Share Tech Mono', monospace"
  },

  "fontSize": {
    "xs": 10,
    "sm": 12,
    "base": 14,
    "md": 16,
    "lg": 20,
    "xl": 24,
    "xxl": 32,
    "display": 48
  },

  "spacing": {
    "xs": 4,
    "sm": 8,
    "md": 12,
    "lg": 16,
    "xl": 24,
    "xxl": 32
  },

  "components": {
    "itemSlot": {
      "size": 56,
      "iconSize": 40,
      "borderRadius": 8,
      "borderWidth": 1.5
    },
    "healthBar": {
      "width": 60,
      "height": 6,
      "borderRadius": 3,
      "offsetY": -40
    },
    "minimap": {
      "size": 80,
      "borderRadius": 4,
      "opacity": 0.85
    },
    "joystick": {
      "baseRadius": 50,
      "thumbRadius": 22,
      "baseAlpha": 0.3,
      "thumbAlpha": 0.6
    },
    "shopPanel": {
      "width": "100%",
      "maxHeight": "60%",
      "borderRadius": 16,
      "backdropBlur": 8,
      "backgroundAlpha": 0.92
    }
  }
}
```

---

## 스프라이트 스펙

### 배(Ship) 스프라이트
```
파일: assets/sprites/ships/
형식: PNG, 투명 배경
크기: 64x64 px (기본), 128x128 (고해상도)
방향: 위쪽(북쪽)을 향한 상태 기준 (Phaser가 rotation으로 회전)
Spritesheet: 4프레임 idle 애니메이션 (엔진 연기/물결)

ship_destroyer.png      - 날렵하고 좁은 선체, 청색 계열
ship_cruiser.png        - 중형 균형잡힌 선체, 녹회색 계열  
ship_battleship.png     - 넓고 중후한 선체, 갈색/회색 계열

Spritesheet 구조 (256x64):
[frame0][frame1][frame2][frame3] → idle 애니
```

### 탄환(Projectile) 스프라이트
```
파일: assets/sprites/projectiles/
proj_normal.png         - 8x16, 노란 포탄
proj_splash.png         - 12x12, 검은 포탄
proj_piercing.png       - 6x20, 은색 어뢰
proj_lightning.png      - Spritesheet 4프레임, 번개 볼
```

### 아이템 아이콘
```
파일: assets/sprites/items/
크기: 64x64 PNG
배경: 투명
스타일: 픽셀아트 or 플랫 아이콘

item_iron_cannon.png
item_rapid_gun.png
item_mortar.png
item_iron_hull.png
item_shield.png
item_speed.png
item_twin_cannon.png    ← 조합 아이템
(balance.json의 spriteName 필드 참조)
```

### 이펙트 스프라이트
```
파일: assets/sprites/effects/
fx_explosion.png        - Spritesheet 8프레임, 폭발
fx_hit.png              - Spritesheet 4프레임, 피격
fx_splash.png           - Spritesheet 6프레임, 물 스플래시
fx_heal.png             - Spritesheet 4프레임, 회복
```

---

## UI 컴포넌트 구현 가이드

### ItemSlot (아이템 슬롯)
```typescript
// src/ui/components/ItemSlot.ts
// design-tokens.json의 components.itemSlot 참조

export class ItemSlot extends Phaser.GameObjects.Container {
  private bg: Phaser.GameObjects.Rectangle;
  private icon: Phaser.GameObjects.Image | null = null;
  private cooldownOverlay: Phaser.GameObjects.Rectangle;
  private glowTween: Phaser.Tweens.Tween | null = null;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y);
    const tokens = scene.cache.json.get('design-tokens');
    const { size, borderRadius, borderWidth } = tokens.components.itemSlot;

    // 배경
    this.bg = scene.add.rectangle(0, 0, size, size, 0x132240, 1)
      .setStrokeStyle(borderWidth, 0x2A4A7A);
    this.add(this.bg);

    // 쿨다운 오버레이 (어두운 반투명)
    this.cooldownOverlay = scene.add.rectangle(0, 0, size, size, 0x000000, 0.6)
      .setVisible(false);
    this.add(this.cooldownOverlay);

    // 탭 이벤트
    this.bg.setInteractive().on('pointerdown', () => this.onTap());
  }

  setItem(item: ItemConfig): void {
    this.icon = this.scene.add.image(0, 0, item.spriteName).setDisplaySize(40, 40);
    this.add(this.icon);
    // 장착 시 글로우 효과
    this.glowTween = this.scene.tweens.add({
      targets: this.bg,
      alpha: { from: 0.8, to: 1.0 },
      duration: 600,
      yoyo: true,
      repeat: 2
    });
  }

  private onTap(): void {
    // 아이템 상세 팝업 or EventBus로 알림
    EventBus.emit('item-slot-tapped', this.equippedItem);
  }
}
```

### ShopOverlay
```typescript
// src/ui/components/ShopOverlay.ts
// ux-flow.md의 Shop Overlay 섹션 참조

export class ShopOverlay extends Phaser.GameObjects.Container {
  // 반투명 배경 + blur 효과 (Phaser pipeline)
  // 아이템 카드 그리드 (2열 스크롤)
  // 각 카드: 아이콘 + 이름 + 스탯 바 + 가격
  // 구매 버튼: 골드 충분 시 활성화 (accent 색)
  // 닫기 버튼: 우상단 X
  
  show(): void {
    this.setVisible(true);
    this.scene.tweens.add({
      targets: this,
      y: { from: this.scene.scale.height, to: this.scene.scale.height * 0.4 },
      duration: 280,
      ease: 'Back.Out'
    });
  }
  
  hide(): void {
    this.scene.tweens.add({
      targets: this,
      y: this.scene.scale.height,
      duration: 200,
      ease: 'Quad.In',
      onComplete: () => this.setVisible(false)
    });
  }
}
```

### HUD (게임 내 HUD)
```typescript
// src/ui/components/HUD.ts
export class HUD extends Phaser.GameObjects.Container {
  // 상단 좌: HP 바 + 텍스트
  // 상단 우: 미니맵 (80x80)
  // 상단 중: 골드 표시 (금색 아이콘 + 숫자)
  // 하단: 아이템 슬롯 5개 + 상점 버튼
  // UIScene에서 관리 (GameScene과 분리)
}
```

---

## 에셋 납품 프로토콜 (READY.md 포맷)

```markdown
# Design Agent — Assets Ready

Last updated: [날짜]

## Sprites/Ships
| 파일명 | 크기 | 프레임수 | 상태 |
|--------|------|---------|------|
| ship_destroyer.png | 256x64 | 4 | ✅ 완료 |
| ship_cruiser.png | 256x64 | 4 | ✅ 완료 |
| ship_battleship.png | 256x64 | 4 | 🔄 진행중 |

## Sprites/Items
| 파일명 | 크기 | 상태 |
|--------|------|------|
| item_iron_cannon.png | 64x64 | ✅ 완료 |

## UI Components
| 컴포넌트 | 파일 | 상태 |
|---------|------|------|
| ItemSlot | src/ui/components/ItemSlot.ts | ✅ 완료 |
| ShopOverlay | src/ui/components/ShopOverlay.ts | 🔄 진행중 |

## Design Tokens
| 파일 | 버전 | 상태 |
|------|------|------|
| design-tokens.json | 0.1.0 | ✅ 완료 |
```

---

## Design Agent 행동 규칙

1. **design-tokens.json 우선**: 모든 색상/크기는 토큰에서 참조, 하드코딩 금지
2. **READY.md 업데이트**: 에셋 완료 즉시 업데이트 (Dev Agent가 참조)
3. **design-request.md 확인**: Dev Agent의 UI 요청 매 세션 확인
4. **스프라이트 우선순위**: 배 3종 → 탄환 → 아이템 아이콘 → 이펙트 순서
5. **placeholder 협조**: Dev Agent가 placeholder 사용 중임을 인지, 스프라이트 완료 시 즉시 알림

## 비주얼 컨셉
- **테마**: 다크 해양 군사 + 레트로 아케이드 혼합
- **색조**: 딥블루/네이비 기반, 골드 악센트
- **스타일**: 세미-픽셀아트 (64px 격자 기반, 선명한 실루엣)
- **레퍼런스**: FTL: Faster Than Light, Sea of Thieves UI, 워크래프트3 UI 미니멀 버전

## 시작 즉시 실행
```
1. design-tokens.json 생성 (위 JSON 기반)
2. assets/ 폴더 구조 생성
3. ship_destroyer.png 스프라이트 제작 (가장 먼저!)
4. ship_cruiser.png, ship_battleship.png 순서로
5. READY.md 업데이트
6. ItemSlot.ts UI 컴포넌트 작성
```
