import json
import os
import importlib.util
import tempfile
import unittest
from pathlib import Path

try:
    from PIL import Image, ImageDraw, ImageFont
    module_path = Path(__file__).resolve().parents[2] / "scripts" / "content-video" / "postprocess_images.py"
    spec = importlib.util.spec_from_file_location("content_video_postprocess_images", module_path)
    image_module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(image_module)
    ImageJobError = image_module.ImageJobError
    IMAGE_NAMES = image_module.IMAGE_NAMES
    draw_caption = image_module.draw_caption
    process_images = image_module.process_images
except ImportError:
    Image = None


FONT = os.environ.get("GOWUN_DODUM_FONT")
AVAILABLE = Image is not None and FONT and Path(FONT).is_file()
PHRASES = [
    "좌우 움직임을 같은 기준으로 비교해 보세요",
    "불편한 동작이 있으면 날짜와 함께 기록하세요",
    "편안한 범위에서 좌우 가동범위를 살펴보세요",
    "통증이 커지면 멈추고 전문가에게 평가받으세요",
    "네이버에서 '몸가짐운동센터' 검색",
]


@unittest.skipUnless(AVAILABLE, "Pillow 및 Gowun Dodum 폰트 경로가 필요합니다")
class ImagePostprocessTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="dummy-images-")
        self.root = Path(self.temp.name)
        self.plan = self.root / "phrases.json"
        self.plan.write_text(json.dumps({"phrases": PHRASES}, ensure_ascii=False), encoding="utf-8")

    def tearDown(self):
        self.temp.cleanup()

    def test_five_outputs_are_square_and_have_sha256_index(self):
        for name in IMAGE_NAMES:
            Image.new("RGB", (120, 90), (30, 90, 70)).save(self.root / name)
        result = process_images(self.root, self.plan, Path(FONT))
        self.assertEqual(result["count"], 5)
        manifest = json.loads((self.root / "final" / "hashes.json").read_text(encoding="utf-8"))
        self.assertEqual(len(manifest["files"]), 5)
        for item in manifest["files"]:
            self.assertEqual((item["width"], item["height"]), (1080, 1080))
            with Image.open(self.root / "final" / item["name"]) as output:
                self.assertEqual(output.size, (1080, 1080))
                self.assertEqual(output.format, "PNG")

    def test_under_five_images_fails_without_final_outputs(self):
        for name in IMAGE_NAMES[:-1]:
            Image.new("RGB", (100, 100)).save(self.root / name)
        with self.assertRaisesRegex(ImageJobError, "IMG_COUNT"):
            process_images(self.root, self.plan, Path(FONT))
        self.assertFalse((self.root / "final").exists())

    def test_caption_that_cannot_fit_returns_text_overflow(self):
        image = Image.new("RGB", (1080, 1080), "white")
        with self.assertRaisesRegex(ImageJobError, "TEXT_OVERFLOW"):
            draw_caption(image, "가" * 1200, Path(FONT))


if __name__ == "__main__":
    unittest.main()
