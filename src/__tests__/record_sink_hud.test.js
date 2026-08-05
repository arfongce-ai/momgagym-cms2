import { describe, it, expect, vi } from 'vitest';
import { buildVideoFileName, extForBlob, pickRecorderMime } from '../ai-measure/core/recordSink.js';
import { drawLiftingDataHud, drawBarPathToRecord } from '../ai-measure/core/recordingOverlay.js';
import { readFileSync } from 'node:fs';

const oneRmSource = readFileSync(new URL('../ai-measure/menus/OneRMEstimate.jsx', import.meta.url), 'utf8');

function mockCtx() {
  const calls = { fillText: [], strokeCalls: 0, lineTo: 0 };
  return {
    save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), closePath: vi.fn(),
    moveTo: vi.fn(), lineTo: vi.fn(() => { calls.lineTo++; }), arcTo: vi.fn(),
    arc: vi.fn(), fill: vi.fn(), stroke: vi.fn(() => { calls.strokeCalls++; }),
    fillRect: vi.fn(), measureText: vi.fn((t) => ({ width: String(t).length * 8 })),
    fillText: vi.fn((t) => { calls.fillText.push(String(t)); }),
    set fillStyle(v) {}, set strokeStyle(v) {}, set font(v) {},
    set lineWidth(v) {}, set lineCap(v) {}, set lineJoin(v) {},
    set textBaseline(v) {}, set textAlign(v) {},
    _calls: calls,
  };
}

describe('recordSink · 몸가짐ai 영상 파일명', () => {
  it('몸가짐_AI_{종목}_{회원}_{날짜}_{시각}.{확장자} 형식', () => {
    const at = new Date(2026, 5, 30, 14, 20, 35); // 2026-06-30 14:20:35
    const name = buildVideoFileName({ measure: '벤치프레스', member: { name: '홍길동' }, ext: 'webm', at });
    expect(name).toBe('몸가짐_AI_벤치프레스_홍길동_20260630_142035.webm');
  });

  it('회원명/종목의 공백·금지문자를 안전치환', () => {
    const at = new Date(2026, 0, 2, 9, 5, 7);
    const name = buildVideoFileName({ measure: 'VBT 속도', member: { name: '김 동규/트레이너' }, ext: 'mp4', at });
    expect(name).toContain('몸가짐_AI_');
    expect(name).not.toMatch(/[\\/:*?"<>|\s]/); // 금지문자 없음
    expect(name.endsWith('.mp4')).toBe(true);
  });

  it('회원 정보 없으면 guest 폴백', () => {
    const at = new Date(2026, 0, 1, 0, 0, 0);
    const name = buildVideoFileName({ measure: '역도', member: null, at });
    expect(name).toContain('_guest_');
  });

  it('미등록(가상)회원 라벨', () => {
    const at = new Date(2026, 0, 1, 0, 0, 0);
    const name = buildVideoFileName({ measure: '역도', member: { isVirtual: true }, at });
    expect(name).toContain('미등록회원');
  });

  it('extForBlob: mime → 확장자', () => {
    expect(extForBlob({ type: 'video/mp4' })).toBe('mp4');
    expect(extForBlob({ type: 'video/webm;codecs=vp8' })).toBe('webm');
    expect(extForBlob({})).toBe('webm'); // 기본
  });
});

describe('리프팅 데이터 HUD · 대형 시인성(측정값만 번인 · 장식 없음)', () => {
  it('수직이동/평균속도/경과를 텍스트로 그린다(값·단위 분리 렌더)', () => {
    const ctx = mockCtx();
    drawLiftingDataHud(ctx, 720, 1280, { romCm: 42.5, meanVelocity: 0.63, elapsedSec: 1.4, recording: true });
    const txt = ctx._calls.fillText.join('|');
    expect(txt).toContain('수직이동');
    expect(txt).toContain('42.5');
    expect(txt).toContain('cm');
    expect(txt).toContain('평균속도');
    expect(txt).toContain('0.6');
    expect(txt).toContain('m/s');
    expect(txt).toContain('1.4s');
  });

  it('제목 칩을 표시한다(기본 LIFT · VBT 전달 가능)', () => {
    const ctx = mockCtx();
    drawLiftingDataHud(ctx, 720, 1280, { romCm: 30, meanVelocity: 0.5, elapsedSec: 2, title: 'VBT' });
    expect(ctx._calls.fillText.join('|')).toContain('VBT');
  });

  it('값이 없으면 -- 로 표시(허위값 없음)', () => {
    const ctx = mockCtx();
    drawLiftingDataHud(ctx, 720, 1280, { romCm: null, meanVelocity: null, elapsedSec: null });
    const txt = ctx._calls.fillText.join('|');
    expect(txt).toContain('--');
  });

  it('렙 리스트를 하단 카드로 번인한다', () => {
    const ctx = mockCtx();
    drawLiftingDataHud(ctx, 720, 1280, {
      romCm: 40, meanVelocity: 0.7, elapsedSec: 5, recording: true,
      repList: [
        { repNo: 1, meanVelocity: 0.72, romCm: 41 },
        { repNo: 2, meanVelocity: 0.66, lossPct: 8 },
      ],
    });
    const txt = ctx._calls.fillText.join('|');
    expect(txt).toContain('#1');
    expect(txt).toContain('0.72');
    expect(txt).toContain('#2');
    expect(txt).toContain('-8%');
  });
});

describe('1RM 실시간 HUD · 화면/녹화 동시 표시', () => {
  it('자동 반복수로 추정 1RM을 계산해 화면 HUD와 녹화 HUD에 연결한다', () => {
    expect(oneRmSource).toContain('estimate1RM(snapWeight(computedWeight), live.reps).average');
    expect(oneRmSource).toContain('estimate1RM(snapWeight(computedWeight), liveReps).average');
    expect(oneRmSource.match(/label[:=]\s*["']추정 1RM["']/g)?.length).toBeGreaterThanOrEqual(2);
    expect(oneRmSource).toContain("{ label: '입력 무게'");
  });
});

describe('바벨 궤적선 · 실제 경로만 그림', () => {
  it('2점 이상이면 선을 긋는다', () => {
    const ctx = mockCtx();
    const path = [{ x: 0.5, y: 0.8 }, { x: 0.5, y: 0.5 }, { x: 0.5, y: 0.3 }];
    drawBarPathToRecord(ctx, path, 720, 1280);
    expect(ctx._calls.strokeCalls).toBe(1);
    expect(ctx._calls.lineTo).toBe(2); // 첫 점은 moveTo, 이후 2개 lineTo
  });

  it('점이 부족하면 아무것도 안 그린다', () => {
    const ctx = mockCtx();
    drawBarPathToRecord(ctx, [{ x: 0.5, y: 0.5 }], 720, 1280);
    expect(ctx._calls.strokeCalls).toBe(0);
    drawBarPathToRecord(ctx, [], 720, 1280);
    expect(ctx._calls.strokeCalls).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════════════════
//  [2026-08-03] 회귀 테스트 — "측정 후 저장된 영상을 카카오톡으로 전송할 때
//  오류가 납니다" 버그.
//
//  원인: pickRecorderMime()(과 9개 녹화 화면 중 5곳이 각자 들고 있던 동일한
//  로직)이 코덱 없이 맨 'video/mp4' 문자열만 물어봤다. 크로미움 계열(키오스크
//  Chrome, 대부분의 안드로이드 브라우저)에서는 이 맨 문자열이 실제 mp4 인코더가
//  있어도 isTypeSupported에서 false로 나오는 경우가 흔해, 코드는 mp4를
//  우선한다고 적혀 있었지만 실제 녹화는 항상 webm으로 되고 있었다. webm은
//  카카오톡을 비롯한 대부분의 외부 앱이 "영상"으로 제대로 못 받아, 공유 시트에서
//  카카오톡을 선택해 전송을 시도하면 오류가 난다.
//
//  수정: pickRecorderMime()에 코덱까지 명시한 mp4 문자열(RecordMeasure.jsx가
//  이미 쓰고 있던 방식 + Safari가 스스로 보고하는 정확한 코덱 문자열)을 먼저
//  물어보게 했다. 그리고 StanceLiveAnalysis·SquatLiveAnalysis·RomMeasure·
//  JumpPrecisionAnalysis·GaitRunningAnalysis·RecordMeasure 6개 화면이 각자
//  갖고 있던 동일한(또는 유사한) 로컬 배열/함수를 이 공용 함수 하나로 통일했다
//  (VbtMeasure·OneRMEstimate·LiftingMeasure는 이미 공용 함수를 쓰고 있어서
//  recordSink.js만 고쳐도 자동으로 혜택을 받는다).
// ════════════════════════════════════════════════════════════════════════
describe('[2026-08-03 회귀] pickRecorderMime — 코덱 없는 mp4 문자열 대신 코덱까지 명시', () => {
  // MediaRecorder.isTypeSupported를 흉내내는 헬퍼 — supported에 들어있는 정확한
  // 문자열만 true를 돌려준다(실제 브라우저의 엄격한 문자열 매칭을 재현).
  function withMockRecorder(supported, fn) {
    const orig = globalThis.MediaRecorder;
    globalThis.MediaRecorder = { isTypeSupported: (t) => supported.includes(t) };
    try { return fn(); } finally {
      if (orig === undefined) delete globalThis.MediaRecorder; else globalThis.MediaRecorder = orig;
    }
  }

  it('MediaRecorder 자체가 없으면 빈 문자열(터지지 않음)', () => {
    const orig = globalThis.MediaRecorder;
    delete globalThis.MediaRecorder;
    try { expect(pickRecorderMime()).toBe(''); } finally { globalThis.MediaRecorder = orig; }
  });

  it('맨 video/mp4만 지원되는(코덱 문자열은 전부 false인) 엔진 — 그래도 맨 mp4를 잡는다', () => {
    withMockRecorder(['video/mp4'], () => {
      expect(pickRecorderMime()).toBe('video/mp4');
    });
  });

  it('[핵심 회귀] 코덱 명시 mp4는 지원하지만 맨 video/mp4는 false인 크로미움류 — 이전엔 못 잡고 webm으로 샜다', () => {
    // 실제 다수 크로미움 빌드가 보이는 패턴: 코덱을 명시해야만 true.
    withMockRecorder(['video/mp4;codecs=h264,aac', 'video/webm;codecs=vp8'], () => {
      expect(pickRecorderMime()).toBe('video/mp4;codecs=h264,aac');
    });
  });

  it('Safari 스타일(avc1.64003E 코덱 문자열만 지원)도 mp4로 잡는다', () => {
    withMockRecorder(['video/mp4;codecs=avc1.64003E,mp4a.40.2'], () => {
      expect(pickRecorderMime()).toBe('video/mp4;codecs=avc1.64003E,mp4a.40.2');
    });
  });

  it('mp4 계열이 전부 미지원이면 webm으로 정상 폴백(기존 동작 유지)', () => {
    withMockRecorder(['video/webm;codecs=vp8,opus', 'video/webm'], () => {
      expect(pickRecorderMime()).toBe('video/webm;codecs=vp8,opus');
    });
  });

  it('아무 타입도 지원 안 되면 빈 문자열', () => {
    withMockRecorder([], () => {
      expect(pickRecorderMime()).toBe('');
    });
  });
});

describe('[2026-08-03 회귀] 녹화 화면 6곳이 공용 pickRecorderMime()으로 통일됐다', () => {
  const files = [
    'StanceLiveAnalysis.jsx',
    'SquatLiveAnalysis.jsx',
    'RomMeasure.jsx',
    'JumpPrecisionAnalysis.jsx',
    'GaitRunningAnalysis.jsx',
    'RecordMeasure.jsx',
  ];

  files.forEach((name) => {
    it(`${name} — recordSink에서 pickRecorderMime을 가져와 쓰고, 로컬 mp4-우선 배열이 안 남아있다`, () => {
      const src = readFileSync(new URL(`../ai-measure/menus/${name}`, import.meta.url), 'utf8');
      expect(src).toMatch(/import\s*\{[^}]*pickRecorderMime[^}]*\}\s*from\s*['"]\.\.\/core\/recordSink['"]/);
      expect(src).toMatch(/pickRecorderMime\(\)/);
      // 이전에 각 파일이 갖고 있던 로컬 배열이 더 이상 없어야 한다(중복 로직 제거 확인).
      expect(src).not.toMatch(/\[\s*['"]video\/mp4['"]\s*,\s*['"]video\/webm;codecs=vp8['"]/);
    });
  });

  it('VbtMeasure·OneRMEstimate·LiftingMeasure는 이미 공용 함수를 쓰고 있어 recordSink.js 수정만으로 자동 적용된다', () => {
    ['VbtMeasure.jsx', 'OneRMEstimate.jsx', 'LiftingMeasure.jsx'].forEach((name) => {
      const src = readFileSync(new URL(`../ai-measure/menus/${name}`, import.meta.url), 'utf8');
      expect(src).toMatch(/pickRecorderMime/);
    });
  });
});
