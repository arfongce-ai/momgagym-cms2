"""Select a Claude-declared five-image download batch and finalize it locally."""
from __future__ import annotations

import argparse
import hashlib
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
CALENDAR_DATA_SOURCE = "df92dd1a-16db-4d27-b5fe-bf5c15090f90"
GEMINI_NAME_RE = re.compile(r"^Gemini.*\.(png|jpe?g|webp)$", re.I)


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


def read_job(path: Path | None) -> dict:
    """Job JSON is optional. Without it (or with source_files "auto"/missing) the batch is
    discovered: the earliest approved Tistory row in Notion and exactly five recent Gemini downloads."""
    if path is None:
        return {"article_id": None, "notion_page_id": None, "source_files": "auto"}
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except Exception as error:
        raise JobError("JOB_FILE") from error
    if not isinstance(value, dict):
        raise JobError("JOB_FILE")
    article_id, page_id, files = value.get("article_id"), value.get("notion_page_id"), value.get("source_files", "auto")
    if article_id is not None and (not isinstance(article_id, str) or not ARTICLE_ID_RE.fullmatch(article_id)):
        raise JobError("JOB_FILE")
    if page_id is not None and (not isinstance(page_id, str) or not PAGE_ID_RE.fullmatch(page_id)):
        raise JobError("JOB_FILE")
    if files == "auto":
        return {"article_id": article_id, "notion_page_id": page_id, "source_files": "auto"}
    if not isinstance(files, list) or len(files) != 5 or any(not isinstance(name, str) for name in files) or len(set(files)) != 5:
        raise JobError("IMG_COUNT")
    for name in files:
        if Path(name).name != name or Path(name).suffix.lower() not in ALLOWED_SUFFIXES:
            raise JobError("JOB_FILE")
    return {"article_id": article_id, "notion_page_id": page_id, "source_files": files}


def select_recent_gemini(downloads: Path, now: datetime | None = None) -> list[str]:
    """Exactly five Gemini image downloads from the last 24 hours; any other count fails closed
    (a second Gemini run the same day, or a partial batch, must be sorted out by a person)."""
    if not downloads.is_dir() or downloads.is_symlink():
        raise JobError("DOWNLOADS")
    now = now or datetime.now(timezone.utc)
    names = []
    for entry in downloads.iterdir():
        if entry.is_symlink() or not entry.is_file() or not GEMINI_NAME_RE.fullmatch(entry.name):
            continue
        age = (now - datetime.fromtimestamp(entry.stat().st_mtime, timezone.utc)).total_seconds()
        if -300 <= age <= 24 * 60 * 60:
            names.append(entry.name)
    if len(names) != 5:
        raise JobError("IMG_COUNT")
    return names


class _NoRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, file_pointer, code, message, headers, new_url):
        return None


def _post_json(url: str, token: str, body: dict) -> dict:
    """Only the fixed calendar data-source query may use POST (read-only query)."""
    if url != f"{NOTION_ORIGIN}/v1/data_sources/{CALENDAR_DATA_SOURCE}/query":
        raise JobError("NOTION")
    request = urllib.request.Request(url, data=json.dumps(body).encode("utf-8"), method="POST", headers={
        "Authorization": f"Bearer {token}",
        "Notion-Version": NOTION_VERSION,
        "Accept": "application/json",
        "Content-Type": "application/json",
    })
    try:
        opener = urllib.request.build_opener(_NoRedirectHandler)
        with opener.open(request, timeout=20) as response:
            if response.geturl() != url:
                raise JobError("NOTION")
            payload = json.loads(response.read().decode("utf-8"))
    except JobError:
        raise
    except Exception as error:
        raise JobError("NOTION") from error
    if not isinstance(payload, dict):
        raise JobError("NOTION")
    return payload


def find_target_page(token: str, output_root: Path, now: datetime | None = None) -> tuple[str, str]:
    """Earliest approved, unpublished Tistory-post row (same rule the daily Claude routine uses)."""
    cursor = None
    processor = load_processor()
    while True:
        body = {
            "filter": {"and": [
                {"property": "채널", "select": {"equals": "티스토리"}},
                {"property": "콘텐츠 유형", "select": {"equals": "티스토리 글"}},
                {"property": "검수 상태", "select": {"equals": "승인"}},
                {"property": "게시후링크", "url": {"is_empty": True}},
            ]},
            "sorts": [{"property": "발행예정일", "direction": "ascending"}],
            "page_size": 100,
            **({"start_cursor": cursor} if cursor else {}),
        }
        payload = _post_json(f"{NOTION_ORIGIN}/v1/data_sources/{CALENDAR_DATA_SOURCE}/query", token, body)
        if payload.get("request_status", {}).get("type") == "incomplete":
            raise JobError("NOTION")
        results = payload.get("results")
        if not isinstance(results, list):
            raise JobError("NOTION")
        for result in results:
            page_id = result.get("id") if isinstance(result, dict) else None
            if not isinstance(page_id, str) or not PAGE_ID_RE.fullmatch(page_id):
                raise JobError("NOTION")
            if not has_processed_page(output_root, page_id, processor):
                compact = page_id.replace("-", "").lower()
                run_date = (now or datetime.now(timezone.utc)).astimezone().strftime('%Y%m%d')
                return page_id, f"T-{run_date}-{compact[:8]}"
        if not payload.get("has_more"):
            raise JobError("NO_TARGET")
        cursor = payload.get("next_cursor")
        if not isinstance(cursor, str) or not cursor:
            raise JobError("NOTION")


def has_processed_page(output_root: Path, page_id: str, processor) -> bool:
    """Detect a prior result by full page ID marker and legacy date-based output folder."""
    if not output_root.exists():
        return False
    if processor.is_link_or_junction(output_root) or not output_root.is_dir():
        raise JobError("PATH_REJECTED")
    compact_id = page_id.replace("-", "").lower()
    marker_root = output_root / ".processed_pages"
    marker = marker_root / f"{hashlib.sha256(compact_id.encode('ascii')).hexdigest()}.json"
    if processor.is_link_or_junction(marker_root) or processor.is_link_or_junction(marker):
        raise JobError("PATH_REJECTED")
    if marker.is_file():
        return True
    # Recognize output from before the full-ID marker was added.
    prior_pattern = re.compile(rf"^T-\d{{8}}-{re.escape(compact_id[:8])}$", re.I)
    for entry in output_root.iterdir():
        if not prior_pattern.fullmatch(entry.name):
            continue
        if processor.is_link_or_junction(entry):
            raise JobError("PATH_REJECTED")
        if entry.is_dir():
            return True
    return False


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


def run(job_file: Path | None, downloads: Path, output_root: Path, font: Path, token: str, now: datetime | None = None) -> dict:
    if not token or len(token.strip()) < 10:
        raise JobError("NOTION_CONFIG")
    job = read_job(job_file)
    page_id, article_id = job["notion_page_id"], job["article_id"]
    if page_id is None:
        page_id, auto_id = find_target_page(token, output_root, now)
        article_id = article_id or auto_id
    elif article_id is None:
        article_id = f"T-{page_id.replace('-', '').lower()[:12]}"
    processor = load_processor()
    if has_processed_page(output_root, page_id, processor):
        raise JobError("OUTPUT_EXISTS")
    names = select_recent_gemini(downloads, now) if job["source_files"] == "auto" else job["source_files"]
    sources = validate_sources(downloads, names, now)
    plan = read_plan(get_comments(page_id, token))
    if not font.is_file() or font.is_symlink():
        raise JobError("FONT_MISSING")
    article_root = output_root / article_id
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
    marker_root = output_root / ".processed_pages"
    if processor.is_link_or_junction(marker_root):
        raise JobError("PATH_REJECTED")
    marker_root.mkdir(exist_ok=True)
    marker = marker_root / f"{hashlib.sha256(page_id.replace('-', '').lower().encode('ascii')).hexdigest()}.json"
    try:
        with marker.open("x", encoding="utf-8") as stream:
            json.dump({"article_id": article_id, "processed_at": datetime.now(timezone.utc).isoformat()}, stream)
    except FileExistsError as error:
        raise JobError("OUTPUT_EXISTS") from error
    result["article_id"] = article_id
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description="Finalize a declared batch of five local Gemini downloads.")
    parser.add_argument("--job", type=Path, default=None, help="Optional job JSON. Omit for the daily automatic run.")
    parser.add_argument("--downloads", required=True, type=Path)
    parser.add_argument("--output-root", required=True, type=Path)
    parser.add_argument("--font", type=Path, default=Path(os.environ.get("GOWUN_DODUM_FONT", "")))
    args = parser.parse_args()
    try:
        result = run(args.job, args.downloads, args.output_root, args.font, os.environ.get("NOTION_CONTENT_READ_TOKEN", ""))
        print(f"ARTICLE:{result['article_id']}")
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
