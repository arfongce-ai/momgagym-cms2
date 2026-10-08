import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

SCRIPT_DIR = Path(__file__).resolve().parents[2] / "scripts" / "content-media"
sys.path.insert(0, str(SCRIPT_DIR))

from build_post_images import build
from build_article_media import _video_segments
from auto_select_frames import _angle
from build_short_video import render, validate_segments
from extract_candidates import extract, has_large_frontal_face
from media_common import MediaError, build_video_map


class FakeFrame:
    shape = (100, 100, 3)

    def __init__(self, index):
        self.index = index


class FakeCapture:
    def __init__(self, frames):
        self.frames = list(frames)

    def isOpened(self):
        return True

    def get(self, _property):
        return 1.0

    def read(self):
        if not self.frames:
            return False, None
        return True, self.frames.pop(0)

    def release(self):
        pass


class FakeCascade:
    def empty(self):
        return False

    def detectMultiScale(self, frame, **_kwargs):
        return [(10, 5, 25, 20)] if frame.index == 0 else []


class FakeCV2:
    CAP_PROP_FPS = 5
    COLOR_BGR2GRAY = 6
    IMWRITE_JPEG_QUALITY = 7
    INTER_AREA = 8

    def __init__(self):
        self.data = SimpleNamespace(haarcascades="dummy-haar")

    def CascadeClassifier(self, _path):
        return FakeCascade()

    def VideoCapture(self, _path):
        return FakeCapture(FakeFrame(index) for index in range(4))

    def cvtColor(self, frame, _code):
        return frame

    def imencode(self, _extension, _frame, _params):
        return True, SimpleNamespace(tobytes=lambda: b"dummy-frame")


class LocalMemberMediaTests(unittest.TestCase):
    def test_pose_angle_is_calculated_without_exposing_landmarks(self):
        self.assertAlmostEqual(_angle((1, 0), (0, 0), (0, 1)), 90)
        self.assertIsNone(_angle((0, 0), (0, 0), (1, 1)))

    def test_large_front_face_threshold(self):
        self.assertTrue(has_large_frontal_face([(2, 3, 20, 20)], 100, 100))
        self.assertFalse(has_large_frontal_face([(2, 3, 10, 10)], 100, 100))
        self.assertFalse(has_large_frontal_face([], 100, 100))

    def test_candidate_scan_ignores_old_and_excluded_and_removes_large_frontal_face(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / "source"
            teacher = root / "1.dummy"
            allowed = teacher / "lesson"
            allowed.mkdir(parents=True)
            excluded = teacher / "홍보"
            excluded.mkdir()
            old = allowed / "old.mp4"
            current = allowed / "current.mov"
            hidden = excluded / "ignored.mp4"
            for path in (old, current, hidden):
                path.write_bytes(b"dummy-video")
            old_time = 1704067200  # 2024-01-01 UTC
            new_time = 1760000000
            os.utime(old, (old_time, old_time))
            os.utime(current, (new_time, new_time))
            os.utime(hidden, (new_time, new_time))
            output = Path(temp) / "approved"
            count = extract(root, output, interval_seconds=3, cv2_module=FakeCV2())
            run_dir = next((output / __import__("datetime").datetime.now().strftime("%Y%m%d")).iterdir())
            manifest = json.loads((run_dir / "candidates.json").read_text(encoding="utf-8"))
            self.assertEqual(count, 1)
            self.assertEqual(manifest["candidates"][0]["timestamp_ms"], 3000)
            self.assertTrue((run_dir / "contact_sheet.html").is_file())
            self.assertNotIn("current.mov", (run_dir / "candidates.json").read_text(encoding="utf-8"))
            self.assertEqual(current.read_bytes(), b"dummy-video")
            self.assertEqual(old.read_bytes(), b"dummy-video")
            self.assertEqual(hidden.read_bytes(), b"dummy-video")

    def test_image_builder_outputs_five_square_images_and_hashes(self):
        from PIL import Image

        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp)
            candidate_dir = base / "candidates"
            candidate_dir.mkdir()
            rows = []
            for index in range(1, 6):
                name = f"c_ab12cd34_t{index:010d}.jpg"
                Image.new("RGB", (320, 240), (20 * index, 120, 90)).save(candidate_dir / name)
                rows.append({"number": index, "candidate_id": name[:-4], "image": name})
            (candidate_dir / "candidates.json").write_text(json.dumps({"candidates": rows}), encoding="utf-8")
            selection = base / "selection.json"
            selection.write_text(json.dumps({"slots": {f"{i:02}": i for i in range(1, 6)}}), encoding="utf-8")
            output_root = base / "images"
            result = build(candidate_dir, selection, output_root, "T-20261008-3f21b5ca",
                           Path("C:/Windows/Fonts/malgun.ttf"))
            self.assertEqual(len(result), 5)
            self.assertEqual((output_root / "T-20261008-3f21b5ca" / "final" / "hashes.json").is_file(), True)
            for index in range(1, 6):
                with Image.open(output_root / "T-20261008-3f21b5ca" / "final" / f"{index:02}.png") as image:
                    self.assertEqual(image.size, (1200, 1200))

    def test_missing_fifth_selection_returns_img_count(self):
        from PIL import Image

        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp)
            candidate_dir = base / "candidates"
            candidate_dir.mkdir()
            rows = []
            for index in range(1, 5):
                name = f"c_ab12cd34_t{index:010d}.jpg"
                Image.new("RGB", (64, 64), "white").save(candidate_dir / name)
                rows.append({"number": index, "candidate_id": name[:-4], "image": name})
            (candidate_dir / "candidates.json").write_text(json.dumps({"candidates": rows}), encoding="utf-8")
            selection = base / "selection.json"
            selection.write_text(json.dumps({"slots": {f"{i:02}": i for i in range(1, 5)}}), encoding="utf-8")
            with self.assertRaises(MediaError) as caught:
                build(candidate_dir, selection, base / "images", "T-20261008-3f21b5ca",
                      Path("C:/Windows/Fonts/malgun.ttf"))
            self.assertEqual(caught.exception.code, "IMG_COUNT")

    def test_video_selection_requires_three_or_four_segments_and_15_to_20_seconds(self):
        valid = {"segments": [{"clip_id": f"v_{i:08x}", "start_sec": 0, "end_sec": 5} for i in range(3)]}
        _, duration = validate_segments(valid)
        self.assertEqual(duration, 15)
        with self.assertRaises(MediaError):
            validate_segments({"segments": valid["segments"][:2]})
        short = {"segments": [{"clip_id": f"v_{i:08x}", "start_sec": 0, "end_sec": 3} for i in range(4)]}
        with self.assertRaises(MediaError):
            validate_segments(short)

    def test_auto_video_segments_are_four_distinct_local_clips_and_sixteen_seconds(self):
        details = [
            {"clip_id": f"v_{index:08x}", "timestamp_ms": 10_000 + index * 1000,
             "source_duration_ms": 30_000}
            for index in range(5)
        ]
        segments = _video_segments(details)
        self.assertEqual(len(segments), 4)
        self.assertEqual(len({item["clip_id"] for item in segments}), 4)
        self.assertEqual(sum(item["end_sec"] - item["start_sec"] for item in segments), 16)

    def test_video_dry_run_never_invokes_encoder(self):
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp)
            root = base / "source"
            folder = root / "1.dummy"
            folder.mkdir(parents=True)
            ids = []
            for index in range(3):
                source = folder / f"sample{index}.mp4"
                source.write_bytes(b"dummy")
                os.utime(source, (1760000000, 1760000000))
            video_map = build_video_map(root)
            ids = list(video_map)
            selection = base / "video.json"
            selection.write_text(json.dumps({"segments": [
                {"clip_id": clip_id, "start_sec": 0, "end_sec": 5} for clip_id in ids
            ]}), encoding="utf-8")
            font = Path("C:/Windows/Fonts/malgun.ttf")
            with patch("build_short_video.subprocess.run") as run:
                result = render(root, base / "review", selection, "T-20261008-3f21b5ca", font,
                                dry_run=True, ffmpeg="ffmpeg-test")
            self.assertTrue(result["dry_run"])
            run.assert_not_called()


if __name__ == "__main__":
    unittest.main()
