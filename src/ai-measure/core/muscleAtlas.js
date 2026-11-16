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

// 움직임 영상(인체자료집에서 480p·12초·무음으로 줄인 것) — 도감 상세 화면에서 재생. 있는 근육만.
export const ANIM_MUSCLES = [18, 19, 23, 31];
export function muscleAnimSrc(no) { return ANIM_MUSCLES.includes(no) ? `/muscles/anim/m${pad(no)}.mp4` : null; }
