# Whisk / Imagen 프롬프트 시트 — 탑다운 배 텍스처

생성된 PNG는 `public/textures/ships_gen/{shipId}.png` 로 저장. 파일명은 `balance.json`의 `id` 기준.
파일이 없으면 3D 블록 메시로 폴백하므로 하나씩 추가하면서 실시간 확인 가능.

## 공통 스타일 (모든 프롬프트 앞에 붙이면 일관성↑)

```
top-down orthographic view of a {SHIP}, hand-painted texture,
stylized cartoon, Brawl Stars style, flat colors, bold clean shapes,
thick dark outline, saturated poster palette, matte shading,
centered composition, bow pointing UP, transparent background,
square 1024x1024, no perspective
```

## 권장 출력 포맷
- 해상도: **1024x1024** 정방형
- 배경: **투명 PNG** (필수)
- 방향: **뱃머리(bow)가 위쪽(+Y)**, 꼬리(stern)가 아래
- 여백: 캔버스 가장자리에서 ~5% 패딩

---

## 선종별 프롬프트

### 일반 함선

| 파일명 | 프롬프트 핵심 |
|---|---|
| `patrolboat.png` | small wooden fishing patrol boat, single cabin, outboard motor, weathered planks |
| `destroyer.png` | sleek modern destroyer warship, twin gun turrets, radar mast, gray hull |
| `cruiser.png` | heavy cruiser warship, layered superstructure, three turrets, navy-blue hull |
| `battleship.png` | massive battleship, four triple-gun turrets, tall bridge tower, armor belt |
| `carrier.png` | aircraft carrier, flat deck with runway markings, island tower on starboard |
| `submarine.png` | low-profile submarine, conning tower, periscope, dark-steel hull, partially submerged |

### 국가/문명 (신화 IP 방향)

| 파일명 | 프롬프트 핵심 |
|---|---|
| `yamato.png` | Imperial Japanese battleship Yamato, red rising-sun accents, ornate pagoda tower |
| `iowa.png` | US battleship Iowa, star-spangled stripes, three massive turrets, cream hull |
| `hood.png` | British battlecruiser HMS Hood, royal-navy gray, Union Jack accent |
| `akagi.png` | Japanese carrier Akagi, torii-gate red flight deck, cherry-blossom decals |
| `pyotr.png` | Russian missile cruiser Pyotr Velikiy, red-star, missile silos, icy-blue hull |
| `turtleship.png` | Korean turtle ship (Geobukseon), dragon head bow, spiked iron-clad shell, gold trim |
| `panokseon.png` | Korean Panokseon war junk, red pavilion deck, taegeuk shield, wooden planks |
| `galleon.png` | Spanish galleon, three masts, golden stern castle, cream sails |
| `trireme.png` | ancient Greek trireme, bronze ram bow, three rows of oars, eye on prow |
| `viking.png` | viking longship, dragon-head prow, striped red-white sail, shields on sides |
| `pirate.png` | pirate sloop, black hull, skull flag, torn gray sails |

### 신화 T5

| 파일명 | 프롬프트 핵심 |
|---|---|
| `kraken.png` | mythic kraken-ship hybrid, tentacles wrapping the hull, bio-luminescent teal glow |
| `phoenix.png` | phoenix warship, feathered orange-red flaming wings from hull, fire trail |
| `ghostship.png` | ghost galleon, translucent blue spectral wood, skeletal crew, tattered sails |
| `thundership.png` | lightning-powered vessel, crackling electric-blue tesla spires, storm clouds |

### 서포트

| 파일명 | 프롬프트 핵심 |
|---|---|
| `medic.png` | medical-cruiser, white hull, red-cross emblem on deck, healing-green accents |
| `seawitch.png` | witch ship, purple hull, green cauldron on deck, crescent-moon sails |

---

## Whisk 사용 팁

1. **레퍼런스 이미지**로 바탕화면의 `참고자료/lucid-origin_hand-painted_texture_top-down_warship...jpg` 를 스타일 앵커로 업로드
2. 프롬프트에 "match the style of the reference exactly" 추가
3. 생성 → 마음에 드는 것 다운로드 → 배경 투명화 (누락 시 Preview에서 Instant Alpha)
4. `public/textures/ships_gen/{shipId}.png` 로 저장
5. 브라우저 하드 리프레시 (`Cmd+Shift+R`) — 자동 로드됨

배경 투명화가 어렵다면 흰색/단색 배경으로 생성 후 `remove.bg` 같은 툴 사용.
