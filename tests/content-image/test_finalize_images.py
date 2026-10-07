import importlib.util
import json
import os
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

try:
    from PIL import Image
    SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "content-image" / "finalize_images.py"
    spec = importlib.util.spec_from_file_location("finalize_images", SCRIPT)
    finalizer = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(finalizer)
except ImportError:
    Image = None
    finalizer = None

FONT = Path(os.environ.get("GOWUN_DODUM_FONT", r"C:\Windows\Fonts\malgun.ttf"))
PAGE_ID = "12345678-1234-1234-1234-123456789abc"
PHRASES = [
    "좌우를 천천히 비교해 보세요",
    "불편한 동작을 기록해 두세요",
    "편안한 범위를 살펴보세요",
    "불편함이 커지면 멈추세요",
    "네이버에서 '몸가짐운동센터' 검색",
]
PLAN = {"phrases": PHRASES, "positions": ["top", "top", "bottom", "bottom", "center"]}
COMMENTS = [{"rich_text": [{"plain_text": "IMAGE_PLAN_JSON\n" + json.dumps(PLAN, ensure_ascii=False)}]}]


@unittest.skipUnless(Image is not None and finalizer is not None and FONT.is_file(), "Pillow and a local test font are required")
class FinalizeImagesTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="dummy-image-batch-")
        self.root = Path(self.temp.name)
        self.downloads = self.root / "Downloads"
        self.downloads.mkdir()
        self.output = self.root / "approved"
        self.output.mkdir()
        self.job = self.root / "job.json"
        self.names = [f"Gemini_Test_{index}.png" for index in range(5)]
        self.now = datetime.now(timezone.utc)
        for index, name in enumerate(self.names):
            dims = (1200, 900) if index == 2 else (1000, 1000)
            Image.new("RGB", dims, (55 + index, 110, 90)).save(self.downloads / name)
            os.utime(self.downloads / name, (self.now.timestamp() - 60 + index, self.now.timestamp() - 60 + index))
        Image.new("RGB", (80, 80), "red").save(self.downloads / "unrelated.png")
        self.job.write_text(json.dumps({"article_id": "TST-2026-0002", "notion_page_id": PAGE_ID, "source_files": self.names}), encoding="utf-8")

    def tearDown(self):
        self.temp.cleanup()

    def run_job(self, comments=COMMENTS):
        with patch.object(finalizer, "get_comments", return_value=comments):
            return finalizer.run(self.job, self.downloads, self.output, FONT, "test-token-not-a-secret", self.now)

    def test_five_declared_files_are_copied_and_finalized(self):
        unrelated_before = (self.downloads / "unrelated.png").read_bytes()
        result = self.run_job()
        article = self.output / "TST-2026-0002"
        manifest = json.loads((article / "final" / "hashes.json").read_text(encoding="utf-8"))
        self.assertEqual(result["count"], 5)
        self.assertEqual(len(manifest["files"]), 5)
        with Image.open(article / "03.png") as original:
            self.assertEqual(original.size, (1200, 900))
        with Image.open(article / "final" / "03.png") as output:
            self.assertEqual(output.size, (1080, 1080))
        self.assertEqual((self.downloads / "unrelated.png").read_bytes(), unrelated_before)
        self.assertTrue(all((self.downloads / name).is_file() for name in self.names))
        self.assertFalse((article / "image-phrases.generated.local.json").exists())

    def test_fewer_than_five_declared_images_stops_before_touching_downloads(self):
        self.job.write_text(json.dumps({"article_id": "TST-2026-0002", "notion_page_id": PAGE_ID, "source_files": self.names[:4]}), encoding="utf-8")
        with self.assertRaisesRegex(finalizer.JobError, "IMG_COUNT"):
            finalizer.read_job(self.job)
        self.assertFalse((self.output / "TST-2026-0002").exists())

    def test_old_or_missing_file_is_rejected(self):
        old = self.downloads / self.names[0]
        os.utime(old, (self.now.timestamp() - 90000, self.now.timestamp() - 90000))
        with self.assertRaisesRegex(finalizer.JobError, "IMG_COUNT"):
            finalizer.validate_sources(self.downloads, self.names, self.now)

    def test_unrelated_image_is_not_selected_implicitly(self):
        job = json.loads(self.job.read_text(encoding="utf-8"))
        self.assertNotIn("unrelated.png", job["source_files"])
        self.assertEqual(len(finalizer.validate_sources(self.downloads, job["source_files"], self.now)), 5)

    def test_ambiguous_or_invalid_notion_plan_fails_closed(self):
        with self.assertRaisesRegex(finalizer.JobError, "PHRASE_PLAN"):
            finalizer.read_plan(COMMENTS + COMMENTS)
        malformed = [{"rich_text": [{"plain_text": "IMAGE_PLAN_JSON\n{}"}]}]
        with self.assertRaisesRegex(finalizer.JobError, "PHRASE_PLAN"):
            finalizer.read_plan(malformed)

    def test_caption_overflow_is_rejected(self):
        processor = finalizer.load_processor()
        with self.assertRaisesRegex(processor.ImageJobError, "TEXT_OVERFLOW"):
            processor.draw_caption(Image.new("RGB", (1080, 1080)), "가" * 1200, FONT)

    def test_notion_comments_follow_pagination_cursor(self):
        with patch.object(finalizer, "_get_json", side_effect=[
            {"results": [{"id": "first"}], "has_more": True, "next_cursor": "cursor-2"},
            {"results": [{"id": "second"}], "has_more": False},
        ]) as request:
            self.assertEqual([item["id"] for item in finalizer.get_comments(PAGE_ID, "test-token-not-a-secret")], ["first", "second"])
            self.assertIn("start_cursor=cursor-2", request.call_args_list[1].args[0])

    def test_reprocessing_existing_final_is_blocked(self):
        article = self.output / "TST-2026-0002"
        (article / "final").mkdir(parents=True)
        with patch.object(finalizer, "get_comments", return_value=COMMENTS):
            with self.assertRaisesRegex(finalizer.JobError, "OUTPUT_EXISTS"):
                finalizer.run(self.job, self.downloads, self.output, FONT, "test-token-not-a-secret", self.now)


if __name__ == "__main__":
    unittest.main()
