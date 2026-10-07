"""Select a Claude-declared five-image download batch and finalize it locally."""
from __future__ import annotations

import argparse
import importlib.util
import json
import os
import re
import shutil
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

NOTION_ORIGIN = "https://api.notion.com"
NOTION_VERSION = "2026-03-11"
PAGE_ID_RE = re.compile(r"^[0-9a-f]{32}$|^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)
ARTICLE_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")
ALLOWED_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp"}
PLAN_MARKER = "IMAGE_PLAN_JSON"


class JobError(Exception):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def load_processor():
    path = Path(__file__).resolve().parents[1] / "content-video" / "postprocess_images.py"
    spec = importlib.util.spec_from_file_location("image_postprocess", path)
    if spec is None or spec.loader is None:
        raise JobError("PROCESSOR")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def read_job(path: Path) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except Exception as error:
        raise JobError("JOB_FILE") from error
    if not isinstance(value, dict):
        raise JobError("JOB_FILE")
    article_id, page_id, files = value.get("article_id"), value.get("notion_page_id"), value.get("source_files")
    if not isinstance(article_id, str) or not ARTICLE_ID_RE.fullmatch(article_id) or not isinstance(page_id, str) or not PAGE_ID_RE.fullmatch(page_id):
        raise JobError("JOB_FILE")
    if not isinstance(files, list) or len(files) != 5 or any(not isinstance(name, str) for name in files) or len(set(files)) != 5:
        raise JobError("IMG_COUNT")
    for name in files:
        if not isinstance(name, str) or Path(name).name != name or Path(name).suffix.lower() not in ALLOWED_SUFFIXES:
            raise JobError("JOB_FILE")
    return {"article_id": article_id, "notion_page_id": page_id, "source_files": files}


def _get_json(url: str, token: str) -> dict:
    request = urllib.request.Request(url, headers={
        "Authorization": f"Bearer {token}",
        "Notion-Version": NOTION_VERSION,
        "Accept": "application/json",
    })
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            if urllib.parse.urlsplit(response.geturl()).netloc != "api.notion.com":
                raise JobError("NOTION")
            payload = json.loads(response.read().decode("utf-8"))
    except JobError:
        raise
    except Exception as error:
        raise JobError("NOTION") from error
    if not isinstance(payload, dict):
        raise JobError("NOTION")
    return payload


def get_comments(page_id: str, token: str) -> list[dict]:
    cursor = None
    comments = []
    while True:
        query = {"block_id": page_id, "page_size": "100"}
        if cursor:
            query["start_cursor"] = cursor
        page = _get_json(f"{NOTION_ORIGIN}/v1/comments?{urllib.parse.urlencode(query)}", token)
        results = page.get("results")
        if not isinstance(results, list):
            raise JobError("NOTION")
        comments.extend(item for item in results if isinstance(item, dict))
        if not page.get("has_more"):
            return comments
        cursor = page.get("next_cursor")
        if not isinstance(cursor, str) or not cursor:
            raise JobError("NOTION")


def read_plan(comments: list[dict]) -> dict:
    valid = []
    processor = load_processor()
    for comment in comments:
        text = "".join(part.get("plain_text", "") for part in comment.get("rich_text", []) if isinstance(part, dict))
        if PLAN_MARKER not in text:
            continue
        try:
            encoded = text.split(PLAN_MARKER, 1)[1].strip()
            payload = json.loads(encoded)
            phrases = processor.read_phrases_from_payload(payload)
            positions = processor.read_positions_from_payload(payload)
            valid.append({"phrases": phrases, "positions": positions})
        except Exception:
            raise JobError("PHRASE_PLAN")
    if len(valid) != 1:
        raise JobError("PHRASE_PLAN")
    return valid[0]


def validate_sources(downloads: Path, names: list[str], now: datetime | None = None) -> list[Path]:
    if not downloads.is_dir() or downloads.is_symlink():
        raise JobError("DOWNLOADS")
    now = now or datetime.now(timezone.utc)
    sources = []
    for name in names:
        source = downloads / name
        if source.is_symlink() or not source.is_file() or source.suffix.lower() not in ALLOWED_SUFFIXES:
            raise JobError("IMG_COUNT")
        modified = datetime.fromtimestamp(source.stat().st_mtime, timezone.utc)
        age = (now - modified).total_seconds()
        if age < -300 or age > 24 * 60 * 60:
            raise JobError("IMG_COUNT")
        sources.append(source)
    return sorted(sources, key=lambda source: (source.stat().st_mtime_ns, source.name.casefold()))


def run(job_file: Path, downloads: Path, output_root: Path, font: Path, token: str, now: datetime | None = None) -> dict:
    if not token or len(token.strip()) < 10:
        raise JobError("NOTION_CONFIG")
    job = read_job(job_file)
    sources = validate_sources(downloads, job["source_files"], now)
    plan = read_plan(get_comments(job["notion_page_id"], token))
    processor = load_processor()
    if not font.is_file() or font.is_symlink():
        raise JobError("FONT_MISSING")
    if processor.is_link_or_junction(output_root):
        raise JobError("PATH_REJECTED")
    article_root = output_root / job["article_id"]
    if processor.is_link_or_junction(article_root):
        raise JobError("PATH_REJECTED")
    if article_root.exists():
        raise JobError("OUTPUT_EXISTS")
    article_root.mkdir(parents=True, exist_ok=True)
    for source, name in zip(sources, processor.IMAGE_NAMES):
        shutil.copy2(source, article_root / name)
    phrase_file = article_root / "image-phrases.generated.local.json"
    phrase_file.write_text(json.dumps(plan, ensure_ascii=False), encoding="utf-8")
    try:
        result = processor.process_images(article_root, phrase_file, font)
    finally:
        phrase_file.unlink(missing_ok=True)
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description="Finalize a declared batch of five local Gemini downloads.")
    parser.add_argument("--job", required=True, type=Path, help="Local job JSON supplied for this article run.")
    parser.add_argument("--downloads", required=True, type=Path)
    parser.add_argument("--output-root", required=True, type=Path)
    parser.add_argument("--font", type=Path, default=Path(os.environ.get("GOWUN_DODUM_FONT", "")))
    args = parser.parse_args()
    try:
        result = run(args.job, args.downloads, args.output_root, args.font, os.environ.get("NOTION_CONTENT_READ_TOKEN", ""))
        print(f"IMAGES:{result['count']}")
        print("SHA256:" + ",".join(result["hashes"]))
        return 0
    except JobError as error:
        print(error.code, file=sys.stderr)
        return 1
    except Exception:
        print("UNKNOWN", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
