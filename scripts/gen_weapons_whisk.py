"""
Weapon category icon generator via Whisk.

Produces top-down Brawl Stars-style icon PNGs for the 8 weapon categories
(plus armor + special equipment icons) into public/textures/weapons_gen/.

Usage:
  python3 scripts/gen_weapons_whisk.py                    # generate missing only
  python3 scripts/gen_weapons_whisk.py --force all        # regenerate all
  python3 scripts/gen_weapons_whisk.py homing sniper      # subset
"""
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MAKING_VIDEO = ROOT.parent / "making-video"
sys.path.insert(0, str(MAKING_VIDEO))

from whisk import _generate_single, _get_browser_context, setup_login, WHISK_PROFILE_DIR  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402
from PIL import Image  # noqa: E402
from rembg import remove  # noqa: E402

OUT_DIR = ROOT / "public" / "textures" / "weapons_gen"
OUT_DIR.mkdir(parents=True, exist_ok=True)
TMP_DIR = ROOT / "scripts" / "_whisk_tmp"
TMP_DIR.mkdir(parents=True, exist_ok=True)

STYLE = (
    "hand-painted icon art, stylized cartoon, Brawl Stars style, "
    "flat colors, bold clean shapes, thick dark outline, saturated poster palette, "
    "matte shading, centered composition, isolated on pure white background, "
    "square icon, no text, no logo, game weapon icon, glossy highlight"
)

ITEMS: dict[str, str] = {
    "sniper":  "a long-barrel sniper rifle with scope and bipod, battleship-mounted, metallic gunmetal grey with brass accents",
    "rapid":   "a twin-barrel rapid-fire gatling gun, spinning barrels, red-hot muzzle, warship anti-air gun",
    "splash":  "a heavy mortar cannon with a fat round shell just fired, smoke puff, navy-grey armor plating",
    "pierce":  "an energy lance spear with glowing cyan tip, streamlined metallic body, pierces armor",
    "homing":  "a guided missile with red-white striped warhead and fins, flame trail, tracking homing rocket",
    "chain":   "a tesla coil cannon with electric blue arcs crackling between orbs, lightning energy weapon",
    "flame":   "a flamethrower cannon spewing orange-red flames, brass fuel tank on side, inferno nozzle",
    "beam":    "a futuristic laser beam cannon with focused red-energy emitter, glossy white housing",
    "armor":   "a layered hull armor plating icon, thick steel shield with rivets, navy-grey metal",
    "special": "a magical equipment module icon, glowing purple crystal in brass frame, special powerup",
}


def postprocess(raw_path: Path, dest_png: Path) -> bool:
    """rembg → crop → square 512 PNG."""
    try:
        src = Image.open(raw_path).convert("RGBA")
        cut = remove(src)
        bbox = cut.getbbox()
        if bbox:
            cut = cut.crop(bbox)
        w, h = cut.size
        side = max(w, h)
        pad = Image.new("RGBA", (side, side), (0, 0, 0, 0))
        pad.paste(cut, ((side - w) // 2, (side - h) // 2))
        pad = pad.resize((512, 512), Image.LANCZOS)
        pad.save(dest_png, "PNG", optimize=True)
        return True
    except Exception as e:
        print(f"  ❌ postprocess failed: {e}")
        return False


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    force = "--force" in sys.argv
    if not args or args == ["all"]:
        targets = list(ITEMS.keys())
    else:
        unknown = [s for s in args if s not in ITEMS]
        if unknown:
            print(f"Unknown: {unknown}\nKnown: {list(ITEMS.keys())}")
            return 1
        targets = args

    pending = [s for s in targets if force or not (OUT_DIR / f"{s}.png").exists()]
    if not pending:
        print("All generated. --force to regenerate.")
        return 0

    print(f"Generating {len(pending)}: {pending}")

    if not WHISK_PROFILE_DIR.exists() or not any(WHISK_PROFILE_DIR.iterdir()):
        setup_login()

    with sync_playwright() as p:
        ctx = _get_browser_context(p, headless=False)
        page = ctx.pages[0] if ctx.pages else ctx.new_page()

        for item_id in pending:
            raw = TMP_DIR / f"w_{item_id}_raw.jpg"
            dest = OUT_DIR / f"{item_id}.png"

            print(f"\n→ {item_id}")
            ok = _generate_single(page, ITEMS[item_id], STYLE, raw)
            if not ok or not raw.exists():
                print(f"  ⚠  Whisk failed for {item_id}")
                continue
            if postprocess(raw, dest):
                print(f"  ✓ {dest.relative_to(ROOT)}")
            time.sleep(2)

        ctx.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
