"""
Deterministic Brand Asset & Icon Generator for OpenOb
Derives production icons, favicons, multi-resolution Windows ICO, macOS ICNS,
and web brand assets directly from the canonical master: assets/brand/openob-jackass-master.png.
100% Open Source / Python Pillow.
"""

import os
import sys
from pathlib import Path
from PIL import Image, ImageFilter, ImageEnhance
import numpy as np

def generate_icons():
    root = Path(__file__).resolve().parent.parent
    master_path = root / "assets" / "brand" / "openob-jackass-master.png"

    if not master_path.exists():
        print(f"Error: Master asset not found at {master_path}", file=sys.stderr)
        sys.exit(1)

    print(f"[BrandGen] Reading canonical master: {master_path}")
    master = Image.open(master_path).convert("RGBA")
    w, h = master.size
    print(f"[BrandGen] Master dimensions: {w}x{h}, Mode: {master.mode}")

    # Ensure output directories
    brand_dir = root / "assets" / "brand"
    desktop_build_dir = root / "apps" / "desktop" / "build"
    desktop_icons_dir = desktop_build_dir / "icons"
    web_public_dir = root / "apps" / "web" / "public"
    web_brand_dir = web_public_dir / "brand"

    for d in [brand_dir, desktop_build_dir, desktop_icons_dir, web_public_dir, web_brand_dir]:
        d.mkdir(parents=True, exist_ok=True)

    # -------------------------------------------------------------------------
    # 1. Create Clean Transparent Sigil / Mark for In-App & Favicon
    # -------------------------------------------------------------------------
    arr = np.array(master, dtype=float)
    rgb = arr[:, :, :3]
    luma = np.mean(rgb, axis=2)

    # Calculate distance from center (627, 627)
    cy, cx = h / 2.0, w / 2.0
    y_coords, x_coords = np.ogrid[:h, :w]
    dist_from_center = np.sqrt((x_coords - cx) ** 2 + (y_coords - cy) ** 2)

    # Soft alpha mask:
    # Near the dark corners (luma < 18 outside r > 450), fade to 0 alpha
    # Inside the sigil/tile, retain full opacity
    corner_falloff = np.clip((540.0 - dist_from_center) / 60.0, 0.0, 1.0)
    luma_falloff = np.clip((luma - 12.0) / 12.0, 0.0, 1.0)
    alpha = np.clip(corner_falloff * luma_falloff * 255.0, 0, 255).astype(np.uint8)

    # Apply alpha to transparent version
    arr_trans = arr.copy()
    arr_trans[:, :, 3] = alpha
    im_trans = Image.fromarray(arr_trans.astype(np.uint8), "RGBA")

    # -------------------------------------------------------------------------
    # 2. Derive Standard Brand Assets (assets/brand/)
    # -------------------------------------------------------------------------
    print("[BrandGen] Generating brand derivatives in assets/brand/...")
    master.resize((1024, 1024), Image.Resampling.LANCZOS).save(brand_dir / "openob-icon-1024.png", "PNG")
    master.resize((512, 512), Image.Resampling.LANCZOS).save(brand_dir / "openob-icon-512.png", "PNG")
    master.resize((256, 256), Image.Resampling.LANCZOS).save(brand_dir / "openob-icon-256.png", "PNG")
    im_trans.resize((512, 512), Image.Resampling.LANCZOS).save(brand_dir / "openob-mark-transparent.png", "PNG")

    # -------------------------------------------------------------------------
    # 3. Derive Desktop Linux PNG Icons (apps/desktop/build/icons/)
    # -------------------------------------------------------------------------
    print("[BrandGen] Generating Linux desktop icons in apps/desktop/build/icons/...")
    linux_sizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024]
    for sz in linux_sizes:
        # For small sizes (16, 24, 32), apply subtle unsharp mask after downsampling for crisp silhouette
        resized = master.resize((sz, sz), Image.Resampling.LANCZOS)
        if sz <= 32:
            resized = resized.filter(ImageFilter.UnsharpMask(radius=1, percent=130, threshold=3))
        resized.save(desktop_icons_dir / f"{sz}x{sz}.png", "PNG")

    master.resize((512, 512), Image.Resampling.LANCZOS).save(desktop_build_dir / "icon.png", "PNG")

    # -------------------------------------------------------------------------
    # 4. Derive Windows Multi-Resolution ICO (apps/desktop/build/icon.ico)
    # -------------------------------------------------------------------------
    print("[BrandGen] Generating Windows multi-resolution icon.ico...")
    ico_sizes = [(16, 16), (20, 20), (24, 24), (32, 32), (40, 40), (48, 48), (64, 64), (128, 128), (256, 256)]
    master.save(
        desktop_build_dir / "icon.ico",
        format="ICO",
        sizes=ico_sizes,
    )

    # -------------------------------------------------------------------------
    # 5. Derive macOS ICNS (apps/desktop/build/icon.icns)
    # -------------------------------------------------------------------------
    print("[BrandGen] Generating macOS icon.icns...")
    icns_sizes = [(16, 16), (32, 32), (64, 64), (128, 128), (256, 256), (512, 512), (1024, 1024)]
    try:
        master.save(
            desktop_build_dir / "icon.icns",
            format="ICNS",
            sizes=icns_sizes,
        )
    except Exception as e:
        print(f"[BrandGen] Note on ICNS export: {e}")

    # -------------------------------------------------------------------------
    # 6. Derive Web Favicons & In-App Brand Assets (apps/web/public/)
    # -------------------------------------------------------------------------
    print("[BrandGen] Generating Web favicons and in-app brand assets in apps/web/public/...")
    # Favicons with transparent background for crisp browser tab integration
    fav_16 = im_trans.resize((16, 16), Image.Resampling.LANCZOS).filter(ImageFilter.UnsharpMask(radius=1, percent=150, threshold=2))
    fav_32 = im_trans.resize((32, 32), Image.Resampling.LANCZOS).filter(ImageFilter.UnsharpMask(radius=1, percent=130, threshold=2))
    fav_48 = im_trans.resize((48, 48), Image.Resampling.LANCZOS)
    fav_180 = master.resize((180, 180), Image.Resampling.LANCZOS)

    fav_16.save(web_public_dir / "favicon-16x16.png", "PNG")
    fav_32.save(web_public_dir / "favicon-32x32.png", "PNG")
    fav_48.save(web_public_dir / "favicon-48x48.png", "PNG")
    fav_180.save(web_public_dir / "apple-touch-icon.png", "PNG")

    # Multi-resolution favicon.ico
    im_trans.save(
        web_public_dir / "favicon.ico",
        format="ICO",
        sizes=[(16, 16), (32, 32), (48, 48)],
    )

    # In-App Header logo (transparent mark)
    im_trans.resize((256, 256), Image.Resampling.LANCZOS).save(web_brand_dir / "openob-mark.png", "PNG")
    im_trans.resize((64, 64), Image.Resampling.LANCZOS).save(web_brand_dir / "openob-mark-64.png", "PNG")

    # -------------------------------------------------------------------------
    # 7. Generate Contact Sheet for Visual Size Review (16 to 512)
    # -------------------------------------------------------------------------
    print("[BrandGen] Generating brand mark size contact sheet in assets/brand/...")
    review_sizes = [16, 24, 32, 48, 64, 128, 256, 512]
    # Canvas size: 1200w x 600h on dark background #0d0f12
    sheet = Image.new("RGBA", (1400, 680), (13, 15, 18, 255))
    x_offset = 40
    for sz in review_sizes:
        if sz <= 32:
            rendered = im_trans.resize((sz, sz), Image.Resampling.LANCZOS).filter(ImageFilter.UnsharpMask(radius=1, percent=140, threshold=2))
        else:
            rendered = im_trans.resize((sz, sz), Image.Resampling.LANCZOS)
        y_pos = 580 - sz
        sheet.paste(rendered, (x_offset, y_pos), rendered)
        x_offset += sz + 30

    sheet.save(brand_dir / "openob-mark-size-review.png", "PNG")

    print("[BrandGen] All OpenOb brand assets successfully generated!")

if __name__ == "__main__":
    generate_icons()
