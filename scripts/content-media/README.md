# 로컬 이미지·영상 제작

회원 영상은 원본 PC에서만 처리합니다. 이 도구는 미디어나 프레임을 네트워크로 전송하지 않습니다.

## 준비

1. Python에 패키지를 설치합니다: `python -m pip install -r requirements-content-media.txt`
2. FFmpeg와 ffprobe 실행 파일이 PATH에 있어야 합니다. 자막을 위해 libass, 영상을 위해 libx264가 포함된 빌드를 사용합니다.
3. Gowun Dodum 글꼴 파일을 로컬 도구 폴더에 준비합니다. 공개 글꼴은 [Google Fonts Gowun Dodum](https://fonts.google.com/specimen/Gowun+Dodum)에서 받을 수 있습니다.
4. 자세 분류를 위해 OpenCV Zoo의 [pose estimation](https://github.com/opencv/opencv_zoo/tree/main/models/pose_estimation_mediapipe)과 [person detection](https://github.com/opencv/opencv_zoo/tree/main/models/person_detection_mediapipe) 폴더에서 Apache-2.0 모델·Python wrapper를 받아 한 로컬 폴더에 둡니다: `mp_pose.py`, `mp_persondet.py`, `pose.onnx`, `person.onnx`. 이 모델은 네트워크가 끊긴 상태에서도 로컬 추론합니다.

## 자동 제작

`build_article_media.py`는 승인된 강사 폴더 중 수정일이 최근인 영상 최대 100개를 대상으로 영상당 최대 12개 시점을 훑고, 로컬 OpenCV 점수로 이미지 5개와 짧은 영상 구간을 고릅니다. 사람은 장면을 직접 고를 필요가 없으며, HOG 사람 감지, 얼굴 크기, 프레임 변화, 선명도, 경로/파일명의 제한된 주제 단어 힌트를 사용합니다. ROM 측정 같은 동작 의미를 완전하게 이해하는 모델은 아니므로 점수는 후보 우선순위로만 사용합니다.

```powershell
python scripts/content-media/build_article_media.py `
  --media-root $env:MOMGAGYM_VIDEO_ROOT `
  --image-root $env:MOMGAGYM_APPROVAL_IMAGE_ROOT `
  --review-root $env:MOMGAGYM_REVIEW_ROOT `
  --font $env:GOWUN_DODUM_FONT `
  --pose-model-dir $env:MOMGAGYM_POSE_MODEL_ROOT `
  --article-id T-YYYYMMDD-0123abcd
```

이미지 5장은 `<image-root>/<article-id>/final/`에, 검수용 MP4/SRT/JSON은 `<review-root>/`에 생성합니다. 자세 모델은 관절 키포인트의 보임 정도·무릎 굽힘·측면 겹침·프레임 간 변화를 이용해 서기/보행/ROM 맥락/스쿼트 후보를 고릅니다. 측정기구 자체를 확정 탐지하지는 않습니다. `publishAllowed`는 항상 `false`입니다. 영상·얼굴·목소리·제3자 노출 확인과 게시 판단은 사람 검수 단계로 남습니다.
