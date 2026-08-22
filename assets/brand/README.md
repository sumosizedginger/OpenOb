# OpenOb Brand Assets & Canonical Mark

## 1. Canonical Master Asset

- **File:** `assets/brand/openob-jackass-master.png`
- **Description:** Black and antique-gold jackass skull inside a broken circular sigil with copper-red magma fracture on a textured slate tile.
- **Authority:** Supplied directly by the project owner as the canonical OpenOb brand mark.
- **Rule:** Do NOT modify, replace, compress, or delete the master asset. All other brand formats and resolutions are derived deterministically from this file.

---

## 2. Derived Production Assets

| Asset Path                                 | Resolution                              | Mode / Format | Purpose                                       |
| ------------------------------------------ | --------------------------------------- | ------------- | --------------------------------------------- |
| `assets/brand/openob-jackass-master.png`   | 1254×1254                               | RGB PNG       | Canonical master source of truth              |
| `assets/brand/openob-icon-1024.png`        | 1024×1024                               | RGBA PNG      | High-resolution store & press asset           |
| `assets/brand/openob-icon-512.png`         | 512×512                                 | RGBA PNG      | Standard packaging asset                      |
| `assets/brand/openob-icon-256.png`         | 256×256                                 | RGBA PNG      | Mid-resolution packaging & distribution asset |
| `assets/brand/openob-mark-transparent.png` | 512×512                                 | RGBA PNG      | Transparent background mark for README & docs |
| `assets/brand/openob-mark-size-review.png` | 1400×680                                | RGBA PNG      | Pixel-size review sheet (16px to 512px)       |
| `apps/desktop/build/icon.ico`              | Multi-res (16–256)                      | Windows ICO   | Windows application & installer icon          |
| `apps/desktop/build/icon.icns`             | Multi-res (16–1024)                     | macOS ICNS    | macOS application bundle icon                 |
| `apps/desktop/build/icons/*.png`           | 16, 24, 32, 48, 64, 128, 256, 512, 1024 | Linux PNGs    | Linux freedesktop icon hierarchy              |
| `apps/web/public/favicon.ico`              | Multi-res (16, 32, 48)                  | Web ICO       | Browser tab multi-resolution favicon          |
| `apps/web/public/favicon-*.png`            | 16×16, 32×32, 48×48                     | Web PNGs      | Standard browser tab favicons                 |
| `apps/web/public/apple-touch-icon.png`     | 180×180                                 | Web PNG       | Mobile & PWA touch bookmark icon              |
| `apps/web/public/brand/openob-mark.png`    | 256×256                                 | Web RGBA PNG  | In-app header brand mark                      |
| `apps/web/public/brand/openob-mark-64.png` | 64×64                                   | Web RGBA PNG  | High-DPI in-app navigation mark               |

---

## 3. Deterministic Asset Regeneration

Brand asset generation is contributor tooling (not required for runtime execution or normal `npm ci` builds).

### Prerequisites & Setup

Install the pinned tooling dependencies:

```bash
python -m pip install -r scripts/requirements-brand.txt
```

### Regeneration Command

To regenerate all derived brand assets deterministically from the canonical master:

```bash
npm run brand:generate
```

This executes `scripts/generate-brand-icons.mjs` (wrapping `scripts/generate_brand_icons.py`), which automatically locates the Python 3 runtime on Windows, macOS, and Linux, and derives all raster formats using Lanczos resampling and micro-sharpening for small resolutions.
