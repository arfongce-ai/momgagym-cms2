// AI 측정·분석 개선 5항목 검증
//  1) 미등록회원 신체정보 ↔ 각 측정 탭 연동
//  2) 폰 뒤로가기 연동(useHardwareBack 배선)
//  3) 자세·체형 측면 인식 개선
//  4) ROM 전자 각도기(수동)
//  5) ROM 리포트에서 끝범위 측정 제외
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { detectPostureView, POSE_LANDMARKS as LM } from '../ai-measure/core/postureMath';
import { generateRomDiagnosis } from '../ai-measure/core/romClinical';
import { angleAt } from '../ai-measure/menus/RomGoniometer.jsx';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

// ── [항목 1] 신체정보 연동 배선 ──
describe('[항목 1] 미등록회원 신체정보 ↔ 측정 탭 연동', () => {
  const hub = read('../ai-measure/AiMeasureHub.jsx');
  const body = read('../ai-measure/menus/BodyInfoMeasure.jsx');

  it('허브가 게스트 신체정보 갱신 콜백(applyGuestBodyInfo)을 제공한다', () => {
    expect(hub).toMatch(/applyGuestBodyInfo/);
    expect(hub).toMatch(/onGuestBodyInfoChange/);
  });

  it('허브는 미등록회원일 때만 콜백을 내려준다(실회원은 store 신체기록 경로)', () => {
    expect(hub).toMatch(/member\?\.isVirtual \? applyGuestBodyInfo : undefined/);
  });

  it('신체정보 탭이 미등록회원 입력을 허브에 반영한다(다른 탭 연동)', () => {
    expect(body).toMatch(/onGuestBodyInfoChange/);
    expect(body).toMatch(/isVirtual/);
  });

  it('신체정보 탭은 회원의 기존 키·몸무게를 초기값으로 채운다(연동 상태 표시)', () => {
    expect(body).toMatch(/member\?\.height != null \? String\(member\.height\)/);
    expect(body).toMatch(/member\?\.weight != null \? String\(member\.weight\)/);
  });

  it('미등록회원 저장 시 영구 신체기록(store.addBodyRecord)을 건너뛴다', () => {
    // isVirtual 분기가 addBodyRecord 호출보다 먼저 return 하는지 확인
    const idxVirtual = body.indexOf('if (isVirtual) {');
    const idxStore = body.indexOf('await store.addBodyRecord');
    expect(idxVirtual).toBeGreaterThan(-1);
    expect(idxStore).toBeGreaterThan(idxVirtual);
  });
});

// ── [항목 2] 폰 뒤로가기 배선 ──
describe('[항목 2] 폰 뒤로가기(useHardwareBack) 배선', () => {
  const hook = read('../ai-measure/core/useHardwareBack.js');

  it('중앙 스택 + 단일 리스너 구조(중첩 화면에서 한 단계만 뒤로)', () => {
    expect(hook).toMatch(/const stack = \[\]/);
    expect(hook).toMatch(/stack\.pop\(\)/);
    expect(hook).toMatch(/suppress/); // 내부 정리 back()의 popstate 무시
  });

  it('허브·자세·ROM·점프·보행·리프팅 모듈이 모두 훅을 사용한다', () => {
    const files = [
      '../ai-measure/AiMeasureHub.jsx',
      '../ai-measure/menus/PostureMeasure.jsx',
      '../ai-measure/menus/RomMeasure.jsx',
      '../ai-measure/menus/JumpAnalysisHub.jsx',
      '../ai-measure/menus/GaitAnalysisHub.jsx',
      '../ai-measure/menus/BarbellLiftingHub.jsx',
    ];
    files.forEach((f) => {
      const src = read(f);
      expect(src, `${f} 에 useHardwareBack 배선 없음`).toMatch(/useHardwareBack\(/);
    });
  });

  it('진입 시 history.pushState, 내부 버튼 복귀 시 조용한 back 소비를 수행한다', () => {
    expect(hook).toMatch(/pushState\(\{ aiBack: marker \}/);
    expect(hook).toMatch(/history\.back\(\)/);
  });
});

// ── [항목 3] 측면 인식 개선 ──
describe('[항목 3] 자세·체형 측면 인식 개선', () => {
  // z-깊이가 전혀 없어도(단안 노이즈로 0에 수렴) 코 수평 이탈만으로 측면을 잡는다.
  function flatZSidePose(noseX) {
    const pose = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.9 }));
    // 어깨폭 애매 구간(≈0.13), z 분리 없음 — 종전 로직으로는 unknown/오인 케이스
    Object.assign(pose[LM.LEFT_SHOULDER], { x: 0.50, y: 0.30, z: 0 });
    Object.assign(pose[LM.RIGHT_SHOULDER], { x: 0.535, y: 0.30, z: 0 });
    Object.assign(pose[LM.LEFT_HIP], { x: 0.50, y: 0.57 });
    Object.assign(pose[LM.RIGHT_HIP], { x: 0.535, y: 0.57 });
    // 측면 특유의 코 수평 이탈(어깨중심에서 옆으로 크게 벗어남)
    Object.assign(pose[LM.NOSE], { x: noseX, y: 0.10, visibility: 0.9 });
    // 한쪽 귀만 잘 보임(측면 보조 신호)
    Object.assign(pose[LM.LEFT_EAR], { visibility: 0.95 });
    Object.assign(pose[LM.RIGHT_EAR], { visibility: 0.2 });
    return pose;
  }

  it('z-분리 없이도(2D 신호만으로) 프로필을 측면으로 인식한다', () => {
    const r = detectPostureView(flatZSidePose(0.68));
    expect(['left', 'right']).toContain(r.view);
  });

  it('코 방향으로 좌/우 측면을 정확히 구분한다', () => {
    expect(detectPostureView(flatZSidePose(0.68)).view).toBe('left');
    expect(detectPostureView(flatZSidePose(0.37)).view).toBe('right');
  });

  it('정면(코가 어깨중심·귀 대칭·어깨 넓음)은 여전히 front 로 유지된다', () => {
    const pose = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.99 }));
    Object.assign(pose[LM.NOSE], { x: 0.5, y: 0.08, z: -0.12, visibility: 0.98 });
    Object.assign(pose[LM.LEFT_EYE], { x: 0.53, y: 0.07, z: -0.05, visibility: 0.95 });
    Object.assign(pose[LM.RIGHT_EYE], { x: 0.47, y: 0.07, z: -0.05, visibility: 0.95 });
    Object.assign(pose[LM.LEFT_EAR], { x: 0.55, y: 0.1, z: 0.02, visibility: 0.9 });
    Object.assign(pose[LM.RIGHT_EAR], { x: 0.45, y: 0.1, z: 0.02, visibility: 0.9 });
    Object.assign(pose[LM.LEFT_SHOULDER], { x: 0.58, y: 0.25, z: 0 });
    Object.assign(pose[LM.RIGHT_SHOULDER], { x: 0.42, y: 0.25, z: 0 });
    Object.assign(pose[LM.LEFT_HIP], { x: 0.57, y: 0.52, z: 0 });
    Object.assign(pose[LM.RIGHT_HIP], { x: 0.43, y: 0.52, z: 0 });
    expect(detectPostureView(pose).view).toBe('front');
  });

  it('측면 목표는 자동촬영 안정 요건이 완화되어 있다(배선)', () => {
    const src = read('../ai-measure/menus/PostureMeasure.jsx');
    expect(src).toMatch(/isSideTarget/);
    expect(src).toMatch(/minRatio: 0\.6, minFrames: 7/);
  });
});

// ── [항목 4] 전자 각도기 ──
describe('[항목 4] ROM 전자 각도기(수동)', () => {
  it('세 점 사이각을 정확히 계산한다(직각/평각/예각)', () => {
    expect(angleAt({ x: 0, y: 100 }, { x: 0, y: 0 }, { x: 100, y: 0 })).toBeCloseTo(90, 1);
    expect(angleAt({ x: -100, y: 0 }, { x: 0, y: 0 }, { x: 100, y: 0 })).toBeCloseTo(180, 1);
    expect(angleAt({ x: 100, y: 100 }, { x: 0, y: 0 }, { x: 100, y: 0 })).toBeCloseTo(45, 1);
  });

  it('점이 겹치면(팔 길이 0) 각도를 만들지 않는다(측정 정직성)', () => {
    expect(angleAt({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 100, y: 0 })).toBeNull();
    expect(angleAt(null, { x: 0, y: 0 }, { x: 100, y: 0 })).toBeNull();
  });

  it('RomMeasure 설정 화면에서 전자 각도기 모드로 진입할 수 있다(배선)', () => {
    const src = read('../ai-measure/menus/RomMeasure.jsx');
    expect(src).toMatch(/setMode\('manual'\)/);
    expect(src).toMatch(/RomGoniometer/);
    expect(src).toMatch(/전자 각도기/);
  });
});

// ── [항목 5] 끝범위 제외 ──
describe('[항목 5] ROM 리포트 — 끝범위 측정 제외', () => {
  it('리포트에 끝범위 안정성 카드가 없다', () => {
    const src = read('../ai-measure/menus/RomReport.jsx');
    expect(src).not.toMatch(/끝범위 안정성/);
    expect(src).not.toMatch(/stab\.left/);
  });

  it('AI 진단이 끝범위 문구·플래그를 생성하지 않는다', () => {
    const summary = {
      valid: true,
      left_max_rom: 120, right_max_rom: 122,
      symmetry_index_score: 1.6,
      // 일부러 불안정한 끝범위 값 제공 — 그래도 진단에 나타나면 안 됨
      end_range_stability_score: { left: 10, right: 12 },
      compensation: { left: 1, right: 1 },
    };
    const dx = generateRomDiagnosis(summary, { joint: 'HIP', poseMode: 'SUPINE' });
    expect(dx.flags).not.toContain('end_range_instability');
    expect(dx.details.join(' ')).not.toMatch(/끝범위|잔떨림/);
    expect(dx.grade).toBe('good'); // 끝범위가 등급을 끌어내리지 않는다
  });
});

// ── [항목 4-추가] 센서 기반 전자 각도기 (자이로/가속도계) ──
import {
  gravityPlaneAngleDeg, offPlaneRatio, unwrapDeg, applyZero, isStill, hapticFeedback,
} from '../ai-measure/core/sensorTilt';

describe('[항목 4-센서] sensorTilt — 기울기 수학', () => {
  it('중력의 y–z 평면 투영각을 연속(atan2)으로 산출한다', () => {
    // 폰 세로로 세움(중력이 -y): atan2(0,-9.8) = 180
    expect(gravityPlaneAngleDeg(-9.8, 0)).toBeCloseTo(180, 1);
    // 화면이 하늘(중력이 -z... 기기 z 뒤쪽): atan2(-9.8, 0) = -90
    expect(gravityPlaneAngleDeg(0, -9.8)).toBeCloseTo(-90, 1);
    // 45도 기울임
    expect(gravityPlaneAngleDeg(6.93, 6.93)).toBeCloseTo(45, 1);
  });

  it('자유낙하/무효 표본이나 투영 성분이 미약하면 null (측정 정직성)', () => {
    expect(gravityPlaneAngleDeg(0.01, 0.01, 0.01)).toBeNull();           // |g|≈0
    expect(gravityPlaneAngleDeg(0.5, 0.5, 9.8)).toBeNull();              // 중력이 x축에 몰림
  });

  it('부호 규약(iOS/Android)이 반전되어도 0점 대비 상대각 크기는 불변', () => {
    const a1 = gravityPlaneAngleDeg(9.8, 0);    // 한 규약
    const a2 = gravityPlaneAngleDeg(6.93, 6.93);
    const b1 = gravityPlaneAngleDeg(-9.8, 0);   // 반전 규약
    const b2 = gravityPlaneAngleDeg(-6.93, -6.93);
    const excursionA = Math.abs(applyZero(a2, a1));
    const excursionB = Math.abs(applyZero(unwrapDeg(b1, b2), b1));
    expect(excursionA).toBeCloseTo(45, 1);
    expect(excursionB).toBeCloseTo(45, 1);
  });

  it('±180 경계를 위상 언랩으로 잇는다(연속 회전)', () => {
    let u = 170;
    u = unwrapDeg(u, -175); // 170 → 185 로 이어져야 함(경계 통과)
    expect(u).toBeCloseTo(185, 5);
    u = unwrapDeg(u, -160); // 계속 회전 → 200
    expect(u).toBeCloseTo(200, 5);
  });

  it('측정면 이탈 비율은 중력의 x 성분 비중', () => {
    expect(offPlaneRatio(0, 9.8, 0)).toBeCloseTo(0, 3);
    expect(offPlaneRatio(9.8, 0, 0)).toBeCloseTo(1, 3);
    expect(offPlaneRatio(6.93, 6.93, 0)).toBeCloseTo(0.707, 2);
  });

  it('정지 판정: 흔들림 범위가 작을 때만 멈춤', () => {
    expect(isStill([10, 10.2, 10.4, 10.1, 10.3, 10.2, 10.0, 10.4])).toBe(true);
    expect(isStill([10, 14, 10, 14, 10, 14, 10, 14])).toBe(false);
    expect(isStill([10, 10])).toBe(false); // 표본 부족
  });

  it('진동(Haptic)은 미지원 환경에서 조용히 false (예외 없음)', () => {
    expect(hapticFeedback()).toBe(false); // node 환경 — navigator.vibrate 없음
  });
});

describe('[항목 4-센서] RomMeasure 배선 + Firestore 스키마', () => {
  const rom = read('../ai-measure/menus/RomMeasure.jsx');
  const sensor = read('../ai-measure/menus/RomSensorGoniometer.jsx');
  const romReport = read('../ai-measure/menus/RomReport.jsx');

  it('카메라 분석 ↔ 센서 측정 모드를 전환할 수 있다(UI 제약)', () => {
    expect(rom).toMatch(/setMode\('sensor'\)/);
    expect(rom).toMatch(/RomSensorGoniometer/);
    expect(rom).toMatch(/카메라 분석/);
    expect(rom).toMatch(/센서 측정/);
  });

  it('요구 스키마 필드를 리포트에 동봉한다', () => {
    // { memberId, measureType: 'sensor_goniometer', jointName, side, angle, recordedAt, confidenceScore }
    expect(rom).toMatch(/measureType: 'sensor_goniometer'/);
    expect(rom).toMatch(/jointName: joint\.toLowerCase\(\)/);
    expect(rom).toMatch(/confidenceScore: 1\.0/);
    expect(rom).toMatch(/sensor_records/);
  });

  it('좌우 비대칭은 카메라 측정과 동일한 symmetryIndex 로 자동 산출한다', () => {
    expect(rom).toMatch(/symmetry_index_score: symmetryIndex\(L, R\)/);
  });

  it('센서 UI: 0점 조절 · 실시간 큰 각도 표시 · 진동 알림 · 측정면 이탈 경고', () => {
    expect(sensor).toMatch(/0점/);
    expect(sensor).toMatch(/hapticFeedback/);
    expect(sensor).toMatch(/requestSensorPermission/);
    expect(sensor).toMatch(/OFF_PLANE_WARN/);
  });

  it('리포트가 센서 출처를 표시한다(카메라 추정치와 구분)', () => {
    expect(romReport).toMatch(/sensor_goniometer/);
    expect(romReport).toMatch(/센서 각도기/);
  });
});
