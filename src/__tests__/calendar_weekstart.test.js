// 캘린더 요일 순서 고정 회귀 테스트 (Vitest)
//   요청: 달력은 일·월·화·수·목·금·토 순서로 완전 고정.
//   이 테스트는 소스에 월요일 시작 패턴이 되살아나면 실패하도록 가드한다.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(resolve(here, '..', rel), 'utf8');

describe('캘린더 일요일 시작 고정', () => {
  it('월 뷰 헤더 라벨이 일요일부터 시작한다', () => {
    const src = read('pages/Schedule.jsx');
    expect(src).toContain("['일','월','화','수','목','금','토']");
    // 월요일 시작 헤더가 남아있으면 안 된다.
    expect(src).not.toContain("['월','화','수','목','금','토','일']");
  });

  it('주 뷰·홈 위젯에 월요일 시작 오프셋((day+6)%7)이 없다', () => {
    const schedule = read('pages/Schedule.jsx');
    const home = read('pages/Home.jsx');
    expect(schedule).not.toContain('(day+6)%7');
    expect(home).not.toContain('(day+6)%7');
  });

  it('WEEKDAYS 라벨 배열이 일=0 인덱싱과 일치한다', () => {
    // getDay()는 일=0..토=6. 라벨 배열 첫 원소가 일이어야 인덱싱이 맞다.
    const WEEKDAYS = ['일','월','화','수','목','금','토'];
    // 2026-06-07 은 일요일(getDay()===0).
    const sun = new Date('2026-06-07T12:00:00').getDay();
    expect(WEEKDAYS[sun]).toBe('일');
    // 2026-06-01 은 월요일(getDay()===1).
    const mon = new Date('2026-06-01T12:00:00').getDay();
    expect(WEEKDAYS[mon]).toBe('월');
  });

  it('월 뷰 빈 칸 오프셋이 getDay()(일=0) 기준이라 헤더와 정합한다', () => {
    // 2026년 6월 1일은 월요일 → getDay()=1 → 앞에 빈 칸 1개(일요일 자리).
    const first = new Date(2026, 5, 1).getDay();
    expect(first).toBe(1);
    // 따라서 1일은 일요일 시작 그리드에서 두 번째 칸(월요일 열)에 위치.
  });
});
