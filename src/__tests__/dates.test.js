// dates.test.js — CV-A 시간대 버그 회귀 테스트
// "새벽 0~9시에 어제 날짜로 기록되던" UTC 버그가 재발하지 않도록 보호한다.
import { describe, it, expect } from 'vitest';
import { toYMD, todayYMD, thisYM, daysAgoYMD } from '../utils/dates';
import { monthKey, yearKey } from '../services/finance';

describe('날짜 유틸 (로컬 시간 기준 — UTC 버그 수정)', () => {
  it('toYMD: 날짜 문자열은 그대로 보존한다 (UTC 재해석 금지)', () => {
    expect(toYMD('2026-06-01')).toBe('2026-06-01');
    expect(toYMD('2026-12-31')).toBe('2026-12-31');
    expect(toYMD('2026-06-01T23:30:00')).toBe('2026-06-01');
  });

  it('toYMD: Date 객체는 로컬 연/월/일을 사용한다', () => {
    // 로컬 자정 직후 — toISOString()이라면 시간대에 따라 어제로 밀리지만,
    // toYMD는 로컬 구성요소(getFullYear 등)를 쓰므로 항상 같은 날이어야 한다.
    const d = new Date(2026, 5, 1, 0, 30); // 2026-06-01 00:30 로컬
    expect(toYMD(d)).toBe('2026-06-01');
    const d2 = new Date(2026, 0, 1, 7, 0); // 2026-01-01 07:00 로컬 (연초 새벽)
    expect(toYMD(d2)).toBe('2026-01-01');
  });

  it('todayYMD/thisYM: 로컬 현재 시각과 일치한다', () => {
    const now = new Date();
    const expected = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
    expect(todayYMD()).toBe(expected);
    expect(thisYM()).toBe(expected.slice(0,7));
  });

  it('daysAgoYMD: n일 전 로컬 날짜를 반환한다', () => {
    const d = new Date(); d.setDate(d.getDate() - 365);
    const expected = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    expect(daysAgoYMD(365)).toBe(expected);
  });

  it('monthKey/yearKey: 결제일 문자열의 달/연도가 밀리지 않는다', () => {
    expect(monthKey('2026-06-01')).toBe('2026-06');
    expect(monthKey('2026-12-31')).toBe('2026-12');
    expect(yearKey('2026-01-01')).toBe('2026');
    // Date 객체(로컬 자정 직후)도 같은 달이어야 한다
    expect(monthKey(new Date(2026, 5, 1, 0, 10))).toBe('2026-06');
  });
});
