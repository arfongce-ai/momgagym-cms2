// components/report/sessionShare.js
// ════════════════════════════════════════════════════════════════════════
//  '카카오톡으로 리포트 공유' 시 A4 리포트 이미지를 만들 수 있는지 판단하고,
//  세션(측정이력) 항목을 A4 리포트로 그리기 위한 순수 헬퍼 모음.
//   · 전용 리포트 화면이 있는 항목(saved-report/posture/rom)은 그대로 캡처.
//   · 그 외 세션(신체정보·바벨 리프팅·레거시 1RM/VBT/RSI 등)도 A4 요약
//     리포트(SessionShareReport)로 렌더 후 캡처해, 모든 측정이 동일하게
//     A4 결과 리포트 이미지로 카카오톡 전송되게 한다.
//   · 텍스트 피드 공유는 캡처 실패 시의 최후 폴백으로만 남는다.
// ════════════════════════════════════════════════════════════════════════

// 통합 바벨 리프팅 페이로드(mode/metrics 구조)면 전용 LiftingReportDashboard 로 렌더.
export function isLiftingShapedSession(data = {}) {
  if (!data || typeof data !== 'object') return false;
  if (data.type === 'lifting') return true;
  if (data.mode === 'lifting' || data.mode === 'vbt' || data.mode === 'onerm') return true;
  return Boolean(data.metrics && typeof data.metrics === 'object'
    && (data.metrics.oneRM != null || data.metrics.meanVelocity != null || data.metrics.rangeOfMotion != null));
}

// A4 캡처 가능 여부: 전용 리포트 화면이 있거나, 세션이라도 데이터가 있으면 가능.
export function canCaptureUnifiedResult(item) {
  if (!item) return false;
  if (item.source === 'saved-report' || item.source === 'posture' || item.source === 'rom') return true;
  if (item.source !== 'session') return false;
  const data = item.report || item.session?.data;
  return Boolean(data && typeof data === 'object');
}

// ── 메뉴별 상세 값 추출 (A4 리포트의 '측정 값' 타일) ─────────────────────
//  값이 없으면(무의미) 생략 — 측정 정직성 원칙에 따라 빈 값은 그리지 않는다.
const num = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));

function pushTile(list, label, value, unit = '', accent = false) {
  if (value == null || value === '') return;
  list.push({ label, value: String(value), unit, accent });
}

export function extractSessionDetailTiles(menu, data = {}) {
  const d = data || {};
  const tiles = [];
  switch (menu) {
    case 'onerm':
      pushTile(tiles, '추정 1RM', num(d.oneRM), 'kg', true);
      if (d.liftLabel) pushTile(tiles, '종목', d.liftLabel);
      if (num(d.weight) != null && num(d.reps) != null) pushTile(tiles, '입력', `${d.weight}kg × ${d.reps}회`);
      pushTile(tiles, '도전 차수', d.attemptNo ? `${d.attemptNo}차` : null);
      break;
    case 'vbt':
      pushTile(tiles, '평균속도', num(d.meanVelocity), 'm/s', true);
      pushTile(tiles, '최고속도', num(d.peakVelocity), 'm/s');
      pushTile(tiles, '트레이닝 존', d.zone || null);
      pushTile(tiles, '가동범위', num(d.romCm ?? d.rangeOfMotion), 'cm');
      break;
    case 'rsi':
      pushTile(tiles, 'RSI', num(d.rsi?.rsi ?? d.rsi), '', true);
      pushTile(tiles, '점프 높이', num(d.heightCm), 'cm');
      pushTile(tiles, '접지 시간', num(d.contactMs ?? d.groundContactMs), 'ms');
      break;
    case 'jump':
      pushTile(tiles, '점프 높이', num(d.heightCm), 'cm', true);
      pushTile(tiles, '최대 파워', num(d.peakPower), 'W');
      pushTile(tiles, 'RSI', num(d.rsi?.rsi ?? d.rsi), '');
      break;
    case 'body':
      pushTile(tiles, '체중', num(d.weight), 'kg', true);
      pushTile(tiles, '키', num(d.height), 'cm');
      if (num(d.systolic) != null && num(d.diastolic) != null) {
        pushTile(tiles, '혈압', `${d.systolic}/${d.diastolic}`, 'mmHg');
      }
      break;
    default: {
      // 알 수 없는 메뉴: 대표적인 1차 숫자 필드 몇 개만 노출(최대 4개).
      const skip = new Set(['id', 'memberId', 'isVirtual', 'valid']);
      Object.entries(d)
        .filter(([k, v]) => !skip.has(k) && (typeof v === 'number' || typeof v === 'string') && String(v).length <= 24)
        .slice(0, 4)
        .forEach(([k, v]) => pushTile(tiles, k, v));
    }
  }
  return tiles;
}
