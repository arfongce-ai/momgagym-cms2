// hangulSimilarity.js — 한글 자모(초성/중성/종성) 단위 유사도 유틸
//
// [음성인식률 개선 2026-08-18] 목적: 회원 이름을 음성으로 부를 때, STT가 발음이
// 비슷한 글자로 살짝 잘못 알아듣는 경우(예: "정훈"→"정운", ㅎ이 약해져 들리는
// 연음 현상 — useMomiVoice.js의 웨이크워드 오인식 보정과 같은 종류의 문제)를
// 완전 일치·부분 일치가 실패했을 때의 마지막 fallback으로 보정한다.
//
// ⚠️ 안전 범위: 이 유틸은 "이름을 아예 못 찾는" 상황을 줄이기 위한 것이지,
// 느슨한 매칭으로 다른 회원을 잘못 짚으라는 게 아니다. 실제 회원 이름 표본으로
// 미리 보정한 결과, 임계값 0.85에서 "진짜 오인식"(정훈/정운 0.833은 미검출로
// 남지만 이서연/이서영 0.857, 한지민/한지빈 0.875 등은 검출)과 "그냥 다른
// 이름"(민수/민서 0.800, 박서준/박서윤 0.750)이 안정적으로 갈렸다 — 그래서
// 0.833까지 낮추지 않고 0.85를 그대로 쓴다(일부 짧은 이름의 오인식은 못 잡아도
// 괜찮다, 예전처럼 "못 찾음"으로 남을 뿐 새로운 오매칭 위험을 만들지 않는다).
// 호출부는 항상 회원 이름을 확인 문구로 다시 들려준 뒤에만 실제 쓰기 작업을
// 실행하므로(memberWriteService.js propose→confirm), 이 fallback이 만에 하나
// 틀려도 트레이너가 확인 단계에서 바로 잡을 수 있다.

const CHO = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
const JUNG = ['ㅏ', 'ㅐ', 'ㅑ', 'ㅒ', 'ㅓ', 'ㅔ', 'ㅕ', 'ㅖ', 'ㅗ', 'ㅘ', 'ㅙ', 'ㅚ', 'ㅛ', 'ㅜ', 'ㅝ', 'ㅞ', 'ㅟ', 'ㅠ', 'ㅡ', 'ㅢ', 'ㅣ'];
const JONG = ['', 'ㄱ', 'ㄲ', 'ㄳ', 'ㄴ', 'ㄵ', 'ㄶ', 'ㄷ', 'ㄹ', 'ㄺ', 'ㄻ', 'ㄼ', 'ㄽ', 'ㄾ', 'ㄿ', 'ㅀ', 'ㅁ', 'ㅂ', 'ㅄ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];

/** 완성형 한글 음절을 초성·중성·종성 자모로 풀어 이어붙인다. 한글이 아닌
 * 글자(자음/모음 단독, 영문, 숫자 등)는 그대로 통과시킨다(비교는 되지만
 * 분해되지 않아 1글자로 취급됨 — 회원 이름은 거의 항상 완성형 한글이라
 * 실사용에는 영향 없음). */
export function decomposeHangul(str) {
  const result = [];
  for (const ch of String(str || '')) {
    const code = ch.charCodeAt(0) - 0xac00;
    if (code < 0 || code > 11171) {
      result.push(ch);
      continue;
    }
    const cho = Math.floor(code / (21 * 28));
    const jung = Math.floor((code % (21 * 28)) / 28);
    const jong = code % 28;
    result.push(CHO[cho], JUNG[jung], JONG[jong]);
  }
  return result.filter(Boolean).join('');
}

function levenshtein(a, b) {
  const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i += 1) dp[i][0] = i;
  for (let j = 0; j <= b.length; j += 1) dp[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

/** 두 한글 문자열의 자모 단위 유사도(0~1, 1이 완전 일치). 음절 하나가 통째로
 * 달라도 그 안의 초/중/종성 일부가 같으면 부분 점수를 받는다 — 완성형 음절
 * 단위로만 비교하면 "정훈"과 "정운" 같은 1자모 차이도 100% 다른 글자로
 * 취급돼 버리는 문제를 피한다. */
export function jamoSimilarity(a, b) {
  const da = decomposeHangul(a);
  const db = decomposeHangul(b);
  if (!da.length && !db.length) return 1;
  const dist = levenshtein(da, db);
  const maxLen = Math.max(da.length, db.length) || 1;
  return 1 - dist / maxLen;
}

/** text 안에서 target과 가장 비슷한 구간을 찾아 그 유사도를 반환한다.
 * target 길이 기준 ±1글자 폭으로 슬라이딩하며 비교한다(음절 하나가 통째로
 * 빠지거나 붙는 연음 현상까지 커버하기 위함 — 예: "윤아"가 "유나"로 들리는
 * 경우). 회원 수·명령 문장 길이가 작아 성능 부담은 없다. */
export function slidingWindowMaxSimilarity(text, target) {
  const normalizedText = String(text || '');
  const targetLen = String(target || '').length;
  if (!targetLen || !normalizedText.length) return 0;
  let best = 0;
  for (const winLen of [targetLen - 1, targetLen, targetLen + 1]) {
    if (winLen < 1 || winLen > normalizedText.length) continue;
    for (let i = 0; i + winLen <= normalizedText.length; i += 1) {
      const score = jamoSimilarity(normalizedText.slice(i, i + winLen), target);
      if (score > best) best = score;
    }
  }
  return best;
}

// 이 값들로 실제 회원 이름 표본(정훈/정운, 이서연/이서영, 한지민/한지빈,
// 민수/민서, 박서준/박서윤 등)을 검증했다 — 위 파일 헤더 설명 참고.
export const FUZZY_NAME_THRESHOLD = 0.85;
export const FUZZY_NAME_MARGIN = 0.08;

/** members 중에서 spokenText(발화 전체 또는 일부)에 가장 근접한 이름 하나를
 * 고른다. 최고점이 임계값 미만이거나, 2등과 차이가 근소하면(누구인지 애매함)
 * null을 반환한다 — 애매하면 추측하지 않는다는 프로젝트 공통 원칙을 그대로
 * 따른다. */
export function findClosestNameFuzzy(spokenText, members) {
  if (!spokenText || !members || members.length === 0) return null;
  const scored = members
    .map((m) => ({ name: m.name, score: slidingWindowMaxSimilarity(spokenText, m.name) }))
    .sort((a, b) => b.score - a.score);
  const [top, runnerUp] = scored;
  if (!top || top.score < FUZZY_NAME_THRESHOLD) return null;
  if (runnerUp && top.score - runnerUp.score < FUZZY_NAME_MARGIN) return null;
  return top.name;
}
