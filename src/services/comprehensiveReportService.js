// services/comprehensiveReportService.js
// 종합리포트 화면과 데이터 계층(aiStore)을 잇는 얇은 서비스.
//  · 회원 1명의 4개 소스(측정 세션·보행·자세·ROM 리포트)를 지연 로딩으로
//    보장한 뒤, 순수 함수(collectMeasureRecords)로 정규화해 돌려준다.
//  · 삭제 기능은 포함하지 않는다(이상 데이터 확인 후 개별 삭제는 별도 요청 시 추가).
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
