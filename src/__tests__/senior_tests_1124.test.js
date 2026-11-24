// 2026-11-24 시니어 기능 테스트(30초 의자·5회 의자·TUG) — 규준·무효·저장 레코드·자동 카운터·종합분석 분류
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  chair30Cutoff, sts5Cutoff, evaluateSeniorTest, seniorPrecheck, buildSeniorRecord, seniorChange, seniorHistoryMetrics,
} from '../ai-measure/core/seniorTests';
import { createSeniorAutoCounter, sitStandSignal } from '../ai-measure/core/seniorAutoCounter';
import { subtypeOf } from '../ai-measure/core/measureSubtype';
import { inferReportType } from '../ai-measure/core/unifiedReport';
import { menuGroupKey } from '../services/reportService';
import { MEASURE_MENUS } from '../ai-measure/registry';
import { matchRuleBasedSubKind } from '../services/voiceCommandService';

describe('시니어 규준', () => {
  it('CDC 30초 의자: 나이·성별 경계', () => {
    expect(chair30Cutoff(62, 'male').below).toBe(14);
    expect(chair30Cutoff(62, '여').below).toBe(12);
    expect(chair30Cutoff(94, 'female').below).toBe(4);
    expect(chair30Cutoff(59, 'male')).toBeNull();
    expect(chair30Cutoff(70, '')).toBeNull();
  });
  it('30초 의자 판정: 미만이면 caution, 이상이면 normal', () => {
    expect(evaluateSeniorTest('chair30', 11, { age: 72, sex: 'male' }).status).toBe('caution'); // 70~74 남 12 미만
    expect(evaluateSeniorTest('chair30', 12, { age: 72, sex: 'male' }).status).toBe('normal');
  });
  it('팔 사용 → 0회 무효지만 값은 그대로 저장 가능', () => {
    const e = evaluateSeniorTest('chair30', 0, { age: 72, sex: 'male', armsUsed: true });
    expect(e.status).toBe('unknown'); expect(e.valid).toBe(false);
    const rec = buildSeniorRecord({ testId: 'chair30', value: 0, armsUsed: true, subject: { age: 72, sex: 'male' } });
    expect(rec.kind).toBe('senior_test'); expect(rec.value).toBe(0); expect(rec.valid).toBe(false);
  });
  it('5회 일어서기 Bohannon', () => {
    expect(sts5Cutoff(65).over).toBe(11.4);
    expect(sts5Cutoff(75).over).toBe(12.6);
    expect(sts5Cutoff(85).over).toBe(14.8);
    expect(sts5Cutoff(90)).toBeNull();
    expect(evaluateSeniorTest('sts5', 12, { age: 65 }).status).toBe('caution');
    expect(evaluateSeniorTest('sts5', 11, { age: 65 }).status).toBe('normal');
    expect(evaluateSeniorTest('sts5', 20, { age: 92 }).status).toBe('unknown');
    expect(evaluateSeniorTest('sts5', 9, { age: 65, completed: false }).valid).toBe(false);
  });
  it('TUG 12초', () => {
    expect(evaluateSeniorTest('tug', 11.9, {}).status).toBe('normal');
    expect(evaluateSeniorTest('tug', 12, {}).status).toBe('caution');
  });
  it('측정 전 안전 확인(혈압·통증·어지럼)', () => {
    expect(seniorPrecheck({ systolic: 130, diastolic: 80 }).ok).toBe(true);
    // ACSM 운동검사 기준: 수축기 200 초과 또는 이완기 110 초과일 때만 보류(정확히 200/110은 보류 아님)
    expect(seniorPrecheck({ systolic: 200, diastolic: 110 }).ok).toBe(true);
    expect(seniorPrecheck({ systolic: 201, diastolic: 80 }).ok).toBe(false);
    expect(seniorPrecheck({ systolic: 130, diastolic: 111 }).ok).toBe(false);
    // 180/120(고혈압 위기 수치) 이상이면 보류는 아니고 알림
    const n = seniorPrecheck({ systolic: 185, diastolic: 80 });
    expect(n.ok).toBe(true); expect(n.level).toBe('notice');
    expect(seniorPrecheck({ systolic: '', diastolic: '' }).level).toBe('ok');
    expect(seniorPrecheck({ dizzy: true }).ok).toBe(false);
  });
  it('직전 대비 변화: 같은 테스트·유효 기록만', () => {
    const a = buildSeniorRecord({ testId: 'tug', value: 10, subject: { age: 70 } });
    const b = buildSeniorRecord({ testId: 'tug', value: 12, subject: { age: 70 } });
    expect(seniorChange(a, b).direction).toBe('improved');
    expect(seniorChange(a, buildSeniorRecord({ testId: 'chair30', value: 12 }))).toBeNull();
    expect(seniorHistoryMetrics(a).some((m) => m.key === 'value')).toBe(true);
  });
});

// 앉음: 무릎이 엉덩이와 거의 같은 높이, 섬: 무릎이 엉덩이보다 몸통 길이만큼 아래
function pose(s, hipX = 0.5) {
  const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 1 }));
  const hipY = 0.5; const torso = 0.25;
  [11, 12].forEach((i) => { lm[i] = { x: hipX, y: hipY - torso, visibility: 1 }; });
  [23, 24].forEach((i) => { lm[i] = { x: hipX, y: hipY, visibility: 1 }; });
  [25, 26].forEach((i) => { lm[i] = { x: hipX, y: hipY + s * torso, visibility: 1 }; });
  return lm;
}
describe('자동 카운터', () => {
  it('앉았다 섰다를 1회로 센다(히스테리시스·최소 간격)', () => {
    const c = createSeniorAutoCounter({ testId: 'chair30', smoothing: 1 });
    let t = 0; let last;
    const feed = (s) => { t += 100; last = c.push(pose(s), t); };
    for (let i = 0; i < 5; i += 1) feed(0.1);
    for (let k = 0; k < 3; k += 1) {
      for (let i = 0; i < 8; i += 1) feed(0.9); // 섬
      for (let i = 0; i < 8; i += 1) feed(0.1); // 앉음
    }
    expect(last.count).toBe(3);
  });
  it('중간값(0.5) 떨림은 세지 않는다', () => {
    const c = createSeniorAutoCounter({ testId: 'chair30', smoothing: 1 });
    let t = 0; let last;
    for (let i = 0; i < 40; i += 1) { t += 100; last = c.push(pose(i % 2 ? 0.45 : 0.55), t); }
    expect(last.count).toBe(0);
  });
  it('몸이 안 잡히면 세지 않는다', () => {
    expect(sitStandSignal(null)).toBeNull();
    const c = createSeniorAutoCounter({ testId: 'chair30' });
    expect(c.push(null, 100).tracked).toBe(false);
  });
  it('5회 완료 시 finished, TUG는 걷고 다시 앉으면 finished', () => {
    const c5 = createSeniorAutoCounter({ testId: 'sts5', smoothing: 1, targetReps: 5 });
    let t = 0; let last;
    for (let i = 0; i < 3; i += 1) { t += 100; c5.push(pose(0.1), t); }
    for (let k = 0; k < 5; k += 1) {
      for (let i = 0; i < 8; i += 1) { t += 100; last = c5.push(pose(0.9), t); }
      for (let i = 0; i < 8; i += 1) { t += 100; last = c5.push(pose(0.1), t); }
    }
    expect(last.finished).toBe(true);
    const tug = createSeniorAutoCounter({ testId: 'tug', smoothing: 1 });
    t = 0;
    for (let i = 0; i < 3; i += 1) { t += 100; tug.push(pose(0.1, 0.3), t); }
    for (let i = 0; i < 40; i += 1) { t += 100; last = tug.push(pose(0.9, 0.3 + i * 0.01), t); }
    for (let i = 0; i < 10; i += 1) { t += 100; last = tug.push(pose(0.1, 0.3), t); }
    expect(last.finished).toBe(true);
    expect(last.elapsedSec).toBeGreaterThan(3);
  });
});

describe('종합분석 분류·등록', () => {
  it('subtypeOf: 테스트별로 분리', () => {
    expect(subtypeOf('senior', { testId: 'tug', testLabel: 'TUG (일어나 걷기)' }).key).toBe('tug');
    expect(subtypeOf('senior', { testId: 'chair30' }).label).toBe('30초 의자 일어서기');
    expect(subtypeOf('senior', {}).key).toBe('');
  });
  it('통합 리포트 유형·그룹 키', () => {
    expect(inferReportType({ menu: 'senior', data: { kind: 'senior_test', testId: 'tug' } })).toBe('senior');
    expect(menuGroupKey({ menu: 'senior', data: { testId: 'sts5' } })).toBe('senior_sts5');
  });
  it('메뉴 등록: senior 13번, 도구는 14~17번', () => {
    const m = Object.fromEntries(MEASURE_MENUS.map((x) => [x.id, x.no]));
    expect(m.senior).toBe(13); expect(m.compare).toBe(14); expect(m.timer).toBe(17);
  });
  it('음성 키워드', () => {
    expect(matchRuleBasedSubKind('ai_measure', '시니어 테스트 열어줘')).toBe('senior');
    expect(matchRuleBasedSubKind('ai_measure', '의자 일어서기 측정')).toBe('senior');
  });
});

describe('2026-11-25 시니어 카메라 화면·컨디션 버튼', () => {
  const read = (p) => readFileSync(p, 'utf8');
  it('자동 카운트는 기존 방식과 같은 CameraStage 전체화면 + 스켈레톤 토글을 쓴다', () => {
    const src = read('src/ai-measure/menus/SeniorTestMeasure.jsx');
    expect(src).toContain("import CameraStage from './CameraStage.jsx'");
    expect(src).toContain('showSkeletonToggle');
    expect(src).toContain('isSkeletonEnabled');
    expect(src).toContain('senior-track-status');
    expect(src).not.toContain('senior-preview-video');
  });
  it('신체정보 피로도·통증 NRS 도 PRS 처럼 버튼으로 고른다', () => {
    const src = read('src/ai-measure/menus/BodyInfoMeasure.jsx');
    expect(src).toContain('data-testid={`fatigue-${n}`}');
    expect(src).toContain('data-testid={`pain-${n}`}');
    expect(src).not.toContain('placeholder="1~5"');
  });
});
