"""Shared local-only helpers for member-media review tools."""
from __future__ import annotations

import hashlib
import os
import re
from pathlib import Path

VIDEO_SUFFIXES = {".mp4", ".mov"}
TEACHER_DIR_RE = re.compile(r"^(?:[1-9]|1[01])\.")
VIDEO_ID_RE = re.compile(r"^v_[0-9a-f]{8}$")
CANDIDATE_ID_RE = re.compile(r"^c_[0-9a-f]{8}_t\d{10}$")
ARTICLE_ID_RE = re.compile(r"^T-\d{8}-[0-9a-f]{8}$", re.I)
EXCLUDED_PARTS = {
    "홍보", "영수증", "운동시설이용확인서", "종료 회원 영상",
}
REPO_ROOT = Path(__file__).resolve().parents[2]


class MediaError(Exception):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def is_link_or_junction(path: Path) -> bool:
    try:
        if path.is_symlink():
            return True
        is_junction = getattr(path, "is_junction", None)
        return bool(is_junction and is_junction())
    except OSError:
        return True


def local_directory(path_value: str | Path, *, output: bool = False) -> Path:
    raw = os.fspath(path_value)
    if raw.startswith(("\\\\", "//")):
        raise MediaError("UNKNOWN")
    path = Path(raw).expanduser()
    if not path.is_absolute():
        raise MediaError("UNKNOWN")
    for part in (path, *path.parents):
        if is_link_or_junction(part):
            raise MediaError("UNKNOWN")
    if output:
        resolved = path.resolve(strict=False)
        try:
            resolved.relative_to(REPO_ROOT)
        except ValueError:
            pass
        else:
            raise MediaError("UNKNOWN")
    return path


def video_identifier(path: Path, root: Path) -> str:
    try:
        relative = path.relative_to(root).as_posix().casefold()
        stat = path.stat()
    except (OSError, ValueError) as error:
        raise MediaError("UNKNOWN") from error
    identity = f"{relative}\0{stat.st_size}\0{stat.st_mtime_ns}".encode("utf-8", "surrogatepass")
    return "v_" + hashlib.sha256(identity).hexdigest()[:8]


def iter_approved_videos(root: Path, *, include_education: bool = False):
    """Walk only numbered instructor folders; never return source paths in diagnostics."""
    if not root.is_dir() or is_link_or_junction(root):
        raise MediaError("NO_VIDEO")
    try:
        folders = [
            entry for entry in root.iterdir()
            if entry.is_dir() and not is_link_or_junction(entry)
            and (TEACHER_DIR_RE.match(entry.name) or (include_education and entry.name == "교육&공부"))
        ]
    except OSError as error:
        raise MediaError("NO_VIDEO") from error
    cutoff = 1735689600  # 2025-01-01T00:00:00Z
    for folder in sorted(folders, key=lambda item: item.name.casefold()):
        for current, dirs, files in os.walk(folder, topdown=True, followlinks=False):
            current_path = Path(current)
            dirs[:] = [
                name for name in dirs
                if name.casefold() not in EXCLUDED_PARTS
                and not is_link_or_junction(current_path / name)
            ]
            for name in files:
                path = current_path / name
                if path.suffix.casefold() not in VIDEO_SUFFIXES or is_link_or_junction(path):
                    continue
                try:
                    if path.stat().st_mtime >= cutoff:
                        yield path
                except OSError:
                    continue


def build_video_map(root: Path, *, include_education: bool = False) -> dict[str, Path]:
    result: dict[str, Path] = {}
    for path in iter_approved_videos(root, include_education=include_education):
        identifier = video_identifier(path, root)
        if identifier in result:
            raise MediaError("UNKNOWN")
        result[identifier] = path
    return result
