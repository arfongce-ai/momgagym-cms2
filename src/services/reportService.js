// services/reportService.js
// 리포트용 데이터 가공. 카메라와 무관하게 순수 함수 → 단위 테스트 가능.
//
// 명세:
//  - 실제 측정된 데이터만 필터링 (값이 없는 항목 제외)
//  - 측정값은 최대값(Max) 기준 표시
//  - 회차별 누적(시계열) 데이터 생성
//  - 키/몸무게/혈압 포함

import { METRIC_DEFINITIONS, REPORT_TERM_MAP, defaultRecommendation } from '../ai-measure/core/unifiedReport';

// 바벨/신체 속도의 물리적 상한 방어 — 실제 리프팅에서 5m/s를 넘는 값은 나올 수 없으므로
// (스내치 최고 기록급 순간속도도 2~2.5m/s 대) 계산/센서 오류로 간주해 표시에서 제외한다.
// 계산 엔진 자체는 건드리지 않고, 표시 단계에서만 걸러낸다(측정 정직성 — 명백히 틀린
// 값을 그대로 보여주면 회차별 비교 그래프의 스케일도 함께 무너진다).
const PLAUSIBLE_VELOCITY_MAX_MS = 5;
export function plausibleVelocity(v) {
  if (typeof v !== 'number' || Number.isNaN(v)) return v;
  return Math.abs(v) > PLAUSIBLE_VELOCITY_MAX_MS ? null : v;
}

// 측정 유형별 "판독 설명서" 콘텐츠. 지표 용어/설명은 REPORT_TERM_MAP(단일 소스)을 그대로
// 재사용하고, 여기서는 유형 단위의 개요·회원 설명 멘트만 추가로 정의한다(중복 정의 금지).
const GUIDE_TYPE_LABEL = {
  posture: '자세·체형', rom: 'ROM · 관절 가동범위', jump: '점프·반응 탄성', gait: '보행·러닝',
  one_rm: '최대 근력(1RM)', vbt: '운동 속도(VBT)', body: '신체정보',
};

const GUIDE_OVERVIEW = {
  posture: '카메라로 서 있는 자세를 분석해 어깨·골반이 한쪽으로 기울지 않았는지, 목이 앞으로 나오진 않았는지 확인하는 측정입니다. 통증이 생기기 전에 체형 불균형을 미리 찾는 것이 목적입니다.',
  rom: '관절을 얼마나 크게, 좌우 얼마나 비슷하게 움직일 수 있는지 재는 측정입니다. 뻣뻣한 관절이나 좌우 차이가 부상으로 이어지기 전에 확인합니다.',
  jump: '점프 높이와 착지 자세로 하체 순발력과 착지 안정성을 보는 측정입니다. 순발력 수준과 착지 시 부상 위험을 함께 확인합니다.',
  gait: '걷거나 뛸 때 걸음이 얼마나 일정하고 좌우 다리가 비슷하게 움직이는지 보는 측정입니다. 걸음 습관과 하체 좌우 불균형을 확인합니다.',
  one_rm: '반복 횟수와 속도로 한 번에 들 수 있는 최대 무게를 추정한 값입니다. 트레이닝 중량과 강도(%1RM)를 정하는 기준으로 씁니다.',
  vbt: '바벨이 움직이는 속도로 그날의 컨디션과 세트 중 피로도를 보는 측정입니다. 같은 무게라도 속도가 떨어지면 세트를 조절하라는 신호입니다.',
  body: '키·몸무게·혈압처럼 가장 기본적인 신체 상태입니다. 다른 모든 측정 결과를 해석하는 기준이 됩니다.',
};

// 등급(우수/적정/부족)이 회원에게 어떤 의미인지 — 아코디언 상단에 공통 1회 표시.
export const GUIDE_STATUS_LEGEND = [
  { key: 'normal', label: '우수', meaning: '지금 패턴을 유지해도 좋은 상태' },
  { key: 'caution', label: '적정', meaning: '크게 문제는 없지만 관찰이 필요한 상태' },
  { key: 'risk', label: '부족', meaning: '교정이나 보완 운동이 필요한 상태' },
];

function rangeHint(range, unit) {
  const good = range?.good;
  if (!Array.isArray(good) || good.length !== 2) return null;
  const [lo, hi] = good;
  if (lo == null || hi == null) return null;
  if (hi >= 999) return `정상 범위 ${lo}${unit} 이상`;
  return `정상 범위 ${lo}~${hi}${unit}`;
}

/**
 * 측정 유형별 "판독 설명서" — 회원에게 설명하고 트레이닝에 적용할 수 있도록
 * 유형 개요 + 핵심 지표 용어(재사용) + 부족할 때 무엇을 할지를 한 곳에 묶는다.
 * @param {string[]} presentTypes 이 회원이 실제로 측정한 reportType 목록(예: ['posture','jump','body'])
 * @returns {Array} [{type, typeLabel, overview, metrics:[{key,label,description,hint}], trainingTip}]
 */
export function buildInterpretationGuide(presentTypes = []) {
  const seen = new Set();
  return presentTypes
    .filter((type) => GUIDE_OVERVIEW[type] && !seen.has(type) && seen.add(type))
    .map((type) => ({
      type,
      typeLabel: GUIDE_TYPE_LABEL[type] || type,
      overview: GUIDE_OVERVIEW[type],
      metrics: (METRIC_DEFINITIONS[type] || []).map((m) => {
        const term = REPORT_TERM_MAP[m.key] || {};
        return {
          key: m.key,
          label: term.label || m.key,
          description: term.description || '',
          hint: rangeHint(m.range, m.unit),
        };
      }),
      trainingTip: type === 'body' ? null : defaultRecommendation(type, 'risk'),
    }));
}


/** 숫자로 유효한 값만 추출 (null/undefined/'' 제외) */
function num(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * 신체정보 기록 배열 → 시계열 + 최신/최대값 요약.
 * @param {Array} bodyRecords [{recordedAt, height, weight, systolic, diastolic}, ...]
 */
export function buildBodyReport(bodyRecords = []) {
  // 날짜 오름차순 정렬
  const sorted = [...bodyRecords].sort((a, b) =>
    String(a.recordedAt).localeCompare(String(b.recordedAt))
  );

  const FIELDS = [
    { key: 'height',    label: '키',       unit: 'cm'   },
    { key: 'weight',    label: '몸무게',   unit: 'kg'   },
    { key: 'systolic',  label: '최고혈압', unit: 'mmHg' },
    { key: 'diastolic', label: '최저혈압', unit: 'mmHg' },
  ];

  const series = {};   // key → [{date, value}]
  const summary = [];  // 실측 항목만

  for (const f of FIELDS) {
    const points = sorted
      .map(r => ({ date: r.recordedAt, value: num(r[f.key]) }))
      .filter(p => p.value != null);

    if (points.length === 0) continue; // 실측 없는 항목 제외(명세)

    series[f.key] = points;
    const values = points.map(p => p.value);
    const latest = points[points.length - 1];
    const first  = points[0];

    summary.push({
      key: f.key,
      label: f.label,
      unit: f.unit,
      max: Math.max(...values),                 // 최대값 기준(명세)
      min: Math.min(...values),
      latest: latest.value,
      latestDate: latest.date,
      change: points.length > 1 ? Number((latest.value - first.value).toFixed(1)) : null,
      count: points.length,
    });
  }

  return { fields: FIELDS, series, summary, recordCount: sorted.length };
}

/**
 * AI 측정 세션 배열 → 메뉴별 그룹 + 각 측정의 핵심 수치 추출.
 * @param {Array} aiSessions
 */
// jump(파워/RSI), lifting(VBT/1RM·역도)처럼 원본 menu 하나에 서로 다른 종류가
// 섞여 있는 경우를 회차 목록 조회용으로 세분화하는 키. 원본 menu 자체(등급/차트
// 판정 등 다른 로직이 참조)는 건드리지 않고, "어떤 회차들을 같이 묶어 보여줄지"만
// 이 키로 정한다 — 그렇지 않으면 파워점프/RSI 아코디언을 각각 열어도 두 종류가
// 섞인 같은 목록이 나온다(원본 menu 값이 둘 다 'jump'/'lifting'로 같기 때문).
export function menuGroupKey(session) {
  const d = session?.data || {};
  if (session?.menu === 'jump') {
    return (d.jumpType === 'reactive' || d.rsi) ? 'jump_rsi' : 'jump_power';
  }
  if (session?.menu === 'lifting') {
    const m = d.metrics || {};
    return (d.mode === 'onerm' || m.oneRM != null) ? 'lifting_onerm' : 'lifting_vbt';
  }
  return session?.menu || 'etc';
}

export function buildAiReport(aiSessions = []) {
  const sorted = [...aiSessions].sort((a, b) =>
    String(a.recordedAtFull || a.recordedAt).localeCompare(String(b.recordedAtFull || b.recordedAt))
  );

  // 메뉴별 그룹 — groupKey 기준(파워점프/RSI, VBT/1RM·역도가 서로 섞이지 않게).
  const byMenu = {};
  for (const s of sorted) {
    const key = menuGroupKey(s);
    if (!byMenu[key]) byMenu[key] = [];
    byMenu[key].push(s);
  }

  // 자세 측정(posture)은 어깨/골반 높이차를 시계열로 (실제 저장 경로: analysis.frontal.*)
  const postureSeries = {};
  const postureRows = sorted.filter(s => s.menu === 'posture' && s.data);
  if (postureRows.length) {
    postureSeries.shoulder = postureRows
      .map(s => ({ date: s.recordedAt, value: s.data.analysis?.frontal?.shoulderHeightDiffMm ?? s.data.frontal?.shoulderHeightDiffMm }))
      .filter(p => p.value != null);
    postureSeries.hip = postureRows
      .map(s => ({ date: s.recordedAt, value: s.data.analysis?.frontal?.pelvisHeightDiffMm ?? s.data.frontal?.pelvisHeightDiffMm }))
      .filter(p => p.value != null);
    postureSeries.centerline = postureRows
      .map(s => ({ date: s.recordedAt, value: s.data.analysis?.cog?.offsetPct != null ? Math.abs(s.data.analysis.cog.offsetPct) : null }))
      .filter(p => p.value != null);
  }

  // 메뉴별 측정 요약 (리포트 표시용) — 각 메뉴의 핵심 수치 1줄
  const GROUP_TITLE = {
    jump_rsi: 'RSI 반응점프', jump_power: '파워점프',
    lifting_onerm: '1RM · 역도', lifting_vbt: 'VBT',
  };
  const menuSummaries = [];
  for (const [groupKey, rows] of Object.entries(byMenu)) {
    const latest = rows[rows.length - 1];
    const d = latest.data || {};
    const title = GROUP_TITLE[groupKey] || latest.menuTitle || latest.menu || '기타';
    let metric = '';
    switch (latest.menu) {
      case 'onerm':   metric = `1RM ${d.oneRM ?? '-'}kg (${d.liftLabel ?? ''} ${d.weight}kg×${d.reps})`; break;
      case 'rsi':     metric = `RSI ${d.rsi ?? '-'} · 높이 ${d.heightCm ?? '-'}cm`; break;
      case 'vbt':     metric = `평균속도 ${d.meanVelocity ?? '-'}m/s (${d.zone ?? ''})`; break;
      case 'jump':
        metric = groupKey === 'jump_rsi'
          ? `RSI ${d.rsi?.rsi ?? d.rsi ?? '-'} · 높이 ${d.heightCm ?? '-'}cm`
          : `높이 ${d.heightCm ?? '-'}cm${d.peakPower ? ` · ${d.peakPower}W` : ''}`;
        break;
      case 'lifting': {
        const lm = d.metrics || {};
        metric = groupKey === 'lifting_onerm'
          ? `1RM 추정 ${lm.oneRM ?? '-'}kg`
          : `평균속도 ${plausibleVelocity(lm.meanVelocity) ?? '-'}m/s`;
        break;
      }
      case 'posture': {
        const shoulder = d.analysis?.frontal?.shoulderHeightDiffMm ?? d.frontal?.shoulderHeightDiffMm;
        const pelvis = d.analysis?.frontal?.pelvisHeightDiffMm ?? d.frontal?.pelvisHeightDiffMm;
        metric = `어깨 높이차 ${shoulder ?? '-'}mm · 골반 ${pelvis ?? '-'}mm`;
        break;
      }
      case 'rom': {
        const s = d.summary || d;
        const angle = s.max_rom ?? s.left_max_rom ?? s.right_max_rom ?? s.max_angle;
        metric = `가동범위 ${angle ?? '-'}°`;
        break;
      }
      case 'body':    metric = `${d.weight ?? '-'}kg${d.systolic ? ` · ${d.systolic}/${d.diastolic}` : ''}`; break;
      default:        metric = `${rows.length}회 측정`;
    }
    menuSummaries.push({
      menu: latest.menu,   // 원본 menu(jump/gait/posture/rom/lifting/...) — 등급·차트 판정 등 기존 로직 호환용
      groupKey,            // 세분화 키(jump_rsi/jump_power/lifting_onerm/lifting_vbt/...) — 회차 목록 조회용
      title,
      count: rows.length,
      latestDate: latest.recordedAt,
      metric,
    });
  }

  return { byMenu, postureSeries, menuSummaries, sessionCount: sorted.length };
}

/**
 * 종합 리포트 — 실측 데이터만 모아 텍스트 설명 포함.
 */
export function buildFullReport({ member, bodyRecords, aiSessions }) {
  const body = buildBodyReport(bodyRecords);
  const ai = buildAiReport(aiSessions);

  // 텍스트 설명 자동 생성 (실측 항목 기반)
  const notes = [];
  for (const s of body.summary) {
    if (s.change == null) {
      notes.push(`${s.label}: ${s.latest}${s.unit} (최초 측정)`);
    } else {
      const dir = s.change > 0 ? '증가' : s.change < 0 ? '감소' : '변화 없음';
      const arrow = s.change > 0 ? '▲' : s.change < 0 ? '▼' : '–';
      notes.push(`${s.label}: ${s.latest}${s.unit} (최초 대비 ${arrow}${Math.abs(s.change)}${s.unit} ${dir}, 최대 ${s.max}${s.unit})`);
    }
  }
  if (ai.postureSeries.shoulder?.length) {
    const last = ai.postureSeries.shoulder.at(-1);
    notes.push(`어깨 기울기 최근값 ${last.value}° (낮을수록 균형)`);
  }

  const hasData = body.summary.length > 0 || ai.sessionCount > 0;

  return {
    member,
    generatedAt: new Date().toISOString(),
    body,
    ai,
    notes,
    hasData,
  };
}

/**
 * 신체정보 기록 배열 → 가장 최근 1건의 압축 스냅샷.
 * 다른 리포트(자세·ROM·점프·보행·근력 등)에 "자동 등록"할 때 쓰는 경량 형태.
 * 값이 없는 항목은 아예 만들지 않는다(측정 정직성 — 0으로 위장하지 않음).
 * @param {Array} bodyRecords store.getBodyRecords(memberId) 결과
 * @returns {object|null} { date, height?, weight?, bmi?, systolic?, diastolic? } 또는 기록 없으면 null
 */
export function getLatestBodyInfoSnapshot(bodyRecords = []) {
  if (!bodyRecords.length) return null;
  const latest = [...bodyRecords]
    .sort((a, b) => String(a?.recordedAt || '').localeCompare(String(b?.recordedAt || '')))
    .at(-1);
  if (!latest) return null;

  const height = num(latest.height);
  const weight = num(latest.weight);
  const systolic = num(latest.systolic);
  const diastolic = num(latest.diastolic);
  if (height == null && weight == null && systolic == null) return null; // 실측 없으면 null(명세)

  const snapshot = { date: latest.recordedAt || null };
  if (height != null) snapshot.height = height;
  if (weight != null) snapshot.weight = weight;
  if (systolic != null) snapshot.systolic = systolic;
  if (diastolic != null) snapshot.diastolic = diastolic;
  if (height != null && weight != null && height > 0) {
    const m = height / 100;
    snapshot.bmi = Math.round((weight / (m * m)) * 10) / 10;
  }
  return snapshot;
}

/**
 * 통합 결과(unifiedResults) + 신체정보 기록 → 날짜별 그룹.
 * 측정 캘린더에서 "언제 측정했는지"를 보여주고, 날짜 클릭 시 그날의 결과만 추린다.
 * @param {Array} unifiedResults  Report.jsx buildUnifiedResults() 결과 ({date, summary:{overallScore}} 형태)
 * @param {Array} bodyRecords     store.getBodyRecords(memberId) 결과
 * @returns {Array} [{date, items, bodyEntry, count, avgScore}, ...] 최신 날짜순
 */
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

export function groupResultsByDate(unifiedResults = [], bodyRecords = []) {
  const map = new Map();
  const ensure = (ymd) => {
    if (!map.has(ymd)) map.set(ymd, { date: ymd, items: [], bodyEntry: null });
    return map.get(ymd);
  };

  unifiedResults.forEach((item) => {
    const ymd = String(item?.date || '').slice(0, 10);
    if (!YMD_RE.test(ymd)) return;
    ensure(ymd).items.push(item);
  });

  // 같은 날 여러 신체정보 기록이 있으면 그날의 마지막(=가장 최신) 값을 채택한다.
  [...bodyRecords]
    .sort((a, b) => String(a?.recordedAt || '').localeCompare(String(b?.recordedAt || '')))
    .forEach((rec) => {
      const ymd = String(rec?.recordedAt || '').slice(0, 10);
      if (!YMD_RE.test(ymd)) return;
      ensure(ymd).bodyEntry = rec;
    });

  return [...map.values()]
    .map((g) => {
      const scores = g.items
        .map((i) => i?.summary?.overallScore)
        .filter((n) => typeof n === 'number' && Number.isFinite(n));
      const avgScore = scores.length
        ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
        : null;
      return { ...g, count: g.items.length + (g.bodyEntry ? 1 : 0), avgScore };
    })
    .sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * 분석 리포트(gait_reports) → 회차별 추세 시계열.
 * 보행/점프를 kind 로 구분해 각각의 핵심 지표를 날짜순 series 로 만든다.
 * @param {Array} reports aiStore.getGaitReports(mid) 결과
 */
export function buildAnalysisTrend(reports = []) {
  const sorted = [...reports].sort((a, b) =>
    String(a.createdAt || a.measuredAt).localeCompare(String(b.createdAt || b.measuredAt))
  );
  const dateOf = (r) => String(r.createdAt || r.measuredAt || '').slice(0, 10);

  // 점프 추세
  const jumpRows = sorted.filter(r => r.kind === 'jump' || r.heightCm != null && r.flightTimeMs != null);
  const jump = {
    count: jumpRows.length,
    height:      jumpRows.map(r => ({ date: dateOf(r), value: num(r.heightCm) })).filter(p => p.value != null),
    flightMs:    jumpRows.map(r => ({ date: dateOf(r), value: num(r.flightTimeMs) })).filter(p => p.value != null),
    peakPower:   jumpRows.map(r => ({ date: dateOf(r), value: num(r.peakPower) })).filter(p => p.value != null),
    footSym:     jumpRows.map(r => ({ date: dateOf(r), value: num(r.biomech?.footLandingSymmetry?.symmetryPct) })).filter(p => p.value != null),
    landKnee:    jumpRows.map(r => ({ date: dateOf(r), value: num(r.biomech?.landingKneeAngle) })).filter(p => p.value != null),
    latest: jumpRows.at(-1) || null,
  };

  // 보행 추세 (metrics 폴백 포함)
  const gaitRows = sorted.filter(r => r.kind === 'gait' || (r.cadence != null || r.metrics?.cadence != null));
  const gm = (r, k) => num(r[k] ?? r.metrics?.[k]);
  const gait = {
    count: gaitRows.length,
    cadence:     gaitRows.map(r => ({ date: dateOf(r), value: gm(r, 'cadence') })).filter(p => p.value != null),
    pelvicDrop:  gaitRows.map(r => ({ date: dateOf(r), value: num(r.pelvicDropAbs ?? r.metrics?.pelvicDropAbs) })).filter(p => p.value != null),
    kneeSym:     gaitRows.map(r => ({ date: dateOf(r), value: num(r.kneeSymmetry ?? r.metrics?.kneeSymmetry) })).filter(p => p.value != null),
    latest: gaitRows.at(-1) || null,
  };

  return { jump, gait };
}

// 자세·체형 측정 이력 추세 (posture_reports)
// 자세 점수·체형나이·핵심 편차(거북목/어깨·골반 높이차)의 회차별 변화를 만든다.
export function buildPostureTrend(reports = []) {
  const sorted = [...reports].sort((a, b) =>
    String(a.createdAt || a.measuredAt).localeCompare(String(b.createdAt || b.measuredAt))
  );
  const dateOf = (r) => String(r.createdAt || r.measuredAt || '').slice(0, 10);
  // 저장 구조가 버전에 따라 다를 수 있어 여러 경로를 폴백으로 읽는다.
  const an = (r) => r.analysis || r;
  const score = (r) => num(an(r).score ?? r.postureScore);
  const bodyAge = (r) => num(an(r).bodyAge ?? r.bodyAge);
  const forwardHead = (r) => num(an(r).sagittal?.forwardHeadMm);
  const shoulderDiff = (r) => { const v = an(r).frontal?.shoulderHeightDiffMm; return v == null ? null : Math.abs(num(v)); };
  const pelvisDiff = (r) => { const v = an(r).frontal?.pelvisHeightDiffMm; return v == null ? null : Math.abs(num(v)); };

  const rows = sorted.filter(r => an(r).score != null || r.postureScore != null || an(r).frontal || an(r).sagittal);
  return {
    count: rows.length,
    score:        rows.map(r => ({ date: dateOf(r), value: score(r) })).filter(p => p.value != null),
    bodyAge:      rows.map(r => ({ date: dateOf(r), value: bodyAge(r) })).filter(p => p.value != null),
    forwardHead:  rows.map(r => ({ date: dateOf(r), value: forwardHead(r) })).filter(p => p.value != null),
    shoulderDiff: rows.map(r => ({ date: dateOf(r), value: shoulderDiff(r) })).filter(p => p.value != null),
    pelvisDiff:   rows.map(r => ({ date: dateOf(r), value: pelvisDiff(r) })).filter(p => p.value != null),
    latest: rows.at(-1) || null,
  };
}
