// ai-measure/core/eurPairing.js
// [2026-11-24] 같은 회원의 같은 날 CMJ·SJ 기록을 짝지어 EUR(CMJ 높이 ÷ SJ 높이)을 구한다. 순수 함수.
//  · 높이 기반이라 근거가 가장 탄탄하다(교재 p.313). 힘판 실측이 아니라 높이 비율이다.
//  · 둘 중 나중에 저장하는 기록에 eur 가 붙는다(먼저 저장하는 기록에는 아직 짝이 없다).
//  · 무효·재확인 필요 기록은 짝으로 쓰지 않는다.
import { eccentricUtilizationRatio } from './jumpPower';

const timeOf = (r) => String(r?.measuredAt || r?.createdAt || r?.recordedAt || '');
const OPPOSITE = { cmj: 'sj', sj: 'cmj' };

// 기기 시간대 기준 'YYYY-MM-DD'. 시각이 없거나 잘못되면 ''.
export function localDayKey(iso) {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const usable = (r) => r && r.kind === 'jump' && Number(r.heightCm) > 0 && r.valid !== false && !r.needsReview;

// list: 회원의 저장된 점프 리포트들. current: 지금 저장하려는(또는 보고 있는) 리포트.
// 반환: { eur, cmjHeightCm, sjHeightCm, cmjReportId, sjReportId, basis:'height', day } | null
export function findEurPair(list, current) {
  const sub = current?.jumpSubType;
  const other = OPPOSITE[sub];
  if (!other || !usable({ ...current, kind: current.kind || 'jump' })) return null;
  const nowIso = timeOf(current) || new Date().toISOString();
  const day = localDayKey(nowIso);
  if (!day) return null;
  const candidates = (list || [])
    .filter((r) => usable(r) && (r.jumpSubType || 'cmj') === other && localDayKey(timeOf(r)) === day
      && !(current.id && r.id === current.id))
    .sort((a, b) => Math.abs(Date.parse(timeOf(a)) - Date.parse(nowIso)) - Math.abs(Date.parse(timeOf(b)) - Date.parse(nowIso)));
  const mate = candidates[0];
  if (!mate) return null;
  const cmj = sub === 'cmj' ? current : mate;
  const sj = sub === 'sj' ? current : mate;
  const eur = eccentricUtilizationRatio(cmj.heightCm, sj.heightCm);
  if (eur == null) return null;
  return {
    eur,
    cmjHeightCm: Number(cmj.heightCm),
    sjHeightCm: Number(sj.heightCm),
    cmjReportId: cmj.id || null,
    sjReportId: sj.id || null,
    basis: 'height',
    day,
  };
}

// 저장 직전에 호출 — 짝이 있으면 리포트에 eur / eurRef 를 얹어서 돌려준다(없으면 그대로).
export function attachEur(report, list) {
  const pair = findEurPair(list, report);
  if (!pair) return report;
  const { eur, ...ref } = pair;
  return { ...report, eur, eurRef: { eur, ...ref } };
}
