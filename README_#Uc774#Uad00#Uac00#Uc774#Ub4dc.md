# 종합리포트 — CMS(momgagym-cms2) 이관 가이드

AI 앱(momgagym-ai)에서 개발·검증 완료된 **종합리포트** 기능을 CMS 로 옮기는 패키지입니다.
이 패키지의 내용은 CMS 사본(rep-freeze 기준)에 실제로 적용해 **CMS 전체 테스트 917개 통과,
빌드·린트 클린**을 확인했습니다.

## 기능 요약

- 각 측정 결과 리포트(자세·ROM·보행·점프·바벨·신체정보)를 통합 분석해
  **같은 일 / 같은 주(일요일 시작, CMS 캘린더 규약과 동일) / 같은 월** 단위 종합리포트 생성
- 기간별 **데이터 통계**: 유형별 측정 횟수, 점수 min/avg/max, 기간 내 변화(첫→끝),
  핵심지표(체중·혈압 등) 통계
- **이상 데이터 감지 + 제거**: 미래 날짜·날짜 누락, 원시 점수 0~100 이탈, 빈 결과,
  중복 의심, 통계적 특이치(로버스트 z, 중앙값·MAD)를 사유와 함께 제안 →
  확인 후 개별/일괄 삭제. 삭제 시 통합 리포트 미러(users/{mid}/reports)까지 함께 정리.

## 1) copy/ — 그대로 복사 (신규 파일, 기존 파일과 충돌 없음)

같은 경로에 그대로 넣으면 됩니다.

```
src/ai-measure/core/comprehensiveReport.js      ← 통합·그룹핑·통계·이상감지 (순수 함수)
src/services/comprehensiveReportService.js      ← 로딩 + source별 삭제 위임
src/pages/ComprehensiveReport.jsx               ← 종합리포트 화면
src/__tests__/comprehensive_report.test.js      ← 핵심 로직 테스트 (17)
src/__tests__/comprehensive_delete.test.js      ← 삭제 계약 테스트 (8)
```

## 2) demoData.js — ⚠️ 통째로 덮어쓰기 금지, 두 가지 방법 중 선택

**방법 A (권장, CMS demoData 를 rep-freeze 이후 수정하지 않았다면):**
`patched/src/demoData.js` 로 교체. 이 파일은 CMS 원본(rep-freeze) + 아래 패치만
적용한 것입니다. rep-freeze 이후 CMS demoData 를 고쳤다면 방법 B 를 쓰세요.

**방법 B (수동 반영):** `[종합리포트]` 주석 블록 2곳을 추가합니다.

① `function fbDelete(name, id) {` **바로 위**에 헬퍼 추가:

```js
// [종합리포트] 통합 리포트 미러 삭제 — 원본(측정 세션·전용 리포트) 삭제 시
// users/{mid}/reports/{reportId} 미러도 함께 정리한다. 미러 저장과 동일한
// best-effort 원칙: 실패해도 원본 삭제는 회귀하지 않는다(경고만 남김).
async function removeUnifiedMirror(mid, reportId) {
  if (!mid || !reportId) return;
  try {
    await deleteDoc(doc(db, 'users', mid, 'reports', reportId));
  } catch (e) {
    console.warn('[removeUnifiedMirror] 통합 미러 삭제 실패(무시):', e?.code || e?.message);
  }
}
```

② `aiStore` 의 `deleteSession` 을 아래로 교체하고, 이어서 삭제 함수 3종 추가:

```js
  deleteSession: async (mid, sid) => {
    const prev=cache.ai[mid];
    cache.ai[mid]=(cache.ai[mid]||[]).filter(s=>s.id!==sid);
    try { await fbDelete('ai', sid); }
    catch(e){ cache.ai[mid]=prev; throw e; }
    // [종합리포트] 저장 시 미러된 통합 리포트(users/{mid}/reports/{sid})도 함께 정리.
    await removeUnifiedMirror(mid, sid);
  },
  // [종합리포트] 전용 리포트 컬렉션 삭제 — 이상 데이터 제거용.
  //  저장(add*)과 대칭: 캐시 낙관적 제거 → Firestore 삭제(톰스톤 포함) →
  //  통합 미러(users/{mid}/reports)도 best-effort 정리. 실패 시 캐시 롤백.
  deleteGaitReport: async (mid, rid) => {
    const prev = cache.gaitReports[mid];
    cache.gaitReports[mid] = (cache.gaitReports[mid] || []).filter(r => r.id !== rid);
    try { await fbDelete('gait_reports', rid); }
    catch (e) { cache.gaitReports[mid] = prev; throw e; }
    await removeUnifiedMirror(mid, rid);
  },
  deletePostureReport: async (mid, rid) => {
    const prev = cache.postureReports[mid];
    cache.postureReports[mid] = (cache.postureReports[mid] || []).filter(r => r.id !== rid);
    try { await fbDelete('posture_reports', rid); }
    catch (e) { cache.postureReports[mid] = prev; throw e; }
    await removeUnifiedMirror(mid, rid);
  },
  deleteRomReport: async (mid, rid) => {
    const prev = cache.romReports[mid];
    cache.romReports[mid] = (cache.romReports[mid] || []).filter(r => r.id !== rid);
    try { await fbDelete('rom_reports', rid); }
    catch (e) { cache.romReports[mid] = prev; throw e; }
    await removeUnifiedMirror(mid, rid);
  },
```

## 3) 라우팅 — App.jsx / AppLayout.jsx (앱별 상이 파일, 통째 복사 금지)

CMS 원본 기준 수정본이 `patched/` 에 있습니다(rep-freeze 이후 미수정 시 교체 가능).
수동 반영 시:

**src/App.jsx** — import 와 라우트 한 줄씩 추가:

```jsx
import ComprehensiveReport from './pages/ComprehensiveReport';
// ...
<Route path="/summary"  element={<ComprehensiveReport />} />   // /report 라우트 옆
```

**src/components/layout/AppLayout.jsx** — NAV 배열의 리포트 항목 다음에 추가:

```js
{ path:'/summary',  label:'종합리포트', icon:'📈' },
```

## 4) 이관 후 확인

```bash
npm test        # comprehensive_* 25개 포함 전체 통과 확인
npm run build
```

Firestore 보안 규칙: 신규 컬렉션은 없습니다(기존 ai/gait_reports/posture_reports/
rom_reports/users 하위 reports 를 그대로 사용). 단, 규칙에서 위 컬렉션의 **delete** 가
로그인 사용자에게 허용되어 있는지 확인하세요. 톰스톤(`deletions`) 쓰기는 기존 규칙
그대로 사용됩니다.
