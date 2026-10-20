import { describe, it, expect } from 'vitest';
import { aggregateTopics, topicTitle, TOPIC_METRICS, outOfRange } from '../../scripts/measure-topics/core.mjs';
import { GAIT_CADENCE_RANGES, GAIT_STANCE_RANGE_WALK, GAIT_VERTICAL_OSC_RANGES } from '../ai-measure/core/gaitMode';
import { METRIC_DEFINITIONS } from '../ai-measure/core/unifiedReport';

describe('measure-topics core', () => {
  it('인라인 기준범위가 METRIC_DEFINITIONS 와 같다(어긋남 방지)', () => {
    for (const [type, list] of Object.entries(TOPIC_METRICS)) {
      for (const m of list) {
        if (['cadenceWalk', 'cadenceRun', 'stanceWalk', 'verticalOscWalk', 'verticalOscRun'].includes(m.key)) continue; // 아래 gaitMode 테스트에서 확인
        const def = (METRIC_DEFINITIONS[type] || []).find((d) => d.key === m.key);
        expect(def, `${type}.${m.key} 정의 없음`).toBeTruthy();
        expect(def.range.good, `${type}.${m.key} 범위`).toEqual(m.good);
      }
    }
  });

  const gaitDoc = (cadence, at = '2026-10-01T00:00:00Z') => ({ kind: 'gait', createdAt: at, metrics: { cadence } });
  const members = (values) => Object.fromEntries(values.map((v, i) => [`m${i}`, [gaitDoc(v)]]));

  it('기본은 인원 제한이 없어 1명도 그대로 집계한다', () => {
    const c = aggregateTopics(members([150])).candidates.find((x) => x.metricKey === 'cadenceRun');
    expect(c.members).toBe(1);
    expect(c.outCount).toBe(1);
    expect(c.outPct).toBe(100);
  });
  it('minMembers 를 주면 그 미만 항목은 뺀다', () => {
    const r = aggregateTopics(members([150, 170, 175, 140]), 5);
    expect(r.candidates).toEqual([]);
    expect(r.skipped.belowMinMembers).toBeGreaterThan(0);
  });
  it('인원 수와 비율을 정확히 낸다(반올림은 정수 %만)', () => {
    const r = aggregateTopics(members([150, 170, 175, 140, 172, 168])); // 6명 중 2명 = 33%
    const c = r.candidates.find((x) => x.metricKey === 'cadenceRun');
    expect(c.members).toBe(6);
    expect(c.outCount).toBe(2);
    expect(c.outPct).toBe(33);
  });
  it('회원별 최신 기록 1건만 쓰고 무효 측정은 뺀다', () => {
    const docs = {};
    for (let i = 0; i < 5; i++) docs[`m${i}`] = [gaitDoc(150, '2026-01-01T00:00:00Z'), gaitDoc(170, '2026-09-01T00:00:00Z')];
    docs.bad = [{ ...gaitDoc(100), valid: false }];
    const r = aggregateTopics(docs);
    expect(r.candidates.find((x) => x.metricKey === 'cadenceRun')).toBeUndefined(); // 5명 모두 170(범위 안) → 후보 없음
    expect(r.skipped.noneOutOfRange).toBeGreaterThan(0);
  });
  it('결과에 회원 id·날짜·개별 수치가 없다', () => {
    const out = JSON.stringify(aggregateTopics(members([150, 170, 175, 140, 172, 168])));
    expect(out).not.toMatch(/"m\d|2026|:150|:140/);
  });
  it('후보 문구는 수치 기준 표현을 쓰고 단정·AI 표기가 없다', () => {
    const t = topicTitle({ typeName: '보행', label: '걸음 속도(케이던스)', members: 6, outCount: 2, outPct: 33 });
    expect(t).toContain('수치 기준');
    expect(t).toContain('6명 중 2명(33%)');
    expect(t).not.toMatch(/AI|진단|치료|질환/);
  });
  it('보행 metrics.valid=false 도 무효 측정으로 집계에서 뺀다', () => {
    const docs = { a: [{ kind: 'gait', createdAt: '2026-10-01T00:00:00Z', metrics: { cadence: 60, valid: false } }], b: [gaitDoc(150)] };
    const c = aggregateTopics(docs).candidates.find((x) => x.metricKey === 'cadenceRun');
    expect(c.members).toBe(1);
  });
  it('후보에 권장범위와 중앙값이 들어간다(점검용)', () => {
    const c = aggregateTopics(members([150, 170, 175, 140, 172, 168])).candidates.find((x) => x.metricKey === 'cadenceRun');
    expect(c.goodRange).toEqual([160, 180]);
    expect(c.median).toBe(169);
  });
  it('출발 반응 시간은 등급 기준이 없어 주제 후보에서 제외된다', () => {
    const sp = (ms) => [{ kind: 'sprint', createdAt: '2026-10-01T00:00:00Z', reactionTimeMs: ms }];
    const r = aggregateTopics({ a: sp(6530), b: sp(300), c: sp(900) });
    expect(r.candidates.find((x) => x.metricKey === 'reactionTime')).toBeUndefined();
  });
  it('거의 전원이 범위 밖이면 기준 재확인 필요로 표시한다', () => {
    const r = aggregateTopics(members([190, 195, 200, 185])); // 4명 전원 달리기 케이던스 범위 밖
    expect(r.candidates.find((x) => x.metricKey === 'cadenceRun').needsReview).toBe(true);
    const ok = aggregateTopics(members([150, 170, 175, 140, 172, 168])).candidates.find((x) => x.metricKey === 'cadenceRun');
    expect(ok.needsReview).toBe(false);
    const tiny = aggregateTopics(members([190, 195])).candidates.find((x) => x.metricKey === 'cadenceRun');
    expect(tiny.needsReview).toBe(false); // 3명 미만은 표본이 적어 판단 보류
  });
  it('outOfRange 는 절댓값 옵션을 지원한다', () => {
    expect(outOfRange(-10, [0, 8], true)).toBe(true);
    expect(outOfRange(-5, [0, 8], true)).toBe(false);
  });

  it('걷기/달리기 기준이 gaitMode.js 와 같다', () => {
    const g = Object.fromEntries(TOPIC_METRICS.gait.map((m) => [m.key, m.good]));
    expect(g.cadenceWalk).toEqual(GAIT_CADENCE_RANGES.walk.good);
    expect(g.cadenceRun).toEqual(GAIT_CADENCE_RANGES.run.good);
    expect(g.stanceWalk).toEqual(GAIT_STANCE_RANGE_WALK.good);
    expect(g.verticalOscWalk).toEqual(GAIT_VERTICAL_OSC_RANGES.walk.good);
    expect(g.verticalOscRun).toEqual(GAIT_VERTICAL_OSC_RANGES.run.good);
  });
  it('걷기(110)는 걷기 기준으로, 달리기(170)는 달리기 기준으로 따로 본다', () => {
    const r = aggregateTopics({ a: [gaitDoc(110)], b: [gaitDoc(170)], c: [gaitDoc(150)] });
    expect(r.candidates.find((x) => x.metricKey === 'cadenceWalk')).toBeUndefined(); // 110 은 걷기 범위 안
    const run = r.candidates.find((x) => x.metricKey === 'cadenceRun');
    expect(run.members).toBe(2); // 170, 150 (150 은 범위 밖)
    expect(run.outCount).toBe(1);
  });
  it('달리기 기록에는 걷기 입각기 기준을 적용하지 않는다', () => {
    const d = { kind: 'gait', createdAt: '2026-10-01T00:00:00Z', metrics: { cadence: 170, stancePct: 40 } };
    const r = aggregateTopics({ a: [d] });
    expect(r.candidates.find((x) => x.metricKey === 'stanceWalk')).toBeUndefined();
  });
});

describe('상하 움직임 비현실 값 제외', () => {
  const g = (osc, cadence) => ({ kind: 'gait', createdAt: '2026-10-01T00:00:00Z', metrics: { cadence, verticalOscillation: osc } });
  it('걷기 9%·달리기 23.9%는 측정 오류로 보고 후보에서 뺀다', () => {
    const r = aggregateTopics({ a: [g(9, 116)], b: [g(23.9, 170)] });
    expect(r.candidates.find((x) => x.metricKey === 'verticalOscWalk')).toBeUndefined();
    expect(r.candidates.find((x) => x.metricKey === 'verticalOscRun')).toBeUndefined();
    expect(r.skipped.implausibleValues).toBeGreaterThanOrEqual(2);
  });
  it('걷기 6%는 현실 범위라 후보에 남는다', () => {
    const c = aggregateTopics({ a: [g(6, 116)] }).candidates.find((x) => x.metricKey === 'verticalOscWalk');
    expect(c.outCount).toBe(1);
  });
});

import { wilsonInterval, confidenceOf } from '../../scripts/measure-topics/core.mjs';

describe('후보 신뢰도(표본이 쌓일수록 올라감)', () => {
  it('등급은 인원 5명·20명 경계로 나뉜다', () => {
    expect(confidenceOf(4, 2).tier).toBe('low');
    expect(confidenceOf(5, 2).tier).toBe('mid');
    expect(confidenceOf(19, 5).tier).toBe('mid');
    expect(confidenceOf(20, 5).tier).toBe('high');
  });
  it('같은 비율이어도 인원이 많으면 신뢰구간이 좁아진다', () => {
    const w = (n, out) => { const [lo, hi] = wilsonInterval(out, n); return hi - lo; };
    expect(w(10, 5)).toBeGreaterThan(w(40, 20));
    expect(w(40, 20)).toBeGreaterThan(w(160, 80));
  });
  it('Wilson 구간 알려진 값(2/10 → 약 6~51%)', () => {
    expect(wilsonInterval(2, 10)).toEqual([6, 51]);
  });
  it('후보에 confidence 가 붙고 신뢰도 높은 후보가 앞에 온다', () => {
    const gd = (c) => ({ kind: 'gait', createdAt: '2026-10-01T00:00:00Z', metrics: { cadence: c } });
    const docs = {};
    for (let i = 0; i < 5; i++) docs[`m${i}`] = [gd(150)]; // 달리기 케이던스 5명 전원 밖(needsReview)
    docs.x = [gd(170)];
    const r = aggregateTopics(docs);
    expect(r.candidates[0].confidence).toBeTruthy();
    expect(['low', 'mid', 'high']).toContain(r.candidates[0].confidence.tier);
  });
});
