"""Build article images and a review-only portrait video from local approved media."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from auto_select_frames import select
from build_post_images import build as build_images
from build_short_video import render as build_video
from extract_candidates import extract
from media_common import MediaError, is_link_or_junction, local_directory


def _video_segments(details: list[dict]) -> list[dict]:
    eligible = []
    used = set()
    for item in details:
        clip_id = item.get("clip_id")
        duration = max(0.0, item.get("source_duration_ms", 0) / 1000 - 0.15)
        if not isinstance(clip_id, str) or clip_id in used or duration < 4:
            continue
        eligible.append((item, duration))
        used.add(clip_id)
    segment_length = 4.0 if len(eligible) >= 4 else 5.0
    eligible = [(item, duration) for item, duration in eligible if duration >= segment_length][:4 if segment_length == 4 else 3]
    if len(eligible) < (4 if segment_length == 4 else 3):
        raise MediaError("NO_VIDEO")
    segments = []
    for item, duration in eligible:
        center = max(0.0, item.get("timestamp_ms", 0) / 1000)
        start = min(max(0.0, center - segment_length / 2), duration - segment_length)
        segments.append({"clip_id": item["clip_id"], "start_sec": round(start, 3),
                         "end_sec": round(start + segment_length, 3)})
    return segments


def run(media_root: Path, image_root: Path, review_root: Path, font_path: Path,
        article_id: str, *, max_videos: int = 100, include_education: bool = False,
        pose_model_dir: Path | None = None, cv2_module=None,
        ffmpeg: str | None = None, ffprobe: str | None = None) -> dict:
    candidates_root = image_root / "후보"
    count = extract(media_root, candidates_root, interval_seconds=3.0,
                    include_education=include_education, max_videos=max_videos,
                    max_samples_per_video=12, cv2_module=cv2_module)
    date_dir = max(candidates_root.iterdir(), key=lambda item: item.name)
    run_dirs = [path for path in date_dir.iterdir() if path.is_dir() and path.name.startswith("run-")]
    if not run_dirs:
        raise MediaError("NO_VIDEO")
    candidate_dir = max(run_dirs, key=lambda item: item.name)
    selection_result = select(candidate_dir, cv2_module=cv2_module, pose_model_dir=pose_model_dir)
    image_results = build_images(candidate_dir, candidate_dir / "selection.json", image_root,
                                 article_id, font_path)
    video_selection_path = candidate_dir / "video-selection.json"
    video_selection_path.write_text(
        json.dumps({"segments": _video_segments(selection_result["details"])}, indent=2) + "\n",
        encoding="utf-8",
    )
    video_result = build_video(media_root, review_root, video_selection_path, article_id, font_path,
                               include_education=include_education, ffmpeg=ffmpeg, ffprobe=ffprobe)
    return {"candidate_count": count, "image_count": len(image_results), "video": video_result,
            "selection_count": len(selection_result["details"])}


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--media-root", required=True)
    parser.add_argument("--image-root", required=True)
    parser.add_argument("--review-root", required=True)
    parser.add_argument("--font", required=True)
    parser.add_argument("--article-id", required=True)
    parser.add_argument("--max-videos", type=int, default=100)
    parser.add_argument("--pose-model-dir", required=True)
    parser.add_argument("--include-education", action="store_true")
    args = parser.parse_args(argv)
    try:
        result = run(local_directory(args.media_root), local_directory(args.image_root, output=True),
                     local_directory(args.review_root, output=True), local_directory(args.font),
                     args.article_id, max_videos=args.max_videos, include_education=args.include_education,
                     pose_model_dir=local_directory(args.pose_model_dir) if args.pose_model_dir else None)
        print(f"CANDIDATES:{result['candidate_count']}")
        print(f"IMAGES:{result['image_count']}")
        print(f"VIDEO:{result['video'].get('duration_seconds', 0)}")
        print(f"PUBLISH_ALLOWED:{str(result['video'].get('publishAllowed', False)).lower()}")
        return 0
    except MediaError as error:
        print(error.code)
        return 2
    except Exception:
        print("UNKNOWN")
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
