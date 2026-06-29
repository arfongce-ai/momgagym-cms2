// ai-measure/core/postureClinical.js
// ════════════════════════════════════════════════════════════════════════
//  자세·체형 측정값 → 임상 '해석' 생성기.
//
//  ⚠ 측정 정직성(Measurement Honesty) 원칙
//   1) 모든 해석은 '측정된 값'에서만 파생된다. 측정값이 없으면 해당 항목은
//      'insufficient'(판정 보류)로 두고 추측하지 않는다.
//   2) BlazePose 관절 좌표로는 '근육 활성도'를 직접 측정할 수 없다. 따라서
//      근육 밸런스 맵은 '측정'이 아니라 '자세 패턴 기반 일반적 연관 추정'이며,
//      reportLabel 에 그 사실을 명시한다(estimated=true).
//   3) 의학적 단정(진단·예후)은 하지 않는다. "~위험을 높일 수 있음",
//      "전문의 평가 권장" 같은 비단정 표현만 사용한다.
//
//  입력: perViewAnalysis = { front?, back?, left?, right? } (각 면의 analysis 객체)
//        bodyInfo = { heightCm, actualAge, sex }
//  출력: { metadata, regions[], muscleMap, riskTop3, disclaimers }
// ════════════════════════════════════════════════════════════════════════

const abs = (v) => (v == null ? null : Math.abs(v));
const pick = (perView, keys) => {
  // 여러 면 중 해당 지표를 가진 첫 면의 analysis 를 반환
  for (const k of keys) {
    if (perView[k]) return perView[k];
  }
  return null;
};

// 단계 라벨/색
const LEVEL = { normal: 'normal', caution: 'caution', risk: 'risk', insufficient: 'insufficient' };

function levelFromMm(mm, cautionAt, riskAt) {
  if (mm == null) return LEVEL.insufficient;
  const a = Math.abs(mm);
  if (a >= riskAt) return LEVEL.risk;
  if (a >= cautionAt) return LEVEL.caution;
  return LEVEL.normal;
}

function levelFromDeg(deg, cautionAt, riskAt) {
  if (deg == null) return LEVEL.insufficient;
  const a = Math.abs(deg);
  if (a >= riskAt) return LEVEL.risk;
  if (a >= cautionAt) return LEVEL.caution;
  return LEVEL.normal;
}

const worst = (levels) => {
  if (levels.includes(LEVEL.risk)) return LEVEL.risk;
  if (levels.includes(LEVEL.caution)) return LEVEL.caution;
  if (levels.some((l) => l === LEVEL.normal)) return LEVEL.normal;
  return LEVEL.insufficient;
};

// ── 성별 기준값(Gender-specific norms) ──────────────────────────────────
//  ⚠ 측정 정직성: 성별 미입력 시 성중립(neutral) 기준 + '미보정' 명시. 추정 금지.
//  근거(임상 표준, BlazePose 좌표로 산출 가능한 지표 한정):
//   • 골반 좌우 높이차: 여성 골반폭이 커 동일 mm 비대칭 민감도 ↓ → 임계 소폭 완화.
//   • Q각 프록시(고관절-무릎-발목 180° 편위): 여성 평균 Q각이 큼(통상 정상상한 남 15°/여 20°)
//     → 남성은 좁은 편위 임계, 여성은 넓은 편위 임계.
//   • 어깨 높이차: 성차 작아 동일 기준 유지(근거 부족 시 비보정).
const GENDER_NORMS = {
  pelvisDiffMm: { male: [8, 15], female: [9, 16], neutral: [8, 15] },
  qAngleDevDeg: { male: [6, 12], female: [9, 15], neutral: [7, 13] },
};

function normalizeSex(sex) {
  if (sex == null) return 'neutral';
  const t = String(sex).trim().toLowerCase();
  if (['m', 'male', '남', '남성'].includes(t)) return 'male';
  if (['f', 'female', '여', '여성'].includes(t)) return 'female';
  return 'neutral';
}

function genderThreshold(metric, sex) {
  const table = GENDER_NORMS[metric];
  if (!table) return null;
  return table[normalizeSex(sex)] || table.neutral;
}

// Q각 프록시(고관절-무릎-발목, 직선이면 180°)에서 좌우 중 큰 편위 절대값.
function qAngleDeviation(qProxy) {
  if (!qProxy) return null;
  const devs = ['left', 'right']
    .map((side) => (qProxy[side] == null ? null : Math.abs(180 - qProxy[side])))
    .filter((v) => v != null && Number.isFinite(v));
  if (!devs.length) return null;
  return Math.max(...devs);
}

// ── 1) 메타데이터(촬영/보정 조건) ──────────────────────────────────────
export function buildMetadata(bodyInfo = {}, camera = {}) {
  return {
    sex: bodyInfo.sex || null,
    actualAge: bodyInfo.actualAge ?? null,
    heightCm: bodyInfo.heightCm ?? null,
    // 카메라 세팅은 현재 고정 가정값(현장 표준). 실제 센서값이 들어오면 대체.
    captureDistanceM: camera.distanceM ?? 2.5,
    tripodHeightM: camera.tripodHeightM ?? 1.0,
    cameraTiltDeg: camera.tiltDeg ?? null, // 산출 가능 시 채움(없으면 미표기)
    horizontalPlaneCertified: camera.tiltDeg != null,
  };
}

// ── 2) 부위별 원인 진단 ────────────────────────────────────────────────
// 각 region: { key, title, level, measured[], problem, recommendation, estimated }
export function buildRegionDiagnoses(perViewAnalysis = {}, { sex = null } = {}) {
  const front = perViewAnalysis.front || null;
  const back = perViewAnalysis.back || null;
  const side = pick(perViewAnalysis, ['left', 'right']);
  const regions = [];

  // (1) 머리/목 — 측면 거북목 거리
  {
    const fh = side?.sagittal?.forwardHeadMm ?? front?.sagittal?.forwardHeadMm ?? null;
    const level = levelFromMm(fh, 25, 45);
    regions.push({
      key: 'head_neck',
      title: '머리·목',
      level,
      measured: fh == null ? [] : [{ label: '거북목 전방 이동', value: Math.round(fh), unit: 'mm' }],
      problem:
        level === LEVEL.insufficient
          ? '측면 측정이 없어 거북목 여부를 판정할 수 없습니다.'
          : level === LEVEL.normal
            ? '머리 전방 이동이 정상 범위입니다.'
            : `머리가 어깨선보다 약 ${Math.round(fh)}mm 앞으로 나와 있어 거북목·일자목 경향이 관찰됩니다. 방치 시 목·어깨 근육 피로와 만성 두통 가능성을 높일 수 있습니다.`,
      recommendation: level === LEVEL.normal || level === LEVEL.insufficient ? null : '턱 당기기(친턱), 흉추 신전 운동, 모니터 높이 조정 권장.',
      estimated: false,
    });
  }

  // (2) 어깨·등 — 측면 흉추 후만(굽은 등) 프록시 + 정면 어깨 높이차
  {
    const kyph = side?.sagittal?.kyphosisProxyDeg ?? null; // 귀-어깨-골반 각(작을수록 굽음)
    // kyphosisProxyDeg 는 180에 가까울수록 곧음. 165도 미만이면 굽은 등 경향.
    const kyphDev = kyph == null ? null : 180 - kyph;
    const kyphLevel = levelFromDeg(kyphDev, 15, 25);
    const shDiff = front?.frontal?.shoulderHeightDiffMm ?? null;
    const shLevel = levelFromMm(shDiff, 8, 18);
    const level = worst([kyphLevel, shLevel]);
    const measured = [];
    if (kyphDev != null) measured.push({ label: '굽은 등(흉추후만) 편차', value: Math.round(kyphDev), unit: '°' });
    if (shDiff != null) measured.push({ label: '어깨 높이차', value: Math.round(Math.abs(shDiff)), unit: 'mm' });
    regions.push({
      key: 'shoulder_back',
      title: '어깨·등',
      level,
      measured,
      problem:
        level === LEVEL.insufficient
          ? '어깨·등 정렬을 판정할 측정값이 부족합니다.'
          : level === LEVEL.normal
            ? '어깨 높이와 등 굴곡이 정상 범위입니다.'
            : `${kyphLevel !== LEVEL.normal && kyphDev != null ? '굽은 등(흉추 후만) 경향과 ' : ''}좌우 어깨 높이 비대칭이 관찰됩니다. 라운드 숄더가 동반되면 어깨 관절 충돌 증후군 위험과 호흡 효율 저하를 유발할 수 있습니다.`,
      recommendation: level === LEVEL.normal || level === LEVEL.insufficient ? null : '흉추 모빌리티, 견갑골 후인·하강 강화, 가슴 근육 이완 권장.',
      estimated: false,
    });
  }

  // (3) 골반·척추 — 정면 골반 높이차 + 패턴 + CoG 좌우 편향
  {
    const pelvisDiff = front?.frontal?.pelvisHeightDiffMm ?? null;
    const [pelvisCaution, pelvisRisk] = genderThreshold('pelvisDiffMm', sex);
    const pelvisLevel = levelFromMm(pelvisDiff, pelvisCaution, pelvisRisk);
    const cog = front?.cog?.available ? front.cog : null;
    const cogOffset = cog ? abs(cog.balanceOffsetPct ?? cog.offsetPct) : null;
    const cogLevel = cogOffset == null ? LEVEL.insufficient : cogOffset >= 35 ? LEVEL.risk : cogOffset >= 18 ? LEVEL.caution : LEVEL.normal;
    const level = worst([pelvisLevel, cogLevel]);
    const pattern = front?.frontal?.pelvisPattern;
    const measured = [];
    if (pelvisDiff != null) measured.push({ label: '골반 높이차', value: Math.round(Math.abs(pelvisDiff)), unit: 'mm' });
    if (cogOffset != null) measured.push({ label: '무게중심 좌우 편향', value: Math.round(cogOffset), unit: '%' });
    const patternKo =
      pattern === 'structural_leg_length_pattern' ? '구조적 다리 길이차 가능성' :
      pattern === 'functional_lumbopelvic_pattern' ? '기능적 요추-골반 비대칭 가능성' :
      pattern === 'within_error' ? '오차 범위 내' : null;
    regions.push({
      key: 'pelvis_spine',
      title: '골반·척추',
      level,
      measured,
      problem:
        level === LEVEL.insufficient
          ? '골반 정렬을 판정할 정면 측정값이 부족합니다.'
          : level === LEVEL.normal
            ? '골반 좌우 높이와 무게중심이 정상 범위입니다.'
            : `골반 좌우 비대칭${patternKo ? `(${patternKo})` : ''}과 무게중심 편향이 관찰됩니다. 짝다리 습관이 동반되면 요통과 좌우 다리 길이 차이를 유발할 수 있습니다.`,
      recommendation: level === LEVEL.normal || level === LEVEL.insufficient ? null : '양발 균등 체중 부하 습관, 약화된 둔근·코어 강화 권장.',
      estimated: false,
    });
  }

  // (4) 발·다리 — 하지 정렬(O/X) + 무릎 신전각 + Q각 프록시(성별 기준)
  {
    const leg = front?.frontal?.legAlignment || front?.rules?.legAlignment || null;
    const knee = side?.sagittal?.kneeExtensionProxyDeg ?? front?.sagittal?.kneeExtensionProxyDeg ?? null;
    const kneeLevel = knee == null ? LEVEL.insufficient : knee > 185 ? LEVEL.risk : knee > 180 ? LEVEL.caution : LEVEL.normal;
    const legLevel = leg?.status === 'risk' ? LEVEL.risk : leg?.status === 'caution' ? LEVEL.caution : leg ? LEVEL.normal : LEVEL.insufficient;
    const qDev = qAngleDeviation(front?.frontal?.qAngleProxyDeg);
    const [qCaution, qRisk] = genderThreshold('qAngleDevDeg', sex);
    const qLevel = levelFromDeg(qDev, qCaution, qRisk);
    const level = worst([kneeLevel, legLevel, qLevel]);
    const measured = [];
    if (knee != null) measured.push({ label: '무릎 신전각', value: Math.round(knee), unit: '°' });
    if (qDev != null) measured.push({ label: 'Q각 편위(프록시)', value: Math.round(qDev), unit: '°' });
    if (leg && leg.key && leg.key !== 'leg_alignment') {
      measured.push({ label: leg.label || '하지 정렬', value: leg.value ?? '', unit: leg.unit === 'index' ? '' : (leg.unit || '') });
    }
    const sexLabel = normalizeSex(sex);
    const qNote = qDev != null && qLevel !== LEVEL.normal && qLevel !== LEVEL.insufficient
      ? (sexLabel === 'female'
          ? ' 여성은 골반 폭 영향으로 Q각이 큰 편이나, 성별 기준에서도 주의 범위입니다.'
          : sexLabel === 'male'
            ? ' 남성 기준에서 Q각 편위가 주의 범위로, 무릎 외반/내반 부하 가능성이 있습니다.'
            : ' Q각 편위가 주의 범위입니다(성별 미입력 — 성중립 기준 적용).')
      : '';
    regions.push({
      key: 'foot_leg',
      title: '발·다리',
      level,
      measured,
      problem:
        level === LEVEL.insufficient
          ? '하지 정렬을 판정할 측정값이 부족합니다.'
          : level === LEVEL.normal
            ? '하지 정렬과 무릎 신전각이 정상 범위입니다.'
            : `${leg?.message ? leg.message + ' ' : ''}하지 정렬 또는 무릎 과신전 경향이 관찰됩니다. 방치 시 팔자/안짱걸음과 무릎 관절 부담 증가를 유발할 수 있습니다.${qNote}`,
      recommendation: level === LEVEL.normal || level === LEVEL.insufficient ? null : '발목·고관절 정렬 운동, 무릎 잠금 습관 교정 권장.',
      estimated: false,
    });
  }

  return regions;
}

// ── 3) 근육 밸런스 맵 (자세 패턴 기반 추정 — 측정 아님) ────────────────
export function buildMuscleMap(regions = []) {
  const byKey = Object.fromEntries(regions.map((r) => [r.key, r]));
  const tight = []; // 단축·긴장 추정
  const weak = [];  // 약화·이완 추정
  const active = (key) => byKey[key] && (byKey[key].level === LEVEL.caution || byKey[key].level === LEVEL.risk);

  if (active('head_neck')) {
    tight.push({ name: '상부 승모근·후두하근', reason: '거북목 패턴에서 흔히 과활성/단축됩니다.' });
    weak.push({ name: '심부 경추 굴곡근', reason: '머리 전방 이동 시 약화되기 쉽습니다.' });
  }
  if (active('shoulder_back')) {
    tight.push({ name: '소흉근·대흉근', reason: '라운드 숄더에서 단축되기 쉽습니다.' });
    weak.push({ name: '중·하부 승모근, 능형근', reason: '견갑 안정화가 약해지기 쉽습니다.' });
  }
  if (active('pelvis_spine')) {
    tight.push({ name: '요방형근·고관절 굴곡근', reason: '골반 비대칭/짝다리에서 한쪽이 단축되기 쉽습니다.' });
    weak.push({ name: '중둔근·복부 코어', reason: '골반 안정화가 약해지기 쉽습니다.' });
  }
  if (active('foot_leg')) {
    tight.push({ name: '장경인대·종아리근', reason: '하지 정렬 이상에서 긴장되기 쉽습니다.' });
    weak.push({ name: '대둔근·후경골근', reason: '아치/정렬 지지가 약해지기 쉽습니다.' });
  }

  return {
    estimated: true, // ⚠ 측정값 아님 — 자세 패턴 기반 일반적 연관 추정
    note: '근육 상태는 BlazePose로 직접 측정되지 않습니다. 아래는 측정된 자세 패턴에서 일반적으로 동반되는 근육 경향을 참고용으로 제시한 것이며, 실제 근긴장도 평가는 전문가 촉진이 필요합니다.',
    tight,
    weak,
  };
}

// ── 4) 통증·부상 위험 예측 Top 3 ───────────────────────────────────────
// 각 region 의 심각도(level)와 측정 편차 크기로 위험 점수를 매겨 정렬.
const SEVERITY = { risk: 3, caution: 2, normal: 0, insufficient: 0 };
const RISK_TEMPLATE = {
  head_neck: { area: '목·어깨', outcome: '경추 부담 증가로 목·어깨 통증, 긴장성 두통 가능성' },
  shoulder_back: { area: '어깨·등', outcome: '어깨 충돌 증후군 및 등 상부 통증 가능성' },
  pelvis_spine: { area: '허리·골반', outcome: '요추 부담 증가로 요통, 골반 통증 가능성' },
  foot_leg: { area: '무릎·발목', outcome: '무릎 관절 부담 증가로 무릎 통증 가능성' },
};

// 부위별 '깊은 피드백' — 우선순위 Top3 에 상세 가이드를 붙인다.
//  cause: 흔한 원인 / impact: 방치 시 생활 영향 / exercises: 구체 교정운동(종목·횟수·주의)
//  selfCheck: 집에서 자가 점검 / timeline: 개선 기대 기간 안내
//  ⚠ 측정 정직성: 운동 처방은 일반적 교정 가이드이며 통증/질환 시 전문가 우선(disclaimers에 명시).
const RISK_GUIDE = {
  head_neck: {
    cause: '장시간 모니터·스마트폰 사용, 흉추 가동성 저하, 깊은목굽힘근(심부 경부 굴곡근) 약화가 흔한 원인입니다.',
    impact: '방치하면 목·어깨 결림이 만성화되고, 긴장성 두통과 집중력 저하로 이어질 수 있습니다.',
    exercises: [
      { name: '친턱(Chin tuck)', dose: '10회 × 3세트 / 하루 2~3회', caution: '턱을 아래로 숙이지 말고 뒤로 평행 이동' },
      { name: '흉추 신전(폼롤러)', dose: '8~10회 × 2세트', caution: '허리를 과도하게 젖히지 않기' },
      { name: '벽 천사(Wall angel)', dose: '10회 × 2세트', caution: '허리·손목이 벽에서 떨어지지 않게' },
    ],
    selfCheck: '벽에 등·엉덩이를 붙이고 섰을 때 뒤통수가 자연히 벽에 닿는지 확인하세요(닿지 않으면 전방머리 경향).',
    timeline: '꾸준히 4~6주면 거북목 전방 이동이 줄어드는 경우가 많습니다.',
  },
  shoulder_back: {
    cause: '둥근 어깨(라운드 숄더), 흉근 단축, 견갑 안정근(중·하부 승모근, 전거근) 약화가 흔합니다.',
    impact: '어깨 충돌·회전근개 자극으로 팔 들 때 통증, 등 상부 뭉침이 생길 수 있습니다.',
    exercises: [
      { name: '밴드 견갑 후인(Row)', dose: '12~15회 × 3세트', caution: '어깨를 으쓱하지 말고 견갑을 모아 당기기' },
      { name: '가슴 신전(문틀 스트레칭)', dose: '30초 × 3회', caution: '통증 없는 범위까지만' },
      { name: 'YTW 운동', dose: '각 10회 × 2세트', caution: '목·승모근 긴장 없이 견갑 주도' },
    ],
    selfCheck: '편히 선 채 손등이 앞을 향하면(손바닥이 뒤) 둥근 어깨 경향일 수 있습니다.',
    timeline: '견갑 안정근 강화는 6~8주 지속 시 자세 유지력이 좋아집니다.',
  },
  pelvis_spine: {
    cause: '골반 좌우 높이차·전방경사, 둔근·코어 약화, 한쪽 다리에 기대 서는 습관이 흔한 원인입니다.',
    impact: '요추에 비대칭 부하가 쌓여 요통·골반 통증, 보행 시 불균형으로 이어질 수 있습니다.',
    exercises: [
      { name: '데드버그(코어)', dose: '8회씩 좌우 × 3세트', caution: '허리가 바닥에서 뜨지 않게 복압 유지' },
      { name: '글루트 브리지', dose: '12~15회 × 3세트', caution: '허리가 아닌 둔근으로 들어올리기' },
      { name: '사이드 플랭크', dose: '20~30초 × 좌우 2회', caution: '골반이 아래로 처지지 않게' },
    ],
    selfCheck: '거울 앞에서 양손을 골반(장골능)에 얹었을 때 좌우 높이가 다른지 확인하세요.',
    timeline: '기능적 불균형은 4~6주, 습관성 원인이 크면 더 빨리 개선되기도 합니다.',
  },
  foot_leg: {
    cause: '무릎 과신전(백니), 발목·고관절 정렬 저하, 발 아치 무너짐(과회내)이 흔한 원인입니다.',
    impact: '무릎·발목 관절에 지속 부하가 쌓여 무릎 앞쪽 통증, 발바닥 피로로 이어질 수 있습니다.',
    exercises: [
      { name: '무릎 살짝 굽혀 서기(소프트 니)', dose: '평소 서있을 때 의식적으로', caution: '무릎을 끝까지 잠그지 않기' },
      { name: '한발 균형(밸런스)', dose: '30초 × 좌우 3회', caution: '발가락으로 바닥을 가볍게 잡듯' },
      { name: '카프레이즈·발목 강화', dose: '15회 × 3세트', caution: '천천히 내릴 때 통제' },
    ],
    selfCheck: '옆에서 봤을 때 무릎이 뒤로 꺾여(과신전) 있는지, 발 안쪽 아치가 주저앉는지 확인하세요.',
    timeline: '정렬 습관 교정과 균형 운동은 4~8주 병행 시 효과적입니다.',
  },
};

export function buildRiskTop3(regions = []) {
  const scored = regions
    .filter((r) => SEVERITY[r.level] > 0)
    .map((r) => {
      const devMax = r.measured.reduce((m, x) => Math.max(m, Math.abs(x.value || 0)), 0);
      const guide = RISK_GUIDE[r.key] || null;
      return {
        key: r.key,
        area: RISK_TEMPLATE[r.key]?.area || r.title,
        outcome: RISK_TEMPLATE[r.key]?.outcome || '관절·근육 부담 증가 가능성',
        level: r.level,
        // 측정값 요약(있으면) — 어느 수치 때문에 위험으로 잡혔는지 근거 표기
        measured: Array.isArray(r.measured) ? r.measured : [],
        // 깊은 피드백
        cause: guide?.cause || null,
        impact: guide?.impact || null,
        exercises: guide?.exercises || [],
        selfCheck: guide?.selfCheck || null,
        timeline: guide?.timeline || null,
        score: SEVERITY[r.level] * 100 + devMax, // 단계 우선, 동급이면 편차 큰 순
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((x, i) => ({ rank: i + 1, ...x }));
  return scored;
}

// ── 통합 진입점 ────────────────────────────────────────────────────────
export function buildClinicalInterpretation({ perViewAnalysis = {}, bodyInfo = {}, camera = {} } = {}) {
  const metadata = buildMetadata(bodyInfo, camera);
  const sex = bodyInfo?.sex ?? null;
  const regions = buildRegionDiagnoses(perViewAnalysis, { sex });
  const muscleMap = buildMuscleMap(regions);
  const riskTop3 = buildRiskTop3(regions);
  const genderApplied = normalizeSex(sex) !== 'neutral';
  const disclaimers = [
    '본 리포트는 BlazePose 기반 스크리닝 자료이며 의료 진단이 아닙니다.',
    '근육 상태 및 위험 예측은 측정된 자세 패턴에서 파생된 참고 해석입니다.',
    '통증·신경학적 증상이 있는 경우 전문 의료진 평가가 우선입니다.',
  ];
  disclaimers.push(
    genderApplied
      ? `골반·Q각 등 일부 지표는 ${normalizeSex(sex) === 'female' ? '여성' : '남성'} 기준으로 평가했습니다.`
      : '성별 미입력 — 골반·Q각 기준은 성중립(미보정)으로 평가했습니다. 정확도를 위해 성별 입력을 권장합니다.'
  );
  return {
    metadata: { ...metadata, genderCalibrated: genderApplied },
    regions,
    muscleMap,
    riskTop3,
    disclaimers,
  };
}

export const CLINICAL_LEVEL = LEVEL;
