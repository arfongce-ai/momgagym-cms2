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

## 새 AI 서비스 추가

새 AI 서비스는 요금, 무료 한도, 데이터 보관·학습 이용 조건을 확인하고 문서화한 뒤 별도 승인된 범위에서만 사용한다. 회원 영상과 프레임은 전송하지 않는다.
