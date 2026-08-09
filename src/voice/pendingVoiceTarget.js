// src/voice/pendingVoiceTarget.js
// 음성 명령 또는 화면 이동 버튼으로 다른 페이지로 넘어갈 때 "도착하면 누구를,
// 어떤 측정/리포트를 선택해둘지"를 sessionStorage에 1회성으로 담아 전달한다.
// 도착한 화면이 소비(consume)하면 즉시 삭제된다.
const STORAGE_KEY = 'momi_pending_voice_target';
/**
 * @param {object} params
 * @param {string} [params.memberName]
 * @param {string} [params.testId]         AiMeasureHub — 자동으로 열 측정 메뉴 id
 *   ('body'|'posture'|'rom'|'gait'|'jump'|'lifting'|'stance'|'squat'|'record'|'timer',
 *   ai-measure/registry.js MEASURE_MENUS 기준).
 * @param {string} [params.openReportKind] [리포트 통합 2026-08-09] Report.jsx —
 *   AI측정 저장 직후 "결과리포트에서 보기"를 눌렀을 때, 도착해서 자동으로 열
 *   저장된 리포트 종류('posture'|'rom'|'gait'|'jump'|'lifting'|'stance'|'squat').
 *   방금 저장한 게 항상 최신(맨 앞) 항목이므로 별도 reportId 없이 종류만으로
 *   충분하다(Report.jsx가 정렬된 목록의 0번 인덱스를 연다).
 * @param {string} [params.memberTab] [음성 명령 확장 2026-08-09] Members.jsx —
 *   음성으로 "OO님 세션/수납/신체정보/측정이력/메모 보여줘" 같은 요청이 왔을 때
 *   회원 상세를 열면서 바로 보여줄 탭('info'|'sessions'|'payments'|'body'|'ai'|'memo',
 *   components/members/MemberDetail.jsx TABS 기준).
 * @param {string} [params.revenueTab] [음성 명령 확장 2026-08-09] Revenue.jsx(관리자
 *   전용) — 음성으로 "정산 열어줘" 같은 요청이 왔을 때 바로 보여줄 탭
 *   ('overview'|'settle'|'expense'|'config', pages/Revenue.jsx TABS 기준).
 */
export function setPendingVoiceTarget({
  memberName = null,
  testId = null,
  openReportKind = null,
  memberTab = null,
  revenueTab = null,
} = {}) {
  if (!memberName && !testId && !openReportKind && !memberTab && !revenueTab) return;
  try {
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ memberName, testId, openReportKind, memberTab, revenueTab, ts: Date.now() })
    );
  } catch (e) {
    // sessionStorage 접근 실패(프라이빗 모드 등)는 조용히 무시 — 화면 이동 자체는 그대로 진행
  }
}
// 도착한 화면에서 한 번만 호출한다. 호출 즉시 저장된 값을 지운다(1회성).
export function consumePendingVoiceTarget() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(STORAGE_KEY);
    const parsed = JSON.parse(raw);
    // 5분 넘게 묵은 값은 무시(예: 뒤로가기로 다시 들어온 경우 엉뚱하게 자동 선택되는 것 방지)
    if (!parsed || Date.now() - parsed.ts > 5 * 60 * 1000) return null;
    return {
      memberName: parsed.memberName || null,
      testId: parsed.testId || null,
      openReportKind: parsed.openReportKind || null,
      memberTab: parsed.memberTab || null,
      revenueTab: parsed.revenueTab || null,
    };
  } catch (e) {
    return null;
  }
}