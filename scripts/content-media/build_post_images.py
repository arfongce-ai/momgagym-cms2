"""Build five 1200px local Tistory images from human-selected candidate frame numbers."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

from media_common import ARTICLE_ID_RE, CANDIDATE_ID_RE, MediaError, is_link_or_junction, local_directory

PHRASES = [
    "느낌은 날마다 달라집니다",
    "좌우 차이부터 확인해요",
    "관절 움직임도 각도로 봅니다",
    "같은 기준으로 다시 비교해요",
    "네이버에서 '몸가짐운동센터' 검색",
]
DEFAULT_POSITIONS = ["top", "top", "bottom", "bottom", "center"]
SLOT_KEYS = ["01", "02", "03", "04", "05"]


def _load_selections(candidate_dir: Path, selection_file: Path) -> list[tuple[Path, str]]:
    try:
        manifest_path = candidate_dir / "candidates.json"
        if is_link_or_junction(manifest_path):
            raise MediaError("UNKNOWN")
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        selection = json.loads(selection_file.read_text(encoding="utf-8"))
    except MediaError:
        raise
    except Exception as error:
        raise MediaError("IMG_COUNT") from error
    records = manifest.get("candidates") if isinstance(manifest, dict) else None
    slots = selection.get("slots") if isinstance(selection, dict) else None
    if not isinstance(records, list) or not isinstance(slots, dict) or set(slots) != set(SLOT_KEYS):
        raise MediaError("IMG_COUNT")
    by_number = {str(item.get("number")): item for item in records if isinstance(item, dict)}
    by_id = {item.get("candidate_id"): item for item in records if isinstance(item, dict)}
    by_file = {item.get("image"): item for item in records if isinstance(item, dict)}
    chosen = []
    identities = set()
    for slot in SLOT_KEYS:
        value = slots[slot]
        record = by_number.get(str(value)) if isinstance(value, (int, str)) else None
        if record is None and isinstance(value, str):
            record = by_id.get(value) or by_file.get(value)
        if record is None:
            raise MediaError("IMG_COUNT")
        identity = record.get("candidate_id")
        image_name = record.get("image")
        if not isinstance(identity, str) or not CANDIDATE_ID_RE.fullmatch(identity) or identity in identities or not isinstance(image_name, str):
            raise MediaError("IMG_COUNT")
        if Path(image_name).name != image_name or Path(image_name).suffix.lower() not in {".jpg", ".jpeg", ".png"} or Path(image_name).stem != identity:
            raise MediaError("UNKNOWN")
        image_path = candidate_dir / image_name
        if is_link_or_junction(image_path) or not image_path.is_file():
            raise MediaError("IMG_COUNT")
        identities.add(identity)
        chosen.append((image_path, identity))
    return chosen


def _fit_font(draw, font_path: Path, text: str, max_width: int):
    from PIL import ImageFont
    for size in range(58, 27, -2):
        font = ImageFont.truetype(str(font_path), size=size)
        box = draw.textbbox((0, 0), text, font=font, stroke_width=1)
        if box[2] - box[0] <= max_width:
            return font, box
    raise MediaError("UNKNOWN")


def _compose(source: Path, target: Path, phrase: str, position: str, font_path: Path, logo_path: Path | None):
    from PIL import Image, ImageDraw
    with Image.open(source) as opened:
        image = opened.convert("RGB")
    width, height = image.size
    if width <= 0 or height <= 0:
        raise MediaError("UNKNOWN")
    side = min(width, height)
    left, top = (width - side) // 2, (height - side) // 2
    image = image.crop((left, top, left + side, top + side)).resize((1200, 1200), Image.Resampling.LANCZOS).convert("RGBA")
    overlay = Image.new("RGBA", image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    font, bbox = _fit_font(draw, font_path, phrase, 1040)
    text_width, text_height = bbox[2] - bbox[0], bbox[3] - bbox[1]
    band_height = text_height + 52
    band_y = {"top": 72, "center": (1200 - band_height) // 2, "bottom": 1128 - band_height}[position]
    draw.rounded_rectangle((48, band_y, 1152, band_y + band_height), radius=18, fill=(255, 255, 255, 222))
    x = (1200 - text_width) // 2 - bbox[0]
    y = band_y + (band_height - text_height) // 2 - bbox[1]
    draw.text((x, y), phrase, font=font, fill=(24, 57, 50, 255), stroke_width=1, stroke_fill=(255, 255, 255, 255))
    image = Image.alpha_composite(image, overlay)
    if logo_path is not None:
        with Image.open(logo_path) as logo_opened:
            logo = logo_opened.convert("RGBA")
        logo.thumbnail((112, 112), Image.Resampling.LANCZOS)
        alpha = logo.getchannel("A").point(lambda value: round(value * 0.82))
        logo.putalpha(alpha)
        image.alpha_composite(logo, (1200 - logo.width - 38, 36))
    image.convert("RGB").save(target, format="PNG", optimize=True)


def build(candidate_dir: Path, selection_file: Path, output_root: Path, article_id: str,
          font_path: Path, positions: list[str] | None = None, logo_path: Path | None = None) -> list[dict]:
    if not ARTICLE_ID_RE.fullmatch(article_id):
        raise MediaError("UNKNOWN")
    if not font_path.is_file() or is_link_or_junction(font_path):
        raise MediaError("UNKNOWN")
    selected = _load_selections(candidate_dir, selection_file)
    if positions is None:
        positions = DEFAULT_POSITIONS
    if len(positions) != 5 or any(value not in {"top", "center", "bottom"} for value in positions):
        raise MediaError("UNKNOWN")
    if logo_path is not None and (not logo_path.is_file() or is_link_or_junction(logo_path)):
        raise MediaError("UNKNOWN")
    article_dir = output_root / article_id
    final_dir = article_dir / "final"
    if is_link_or_junction(article_dir) or is_link_or_junction(final_dir) or final_dir.exists():
        raise MediaError("UNKNOWN")
    final_dir.mkdir(parents=True, exist_ok=False)
    outputs = []
    for index, ((source, candidate_id), phrase, position) in enumerate(zip(selected, PHRASES, positions), start=1):
        name = f"{index:02d}.png"
        target = final_dir / name
        _compose(source, target, phrase, position, font_path, logo_path)
        digest = hashlib.sha256(target.read_bytes()).hexdigest()
        outputs.append({"file": name, "sha256": digest, "width": 1200, "height": 1200})
    (final_dir / "hashes.json").write_text(json.dumps({"images": outputs}, indent=2) + "\n", encoding="utf-8")
    return outputs


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--candidate-dir", required=True)
    parser.add_argument("--selection", required=True)
    parser.add_argument("--output-root", required=True)
    parser.add_argument("--article-id", required=True)
    parser.add_argument("--font", required=True)
    parser.add_argument("--logo")
    args = parser.parse_args(argv)
    try:
        outputs = build(
            local_directory(args.candidate_dir), local_directory(args.selection),
            local_directory(args.output_root, output=True), args.article_id,
            local_directory(args.font), logo_path=local_directory(args.logo) if args.logo else None,
        )
        print(f"IMAGES:{len(outputs)}")
        return 0
    except MediaError as error:
        print(error.code)
        return 2
    except Exception:
        print("UNKNOWN")
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
