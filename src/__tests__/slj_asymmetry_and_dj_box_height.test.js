// [SLJ 좌우 비대칭 + DJ 박스높이 2026-08-11]
// jump_types.test.js/jump_biomechanics.test.js와 같은 컨벤션.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { computeLegAsymmetry, findSljAsymmetry } from '../ai-measure/core/jumpBiomechanics.js';
import { LEG_LABEL } from '../ai-measure/core/jumpTypes.js';

const readSrc = (...segs) => readFileSync(join(process.cwd(), ...segs), 'utf8');

// ════════════════════════════════════════════════════════════════════════
// computeLegAsymmetry — LSI(대칭지수) 순수 계산
// ════════════════════════════════════════════════════════════════════════
describe('computeLegAsymmetry — LSI(대칭지수) 계산', () => {
  it('완전히 같으면 100%, weakerSide는 관례상 left', () => {
    const r = computeLegAsymmetry({ leftValue: 30, rightValue: 30 });
    expect(r.lsiPct).toBe(100);
    expect(r.weakerSide).toBe('left');
  });

  it('왼쪽이 약하면(25 vs 30) 약한쪽÷강한쪽×100, weakerSide=left', () => {
    const r = computeLegAsymmetry({ leftValue: 25, rightValue: 30 });
    expect(r.lsiPct).toBe(83.3);
    expect(r.weakerSide).toBe('left');
  });

  it('오른쪽이 약하면(30 vs 24) weakerSide=right', () => {
    const r = computeLegAsymmetry({ leftValue: 30, rightValue: 24 });
    expect(r.lsiPct).toBe(80);
    expect(r.weakerSide).toBe('right');
  });

  it('문자열 숫자도 처리한다(Number 변환)', () => {
    const r = computeLegAsymmetry({ leftValue: '28', rightValue: '30' });
    expect(r.lsiPct).toBe(93.3);
    expect(r.leftValue).toBe(28);
    expect(r.rightValue).toBe(30);
  });

  it('0이나 음수, null/undefined는 비교 불가로 null(억지로 계산하지 않음)', () => {
    expect(computeLegAsymmetry({ leftValue: 0, rightValue: 30 })).toBeNull();
    expect(computeLegAsymmetry({ leftValue: -5, rightValue: 30 })).toBeNull();
    expect(computeLegAsymmetry({ leftValue: null, rightValue: 30 })).toBeNull();
    expect(computeLegAsymmetry({ leftValue: 30, rightValue: undefined })).toBeNull();
    expect(computeLegAsymmetry({ leftValue: 'abc', rightValue: 30 })).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════════
// findSljAsymmetry — 리포트 목록에서 반대쪽 다리 최신 기록 탐색 + 계산
// ════════════════════════════════════════════════════════════════════════
describe('findSljAsymmetry — 반대쪽 다리 최신 유효 기록 탐색', () => {
  const currentReport = { id: 'cur1', kind: 'jump', jumpSubType: 'slj', leg: 'left', heightCm: 28 };

  it('반대쪽(right) 기록이 있으면 LSI를 계산해 돌려준다', () => {
    const reports = [
      currentReport,
      { id: 'r1', kind: 'jump', jumpSubType: 'slj', leg: 'right', heightCm: 30, createdAt: '2026-08-01', valid: true },
    ];
    const result = findSljAsymmetry({ reports, currentReport });
    expect(result).not.toBeNull();
    expect(result.leftValue).toBe(28);
    expect(result.rightValue).toBe(30);
    expect(result.otherReportId).toBe('r1');
  });

  it('반대쪽 기록이 여러 개면 가장 최근 것을 쓴다', () => {
    const reports = [
      currentReport,
      { id: 'old', kind: 'jump', jumpSubType: 'slj', leg: 'right', heightCm: 20, createdAt: '2026-01-01' },
      { id: 'new', kind: 'jump', jumpSubType: 'slj', leg: 'right', heightCm: 32, createdAt: '2026-08-05' },
    ];
    const result = findSljAsymmetry({ reports, currentReport });
    expect(result.rightValue).toBe(32);
    expect(result.otherReportId).toBe('new');
  });

  it('반대쪽 기록이 없으면 null(비교 불가 — 오류 아님)', () => {
    const reports = [currentReport, { id: 'r2', kind: 'jump', jumpSubType: 'slj', leg: 'left', heightCm: 29 }];
    expect(findSljAsymmetry({ reports, currentReport })).toBeNull();
  });

  it('같은 회원이라도 kind가 jump가 아니면(예: gait) 무시한다', () => {
    const reports = [currentReport, { id: 'g1', kind: 'gait', leg: 'right', heightCm: 30 }];
    expect(findSljAsymmetry({ reports, currentReport })).toBeNull();
  });

  it('jump이지만 SLJ가 아니면(예: CMJ) 무시한다', () => {
    const reports = [currentReport, { id: 'c1', kind: 'jump', jumpSubType: 'cmj', leg: 'right', heightCm: 30 }];
    expect(findSljAsymmetry({ reports, currentReport })).toBeNull();
  });

  it('무효 측정(valid:false)은 후보에서 제외한다', () => {
    const reports = [
      currentReport,
      { id: 'invalid', kind: 'jump', jumpSubType: 'slj', leg: 'right', heightCm: 30, valid: false, createdAt: '2026-08-05' },
    ];
    expect(findSljAsymmetry({ reports, currentReport })).toBeNull();
  });

  it('자기 자신(같은 id)은 후보에서 제외한다(회귀 방지)', () => {
    // 데이터 이상으로 자기 자신이 반대쪽 leg로 잘못 들어있어도 걸러야 한다.
    const reports = [currentReport, { ...currentReport, leg: 'right' }];
    expect(findSljAsymmetry({ reports, currentReport })).toBeNull();
  });

  it('jumpSubType 필드가 없는 과거 데이터도 resolveJumpSubType로 안전하게 판정한다', () => {
    // 과거 데이터는 jumpSubType이 없을 수 있음(jumpTypes.js resolveJumpSubType 하위호환).
    // leg 필드가 있다는 것 자체가 이미 SLJ였다는 신호이므로, jumpSubType 없이
    // 저장된 아주 오래된 SLJ 기록도 여전히 비교 후보가 되어야 한다.
    // (resolveJumpSubType은 jumpSubType 없으면 rsi 유무로만 cmj/rsi를 추론하므로
    //  실제로는 'cmj'로 판정된다 — 이 케이스는 그래서 매칭 안 되는 게 맞다.
    //  이 테스트는 그 사실 자체를 문서화한다.)
    const reports = [currentReport, { id: 'legacy', kind: 'jump', leg: 'right', heightCm: 30, createdAt: '2025-01-01' }];
    expect(findSljAsymmetry({ reports, currentReport })).toBeNull();
  });

  it('currentReport에 leg가 없으면(SLJ 아님) 애초에 null', () => {
    expect(findSljAsymmetry({ reports: [], currentReport: { id: 'x', heightCm: 30 } })).toBeNull();
  });

  it('currentReport에 heightCm이 없으면(무효 측정) null', () => {
    expect(findSljAsymmetry({ reports: [], currentReport: { id: 'x', leg: 'left' } })).toBeNull();
  });

  it('reports가 없거나(undefined) 빈 배열이어도 에러 없이 null', () => {
    expect(findSljAsymmetry({ reports: undefined, currentReport })).toBeNull();
    expect(findSljAsymmetry({ reports: [], currentReport })).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════════
// LEG_LABEL 공용 상수
// ════════════════════════════════════════════════════════════════════════
describe('LEG_LABEL — 공용 다리 라벨', () => {
  it('left/right 라벨이 정확하다', () => {
    expect(LEG_LABEL).toEqual({ left: '왼발', right: '오른발' });
  });
});

// ════════════════════════════════════════════════════════════════════════
// JumpAnalysisHub.jsx — DJ 박스높이 입력 배선 (정적 소스 패턴)
// ════════════════════════════════════════════════════════════════════════
describe('JumpAnalysisHub.jsx — DJ 박스높이 입력 배선', () => {
  const src = readSrc('src', 'ai-measure', 'menus', 'JumpAnalysisHub.jsx');

  it('boxHeightCm state가 있다', () => {
    expect(src).toContain("const [boxHeightCm, setBoxHeightCm] = useState('');");
  });

  it('DJ일 때만 record 화면에 입력칸이 뜬다(다른 종류에서는 안 보임)', () => {
    const idx = src.indexOf("jumpSubType === 'dj' && (");
    expect(idx).toBeGreaterThan(-1);
    const end = src.indexOf('<MeasureRecordConfirm', idx);
    const body = src.slice(idx, end);
    expect(body).toContain('박스 높이');
    expect(body).toContain('onChange={(e) => setBoxHeightCm(e.target.value)}');
  });

  it('persist()가 DJ일 때만, 값이 양수일 때만 boxHeightCm을 report에 싣는다(빈 값이면 필드 자체를 안 만듦)', () => {
    const start = src.indexOf('const persist = useCallback(async');
    const end = src.indexOf('}, [save, jumpSubType, leg, boxHeightCm]);', start);
    const body = src.slice(start, end);
    expect(body).toContain("jumpSubType === 'dj' && boxHeightCm !== '' && Number(boxHeightCm) > 0");
    expect(body).toContain('{ boxHeightCm: Number(boxHeightCm) }');
  });

  it('persist useCallback의 deps 배열에 boxHeightCm이 들어있다(stale closure 방지)', () => {
    expect(src).toContain('}, [save, jumpSubType, leg, boxHeightCm]);');
  });

  it('SLJ 다리 선택 버튼은 하드코딩 라벨이 아니라 공용 LEG_LABEL을 쓴다(라벨 이중관리 회귀 방지)', () => {
    expect(src).toContain("[['left', LEG_LABEL.left], ['right', LEG_LABEL.right]]");
    expect(src).not.toContain("[['left', '왼발'], ['right', '오른발']]");
  });
});

// ════════════════════════════════════════════════════════════════════════
// JumpReportDashboard.jsx — 비대칭 비교 + 박스높이 표시 배선 (정적 소스 패턴)
// ════════════════════════════════════════════════════════════════════════
describe('JumpReportDashboard.jsx — SLJ 비대칭·DJ 박스높이 표시 배선', () => {
  const src = readSrc('src', 'ai-measure', 'menus', 'JumpReportDashboard.jsx');

  it('findSljAsymmetry를 core/jumpBiomechanics.js에서 가져와 쓴다(재계산 로직을 화면에 새로 안 만듦)', () => {
    expect(src).toContain('findSljAsymmetry');
    expect(src).toMatch(/from ['"]\.\.\/core\/jumpBiomechanics['"]/);
  });

  it('aiStore.ensureGaitReports로 회원의 리포트 목록을 가져온 뒤에만 계산한다(직접 계산하지 않고 순수함수에 위임)', () => {
    const idx = src.indexOf('async function load() {');
    const end = src.indexOf('load();', idx);
    const body = src.slice(idx, end);
    expect(body).toContain('aiStore.ensureGaitReports(resolvedMember.id)');
    expect(body).toContain('findSljAsymmetry({ reports, currentReport: report })');
  });

  it('가상회원(isVirtual)은 비대칭 조회를 건너뛴다(실제 저장 회원이 아니므로)', () => {
    const idx = src.indexOf('async function load() {');
    const end = src.indexOf('load();', idx);
    const body = src.slice(idx, end);
    expect(body).toContain('resolvedMember?.isVirtual');
  });

  it('SLJ가 아니면 AsymmetrySection을 아예 렌더하지 않는다', () => {
    expect(src).toContain("{jumpSubType === 'slj' && <AsymmetrySection asymmetry={asymmetry} report={report} />}");
  });

  it('AsymmetrySection은 비교 대상이 없을 때도(asymmetry:null) 섹션 자체를 숨기지 않고 안내 문구를 보여준다', () => {
    const start = src.indexOf('function AsymmetrySection(');
    const end = src.indexOf('\nfunction PowerSection', start);
    const body = src.slice(start, end);
    expect(body).toContain('if (!asymmetry) {');
    expect(body).toContain('아직 없어요');
  });

  it('LSI 상태 색상은 기존 status()·RANGE.lsi 헬퍼를 재사용한다(새 판정 로직 안 만듦)', () => {
    expect(src).toContain('lsi: { good: [90, 100], warn: [80, 100], unit: \'%\' }');
    const start = src.indexOf('function AsymmetrySection(');
    const end = src.indexOf('\nfunction PowerSection', start);
    const body = src.slice(start, end);
    expect(body).toContain('status(asymmetry.lsiPct, RANGE.lsi)');
  });

  it('DJ 박스높이는 report.boxHeightCm이 있을 때만 RsiSection에 표시된다', () => {
    const start = src.indexOf('function RsiSection(');
    const end = src.indexOf('\nfunction Mini', start);
    const body = src.slice(start, end);
    expect(body).toContain('report.boxHeightCm != null');
    expect(body).toContain('박스 높이');
  });
});
