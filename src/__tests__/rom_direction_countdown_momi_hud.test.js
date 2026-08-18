// rom_direction_countdown_momi_hud.test.js
// ════════════════════════════════════════════════════════════════════════
//  [2026-08-18 요청] ROM 측정 화면 UX 개선 8가지 회귀 테스트(정적 소스 패턴,
//  이 저장소의 화면 테스트 관행과 동일):
//   1) momi 음성 버튼이 모든 측정 탭(CameraStage 공용)에서 반투명해진다.
//   2) 스켈레톤 OFF면 ROM 인식(각도 누적)도 함께 멈춘다.
//   3) 촬영 버튼 → 3-2-1 카운트다운 → 실제 녹화 시작.
//   4) 양쪽(건측→환측) 측정은 방향전환 버튼으로 재카운트다운 후 이어서
//      녹화된다(연속 MediaRecorder라 영상·데이터가 자동으로 하나로 합쳐짐).
// ════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const read = (p) => readFileSync(join(process.cwd(), p), 'utf8');

const cameraStageActive = read('src/ai-measure/core/cameraStageActive.js');
const cameraStage = read('src/ai-measure/menus/CameraStage.jsx');
const globalVoice = read('src/components/common/GlobalVoiceCommand.jsx');
const kioskVoice = read('src/components/common/KioskVoiceCommand.jsx');
const rom = read('src/ai-measure/menus/RomMeasure.jsx');

describe('cameraStageActive.js — 카메라 스테이지 전역 상태(신규)', () => {
  it('markCameraStageActive/isCameraStageActive/useCameraStageActive를 export한다', () => {
    expect(cameraStageActive).toMatch(/export function markCameraStageActive/);
    expect(cameraStageActive).toMatch(/export function isCameraStageActive/);
    expect(cameraStageActive).toMatch(/export function useCameraStageActive/);
  });
});

describe('CameraStage.jsx — 마운트 시 momi HUD에 활성 상태를 알린다', () => {
  it('markCameraStageActive를 import한다', () => {
    expect(cameraStage).toMatch(/import \{ markCameraStageActive \} from '\.\.\/core\/cameraStageActive'/);
  });

  it('마운트 useEffect가 release 함수를 cleanup으로 반환한다(언마운트 시 해제)', () => {
    expect(cameraStage).toMatch(/const release = markCameraStageActive\(\);\s*return release;/);
  });
});

describe('GlobalVoiceCommand.jsx / KioskVoiceCommand.jsx — 측정 중 momi 버튼 반투명', () => {
  it('GlobalVoiceCommand가 useCameraStageActive를 구독해 opacity를 낮춘다', () => {
    expect(globalVoice).toMatch(/useCameraStageActive/);
    expect(globalVoice).toMatch(/opacity: cameraActive \? 0\.22 : 1/);
  });

  it('KioskVoiceCommand도 동일하게 반투명 처리한다', () => {
    expect(kioskVoice).toMatch(/useCameraStageActive/);
    expect(kioskVoice).toMatch(/opacity: cameraActive \? 0\.22 : 1/);
  });
});

describe('RomMeasure.jsx — 스켈레톤 OFF 시 ROM 인식(각도 누적)도 정지', () => {
  it('handlePose가 isSkeletonEnabled()가 false면 accRef 누적을 건너뛴다', () => {
    const start = rom.indexOf('const handlePose = useCallback');
    const end = rom.indexOf('}, [joint, poseMode, side, rotationDeg]', start);
    const body = rom.slice(start, end);
    expect(body).toMatch(/if \(!isSkeletonEnabled\(\) \|\| directionPausedRef\.current\) \{/);
    expect(body).toMatch(/setLiveAngle\(\{ left: null, right: null \}\);/);
    // 스켈레톤 켜져 있을 때(else 분기)만 실제로 누적한다.
    expect(body).toMatch(/accRef\.current\.push\(corrected, tMs\);/);
  });

  it('화면에 스켈레톤 OFF 안내 배너가 있다', () => {
    expect(rom).toMatch(/스켈레톤이 꺼져 있어 ROM 인식이 일시 중지됐어요/);
  });
});

describe('RomMeasure.jsx — 촬영 3-2-1 카운트다운(SLST와 동일 패턴)', () => {
  it('runStartCountdown/clearCountdown/startMeasurement이 정의돼 있다', () => {
    expect(rom).toMatch(/const clearCountdown = useCallback/);
    expect(rom).toMatch(/const runStartCountdown = useCallback/);
    expect(rom).toMatch(/const startMeasurement = \(\) => \{/);
  });

  it('녹화 시작 버튼은 beginRecord가 아니라 startMeasurement를 호출한다(카운트다운 경유)', () => {
    expect(rom).toMatch(/<button onClick=\{startMeasurement\} disabled=\{status !== 'running' \|\| countdown != null\}/);
    expect(rom).not.toMatch(/<button onClick=\{beginRecord\}/);
  });

  it('CameraStage에 countdown state를 넘긴다(화면에 3-2-1 표시)', () => {
    expect(rom).toMatch(/countdown=\{countdown\}/);
  });
});

describe('RomMeasure.jsx — 양쪽(건측→환측) 방향전환 흐름', () => {
  it('switchDirection이 side===\'both\'·direction===\'first\'일 때만 동작한다', () => {
    const start = rom.indexOf('const switchDirection = () => {');
    expect(start).toBeGreaterThan(-1);
    const end = rom.indexOf('\n  };', start);
    const body = rom.slice(start, end);
    expect(body).toMatch(/side !== 'both' \|\| direction !== 'first' \|\| switching/);
    expect(body).toMatch(/directionPausedRef\.current = true;/);
  });

  it('beginRecord가 side===\'both\'면 direction을 \'first\'로 시작한다', () => {
    const start = rom.indexOf('const beginRecord = () => {');
    const end = rom.indexOf('// MediaRecorder 시작', start);
    const body = rom.slice(start, end);
    expect(body).toContain("setDirection(side === 'both' ? 'first' : null);");
  });

  it('방향 전환 버튼은 녹화 중 side===\'both\'·1단계에서만 노출된다', () => {
    expect(rom).toMatch(/\{side === 'both' && direction === 'first' && !switching && \(/);
    expect(rom).toMatch(/onClick=\{switchDirection\}/);
  });

  it('MediaRecorder를 재시작하지 않는다(연속 녹화 — 영상이 자동으로 하나로 합쳐짐)', () => {
    // switchDirection 본문 안에 mediaRecorderRef를 건드리는 코드가 없어야 한다
    // (있다면 녹화를 끊고 다시 시작한다는 뜻이라 이번 요구사항과 어긋남).
    const start = rom.indexOf('const switchDirection = () => {');
    const end = rom.indexOf('\n  };', start);
    const body = rom.slice(start, end);
    expect(body).not.toMatch(/mediaRecorderRef/);
  });

  it('SUPINE/PRONE 등에서도 방향전환 버튼 조건은 side만 보고 poseMode를 강제하지 않는다(선택사항)', () => {
    expect(rom).not.toMatch(/switchDirection[\s\S]{0,40}poseMode === 'STANDING'/);
  });
});

describe('RomMeasure.jsx — 기존 회귀(이번 변경과 무관한 부분은 그대로)', () => {
  it('MAX_RECORD_MS는 여전히 60000, finishRecord 배선도 그대로', () => {
    expect(rom).toContain('MAX_RECORD_MS = 60000');
    expect(rom).toContain('}, MAX_RECORD_MS);');
    expect(rom).toContain('if (recordingRef.current) finishRecord();');
  });

  it('errorMsg 초기화 배선(beginRecord 안)이 그대로 남아있다', () => {
    const start = rom.indexOf('const beginRecord = () => {');
    const end = rom.indexOf('// MediaRecorder 시작', start);
    const body = rom.slice(start, end);
    expect(body).toContain("setErrorMsg('');");
  });
});
