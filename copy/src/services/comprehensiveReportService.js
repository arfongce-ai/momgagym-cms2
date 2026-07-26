// services/comprehensiveReportService.js
// 종합리포트 화면과 데이터 계층(aiStore)을 잇는 얇은 서비스.
//  · 로딩: 회원 1명의 4개 소스(측정 세션·보행·자세·ROM 리포트)를 지연 로딩으로
//    보장한 뒤, 순수 함수(collectMeasureRecords)로 정규화해 돌려준다.
//  · 삭제: 정규화 레코드의 source 에 따라 올바른 삭제 함수로 위임한다.
//    (각 삭제는 demoData 에서 통합 미러(users/{mid}/reports)까지 함께 정리)
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
