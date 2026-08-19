// slj_live_leg_switch.test.js — 회귀 방지: SLJ(한발 점프) 라이브(실시간 카메라)
// 측정에서 왼쪽→오른쪽 자동 전환이 동작하지 않던 버그.
//
// 근본 원인: JumpPrecisionAnalysis.jsx(라이브)가 점프 검출에 성공하면 Hub를
// 거치지 않고 Firestore에 직접 개별 저장 + 자체 미리보기 화면만 보여줬다.
// JumpUploadAnalysis.jsx(고속영상 업로드)만 onComplete로 Hub에 결과를 넘겨
// Hub의 기록확인→다회차평균(combineJumpTrials)→SLJ "반대쪽 다리도 측정할까요?"
// 프롬프트(JumpAnalysisHub.jsx의 finishTrials/slj_other_leg)를 태우고 있었다 —
// 라이브는 이 로직 자체가 호출되지 않아 다리 자동전환이 동작할 수 없었다.
//
// 소스 레벨 배선 확인(카메라·MediaRecorder 등 브라우저 API 의존으로 이 파일들은
// jsdom 렌더 테스트 대신 소스 패턴 테스트를 쓰는 이 코드베이스의 기존 관례를
// 따른다 — jump_start_before_calibration.test.js 등과 동일 패턴).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const jumpPrecisionSrc = readFileSync(
  join(process.cwd(), 'src/ai-measure/menus/JumpPrecisionAnalysis.jsx'),
  'utf8',
);
const jumpHubSrc = readFileSync(
  join(process.cwd(), 'src/ai-measure/menus/JumpAnalysisHub.jsx'),
  'utf8',
);

describe('SLJ 라이브 다리 자동전환 — 라이브 완료 결과가 Hub로 넘어간다', () => {
  it('JumpPrecisionAnalysis가 onComplete prop을 받는다', () => {
    expect(jumpPrecisionSrc).toMatch(/onComplete/);
  });

  it('finishMeasure가 onComplete 제공 시 자체 저장 대신 Hub로 결과를 넘긴다', () => {
    expect(jumpPrecisionSrc).toContain(`if (typeof onComplete === 'function')`);
    expect(jumpPrecisionSrc).toContain('await onComplete(report)');
  });

  it('Hub가 라이브(mode==="live") JumpPrecisionAnalysis에 onComplete={handleComplete}를 넘긴다', () => {
    const liveBlock = jumpHubSrc.slice(
      jumpHubSrc.indexOf("mode === 'live'"),
      jumpHubSrc.indexOf("mode === 'upload'"),
    );
    expect(liveBlock).toContain('<JumpPrecisionAnalysis');
    expect(liveBlock).toContain('onComplete={handleComplete}');
  });

  it('persist()가 Firestore 저장 페이로드에서 videoBlob을 제외한다(Blob 직렬화 오류 방지)', () => {
    expect(jumpHubSrc).toContain('const { videoBlob: _vb, ...persistable } = withRecord;');
    expect(jumpHubSrc).toContain('await save(persistable)');
  });

  it('기록확인 화면 요약이 실제 리포트 필드명(heightCm/flightTimeMs/rsi.rsi)을 읽는다', () => {
    expect(jumpHubSrc).toContain('j.heightCm != null');
    expect(jumpHubSrc).toContain('j.flightTimeMs != null');
    expect(jumpHubSrc).toContain('j.rsi?.rsi != null');
  });

  it('SLJ 다회차 완료 시 반대쪽 다리 프롬프트로 전환하는 로직이 여전히 존재한다', () => {
    expect(jumpHubSrc).toContain("jumpSubType === 'slj' && sljFirstLegDone === null");
    expect(jumpHubSrc).toContain("setView('slj_other_leg')");
  });
});
