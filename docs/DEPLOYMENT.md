# Production 배포 규칙

## Preview와 Production

- 작업 브랜치 커밋은 Cloudflare의 `Preview`로 표시될 수 있다. Preview 주소는 검토용이고 운영 주소를 바꾸지 않는다.
- PR을 `main`에 병합하면 병합 커밋이 운영 릴리스 대상이다. Cloudflare 목록에는 작업 브랜치의 Preview와 `main`의 Production 기록이 함께 남는다.
- 예: Preview `6874b45`는 Production `ec548ed`에 포함된 조상 커밋이다. 두 행은 서로 다른 릴리스가 아니라 PR 검토본과 병합된 운영본을 가리킨다.

## 유일한 자동 Production 경로

`.github/workflows/cloudflare-pages.yml`이 다음 검사를 순서대로 마쳐야 Production을 갱신한다.

1. main에서 시작된 push 또는 main의 수동 실행인지 확인한다.
2. 테스트 회귀 게이트와 빌드를 통과한다.
3. 실행 대상 SHA가 `main`을 대상으로 병합 완료된 PR의 merge commit인지 GitHub API로 확인한다.
4. 배포 직전 실행 SHA가 최신 `main`인지 확인한다. 오래된 run 재실행은 차단한다.
5. Wrangler가 Cloudflare Pages의 `main` 브랜치로 배포한다.
6. 운영 도메인이 이번 빌드의 JS 번들을 제공하는지 확인하고, 배포 도중 `main`이 바뀌지 않았는지 재확인한다.

오래된 버전으로 되돌리려면 오래된 배포 run을 재실행하지 말고, 되돌릴 변경을 새 PR로 만들어 병합한다.

Cloudflare Git 자동 Production 배포를 다시 켜거나 별도 Wrangler 업로드를 하지 않는다. 두 번째 자동 배포 경로를 켜면 GitHub Actions와 배포 순서를 다툴 수 있다. 작업 브랜치 Preview는 계속 보일 수 있다.

## Codex와 Claude 작업 순서

1. 작업 시작 때 `git fetch origin` 후 최신 `origin/main`에서 새 작업 브랜치를 만든다.
2. 기존 브랜치가 최신 `origin/main`보다 뒤처졌으면 그대로 이어 쓰거나 직접 병합하지 않는다. 필요한 커밋만 새 브랜치로 옮기고 diff를 검토한다.
3. 변경은 PR로 `main`에 병합한다. 작업 브랜치의 Preview 성공은 Production 배포 완료를 뜻하지 않는다.
4. PR 병합 뒤 GitHub Actions의 Production deploy 및 운영 smoke check가 성공한 것을 확인한다.

저장소 자동화는 대시보드에서 직접 누른 수동 배포, Cloudflare API 토큰을 이용한 별도 workflow, GitHub의 branch protection 설정을 변경할 수 없다. 해당 경로가 추가되면 먼저 이 문서와 `cloudflare-pages.yml`을 함께 갱신한다.
