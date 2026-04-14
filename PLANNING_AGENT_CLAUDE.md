# 📋 Battleship Mobile — Planning Agent

## 역할 정의
너는 이 프로젝트의 **기획 전담 에이전트**다.
게임 디자인 문서(GDD), 밸런스 수치, 시스템 스펙을 작성한다.
코드를 직접 작성하지 않는다. **문서와 데이터만 만든다.**

## 작업 영역
```
docs/
├── GDD.md              ← 게임 디자인 문서 (메인)
├── balance.json        ← 모든 게임 수치 (Dev/Design이 참조)
├── item-spec.md        ← 아이템 상세 스펙 + 조합 레시피
├── map-spec.md         ← 맵 레이아웃, 안전지대, 스폰 포인트
├── ux-flow.md          ← 화면 흐름도 (Design Agent 참조)
├── tutorial-flow.md    ← 튜토리얼 단계별 설명
└── CHANGELOG.md        ← 수치/스펙 변경 이력
```

## 출력 규칙
- `balance.json` 수치 변경 시 **반드시** `CHANGELOG.md`에 기록
- Dev Agent가 코드에서 참조하므로 JSON 키 이름 임의 변경 금지
- 기존 키 제거 시 Dev Agent에게 알림 (BLOCKER.md 작성)

---

## 📄 즉시 작성할 문서들

### 1. docs/GDD.md 구조

```markdown
# Battleship Mobile — Game Design Document

## 1. 게임 개요
- 장르: 실시간 PvP 배틀 (오토배틀 + 아이템 빌드)
- 시점: 탑다운 2D
- 플레이 시간: 1판 5~10분
- 핵심 재미: 아이템 빌드 실험 + 근접-원거리 포지셔닝

## 2. 핵심 게임 루프
1. 배 선택 (3종)
2. 배틀 필드 입장
3. 이동하며 골드 획득 (크립 처치 / 시간당 자동)
4. 상점 접근 → 아이템 구매 → 슬롯에 장착
5. 무기 자동 공격 (사거리 내 적 탐지)
6. 적 배 격침 → 골드 획득
7. 최후의 1인 생존

## 3. 배(Ship) 스펙
| 이름 | HP | 속도 | 무기슬롯 | 방어슬롯 | 특수슬롯 | 특징 |
|------|----|------|---------|---------|---------|------|
| Destroyer | 400 | 240 | 2 | 1 | 1 | 고속, 저체력 |
| Cruiser | 700 | 160 | 2 | 2 | 1 | 균형형 |
| Battleship | 1200 | 100 | 3 | 2 | 1 | 저속, 고화력 |

## 4. 아이템 시스템
### 4.1 무기 아이템 (Weapon)
| 아이템 | 피해 | 사거리 | 공격속도 | 탄환 타입 | 비용 |
|-------|-----|-------|---------|---------|-----|
| Iron Cannon | 80 | 250 | 1.5/s | Normal | 200g |
| Rapid Gun | 40 | 180 | 4.0/s | Normal | 150g |
| Mortar | 150 | 350 | 0.5/s | Splash(r60) | 400g |
| Torpedo | 200 | 200 | 0.8/s | Piercing | 350g |
| Chain Shot | 60 | 220 | 2.0/s | Slow(-30%) | 250g |
| Thunder Cannon | 180 | 280 | 0.7/s | Lightning | 500g |

### 4.2 방어 아이템 (Armor)
| 아이템 | 방어력 | 효과 | 비용 |
|-------|------|-----|-----|
| Iron Hull | +80 armor | - | 180g |
| Shield Generator | +150 HP | 피격 시 쿨3s 방어막 | 300g |
| Repair Kit | - | 초당 5 HP 회복 | 250g |
| Reflector | +50 armor | 받은 피해의 15% 반사 | 350g |

### 4.3 특수 아이템 (Special)
| 아이템 | 효과 | 비용 |
|-------|-----|-----|
| Speed Booster | 속도 +30% | 200g |
| Radar | 시야 +50%, 스텔스 탐지 | 300g |
| Mine Layer | 이동 경로에 기뢰 설치 | 400g |
| EMP Device | 주변 적 2s 마비 (쿨60s) | 500g |

### 4.4 조합 레시피
| 재료 A | 재료 B | 결과 | 효과 |
|-------|-------|-----|-----|
| Iron Cannon x2 | - | Twin Cannon | 피해 x1.8, 사거리 +20 |
| Rapid Gun x2 | - | Gatling | 피해 x1.5, 공속 6/s |
| Mortar + Radar | - | Guided Mortar | 홈ing 포탄 |
| Iron Hull x2 | - | Titanium Hull | 방어력 +200 |
| Speed Booster + Repair Kit | - | Overdrive | 속도 +50%, HP회복 3/s |

## 5. 골드 경제
- 시작 골드: 500g
- 크립 처치: 50g
- 적 격침: 200g
- 시간당 자동 골드: 30g/10s
- 상점 갱신: 무료 (언제든 접근 가능)

## 6. 맵 설계
- 크기: 2000 x 2000 (월드 좌표)
- 카메라: 플레이어 중심 추적
- 안전지대: 경기 시작 후 4분부터 30초마다 수축
- 크립 스폰: 맵 중앙부 4곳, 30초 간격 리스폰

## 7. 승리 조건
- 최후의 1인 (또는 1팀) 생존
- 상대 배 HP 0 = 격침
- 안전지대 밖 = 초당 20 피해

## 8. 모바일 UX 원칙
- 한 손 조작 가능
- 자동 공격 (직접 조준 없음)
- 상점: 하단 오버레이 (이동 중 구매 가능)
- 미니맵: 우상단 80x80px
```

---

### 2. docs/balance.json 구조

```json
{
  "_comment": "Planning Agent 관리. 수치 변경 시 CHANGELOG.md 기록 필수",
  "_version": "0.1.0",
  
  "ships": {
    "destroyer": {
      "id": "destroyer",
      "displayName": "Destroyer",
      "hp": 400,
      "speed": 240,
      "armor": 10,
      "slots": { "weapon": 2, "armor": 1, "special": 1 },
      "cost": 0,
      "spriteName": "ship_destroyer"
    },
    "cruiser": {
      "id": "cruiser",
      "displayName": "Cruiser",
      "hp": 700,
      "speed": 160,
      "armor": 20,
      "slots": { "weapon": 2, "armor": 2, "special": 1 },
      "cost": 0,
      "spriteName": "ship_cruiser"
    },
    "battleship": {
      "id": "battleship",
      "displayName": "Battleship",
      "hp": 1200,
      "speed": 100,
      "armor": 35,
      "slots": { "weapon": 3, "armor": 2, "special": 1 },
      "cost": 0,
      "spriteName": "ship_battleship"
    }
  },

  "items": {
    "iron_cannon": {
      "id": "iron_cannon",
      "displayName": "Iron Cannon",
      "type": "weapon",
      "damage": 80,
      "range": 250,
      "attackSpeed": 1.5,
      "projectileType": "normal",
      "projectileSpeed": 400,
      "splashRadius": 0,
      "cost": 200,
      "spriteName": "item_iron_cannon",
      "description": "기본 함포. 안정적인 화력."
    },
    "rapid_gun": {
      "id": "rapid_gun",
      "displayName": "Rapid Gun",
      "type": "weapon",
      "damage": 40,
      "range": 180,
      "attackSpeed": 4.0,
      "projectileType": "normal",
      "projectileSpeed": 600,
      "splashRadius": 0,
      "cost": 150,
      "spriteName": "item_rapid_gun",
      "description": "근거리 속사포."
    },
    "mortar": {
      "id": "mortar",
      "displayName": "Mortar",
      "type": "weapon",
      "damage": 150,
      "range": 350,
      "attackSpeed": 0.5,
      "projectileType": "splash",
      "projectileSpeed": 300,
      "splashRadius": 60,
      "cost": 400,
      "spriteName": "item_mortar",
      "description": "광역 폭발 포탄."
    },
    "iron_hull": {
      "id": "iron_hull",
      "displayName": "Iron Hull",
      "type": "armor",
      "armorBonus": 80,
      "hpBonus": 0,
      "effect": null,
      "cost": 180,
      "spriteName": "item_iron_hull",
      "description": "철제 선체 강화."
    },
    "shield_generator": {
      "id": "shield_generator",
      "displayName": "Shield Generator",
      "type": "armor",
      "armorBonus": 0,
      "hpBonus": 150,
      "effect": "shield_on_hit",
      "effectParams": { "cooldown": 3, "shieldDuration": 1.5 },
      "cost": 300,
      "spriteName": "item_shield",
      "description": "피격 시 일시 방어막."
    },
    "speed_booster": {
      "id": "speed_booster",
      "displayName": "Speed Booster",
      "type": "special",
      "speedMultiplier": 1.3,
      "cost": 200,
      "spriteName": "item_speed",
      "description": "이동속도 30% 증가."
    }
  },

  "recipes": [
    {
      "id": "twin_cannon",
      "displayName": "Twin Cannon",
      "ingredients": ["iron_cannon", "iron_cannon"],
      "resultItem": {
        "type": "weapon",
        "damage": 144,
        "range": 270,
        "attackSpeed": 1.5,
        "projectileType": "normal",
        "projectileSpeed": 420,
        "splashRadius": 0,
        "spriteName": "item_twin_cannon",
        "description": "강화 쌍포."
      }
    }
  ],

  "economy": {
    "startingGold": 500,
    "creeepKillGold": 50,
    "shipKillGold": 200,
    "passiveGoldPerInterval": 30,
    "passiveGoldInterval": 10
  },

  "map": {
    "worldWidth": 2000,
    "worldHeight": 2000,
    "safeZoneInitialRadius": 900,
    "safeZoneShrinkStart": 240,
    "safeZoneShrinkInterval": 30,
    "safeZoneShrinkAmount": 80,
    "safeZoneDamagePerSecond": 20,
    "creepSpawnInterval": 30,
    "creepHp": 150,
    "creepSpeed": 60
  }
}
```

---

### 3. docs/ux-flow.md (Design Agent 참조용)

```markdown
# UX Flow — Design Agent 작업 가이드

## 화면 목록
1. Title Screen → 로고 + 플레이 버튼
2. Ship Select → 3종 중 선택
3. Game Screen → 메인 게임플레이
4. Shop Overlay → 게임 위에 오버레이
5. Death Screen → 격침 결과
6. Victory Screen → 승리 결과

## Game Screen 레이아웃 (세로 모드 9:16)
┌─────────────────────┐
│ [HP바]    [미니맵]  │ ← 상단 HUD
│ [골드]    [킬카운트]│
│                     │
│                     │
│    (게임 뷰)        │
│                     │
│                     │
│ [슬롯1][슬롯2][슬롯3]│ ← 아이템 슬롯 (탭 = 상세)
│ [슬롯4][슬롯5] [🛒] │ ← 상점 버튼
│    [조이스틱]       │ ← 이동 컨트롤
└─────────────────────┘

## Shop Overlay
- 반투명 배경 (blur)
- 상단: 보유 골드
- 아이템 카드 그리드 (2열)
- 각 카드: 아이콘 + 이름 + 스탯 + 가격
- 하단: 닫기 버튼

## 터치 인터랙션
- 조이스틱: 화면 하단 1/3 아무데나 터치 시작 → 드래그 방향으로 이동
- 아이템 슬롯 탭: 상세 팝업
- 상점 버튼 탭: Shop Overlay 열기
- 더블탭: 해당 위치로 대시 이동 (Speed Booster 장착 시)
```

---

## Planning Agent 행동 규칙

1. **수치 근거 명시**: balance.json의 모든 수치는 CHANGELOG.md에 근거 기록
2. **Dev Agent와 계약**: JSON 키 변경 전 반드시 Dev Agent 확인
3. **스펙 동결 시점**: Dev가 해당 시스템 코딩 시작 전 스펙 확정
4. **우선순위**: balance.json > item-spec.md > map-spec.md > 나머지
5. **완료 기준**: 각 문서 작성 후 PROGRESS.md의 해당 항목 체크

## 시작 즉시 실행
```
1. docs/ 폴더 생성
2. GDD.md 초안 작성 (위 구조 기반)
3. balance.json 생성 (위 JSON 기반)
4. ux-flow.md 작성 (Design Agent에게 전달)
5. PROGRESS.md에 완료 체크
```
