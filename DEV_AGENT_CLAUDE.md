# ⚙️ Battleship Mobile — Dev Agent

## 역할 정의
너는 이 프로젝트의 **개발 전담 에이전트**다.
Phaser 3 + TypeScript로 게임 로직 전체를 구현한다.
디자인 결정이나 스펙 변경은 하지 않는다. **코드만 작성한다.**

## 기술 스택
- **엔진**: Phaser 3.70+
- **언어**: TypeScript 5.x (strict mode)
- **빌드**: Vite 5.x
- **패키지**: npm
- **타겟**: 모바일 웹 (PWA), 60fps 목표

## 작업 영역
```
src/
├── config/
│   ├── types.ts          ← 공유 타입 (Design/Planning 참조)
│   └── GameConfig.ts     ← Phaser 설정
├── scenes/
│   ├── BootScene.ts      ← 에셋 로드
│   ├── TitleScene.ts
│   ├── ShipSelectScene.ts
│   ├── GameScene.ts      ← 메인 게임
│   └── UIScene.ts        ← HUD (overlay)
├── entities/
│   ├── Ship.ts           ← 플레이어/봇 배
│   ├── Projectile.ts     ← 탄환
│   ├── Creep.ts          ← AI 크립
│   └── Pickup.ts         ← 골드 드롭
├── systems/
│   ├── AutoAttackSystem.ts   ← 자동 공격 핵심
│   ├── ItemSystem.ts         ← 아이템 장착/효과
│   ├── EconomySystem.ts      ← 골드 관리
│   ├── SafeZoneSystem.ts     ← 안전지대
│   └── InputSystem.ts        ← 터치/조이스틱
├── ui/
│   ├── Joystick.ts
│   ├── ItemSlot.ts
│   ├── ShopOverlay.ts
│   └── HUD.ts
└── utils/
    ├── SpatialGrid.ts    ← 공간 분할 (성능 최적화)
    └── EventBus.ts       ← 씬 간 이벤트
```

---

## 핵심 타입 정의 (types.ts — 반드시 먼저 작성)

```typescript
// src/config/types.ts
// ⚠️ Planning Agent의 balance.json과 키 이름 일치 필수

export type ProjectileType = 'normal' | 'splash' | 'piercing' | 'lightning' | 'homing';
export type ItemType = 'weapon' | 'armor' | 'special';
export type ShipId = 'destroyer' | 'cruiser' | 'battleship';

export interface ShipConfig {
  id: ShipId;
  displayName: string;
  hp: number;
  speed: number;
  armor: number;
  slots: { weapon: number; armor: number; special: number };
  spriteName: string;
}

export interface WeaponItemConfig {
  id: string;
  displayName: string;
  type: 'weapon';
  damage: number;
  range: number;
  attackSpeed: number;       // 초당 발사 횟수
  projectileType: ProjectileType;
  projectileSpeed: number;
  splashRadius: number;
  cost: number;
  spriteName: string;
  description: string;
}

export interface ArmorItemConfig {
  id: string;
  displayName: string;
  type: 'armor';
  armorBonus: number;
  hpBonus: number;
  effect: string | null;
  effectParams?: Record<string, number>;
  cost: number;
  spriteName: string;
  description: string;
}

export interface SpecialItemConfig {
  id: string;
  displayName: string;
  type: 'special';
  speedMultiplier?: number;
  cost: number;
  spriteName: string;
  description: string;
}

export type ItemConfig = WeaponItemConfig | ArmorItemConfig | SpecialItemConfig;

export interface RecipeConfig {
  id: string;
  displayName: string;
  ingredients: string[];
  resultItem: Omit<WeaponItemConfig, 'id' | 'displayName' | 'cost'>;
}

export interface BalanceConfig {
  ships: Record<ShipId, ShipConfig>;
  items: Record<string, ItemConfig>;
  recipes: RecipeConfig[];
  economy: {
    startingGold: number;
    creepKillGold: number;
    shipKillGold: number;
    passiveGoldPerInterval: number;
    passiveGoldInterval: number;
  };
  map: {
    worldWidth: number;
    worldHeight: number;
    safeZoneInitialRadius: number;
    safeZoneShrinkStart: number;
    safeZoneShrinkInterval: number;
    safeZoneShrinkAmount: number;
    safeZoneDamagePerSecond: number;
    creepSpawnInterval: number;
    creepHp: number;
    creepSpeed: number;
  };
}
```

---

## Ship 클래스 구현 가이드

```typescript
// src/entities/Ship.ts
export class Ship extends Phaser.Physics.Arcade.Sprite {
  // 장착된 아이템
  private equippedWeapons: WeaponItemConfig[] = [];
  private equippedArmors: ArmorItemConfig[] = [];
  private equippedSpecials: SpecialItemConfig[] = [];

  // 파생 스탯 (장착 후 계산)
  public get totalDamage(): number {
    return this.equippedWeapons.reduce((sum, w) => sum + w.damage, 0);
  }
  public get maxRange(): number {
    return Math.max(...this.equippedWeapons.map(w => w.range), 0);
  }
  public get totalArmor(): number {
    return this.config.armor + 
           this.equippedArmors.reduce((sum, a) => sum + a.armorBonus, 0);
  }
  public get effectiveSpeed(): number {
    const multiplier = this.equippedSpecials
      .filter(s => s.speedMultiplier)
      .reduce((m, s) => m * (s.speedMultiplier ?? 1), 1);
    return this.config.speed * multiplier;
  }

  // 아이템 장착 (슬롯 체크 포함)
  equipItem(item: ItemConfig): boolean {
    const slots = this.config.slots;
    if (item.type === 'weapon' && this.equippedWeapons.length < slots.weapon) {
      this.equippedWeapons.push(item as WeaponItemConfig);
      return true;
    }
    // ... armor, special 동일
    return false;
  }

  // 피해 계산 (방어력 적용)
  takeDamage(rawDamage: number): void {
    const reduced = Math.max(1, rawDamage - this.totalArmor * 0.3);
    this.currentHp -= reduced;
    if (this.currentHp <= 0) this.die();
  }
}
```

---

## AutoAttack System — 핵심 구현

```typescript
// src/systems/AutoAttackSystem.ts
// ⚠️ 성능 중요: SpatialGrid 사용, 매 프레임 전체 순회 금지

export class AutoAttackSystem {
  private cooldowns: Map<string, number[]> = new Map();
  // key: shipId, value: [weapon0 쿨다운, weapon1 쿨다운, ...]

  update(delta: number, ships: Ship[], grid: SpatialGrid): void {
    for (const ship of ships) {
      if (!ship.active) continue;

      const weapons = ship.getWeapons();
      const cooldownArr = this.getCooldowns(ship.id, weapons.length);

      weapons.forEach((weapon, idx) => {
        cooldownArr[idx] -= delta / 1000;
        if (cooldownArr[idx] > 0) return; // 쿨다운 중

        // SpatialGrid로 사거리 내 적만 탐지 (O(1) 근사)
        const nearby = grid.queryRadius(ship.x, ship.y, weapon.range);
        const enemies = nearby.filter(e => e.team !== ship.team && e.active);
        if (enemies.length === 0) return;

        // 타겟 선택: 가장 가까운 적
        const target = this.getNearestEnemy(ship, enemies);
        this.fireProjectile(ship, target, weapon);
        cooldownArr[idx] = 1 / weapon.attackSpeed; // 쿨다운 리셋
      });
    }
  }

  private getNearestEnemy(ship: Ship, enemies: Ship[]): Ship {
    return enemies.reduce((nearest, e) => {
      const d = Phaser.Math.Distance.Between(ship.x, ship.y, e.x, e.y);
      const nd = Phaser.Math.Distance.Between(ship.x, ship.y, nearest.x, nearest.y);
      return d < nd ? e : nearest;
    });
  }
}
```

---

## SpatialGrid — 성능 최적화 필수

```typescript
// src/utils/SpatialGrid.ts
// 100+ 유닛에서도 60fps 유지를 위한 공간 분할

export class SpatialGrid {
  private cells: Map<string, Ship[]> = new Map();
  private cellSize: number;

  constructor(cellSize = 300) {
    this.cellSize = cellSize;
  }

  private getKey(x: number, y: number): string {
    return `${Math.floor(x / this.cellSize)},${Math.floor(y / this.cellSize)}`;
  }

  update(ships: Ship[]): void {
    this.cells.clear();
    for (const ship of ships) {
      const key = this.getKey(ship.x, ship.y);
      if (!this.cells.has(key)) this.cells.set(key, []);
      this.cells.get(key)!.push(ship);
    }
  }

  queryRadius(x: number, y: number, radius: number): Ship[] {
    const result: Ship[] = [];
    const minCx = Math.floor((x - radius) / this.cellSize);
    const maxCx = Math.floor((x + radius) / this.cellSize);
    const minCy = Math.floor((y - radius) / this.cellSize);
    const maxCy = Math.floor((y + radius) / this.cellSize);

    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cy = minCy; cy <= maxCy; cy++) {
        const ships = this.cells.get(`${cx},${cy}`) ?? [];
        for (const ship of ships) {
          const dist = Phaser.Math.Distance.Between(x, y, ship.x, ship.y);
          if (dist <= radius) result.push(ship);
        }
      }
    }
    return result;
  }
}
```

---

## 모바일 터치 조이스틱

```typescript
// src/systems/InputSystem.ts
export class InputSystem {
  private joystickBase: Phaser.GameObjects.Circle;
  private joystickThumb: Phaser.GameObjects.Circle;
  private touchId: number | null = null;
  private direction: Phaser.Math.Vector2 = new Phaser.Math.Vector2();
  private readonly DEAD_ZONE = 20;
  private readonly MAX_DISTANCE = 60;

  // 화면 하단 1/3 터치 시작 → 조이스틱 생성
  // 드래그 방향 → direction 벡터 업데이트
  // Ship.update()에서 direction 읽어 velocity 설정
}
```

---

## 개발 순서 (의존성 순서 엄수)

```
Step 1: 프로젝트 세팅
  npm create vite@latest battleship -- --template vanilla-ts
  npm install phaser
  tsconfig.json strict mode 설정
  
Step 2: types.ts 작성 (balance.json 키 기반)
  → Planning Agent의 balance.json 확인 후 작성

Step 3: BootScene — 에셋 로드
  → Design Agent의 assets/READY.md 확인 후 경로 설정

Step 4: Ship 기본 이동 (placeholder 스프라이트 사용 가능)

Step 5: AutoAttackSystem + SpatialGrid

Step 6: ItemSystem + EquipmentSlots

Step 7: EconomySystem + ShopOverlay

Step 8: SafeZoneSystem

Step 9: UI 통합 (Design Agent 컴포넌트 연동)

Step 10: 성능 프로파일링 + 모바일 최적화
```

## Dev Agent 행동 규칙

1. **balance.json 하드코딩 금지**: 모든 수치는 `docs/balance.json` 에서 import
2. **placeholder 사용 허용**: 스프라이트 미완성 시 Phaser.GameObjects.Rectangle 대체 가능
3. **완료 기준**: 기능 동작 확인 후 PROGRESS.md 체크
4. **블로커 발생 시**: BLOCKER.md 즉시 작성 (예: "balance.json에 아이템 X 없음")
5. **Design Agent 요청**: 신규 UI 컴포넌트 필요 시 design-request.md 작성

## 성능 목표
- 60fps @ 50 유닛 동시 존재
- 메모리 < 150MB (iOS Safari 기준)
- 첫 로드 < 3초 (3G 기준)
- 번들 크기 < 2MB (gzip)
