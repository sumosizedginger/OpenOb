"""
Verify generated brand assets and inspect their resolutions.
"""

from pathlib import Path
from PIL import Image

def verify():
    root = Path(__file__).resolve().parent.parent

    print("--- 1. Brand Derivatives ---")
    for name in ["openob-jackass-master.png", "openob-icon-1024.png", "openob-icon-512.png", "openob-icon-256.png", "openob-mark-transparent.png"]:
        p = root / "assets" / "brand" / name
        im = Image.open(p)
        print(f"assets/brand/{name}: {im.size}, mode={im.mode}")

    print("\n--- 2. Desktop Build Resources ---")
    ico_path = root / "apps" / "desktop" / "build" / "icon.ico"
    im_ico = Image.open(ico_path)
    print(f"icon.ico: format={im_ico.format}, default size={im_ico.size}")

    icns_path = root / "apps" / "desktop" / "build" / "icon.icns"
    if icns_path.exists():
        im_icns = Image.open(icns_path)
        print(f"icon.icns: format={im_icns.format}, default size={im_icns.size}")

    for p in sorted((root / "apps" / "desktop" / "build" / "icons").glob("*.png")):
        im = Image.open(p)
        print(f"icons/{p.name}: {im.size}, mode={im.mode}")

    print("\n--- 3. Web Public Brand Assets ---")
    fav_ico = root / "apps" / "web" / "public" / "favicon.ico"
    im_fav = Image.open(fav_ico)
    print(f"favicon.ico: format={im_fav.format}, default size={im_fav.size}")

    for p in sorted((root / "apps" / "web" / "public").glob("favicon*")):
        if p.suffix == ".png":
            im = Image.open(p)
            print(f"public/{p.name}: {im.size}, mode={im.mode}")

    for p in sorted((root / "apps" / "web" / "public" / "brand").glob("*.png")):
        im = Image.open(p)
        print(f"public/brand/{p.name}: {im.size}, mode={im.mode}")

if __name__ == "__main__":
    verify()
