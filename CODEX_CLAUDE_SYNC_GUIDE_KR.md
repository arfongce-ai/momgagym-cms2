# Codex와 Claude 작업 연결 안내

## 결론: 두 프로그램에서 같은 폴더만 사용합니다

Codex와 Claude에서 아래 폴더를 똑같이 열어 작업하세요.

`C:\Users\MOMGAGYM\Documents\GitHub\momgagym-cms2`

`Downloads\momgagym-cms2-main (2)` 폴더는 복사본이며 GitHub 저장소가 아닙니다. 이 폴더에서 수정하면 다른 프로그램과 자동으로 연결되지 않습니다.

## 작업 전

1. `0_WORKSPACE_CHECK.bat`을 더블클릭합니다.
2. `[OK] Official GitHub work folder`가 보이는지 확인합니다.
3. GitHub Desktop에서 `Fetch origin`을 누릅니다.
4. `Pull origin`이 나타나면 먼저 누른 뒤 Codex 또는 Claude 작업을 시작합니다.

## 작업 후

1. 테스트가 끝난 뒤 `1_GITHUB_UPLOAD.bat`을 더블클릭합니다.
2. 작업 메모를 입력합니다.
3. 업로드 성공 메시지를 확인합니다.
4. 다른 프로그램에서 다음 작업을 시작하기 전에 다시 `Fetch origin`과 `Pull origin`을 합니다.

## 이번에 연결되지 않았던 이유

- Codex는 다운로드한 로컬 복사본에서 작업했습니다.
- Claude는 GitHub에 연결된 다른 폴더에서 작업했습니다.
- 두 폴더는 이름만 비슷하고 실제로는 서로 다른 파일 묶음이었습니다.
- 기존 업로드 도구는 현재 작업 브랜치가 아닌 `main`만 고정해서 올렸습니다.

이번 통합본에서는 Codex의 MOMI·인증·Firestore·비용 절감 작업과 Claude의 오버레이·궤적·Notion 작업을 하나로 합쳤고, 업로드 도구가 현재 작업 브랜치를 정확히 올리도록 수정했습니다.

## 꼭 지킬 한 가지

**Codex와 Claude 모두 `Documents\GitHub\momgagym-cms2` 폴더만 열어 사용합니다.**
