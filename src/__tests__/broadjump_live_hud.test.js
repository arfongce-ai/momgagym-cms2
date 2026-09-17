// broadjump_live_hud.test.js
// [한발멀리뛰기/제자리멀리뛰기 라이브 HUD·녹화 오버레이 수정 2026-09-17]
// 배경: SBJ/한발멀리뛰기(jumpType==='horizontal')를 라이브 카메라로 측정하는
// 동안, 화면 HUD와 녹화(동영상 저장) 번인 오버레이가 여전히 "점프 높이"만
// 표시하고 있었다 — flightRows/allFlightRows/liveJump가 항상 calcJump(체공
// 시간→수직 높이)를 계산해 넣었기 때문에, 실제로는 수평 거리를 재는 측정인데도
// 그럴듯해 보이는 가짜 "cm" 높이 숫자가 뜨고 실제 이동거리는 어디에도 안
// 보였다. JumpPrecisionAnalysis.jsx는 다른 여러 static-source 테스트(예:
// rsi_contact_sanity_and_index.test.js)와 동일하게 export가 없는 내부
// 함수들이 많아 소스 텍스트 검증 방식을 그대로 따른다.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const src = readFileSync(
  join(process.cwd(), 'src', 'ai-measure', 'menus', 'JumpPrecisionAnalysis.jsx'),
  'utf8',
);

describe('flightRows/allFlightRows — horizontal(SBJ·한발멀리뛰기)이면 heightCm 대신 distanceCm', () => {
  it('distanceCmOf 헬퍼로 landingX·baselineFeetX·scaleCmPerY 기반 거리를 계산한다', () => {
    expect(src).toContain('function distanceCmOf(f, horizontalScale)');
  });

  it('flightRows/allFlightRows 둘 다 horizontalScale이 있으면 calcJump를 건너뛰고 distanceCm을 채운다', () => {
    const flightRowsBody = src.slice(src.indexOf('function flightRows('), src.indexOf('function allFlightRows('));
    const allFlightRowsBody = src.slice(src.indexOf('function allFlightRows('), src.indexOf('// 대형 시인성 HUD'));
    for (const body of [flightRowsBody, allFlightRowsBody]) {
      expect(body).toContain('const isHorizontal = Boolean(horizontalScale);');
      expect(body).toContain('const jump = isHorizontal ? null : calcJump(');
      expect(body).toContain('distanceCm: isHorizontal ? distanceCmOf(f, horizontalScale) : null,');
    }
  });
});

describe('drawJumpLiveOverlay(녹화 번인) — horizontal 분기', () => {
  const body = src.slice(src.indexOf('function drawJumpLiveOverlay('), src.indexOf('function drawCoverJump('));

  it('isHorizontal을 판정하고 게이지 라벨을 "이동거리"로, 값은 distanceCm 기준으로 쓴다', () => {
    expect(body).toContain("const isHorizontal = snap.jumpType === 'horizontal';");
    expect(body).toContain("{ label: '이동거리', value: snap.liveJump?.distanceCm ?? snap.bestDistance ?? null, unit: 'cm' }");
  });

  it('카드(회차별 기록)도 horizontal이면 heightCm이 아니라 distanceCm을 보여준다', () => {
    expect(body).toContain('r.distanceCm != null');
  });

  it('타이틀도 파워 점프용 "JUMP · FRONT"를 그대로 쓰지 않고 별도 타이틀을 쓴다', () => {
    expect(body).toContain("isHorizontal ? 'BROAD JUMP' : 'JUMP · FRONT'");
  });
});

describe('JumpLiveOverlay(화면 HUD, React) — horizontal 분기', () => {
  const body = src.slice(src.indexOf('function JumpLiveOverlay('), src.indexOf('function LiveHeightWave('));

  it('bestDistance prop을 받고 게이지에 distanceCm 기준 값을 쓴다', () => {
    expect(body).toContain('bestDistance');
    expect(body).toContain("{ label: '이동거리', value: liveJump.distanceCm ?? bestDistance ?? null, unit: 'cm' }");
  });
});

describe('라이브 측정 루프 — bestDistanceRef를 bestHeightRef와 동일하게 관리한다', () => {
  it('bestDistanceRef가 선언되고 resetPipeline에서 초기화된다', () => {
    expect(src).toContain('const bestDistanceRef = useRef(null);');
    const resetIdx = src.indexOf('const resetPipeline = () => {');
    const resetBody = src.slice(resetIdx, src.indexOf('const startCamera', resetIdx));
    expect(resetBody).toContain('bestDistanceRef.current = null;');
  });

  it('tracker.summary()의 distanceCm으로 bestDistanceRef를 갱신한다', () => {
    expect(src).toContain('if (s?.distanceCm != null) bestDistanceRef.current = s.distanceCm;');
  });

  it('JumpLiveOverlay 호출부와 녹화 오버레이 호출부 양쪽에 bestDistance를 넘긴다', () => {
    expect(src).toContain('bestDistance={bestDistanceRef.current}');
    expect(src).toContain('bestDistance: bestDistanceRef.current,');
  });

  it('finishMeasure의 perJump 계산에도 horizontalScale을 넘겨 distanceCm이 저장되게 한다', () => {
    expect(src).toContain('const perJump = allFlightRows(tracker.flights, rsiResult?.perCycleByIndex || liveCyclePreview, horizontalScale);');
  });
});
