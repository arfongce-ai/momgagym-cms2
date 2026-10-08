# Issue #2 — 로컬 영상 편집 MVP

## 입력·보안 규칙

- 편집 입력은 로컬 설정에서 지정한 편집 대상 루트 바로 아래 파일만 처리한다. 그 밖의 경로와 하위 폴더는 처리하지 않는다.
- 입력 루트 폴더 자체가 심볼릭 링크·정션이면 거부한다.
- 입력 파일명은 `CLP-0000-0000.mp4` 또는 `CLP-0000-0000.mov` 형식만 허용한다. 매니페스트에는 경로 대신 클립 ID만 적는다.
- 설정 파일 `content-video/config.local.json`은 로컬 전용이며 Git에 추가하지 않는다. 이 파일에 편집 입력, 출력, 브랜드 소재의 절대 루트를 설정한다. 실제 PC 경로는 저장소 문서·예제·로그에 기록하지 않는다.
- 로고와 엔딩 카드도 설정된 브랜드 소재 루트 바로 아래의 이미지 파일만 사용한다. 심볼릭 링크, 정션, 네트워크 경로와 루트 밖 대상은 거부한다.
- 회원 이름 대신 가명 클립 ID만 사용한다. 동의 스냅샷의 일치하는 모든 레코드가 유효하고 클립 ID까지 일치해야 진행한다. 매니페스트의 동의 자기 신고 값은 권한 판단에 사용하지 않는다.
- 회원 영상과 프레임은 외부 AI/서비스에 보내지 않는다. 테스트와 예시는 더미 소재만 사용한다.
- 결과는 로컬 검수 대기 상태로만 생성한다. 외부 게시 코드나 자동 업로드는 포함하지 않으며 `publishAllowed`는 항상 `false`다.

## 로컬 준비

1. FFmpeg가 설치돼 있고 `ffmpeg -version`이 동작하는지 확인한다.
2. Git에서 제외되는 `content-video/config.local.json`에 `inputRoot`, `outputRoot`, `brandRoot`를 설정한다. 이 파일의 경로를 공유 문서·Issue·로그에 복사하지 않는다.
3. 동의 스냅샷 `content-video/consents.local.json`을 준비한다. 각 레코드에 동의 참조값, 가명 `clipId`, 공개 콘텐츠 허용, 허용 채널, 철회 여부, 만료일을 기록한다. 서명 원본·이름·연락처·영상은 넣지 않는다.
4. `content-video/approved.example.json`을 로컬 매니페스트로 복사한다. 더미가 아닌 실제 공개 동의 복사본은 대표님이 허용한 로컬 작업에서만 지정한다.

## 실행

```powershell
npm run video:review -- --manifest approved.local.json
```

매니페스트는 파일명만 받으며 설정된 콘텐츠 루트에서 읽는다. 각 클립은 독립 처리하고, 성공한 결과만 `review_index.html`에 포함한다. 실패는 코드만 기록하며 실패한 클립은 다른 클립 처리를 막지 않는다. 출력은 임시 파일에서 성공적으로 완료된 뒤 최종 이름으로 바뀐다. 로컬 원장에는 클립 ID, 입력·출력 해시, 시각, 결과 코드만 남기고 경로나 파일명은 저장하지 않는다.

검수 JSON은 `review_required`, `publishAllowed: false`를 기록한다. 검수와 외부 게시는 대표님이 직접 수행한다.

## Notion 대기열 연동(PR2)

- `npm run video:notion-review`는 서로 분리한 `NOTION_CONSENT_READ_TOKEN`과 `NOTION_CONTENT_CALENDAR_TOKEN`만 사용한다. 데이터 소스 ID도 `NOTION_CONSENT_DATA_SOURCE_ID`, `NOTION_CONTENT_CALENDAR_DATA_SOURCE_ID` 환경변수로 받는다. Notion API `2026-03-11` data source query를 쓴다. 실제 값을 소스·로그·공개 문서에 넣지 않는다. 기존 GitHub `NOTION_CONTENT_TOKEN`을 재사용하지 않는다.
- 동의 조회가 실패하거나 레코드 형식이 맞지 않으면 영상 대기열을 처리하지 않는다. 동의 행에서 허용 필드만 메모리로 변환하며 이름·연락처 속성은 변환하지 않는다.
- 캘린더에서 `콘텐츠 유형=숏폼 영상`과 `제작 상태=영상 제작 대기`만 읽는다. `편집 중`이 30분 넘으면 `영상 제작 대기`로 복구한다. 각 클립은 PR1의 가드와 로컬 렌더를 거친다.
- 허용 쓰기는 `제작 상태`, `검수 결과 링크`, `결과 해시`, `마지막 처리 시각`, `오류 요약`뿐이다. 코드에서 `검수 상태`, `최종 게시 승인`, `게시 승인`, `게시완료`를 쓰지 못하게 막는다. `publishAllowed`는 항상 false다.
- 현재 확인한 콘텐츠 캘린더에는 `제작 상태`(select), `콘텐츠 유형`(select), `채널`(select), `클립 ID`(text), `Drive 링크`(url)가 있다. 아래 PR2 필드는 사용자가 Notion에서 수동 추가/확인해야 한다. 이 코드는 속성·Integration을 생성하지 않는다.
  - 동의 DB: `동의 참조값`(text), `클립 ID`(text), `공개 콘텐츠 허용`(checkbox), `허용 채널`(multi-select), `철회`(checkbox), `만료일`(date).
  - 콘텐츠 캘린더: `동의 참조값`(text), `대본`(text), `시작 초`·`끝 초`(number), `결과 해시`(text), `마지막 처리 시각`(date), `오류 요약`(text). `검수 결과 링크`는 `Drive 링크`를 재사용할지 별도 URL 속성을 만들지 수동 결정한다. Drive 업로드는 이 PR 범위가 아니므로 로컬 경로를 Notion에 기록하지 않는다.
  - 추가 제안만: `이미지 폴더 확인`, `티스토리 초안 번호`(text). 코드에서 생성하지 않는다.
- 실제 Notion 왕복 테스트는 새 Integration/속성 공유 확인 후 별도 실행해야 한다. 이 PR의 자동화 테스트는 목 응답만 사용한다.

## 티스토리 이미지 후처리(오프라인)

- 이미지 생성은 외부 이미지 AI에서 사람·글자 없이 만든 PNG 5장을 받아 로컬에서 처리한다. 회원 영상·사진을 이미지 모델이나 외부 서비스에 보내지 않는다.
- 실행 입력은 사용자가 준 문구 계획 JSON의 `phrases` 5개, `01.png`~`05.png`, 로컬 Gowun Dodum 글꼴이다. 선택 필드 `positions`는 이미지 순서에 맞춘 `top`·`center`·`bottom` 다섯 값이며, 생략하면 모두 아래쪽에 배치한다. 5번째 문구는 정확히 `네이버에서 '몸가짐운동센터' 검색`이어야 한다. 나머지 문구에는 전화번호·URL·센터명이 허용되지 않는다.
- `python -m pip install -r requirements-content-video.txt` 후 다음처럼 실행한다. 실제 경로는 로컬 PC 명령행에서만 지정한다.

```powershell
python scripts/content-video/postprocess_images.py --input "$ImageJobRoot" --phrases "$ImageJobRoot\image-phrases.json" --font "$GowunDodumFont"
```

- 중앙 정사각형 크롭 및 1080×1080 리사이즈, 고대비 한글 문구 합성, 선택적인 소형 로고 합성, `final\01.png`~`05.png`와 경로 없는 SHA-256 `hashes.json`을 만든다. 5장 부족·글꼴 부재·문구 넘침은 코드로 실패하며 외부 통신은 없다.
- 더미 검증은 `GOWUN_DODUM_FONT`를 설정한 뒤 `python -m unittest discover -s tests/content-video`로 실행한다. Python/Pillow가 없는 Codex 환경에서는 실행 결과를 통과로 표시하지 않는다.

## 일일 Gemini 이미지 최종화 (로컬 전용)

- `python scripts/content-image/finalize_images.py`는 로컬에서만 실행한다. 이미지 파일이나 프레임을 Notion·외부 API에 보내지 않는다. 자동 모드는 콘텐츠 캘린더 data source에서 승인·미게시 행을 발행예정일 순으로 조회하고, 로컬 처리 기록이 있는 행은 건너뛰어 다음 미처리 페이지를 고른 뒤 댓글을 GET한다. data source query는 HTTP POST지만 Notion의 읽기 전용 query endpoint만 호출한다. 페이지 속성을 수정하거나 티스토리에 업로드·공개하지 않는다.
- 작업 파일 `--job`은 선택 사항이다. 생략하거나 `source_files`를 `"auto"`로 두면 Downloads 바로 아래에서 최근 24시간의 `Gemini*.(png|jpg|jpeg|webp)` 파일이 정확히 5개인지 확인한다. 4개·6개 이상이면 `IMG_COUNT`로 중단한다. 무관한 파일은 열거나 이동하지 않는다. 수동 작업표 형식은 `{"article_id":"TST-2026-0002","notion_page_id":"<페이지 ID>","source_files":["01.png","02.png","03.png","04.png","05.png"]}`이며, 실제 파일 basename을 시간순으로 적는다.
- 대상 Notion 글의 댓글 하나에 `IMAGE_PLAN_JSON` 한 줄 다음 JSON을 둔다: `{"phrases":["문구1","문구2","문구3","문구4","네이버에서 '몸가짐운동센터' 검색"],"positions":["top","top","bottom","bottom","center"]}`. 유효 계획이 없거나 여러 개면 `PHRASE_PLAN`으로 중단한다. API는 페이지네이션 포함 댓글 GET만 사용하고, 읽기 토큰은 `NOTION_CONTENT_READ_TOKEN` 환경변수로만 받는다.
- 선택된 다섯 파일이 모두 최근 24시간 이내인지 다시 확인한다. 원본 다운로드는 복사만 하며 삭제하지 않는다. 이전 날짜 결과 폴더와 로컬 `.processed_pages` 처리 기록으로 같은 Notion 페이지의 중복 처리를 차단하고, 다음 승인 글을 찾는다. 이미 처리된 페이지를 직접 지정했거나 이미 존재하는 결과 폴더는 `OUTPUT_EXISTS`로 중단한다. 조건에 맞는 미처리 글이 없으면 `NO_TARGET`이다.
- 결과는 로컬 이미지 루트의 `<article_id>/01.png`~`05.png`, `final/01.png`~`05.png`, `final/hashes.json`이다. 중앙 정사각 크롭 및 1080×1080 PNG는 기존 후처리 함수를 재사용한다. `hashes.json`에는 결과 파일명·해시·크기만 기록하며 로컬 경로는 기록하지 않는다. 실패 시 코드만 출력한다.
- Python과 `requirements-content-video.txt`의 Pillow, Gowun Dodum 글꼴, Notion 읽기 토큰, 이미지 작업 루트가 사용자 PC에 준비돼야 한다. Gowun Dodum이 없으면 자동 설치하지 않고 `FONT_MISSING`으로 종료한다.
- 작업 스케줄러 등록 스크립트는 `scripts/content-image/register-finalizer-task.ps1`이다. 기본 동작은 등록하지 않는 미리보기이며, 사용자가 매개변수를 검토해 명시적으로 `-Register`를 붙였을 때만 매일 07:30 작업을 등록한다. 로그인된 현재 사용자로만 실행하고 동시 실행은 무시한다. 코드가 자동 등록하지 않는다.
- Claude가 08:47에 이미지 생성·다운로드를 하므로 07:30 작업은 전날 이미지를 처리한다. 첫 생성 당일 본문 삽입은 되지 않고, 다음 날 Claude 실행에서 로컬 `final` 결과가 준비돼야 삽입할 수 있다. 실제 예약 등록·실 Notion 호출·실 다운로드 처리는 별도 PC 설정 후 확인한다.
- 더미 테스트: `python -m unittest discover -s tests/content-image` (기본 Windows 테스트 글꼴은 맑은 고딕이며, 운영 글꼴 검증은 아님).

## 회원 수업 영상에서 이미지·숏폼 만들기 (PC 로컬 전용)

- `scripts/content-media/` 도구는 사람 영상·프레임을 로컬 PC에서만 읽고 출력한다. 영상 API, 클라우드, 외부 AI, 저장소와 Notion에 파일이나 프레임을 보내지 않는다. 원본 영상은 읽기만 하며 이동·수정·삭제하지 않는다. 로그는 오류 코드 또는 생성 수만 출력한다.
- `extract_candidates.py`는 지정한 미디어 루트 바로 아래 `1.`~`11.` 번호 폴더만 재귀 탐색하고, `교육&공부`는 `--include-education`을 명시한 경우에만 포함한다. MP4/MOV 중 수정 시각이 2025-01-01 UTC 이후인 파일만 후보로 삼는다. `홍보`, `영수증`, `운동시설이용확인서`, `종료 회원 영상` 경로는 제외한다. 기본 3초 간격으로 프레임을 샘플링한다.
- OpenCV Haar 정면 얼굴 감지 상자가 프레임 높이의 18% 이상이거나 프레임 면적의 4.5% 이상이면 해당 프레임을 제외한다. 이 기준은 정면 얼굴만 일부 걸러내며 옆얼굴·가림·제3자를 판별하지 못한다. `contact_sheet.html`은 로컬에서만 열고, 번호를 확인한 뒤 사람이 다섯 장을 선택해야 한다.
- 후보 파일명은 해시 기반 클립 ID와 시각만 포함한다. `candidates.json`에도 번호·가명 ID·상대 이미지 파일명·시간만 기록하며 원본 경로·파일명·강사 폴더명은 기록하지 않는다. 선택 파일 예시:

```json
{"slots":{"01":12,"02":28,"03":41,"04":55,"05":73}}
```

- 후보 추출 예시(경로는 PC에서 환경변수로만 설정):

```powershell
python scripts/content-media/extract_candidates.py --media-root $env:MOMGAGYM_VIDEO_ROOT --output-root (Join-Path $env:MOMGAGYM_APPROVAL_IMAGE_ROOT '후보') --interval-seconds 3
```

  생성된 날짜/run 폴더에서 `contact_sheet.html`을 열어 번호 5개를 선택하고 같은 run 폴더에 `selection.json`을 만든다. `01`~`05` 값은 시트 번호다. 이미지 생성 명령:

```powershell
python scripts/content-media/build_post_images.py --candidate-dir $CandidateRun --selection (Join-Path $CandidateRun 'selection.json') --output-root $env:MOMGAGYM_APPROVAL_IMAGE_ROOT --article-id T-20261008-3f21b5ca --font $env:GOWUN_DODUM_FONT
```

- 이미지 명령은 `selection.json` 번호와 지정 문구를 사용해 1200×1200 중앙 크롭 결과를 `T-YYYYMMDD-<페이지ID 앞 8자리>/final/01.png`~`05.png`로 만든다. 문구 위치 기본값은 `top, top, bottom, bottom, center`; 선택 로고는 작은 크기로 모서리에 합성한다. 기존 결과는 덮어쓰지 않는다. SHA-256 색인에는 결과 파일명·해시·크기만 기록한다.
- 숏폼은 `video-selection.json`에 3~4개 구간의 `clip_id`, `start_sec`, `end_sec`를 적고 총 길이 15~20초가 되게 선택한다. 먼저 `--dry-run`으로 길이·대상만 확인한다. 실제 실행은 FFmpeg와 ffprobe를 사용해 1080×1920 세로 영상으로 만들고, 선택한 원본의 음성은 넣지 않는다. 자막은 위 문구 5개를 순서대로 표시하며 별도 엔딩 카드 없이 마지막 문구를 영상 위에 표시한다. `.review.json`은 항상 `publishAllowed:false`, `review_required:true`다. 얼굴·구간·자막·제3자 노출은 사람이 확인한다.
- `video-selection.json` 예시(가명 ID만 기입): `{"segments":[{"clip_id":"v_ab12cd34","start_sec":2,"end_sec":7},{"clip_id":"v_1a2b3c4d","start_sec":4,"end_sec":9},{"clip_id":"v_9a8b7c6d","start_sec":1,"end_sec":6}]}`. 실행 예시는 `python scripts/content-media/build_short_video.py --media-root $env:MOMGAGYM_VIDEO_ROOT --output-dir $env:MOMGAGYM_REVIEW_ROOT --selection $VideoSelection --article-id T-20261008-3f21b5ca --font $env:GOWUN_DODUM_FONT --dry-run`; 길이 확인 후 실제로 렌더할 때 `--dry-run`을 제거한다.
- 준비물은 Python, Pillow, OpenCV, FFmpeg/ffprobe, Gowun Dodum 글꼴이다. 현재 OpenCV·FFmpeg/ffprobe·Gowun Dodum의 설치 및 실제 영상 렌더 상태는 별도 확인이 필요하다. 코드는 도구가 없으면 코드만 출력하고 멈춘다.
- 테스트: `python -m unittest discover -s tests/content-media` (합성 더미 프레임·영상만 사용).

## 새 AI 서비스 추가

새 AI 서비스는 요금, 무료 한도, 데이터 보관·학습 이용 조건을 확인하고 문서화한 뒤 별도 승인된 범위에서만 사용한다. 회원 영상과 프레임은 전송하지 않는다.
