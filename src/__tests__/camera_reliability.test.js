// camera_reliability.test.js
// ════════════════════════════════════════════════════════════════════════
//  회귀 보호 대상(2026-07-13 버그 리포트):
//   1) AI측정 실시간(점프·RSI)에서 카메라 권한을 이미 허용했는데도
//      "카메라 권한을 허용해주세요"에 멈춰 자세 인식이 진행되지 않는 경우.
//      → 원인: 단발성 getUserMedia(폴백 없음) + 모든 실패를 "권한" 문구로
//        뭉뚱그림 + 재시도 경로 없음("기준 다시 잡기"는 카메라를 재획득하지
//        않음).
//   2) 일반 영상 녹화에서 저장/공유 이후(주로 기본값인 3:4로 첫 촬영 후)
//      오류가 나는 경우.
//      → 원인: 언마운트 전용이어야 할 클린업 useEffect 의 의존성 배열에
//        videoUrl 이 들어있어, 녹화가 끝나 videoUrl 이 바뀔 때마다(=매 촬영
//        직후) stopAll() 이 실행되어 라이브 카메라 스트림을 꺼버림. 화면에는
//        "카메라는 켜진 채 유지됩니다"라고 안내하면서 실제로는 죽여버리는
//        모순 상태였다.
//   3) 실시간 카메라 작동여부 확인 — 원인 오분류 방지(describeCameraError)
//      + 점프·보행 두 실시간 화면 모두 동일한 폴백 헬퍼로 통일.
// ════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { describeCameraError } from '../ai-measure/core/cameraSelect';

const root = join(process.cwd(), 'src');
const read = (p) => readFileSync(join(root, p), 'utf8');

describe('describeCameraError — 원인별로 다른, 정확한 한국어 안내', () => {
  it('권한 거부류(NotAllowedError/PermissionDeniedError/SecurityError) → 권한 안내', () => {
    expect(describeCameraError({ name: 'NotAllowedError' })).toBe('카메라 권한을 허용해주세요.');
    expect(describeCameraError({ name: 'PermissionDeniedError' })).toBe('카메라 권한을 허용해주세요.');
    expect(describeCameraError({ name: 'SecurityError' })).toBe('카메라 권한을 허용해주세요.');
  });

  it('기기 사용 중(NotReadableError) → 권한 문구가 아니라 다른 앱 사용 확인 안내', () => {
    const msg = describeCameraError({ name: 'NotReadableError' });
    expect(msg).not.toContain('권한을 허용');
    expect(msg).toContain('다른 앱');
  });

  it('카메라 없음/제약 불충족(NotFoundError/OverconstrainedError) → 연결 확인 안내', () => {
    expect(describeCameraError({ name: 'NotFoundError' })).toContain('카메라를 찾지 못했습니다');
    expect(describeCameraError({ name: 'OverconstrainedError' })).toContain('카메라를 찾지 못했습니다');
  });

  it('openMainCameraStream이 래핑해서 던지는 에러("...(ErrorName)")도 메시지 끝에서 원인을 뽑아 분류한다', () => {
    const wrapped = new Error('카메라를 사용할 수 없습니다. 권한과 브라우저 설정을 확인해 주세요. (NotReadableError)');
    expect(describeCameraError(wrapped)).toContain('다른 앱');

    const wrappedPerm = new Error('카메라를 사용할 수 없습니다. 권한과 브라우저 설정을 확인해 주세요. (NotAllowedError)');
    expect(describeCameraError(wrappedPerm)).toBe('카메라 권한을 허용해주세요.');
  });

  it('알 수 없는 에러는 원본 메시지를 그대로 보여준다(추측으로 다른 원인을 지어내지 않음)', () => {
    expect(describeCameraError({ name: 'WeirdError', message: '알수없는 문제' })).toBe('알수없는 문제');
  });

  it('에러가 없거나 메시지가 없어도 죽지 않고 기본 안내를 반환한다', () => {
    expect(() => describeCameraError(undefined)).not.toThrow();
    expect(describeCameraError(undefined)).toContain('다시 시도');
    expect(describeCameraError({})).toContain('다시 시도');
  });
});

describe('점프·RSI 실시간 화면 — 카메라 획득 강화(이미지1 재현 방지)', () => {
  const src = read('ai-measure/menus/JumpPrecisionAnalysis.jsx');

  it('단발성 getUserMedia가 남아있지 않고, 공통 폴백 헬퍼를 사용한다', () => {
    expect(src.match(/navigator\.mediaDevices\.getUserMedia/g)).toBeNull();
    expect(src).toContain("import { openMainCameraStream, describeCameraError } from '../core/cameraSelect';");
    expect(src).toContain('await openMainCameraStream({ audio: false })');
  });

  it('실패 원인을 describeCameraError로 분류해 보여준다(모든 실패를 권한 문제로 뭉뚱그리지 않음)', () => {
    expect(src).toContain('setWarning(describeCameraError(err))');
  });

  it('카메라 획득 실패 시 재시도 버튼을 노출한다(기존 "기준 다시 잡기"는 카메라를 재획득하지 않으므로 별도 경로 필요)', () => {
    expect(src).toContain('const [cameraFailed, setCameraFailed] = useState(false);');
    expect(src).toContain('setCameraFailed(true);');
    const bannerIdx = src.indexOf('{warning && (');
    const banner = src.slice(bannerIdx, bannerIdx + 600);
    expect(banner).toContain('cameraFailed');
    expect(banner).toContain('onClick={startCamera}');
    expect(banner).toContain('다시 시도');
  });

  it('언마운트 시 카메라 스트림과 AI 모델을 모두 정상 종료한다(2026-07-30: 공유 캐시 되돌림 — 화면 간 재사용이 인식 실패를 유발해 원복)', () => {
    expect(src).toContain('useEffect(() => () => stopCamera(), []);');
    expect(src).toMatch(/closePoseLandmarker\(\)/);
  });

  it('기존 "기준 다시 잡기"·"측정 취소" 문구는 그대로 유지된다(회귀 방지, measure_fixes_batch와 중복 보호)', () => {
    expect(src).toContain('↻ 기준 다시 잡기');
    expect(src).toContain('측정 취소');
  });
});

describe('보행&런닝 실시간 화면 — 동일한 카메라 획득 강화', () => {
  const src = read('ai-measure/menus/GaitRunningAnalysis.jsx');

  it('단발성 getUserMedia가 남아있지 않고, 공통 폴백 헬퍼를 사용한다', () => {
    expect(src.match(/navigator\.mediaDevices\.getUserMedia/g)).toBeNull();
    expect(src).toContain("import { openMainCameraStream, describeCameraError } from '../core/cameraSelect';");
    expect(src).toContain('await openMainCameraStream({ audio: false })');
  });

  it('실패 원인을 describeCameraError로 분류하고, 재시도 버튼을 노출한다', () => {
    expect(src).toContain('setWarningMsg(describeCameraError(err))');
    expect(src).toContain('const [cameraFailed, setCameraFailed] = useState(false);');
    const bannerIdx = src.indexOf('{warningMsg && (');
    const banner = src.slice(bannerIdx, bannerIdx + 600);
    expect(banner).toContain('cameraFailed');
    expect(banner).toContain('onClick={startCamera}');
    expect(banner).toContain('다시 시도');
  });
});

describe('일반 영상 녹화 — 저장 직후 카메라가 죽지 않는다(핵심 회귀 보호)', () => {
  const src = read('ai-measure/menus/RecordMeasure.jsx');

  it('언마운트 클린업의 의존성 배열에 videoUrl이 없다(있으면 매 촬영 직후 재실행됨)', () => {
    const idx = src.indexOf('useEffect(() => () => {\n    stopAll();');
    expect(idx).toBeGreaterThan(-1);
    const block = src.slice(idx, idx + 200);
    expect(block).toContain('}, [stopAll]);');
    expect(block).not.toMatch(/\[stopAll,\s*videoUrl\]/);
  });

  it('videoUrl 최신값은 ref로 추적해, 상태값 대신 ref로 클린업에서 안전하게 참조한다', () => {
    expect(src).toContain('const videoUrlRef = useRef(null);');
    expect(src).toContain('videoUrlRef.current = videoUrl');
    expect(src).toContain('URL.revokeObjectURL(videoUrlRef.current)');
  });

  it('녹화 종료(onstop)는 여전히 미리보기 스트림을 끄지 않는다(기존 recording_name.test.js 계약 유지)', () => {
    const onstop = src.slice(src.indexOf('rec.onstop'), src.indexOf('recorderRef.current = rec'));
    expect(onstop).not.toContain('stopStream()');
    expect(onstop).toContain('stopRecordStream()');
  });

  it('"카메라는 켜진 채 유지됩니다" 안내 문구가 이제 실제 동작과 일치한다(정직성)', () => {
    expect(src).toContain('카메라는 켜진 채 유지됩니다');
  });
});

describe('ROM 영상 각도기(업로드) — 캡처 장면 blob URL 누수 방지', () => {
  const src = read('ai-measure/menus/RomVideoAngle.jsx');

  it('언마운트 클린업은 videoUrl 변경마다 재실행되지 않는다(deps가 빈 배열)', () => {
    const idx = src.indexOf('useEffect(() => () => {\n    if (videoUrlRef.current)');
    expect(idx).toBeGreaterThan(-1);
    const block = src.slice(idx, idx + 260);
    expect(block).toContain('}, []);');
  });

  it('videoUrl과 shots 모두 ref로 최신값을 추적한다(스테일 클로저로 캡처 장면이 안 지워지는 문제 방지)', () => {
    expect(src).toContain('const videoUrlRef = useRef(');
    expect(src).toContain('videoUrlRef.current = videoUrl');
    expect(src).toContain('const shotsRef = useRef([]);');
    expect(src).toContain('shotsRef.current = shots');
    expect(src).toContain('shotsRef.current.forEach');
  });
});

describe('ROM 전자 각도기(사진) — 카메라 획득 강화', () => {
  const src = read('ai-measure/menus/RomGoniometer.jsx');

  it('단발성 getUserMedia 대신 공통 폴백 헬퍼를 사용한다', () => {
    expect(src.match(/navigator\.mediaDevices\.getUserMedia/g)).toBeNull();
    expect(src).toContain("import { openMainCameraStream, describeCameraError } from '../core/cameraSelect';");
    expect(src).toContain('await openMainCameraStream({ audio: false })');
    expect(src).toContain('setCameraErr(describeCameraError(e))');
  });

  it('카메라 실패 시에도 파일 업로드 대체 경로는 그대로 유지된다(회귀 방지)', () => {
    expect(src).toContain('또는 사진 파일 업로드');
    expect(src).toContain("accept=\"image/*\"");
  });
});
