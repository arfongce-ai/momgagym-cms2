export const MOMGAGYM_BLOG_URL = 'https://blog.naver.com/posture_gym';
export const MOMGAGYM_PUBLIC_URL = 'https://momgagym-cms2.pages.dev';
export const MOMGAGYM_CHANNEL_POPUP_PATH = '/login?official=1';

const STATUS = Object.freeze({
  normal: {
    key: 'normal',
    label: '정상',
    tone: 'green',
    colorClass: 'text-emerald-300',
    bgClass: 'bg-emerald-500/12',
    borderClass: 'border-emerald-400/35',
    score: 100,
    rank: 0,
  },
  caution: {
    key: 'caution',
    label: '주의',
    tone: 'yellow',
    colorClass: 'text-amber-300',
    bgClass: 'bg-amber-500/12',
    borderClass: 'border-amber-400/35',
    score: 65,
    rank: 1,
  },
  risk: {
    key: 'risk',
    label: '위험',
    tone: 'red',
    colorClass: 'text-red-300',
    bgClass: 'bg-red-500/12',
    borderClass: 'border-red-400/35',
    score: 35,
    rank: 2,
  },
  unknown: {
    key: 'unknown',
    label: '확인 필요',
    tone: 'slate',
    colorClass: 'text-slate-400',
    bgClass: 'bg-slate-500/12',
    borderClass: 'border-slate-500/35',
    score: 0,
    rank: 3,
  },
});

export const REPORT_TERM_MAP = Object.freeze({
  pelvicDrop: {
    expert: 'Pelvic Drop',
    label: '골반 틀어짐',
    description: '좌우 골반 높이나 기울기 차이를 쉽게 표현한 지표입니다.',
    category: 'alignment',
  },
  pelvicImbalance: {
    expert: 'Pelvic Imbalance',
    label: '골반 좌우 균형',
    description: '착지나 정렬 중 골반이 한쪽으로 치우치는 정도입니다.',
    category: 'alignment',
  },
  rsi: {
    expert: 'RSI',
    label: '반응 탄성',
    description: '짧게 딛고 빠르게 다시 튀어 오르는 능력입니다.',
    category: 'power',
  },
  reactiveStrengthIndex: {
    expert: 'Reactive Strength Index',
    label: '반응 탄성',
    description: '짧은 접지 시간 대비 체공 시간을 보는 반응 점프 지표입니다.',
    category: 'power',
  },
  vbt: {
    expert: 'VBT',
    label: '운동 속도 기반 근력',
    description: '중량을 움직이는 속도로 근력과 피로도를 추정합니다.',
    category: 'strength',
  },
  meanVelocity: {
    expert: 'Mean Velocity',
    label: '평균 운동 속도',
    description: '동작 중 바벨이나 신체가 움직인 평균 속도입니다.',
    category: 'strength',
  },
  peakVelocity: {
    expert: 'Peak Velocity',
    label: '최고 운동 속도',
    description: '동작 중 가장 빠르게 움직인 순간 속도입니다.',
    category: 'strength',
  },
  velocityLoss: {
    expert: 'Velocity Loss',
    label: '속도 저하',
    description: '반복 중 속도가 얼마나 떨어졌는지 보는 피로 지표입니다.',
    category: 'strength',
  },
  oneRM: {
    expert: '1RM',
    label: '최대 근력',
    description: '한 번 들 수 있을 것으로 추정되는 최대 중량입니다.',
    category: 'strength',
  },
  formulaSpread: {
    expert: 'Formula Spread',
    label: '1RM 공식 편차',
    description: '1RM 공식별 추정값의 최소~최대 차이입니다.',
    category: 'strength',
  },
  jumpHeight: {
    expert: 'Jump Height',
    label: '점프 높이',
    description: '체공 시간 기반으로 계산한 점프 높이입니다.',
    category: 'power',
  },
  peakPower: {
    expert: 'Peak Power',
    label: '폭발력',
    description: '순간적으로 힘을 만들어내는 능력입니다.',
    category: 'power',
  },
  takeoffVelocity: {
    expert: 'Takeoff Velocity',
    label: '도약 속도',
    description: '바닥을 밀고 올라가는 속도입니다.',
    category: 'power',
  },
  contactTime: {
    expert: 'Contact Time',
    label: '접지 시간',
    description: '발이 바닥에 닿아 있던 시간입니다.',
    category: 'power',
  },
  flightTime: {
    expert: 'Flight Time',
    label: '체공 시간',
    description: '공중에 떠 있던 시간입니다.',
    category: 'power',
  },
  landingKneeAngle: {
    expert: 'Landing Knee Angle',
    label: '착지 무릎 각도',
    description: '착지 때 무릎이 얼마나 안정적으로 굽혀졌는지 봅니다.',
    category: 'technique',
  },
  trunkLean: {
    expert: 'Trunk Lean',
    label: '상체 기울기',
    description: '몸통이 앞뒤로 얼마나 기울어지는지 보는 지표입니다.',
    category: 'technique',
  },
  footLandingSymmetry: {
    expert: 'Foot Landing Symmetry',
    label: '착지 좌우 대칭',
    description: '좌우 발의 착지 위치가 얼마나 비슷한지 봅니다.',
    category: 'balance',
  },
  cadence: {
    expert: 'Cadence',
    label: '걸음 리듬',
    description: '1분 동안의 걸음 수입니다.',
    category: 'gait',
  },
  stancePct: {
    expert: 'Stance Phase',
    label: '발 디딤 비율',
    description: '발이 지면에 닿아 있는 시간 비율입니다.',
    category: 'gait',
  },
  kneeSymmetry: {
    expert: 'Knee Symmetry',
    label: '무릎 좌우 대칭',
    description: '좌우 무릎 움직임이 얼마나 비슷한지 봅니다.',
    category: 'gait',
  },
  verticalOscillation: {
    expert: 'Vertical Oscillation',
    label: '상하 흔들림',
    description: '보행이나 달리기 중 몸이 위아래로 흔들리는 정도입니다.',
    category: 'gait',
  },
  rom: {
    expert: 'ROM',
    label: '관절 가동범위',
    description: '관절이 움직일 수 있는 범위입니다.',
    category: 'mobility',
  },
  asymmetry: {
    expert: 'Asymmetry',
    label: '좌우 차이',
    description: '왼쪽과 오른쪽의 차이입니다.',
    category: 'balance',
  },
  forwardHead: {
    expert: 'Forward Head',
    label: '거북목 경향',
    description: '머리가 몸통보다 앞으로 이동한 정도입니다.',
    category: 'posture',
  },
  thoracicKyphosis: {
    expert: 'Thoracic Kyphosis',
    label: '굽은 등',
    description: '등 상부가 둥글게 말린 정도입니다.',
    category: 'posture',
  },
  shoulderHeightDiff: {
    expert: 'Shoulder Height Difference',
    label: '어깨 높이차',
    description: '좌우 어깨 높이 차이입니다.',
    category: 'posture',
  },
  pelvisHeightDiff: {
    expert: 'Pelvis Height Difference',
    label: '골반 높이차',
    description: '좌우 골반 높이 차이입니다.',
    category: 'posture',
  },
  centerOfGravity: {
    expert: 'Center of Gravity',
    label: '무게중심 치우침',
    description: '몸의 중심이 좌우 또는 앞뒤로 치우친 정도입니다.',
    category: 'posture',
  },
});

const TERM_LOOKUP = Object.freeze(
  Object.entries(REPORT_TERM_MAP).reduce((acc, [key, value]) => {
    acc[normalizeTermKey(key)] = { key, ...value };
    acc[normalizeTermKey(value.expert)] = { key, ...value };
    acc[normalizeTermKey(value.label)] = { key, ...value };
    return acc;
  }, {})
);

const VIDEO_FIELD_NAMES = new Set([
  'videoblob',
  'videofile',
  'videourl',
  'previewvideourl',
  'recordedblob',
  'recordedvideoblob',
  'recordedvideourl',
  'sourcevideo',
  'rawvideo',
  'overlayvideo',
  'mediastream',
  'stream',
]);

const SCORE_PATHS = [
  'summary.score',
  'summary.overallScore',
  'overallScore',
  'totalScore',
  'score',
  'analysis.score',
  'postureScore',
  'integrated_assessment.confidenceScore',
];

const MEASURED_AT_PATHS = [
  'measuredAt',
  'createdAt',
  'recordedAtFull',
  'recordedAt',
  'basic_info.createdAt',
  'summary.measuredAt',
];

export const METRIC_DEFINITIONS = Object.freeze({
  jump: [
    { key: 'jumpHeight', paths: ['heightCm'], unit: 'cm', range: { good: [40, 100], warn: [30, 100] } },
    { key: 'peakPower', paths: ['peakPower'], unit: 'W' },
    { key: 'takeoffVelocity', paths: ['takeoffVelocity'], unit: 'm/s' },
    { key: 'landingKneeAngle', paths: ['biomech.landingKneeAngle'], unit: '도', range: { good: [110, 150], warn: [90, 165] } },
    { key: 'footLandingSymmetry', paths: ['biomech.footLandingSymmetry.symmetryPct'], unit: '%', range: { good: [85, 100], warn: [70, 100] } },
    { key: 'pelvicImbalance', paths: ['biomech.pelvicImbalance'], unit: '%', range: { good: [0, 4], warn: [0, 7] } },
    { key: 'rsi', paths: ['rsi.rsi'], unit: '', range: { good: [2, 10], warn: [1.5, 10] } },
    { key: 'contactTime', paths: ['rsi.contactTimeMs'], unit: 'ms' },
    { key: 'flightTime', paths: ['rsi.flightTimeMs', 'flightTimeMs'], unit: 'ms' },
  ],
  posture: [
    { key: 'forwardHead', paths: ['analysis.sagittal.forwardHeadMm', 'sagittal.forwardHeadMm'], unit: 'mm', range: { good: [0, 20], warn: [0, 35] } },
    { key: 'thoracicKyphosis', paths: ['analysis.sagittal.kyphosisProxyDeg', 'sagittal.kyphosisProxyDeg'], unit: '도' },
    { key: 'shoulderHeightDiff', paths: ['analysis.frontal.shoulderHeightDiffMm', 'frontal.shoulderHeightDiffMm'], unit: 'mm', abs: true, range: { good: [0, 8], warn: [0, 15] } },
    { key: 'pelvisHeightDiff', paths: ['analysis.frontal.pelvisHeightDiffMm', 'frontal.pelvisHeightDiffMm'], unit: 'mm', abs: true, range: { good: [0, 8], warn: [0, 15] } },
    { key: 'centerOfGravity', paths: ['analysis.cog.offsetPct', 'cog.offsetPct'], unit: '%', range: { good: [0, 12], warn: [0, 25] } },
    { key: 'asymmetry', paths: ['analysis.asymmetry.averageAsi', 'asymmetry.averageAsi'], unit: '%', range: { good: [0, 10], warn: [0, 18] } },
  ],
  gait: [
    { key: 'cadence', paths: ['metrics.cadence', 'cadence'], unit: 'SPM', range: { good: [160, 180], warn: [150, 190] } },
    { key: 'stancePct', paths: ['metrics.stancePct', 'stancePct'], unit: '%', range: { good: [55, 65], warn: [50, 70] } },
    { key: 'pelvicDrop', paths: ['metrics.pelvicDropAbs', 'pelvicDropAbs', 'metrics.pelvicDrop.avg'], unit: '%', range: { good: [0, 4], warn: [0, 7] } },
    { key: 'kneeSymmetry', paths: ['metrics.kneeSymmetry', 'kneeSymmetry'], unit: '%', range: { good: [92, 100], warn: [85, 100] } },
    { key: 'verticalOscillation', paths: ['metrics.verticalOscillation', 'verticalOscillation'], unit: '%', range: { good: [4, 9], warn: [0, 13] } },
  ],
  rom: [
    { key: 'rom', paths: ['summary.max_rom', 'summary.left_max_rom', 'summary.right_max_rom', 'summary.max_angle', 'maxAngle', 'angle', 'rom'], unit: '도' },
    { key: 'asymmetry', paths: ['summary.symmetry_index_score', 'symmetry_index_score', 'leftRightDiffDeg'], unit: '%', range: { good: [0, 10], warn: [0, 18] } },
  ],
  one_rm: [
    { key: 'oneRM', paths: ['metrics.oneRM', 'estimatedOneRM', 'oneRM', 'summary.oneRM'], unit: 'kg' },
    { key: 'formulaSpread', paths: ['metadata.formulaSpreadKg', 'metadata.estimateStats.spreadKg', 'formulaSpreadKg'], unit: 'kg' },
    { key: 'meanVelocity', paths: ['metrics.meanVelocity', 'meanVelocity', 'vbt.meanVelocity'], unit: 'm/s' },
    { key: 'velocityLoss', paths: ['metrics.velocityLoss', 'velocityLoss', 'vbt.velocityLoss'], unit: '%', range: { good: [0, 15], warn: [0, 30] } },
  ],
  vbt: [
    { key: 'meanVelocity', paths: ['metrics.meanVelocity', 'meanVelocity', 'vbt.meanVelocity'], unit: 'm/s' },
    { key: 'peakVelocity', paths: ['metrics.peakVelocity', 'peakVelocity', 'vbt.peakVelocity'], unit: 'm/s' },
    { key: 'peakPower', paths: ['metrics.peakPower', 'metrics.meanPower', 'peakPower', 'vbt.peakPower'], unit: 'W' },
    { key: 'rom', paths: ['metrics.rangeOfMotion'], unit: 'cm' },
    { key: 'velocityLoss', paths: ['metrics.velocityLoss', 'velocityLoss', 'vbt.velocityLoss'], unit: '%', range: { good: [0, 15], warn: [0, 30] } },
  ],
  // stance/squat는 이미 CMS 판정 모듈(singleLegStance.js/squatBiomechanics.js)이
  // normal/caution/risk로 확정한 결과라, 다른 타입처럼 원시 수치에 범위(range)를
  // 적용해 재판정하지 않는다 — status를 그대로 신뢰도로만 노출한다(status가
  // 있으므로 range 생략 시 unknown이 아니라 status 그대로 반영되도록 아래에서
  // status를 직접 넘긴다).
  stance: [
    { key: 'stanceHoldTime', paths: ['left.trials.0.holdTimeMs', 'right.trials.0.holdTimeMs'], unit: 'ms' },
  ],
  squat: [
    { key: 'squatDepth', paths: ['trials.0.thighInclineDeg'], unit: '도' },
    { key: 'squatTorsoLean', paths: ['trials.0.torsoLeanDeg'], unit: '도' },
    { key: 'squatKneeValgus', paths: ['trials.0.kneeValgusDeg'], unit: '도' },
  ],
});

export function normalizeTermKey(term) {
  return String(term || '').toLowerCase().replace(/[^a-z0-9가-힣]/g, '');
}

export function getLaymanTerm(termKey) {
  const mapped = TERM_LOOKUP[normalizeTermKey(termKey)];
  if (mapped) return mapped;
  const fallback = humanizeKey(termKey);
  return {
    key: String(termKey || 'unknown'),
    expert: fallback,
    label: fallback,
    description: '측정 결과에서 확인한 항목입니다.',
    category: 'general',
  };
}

export function scoreToStatus(score) {
  const n = toFiniteNumber(score);
  if (n == null) return STATUS.unknown;
  if (n >= 80) return STATUS.normal;
  if (n >= 60) return STATUS.caution;
  return STATUS.risk;
}

export function rangeToStatus(value, range) {
  const n = toFiniteNumber(value);
  if (n == null || !range) return STATUS.unknown;
  if (inRange(n, range.good)) return STATUS.normal;
  if (inRange(n, range.warn)) return STATUS.caution;
  return STATUS.risk;
}

export function toLaymanMetric(metricKey, value, options = {}) {
  const term = getLaymanTerm(metricKey);
  const numeric = options.abs ? Math.abs(Number(value)) : toFiniteNumber(value);
  const finalValue = numeric == null ? value : numeric;
  const status = options.status || (options.range ? rangeToStatus(finalValue, options.range) : STATUS.unknown);
  return {
    key: term.key,
    expertLabel: term.expert,
    label: options.label || term.label,
    description: options.description || term.description,
    category: term.category,
    value: finalValue,
    displayValue: formatMetricValue(finalValue),
    unit: options.unit || '',
    status,
    score: status.score,
  };
}

export function inferReportType(report = {}) {
  // addSession 은 측정 페이로드를 { menu, data: payload } 로 감싸 저장한다.
  // 미러링 시 이 래퍼가 와도 페이로드 필드를 인식하도록 data 를 먼저 펼친 뒤
  // 최상위(menu/kind 등)로 덮어쓴다.
  const r = (report && typeof report.data === 'object' && report.data)
    ? { ...report.data, ...report }
    : report;
  const kind = String(r.kind || r.menu || r.reportType || '').toLowerCase();
  if (kind.includes('posture')) return 'posture';
  if (kind.includes('rom')) return 'rom';
  if (kind.includes('gait') || kind.includes('running')) return 'gait';
  if (kind.includes('stance')) return 'stance';
  if (kind.includes('squat')) return 'squat';
  if (kind.includes('jump') || r.jumpType || r.rsi) return 'jump';
  // 통합 바벨 리프팅 페이로드(type:'lifting' + mode) — 모드로 세부 분류.
  if (r.type === 'lifting' || r.mode === 'lifting' || r.mode === 'vbt' || r.mode === 'onerm') {
    if (r.mode === 'onerm' || r.metrics?.oneRM != null) return 'one_rm';
    return 'vbt'; // 역도·VBT 모두 속도 기반 평가로 묶어 표시
  }
  if (kind.includes('jump') || r.heightCm != null) return 'jump';
  if (kind.includes('1rm') || r.estimatedOneRM != null || r.oneRM != null) return 'one_rm';
  if (kind.includes('vbt') || r.vbt || r.meanVelocity != null) return 'vbt';
  if (r.analysis?.frontal || r.analysis?.sagittal) return 'posture';
  if (r.summary?.max_angle || r.diagnosis) return 'rom';
  return 'general';
}

export function sanitizeReportPayload(value, options = {}) {
  const seen = new WeakSet();
  return sanitizeValue(value, seen, options);
}

// stance(SLST)/squat(오버헤드 딥 스쿼트)는 singleLegStance.js/squatBiomechanics.js가
// 이미 normal/caution/risk로 확정한 결과다. 그런데 extractKeyMetrics가 쓰는
// METRIC_DEFINITIONS의 stanceHoldTime/squat* 항목은 range가 없어 rangeToStatus가
// 전부 unknown을 반환 → computeScoreFromMetrics가 채점 가능한 지표를 하나도
// 못 찾아 null → 실제로는 위험/주의인 리포트도 점수 0·상태 "확인 필요"로
// 나오던 문제(2026-08-02 발견). 아래에서 이 두 타입은 raw 지표 재채점 대신
// 이미 확정된 report.status를 점수로 직접 환산해 우선 사용한다.
const JUDGED_STATUS_REPORT_TYPES = new Set(['stance', 'squat']);

export function buildSummaryData(report = {}, options = {}) {
  const reportType = options.reportType || inferReportType(report);
  const judgedStatusScore = JUDGED_STATUS_REPORT_TYPES.has(reportType) && STATUS[report.status]
    ? STATUS[report.status].score
    : null;
  const rawScore = judgedStatusScore ?? firstDefinedPath(report, SCORE_PATHS) ?? computeScoreFromMetrics(report, reportType);
  const score = rawScore == null ? 0 : normalizeScore(rawScore);
  const status = rawScore == null ? STATUS.unknown : scoreToStatus(score);
  const keyMetrics = extractKeyMetrics(report, reportType);
  const topFindings = extractTopFindings(report, { reportType, keyMetrics, limit: options.limit || 3 });
  const title = options.title || reportTitle(reportType);
  const measuredAt = normalizeDate(firstDefinedPath(report, MEASURED_AT_PATHS)) || new Date().toISOString();

  return {
    title,
    reportType,
    measuredAt,
    overallScore: score,
    status: status.key,
    statusLabel: status.label,
    keyMetrics,
    topFindings,
    recommendations: extractRecommendations(report, reportType, topFindings),
  };
}

export function buildUnifiedReportDocument(report = {}, options = {}) {
  const reportType = options.reportType || inferReportType(report);
  const member = normalizeMember(options.member || report.member || report.basic_info || {});
  const reportId = options.reportId || report.id || report.reportId || createReportId(reportType);
  const measuredAt = normalizeDate(firstDefinedPath(report, MEASURED_AT_PATHS)) || new Date().toISOString();
  const rawData = sanitizeReportPayload(report);
  const summary = options.summary || buildSummaryData(report, { reportType });
  const share = extractKakaoSummary({ summary, member }, options.share || {});

  return {
    schemaVersion: 'mg-report-v1',
    reportId,
    userId: member.id || options.userId || '',
    reportType,
    member,
    measuredAt,
    createdAt: options.createdAt || new Date().toISOString(),
    storagePolicy: {
      videoStored: false,
      videoStoragePath: null,
      storesResultDataOnly: true,
    },
    raw: {
      data: rawData,
      media: {
        videoStored: false,
        hasLocalVideo: hasVideoReference(report),
      },
    },
    summary,
    share,
  };
}

export function extractKakaoSummary(reportOrDocument = {}, options = {}) {
  const looksLikeSummary = reportOrDocument
    && (reportOrDocument.overallScore != null || Array.isArray(reportOrDocument.topFindings));
  const summary = reportOrDocument.summary
    || (looksLikeSummary ? reportOrDocument : buildSummaryData(reportOrDocument, options));
  const member = normalizeMember(options.member || reportOrDocument.member || {});
  const topFindings = (summary.topFindings || []).slice(0, 3);
  const score = normalizeScore(summary.overallScore ?? summary.score);
  const status = scoreToStatus(score);
  const findingText = topFindings.map((item) => item.text).filter(Boolean);
  const description = options.description
    || `${status.label} · ${score}/100 · ${findingText.join(' / ') || '핵심 지표를 확인하세요.'}`;

  return {
    title: options.title || '몸가짐CMS 측정 결과 요약',
    memberName: member.name || options.memberName || '',
    reportType: summary.reportType || options.reportType || 'report',
    measuredAt: summary.measuredAt || options.measuredAt || '',
    score,
    status: status.key,
    statusLabel: status.label,
    topFindings,
    description,
    webUrl: options.webUrl || '',
    imageUrl: options.imageUrl || '',
  };
}

function originFromUrl(url) {
  if (!url) return '';
  try { return new URL(url).origin; }
  catch (e) { return ''; }
}

export function resolveChannelPopupUrl(sourceUrl = '') {
  const origin = originFromUrl(sourceUrl)
    || (typeof window !== 'undefined' ? window.location?.origin : '')
    || MOMGAGYM_PUBLIC_URL;
  return `${origin}${MOMGAGYM_CHANNEL_POPUP_PATH}`;
}

export function buildKakaoFeedTemplate(summaryInput = {}, options = {}) {
  const summary = summaryInput.topFindings ? summaryInput : extractKakaoSummary(summaryInput, options);
  const score = summary.overallScore ?? summary.score ?? 0;
  const findings = (summary.topFindings || [])
    .slice(0, 3)
    .map((finding, index) => `${index + 1}. ${finding.text}`)
    .join('\n');
  const header = summary.title || '몸가짐CMS 측정 결과 요약';
  const scoreLine = `${summary.statusLabel || ''} · 종합 ${score}/100`.trim();
  const blogUrl = resolveChannelPopupUrl(options.webUrl || summary.webUrl);
  const text = clampText(`${header}\n${scoreLine}${findings ? `\n${findings}` : ''}\n몸가짐 트레이너와 상담 후 운동하세요.`, 280);

  return {
    objectType: 'text',
    text,
    buttonTitle: '블로그 보기',
    link: {
      mobileWebUrl: blogUrl,
      webUrl: blogUrl,
    },
  };
}

export function shareSummaryToKakao(summaryInput, options = {}) {
  const Kakao = options.Kakao || (typeof window !== 'undefined' ? window.Kakao : null);
  if (!Kakao) throw new Error('Kakao SDK가 로드되지 않았습니다.');

  if (options.javascriptKey && typeof Kakao.init === 'function') {
    const initialized = typeof Kakao.isInitialized === 'function' ? Kakao.isInitialized() : false;
    if (!initialized) Kakao.init(options.javascriptKey);
  }

  if (!Kakao.Share?.sendDefault) {
    throw new Error('Kakao Share API를 사용할 수 없습니다.');
  }

  const template = buildKakaoFeedTemplate(summaryInput, options);
  return Kakao.Share.sendDefault(template);
}

export function extractKeyMetrics(report = {}, reportType = inferReportType(report)) {
  const definitions = METRIC_DEFINITIONS[reportType] || [];
  return definitions
    .map((definition) => {
      const raw = firstDefinedPath(report, definition.paths);
      if (raw == null || raw === '') return null;
      const value = definition.abs ? Math.abs(Number(raw)) : raw;
      return toLaymanMetric(definition.key, value, {
        unit: definition.unit,
        range: definition.range,
        abs: definition.abs,
      });
    })
    .filter(Boolean);
}

export function extractTopFindings(report = {}, options = {}) {
  const reportType = options.reportType || inferReportType(report);
  const keyMetrics = options.keyMetrics || extractKeyMetrics(report, reportType);
  const limit = options.limit || 3;
  const focusFindings = extractProblemFocusFindings(report);
  const metricFindings = keyMetrics
    .filter((metric) => metric.status?.key !== 'unknown')
    .sort((a, b) => (b.status?.rank || 0) - (a.status?.rank || 0))
    .map((metric) => ({
      level: metric.status.key,
      status: metric.status.key,
      statusLabel: metric.status.label,
      text: `${metric.label} ${metric.displayValue}${metric.unit ? metric.unit : ''} · ${metric.status.label}`,
      metricKey: metric.key,
    }));

  const findings = [...focusFindings, ...metricFindings]
    .filter((item) => item?.text)
    .filter(uniqueByText)
    .slice(0, limit);

  if (findings.length) return findings.map((item, index) => ({ rank: index + 1, ...item }));

  if (keyMetrics.length) {
    return [{
      rank: 1,
      level: 'unknown',
      status: 'unknown',
      statusLabel: '확인 필요',
      text: '핵심 수치는 저장됐고, 정상 범위 판정은 별도 기준 비교가 필요합니다.',
    }];
  }

  return [{
    rank: 1,
    level: 'normal',
    status: 'normal',
    statusLabel: '정상',
    text: `${reportTitle(reportType)}에서 큰 위험 신호는 확인되지 않았습니다.`,
  }];
}

function sanitizeValue(value, seen, options, key = '') {
  if (value == null) return value;
  if (shouldDropValue(key, value)) return undefined;
  if (typeof value === 'function' || typeof value === 'symbol') return undefined;
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    return value
      .map((item) => sanitizeValue(item, seen, options, key))
      .filter((item) => item !== undefined);
  }
  if (typeof value !== 'object') return value;
  if (seen.has(value)) return undefined;
  seen.add(value);

  const out = {};
  Object.entries(value).forEach(([childKey, childValue]) => {
    if (shouldDropValue(childKey, childValue)) return;
    const sanitized = sanitizeValue(childValue, seen, options, childKey);
    if (sanitized !== undefined) out[childKey] = sanitized;
  });
  seen.delete(value);
  return out;
}

function shouldDropValue(key, value) {
  const normalized = normalizeTermKey(key);
  if (VIDEO_FIELD_NAMES.has(normalized)) return true;
  if (/(^|[^a-z])video([^a-z]|$)/i.test(String(key || ''))) return true;
  if (isBlobLike(value) || isMediaStreamLike(value)) return true;
  if (typeof value === 'string' && value.startsWith('blob:') && /url/i.test(String(key || ''))) return true;
  return false;
}

function isBlobLike(value) {
  if (!value || typeof value !== 'object') return false;
  const hasBlob = typeof Blob !== 'undefined' && value instanceof Blob;
  const hasFile = typeof File !== 'undefined' && value instanceof File;
  return hasBlob || hasFile;
}

function isMediaStreamLike(value) {
  return Boolean(value && typeof value === 'object' && typeof value.getTracks === 'function');
}

function extractProblemFocusFindings(report) {
  const focus = report.problem_focus || report.problemFocus || report.summary?.problemFocus;
  if (!focus) return [];
  const items = [
    ...(Array.isArray(focus.issues) ? focus.issues : []),
    ...(Array.isArray(focus.items) ? focus.items : []),
  ];
  if (!items.length && focus.primaryFinding) {
    items.push({ level: focus.severity || 'normal', text: focus.primaryFinding });
  }
  return items.map((item) => {
    const level = normalizeLevel(item.level || item.status || focus.severity);
    return {
      level,
      status: level,
      statusLabel: STATUS[level]?.label || STATUS.unknown.label,
      text: item.text || item.message || item.label,
    };
  });
}

function extractRecommendations(report, reportType, findings) {
  const recommendation = report.problem_focus?.recommendedNextCheck
    || report.integrated_assessment?.recommendations?.[0]
    || report.recommendation
    || defaultRecommendation(reportType, findings?.[0]?.status);
  return [recommendation].filter(Boolean);
}

export function defaultRecommendation(reportType, status) {
  if (status === 'normal') return '현재 패턴을 기준으로 다음 측정에서 변화 추이를 확인하세요.';
  if (reportType === 'jump') return '착지 대칭, 하체 근력, 발목-무릎-골반 정렬을 함께 확인하세요.';
  if (reportType === 'posture') return '자세 정렬과 ROM 제한이 함께 나타나는지 교차 확인하세요.';
  if (reportType === 'rom') return '좌우 가동범위 차이가 반복되는지 같은 조건으로 재측정하세요.';
  if (reportType === 'gait') return '반복 보행에서 같은 비대칭이 유지되는지 확인하세요.';
  if (reportType === 'stance') return '자세·ROM 리포트에서 좌우 비대칭의 정렬적 원인을 함께 확인하세요.';
  if (reportType === 'squat') return '한다리서기·ROM 리포트와 함께 좌우 정렬·가동성 원인을 확인하세요.';
  return '핵심 지표를 다음 측정과 비교해 변화 추이를 확인하세요.';
}

function computeScoreFromMetrics(report, reportType) {
  const metrics = extractKeyMetrics(report, reportType);
  const scored = metrics.filter((metric) => metric.status?.key !== 'unknown');
  if (!scored.length) return null;
  return Math.round(scored.reduce((sum, metric) => sum + metric.status.score, 0) / scored.length);
}

function firstDefinedPath(object, paths = []) {
  for (const path of paths) {
    const value = getByPath(object, path);
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
}

function getByPath(object, path) {
  return String(path || '').split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), object);
}

function toFiniteNumber(value) {
  if (value === '' || value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeScore(value) {
  const n = toFiniteNumber(value);
  if (n == null) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function inRange(value, range) {
  return Array.isArray(range) && value >= range[0] && value <= range[1];
}

function formatMetricValue(value) {
  const n = toFiniteNumber(value);
  if (n == null) return String(value ?? '-');
  if (Number.isInteger(n)) return String(n);
  return String(Math.round(n * 10) / 10);
}

function humanizeKey(key) {
  return String(key || '측정 항목')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim();
}

function normalizeMember(member = {}) {
  return {
    id: member.id || member.memberId || '',
    name: member.name || member.memberName || '회원',
    isVirtual: member.isVirtual === true || member.isVirtualMember === true,
  };
}

function normalizeDate(value) {
  if (!value) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value?.toDate === 'function') return value.toDate().toISOString();
  return String(value);
}

function reportTitle(reportType) {
  const titles = {
    posture: '자세·체형 평가',
    rom: '관절 가동범위 평가',
    jump: '점프·반응 탄성 평가',
    gait: '보행·러닝 평가',
    one_rm: '최대 근력 평가',
    vbt: '운동 속도 기반 근력 평가',
    general: '측정 결과 평가',
  };
  return titles[reportType] || titles.general;
}

function normalizeLevel(level) {
  const key = String(level || '').toLowerCase();
  if (key === 'risk' || key === 'danger' || key === 'red') return 'risk';
  if (key === 'caution' || key === 'warning' || key === 'attention' || key === 'yellow') return 'caution';
  if (key === 'normal' || key === 'good' || key === 'green') return 'normal';
  return 'unknown';
}

function uniqueByText(item, index, list) {
  return list.findIndex((other) => other?.text === item?.text) === index;
}

function hasVideoReference(report = {}) {
  return Boolean(
    report.videoBlob
    || report.videoUrl
    || report.previewVideoUrl
    || report.hasVideo
    || report.videoMetrics?.overlayRecorded
  );
}

function createReportId(reportType) {
  return `${reportType || 'report'}_${Date.now()}`;
}

function clampText(text, maxLength) {
  const value = String(text || '');
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1)}…`;
}
