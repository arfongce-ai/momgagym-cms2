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
  it('공용 스무더(createSmoother)를 가져온다', () => {
    expect(src).toMatch(/import \{ createSmoother \} from '\.\.\/core\/smoothing';/);
  });

  it('다른 화면과 동일한 alpha(0.28)로 smootherRef를 만든다', () => {
    expect(src).toMatch(/const smootherRef = useRef\(createSmoother\(0\.28\)\);/);
  });

  it('스켈레톤이 다시 켜질 때 스무더를 리셋한다(꺼져있던 낡은 좌표로 튐 방지)', () => {
    const onIdx = src.indexOf('const off = subscribeSkeleton');
    const onBlock = src.slice(onIdx, src.indexOf('});', onIdx));
    expect(onBlock).toMatch(/smootherRef\.current = createSmoother\(0\.28\)/);
  });

  it('새로 검출된 랜드마크만 스무더에 통과시켜 저장한다(검출 실패 프레임은 마지막 값 유지)', () => {
    expect(src).toMatch(/if \(landmarks\) \{\s*latestLandmarksRef\.current = smootherRef\.current\(landmarks\);\s*\}/);
    const loopStart = src.indexOf('const drawLoop = useCallback');
    const loopBody = src.slice(loopStart, loopStart + 1500);
    expect(loopBody).not.toMatch(/latestLandmarksRef\.current = landmarks \|\| latestLandmarksRef\.current;/);
  });

  it('미리보기·녹화 합성 모두 같은(스무딩된) latestLandmarksRef를 그린다', () => {
    expect(src).toMatch(/drawSkeletonCover\(canvas, video, latestLandmarksRef\.current\);/);
    expect(src).toMatch(/drawSkeletonToRecordCover\(ctx, video, latestLandmarksRef\.current, canvas\.width, canvas\.height\)/);
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

  it('drawSkeletonPaths는 미리보기(Cover)와 녹화합성(ToRecordCover) 양쪽에서 공유된다(한 곳만 고치면 됨)', () => {
    expect(src).toMatch(/drawSkeletonPaths\(ctx, landmarks, px, py, Math\.max\(2\.5, cw \/ 200\), Math\.max\(3, cw \/ 150\), labelScale\)/);
    expect(src).toMatch(/drawSkeletonPaths\(ctx, landmarks, px, py, Math\.max\(2\.5, width \/ 220\), Math\.max\(3, width \/ 170\), labelScale\)/);
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
