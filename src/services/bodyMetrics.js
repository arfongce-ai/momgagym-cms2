// bodyMetrics.js — 회원 신체정보(키·체중) 공용 조회
// ════════════════════════════════════════════════════════════════════════
//  배경: AI측정 화면(점프 업로드/실시간, 바벨 허브 등)들이 "키·몸무게 필요"
//  게이트를 각자 독립적으로 구현하면서, member.height/weight 필드만 보고
//  회원 신체정보(body 탭, store.getBodyRecords)에 기록된 최신 값은 빠뜨리는
//  사고가 반복됐다 — 회원 상세에 체중 기록이 이미 있어도 측정 화면 진입 시
//  매번 재입력을 요구해, 정작 "▶ 분석 시작" 버튼까지 도달하지 못하는
//  증상으로 나타난다. 이 함수 하나로 모아 새 게이트를 추가할 때도 반드시
//  이 함수를 써야 한다(공식 불일치 방지 — sessionExpiry.js와 동일 원칙).
// ════════════════════════════════════════════════════════════════════════
import { store } from '../demoData';

// member 직접 필드 → 없으면 fallback(호출부가 이미 들고 있는 값) → 그래도 없으면
// store.getBodyRecords(회원 신체기록, recordedAt 최신순)에서 채운다.
export function resolveBodyMetrics(member, fallbackHeight = null, fallbackWeight = null) {
  let weight = member?.weight != null ? Number(member.weight) : fallbackWeight;
  let height = member?.height != null ? Number(member.height) : fallbackHeight;
  try {
    if ((weight == null || height == null) && member?.id && typeof store?.getBodyRecords === 'function') {
      const recs = store.getBodyRecords(member.id) || [];
      if (recs.length) {
        const sorted = [...recs].sort((a, b) => String(b.recordedAt).localeCompare(String(a.recordedAt)));
        for (const r of sorted) {
          if (weight == null && r.weight != null) weight = Number(r.weight);
          if (height == null && r.height != null) height = Number(r.height);
          if (weight != null && height != null) break;
        }
      }
    }
  } catch (e) { /* 조회 실패 시 member/fallback 값 사용 */ }
  return { weight: Number.isFinite(weight) ? weight : null, height: Number.isFinite(height) ? height : null };
}
