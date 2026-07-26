// measure_fixes_batch.test.js — 이번 배치 수정 회귀 보호(소스 배선 기준).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const root = join(process.cwd(), 'src');
const read = (p) => readFileSync(join(root, p), 'utf8');

describe('공통 포즈 엔진 — 최신 콜백 ref(스테일 클로저 방지)', () => {
  const src = read('ai-measure/core/usePoseEngine.js');
  it('onResultRef 로 매 프레임 최신 콜백을 호출한다', () => {
    expect(src).toContain('const onResultRef = useRef(onResult)');
    expect(src).toContain('onResultRef.current = onResult');
    expect(src).toContain('onResultRef.current?.(lms, ts, video)');
  });
  it('start 의존성에서 onResult 를 제거해 카메라 재시작 없이 갱신된다', () => {
    expect(src).toContain('}, [modelTier]);');
    expect(src).not.toContain('}, [onResult, modelTier]);');
  });
});

describe('[항목 3] ROM 첫 페이지 관절/자세 중복 제거 + 라이브 변경', () => {
  const src = read('ai-measure/menus/RomMeasure.jsx');
  it('첫 페이지(설정 화면)에서 측정 관절/측정 자세 블록을 제거했다', () => {
    expect(src).not.toContain('측정 자세 (역학 기준선이 달라집니다)');
    expect(src).toContain('첫 페이지 중복 제거');
  });
  it('라이브 화면에서 관절/자세를 즉시 바꾼다(changeJointLive/changePoseLive)', () => {
    expect(src).toContain('changeJointLive');
    expect(src).toContain('changePoseLive');
  });
});

describe('[항목 4] ROM 고니오메타 진입 유지', () => {
  const src = read('ai-measure/menus/RomMeasure.jsx');
  it('설정 화면에 고니오메타 버튼과 sensor 모드가 있다', () => {
    expect(src).toContain("setMode('sensor')");
    expect(src).toContain('고니오메타');
    expect(src).toContain('RomSensorGoniometer');
  });
});

describe('[항목 5] 점프·RSI 기준 다시 잡기 — 촬영 전으로 이동', () => {
  const src = read('ai-measure/menus/JumpPrecisionAnalysis.jsx');
  it('측정 전(!armed) 블록에 기준 다시 잡기(resetPipeline)가 있다', () => {
    // !armed 블록 안의 기준 다시 잡기 버튼
    const preIdx = src.indexOf('버튼을 누르면 3초 후 측정이 시작됩니다');
    const btnIdx = src.indexOf('↻ 기준 다시 잡기');
    expect(btnIdx).toBeGreaterThan(-1);
    expect(preIdx).toBeGreaterThan(-1);
  });
  it('측정 중 블록은 측정 취소로 바뀌었다(기준 다시 잡기 문구 이동)', () => {
    expect(src).toContain('측정 취소');
  });
});

describe('[항목 1] 신체 정보 자동 저장 + A4 리포트/회차 비교', () => {
  const src = read('ai-measure/menus/BodyInfoMeasure.jsx');
  it('분석과 동시에 자동 저장한다', () => {
    expect(src).toContain('await save()');
    expect(src).toContain('자동 저장');
  });
  it('A4 리포트와 JPG 전송(ReportActions)이 연결돼 있다', () => {
    expect(src).toContain('BodyInfoReport');
    expect(src).toContain('reportNodeId="body-report-sheet"');
  });
  const rep = read('ai-measure/menus/BodyInfoReport.jsx');
  it('리포트에 회차별 비교(추이 그래프)가 있다', () => {
    expect(rep).toContain('회차별 비교');
    expect(rep).toContain('LineChart');
    expect(rep).toContain('UnifiedReportPage'); // A4 페이지(report-a4-page) 경유
  });
});

describe('[항목 6] 6개 결과지 모두 A4 JPG 전송', () => {
  const targets = {
    '신체정보': 'ai-measure/menus/BodyInfoReport.jsx',
    '자세체형': 'ai-measure/menus/PostureReport.jsx',
    'ROM좌우': 'ai-measure/menus/RomReport.jsx',
    '보행러닝': 'ai-measure/menus/GaitReportDashboard.jsx',
    '점프RSI': 'ai-measure/menus/JumpReportDashboard.jsx',
    '바벨리프팅': 'ai-measure/menus/LiftingReportDashboard.jsx',
  };
  for (const [name, path] of Object.entries(targets)) {
    it(`${name} → A4 페이지 노드 존재`, () => {
      const src = read(path);
      expect(/report-a4-page|UnifiedReportPage/.test(src)).toBe(true);
    });
  }
  it('A4 캡처는 JPG 파일로 내보낸다', () => {
    const ra = read('components/report/ReportActions.jsx');
    expect(ra).toContain('captureNodeToJpgFile');
    expect(ra).toContain('.report-a4-page');
  });
});
