"""
Convert event photos (JPG) to WebP at three sizes.

Usage (run from repo root):
    python scripts/convert_events.py assets/img/events/la-choza-studio

Output structure:
    {folder}/480/{name}-480.webp
    {folder}/800/{name}-800.webp
    {folder}/1400/{name}-1400.webp

After verifying output, remove the original JPGs:
    git rm assets/img/events/la-choza-studio/*.jpg
"""

import sys
from pathlib import Path
from PIL import Image, ImageOps

SIZES = [480, 800, 1400]
QUALITY = 85


def convert(src: Path, dst: Path, max_width: int):
    img = Image.open(src)
    img = ImageOps.exif_transpose(img)
    if img.width > max_width:
        img.thumbnail((max_width, max_width * 4))
    img.save(dst, "WEBP", quality=QUALITY)


def process_folder(folder: Path):
    jpgs = sorted(folder.glob("*.jpg")) + sorted(folder.glob("*.jpeg"))
    if not jpgs:
        print(f"No JPG files found in {folder}")
        return

    for size in SIZES:
        (folder / str(size)).mkdir(exist_ok=True)

    errors = []
    for src in jpgs:
        stem = src.stem
        for size in SIZES:
            dst = folder / str(size) / f"{stem}-{size}.webp"
            try:
                convert(src, dst, max_width=size)
                print(f"  {dst}")
            except Exception as e:
                errors.append(f"{src}: {e}")

    if errors:
        print(f"\n{len(errors)} error(s):")
        for e in errors:
            print(f"  {e}")
    else:
        print(f"\nDone. Converted {len(jpgs)} image(s) to {len(SIZES)} sizes each.")
        print(f"\nVerify output, then remove originals:")
        print(f"  git rm {folder}/*.jpg")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python scripts/convert_events.py <event-folder>")
        sys.exit(1)
    process_folder(Path(sys.argv[1]))
