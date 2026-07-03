// __tests__/session_share.test.js
// '카카오톡으로 리포트 공유' A4 캡처 대상 판정 + 세션 상세 타일 추출 검증.
import { describe, it, expect } from 'vitest';
import {
  canCaptureUnifiedResult, extractSessionDetailTiles, isLiftingShapedSession,
} from '../components/report/sessionShare';

describe('canCaptureUnifiedResult (A4 캡처 가능 판정)', () => {
  it('전용 리포트 소스(saved-report/posture/rom)는 항상 캡처 가능', () => {
    expect(canCaptureUnifiedResult({ source: 'saved-report' })).toBe(true);
    expect(canCaptureUnifiedResult({ source: 'posture' })).toBe(true);
    expect(canCaptureUnifiedResult({ source: 'rom' })).toBe(true);
  });

  it('세션 항목도 데이터가 있으면 캡처 가능 → 모든 측정이 A4 이미지로 공유된다', () => {
    expect(canCaptureUnifiedResult({ source: 'session', report: { weight: 70 } })).toBe(true);
    expect(canCaptureUnifiedResult({ source: 'session', session: { data: { oneRM: 100 } } })).toBe(true);
  });

  it('데이터 없는 세션·알 수 없는 소스·null 은 캡처 불가(텍스트 폴백)', () => {
    expect(canCaptureUnifiedResult({ source: 'session' })).toBe(false);
    expect(canCaptureUnifiedResult({ source: 'etc', report: {} })).toBe(false);
    expect(canCaptureUnifiedResult(null)).toBe(false);
  });
});

describe('isLiftingShapedSession (바벨 리프팅 전용 대시보드 라우팅)', () => {
  it('mode/type 기반 통합 페이로드를 인식', () => {
    expect(isLiftingShapedSession({ mode: 'onerm' })).toBe(true);
    expect(isLiftingShapedSession({ mode: 'vbt' })).toBe(true);
    expect(isLiftingShapedSession({ mode: 'lifting' })).toBe(true);
    expect(isLiftingShapedSession({ type: 'lifting' })).toBe(true);
  });

  it('metrics 안에 핵심값이 있으면 리프팅 페이로드로 간주', () => {
    expect(isLiftingShapedSession({ metrics: { oneRM: 120 } })).toBe(true);
    expect(isLiftingShapedSession({ metrics: { meanVelocity: 0.6 } })).toBe(true);
  });

  it('레거시 얇은 세션·신체정보는 리프팅 페이로드가 아님', () => {
    expect(isLiftingShapedSession({ oneRM: 100, weight: 80, reps: 5 })).toBe(false);
    expect(isLiftingShapedSession({ weight: 70, systolic: 120 })).toBe(false);
    expect(isLiftingShapedSession(null)).toBe(false);
  });
});

describe('extractSessionDetailTiles (메뉴별 상세 타일)', () => {
  it('1RM: 추정값이 강조 타일로, 입력이 병합 표기', () => {
    const tiles = extractSessionDetailTiles('onerm', { oneRM: 112.5, liftLabel: '벤치프레스', weight: 100, reps: 5 });
    expect(tiles[0]).toMatchObject({ label: '추정 1RM', value: '112.5', unit: 'kg', accent: true });
    expect(tiles.some(t => t.value === '100kg × 5회')).toBe(true);
  });

  it('신체정보: 혈압은 수축/이완이 모두 있을 때만 표기', () => {
    const withBp = extractSessionDetailTiles('body', { weight: 70, height: 170, systolic: 120, diastolic: 80 });
    expect(withBp.some(t => t.label === '혈압' && t.value === '120/80')).toBe(true);
    const noBp = extractSessionDetailTiles('body', { weight: 70, systolic: 120 });
    expect(noBp.some(t => t.label === '혈압')).toBe(false);
  });

  it('RSI 레거시 세션: rsi 가 객체/숫자 둘 다 지원', () => {
    expect(extractSessionDetailTiles('rsi', { rsi: 1.2, heightCm: 30 })[0].value).toBe('1.2');
    expect(extractSessionDetailTiles('rsi', { rsi: { rsi: 0.9 }, heightCm: 25 })[0].value).toBe('0.9');
  });

  it('값이 없는 항목은 그리지 않는다(측정 정직성)', () => {
    expect(extractSessionDetailTiles('vbt', {})).toEqual([]);
    expect(extractSessionDetailTiles('onerm', { oneRM: null })).toEqual([]);
  });
});

describe('reportTypeFromSession (통합 결과 카드 타입 분류)', () => {
  it('바벨 리프팅 허브 세션은 mode 로 one_rm/vbt 로 세분류된다', async () => {
    const { reportTypeFromSession } = await import('../pages/Report.jsx');
    expect(reportTypeFromSession({ menu: 'lifting', data: { mode: 'onerm' } })).toBe('one_rm');
    expect(reportTypeFromSession({ menu: 'lifting', data: { metrics: { oneRM: 120 } } })).toBe('one_rm');
    expect(reportTypeFromSession({ menu: 'lifting', data: { mode: 'vbt' } })).toBe('vbt');
    expect(reportTypeFromSession({ menu: 'lifting', data: { mode: 'lifting' } })).toBe('vbt');
  });

  it('레거시 메뉴 매핑 유지: onerm/vbt/rsi/기타', async () => {
    const { reportTypeFromSession } = await import('../pages/Report.jsx');
    expect(reportTypeFromSession({ menu: 'onerm' })).toBe('one_rm');
    expect(reportTypeFromSession({ menu: 'vbt' })).toBe('vbt');
    expect(reportTypeFromSession({ menu: 'rsi' })).toBe('jump');
    expect(reportTypeFromSession({ menu: 'body' })).toBe('body');
    expect(reportTypeFromSession({})).toBe('general');
  });
});
