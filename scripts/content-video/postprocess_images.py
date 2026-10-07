"""Local, offline post-processing for five already generated blog images."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import stat
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps

FINAL_LINE = "네이버에서 '몸가짐운동센터' 검색"
PHONE_RE = re.compile(r"(?<!\d)(?:\+?\d[\d ()-]{7,}\d)(?!\d)")
URL_RE = re.compile(r"(?:https?://|www\.)\S+", re.IGNORECASE)
IMAGE_NAMES = tuple(f"{index:02d}.png" for index in range(1, 6))
CANVAS = 1080


class ImageJobError(Exception):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def is_link_or_junction(path: Path) -> bool:
    try:
        mode = path.lstat().st_mode
    except OSError:
        return False
    is_junction = getattr(os.path, "isjunction", lambda _path: False)
    return stat.S_ISLNK(mode) or is_junction(path)


def wrap_pixels(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.FreeTypeFont, max_width: int) -> list[str]:
    lines: list[str] = []
    line = ""
    for char in text:
        candidate = line + char
        if line and draw.textbbox((0, 0), candidate, font=font)[2] > max_width:
            lines.append(line)
            line = char
        else:
            line = candidate
    if line:
        lines.append(line)
    return lines


POSITIONS = ("top", "center", "bottom")


def draw_caption(image: Image.Image, phrase: str, font_path: Path, position: str = "bottom") -> None:
    draw = ImageDraw.Draw(image, "RGBA")
    max_width = int(CANVAS * 0.82)
    top = int(CANVAS * 0.68)
    available_height = int(CANVAS * 0.25)
    for size in range(58, 23, -2):
        font = ImageFont.truetype(str(font_path), size=size)
        lines = wrap_pixels(draw, phrase, font, max_width)
        line_height = max(draw.textbbox((0, 0), line, font=font)[3] for line in lines) + 12
        if line_height * len(lines) <= available_height:
            break
    else:
        raise ImageJobError("TEXT_OVERFLOW")
    pad_x, pad_y = 36, 26
    text_height = line_height * len(lines) - 12
    box_height = text_height + pad_y * 2
    if position == "top":
        box_top = 48
    elif position == "center":
        box_top = (CANVAS - box_height) // 2
    else:
        box_top = min(CANVAS - box_height - 32, max(top, CANVAS - box_height - 42))
    draw.rounded_rectangle((48, box_top, CANVAS - 48, box_top + box_height), radius=22, fill=(255, 255, 255, 238))
    y = box_top + pad_y
    for line in lines:
        draw.text((pad_x + 48, y), line, font=font, fill=(20, 55, 47, 255), stroke_width=0)
        y += line_height


def composite_logo(image: Image.Image, logo_path: Path | None) -> None:
    if logo_path is None:
        return
    if not Path(logo_path).is_file() or is_link_or_junction(Path(logo_path)):
        raise ImageJobError("PATH_REJECTED")
    try:
        with Image.open(logo_path) as opened:
            logo = ImageOps.exif_transpose(opened).convert("RGBA")
            logo.thumbnail((120, 120), Image.Resampling.LANCZOS)
            image.alpha_composite(logo, (CANVAS - logo.width - 38, 32))
    except Exception as error:
        raise ImageJobError("IMAGE_READ") from error


def crop_square(image: Image.Image) -> Image.Image:
    width, height = image.size
    side = min(width, height)
    left = (width - side) // 2
    top = (height - side) // 2
    return image.crop((left, top, left + side, top + side)).resize((CANVAS, CANVAS), Image.Resampling.LANCZOS)


def read_positions(path: Path) -> list[str]:
    """Optional `positions` (top/center/bottom x5) in the phrase plan; default is all bottom."""
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception as error:
        raise ImageJobError("PHRASE_PLAN") from error
    return read_positions_from_payload(payload)


def read_positions_from_payload(payload: dict) -> list[str]:
    positions = payload.get("positions") if isinstance(payload, dict) else None
    if positions is None:
        return ["bottom"] * 5
    if not isinstance(positions, list) or len(positions) != 5 or any(item not in POSITIONS for item in positions):
        raise ImageJobError("PHRASE_PLAN")
    return list(positions)


def read_phrases(path: Path) -> list[str]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception as error:
        raise ImageJobError("PHRASE_PLAN") from error
    return read_phrases_from_payload(payload)


def read_phrases_from_payload(payload: dict) -> list[str]:
    phrases = payload.get("phrases") if isinstance(payload, dict) else None
    if not isinstance(phrases, list) or len(phrases) != 5 or any(not isinstance(item, str) or not item.strip() for item in phrases):
        raise ImageJobError("PHRASE_COUNT")
    cleaned = [item.strip() for item in phrases]
    if cleaned[-1] != FINAL_LINE:
        raise ImageJobError("PHRASE_PLAN")
    for phrase in cleaned[:-1]:
        if PHONE_RE.search(phrase) or URL_RE.search(phrase) or "몸가짐운동센터" in phrase:
            raise ImageJobError("PHRASE_PLAN")
    return cleaned


def _hash(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def process_images(input_dir: Path, phrases_file: Path, font_file: Path, logo_file: Path | None = None) -> dict:
    input_dir = Path(input_dir)
    if is_link_or_junction(input_dir) or not input_dir.is_dir():
        raise ImageJobError("PATH_REJECTED")
    try:
        phrases = read_phrases(Path(phrases_file))
        positions = read_positions(Path(phrases_file))
    except ImageJobError:
        raise
    if not Path(font_file).is_file() or Path(font_file).is_symlink():
        raise ImageJobError("FONT_MISSING")
    sources = [input_dir / name for name in IMAGE_NAMES]
    if any(not path.is_file() or is_link_or_junction(path) for path in sources):
        raise ImageJobError("IMG_COUNT")
    final_dir = input_dir / "final"
    if is_link_or_junction(final_dir):
        raise ImageJobError("PATH_REJECTED")

    staged_dir = Path(tempfile.mkdtemp(prefix="image-final-", dir=input_dir))
    try:
        for source, phrase, position in zip(sources, phrases, positions):
            try:
                with Image.open(source) as opened:
                    image = crop_square(ImageOps.exif_transpose(opened).convert("RGB"))
            except ImageJobError:
                raise
            except Exception as error:
                raise ImageJobError("IMAGE_READ") from error
            image = image.convert("RGBA")
            composite_logo(image, Path(logo_file) if logo_file else None)
            draw_caption(image, phrase, Path(font_file), position)
            image.save(staged_dir / source.name, format="PNG", optimize=True)
        files = [{"name": name, "sha256": _hash(staged_dir / name), "width": CANVAS, "height": CANVAS} for name in IMAGE_NAMES]
        (staged_dir / "hashes.json").write_text(json.dumps({"version": 1, "files": files}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        final_dir.mkdir(exist_ok=True)
        if is_link_or_junction(final_dir) or not final_dir.is_dir():
            raise ImageJobError("PATH_REJECTED")
        for name in (*IMAGE_NAMES, "hashes.json"):
            os.replace(staged_dir / name, final_dir / name)
        return {"count": len(files), "hashes": [item["sha256"] for item in files]}
    finally:
        shutil.rmtree(staged_dir, ignore_errors=True)


def main() -> int:
    parser = argparse.ArgumentParser(description="Apply five approved Korean captions to local square images.")
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--phrases", required=True, type=Path)
    parser.add_argument("--font", required=True, type=Path)
    parser.add_argument("--logo", type=Path, help="Optional small local transparent logo image.")
    args = parser.parse_args()
    try:
        result = process_images(args.input, args.phrases, args.font, args.logo)
        print(f"IMAGES:{result['count']}")
        print("SHA256:" + ",".join(result["hashes"]))
        return 0
    except ImageJobError as error:
        print(error.code, file=sys.stderr)
        return 1
    except Exception:
        print("UNKNOWN", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
