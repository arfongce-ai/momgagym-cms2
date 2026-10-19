import { describe, it, expect } from 'vitest';
import { aggregateTopics, topicTitle, TOPIC_METRICS, outOfRange } from '../../scripts/measure-topics/core.mjs';
import { METRIC_DEFINITIONS } from '../ai-measure/core/unifiedReport';

describe('measure-topics core', () => {
  it('인라인 기준범위가 METRIC_DEFINITIONS 와 같다(어긋남 방지)', () => {
    for (const [type, list] of Object.entries(TOPIC_METRICS)) {
      for (const m of list) {
        const def = (METRIC_DEFINITIONS[type] || []).find((d) => d.key === m.key);
        expect(def, `${type}.${m.key} 정의 없음`).toBeTruthy();
        expect(def.range.good, `${type}.${m.key} 범위`).toEqual(m.good);
      }
    }
  });

  const gaitDoc = (cadence, at = '2026-10-01T00:00:00Z') => ({ kind: 'gait', createdAt: at, metrics: { cadence } });
  const members = (values) => Object.fromEntries(values.map((v, i) => [`m${i}`, [gaitDoc(v)]]));

  it('기본은 인원 제한이 없어 1명도 그대로 집계한다', () => {
    const c = aggregateTopics(members([150])).candidates.find((x) => x.metricKey === 'cadence');
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
    const c = r.candidates.find((x) => x.metricKey === 'cadence');
    expect(c.members).toBe(6);
    expect(c.outCount).toBe(2);
    expect(c.outPct).toBe(33);
  });
  it('회원별 최신 기록 1건만 쓰고 무효 측정은 뺀다', () => {
    const docs = {};
    for (let i = 0; i < 5; i++) docs[`m${i}`] = [gaitDoc(150, '2026-01-01T00:00:00Z'), gaitDoc(170, '2026-09-01T00:00:00Z')];
    docs.bad = [{ ...gaitDoc(100), valid: false }];
    const r = aggregateTopics(docs);
    expect(r.candidates.find((x) => x.metricKey === 'cadence')).toBeUndefined(); // 5명 모두 170(범위 안) → 후보 없음
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
  it('후보에 권장범위와 중앙값이 들어간다(점검용)', () => {
    const c = aggregateTopics(members([150, 170, 175, 140, 172, 168])).candidates.find((x) => x.metricKey === 'cadence');
    expect(c.goodRange).toEqual([160, 180]);
    expect(c.median).toBe(169);
  });
  it('불가능한 측정값(반응 시간 6.5초 등)은 집계에서 뺀다', () => {
    const sp = (ms) => [{ kind: 'sprint', createdAt: '2026-10-01T00:00:00Z', reactionTimeMs: ms }];
    const r = aggregateTopics({ a: sp(6530), b: sp(300) });
    const c = r.candidates.find((x) => x.metricKey === 'reactionTime');
    expect(c.members).toBe(1); // 6530ms 는 제외, 300ms 만 집계
    expect(r.skipped.implausibleValues).toBe(1);
  });
  it('거의 전원이 범위 밖이면 기준 재확인 필요로 표시한다', () => {
    const r = aggregateTopics(members([110, 115, 120, 118])); // 4명 전원 케이던스 범위 밖
    expect(r.candidates.find((x) => x.metricKey === 'cadence').needsReview).toBe(true);
    const ok = aggregateTopics(members([150, 170, 175, 140, 172, 168])).candidates.find((x) => x.metricKey === 'cadence');
    expect(ok.needsReview).toBe(false);
    const tiny = aggregateTopics(members([110, 115])).candidates.find((x) => x.metricKey === 'cadence');
    expect(tiny.needsReview).toBe(false); // 3명 미만은 표본이 적어 판단 보류
  });
  it('outOfRange 는 절댓값 옵션을 지원한다', () => {
    expect(outOfRange(-10, [0, 8], true)).toBe(true);
    expect(outOfRange(-5, [0, 8], true)).toBe(false);
  });
});
