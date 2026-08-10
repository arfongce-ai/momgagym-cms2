// jump_types.test.js
// [2026-08-10 신규] jumpTypes.js — CMJ 이름 변경 + SJ/DJ/SLJ 추가의 기반이 되는
// 메타데이터/판정 함수 검증.
import { describe, it, expect } from 'vitest';
import {
  JUMP_SUBTYPES, JUMP_SUBTYPE_ORDER,
  resolveJumpSubType, engineOf, requiredJumpsFor, minCyclesOverrideFor, labelOf,
} from '../ai-measure/core/jumpTypes.js';

describe('JUMP_SUBTYPES — 5종 메타데이터 무결성', () => {
  it('cmj/sj/dj/slj/rsi 5종이 모두 있고 순서(JUMP_SUBTYPE_ORDER)와 일치한다', () => {
    expect(JUMP_SUBTYPE_ORDER).toEqual(['cmj', 'sj', 'dj', 'slj', 'rsi']);
    JUMP_SUBTYPE_ORDER.forEach(k => expect(JUMP_SUBTYPES[k]).toBeTruthy());
  });

  it('각 종류는 code/label/engine/guideTitle/guideBody/tip을 갖는다', () => {
    JUMP_SUBTYPE_ORDER.forEach(k => {
      const m = JUMP_SUBTYPES[k];
      expect(m.code).toBeTruthy();
      expect(m.label).toBeTruthy();
      expect(['power', 'reactive']).toContain(m.engine);
      expect(m.guideTitle).toBeTruthy();
      expect(m.guideBody).toBeTruthy();
      expect(m.tip).toBeTruthy();
    });
  });

  it('CMJ 라벨은 "CMJ (반동점프)"로 정확히 바뀌었다(파워 점프 이름 변경 요청)', () => {
    expect(JUMP_SUBTYPES.cmj.label).toBe('CMJ (반동점프)');
  });

  it('power 엔진 3종(cmj/sj/slj), reactive 엔진 2종(dj/rsi)으로 나뉜다', () => {
    expect(JUMP_SUBTYPES.cmj.engine).toBe('power');
    expect(JUMP_SUBTYPES.sj.engine).toBe('power');
    expect(JUMP_SUBTYPES.slj.engine).toBe('power');
    expect(JUMP_SUBTYPES.dj.engine).toBe('reactive');
    expect(JUMP_SUBTYPES.rsi.engine).toBe('reactive');
  });

  it('SLJ만 singleLeg 플래그가 true다(한발 점프 — 다리 선택 UI 트리거)', () => {
    expect(JUMP_SUBTYPES.slj.singleLeg).toBe(true);
    expect(JUMP_SUBTYPES.cmj.singleLeg).toBeFalsy();
    expect(JUMP_SUBTYPES.sj.singleLeg).toBeFalsy();
  });

  it('DJ는 minCycles:2(1회 드롭+재도약), RSI는 override 없음(기존 3회 유지)', () => {
    expect(JUMP_SUBTYPES.dj.minCycles).toBe(2);
    expect(JUMP_SUBTYPES.rsi.minCycles).toBeUndefined();
  });
});

describe('resolveJumpSubType() — 과거 데이터 하위호환 추론', () => {
  it('jumpSubType 필드가 있으면 그대로 신뢰한다', () => {
    expect(resolveJumpSubType({ jumpSubType: 'sj' })).toBe('sj');
    expect(resolveJumpSubType({ jumpSubType: 'dj', jumpType: 'reactive' })).toBe('dj');
  });

  it('모르는 jumpSubType 값이면 무시하고 기존 방식(jumpType/rsi)으로 추론한다', () => {
    expect(resolveJumpSubType({ jumpSubType: 'unknown_future_type', jumpType: 'power' })).toBe('cmj');
  });

  it('jumpSubType이 없는 과거 데이터: jumpType=reactive 또는 rsi 값이 있으면 rsi로 추론', () => {
    expect(resolveJumpSubType({ jumpType: 'reactive' })).toBe('rsi');
    expect(resolveJumpSubType({ rsi: { rsi: 1.2 } })).toBe('rsi');
  });

  it('jumpSubType이 없는 과거 데이터: 그 외(파워 점프였던 데이터)는 cmj로 추론', () => {
    expect(resolveJumpSubType({ jumpType: 'power', heightCm: 40 })).toBe('cmj');
    expect(resolveJumpSubType({ heightCm: 40 })).toBe('cmj');
  });

  it('데이터가 없으면(null/undefined) 안전하게 cmj', () => {
    expect(resolveJumpSubType(null)).toBe('cmj');
    expect(resolveJumpSubType(undefined)).toBe('cmj');
  });
});

describe('engineOf() — 세부 종류 → 계산 엔진 매핑', () => {
  it('cmj/sj/slj → power', () => {
    expect(engineOf('cmj')).toBe('power');
    expect(engineOf('sj')).toBe('power');
    expect(engineOf('slj')).toBe('power');
  });
  it('dj/rsi → reactive', () => {
    expect(engineOf('dj')).toBe('reactive');
    expect(engineOf('rsi')).toBe('reactive');
  });
  it('모르는 값은 안전하게 power로 폴백', () => {
    expect(engineOf('nonsense')).toBe('power');
    expect(engineOf(undefined)).toBe('power');
  });
});

describe('requiredJumpsFor() — 종류별 필요 최소 점프 횟수', () => {
  it('power 엔진(cmj/sj/slj)은 1회', () => {
    expect(requiredJumpsFor('cmj')).toBe(1);
    expect(requiredJumpsFor('sj')).toBe(1);
    expect(requiredJumpsFor('slj')).toBe(1);
  });
  it('DJ는 2회(드롭+재도약 1세트 = 접지구간 1개)', () => {
    expect(requiredJumpsFor('dj')).toBe(2);
  });
  it('RSI(연속)는 기존 그대로 3회', () => {
    expect(requiredJumpsFor('rsi')).toBe(3);
  });
});

describe('minCyclesOverrideFor() — reactiveJump.js RSI_TUNING.minCycles 대체값', () => {
  it('DJ는 2를 반환(기존 3에서 완화 — 단발 드롭점프는 접지구간이 원래 1개뿐)', () => {
    expect(minCyclesOverrideFor('dj')).toBe(2);
  });
  it('RSI(연속)는 override 없음 — null(호출부가 기존 RSI_TUNING.minCycles=3 그대로 씀)', () => {
    expect(minCyclesOverrideFor('rsi')).toBeNull();
  });
  it('power 엔진 종류는 애초에 해당 없음 — null', () => {
    expect(minCyclesOverrideFor('cmj')).toBeNull();
  });
});

describe('labelOf() — 표시 라벨(모르는 값은 CMJ로 안전 폴백)', () => {
  it('정상 종류는 해당 라벨을 그대로', () => {
    expect(labelOf('dj')).toBe('DJ (드롭점프)');
    expect(labelOf('slj')).toBe('SLJ (한발 점프)');
  });
  it('모르는/빈 값은 CMJ 라벨로 폴백(크래시 방지)', () => {
    expect(labelOf('nope')).toBe('CMJ (반동점프)');
    expect(labelOf(undefined)).toBe('CMJ (반동점프)');
  });
});
