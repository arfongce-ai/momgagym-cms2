// ROM 선택 화면용 "움직임 설명" 데이터. poseMode 키는 리포트 pairKey 와 연결되어 있어 바꾸지 않는다.
// 화면에는 '자세'가 아니라 '무슨 움직임을 재는가'를 보여준다. (표시용 데이터만 — 계산과 무관)
import { ROM_NORMS } from './bodyMechanics';

export const REPS_TEXT = '같은 동작을 3~5회 반복';

const VIEW_LABEL = { SIDE: '옆모습 촬영', FRONT: '정면 촬영', TOP: '몸 위에서 아래로 촬영' };

// joint → poseMode → 설명. hidden: 같은 계산이라 탭에서 숨기는 구 자세(키는 호환용으로 유지).
const G = {
  HIP: {
    STANDING: { tab: '서서 다리 앞으로', measures: '서서 한쪽 무릎을 가슴 쪽으로 들어 올리는 각도(고관절 굽힘)', view: 'SIDE', posture: '서서', why: '체중을 싣고 몸이 보상하는 모습까지 함께 봅니다', steps: ['옆으로 서서 전신이 보이게 합니다', '한쪽 무릎을 가슴 쪽으로 끝까지 올렸다 내립니다', '상체가 뒤로 젖혀지지 않게 합니다'] },
    SUPINE: { tab: '누워서 다리 앞으로', measures: '누워서 무릎을 가슴 쪽으로 당기는 각도(고관절 굽힘)', view: 'SIDE', posture: '누워서', why: '몸이 흔들리지 않아 관절 자체의 가동범위만 봅니다', steps: ['바로 누워 옆에서 찍습니다', '한쪽 무릎을 가슴 쪽으로 끝까지 당겼다 내립니다', '반대쪽 다리는 펴서 바닥에 둡니다'] },
    PRONE: { tab: '엎드려 다리 뒤로', measures: '엎드려 다리를 뒤로 들어 올리는 각도(고관절 폄)', view: 'SIDE', posture: '엎드려', why: '뒤로 드는 동작은 엎드려야 허리 보상이 적습니다', steps: ['엎드려 옆에서 찍습니다', '무릎을 편 채 한쪽 다리를 뒤로 들어 올렸다 내립니다', '골반이 바닥에서 뜨지 않게 합니다'] },
    ABDUCTION: { tab: '서서 다리 옆으로', measures: '서서 다리를 옆으로 벌리는 각도(고관절 벌림)', view: 'FRONT', posture: '서서', why: '정면에서 봐야 벌어진 각도가 보입니다', steps: ['카메라를 마주 보고 섭니다', '무릎을 편 채 한쪽 다리를 옆으로 들어 올렸다 내립니다', '상체가 반대쪽으로 기울지 않게 합니다'] },
    SUPINE_ABD: { tab: '누워서 다리 옆으로', measures: '누워서 다리를 옆으로 벌리는 각도(고관절 벌림)', view: 'TOP', posture: '누워서', why: '교재 자세 — 몸이 고정되어 가장 정확합니다', steps: ['바로 누운 몸 위에서 폰을 아래로 향하게 고정합니다', '무릎을 편 채 한쪽 다리를 옆으로 벌렸다 모읍니다', '반대쪽 다리와 골반은 움직이지 않게 합니다'] },
  },
  KNEE: {
    STANDING: { tab: '서서 무릎 굽히기', measures: '서서 발뒤꿈치를 엉덩이 쪽으로 당기는 각도(무릎 굽힘)', view: 'SIDE', posture: '서서', why: '체중을 싣고 균형을 잡는 상태에서 봅니다', steps: ['옆으로 서서 전신이 보이게 합니다', '한쪽 발뒤꿈치를 엉덩이 쪽으로 끝까지 당겼다 내립니다', '허벅지는 가능한 한 움직이지 않게 합니다'] },
    SUPINE: { tab: '누워서 무릎 굽히기', measures: '누워서 무릎을 굽히는 각도(무릎 굽힘)', view: 'SIDE', posture: '누워서', why: '몸이 안정되어 무릎 자체의 가동범위만 봅니다', steps: ['바로 누워 옆에서 찍습니다', '발뒤꿈치를 바닥에 끌며 엉덩이 쪽으로 당겼다 폅니다'] },
    PRONE: { tab: '엎드려 무릎 굽히기', measures: '엎드려 발뒤꿈치를 엉덩이 쪽으로 당기는 각도(무릎 굽힘)', view: 'SIDE', posture: '엎드려', why: '허벅지 앞쪽 근육 길이까지 함께 봅니다', steps: ['엎드려 옆에서 찍습니다', '발뒤꿈치를 엉덩이 쪽으로 끝까지 당겼다 내립니다', '골반이 들리지 않게 합니다'] },
  },
  SHOULDER: {
    STANDING: { tab: '팔 앞으로 올리기', measures: '팔을 앞으로 머리 위까지 올리는 각도(어깨 굽힘)', view: 'SIDE', posture: '서서(앉아도 같음)', why: '서든 앉든 계산은 같습니다 — 편한 자세로 하세요', steps: ['옆으로 서서(또는 앉아서) 팔이 보이게 합니다', '팔꿈치를 편 채 앞으로 머리 위까지 올렸다 내립니다', '허리가 젖혀지지 않게 합니다'] },
    SEATED: { hidden: true, tab: '팔 앞으로 올리기', measures: '팔을 앞으로 머리 위까지 올리는 각도(어깨 굽힘)', view: 'SIDE', posture: '앉아서', why: '체간이 고정되어 보상이 적습니다', steps: ['옆으로 앉아 팔이 보이게 합니다', '팔을 앞으로 머리 위까지 올렸다 내립니다'] },
    ABDUCTION: { tab: '팔 옆으로 올리기', measures: '팔을 옆으로 머리 위까지 올리는 각도(어깨 벌림)', view: 'FRONT', posture: '서서', why: '정면에서 봐야 옆으로 든 각도가 보입니다', steps: ['카메라를 마주 보고 섭니다', '팔을 옆으로 머리 위까지 올렸다 내립니다', '몸통이 옆으로 기울지 않게 합니다'] },
  },
  ELBOW: {
    STANDING: { tab: '팔꿈치 굽히기', measures: '팔꿈치를 굽혀 손을 어깨 쪽으로 가져오는 각도(팔꿈치 굽힘)', view: 'SIDE', posture: '서든 앉든 상관없음', why: '자세에 따라 계산이 달라지지 않습니다', steps: ['옆으로 서서(또는 앉아서) 팔이 보이게 합니다', '팔을 쭉 편 상태에서 손을 어깨 쪽으로 끝까지 굽혔다 폅니다', '위팔은 몸 옆에 붙여 둡니다'] },
    SEATED: { hidden: true, tab: '팔꿈치 굽히기', measures: '팔꿈치를 굽혀 손을 어깨 쪽으로 가져오는 각도(팔꿈치 굽힘)', view: 'SIDE', posture: '앉아서', why: '', steps: ['옆으로 앉아 팔이 보이게 합니다', '팔을 폈다가 손을 어깨 쪽으로 끝까지 굽힙니다'] },
  },
  ANKLE: {
    STANDING: { tab: '발목 발등 들기', measures: '정강이를 앞으로 기울이거나 발등을 들어 올리는 각도(발목 발등굽힘)', view: 'SIDE', posture: '서든 앉든 상관없음', why: '자세에 따라 계산이 달라지지 않습니다', steps: ['옆으로 서서(또는 앉아서) 무릎·발목·발끝이 보이게 합니다', '발바닥은 바닥에 붙인 채 무릎을 발끝 쪽으로 밀었다 돌아옵니다', '뒤꿈치가 뜨지 않게 합니다'] },
    SEATED: { hidden: true, tab: '발목 발등 들기', measures: '발등을 정강이 쪽으로 들어 올리는 각도(발목 발등굽힘)', view: 'SIDE', posture: '앉아서', why: '', steps: ['옆으로 앉아 무릎·발목·발끝이 보이게 합니다', '뒤꿈치는 바닥에 두고 발끝을 위로 들었다 내립니다'] },
  },
  TRUNK: {
    T_FLEXION: { tab: '몸통 숙이기', measures: '서서 상체를 앞으로 숙이는 각도(몸통 굽힘)', view: 'SIDE', posture: '서서', why: '무릎을 펴고 숙여야 허리·햄스트링 범위가 보입니다', steps: ['옆으로 서서 코·어깨·고관절이 보이게 합니다', '무릎을 편 채 상체를 끝까지 숙였다 올라옵니다'] },
    T_EXTENSION: { tab: '몸통 젖히기', measures: '서서 상체를 뒤로 젖히는 각도(몸통 폄)', view: 'SIDE', posture: '서서', why: '', steps: ['옆으로 서서 손을 허리에 댑니다', '상체를 뒤로 끝까지 젖혔다 돌아옵니다'] },
    T_LATERAL: { tab: '몸통 옆으로', measures: '상체를 옆으로 기울이는 각도(몸통 옆굽힘)', view: 'FRONT', posture: '서서', why: '', steps: ['카메라를 마주 보고 발을 어깨너비로 벌립니다', '어깨는 으쓱하지 말고 몸통을 옆으로 기울였다 돌아옵니다'] },
    T_ROTATION: { tab: '몸통 돌리기', measures: '골반은 고정하고 어깨만 좌우로 돌리는 각도(몸통 돌림, 근사값)', view: 'FRONT', posture: '서서 또는 앉아서', why: '', steps: ['카메라를 마주 보고 1초간 정면으로 가만히 있습니다(0점)', '골반·발은 고정하고 어깨만 좌우로 돌렸다 돌아옵니다'] },
  },
  NECK: {
    FLEXION: { tab: '목 숙이기', measures: '턱을 가슴 쪽으로 당기는 각도(목 굽힘)', view: 'SIDE', posture: '서거나 앉아서', why: '', steps: ['옆으로 서서 1초간 정면을 봅니다(0점)', '턱을 가슴 쪽으로 천천히 끝까지 숙였다 돌아옵니다'] },
    EXTENSION: { tab: '목 젖히기', measures: '고개를 뒤로 젖히는 각도(목 폄)', view: 'SIDE', posture: '서거나 앉아서', why: '', steps: ['옆으로 서서 1초간 정면을 봅니다(0점)', '고개를 뒤로 천천히 끝까지 젖혔다 돌아옵니다'] },
    LATERAL: { tab: '목 옆으로', measures: '귀를 어깨 쪽으로 기울이는 각도(목 옆굽힘)', view: 'FRONT', posture: '서거나 앉아서', why: '', steps: ['카메라를 마주 보고 어깨 힘을 뺍니다', '어깨는 올리지 말고 귀를 어깨 쪽으로 기울였다 돌아옵니다'] },
    ROTATION: { tab: '목 돌리기', measures: '몸통은 고정하고 고개만 좌우로 돌리는 각도(목 돌림)', view: 'FRONT', posture: '서거나 앉아서', why: '', steps: ['카메라를 마주 보고 몸통을 고정합니다', '고개만 좌우로 끝까지 돌렸다 돌아옵니다'] },
  },
};

// 탭에 보이는 움직임 목록(숨김 제외).
export function visibleMovements(joint, allowedKeys) {
  return (allowedKeys || []).filter((k) => !G[joint]?.[k]?.hidden);
}

// 화면에 보일 poseMode: 숨김 키(구 SEATED 등)는 같은 계산의 대표 키로 바꿔 보여준다.
export function displayPoseKey(joint, poseMode) {
  if (G[joint]?.[poseMode]?.hidden) return Object.keys(G[joint]).find((k) => !G[joint][k].hidden) || poseMode;
  return poseMode;
}

export function normNote(joint, poseMode) {
  const spec = ROM_NORMS[joint]?.[poseMode];
  if (!spec) return '기준값 없음 — 각도만 기록합니다';
  const f = Object.values(spec)[0];
  return `참고 정상치 약 ${f.normal}° (보통 ${f.min}~${f.max}°)`;
}

export function getMovementGuide(joint, poseMode) {
  const g = G[joint]?.[poseMode];
  if (!g) return null;
  return {
    tab: g.tab,
    measures: g.measures,
    view: VIEW_LABEL[g.view] || '',
    posture: g.posture,
    why: g.why,
    steps: g.steps,
    reps: REPS_TEXT,
    norm: normNote(joint, poseMode),
  };
}

// 라이브 각도(원본)를 '가동범위' 값으로 바꾼다. 무릎·팔꿈치는 내각(펴면 180)이라 굽힘 = 180 - 내각.
export function romDisplayAngle(joint, raw) {
  if (raw == null || !Number.isFinite(raw)) return null;
  return joint === 'KNEE' || joint === 'ELBOW' ? Math.max(0, 180 - raw) : raw;
}

// 오버레이용 기준(정상) 범위. 기준값이 없는 관절(몸통 등)은 null.
export function romRefRange(joint, poseMode) {
  const spec = ROM_NORMS[joint]?.[poseMode] || ROM_NORMS[joint]?.[displayPoseKey(joint, poseMode)];
  if (!spec) return null;
  const f = Object.values(spec)[0];
  return { normal: f.normal, min: f.min, max: f.max };
}

// 횟수별 각도 요약: 최고·최저 위치와 평균(소수 1자리). 반복이 없으면 null.
export function repSummary(peaks) {
  const v = (peaks || []).filter((x) => typeof x === 'number' && Number.isFinite(x));
  if (!v.length) return null;
  const max = Math.max(...v), min = Math.min(...v);
  return {
    peaks: v,
    max, min,
    maxIdx: v.indexOf(max), minIdx: v.indexOf(min),
    avg: Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10,
    spread: Math.round((max - min) * 10) / 10,
    hasRange: v.length >= 2 && max !== min, // 2회 이상이고 값이 다를 때만 최고/최저 강조
  };
}

// 영상 HUD 카드용: 최근 6회. tone 'max'(최고)/'min'(최저).
export function repCards(peaks) {
  const s = repSummary(peaks);
  if (!s) return [];
  const all = s.peaks.map((p, i) => ({
    top: `${i + 1}회`, main: `${Math.round(p)}°`,
    tone: s.hasRange && i === s.maxIdx ? 'max' : s.hasRange && i === s.minIdx ? 'min' : '',
    latest: i === s.peaks.length - 1,
  }));
  return all.slice(-6);
}

// 종합 평가 기준(리포트 표시용). 실제 판정은 romClinical.generateRomDiagnosis 와 동일한 값.
export const GRADE_RULES = [
  { grade: '양호', score: 90, rule: '아래 항목에 걸리는 것이 없음' },
  { grade: '관리 필요', score: 65, rule: '한쪽이 정상 하한보다 작음 · 좌우 차이 15% 이상 · 몸통 보상이 큼' },
  { grade: '집중 관리', score: 35, rule: '양쪽 모두 정상 하한보다 작음' },
];
