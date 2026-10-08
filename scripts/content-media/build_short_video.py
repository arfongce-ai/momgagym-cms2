"""Render a silent, locally reviewed 15–20 second portrait video from selected source segments."""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
from pathlib import Path

from build_post_images import PHRASES
from media_common import ARTICLE_ID_RE, MediaError, VIDEO_ID_RE, build_video_map, is_link_or_junction, local_directory


def _stamp(seconds: float) -> str:
    whole = int(seconds * 1000)
    hours, rem = divmod(whole, 3_600_000)
    minutes, rem = divmod(rem, 60_000)
    secs, millis = divmod(rem, 1000)
    return f"{hours:02}:{minutes:02}:{secs:02},{millis:03}"


def validate_segments(selection: dict) -> tuple[list[dict], float]:
    segments = selection.get("segments") if isinstance(selection, dict) else None
    if not isinstance(segments, list) or len(segments) not in (3, 4):
        raise MediaError("NO_VIDEO")
    normalized = []
    total = 0.0
    for segment in segments:
        if not isinstance(segment, dict):
            raise MediaError("NO_VIDEO")
        clip_id, start, end = segment.get("clip_id"), segment.get("start_sec"), segment.get("end_sec")
        if not isinstance(clip_id, str) or not VIDEO_ID_RE.fullmatch(clip_id):
            raise MediaError("NO_VIDEO")
        if isinstance(start, bool) or isinstance(end, bool) or not isinstance(start, (int, float)) or not isinstance(end, (int, float)):
            raise MediaError("NO_VIDEO")
        duration = float(end) - float(start)
        if start < 0 or duration <= 0:
            raise MediaError("NO_VIDEO")
        total += duration
        normalized.append({"clip_id": clip_id, "start_sec": float(start), "end_sec": float(end), "duration": duration})
    if not 15 <= total <= 20:
        raise MediaError("NO_VIDEO")
    return normalized, total


def _write_srt(path: Path, duration: float) -> None:
    end_card_seconds = min(3.0, duration * 0.18)
    phrase_duration = (duration - end_card_seconds) / 4
    rows = []
    for index, phrase in enumerate(PHRASES):
        start = index * phrase_duration if index < 4 else duration - end_card_seconds
        end = (index + 1) * phrase_duration if index < 4 else duration
        rows.extend([str(index + 1), f"{_stamp(start)} --> {_stamp(end)}", phrase, ""])
    path.write_text("\n".join(rows), encoding="utf-8-sig")


def _filter_path(path: Path) -> str:
    value = path.resolve().as_posix()
    return value.replace("\\", "\\\\").replace(":", "\\:").replace("'", "\\'").replace(",", "\\,")


def _probe_duration(ffprobe: str, source: Path) -> float:
    try:
        result = subprocess.run(
            [ffprobe, "-v", "error", "-show_entries", "format=duration", "-of", "json", str(source)],
            capture_output=True, text=True, timeout=30, check=False,
        )
        if result.returncode != 0:
            raise MediaError("NO_VIDEO")
        value = json.loads(result.stdout).get("format", {}).get("duration")
        duration = float(value)
        if duration <= 0:
            raise MediaError("NO_VIDEO")
        return duration
    except MediaError:
        raise
    except Exception as error:
        raise MediaError("NO_VIDEO") from error


def render(media_root: Path, output_dir: Path, selection_path: Path, article_id: str,
           font_path: Path, *, include_education: bool = False, dry_run: bool = False,
           ffmpeg: str | None = None, ffprobe: str | None = None) -> dict:
    if not ARTICLE_ID_RE.fullmatch(article_id) or not font_path.is_file() or is_link_or_junction(font_path):
        raise MediaError("UNKNOWN")
    try:
        if is_link_or_junction(selection_path):
            raise MediaError("NO_VIDEO")
        selection = json.loads(selection_path.read_text(encoding="utf-8"))
    except Exception as error:
        raise MediaError("NO_VIDEO") from error
    segments, duration = validate_segments(selection)
    videos = build_video_map(media_root, include_education=include_education)
    if any(segment["clip_id"] not in videos for segment in segments):
        raise MediaError("NO_VIDEO")
    output_dir = local_directory(output_dir, output=True)
    if is_link_or_junction(output_dir):
        raise MediaError("UNKNOWN")
    output_file = output_dir / f"{article_id}.mp4"
    subtitle_file = output_dir / f"{article_id}.srt"
    review_file = output_dir / f"{article_id}.review.json"
    if any(path.exists() or is_link_or_junction(path) for path in (output_file, subtitle_file, review_file)):
        raise MediaError("UNKNOWN")
    if dry_run:
        return {"dry_run": True, "segments": len(segments), "duration": duration}
    ffmpeg = ffmpeg or shutil.which("ffmpeg")
    ffprobe = ffprobe or shutil.which("ffprobe")
    if not ffmpeg or not ffprobe:
        raise MediaError("NO_VIDEO")
    for segment in segments:
        source_duration = _probe_duration(ffprobe, videos[segment["clip_id"]])
        if segment["end_sec"] > source_duration:
            raise MediaError("NO_VIDEO")
    output_dir.mkdir(parents=True, exist_ok=True)

    command = [ffmpeg, "-hide_banner", "-loglevel", "error", "-y"]
    filters = []
    labels = []
    for index, segment in enumerate(segments):
        command.extend(["-ss", f"{segment['start_sec']:.3f}", "-t", f"{segment['duration']:.3f}", "-i", str(videos[segment["clip_id"]])])
        filters.append(
            f"[{index}:v]trim=duration={segment['duration']:.3f},setpts=PTS-STARTPTS,"
            "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1"
            f"[v{index}]"
        )
        labels.append(f"[v{index}]")
    filters.append(f"{''.join(labels)}concat=n={len(segments)}:v=1:a=0[vcat]")
    subtitle_filter = (
        f"[vcat]subtitles=filename='{_filter_path(subtitle_file)}':"
        f"fontsdir='{_filter_path(font_path.parent)}':"
        "force_style='FontName=Gowun Dodum,FontSize=36,Outline=2,Shadow=1,MarginV=120,Alignment=2'[outv]"
    )
    filters.append(subtitle_filter)
    command.extend([
        "-filter_complex", ";".join(filters), "-map", "[outv]", "-an", "-t", f"{duration:.3f}",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-pix_fmt", "yuv420p",
        "-movflags", "+faststart", str(output_file),
    ])
    _write_srt(subtitle_file, duration)
    try:
        completed = subprocess.run(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=900, check=False)
    except Exception as error:
        subtitle_file.unlink(missing_ok=True)
        raise MediaError("NO_VIDEO") from error
    if completed.returncode != 0 or not output_file.is_file() or output_file.stat().st_size == 0:
        output_file.unlink(missing_ok=True)
        subtitle_file.unlink(missing_ok=True)
        raise MediaError("NO_VIDEO")
    digest = hashlib.sha256(output_file.read_bytes()).hexdigest()
    result = {"publishAllowed": False, "review_required": True, "duration_seconds": round(duration, 3),
              "width": 1080, "height": 1920, "sha256": digest}
    review_file.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    return result


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--media-root", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--selection", required=True)
    parser.add_argument("--article-id", required=True)
    parser.add_argument("--font", required=True)
    parser.add_argument("--include-education", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)
    try:
        result = render(local_directory(args.media_root), local_directory(args.output_dir, output=True),
                        local_directory(args.selection), args.article_id, local_directory(args.font),
                        include_education=args.include_education, dry_run=args.dry_run)
        print(f"DRY_RUN:SEGMENTS_{result['segments']}" if args.dry_run else f"VIDEO:{result['duration_seconds']}")
        return 0
    except MediaError as error:
        print(error.code)
        return 2
    except Exception:
        print("UNKNOWN")
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
