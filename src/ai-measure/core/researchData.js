// ai-measure/core/researchData.js
// ════════════════════════════════════════════════════════════════════════
//  [2026-11-17] 연구·비교 논문용 데이터 내보내기(전 측정 공통).
//  원칙(대표님 결정): 화면에는 보여주지 않는 기준·보정 정보까지 측정 조건과 함께 저장해 두고, 나중에 비교 연구에 쓴다.
//   · 가명화: 회원 이름·전화·생년월일은 내보내지 않는다. 가명 ID(해시) + 성별 + 5세 단위 연령대만 쓴다.
//   · 긴 형식(tidy): 한 지표가 한 줄 — 측정 종류가 달라도 같은 열로 합칠 수 있다.
//   · 조건 열(device_basis·machine·protocol)로 같은 조건끼리만 비교할 수 있게 한다(예: 커브드 트레드밀 ≠ 평지).
//   · 판정 상태·점수도 함께 남기되, 원값(value)이 기준이다. 원본 영상·사진은 포함하지 않는다.
//  순수 함수만 둔다(화면·저장소 없음).
// ════════════════════════════════════════════════════════════════════════
import { buildSummaryData, inferReportType } from './unifiedReport';
import { ageFromBirthDate } from './heartRateBle';
import { cardioHistoryMetrics, normalizeSex, getProtocol } from './cardioTest';

export const RESEARCH_SCHEMA_VERSION = 'mg-research-v1';

export const RESEARCH_COLUMNS = [
  ['schema', '스키마 버전'],
  ['subject_id', '가명 회원 ID(이름과 연결되지 않는 해시)'],
  ['sex', '성별(male/female, 없으면 빈칸)'],
  ['age_band', '측정 당시 연령대(5세 단위, 없으면 빈칸)'],
  ['height_cm', '키(cm, 회원관리 값)'],
  ['weight_kg', '체중(kg, 회원관리 값 또는 측정 입력값)'],
  ['measured_date', '측정일(YYYY-MM-DD)'],
  ['record_id', '기록 ID(무작위 문서 ID)'],
  ['source', '저장 위치(session/posture/rom/saved-report)'],
  ['report_type', '측정 종류(posture/rom/gait/jump/sprint/squat/stance/vbt/one_rm/cardio/senior/body/general)'],
  ['test_id', '세부 테스트·종목(점프 종류, 심폐 테스트 등)'],
  ['device_basis', '측정 조건 구분(standard=일반, curved=커브드 트레드밀)'],
  ['machine', '장비(심폐 장비 이름 등)'],
  ['metric_key', '지표 이름'],
  ['metric_label', '지표 한글 이름'],
  ['metric_value', '지표 원값'],
  ['metric_unit', '단위'],
  ['judged_status', '센터 판정(normal/caution/risk/unknown) — 검증된 기준이 있는 지표만'],
  ['overall_score', '종합 점수(없으면 빈칸)'],
  ['overall_status', '종합 판정'],
  ['ref_test', '교재 기준표 비교 종류(run2400/run12min) — 연구 전용'],
  ['ref_source', '기준 출처 구분(book=교재 원문, derived=공식 계산)'],
  ['ref_group', '기준 집단(성별-연령대)'],
  ['ref_percentile', '평지 기준표 상 백분위(근사) — 커브드와 직접 비교 불가'],
  ['ref_vo2max', '공식으로 환산한 VO2max(평지 기준) — 연구 전용'],
];

// 간단한 32비트 해시 두 개를 이어 가명 ID 를 만든다(되돌릴 수 없지만 암호학적 보안용은 아니다 — 연구 가명화용).
function cyrb53(str, seed = 0) {
  let h1 = 0xdeadbeef ^ seed; let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i += 1) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}
export function pseudonymId(memberId, salt = 'momgagym-research-v1') {
  if (!memberId) return '';
  return `S${cyrb53(`${salt}:${memberId}`).toString(36).toUpperCase().padStart(11, "0")}`;
}

export function ageBand5(age) {
  const a = Number(age);
  if (!Number.isFinite(a) || a < 5 || a > 100) return '';
  const lo = Math.floor(a / 5) * 5;
  return `${lo}-${lo + 4}`;
}

const dateOnly = (v) => String(v || '').slice(0, 10);
const num = (v) => (Number.isFinite(Number(v)) && v !== '' && v !== null ? Number(v) : '');

function recordDate(r, fallback) {
  return dateOnly(r?.startedAt || r?.measuredAt || r?.createdAt || r?.recordedAtFull || r?.recordedAt || fallback);
}

// 종류별 추가 지표(카드에 안 나오는 원값). 지금은 심폐만.
function extraMetrics(reportType, record) {
  if (reportType !== 'cardio') return [];
  const out = [];
  const r = record.result || {};
  const push = (key, label, value, unit = '') => { if (Number.isFinite(Number(value)) && value !== null) out.push({ key, label, value: Number(value), unit }); };
  push('avgHr', '평균 심박', r.avgHr, 'bpm');
  push('peakHr', '최고 심박', r.peakHr, 'bpm');
  push('hrMax', '최대심박 기준', record.hrMax?.value, 'bpm');
  push('endHr', '운동 직후 심박', record.recovery?.endHr, 'bpm');
  push('hr60', '1분 뒤 심박', record.recovery?.hr60, 'bpm');
  push('paceSec500', '500m 페이스', r.paceSec500, '초');
  return out;
}

/**
 * 기록 하나 → 연구 행 여러 개(지표당 한 행).
 * @param {{member:object, record:object, source:string, id?:string, recordedAt?:string, reportType?:string}} p
 */
export function buildResearchRows({ member = {}, record = {}, source = 'session', id = '', recordedAt = '', reportType = '' }) {
  const data = record && typeof record.data === 'object' && record.data ? { ...record.data, ...record } : (record || {});
  const type = reportType || inferReportType(data);
  const date = recordDate(data, recordedAt);
  const mDate = date ? new Date(`${date}T00:00:00`) : new Date();
  const age = data.subject?.age ?? ageFromBirthDate(member.birthDate, Number.isNaN(mDate.getTime()) ? new Date() : mDate) ?? member.age;
  const sex = normalizeSex(data.subject?.sex || member.sex || member.gender) || '';
  const weight = data.subject?.weightKg ?? member.weight ?? data.weight ?? data.weightKg ?? '';
  let summary = null;
  try { summary = buildSummaryData(data, { reportType: type }); } catch { summary = null; }
  const metrics = summary?.keyMetrics?.length ? summary.keyMetrics : [];
  const isCardio = type === 'cardio';
  const protocol = isCardio ? getProtocol(data.protocolId) : null;
  const ref = isCardio ? data.flatReference : null;
  const base = {
    schema: RESEARCH_SCHEMA_VERSION,
    subject_id: pseudonymId(member.id),
    sex,
    age_band: ageBand5(age),
    height_cm: num(member.height ?? member.heightCm ?? data.heightCm),
    weight_kg: num(weight),
    measured_date: date,
    record_id: id || data.id || '',
    source,
    report_type: type,
    test_id: isCardio ? (data.protocolId || '') : (data.jumpType || data.subType || data.mode || data.joint || data.lift || data.liftLabel || ''),
    device_basis: isCardio ? (data.basis || protocol?.basis || 'standard') : '',
    machine: isCardio ? (data.machineLabel || data.machineId || '') : '',
    overall_score: summary && summary.status !== 'unknown' ? summary.overallScore : '',
    overall_status: summary?.status || '',
    ref_test: ref?.test || '',
    ref_source: ref?.source || '',
    ref_group: ref?.group || '',
    ref_percentile: ref ? num(ref.percentile) : '',
    ref_vo2max: ref ? num(ref.vo2max) : '',
  };
  const rows = [];
  const add = (m) => {
    if (m == null || !Number.isFinite(Number(m.value))) return;
    rows.push({ ...base, metric_key: m.key, metric_label: m.label || m.key, metric_value: Number(m.value), metric_unit: m.unit || '', judged_status: m.status?.key || m.statusKey || 'unknown' });
  };
  if (isCardio) {
    cardioHistoryMetrics(data).forEach((m) => add({ ...m, status: null }));
  } else {
    metrics.forEach(add);
  }
  extraMetrics(type, data).forEach(add);
  return rows;
}

/**
 * 한 회원의 전 기록을 연구 행으로 바꾼다.
 * @param {{member:object, sessions?:Array, gaitReports?:Array, postureReports?:Array, romReports?:Array}} p
 */
export function buildMemberResearchRows({ member, sessions = [], gaitReports = [], postureReports = [], romReports = [] }) {
  if (!member) return [];
  const rows = [];
  (sessions || []).forEach((s) => {
    // 세션 래퍼 { menu, data } — menu 가 판정 힌트이므로 data 에 kind 가 없으면 menu 를 넣는다.
    const data = s?.data && typeof s.data === 'object' ? s.data : null;
    if (!data) return;
    const withKind = data.kind || data.reportType ? data : { ...data, kind: s.menu };
    rows.push(...buildResearchRows({ member, record: withKind, source: 'session', id: s.id, recordedAt: s.recordedAtFull || s.recordedAt }));
  });
  (gaitReports || []).forEach((r) => rows.push(...buildResearchRows({ member, record: r, source: 'saved-report', id: r?.id })));
  (postureReports || []).forEach((r) => rows.push(...buildResearchRows({ member, record: r, source: 'posture', id: r?.id, reportType: 'posture' })));
  (romReports || []).forEach((r) => rows.push(...buildResearchRows({ member, record: r, source: 'rom', id: r?.id, reportType: 'rom' })));
  return rows;
}

function csvCell(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function researchRowsToCsv(rows = []) {
  const cols = RESEARCH_COLUMNS.map(([k]) => k);
  const lines = [cols.join(',')];
  rows.forEach((r) => lines.push(cols.map((c) => csvCell(r[c])).join(',')));
  return `﻿${lines.join('\r\n')}\r\n`; // BOM: 엑셀에서 한글이 깨지지 않게
}

export function researchCodebookCsv() {
  const lines = ['column,description'];
  RESEARCH_COLUMNS.forEach(([k, d]) => lines.push(`${csvCell(k)},${csvCell(d)}`));
  lines.push(`notes,${csvCell('이름·전화·생년월일·원본 영상/사진은 포함하지 않습니다. device_basis=curved 기록은 평지 기준표와 직접 비교하지 않습니다. ref_* 열은 연구 전용입니다.')}`);
  return `﻿${lines.join('\r\n')}\r\n`;
}
