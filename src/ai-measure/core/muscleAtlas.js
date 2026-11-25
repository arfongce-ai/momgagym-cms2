// muscleAtlas.js — 근육 도감(47개) 목록과 자세 부위(region) → 근육 연결 (2026-11-16)
// 그림 파일: public/muscles/mNN.webp(빨강=긴장·단축), mNNb.webp(파랑=약화·이완). 520px 투명 배경.
// 근육 이름 문구(풀어주기/강화 설명)는 postureClinical.buildMuscleMap 한 곳에서 관리하고,
// 여기는 '어떤 근육 그림을 보여줄지'만 정한다. 추정 표시이며 측정값이 아니다.

export const ATLAS_GROUPS = [
  { id: 'shoulder', label: '어깨·견갑' },
  { id: 'chest_arm', label: '가슴·팔' },
  { id: 'hip', label: '둔근·고관절' },
  { id: 'thigh', label: '허벅지' },
  { id: 'calf', label: '종아리' },
  { id: 'spine_neck', label: '척추·목' },
  { id: 'core', label: '복부' },
];

const NAMES = [
  [1, '승모근', 'shoulder'], [2, '광배근', 'shoulder'], [3, '대원근', 'shoulder'], [4, '견갑거근', 'shoulder'],
  [5, '소·대능형근', 'shoulder'], [6, '삼각근', 'shoulder'], [7, '오훼완근', 'shoulder'], [8, '극상근', 'shoulder'],
  [9, '극하근', 'shoulder'], [10, '소원근', 'shoulder'], [11, '견갑하근', 'shoulder'],
  [12, '대흉근', 'chest_arm'], [13, '소흉근·쇄골하근', 'chest_arm'], [14, '전거근', 'chest_arm'],
  [15, '상완이두근', 'chest_arm'], [16, '상완근', 'chest_arm'], [17, '상완삼두근', 'chest_arm'],
  [18, '대둔근', 'hip'], [19, '중둔근', 'hip'], [20, '소둔근', 'hip'], [21, '대퇴근막장근', 'hip'],
  [22, '고관절 외회전근(6개)', 'hip'], [23, '대요근·장골근', 'hip'],
  [24, '봉공근', 'thigh'], [25, '대퇴직근', 'thigh'], [26, '중간광근', 'thigh'], [27, '내측·외측광근', 'thigh'],
  [28, '치골근', 'thigh'], [29, '장내전근', 'thigh'], [30, '단내전근', 'thigh'], [31, '대내전근', 'thigh'],
  [32, '박근', 'thigh'], [33, '슬건근(햄스트링)', 'thigh'],
  [34, '비복근', 'calf'], [35, '넙치근(가자미근)', 'calf'],
  [36, '척주', 'spine_neck'], [37, '흉쇄유돌근', 'spine_neck'], [38, '사각근', 'spine_neck'], [39, '상·하후거근', 'spine_neck'],
  [40, '요방형근', 'spine_neck'], [41, '두판상근·경판상근', 'spine_neck'], [42, '척추기립근', 'spine_neck'], [43, '반극근·다열근', 'spine_neck'],
  [44, '복직근', 'core'], [45, '외복사근', 'core'], [46, '내복사근', 'core'], [47, '복횡근', 'core'],
];

export const MUSCLE_ATLAS = NAMES.map(([no, name, group]) => ({ no, name, group }));

export function muscleById(no) { return MUSCLE_ATLAS.find((m) => m.no === no) || null; }

const pad = (n) => String(n).padStart(2, '0');
/** kind: 'tight'(빨강) | 'weak'(파랑) */
export function muscleImageSrc(no, kind = 'tight') {
  return `/muscles/m${pad(no)}${kind === 'weak' ? 'b' : ''}.webp`;
}

// 자세 부위 → 긴장(tight)/약화(weak) 근육 번호. postureClinical.buildMuscleMap 의 부위와 1:1.
export const REGION_ATLAS = {
  head_neck: { tight: [1, 4, 41], weak: [38, 37] },
  shoulder_back: { tight: [12, 13], weak: [5, 14] },
  pelvis_spine: { tight: [40, 23], weak: [19, 44] },
  foot_leg: { tight: [21, 34], weak: [18, 35] },
};

/** 활성 부위 목록 → { tight:[no...], weak:[no...] } (중복 제거, 긴장 우선) */
export function atlasForRegions(regions = []) {
  const tight = []; const weak = [];
  regions.forEach((r) => {
    const m = REGION_ATLAS[r];
    if (!m) return;
    m.tight.forEach((n) => { if (!tight.includes(n)) tight.push(n); });
    m.weak.forEach((n) => { if (!weak.includes(n) && !tight.includes(n)) weak.push(n); });
  });
  return { tight, weak: weak.filter((n) => !tight.includes(n)) };
}

// ── 항목별 근육 경향(개인별) ── 부위 전체를 한꺼번에 칠하지 않고, '주의·위험으로 판정된 항목'마다 연결한다.
// 판정 기준이 없는 항목(굽은 등·몸통 기울기 등)은 근육에 연결하지 않는다. 자세 패턴에서 흔히 동반되는 경향일 뿐 측정값이 아니다.
export const ITEM_ATLAS = {
  forward_head: { tight: [1, 4, 41], weak: [38, 37] },
  shoulder_height: { tight: [1, 4], weak: [5] },
  pelvis_height: { tight: [40], weak: [19] },
};

const LEVEL_RANK = { risk: 2, caution: 1 };

/**
 * 판정 항목 → { tight:[{no, causes[], rank}], weak:[...] } — 단계(위험>주의) 높은 순, 같은 근육은 원인을 합친다.
 * 이 사람의 값에 따라 목록·원인·좌우가 달라진다.
 */
export function atlasForItems(items = []) {
  const acc = { tight: new Map(), weak: new Map() };
  items.forEach((it) => {
    const rank = LEVEL_RANK[it.level];
    const map = ITEM_ATLAS[it.key];
    if (!rank || !map) return;
    const cause = `${it.label} ${it.value}${it.unit}${it.side ? `(${it.side} 높음)` : ''} · ${it.level === 'risk' ? '위험' : '주의'}`;
    ['tight', 'weak'].forEach((kind) => {
      map[kind].forEach((no) => {
        const cur = acc[kind].get(no) || { no, causes: [], rank: 0 };
        cur.causes.push(cause); cur.rank = Math.max(cur.rank, rank);
        acc[kind].set(no, cur);
      });
    });
  });
  const sorted = (m) => [...m.values()].sort((a, b) => b.rank - a.rank || b.causes.length - a.causes.length || a.no - b.no);
  const tight = sorted(acc.tight);
  const tightNos = new Set(tight.map((t) => t.no));
  return { tight, weak: sorted(acc.weak).filter((w) => !tightNos.has(w.no)) };
}

// 항목(자세)별 부위 이름 — 화면에서 '부위 · 자세' 묶음 제목에 쓴다.
export const ITEM_REGION_LABEL = {
  forward_head: '머리·목',
  shoulder_height: '어깨',
  pelvis_height: '골반·허리',
};

/**
 * 판정 항목별로 따로 묶은 근육 경향 — [{ key, region, label, value, unit, side, level, tight:[no], weak:[no] }]
 * 위험 > 주의 순. atlasForItems(합산)와 같은 연결표(ITEM_ATLAS)를 쓰되, 항목마다 분리해서 보여준다.
 */
export function atlasByItem(items = []) {
  return items
    .filter((it) => LEVEL_RANK[it.level] && ITEM_ATLAS[it.key])
    .map((it) => ({
      key: it.key,
      region: ITEM_REGION_LABEL[it.key] || '',
      label: it.label,
      value: it.value,
      unit: it.unit,
      side: it.side || null,
      level: it.level,
      tight: [...ITEM_ATLAS[it.key].tight],
      weak: [...ITEM_ATLAS[it.key].weak],
    }))
    .sort((a, b) => LEVEL_RANK[b.level] - LEVEL_RANK[a.level]);
}

// ── 근막경선(Anatomy Trains, Thomas Myers) ── 근육 하나가 아니라 '이어진 선'으로 보는 설명용 이론.
// 판정된 항목에만 붙인다. 이론이며 측정값이 아니다 — 같은 선 위의 다른 부위를 함께 확인하라는 안내로만 쓴다.
export const FASCIA_LINES = {
  forward_head: {
    line: '후면 표층선(SBL)',
    path: '후두부·두판상근 → 척추기립근 → 천골 → 햄스트링 → 종아리 → 발바닥',
    why: '머리가 앞으로 나오면 목 뒤쪽이 당겨지고, 같은 선 위의 등·허벅지 뒤·종아리 긴장도 함께 따라올 수 있다고 봅니다.',
    check: '목 뒤, 등 기립근, 햄스트링·종아리 유연성도 같이 확인',
  },
  shoulder_height: {
    line: '팔 후면 표층선(SBAL) · 팔 후면 심층선(DBAL)',
    path: '승모근 → 삼각근 → 팔 뒤쪽 / 능형근·견갑거근 → 회전근개',
    why: '한쪽 어깨가 높으면 그쪽 승모근·삼각근 라인이 짧아지거나 과긴장일 수 있고, 안쪽 라인(능형근·견갑거근·회전근개)이 함께 영향을 받을 수 있다고 봅니다.',
    check: '높은 쪽 승모근·삼각근, 견갑골 안쪽(능형근), 회전근개 움직임 확인',
  },
  pelvis_height: {
    line: '측면선(LL)',
    path: '발 바깥쪽 → 장경인대·대퇴근막장근 → 복사근·요방형근 주변 → 목 옆',
    why: '측면선은 몸의 좌우 균형을 잡는 선이라, 골반 높이가 다르면 한쪽 장경인대·허리 옆 라인이 더 당겨질 수 있다고 봅니다.',
    check: '높은/낮은 쪽 장경인대, 허리 옆(요방형근), 중둔근 힘 비교',
  },
};

export const FASCIA_NOTE = '근막경선은 Thomas Myers의 Anatomy Trains 이론입니다. 해부 연속성은 후면 표층선·기능선에서 근거가 비교적 강하고 나선선 등은 일부만 확인됐으며(Wilke 2016), 실제 힘 전달의 임상적 의미는 아직 근거가 부족합니다(Krause 2016). 그래서 "원인"이 아니라 "같이 확인할 곳"으로만 씁니다.';

export function fasciaForItems(items = []) {
  return items
    .filter((it) => (it.level === 'risk' || it.level === 'caution') && FASCIA_LINES[it.key])
    .map((it) => ({
      key: it.key,
      trigger: `${it.label} ${it.value}${it.unit}${it.side ? `(${it.side} 높음)` : ''} · ${it.level === 'risk' ? '위험' : '주의'}`,
      ...FASCIA_LINES[it.key],
    }));
}

// 움직임 영상(인체자료집에서 480p·12초·무음으로 줄인 것) — 도감 상세 화면에서 재생. 있는 근육만.
export const ANIM_MUSCLES = [18, 19, 23, 31];
export function muscleAnimSrc(no) { return ANIM_MUSCLES.includes(no) ? `/muscles/anim/m${pad(no)}.mp4` : null; }
