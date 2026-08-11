// [다회차 측정 2026-08-11] CMJ·SJ·DJ·SLJ를 1차~3차로 나눠 측정해 평균 내는
// 기능 + SLJ가 한쪽 다리를 끝내면 자동으로 반대쪽을 제안하는 흐름 전체 테스트.
// combineJumpTrials는 순수 함수라 직접 실행(사전에 Node 프로브로 검증 완료),
// JumpAnalysisHub.jsx/JumpReportDashboard.jsx는 다른 파일들과 동일한 정적
// 소스 패턴(voice_control_timer_ui_wiring.test.js 등과 동일 컨벤션).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  combineJumpTrials,
  MULTI_TRIAL_JUMP_SUBTYPES,
  MAX_JUMP_TRIALS,
} from '../ai-measure/core/jumpBiomechanics.js';

const readSrc = (...segs) => readFileSync(join(process.cwd(), ...segs), 'utf8');

describe('MULTI_TRIAL_JUMP_SUBTYPES / MAX_JUMP_TRIALS — 상수', () => {
  it('CMJ·SJ·DJ·SLJ 4종만 다회차 대상이다(RSI는 제외 — 이미 자기 안에서 여러 사이클을 평균 냄)', () => {
    expect(MULTI_TRIAL_JUMP_SUBTYPES).toEqual(['cmj', 'sj', 'dj', 'slj']);
    expect(MULTI_TRIAL_JUMP_SUBTYPES).not.toContain('rsi');
  });

  it('최대 3회차다', () => {
    expect(MAX_JUMP_TRIALS).toBe(3);
  });
});

describe('combineJumpTrials() — power 엔진(CMJ/SJ/SLJ)', () => {
  const trials = [
    { heightCm: 38.5, takeoffVelocity: 2.75, peakPower: 3200, valid: true, member: { id: 'm1' }, measuredAt: 't1' },
    { heightCm: 41.2, takeoffVelocity: 2.85, peakPower: 3350, valid: true, member: { id: 'm1' }, measuredAt: 't2' },
    { heightCm: 39.8, takeoffVelocity: 2.80, peakPower: 3280, valid: true, member: { id: 'm1' }, measuredAt: 't3' },
  ];

  it('heightCm·takeoffVelocity·peakPower를 각각 평균 낸다', () => {
    const combined = combineJumpTrials(trials, 'power');
    expect(combined.heightCm).toBe(39.8); // (38.5+41.2+39.8)/3 = 39.833... -> 반올림 39.8
    expect(combined.takeoffVelocity).toBe(2.8);
    expect(combined.peakPower).toBe(3277); // 정수 반올림
  });

  it('trials 필드에 회차별 원본을 시간순 그대로 보존한다', () => {
    const combined = combineJumpTrials(trials, 'power');
    expect(combined.trials).toHaveLength(3);
    expect(combined.trials[0]).toEqual({ heightCm: 38.5, takeoffVelocity: 2.75, peakPower: 3200, measuredAt: 't1' });
    expect(combined.trials[2].heightCm).toBe(39.8);
  });

  it('valid·member 등 측정치가 아닌 필드는 마지막(최신) 회차 기준으로 남는다', () => {
    const combined = combineJumpTrials(trials, 'power');
    expect(combined.valid).toBe(true);
    expect(combined.member.id).toBe('m1');
    expect(combined.measuredAt).toBe('t3');
  });

  it('2회차만 있어도(3회 다 안 채우고 "여기서 마치기") 평균을 낸다', () => {
    const combined = combineJumpTrials(trials.slice(0, 2), 'power');
    expect(combined.heightCm).toBe(39.9); // (38.5+41.2)/2
    expect(combined.trials).toHaveLength(2);
  });

  it('1회차뿐이면 원본을 그대로 돌려주고 trials 필드 자체를 안 붙인다(하위호환 — 예전 리포트 화면과 100% 동일하게 보여야 함)', () => {
    const combined = combineJumpTrials([trials[0]], 'power');
    expect(combined).toEqual(trials[0]);
    expect('trials' in combined).toBe(false);
  });

  it('빈 배열이나 null이면 null(에러 없이)', () => {
    expect(combineJumpTrials([], 'power')).toBeNull();
    expect(combineJumpTrials(null, 'power')).toBeNull();
  });
});

describe('combineJumpTrials() — reactive 엔진(DJ)', () => {
  const trials = [
    { heightCm: 5, rsi: { rsi: 1.85, contactTimeMs: 210, flightTimeMs: 388, cycles: 1, grade: { label: '보통' } }, valid: true, measuredAt: 't1' },
    { heightCm: 5, rsi: { rsi: 2.05, contactTimeMs: 195, flightTimeMs: 400, cycles: 1, grade: { label: '좋음' } }, valid: true, measuredAt: 't2' },
  ];

  it('rsi.rsi·contactTimeMs·flightTimeMs를 각각 평균 낸다(rsi는 소수 둘째자리)', () => {
    const combined = combineJumpTrials(trials, 'reactive');
    expect(combined.rsi.rsi).toBe(1.95);
    expect(combined.rsi.contactTimeMs).toBe(203); // (210+195)/2 = 202.5 -> 반올림 203
    expect(combined.rsi.flightTimeMs).toBe(394);
  });

  it('rsi 하위 필드 중 평균 안 내는 것들(grade 등)은 마지막 회차 것을 그대로 남긴다', () => {
    const combined = combineJumpTrials(trials, 'reactive');
    expect(combined.rsi.grade.label).toBe('좋음');
  });

  it('회차별 원본은 rsi 숫자만 뽑아 간략하게 trials에 남긴다', () => {
    const combined = combineJumpTrials(trials, 'reactive');
    expect(combined.trials).toEqual([
      { heightCm: 5, rsi: 1.85, contactTimeMs: 210, measuredAt: 't1' },
      { heightCm: 5, rsi: 2.05, contactTimeMs: 195, measuredAt: 't2' },
    ]);
  });
});

describe('JumpAnalysisHub.jsx — 다회차(1차/2차/3차) 측정 흐름', () => {
  const src = readSrc('src', 'ai-measure', 'menus', 'JumpAnalysisHub.jsx');

  it('combineJumpTrials/MULTI_TRIAL_JUMP_SUBTYPES/MAX_JUMP_TRIALS를 core/jumpBiomechanics에서 가져온다(계산 로직 재사용, 새로 안 만듦)', () => {
    expect(src).toContain("import { combineJumpTrials, MULTI_TRIAL_JUMP_SUBTYPES, MAX_JUMP_TRIALS } from '../core/jumpBiomechanics';");
  });

  it('trials/sljFirstLegDone state가 있다', () => {
    expect(src).toContain('const [trials, setTrials] = useState([]);');
    expect(src).toContain('const [sljFirstLegDone, setSljFirstLegDone] = useState(null);');
  });

  it('RSI 등 다회차 대상이 아닌 종류는 예전과 동일하게 1회 확인 즉시 저장한다', () => {
    const start = src.indexOf('const confirmRecord = useCallback(async (record) => {');
    const end = src.indexOf('const finishNow', start);
    const body = src.slice(start, end);
    expect(body).toContain('if (!MULTI_TRIAL_JUMP_SUBTYPES.includes(jumpSubType)) {');
    expect(body).toContain("setView('report');");
  });

  it('다회차 대상은 MAX_JUMP_TRIALS 전까지 저장 안 하고 trials에 쌓기만 한다', () => {
    const start = src.indexOf('const confirmRecord = useCallback(async (record) => {');
    const end = src.indexOf('const finishNow', start);
    const body = src.slice(start, end);
    expect(body).toContain('const newTrials = [...trials, withNote];');
    expect(body).toContain('if (newTrials.length < MAX_JUMP_TRIALS) {');
    expect(body).toContain('setTrials(newTrials);');
  });

  it('MAX_JUMP_TRIALS(3회)차에 도달하면 finishTrials로 평균 내서 저장한다', () => {
    const start = src.indexOf('const confirmRecord = useCallback(async (record) => {');
    const end = src.indexOf('const finishNow', start);
    const body = src.slice(start, end);
    expect(body).toContain('await finishTrials(newTrials);');
  });

  it('finishTrials는 combineJumpTrials로 평균 낸 뒤 저장하고 trials를 비운다', () => {
    const start = src.indexOf('const finishTrials = useCallback(');
    const end = src.indexOf('}, [persist, jumpType, jumpSubType, leg, sljFirstLegDone]);', start);
    const body = src.slice(start, end);
    expect(body).toContain('combineJumpTrials(trialsArr, jumpType)');
    expect(body).toContain('await persist(combined, {});');
    expect(body).toContain('setTrials([]);');
  });

  it('SLJ이고 아직 반대쪽을 안 했으면(sljFirstLegDone===null) 곧바로 report로 안 가고 slj_other_leg 프롬프트를 먼저 보여준다', () => {
    const start = src.indexOf('const finishTrials = useCallback(');
    const end = src.indexOf('}, [persist, jumpType, jumpSubType, leg, sljFirstLegDone]);', start);
    const body = src.slice(start, end);
    expect(body).toContain("if (jumpSubType === 'slj' && sljFirstLegDone === null) {");
    expect(body).toContain('setSljFirstLegDone(leg);');
    expect(body).toContain("setView('slj_other_leg');");
  });

  it('SLJ 반대쪽까지 이미 끝낸 뒤(또는 SLJ가 아니면)는 곧바로 report로 간다', () => {
    const start = src.indexOf('const finishTrials = useCallback(');
    const end = src.indexOf('}, [persist, jumpType, jumpSubType, leg, sljFirstLegDone]);', start);
    const body = src.slice(start, end);
    expect(body).toMatch(/\} else \{\s*setView\('report'\);\s*\}/);
  });

  it('backToMeasure는 trials와 sljFirstLegDone도 함께 초기화한다(다시 측정하면 완전히 새로 시작)', () => {
    const start = src.indexOf('const backToMeasure = ()');
    const end = src.indexOf('useHardwareBack(', start);
    const body = src.slice(start, end);
    expect(body).toContain('setTrials([]);');
    expect(body).toContain('setSljFirstLegDone(null);');
  });

  it('trial_done/slj_other_leg 화면에서도 하드웨어(폰) 뒤로가기가 측정 화면으로 복귀시킨다', () => {
    const idx = src.indexOf('useHardwareBack(');
    const body = src.slice(idx, src.indexOf(');', idx));
    expect(body).toContain("view === 'trial_done'");
    expect(body).toContain("view === 'slj_other_leg'");
  });

  it("trial_done 화면 — '여기서 마치기' 버튼은 지금까지 쌓인 회차만으로 finishNow를 호출한다(3회 다 안 채워도 됨)", () => {
    const idx = src.indexOf("if (view === 'trial_done') {");
    const end = src.indexOf("if (view === 'slj_other_leg') {", idx);
    const body = src.slice(idx, end);
    expect(body).toContain('onClick={finishNow}');
    expect(body).toContain("onClick={() => setView('measure')}");
  });

  it("slj_other_leg 화면 — '반대쪽 측정하기'를 누르면 leg를 반대로 바꾸고 measure로 돌아간다", () => {
    const idx = src.indexOf("if (view === 'slj_other_leg') {");
    const end = src.indexOf("if (view === 'report' && report) {", idx);
    const body = src.slice(idx, end);
    expect(body).toContain("const otherLeg = doneLeg === 'left' ? 'right' : 'left';");
    expect(body).toContain("onClick={() => { setLeg(otherLeg); setView('measure'); }}");
  });

  it('measure 화면에서 이미 쌓인 회차가 있으면(재측정 중) 진행 상황(N/3차)을 계속 보여준다', () => {
    expect(src).toContain('{MULTI_TRIAL_JUMP_SUBTYPES.includes(jumpSubType) && trials.length > 0 && (');
    expect(src).toContain('{trials.length + 1}/{MAX_JUMP_TRIALS}차 측정 중');
  });
});

describe('JumpReportDashboard.jsx — 회차별(1차/2차/3차) 상세 내역 표시', () => {
  const src = readSrc('src', 'ai-measure', 'menus', 'JumpReportDashboard.jsx');

  it('PowerSection·RsiSection 둘 다 report.trials가 2개 이상일 때만 회차별 내역을 보여준다(1회만 측정한 예전 리포트엔 안 보여야 함)', () => {
    for (const fn of ['function PowerSection({ report }) {', 'function RsiSection({ report }) {']) {
      const start = src.indexOf(fn);
      const end = src.indexOf('\nfunction ', start + 10);
      const body = src.slice(start, end === -1 ? src.length : end);
      expect(body, `${fn}에 다회차 표시 없음`).toContain('trials.length > 1');
    }
  });

  it('동적 문자열로 grid-cols-N을 만들지 않는다(Tailwind가 인식 못 하는 문제 회귀 방지 — 반드시 정적 클래스만)', () => {
    expect(src).not.toMatch(/grid-cols-\$\{/);
    expect(src).toContain("trials.length >= 3 ? 'grid-cols-3' : 'grid-cols-2'");
  });
});
