"""Locally score candidate frames for article slots without exposing source names."""
from __future__ import annotations

import json
import math
from pathlib import Path
import sys

from media_common import MediaError, is_link_or_junction

SLOTS = ("01", "02", "03", "04", "05")


def _angle(a, b, c) -> float | None:
    if not all(point is not None for point in (a, b, c)):
        return None
    first = (a[0] - b[0], a[1] - b[1])
    second = (c[0] - b[0], c[1] - b[1])
    lengths = math.hypot(*first) * math.hypot(*second)
    if lengths <= 1e-9:
        return None
    cosine = max(-1.0, min(1.0, (first[0] * second[0] + first[1] * second[1]) / lengths))
    return math.degrees(math.acos(cosine))


def _load_pose_models(model_dir: Path, cv2_module):
    try:
        if is_link_or_junction(model_dir) or not model_dir.is_dir():
            return None
        required = ("mp_persondet.py", "mp_pose.py", "person.onnx", "pose.onnx")
        if any(not (model_dir / name).is_file() or is_link_or_junction(model_dir / name) for name in required):
            return None
        sys.path.insert(0, str(model_dir))
        from mp_persondet import MPPersonDet
        from mp_pose import MPPose
        person_detector = MPPersonDet(str(model_dir / "person.onnx"))
        pose_estimator = MPPose(str(model_dir / "pose.onnx"), confThreshold=0.4)
        return person_detector, pose_estimator
    except Exception:
        return None


def _pose_metrics(image, models, cv2_module) -> dict:
    if models is None:
        return {"pose_quality": 0.0, "knee_angle": None, "trunk_lean": None,
                "side_view": 0.0, "full_body": 0.0, "pose_motion": 0.0}
    person_detector, pose_estimator = models
    height, width = image.shape[:2]
    try:
        detected = person_detector.infer(image)
        poses = [pose_estimator.infer(image, person) for person in detected]
        poses = [pose for pose in poses if pose is not None]
        if not poses:
            raise ValueError("no pose")
        _, landmarks, _, _, _, confidence = max(poses, key=lambda pose: float(pose[5]))
        points = {}
        for index, row in enumerate(landmarks[:33]):
            visibility = float(row[3])
            presence = float(row[4])
            if min(visibility, presence) >= 0.35:
                points[index] = (float(row[0]) / max(1, width), float(row[1]) / max(1, height))
        visible_ratio = sum(index in points for index in (11, 12, 23, 24, 25, 26, 27, 28)) / 8
        knee_angles = [value for value in (_angle(points.get(23), points.get(25), points.get(27)),
                                           _angle(points.get(24), points.get(26), points.get(28))) if value is not None]
        knee_angle = sum(knee_angles) / len(knee_angles) if knee_angles else None
        shoulder = tuple(sum(points[index][axis] for index in (11, 12) if index in points) /
                         max(1, sum(index in points for index in (11, 12))) for axis in (0, 1))
        hip = tuple(sum(points[index][axis] for index in (23, 24) if index in points) /
                    max(1, sum(index in points for index in (23, 24))) for axis in (0, 1))
        trunk_lean = abs(math.degrees(math.atan2(shoulder[0] - hip[0], hip[1] - shoulder[1]))) if visible_ratio else None
        pair_separations = [abs(points[left][0] - points[right][0]) for left, right in ((11, 12), (23, 24), (25, 26), (27, 28))
                            if left in points and right in points]
        separation = sum(pair_separations) / len(pair_separations) if pair_separations else 0.25
        quality = max(0.0, min(1.0, float(confidence))) * visible_ratio
        return {"pose_quality": quality, "knee_angle": knee_angle, "trunk_lean": trunk_lean,
                "side_view": max(0.0, min(1.0, 1 - separation * 5)),
                "full_body": 1.0 if visible_ratio >= 0.875 else visible_ratio,
                "pose_motion": 0.0}
    except Exception:
        return {"pose_quality": 0.0, "knee_angle": None, "trunk_lean": None,
                "side_view": 0.0, "full_body": 0.0, "pose_motion": 0.0}


def select(candidate_dir: Path, cv2_module=None, pose_model_dir: Path | None = None) -> dict:
    try:
        if cv2_module is None:
            import cv2 as cv2_module
        manifest_path = candidate_dir / "candidates.json"
        if is_link_or_junction(manifest_path):
            raise MediaError("IMG_COUNT")
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        records = manifest.get("candidates") if isinstance(manifest, dict) else None
    except MediaError:
        raise
    except Exception as error:
        raise MediaError("IMG_COUNT") from error
    if not isinstance(records, list) or len(records) < 5:
        raise MediaError("IMG_COUNT")

    hog = cv2_module.HOGDescriptor()
    hog.setSVMDetector(cv2_module.HOGDescriptor_getDefaultPeopleDetector())
    cascade = cv2_module.CascadeClassifier(str(Path(cv2_module.data.haarcascades) / "haarcascade_frontalface_default.xml"))
    pose_models = _load_pose_models(pose_model_dir, cv2_module) if pose_model_dir else None
    if pose_model_dir is not None and pose_models is None:
        raise MediaError("NO_VIDEO")
    scored = []
    for record in records:
        if not isinstance(record, dict):
            continue
        name = record.get("image")
        if not isinstance(name, str) or Path(name).name != name:
            continue
        path = candidate_dir / name
        if is_link_or_junction(path) or not path.is_file():
            continue
        image = _read_image(path, cv2_module)
        if image is None:
            continue
        height, width = image.shape[:2]
        if not width or not height:
            continue
        scale = min(1.0, 480 / width)
        small = cv2_module.resize(image, (max(1, round(width * scale)), max(1, round(height * scale))))
        boxes, weights = hog.detectMultiScale(small, winStride=(8, 8), padding=(8, 8), scale=1.05)
        gray = cv2_module.cvtColor(small, cv2_module.COLOR_BGR2GRAY)
        faces = cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=5, minSize=(24, 24))
        largest = max(boxes, key=lambda box: box[2] * box[3]) if len(boxes) else None
        person_area = 0.0
        tallness = 0.0
        if largest is not None:
            _, _, person_w, person_h = (int(value) for value in largest)
            person_area = (person_w * person_h) / max(1, small.shape[0] * small.shape[1])
            tallness = min(1.0, person_h / max(1, person_w) / 2.2)
        face_area = max((int(w) * int(h) for _, _, w, h in faces), default=0) / max(1, small.shape[0] * small.shape[1])
        focus = float(cv2_module.Laplacian(gray, cv2_module.CV_64F).var())
        pose = _pose_metrics(image, pose_models, cv2_module)
        hints = record.get("topic_hints") if isinstance(record.get("topic_hints"), dict) else {}
        scored.append({
            "record": record,
            "person": 1.0 if largest is not None else 0.0,
            "person_area": min(1.0, person_area * 5),
            "tallness": tallness,
            "face_free": 1.0 if face_area < 0.01 else 0.0,
            "focus": min(1.0, focus / 300),
            "hints": hints,
            "motion": 0.0,
            "body_change": 0.0,
            "pose": pose,
        })
    if len(scored) < 5:
        raise MediaError("IMG_COUNT")

    by_clip: dict[str, list[dict]] = {}
    for item in scored:
        by_clip.setdefault(str(item["record"].get("clip_id", "")), []).append(item)
    motion_values = []
    for group in by_clip.values():
        group.sort(key=lambda item: int(item["record"].get("timestamp_ms", 0)))
        for previous, current in zip(group, group[1:]):
            try:
                previous_image = _read_image(candidate_dir / previous["record"]["image"], cv2_module)
                current_image = _read_image(candidate_dir / current["record"]["image"], cv2_module)
                if previous_image is None or current_image is None:
                    continue
                gray_a = cv2_module.cvtColor(cv2_module.resize(previous_image, (160, 160)), cv2_module.COLOR_BGR2GRAY)
                gray_b = cv2_module.cvtColor(cv2_module.resize(current_image, (160, 160)), cv2_module.COLOR_BGR2GRAY)
                motion = float(cv2_module.absdiff(gray_a, gray_b).mean())
                previous["motion"] = current["motion"] = motion
                motion_values.append(motion)
                previous["body_change"] = current["body_change"] = abs(previous["tallness"] - current["tallness"])
                previous_pose = previous["pose"]
                current_pose = current["pose"]
                if previous_pose["pose_quality"] and current_pose["pose_quality"]:
                    old_angle, new_angle = previous_pose["knee_angle"], current_pose["knee_angle"]
                    if old_angle is not None and new_angle is not None:
                        current_pose["pose_motion"] = min(1.0, abs(old_angle - new_angle) / 70)
            except Exception:
                continue
    motion_max = max(motion_values, default=1.0) or 1.0
    for item in scored:
        item["motion"] = min(1.0, item["motion"] / motion_max)
        item["body_change"] = min(1.0, item["body_change"] * 4)

    def topic_score(item, topic):
        base = item["person"] * 0.35 + item["person_area"] * 0.15 + item["tallness"] * 0.20 + item["face_free"] * 0.15 + item["focus"] * 0.15
        hint = 0.35 if item["hints"].get(topic) else 0.0
        pose = item["pose"]
        if pose["pose_quality"] >= 0.25:
            quality = pose["pose_quality"]
            knee = pose["knee_angle"]
            if topic == "standing":
                leg_extension = max(0.0, 1 - abs((knee or 140) - 170) / 90)
                upright = max(0.0, 1 - (pose["trunk_lean"] or 0) / 90)
                return 0.55 + quality * (0.35 + leg_extension * 0.40 + upright * 0.25) + (1 - item["motion"]) * 0.1 + hint
            if topic == "walking":
                return 0.55 + quality * 0.45 + pose["pose_motion"] * 0.35 + item["motion"] * 0.15 + hint
            if topic == "measurement":
                return 0.55 + quality * 0.55 + pose["side_view"] * 0.35 + pose["full_body"] * 0.10 + hint
            if topic == "squat":
                knee_flexion = max(0.0, 1 - abs((knee or 170) - 100) / 100)
                return 0.55 + quality * 0.4 + knee_flexion * 0.35 + pose["pose_motion"] * 0.15 + item["motion"] * 0.1 + hint
            return 0.55 + quality * 0.45 + pose["full_body"] * 0.35 + item["face_free"] * 0.2
        if topic == "standing":
            return base + hint - item["motion"] * 0.2
        if topic == "walking":
            return base + hint + item["motion"] * 0.45
        if topic == "measurement":
            return base + hint
        if topic == "squat":
            return base + hint + item["body_change"] * 0.35 + item["motion"] * 0.2
        return base + item["face_free"] * 0.2

    slot_topics = ("standing", "walking", "measurement", "squat", "ending")
    chosen = []
    used_ids: set[str] = set()
    used_clips: set[str] = set()
    for slot, topic in zip(SLOTS, slot_topics):
        ranked = sorted(scored, key=lambda item: topic_score(item, topic), reverse=True)
        winner = next((item for item in ranked if item["record"].get("candidate_id") not in used_ids
                       and item["record"].get("clip_id") not in used_clips), None)
        if winner is None:
            winner = next((item for item in ranked if item["record"].get("candidate_id") not in used_ids), None)
        if winner is None:
            raise MediaError("IMG_COUNT")
        record = winner["record"]
        candidate_id = record.get("candidate_id")
        number = record.get("number")
        if not isinstance(candidate_id, str) or not isinstance(number, int):
            raise MediaError("IMG_COUNT")
        chosen.append({
            "slot": slot,
            "topic": topic,
            "candidate_id": candidate_id,
            "number": number,
            "clip_id": record.get("clip_id"),
            "timestamp_ms": int(record.get("timestamp_ms", 0)),
            "source_duration_ms": int(record.get("source_duration_ms", 0)),
            "score": round(topic_score(winner, topic), 4),
            "pose_analyzed": winner["pose"]["pose_quality"] >= 0.25,
        })
        used_ids.add(candidate_id)
        used_clips.add(str(record.get("clip_id")))

    selection = {"slots": {item["slot"]: item["number"] for item in chosen}}
    (candidate_dir / "selection.json").write_text(json.dumps(selection, indent=2) + "\n", encoding="utf-8")
    (candidate_dir / "auto-selection.json").write_text(
        json.dumps({"method": "local_opencv_pose_and_motion", "selections": chosen}, indent=2) + "\n", encoding="utf-8"
    )
    return {"selection": selection, "details": chosen}


def _read_image(path: Path, cv2_module):
    import numpy as np
    try:
        encoded = np.frombuffer(path.read_bytes(), dtype=np.uint8)
        return cv2_module.imdecode(encoded, cv2_module.IMREAD_COLOR)
    except OSError:
        return None
