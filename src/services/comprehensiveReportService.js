// services/comprehensiveReportService.js
// 종합리포트 화면과 데이터 계층(aiStore)을 잇는 얇은 서비스.
//  · 로딩: 회원 1명의 4개 소스(측정 세션·보행·자세·ROM 리포트)를 지연 로딩으로
//    보장한 뒤, 순수 함수(collectMeasureRecords)로 정규화해 돌려준다.
//  · 삭제: source 에 따라 올바른 삭제 함수로 위임한다(측정별/회차별 삭제 기능).
import { aiStore } from '../demoData';
import { collectMeasureRecords } from '../ai-measure/core/comprehensiveReport';

/** 회원의 모든 측정 기록을 로딩해 정규화 레코드(최신순)로 반환. */
export async function loadAllMeasureRecords(memberId) {
  if (!memberId) return [];
  await Promise.all([
    aiStore.ensureSessions(memberId),
    aiStore.ensureGaitReports(memberId),
    aiStore.ensurePostureReports(memberId),
    aiStore.ensureRomReports(memberId),
  ]);
  return collectMeasureRecords({
    sessions: aiStore.getSessions(memberId),
    gaitReports: aiStore.getGaitReports(memberId),
    postureReports: aiStore.getPostureReports(memberId),
    romReports: aiStore.getRomReports(memberId),
  });
}

// source → 삭제 함수 매핑(정적) — 화면·테스트가 같은 표를 본다.
export const DELETE_BY_SOURCE = {
  ai: (mid, id) => aiStore.deleteSession(mid, id),
  gait_reports: (mid, id) => aiStore.deleteGaitReport(mid, id),
  posture_reports: (mid, id) => aiStore.deletePostureReport(mid, id),
  rom_reports: (mid, id) => aiStore.deleteRomReport(mid, id),
};

/** 정규화 레코드 1건 삭제. 알 수 없는 source 는 명시적으로 실패시킨다. */
export async function deleteMeasureRecord(memberId, record) {
  const fn = DELETE_BY_SOURCE[record?.source];
  if (!fn) throw new Error(`알 수 없는 데이터 소스입니다: ${record?.source}`);
  if (!memberId || !record?.id) throw new Error('회원 또는 레코드 id가 없어 삭제할 수 없습니다.');
  await fn(memberId, record.id);
  return true;
}

/**
 * 측정 "회차" 하나를 완전히 삭제한다 — 세션(측정이력)과, 있다면 그 세션에 연결된
 * 전용 리포트(자세/ROM/보행·점프)를 함께 지운다. 둘 중 하나만 지우면 나머지 한쪽에
 * 고아 데이터가 남아 다른 화면에 잘못 집계될 수 있다(측정 정직성).
 * @param {string} memberId
 * @param {{id:string,menu:string}} session  aiStore 세션 문서
 * @param {{source:string,id:string}|null} linkedReport  연결된 전용 리포트(없으면 null)
 */
export async function deleteMeasureRound(memberId, session, linkedReport) {
  if (!memberId || !session?.id) throw new Error('삭제할 세션 정보가 없습니다.');
  const tasks = [aiStore.deleteSession(memberId, session.id)];
  if (linkedReport?.source && linkedReport?.id) {
    const fn = DELETE_BY_SOURCE[linkedReport.source];
    if (fn) tasks.push(fn(memberId, linkedReport.id));
  }
  await Promise.all(tasks);
  return true;
}

/**
 * 측정 "유형" 전체(예: 파워점프 15건)를 일괄 삭제한다.
 * @param {string} memberId
 * @param {Array<{id:string}>} sessions  같은 groupKey 에 속한 세션들
 * @param {Array<{source:string,id:string}>} linkedReports  각 세션에 연결된 전용 리포트(있는 것만)
 */
export async function deleteMeasureType(memberId, sessions = [], linkedReports = []) {
  if (!memberId) throw new Error('회원 정보가 없어 삭제할 수 없습니다.');
  const sessionTasks = sessions.filter(s => s?.id).map(s => aiStore.deleteSession(memberId, s.id));
  const reportTasks = linkedReports
    .filter(r => r?.source && r?.id)
    .map(r => DELETE_BY_SOURCE[r.source]?.(memberId, r.id))
    .filter(Boolean);
  await Promise.all([...sessionTasks, ...reportTasks]);
  return true;
}
