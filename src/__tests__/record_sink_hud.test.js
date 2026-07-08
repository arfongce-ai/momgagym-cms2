import { describe, it, expect, vi } from 'vitest';
import { buildVideoFileName, extForBlob } from '../ai-measure/core/recordSink.js';
import { drawLiftingDataHud, drawBarPathToRecord } from '../ai-measure/core/recordingOverlay.js';

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
