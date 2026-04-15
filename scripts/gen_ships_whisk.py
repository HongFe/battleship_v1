"""
Brawl Stars-style top-down ship sprite generator via Whisk.

Reuses the Whisk automation module in ../making-video/whisk.py
(already-logged-in persistent Chrome profile at ~/.whisk_automation_profile).

Flow:
  1. For each ship in SHIPS, submit prompt to Whisk
  2. Wait for result, download raw image
  3. rembg background removal → transparent PNG
  4. Save to public/textures/ships_gen/{shipId}.png

Usage:
  python3 scripts/gen_ships_whisk.py              # generate all missing
  python3 scripts/gen_ships_whisk.py yamato       # generate one
  python3 scripts/gen_ships_whisk.py --force all  # regenerate everything
"""
import sys
import time
from io import BytesIO
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MAKING_VIDEO = ROOT.parent / "making-video"
sys.path.insert(0, str(MAKING_VIDEO))

from whisk import _generate_single, _get_browser_context, setup_login, WHISK_PROFILE_DIR  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402
from PIL import Image  # noqa: E402
from rembg import remove  # noqa: E402

OUT_DIR = ROOT / "public" / "textures" / "ships_gen"
OUT_DIR.mkdir(parents=True, exist_ok=True)
TMP_DIR = ROOT / "scripts" / "_whisk_tmp"
TMP_DIR.mkdir(parents=True, exist_ok=True)

STYLE = (
    "hand-painted texture, stylized cartoon, Brawl Stars style, "
    "flat colors, bold clean shapes, thick dark outline, saturated poster palette, "
    "matte shading, centered, bow pointing up, pure white background, "
    "square composition, no text, no logo"
)

SHIPS: dict[str, str] = {
    # general
    "patrolboat":  "top-down orthographic view of a small wooden fishing patrol boat with single cabin and outboard motor, weathered planks",
    "destroyer":   "top-down orthographic view of a sleek modern destroyer warship with twin gun turrets, radar mast, gray steel hull",
    "cruiser":     "top-down orthographic view of a heavy cruiser warship with layered superstructure and three turrets, navy-blue hull",
    "battleship":  "top-down orthographic view of a massive battleship with four triple-gun turrets, tall bridge tower, armor belt",
    "carrier":     "top-down orthographic view of an aircraft carrier with flat flight deck, runway markings, island tower on starboard",
    "submarine":   "top-down orthographic view of a low-profile submarine with conning tower and periscope, dark-steel hull, partially submerged",
    # faction / national
    "yamato":      "top-down orthographic view of the Imperial Japanese battleship Yamato, red rising-sun accents, ornate pagoda tower",
    "iowa":        "top-down orthographic view of the US battleship Iowa, star-spangled stripes, three massive turrets, cream hull",
    "hood":        "top-down orthographic view of the British battlecruiser HMS Hood, royal-navy gray, Union Jack accent",
    "akagi":       "top-down orthographic view of the Japanese carrier Akagi, torii-gate red flight deck, cherry-blossom decals",
    "pyotr":       "top-down orthographic view of the Russian missile cruiser Pyotr Velikiy, red-star, missile silos, icy-blue hull",
    "turtleship":  "top-down orthographic view of a Korean turtle ship Geobukseon with dragon head bow, spiked iron-clad shell, gold trim",
    "panokseon":   "top-down orthographic view of a Korean Panokseon war junk with red pavilion deck, taegeuk shield, wooden planks",
    "galleon":     "top-down orthographic view of a Spanish galleon with three masts, golden stern castle, cream sails",
    "trireme":     "top-down orthographic view of an ancient Greek trireme with bronze ram bow, three rows of oars, eye on prow",
    "viking":      "top-down orthographic view of a viking longship with dragon-head prow, striped red-white sail, shields on sides",
    "pirate":      "top-down orthographic view of a pirate sloop with black hull, skull flag, torn gray sails",
    # mythic T5
    "kraken":      "top-down orthographic view of a mythic kraken-ship hybrid with tentacles wrapping the hull, bio-luminescent teal glow",
    "phoenix":     "top-down orthographic view of a phoenix warship with feathered orange-red flaming wings from the hull, fire trail",
    "ghostship":   "top-down orthographic view of a ghost galleon with translucent blue spectral wood, skeletal crew, tattered sails",
    "thundership": "top-down orthographic view of a lightning-powered vessel with crackling electric-blue tesla spires, storm clouds",
    # support
    "medic":       "top-down orthographic view of a medical-cruiser with white hull, red-cross emblem on deck, healing-green accents",
    "seawitch":    "top-down orthographic view of a witch ship with purple hull, green cauldron on deck, crescent-moon sails",
}


def postprocess(raw_path: Path, dest_png: Path) -> bool:
    """rembg → crop transparent → 1024 square PNG."""
    try:
        src = Image.open(raw_path).convert("RGBA")
        cut = remove(src)
        # Auto-crop to content bbox
        bbox = cut.getbbox()
        if bbox:
            cut = cut.crop(bbox)
        # Pad to square, resize to 1024
        w, h = cut.size
        side = max(w, h)
        pad = Image.new("RGBA", (side, side), (0, 0, 0, 0))
        pad.paste(cut, ((side - w) // 2, (side - h) // 2))
        pad = pad.resize((1024, 1024), Image.LANCZOS)
        pad.save(dest_png, "PNG", optimize=True)
        return True
    except Exception as e:
        print(f"  ❌ postprocess failed: {e}")
        return False


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    force = "--force" in sys.argv
    targets: list[str]
    if not args or args == ["all"]:
        targets = list(SHIPS.keys())
    else:
        unknown = [s for s in args if s not in SHIPS]
        if unknown:
            print(f"Unknown ship ids: {unknown}")
            print(f"Known: {list(SHIPS.keys())}")
            return 1
        targets = args

    pending = [s for s in targets if force or not (OUT_DIR / f"{s}.png").exists()]
    if not pending:
        print("All target ships already generated. Use --force to regenerate.")
        return 0

    print(f"Generating {len(pending)} ship(s): {pending}")

    if not WHISK_PROFILE_DIR.exists() or not any(WHISK_PROFILE_DIR.iterdir()):
        print("No Whisk profile — running login flow first.")
        setup_login()

    with sync_playwright() as p:
        ctx = _get_browser_context(p, headless=False)
        page = ctx.pages[0] if ctx.pages else ctx.new_page()

        for ship_id in pending:
            prompt = f"{SHIPS[ship_id]}. {STYLE}"
            raw = TMP_DIR / f"{ship_id}_raw.jpg"
            dest = OUT_DIR / f"{ship_id}.png"

            print(f"\n→ {ship_id}")
            ok = _generate_single(page, SHIPS[ship_id], STYLE, raw)
            if not ok or not raw.exists():
                print(f"  ⚠  Whisk generation failed for {ship_id}")
                continue

            if postprocess(raw, dest):
                print(f"  ✓ saved {dest.relative_to(ROOT)}")
            time.sleep(2)

        ctx.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
