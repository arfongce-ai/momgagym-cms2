// overlay_overlap_fix.test.js
// ════════════════════════════════════════════════════════════════════════
//  [2026-08-05] "자세&체형, ROM, 런닝&보행, 점프&RSI, 바벨리프팅, 한다리
//  서기, 오버헤드 딥 스쿼트에서 오버레이가 겹치는 부분 때문에 확인이
//  어렵습니다" 요청에 대한 회귀 테스트.
//
//  8개 실시간 측정 화면(Squat/Stance/Gait/Jump/Posture/ROM/VBT/1RM)을 전부
//  확인한 결과, 문제는 두 가지 패턴이었다:
//
//   (A) CameraStage(topBar·children을 안전하게 세로로 쌓아주는 공용 레이아웃)를
//       쓰면서도 그 밖에 `fixed` 배지를 따로 붙인 경우 — Squat/Stance의 "회차"
//       카운터가 topBar 텍스트와 같은 자리에 별도로 떠서 겹쳤고, Squat의
//       보상패턴·대퇴골수평·종합판정 배지는 bottom-28/bottom-40 같은 고정
//       픽셀 위치라 GaugeHud(약 196px+) 실제 크기와 무관하게 항상 같은 자리를
//       차지해 겹쳤다. → 전부 CameraStage의 topBar/children 안으로 옮겨
//       정상 문서 흐름으로 쌓이게 했다(내용이 많아져도 겹치지 않고 밀려날 뿐).
//
//   (B) CameraStage를 안 쓰고 자체 헤더를 만든 화면(Gait/Jump)이
//       env(safe-area-inset-top)을 안 챙겨서, 노치·다이내믹 아일랜드
//       기종에서 헤더 자체가 시스템 상태바 밑에 깔릴 수 있었다.
//       Gait는 추가로, 녹화 중에만 뜨는 GaugeHud(케이던스)와 초시계/메트로놈
//       도구창이 같은 하단-좌측 구역을 공유해 도구창을 펼치면 겹칠 수 있었다.
//
//  Posture/ROM/VBT/1RM은 전부 CameraStage children으로 올바르게 쌓고 있어서
//  수정이 필요 없었다 — 이 파일에도 "이미 안전한 패턴"을 지키고 있는지
//  확인하는 테스트를 넣어, 이후 변경이 같은 실수를 다시 들여오지 않게 한다.
// ════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const read = (name) => readFileSync(join(process.cwd(), `src/ai-measure/menus/${name}`), 'utf8');

const squatSrc = read('SquatLiveAnalysis.jsx');
const stanceSrc = read('StanceLiveAnalysis.jsx');
const gaitSrc = read('GaitRunningAnalysis.jsx');
const jumpSrc = read('JumpPrecisionAnalysis.jsx');
const postureSrc = read('PostureMeasure.jsx');
const romSrc = read('RomMeasure.jsx');
const vbtSrc = read('VbtMeasure.jsx');
const oneRmSrc = read('OneRMEstimate.jsx');

describe('[회귀] SquatLiveAnalysis.jsx — 중복 회차 배지·겹치는 하단 배지 제거', () => {
  it('CameraStage 밖에 fixed top-3 회차 배지가 더 이상 없다(topBar 텍스트와 겹치던 것)', () => {
    expect(squatSrc).not.toMatch(/<div className="pointer-events-none fixed top-3/);
  });

  it('회차 카운터가 topBar 스택 안으로 옮겨져 항상 보인다', () => {
    const idx = squatSrc.indexOf('const topBar');
    const body = squatSrc.slice(idx, squatSrc.indexOf('const controls', idx));
    expect(body).toMatch(/회차 \{totalDone\}\/\{SQUAT_LIVE_TOTAL_TRIALS\}/);
  });

  it('보상패턴·대퇴골수평·종합판정 배지가 fixed bottom-28/bottom-40 고정 픽셀이 아니라 CameraStage children 안에 있다', () => {
    expect(squatSrc).not.toMatch(/fixed bottom-28/);
    expect(squatSrc).not.toMatch(/fixed bottom-40/);
    const idx = squatSrc.indexOf('<CameraStage');
    const end = squatSrc.indexOf('</CameraStage>', idx);
    const body = squatSrc.slice(idx, end);
    expect(body).toMatch(/대퇴골 수평 이하/);
    expect(body).toMatch(/COMPENSATION_KO\[c\]/);
    expect(body).toMatch(/종합 판정/);
    expect(body).toMatch(/<GaugeHud/);
  });

  it('활성 구간 배지들이 하나의 flex-col 스택으로 묶여 GaugeHud 위에 순서대로 쌓인다', () => {
    const idx = squatSrc.indexOf("uiPhase === 'active' && (\n        <div className=\"flex flex-col items-center gap-2\">");
    expect(idx).toBeGreaterThan(-1);
  });
});

describe('[회귀] StanceLiveAnalysis.jsx — 중복 시행 배지 제거', () => {
  it('CameraStage 밖에 fixed top-3 시행 배지가 더 이상 없다', () => {
    expect(stanceSrc).not.toMatch(/<div className="pointer-events-none fixed top-3/);
  });

  it('시행 카운터가 topBar 스택 안으로 옮겨져 항상 보인다', () => {
    const idx = stanceSrc.indexOf('const topBar');
    const body = stanceSrc.slice(idx, stanceSrc.indexOf('const controls', idx));
    expect(body).toMatch(/시행 \{trialsFound\}\/\{SLST_LIVE_MAX_TRIALS\}/);
  });
});

describe('[회귀] GaitRunningAnalysis.jsx — 도구창/게이지 겹침·헤더 safe-area', () => {
  it('헤더가 env(safe-area-inset-top)을 반영한다(노치 기종에서 시스템 상태바 밑에 깔리던 문제)', () => {
    const idx = gaitSrc.indexOf('absolute top-0 z-20 w-full');
    const body = gaitSrc.slice(idx, idx + 300);
    expect(body).toMatch(/env\(safe-area-inset-top\)/);
  });

  it('CompactTools가 recording 중일 때 liftForGauge로 기준 위치를 올려 케이던스 게이지와 안 겹친다', () => {
    expect(gaitSrc).toMatch(/liftForGauge=\{view === 'recording'\}/);
    const idx = gaitSrc.indexOf('function CompactTools');
    const body = gaitSrc.slice(idx, idx + 400);
    expect(body).toMatch(/liftForGauge\s*=\s*false/);
    expect(body).toMatch(/const baseOffset = liftForGauge \? 340 : 96/);
  });
});

describe('[회귀] JumpPrecisionAnalysis.jsx — 헤더 safe-area', () => {
  it('헤더가 env(safe-area-inset-top)을 반영한다', () => {
    const idx = jumpSrc.indexOf('absolute top-0 z-20 inset-x-0');
    const body = jumpSrc.slice(idx, idx + 300);
    expect(body).toMatch(/env\(safe-area-inset-top\)/);
  });

  it('JumpLiveOverlay(상태 카드+게이지)가 헤더보다 아래에서 시작해 겹치지 않는다', () => {
    expect(jumpSrc).toMatch(/top-\[max\(50px,calc\(env\(safe-area-inset-top\)\+50px\)\)\]/);
  });
});

describe('[확인] Posture/ROM/VBT/1RM — CameraStage children으로 이미 안전하게 쌓고 있다(재발 방지용 고정 테스트)', () => {
  it('PostureMeasure.jsx는 CameraStage 밖에 겹칠 만한 fixed 배지가 없다(카운트다운 제외)', () => {
    const badges = postureSrc.match(/pointer-events-none fixed/g) || [];
    // 화면 중앙 카운트다운 1개만 허용 — 그 외 추가 fixed 배지가 생기면 이 테스트가 잡는다.
    expect(badges.length).toBeLessThanOrEqual(1);
  });

  it('RomMeasure.jsx의 GaugeHud는 CameraStage children 안, 관절/자세 버튼과 같은 space-y 스택 안에 있다', () => {
    const idx = romSrc.indexOf('<CameraStage');
    const end = romSrc.indexOf('</CameraStage>', idx) === -1 ? romSrc.length : romSrc.indexOf('</CameraStage>', idx);
    const body = romSrc.slice(idx, end);
    expect(body).toMatch(/<GaugeHud/);
    expect(body).not.toMatch(/className="pointer-events-none fixed/);
  });

  it('VbtMeasure.jsx의 렙 카드·GaugeHud가 CameraStage children으로 함께 쌓인다(고정 픽셀 겹침 없음)', () => {
    const idx = vbtSrc.indexOf('<CameraStage');
    const end = vbtSrc.indexOf('</CameraStage>', idx) === -1 ? vbtSrc.length : vbtSrc.indexOf('</CameraStage>', idx);
    const body = vbtSrc.slice(idx, end);
    expect(body).toMatch(/repList/);
    expect(body).toMatch(/<GaugeHud/);
  });

  it('OneRMEstimate.jsx도 동일 패턴(렙 카드 → CameraStage children)', () => {
    const idx = oneRmSrc.indexOf('<CameraStage');
    const end = oneRmSrc.indexOf('</CameraStage>', idx) === -1 ? oneRmSrc.length : oneRmSrc.indexOf('</CameraStage>', idx);
    const body = oneRmSrc.slice(idx, end);
    expect(body).toMatch(/repList/);
  });
});
