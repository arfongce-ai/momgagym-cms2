"""Extract local review frames from approved instructor folders; outputs contain no names."""
from __future__ import annotations

import argparse
import html
import json
import sys
from datetime import datetime
from pathlib import Path

from media_common import MediaError, is_link_or_junction, iter_approved_videos, local_directory, video_identifier


def has_large_frontal_face(boxes, frame_width: int, frame_height: int) -> bool:
    """Conservative Haar-box filter; human review remains required for profile/partial faces."""
    for box in boxes:
        x, y, width, height = (int(value) for value in box)
        if width <= 0 or height <= 0:
            continue
        if height / frame_height >= 0.18 or (width * height) / (frame_width * frame_height) >= 0.045:
            return True
    return False


def _safe_save_frame(cv2, frame, target: Path) -> None:
    if frame is None or target.exists() or is_link_or_junction(target):
        raise MediaError("UNKNOWN")
    height, width = frame.shape[:2]
    largest = max(width, height)
    if largest > 1600:
        scale = 1600 / largest
        frame = cv2.resize(frame, (round(width * scale), round(height * scale)), interpolation=cv2.INTER_AREA)
    if not cv2.imwrite(str(target), frame, [int(cv2.IMWRITE_JPEG_QUALITY), 90]):
        raise MediaError("UNKNOWN")


def _write_contact_sheet(run_dir: Path, records: list[dict]) -> None:
    cards = []
    for record in records:
        image_name = html.escape(record["image"], quote=True)
        cards.append(
            f'<figure><img loading="lazy" src="{image_name}" alt="후보 {record["number"]}">'
            f'<figcaption>{record["number"]}</figcaption></figure>'
        )
    page = """<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>로컬 후보 컨택트 시트</title><style>
body{font-family:system-ui,sans-serif;margin:16px;background:#f3f5f4;color:#173d35}main{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px}
figure{margin:0;background:white;border-radius:8px;padding:8px;box-shadow:0 1px 5px #0002}img{width:100%;aspect-ratio:4/3;object-fit:contain;background:#222}figcaption{text-align:center;font-weight:700;padding:6px}
</style><h1>후보 프레임 · 번호로 5개 선택</h1><main>""" + "".join(cards) + "</main></html>"
    (run_dir / "contact_sheet.html").write_text(page, encoding="utf-8")


def extract(media_root: Path, output_root: Path, *, interval_seconds: float = 3.0,
            include_education: bool = False, cv2_module=None) -> int:
    if interval_seconds <= 0:
        raise MediaError("UNKNOWN")
    try:
        if cv2_module is None:
            import cv2 as cv2_module
    except Exception as error:
        raise MediaError("NO_VIDEO") from error
    cascade_path = Path(cv2_module.data.haarcascades) / "haarcascade_frontalface_default.xml"
    cascade = cv2_module.CascadeClassifier(str(cascade_path))
    if cascade.empty():
        raise MediaError("NO_VIDEO")

    now = datetime.now()
    date_dir = output_root / now.strftime("%Y%m%d")
    run_dir = date_dir / ("run-" + now.strftime("%H%M%S"))
    if is_link_or_junction(output_root) or is_link_or_junction(date_dir) or is_link_or_junction(run_dir):
        raise MediaError("UNKNOWN")
    run_dir.mkdir(parents=True, exist_ok=False)
    records: list[dict] = []
    seen_ids: set[str] = set()
    for source in iter_approved_videos(media_root, include_education=include_education):
        clip_id = video_identifier(source, media_root)
        if clip_id in seen_ids:
            raise MediaError("UNKNOWN")
        seen_ids.add(clip_id)
        capture = cv2_module.VideoCapture(str(source))
        try:
            if not capture.isOpened():
                continue
            fps = float(capture.get(cv2_module.CAP_PROP_FPS))
            if fps <= 0:
                continue
            step = max(1, round(interval_seconds * fps))
            frame_index = 0
            while True:
                ok, frame = capture.read()
                if not ok:
                    break
                if frame_index % step == 0:
                    height, width = frame.shape[:2]
                    gray = cv2_module.cvtColor(frame, cv2_module.COLOR_BGR2GRAY)
                    faces = cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=5, minSize=(48, 48))
                    if not has_large_frontal_face(faces, width, height):
                        timestamp_ms = round(frame_index * 1000 / fps)
                        image_name = f"c_{clip_id[2:]}_t{timestamp_ms:010d}.jpg"
                        _safe_save_frame(cv2_module, frame, run_dir / image_name)
                        records.append({
                            "number": len(records) + 1,
                            "candidate_id": image_name[:-4],
                            "image": image_name,
                            "clip_id": clip_id,
                            "timestamp_ms": timestamp_ms,
                        })
                frame_index += 1
        finally:
            capture.release()

    if not records:
        raise MediaError("NO_VIDEO")
    _write_contact_sheet(run_dir, records)
    (run_dir / "candidates.json").write_text(
        json.dumps({"candidates": records}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return len(records)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--media-root", required=True)
    parser.add_argument("--output-root", required=True)
    parser.add_argument("--interval-seconds", type=float, default=3.0)
    parser.add_argument("--include-education", action="store_true")
    args = parser.parse_args(argv)
    try:
        media_root = local_directory(args.media_root)
        output_root = local_directory(args.output_root, output=True)
        count = extract(media_root, output_root, interval_seconds=args.interval_seconds,
                        include_education=args.include_education)
        print(f"CANDIDATES:{count}")
        return 0
    except MediaError as error:
        print(error.code)
        return 2
    except Exception:
        print("UNKNOWN")
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
