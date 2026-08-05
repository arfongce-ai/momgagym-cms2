// record_measure_skeleton_quality.test.js
// ════════════════════════════════════════════════════════════════════════
//  [2026-08-02] '일반영상녹화' 스켈레톤 모드 품질 개선 회귀 테스트.
//  실사용 영상(몸가짐2608021447.mp4)에서 보고된 문제 + 참고 이미지(Live
//  Analysis 스타일) 적용 요청을 함께 고정한다:
//   1) 관절각(ROM) 숫자가 프레임마다 튀던 문제 → EMA 스무딩 적용.
//   2) 스켈레톤 시인성 낮음 → 어두운 외곽선(halo)을 선/점/호 모두에 적용.
//   3) 참고 이미지 스타일 반영 → 상체(빨강)/하체(초록) 2색 구분 + 관절 흰 점 +
//      관절각을 꽉 찬 원이 아니라 실제 벌어진 만큼만 그리는 "각도기" 호.
//  미리보기(drawSkeletonCover)와 녹화 합성(drawSkeletonToRecordCover)이 같은
//  drawSkeletonPaths를 공유하므로, 이 함수 하나만 고치면 라이브 화면과 저장
//  영상 양쪽에 함께 반영된다.
// ════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { landmarkScreenPos } from '../ai-measure/menus/RecordMeasure.jsx';

const src = readFileSync(
  join(process.cwd(), 'src/ai-measure/menus/RecordMeasure.jsx'),
  'utf8',
);

function fnBodyOf(src, fnName) {
  const start = src.indexOf(`function ${fnName}`);
  expect(start).toBeGreaterThan(-1);
  // 같은 들여쓰기 깊이의 닫는 중괄호(파일 최상위 함수 종료)를 찾는다 —
  // 이 파일의 스타일상 최상위 함수는 '\n}'로 끝난다.
  const end = src.indexOf('\n}', start);
  return src.slice(start, end);
}

describe('RecordMeasure.jsx — 관절각 스무딩(ROM 민감도 완화)', () => {
  it('공용 스무더와 각도 안정화기를 함께 가져온다', () => {
    expect(src).toMatch(/import \{ createSmoother, createAngleStabilizer \} from '\.\.\/core\/smoothing';/);
  });

  it('좌표 EMA 계수를 상수로 두고, 다른 화면(0.28)보다 더 세게 잡는다', () => {
    const m = src.match(/const SKELETON_SMOOTHING_ALPHA = ([\d.]+);/);
    expect(m).not.toBeNull();
    expect(Number(m[1])).toBeLessThan(0.28);
    expect(src).toMatch(/const smootherRef = useRef\(createSmoother\(SKELETON_SMOOTHING_ALPHA\)\);/);
  });

  it('스켈레톤이 다시 켜질 때 스무더와 각도 안정화기를 함께 리셋한다', () => {
    const onIdx = src.indexOf('const off = subscribeSkeleton');
    const onBlock = src.slice(onIdx, src.indexOf('});', onIdx));
    expect(onBlock).toMatch(/smootherRef\.current = createSmoother\(SKELETON_SMOOTHING_ALPHA\)/);
    expect(onBlock).toMatch(/angleStabilizerRef\.current\.reset\(\)/);
  });

  it('새로 검출된 랜드마크만 스무더에 통과시켜 저장한다(검출 실패 프레임은 마지막 값 유지)', () => {
    expect(src).toMatch(/if \(landmarks\) \{\s*latestLandmarksRef\.current = smootherRef\.current\(landmarks\);\s*\}/);
    const loopStart = src.indexOf('const drawLoop = useCallback');
    const loopBody = src.slice(loopStart, loopStart + 1500);
    expect(loopBody).not.toMatch(/latestLandmarksRef\.current = landmarks \|\| latestLandmarksRef\.current;/);
  });

  it('미리보기·녹화 합성 모두 같은(스무딩된) latestLandmarksRef와 같은 각도 안정화기를 쓴다', () => {
    expect(src).toMatch(/drawSkeletonCover\(canvas, video, latestLandmarksRef\.current, angleStabilizerRef\.current\);/);
    expect(src).toMatch(/drawSkeletonToRecordCover\(ctx, video, latestLandmarksRef\.current, canvas\.width, canvas\.height, angleStabilizerRef\.current\)/);
  });
});

describe('RecordMeasure.jsx — 뼈대 상/하체 2색 + 시인성 halo', () => {
  it('UPPER_BONES/LOWER_BONES로 나뉘어 있고 SKELETON_BONES는 그 합집합이다', () => {
    expect(src).toMatch(/const UPPER_BONES = \[/);
    expect(src).toMatch(/const LOWER_BONES = \[/);
    expect(src).toMatch(/const SKELETON_BONES = \[\.\.\.UPPER_BONES, \.\.\.LOWER_BONES\];/);
  });

  it('어깨선·팔은 상체(UPPER_BONES)에, 골반선·다리는 하체(LOWER_BONES)에 속한다', () => {
    const upperBlock = src.slice(src.indexOf('const UPPER_BONES = ['), src.indexOf('];', src.indexOf('const UPPER_BONES = [')));
    const lowerBlock = src.slice(src.indexOf('const LOWER_BONES = ['), src.indexOf('];', src.indexOf('const LOWER_BONES = [')));
    expect(upperBlock).toMatch(/\[11, 12\]/); // 어깨선
    expect(upperBlock).toMatch(/\[13, 15\]/); // 왼팔뚝
    expect(lowerBlock).toMatch(/\[23, 24\]/); // 골반선
    expect(lowerBlock).toMatch(/\[25, 27\]/); // 왼정강이
  });

  it('모든 뼈대에 검은 외곽선을 먼저 그린 뒤, 상체는 빨강·하체는 초록으로 색칠한다', () => {
    const fnBody = fnBodyOf(src, 'drawSkeletonPaths');
    const outlineIdx = fnBody.indexOf("strokeStyle = 'rgba(0,0,0,0.6)'");
    const upperCallIdx = fnBody.indexOf("drawBoneGroup(UPPER_BONES, 'rgba(248,113,113,0.95)')");
    const lowerCallIdx = fnBody.indexOf("drawBoneGroup(LOWER_BONES, 'rgba(52,211,153,0.95)')");
    expect(outlineIdx).toBeGreaterThan(-1);
    expect(upperCallIdx).toBeGreaterThan(outlineIdx);
    expect(lowerCallIdx).toBeGreaterThan(upperCallIdx);
  });

  it('관절점은 검은 외곽 원을 먼저 채운 뒤 흰 점을 그린다(참고 이미지 스타일)', () => {
    const fnBody = fnBodyOf(src, 'drawSkeletonPaths');
    const jointOutline = fnBody.indexOf("fillStyle = 'rgba(0,0,0,0.6)'");
    const jointColor = fnBody.indexOf("fillStyle = '#ffffff'");
    expect(jointOutline).toBeGreaterThan(-1);
    expect(jointColor).toBeGreaterThan(jointOutline);
  });

  it('drawSkeletonPaths는 미리보기(Cover)와 녹화합성(ToRecordCover) 양쪽에서 공유된다(한 곳만 고치면 됨), 화면 크기도 함께 넘긴다', () => {
    expect(src).toMatch(/drawSkeletonPaths\(ctx, landmarks, px, py, Math\.max\(2\.5, cw \/ 200\), Math\.max\(3, cw \/ 150\), labelScale, stabilizer, cw, ch\)/);
    expect(src).toMatch(/drawSkeletonPaths\(ctx, landmarks, px, py, Math\.max\(2\.5, width \/ 220\), Math\.max\(3, width \/ 170\), labelScale, stabilizer, width, height\)/);
  });
});

describe('RecordMeasure.jsx — 관절각 "각도기" 호(참고 이미지 스타일)', () => {
  it('반지름은 두 뼈대 세그먼트 중 짧은 쪽 길이에 비례한다(사람이 화면에 크게/작게 잡혀도 비율 유지)', () => {
    expect(src).toMatch(/const ringR = Math\.max\(dotR \* 3, Math\.min\(Math\.min\(segA, segC\) \* 0\.5, dotR \* 16\)\);/);
  });

  it('꽉 찬 원(0~2π)이 아니라 두 뼈대 방향 사이의 실제 각도만큼만 호를 그린다', () => {
    const fnBody = fnBodyOf(src, 'drawSkeletonPaths');
    // 예전 버전(꽉 찬 원)의 흔적인 "0, Math.PI * 2" 패턴이 호 그리는 부분엔 없어야 한다.
    expect(fnBody).toMatch(/ctx\.arc\(bx, by, ringR, angA, angC, ccw\);/);
    expect(fnBody).not.toMatch(/ctx\.arc\(bx, by, ringR, 0, Math\.PI \* 2\)/);
  });

  it('두 뼈대 방향(atan2)의 최단(내각) 경로로 스윕 방향을 정한다', () => {
    expect(src).toMatch(/const angA = Math\.atan2\(ay - by, ax - bx\);/);
    expect(src).toMatch(/const angC = Math\.atan2\(cy - by, cx - bx\);/);
    expect(src).toMatch(/while \(diff > Math\.PI\) diff -= Math\.PI \* 2;/);
    expect(src).toMatch(/while \(diff <= -Math\.PI\) diff \+= Math\.PI \* 2;/);
    expect(src).toMatch(/const ccw = diff < 0;/);
  });

  it('호에도 검은 외곽선을 먼저 그린 뒤 흰 호를 겹쳐 그린다(밝은 배경 대비)', () => {
    const fnBody = fnBodyOf(src, 'drawSkeletonPaths');
    const arcOutline = fnBody.lastIndexOf("strokeStyle = 'rgba(0,0,0,0.55)'");
    const arcColor = fnBody.indexOf("strokeStyle = 'rgba(255,255,255,0.9)'");
    expect(arcOutline).toBeGreaterThan(-1);
    expect(arcColor).toBeGreaterThan(arcOutline);
  });

  // 캔버스 없이도 스윕 방향 로직 자체를 순수 수학으로 검증 — 소스에 있는 것과
  // 동일한 정규화 로직을 그대로 재현해, "내각(≤180°)만 그린다"는 계약을 고정한다.
  function normalizeSweep(angA, angC) {
    let diff = angC - angA;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff <= -Math.PI) diff += Math.PI * 2;
    return { diff, ccw: diff < 0 };
  }

  it('예: 오른쪽(0°)→아래(90°) 방향이면 90°짜리 내각 스윕이 나온다(반사각 270° 아님)', () => {
    const { diff } = normalizeSweep(0, Math.PI / 2);
    expect(Math.abs(diff)).toBeCloseTo(Math.PI / 2, 5);
  });

  it('예: 거의 반대 방향(팔이 거의 펴진 경우)이어도 항상 ≤180°인 쪽으로 스윕한다', () => {
    const { diff } = normalizeSweep(0, (170 * Math.PI) / 180);
    expect(Math.abs(diff)).toBeLessThanOrEqual(Math.PI);
    expect(Math.abs(diff)).toBeCloseTo((170 * Math.PI) / 180, 5);
  });

  it('라벨은 호의 바깥(꼭대기 방향)에 떠서 호와 겹치지 않는다', () => {
    expect(src).toMatch(/drawAngleLabel\(ctx, bx, by - ringR, angle, scale\);/);
  });
});

// ════════════════════════════════════════════════════════════════════════
//  [2026-08-05] 회귀 테스트 — "스켈레톤 on모드 시 화면에 안 보이는 부위는
//  스켈레톤도 함께 보이지 않게 해줘(HUD 자연스러움)".
//
//  원인: skelVisible()가 MediaPipe 자체 신뢰도(.visibility)만 확인했다.
//  이 화면은 object-cover로 카메라 원본을 잘라서 세로 화면에 꽉 채운다
//  (px/py가 그 크롭 변환) — 카메라 원본에는 잡혀서 신뢰도가 높아도, 세로
//  화면으로 자르면서 밖으로 밀려난 부위(옆으로 뻗은 팔 등)는 변환된 좌표가
//  캔버스 밖으로 나간다. 신뢰도만 보면 이런 점도 "보인다"고 판단해 화면
//  가장자리 밖에 뼈대·관절점을 그리려 시도했다(실제로는 안 보이거나, 크롭
//  경계에 어색하게 매달려 보였다).
//
//  수정: landmarkScreenPos()를 새로 빼서, 신뢰도 확인 후 변환된 화면 좌표가
//  실제 캔버스 범위(약간의 여유 포함) 안인지도 확인한다. 화면 밖이면
//  신뢰도와 무관하게 제외 — 이제 카메라에 반쯤 걸쳐 있거나 화면 밖으로 나간
//  부위는 뼈대가 조용히 사라진다(억지로 화면 끝에 매달리지 않음).
// ════════════════════════════════════════════════════════════════════════
describe('[2026-08-05 회귀] landmarkScreenPos — 화면(크롭 후) 밖 랜드마크는 신뢰도가 높아도 제외', () => {
  const CW = 720, CH = 960;
  const identityPx = (p) => p.x; // 테스트용: 이미 픽셀 좌표라고 가정(변환 없음)
  const identityPy = (p) => p.y;

  it('캔버스 안쪽 좌표 + 높은 신뢰도 → 정상적으로 위치를 반환', () => {
    const p = { x: 360, y: 480, visibility: 0.9 };
    expect(landmarkScreenPos(p, identityPx, identityPy, CW, CH)).toEqual({ x: 360, y: 480 });
  });

  it('[핵심] 신뢰도는 높지만(0.9) 변환된 좌표가 캔버스 밖 → 제외된다', () => {
    // object-cover 크롭으로 옆으로 뻗은 팔이 화면 밖으로 밀려난 상황을 재현.
    const p = { x: CW + 200, y: 300, visibility: 0.9 };
    expect(landmarkScreenPos(p, identityPx, identityPy, CW, CH)).toBeNull();
  });

  it('음수 좌표(왼쪽 밖)도 마찬가지로 제외된다', () => {
    const p = { x: -150, y: 300, visibility: 0.95 };
    expect(landmarkScreenPos(p, identityPx, identityPy, CW, CH)).toBeNull();
  });

  it('신뢰도가 낮으면(0.1) 화면 안 좌표라도 기존처럼 제외된다(기존 동작 유지)', () => {
    const p = { x: 360, y: 480, visibility: 0.1 };
    expect(landmarkScreenPos(p, identityPx, identityPy, CW, CH)).toBeNull();
  });

  it('visibility 필드 자체가 없으면(구형 데이터) 좌표만으로 판단한다', () => {
    const p = { x: 360, y: 480 };
    expect(landmarkScreenPos(p, identityPx, identityPy, CW, CH)).toEqual({ x: 360, y: 480 });
  });

  it('경계에 살짝 걸친 좌표(약 2% 여유 이내)는 깜빡이지 않도록 포함된다', () => {
    const marginX = CW * 0.02; // ≈14.4
    const p = { x: CW + marginX * 0.5, y: 480, visibility: 0.9 };
    expect(landmarkScreenPos(p, identityPx, identityPy, CW, CH)).not.toBeNull();
  });

  it('여유 범위를 확실히 벗어나면 제외된다', () => {
    const marginX = CW * 0.02;
    const p = { x: CW + marginX * 3, y: 480, visibility: 0.9 };
    expect(landmarkScreenPos(p, identityPx, identityPy, CW, CH)).toBeNull();
  });

  it('랜드마크가 없거나(null) 좌표가 NaN이면 안전하게 null', () => {
    expect(landmarkScreenPos(null, identityPx, identityPy, CW, CH)).toBeNull();
    expect(landmarkScreenPos({ x: NaN, y: 480 }, identityPx, identityPy, CW, CH)).toBeNull();
  });

  it('drawSkeletonPaths의 posOf 캐시가 이 함수를 그대로 쓴다(로직 중복 없음)', () => {
    const fnBody = fnBodyOf(src, 'drawSkeletonPaths');
    expect(fnBody).toMatch(/landmarkScreenPos\(landmarks\[idx\], px, py, w, h\)/);
  });

  it('뼈대·관절점·각도 호 전부 posOf()로 화면 밖 여부를 확인한다(일부만 고치는 반쪽 수정 방지)', () => {
    const fnBody = fnBodyOf(src, 'drawSkeletonPaths');
    // 뼈대(halo+색상 그룹), 관절점, 각도 호 각각에서 posOf 사용을 확인.
    const boneLoopIdx = fnBody.indexOf('for (const [a, b] of SKELETON_BONES)');
    const jointLoopIdx = fnBody.indexOf('for (const i of SKELETON_JOINTS)');
    const angleLoopIdx = fnBody.indexOf('for (const [ia, ib, ic] of ANGLE_JOINTS)');
    expect(fnBody.slice(boneLoopIdx, boneLoopIdx + 150)).toMatch(/posOf\(a\), pb = posOf\(b\)/);
    expect(fnBody.slice(jointLoopIdx, jointLoopIdx + 100)).toMatch(/posOf\(i\)/);
    expect(fnBody.slice(angleLoopIdx, angleLoopIdx + 150)).toMatch(/posOf\(ia\), bPos = posOf\(ib\), cPos = posOf\(ic\)/);
  });
});
