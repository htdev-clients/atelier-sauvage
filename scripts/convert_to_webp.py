"""
One-time script: convert catalog JPEGs to WebP.
- 480/ and 800/ folders: convert format only (no resize)
- 2000/ folder: resize to max 1400px wide, save to new 1400/ folder

Run from the repo root:
    pip install pillow
    python scripts/convert_to_webp.py

After verifying output, delete the old JPEG files:
    git rm -r assets/img/catalog/480/*.jpeg assets/img/catalog/800/*.jpeg assets/img/catalog/2000/
"""

import os
from pathlib import Path
from PIL import Image, ImageOps

CATALOG_DIR = Path("assets/img/catalog")
QUALITY = 85

def convert(src: Path, dst: Path, max_width=None):
    img = Image.open(src)
    img = ImageOps.exif_transpose(img)
    if max_width and img.width > max_width:
        img.thumbnail((max_width, max_width * 4))
    img.save(dst, "WEBP", quality=QUALITY)

def rename_size(filename: str, old_size: str, new_size: str) -> str:
    """e.g. '100-1-2000.jpeg' -> '100-1-1400.webp'"""
    stem = filename.replace(f"-{old_size}.jpeg", f"-{new_size}")
    return stem + ".webp"

errors = []

# --- 480 and 800: format conversion only ---
for size in ["480", "800"]:
    src_dir = CATALOG_DIR / size
    count = 0
    for src in sorted(src_dir.glob("*.jpeg")):
        dst = src.with_suffix(".webp")
        try:
            convert(src, dst)
            count += 1
        except Exception as e:
            errors.append(f"{src}: {e}")
    print(f"{size}/: converted {count} files")

# --- 2000 → 1400: resize + convert, new folder ---
src_dir = CATALOG_DIR / "2000"
dst_dir = CATALOG_DIR / "1400"
dst_dir.mkdir(exist_ok=True)
count = 0
for src in sorted(src_dir.glob("*.jpeg")):
    dst_name = rename_size(src.name, "2000", "1400")
    dst = dst_dir / dst_name
    try:
        convert(src, dst, max_width=1400)
        count += 1
    except Exception as e:
        errors.append(f"{src}: {e}")
print(f"2000/ → 1400/: converted {count} files")

if errors:
    print(f"\n{len(errors)} error(s):")
    for e in errors:
        print(f"  {e}")
else:
    print("\nAll done. Verify output, then run:")
    print("  git rm assets/img/catalog/480/*.jpeg assets/img/catalog/800/*.jpeg")
    print("  git rm -r assets/img/catalog/2000/")
