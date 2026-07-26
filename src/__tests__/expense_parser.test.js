// 엑셀 지출 파서(parseMatrixRows/parseFlatRows/parsePastedText) 검증
import { describe, it, expect } from 'vitest';
import { parseMatrixRows, parseFlatRows, parseSheetRows, dedupeExpenses, parsePastedText, categoryOf } from '../utils/expenseImport';

// 실제 센터 관리비 엑셀 구조를 모사:
//  분류 라벨행 → 연도 헤더행 → 1~12월 행(교차점 금액)
const matrixRows = [
  [null, '수도세+관리비', null, null, null, null, null, null, null, null, null, null, null, null],
  [null, null, null, null, '평균', 2024, 2025, 2026],            // 연도 헤더
  [null, null, null, '1월', 117400, 117400, 110000, 125000],     // 1월
  [null, null, null, '2월', 110000, 110000, 120000, 132000],     // 2월
  [null, null, null, '평균', 113700],                            // 평균행(연도 없음 → 무시)
  [null, '전기세', null, null],
  [null, null, null, null, '평균', 2024, 2025, 2026],
  [null, null, null, '1월', 286420, 286420, 342220, 414910],
  [null, '지방세', null, null],
  [null, null, null, null, '평균', 2026],                        // 연도 1개짜리 블록
  [null, null, null, '3월', null, 18850],
];

describe('categoryOf 분류 매핑', () => {
  it('관리비/전기세/원천세/지방세를 올바른 분류로', () => {
    expect(categoryOf('수도세+관리비')).toEqual({ category: '관리비', name: '수도세+관리비' });
    expect(categoryOf('전기세')).toEqual({ category: '전기세', name: '전기세' });
    expect(categoryOf('원천세')).toEqual({ category: '세금', name: '원천세' });
    expect(categoryOf('지방세')).toEqual({ category: '세금', name: '지방세' });
    expect(categoryOf('아무거나')).toBeNull();
  });
});

describe('parseMatrixRows — 월×연도 매트릭스', () => {
  const out = parseMatrixRows(matrixRows);

  it('연도×월 교차점을 모두 추출한다', () => {
    // 관리비: 1월(2024,2025,2026)+2월(2024,2025,2026)=6, 전기세 1월 3, 지방세 3월 1 = 10
    expect(out.length).toBe(10);
  });
  it('귀속월 형식이 YYYY-MM', () => {
    const jan2026 = out.find(e => e.category === '관리비' && e.ym === '2026-01');
    expect(jan2026).toBeTruthy();
    expect(jan2026.amount).toBe(125000);
    expect(jan2026.kind).toBe('monthly');
  });
  it('평균행(연도 헤더 없음)은 데이터로 잡지 않는다', () => {
    expect(out.some(e => e.amount === 113700)).toBe(false);
  });
  it('연도 1개짜리 블록(지방세 2026)도 인식', () => {
    const jibang = out.find(e => e.name === '지방세');
    expect(jibang).toEqual({ kind: 'monthly', category: '세금', name: '지방세', ym: '2026-03', amount: 18850 });
  });
  it('전기세 2026-01 금액 정확', () => {
    expect(out.find(e => e.category === '전기세' && e.ym === '2026-01').amount).toBe(414910);
  });
});

describe('parseFlatRows — 평면 표(헤더 인식)', () => {
  it('분류·항목·귀속월·금액 헤더를 인식한다', () => {
    const rows = [
      ['분류', '항목명', '귀속월', '금액'],
      ['전기세', '전기세', '2026-01', '414910'],
      ['관리비', '관리비', '2026-01', 125000],
    ];
    const out = parseFlatRows(rows);
    expect(out.length).toBe(2);
    expect(out[0]).toEqual({ kind: 'monthly', category: '전기세', name: '전기세', ym: '2026-01', amount: 414910 });
  });
  it('금액에 콤마가 있어도 숫자로 변환', () => {
    const rows = [['분류', '항목', '귀속월', '금액'], ['관리비', '관리비', '2026-01', '1,250,000']];
    expect(parseFlatRows(rows)[0].amount).toBe(1250000);
  });
});

describe('parseSheetRows — 평면 우선, 없으면 매트릭스', () => {
  it('헤더 표면 평면 파서 사용', () => {
    const rows = [['분류', '항목', '귀속월', '금액'], ['전기세', '전기세', '2026-01', 1000]];
    expect(parseSheetRows(rows).length).toBe(1);
  });
  it('헤더 없으면 매트릭스로', () => {
    expect(parseSheetRows(matrixRows).length).toBe(10);
  });
});

describe('dedupeExpenses — 중복 제거', () => {
  it('분류·항목·귀속월·금액이 모두 같으면 1건', () => {
    const list = [
      { category: '전기세', name: '전기세', ym: '2026-01', amount: 1000 },
      { category: '전기세', name: '전기세', ym: '2026-01', amount: 1000 },
      { category: '전기세', name: '전기세', ym: '2026-01', amount: 2000 },
    ];
    expect(dedupeExpenses(list).length).toBe(2);
  });
});

describe('parsePastedText — 텍스트 붙여넣기', () => {
  it('콤마 구분 표', () => {
    const out = parsePastedText('전기세, 전기세, 2026-01, 414910\n관리비, 관리비, 2026-01, 125000');
    expect(out.length).toBe(2);
    expect(out[0].ym).toBe('2026-01');
  });
  it('JSON 배열', () => {
    const out = parsePastedText('[{"category":"전기세","name":"전기세","ym":"2026-01","amount":414910}]');
    expect(out.length).toBe(1);
    expect(out[0].amount).toBe(414910);
  });
  it('귀속월·금액 없는 줄은 제외', () => {
    expect(parsePastedText('전기세\n관리비, 관리비, 2026-01, 125000').length).toBe(1);
  });
});
