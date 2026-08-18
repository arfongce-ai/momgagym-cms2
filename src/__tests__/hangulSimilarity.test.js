// hangulSimilarity.test.js — 자모 유사도 fallback이 실제 발음 오인식은
// 잡으면서 "그냥 다른 이름"은 매칭하지 않는지 확인한다(민수/민서 사례 등).
import { describe, it, expect } from 'vitest';
import {
  decomposeHangul,
  jamoSimilarity,
  slidingWindowMaxSimilarity,
  findClosestNameFuzzy,
  FUZZY_NAME_THRESHOLD,
} from '../utils/hangulSimilarity';

describe('decomposeHangul', () => {
  it('완성형 음절을 초성·중성·종성으로 정확히 분해한다', () => {
    expect(decomposeHangul('정')).toBe('ㅈㅓㅇ');
    expect(decomposeHangul('훈')).toBe('ㅎㅜㄴ');
    expect(decomposeHangul('이')).toBe('ㅇㅣ'); // 종성 없음 → 2글자만
  });

  it('한글이 아닌 문자는 그대로 통과시킨다(깨지지 않음)', () => {
    expect(decomposeHangul('A1')).toBe('A1');
  });
});

describe('jamoSimilarity — 완전 일치·완전 무관', () => {
  it('동일 문자열은 1.0', () => {
    expect(jamoSimilarity('김철수', '김철수')).toBe(1);
  });

  it('자모가 거의 안 겹치는 무관한 문자열은 낮은 점수', () => {
    expect(jamoSimilarity('박영희', '회원리')).toBeLessThan(FUZZY_NAME_THRESHOLD);
  });
});

describe('jamoSimilarity — 실제 발음 오인식 후보(임계값 이상이어야 함)', () => {
  // useMomiVoice.js 웨이크워드 보정과 같은 종류의 문제(ㅎ 약화, 순음 혼동,
  // 연음으로 인한 음절 경계 이동)를 이름에도 동일하게 적용한 사례들.
  it.each([
    ['이서연', '이서영'],
    ['한지민', '한지빈'],
    ['오세훈', '오세운'],
    ['최윤아', '최유나'],
  ])('%s ↔ %s 는 임계값(%s) 이상', (a, b) => {
    expect(jamoSimilarity(a, b)).toBeGreaterThanOrEqual(FUZZY_NAME_THRESHOLD);
  });
});

describe('jamoSimilarity — 진짜 다른 이름(임계값 미만이어야 함, 오매칭 방지)', () => {
  it.each([
    ['민수', '민서'],
    ['지민', '지현'],
    ['현우', '지우'],
    ['박서준', '박서윤'],
    ['김민재', '김민서'],
  ])('%s ↔ %s 는 임계값 미만(서로 다른 회원으로 다뤄야 함)', (a, b) => {
    expect(jamoSimilarity(a, b)).toBeLessThan(FUZZY_NAME_THRESHOLD);
  });
});

describe('slidingWindowMaxSimilarity — 문장 속에서 이름 구간 찾기', () => {
  it('문장 안에 정확히 포함된 이름은 1.0', () => {
    expect(slidingWindowMaxSimilarity('김철수님 세션 추가해줘', '김철수')).toBe(1);
  });

  it('음절 하나가 오인식된 이름도 높은 점수(±1글자 폭 탐색)', () => {
    expect(slidingWindowMaxSimilarity('한지빈님 세션 추가해줘', '한지민')).toBeGreaterThanOrEqual(FUZZY_NAME_THRESHOLD);
  });

  it('이름이 전혀 안 나오는 문장은 낮은 점수', () => {
    expect(slidingWindowMaxSimilarity('오늘 날씨 어때요', '김철수')).toBeLessThan(FUZZY_NAME_THRESHOLD);
  });
});

describe('findClosestNameFuzzy — 회원 목록에서 가장 근접한 이름 하나 고르기', () => {
  const members = [{ name: '한지민' }, { name: '김철수' }, { name: '박영희' }];

  it('발음이 살짝 다르게 들린 경우 올바른 회원을 찾는다', () => {
    expect(findClosestNameFuzzy('한지빈님 세션 추가해줘', members)).toBe('한지민');
  });

  it('전혀 다른 이름이 언급되면 null(추측하지 않음)', () => {
    expect(findClosestNameFuzzy('강성심님 세션 추가해줘', members)).toBeNull();
  });

  it('회원 목록이 비어있으면 null', () => {
    expect(findClosestNameFuzzy('한지빈님 세션 추가해줘', [])).toBeNull();
  });

  it('명단에 정확히 일치하는 후보가 있으면 근접한 다른 후보보다 확실히 우선한다', () => {
    // 한지민(발음상 근접)이 같이 있어도, 정확히 일치하는 한지빈이 margin
    // 이상 차이로 앞서므로 안전하게 한지빈을 고른다(둘 중 아무거나 찍는 게
    // 아니라 점수 차이로 확실할 때만 채택함을 함께 확인).
    const both = [{ name: '한지민' }, { name: '한지빈' }];
    expect(findClosestNameFuzzy('한지빈님 세션 추가해줘', both)).toBe('한지빈');
  });
});
