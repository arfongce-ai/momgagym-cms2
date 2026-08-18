import { buildProblemFocus } from './crossMeasureContext';

export const TEST_RECOMMENDATION_VERSION = 'member-test-v1';

export const RECOMMENDABLE_TESTS = [
  { id: 'body', title: '신체 정보' },
  { id: 'posture', title: '자세·체형 측정' },
  { id: 'rom', title: 'ROM 좌우 비교' },
  { id: 'gait', title: '보행 & 러닝' },
  { id: 'jump', title: '점프 & RSI' },
  { id: 'lifting', title: '바벨 리프팅' },
  { id: 'stance', title: '한다리서기 (SLST)' },
  { id: 'squat', title: '오버헤드 딥 스쿼트' },
];

const COMPLEMENTS = {
  posture: ['rom', 'squat', 'stance'],
  rom: ['squat', 'gait', 'stance'],
  gait: ['rom', 'stance', 'squat'],
  jump: ['rom', 'stance', 'squat'],
  lifting: ['rom', 'squat'],
  stance: ['gait', 'rom', 'squat'],
  squat: ['rom', 'stance', 'gait'],
};

const GOAL_SIGNALS = [
  { words: ['러닝', '달리기', '마라톤', '보행'], tests: ['gait', 'rom', 'stance'], label: '러닝·보행 목적' },
  { words: ['근력', '웨이트', '바벨', '파워리프팅', '역도'], tests: ['lifting', 'squat', 'rom'], label: '근력 향상 목적' },
  { words: ['점프', '순발력', '민첩성', '스포츠', '선수'], tests: ['jump', 'stance', 'squat'], label: '스포츠 수행 목적' },
  { words: ['체형', '자세', '교정', '재활'], tests: ['posture', 'rom', 'squat'], label: '자세·기능 개선 목적' },
  { words: ['시니어', '노인', '낙상', '균형'], tests: ['stance', 'gait', 'rom'], label: '균형·낙상 예방 목적' },
];

const DAY = 24 * 60 * 60 * 1000;

function dateValue(value) {
  if (!value) return 0;
  if (typeof value?.toDate === 'function') return value.toDate().getTime();
  if (typeof value?.seconds === 'number') return value.seconds * 1000;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function reportDate(report) {
  return dateValue(report?.createdAt || report?.measuredAt || report?.recordedAtFull || report?.recordedAt || report?.basic_info?.createdAt);
}

function latest(list = []) {
  return [...list].filter(Boolean).sort((a, b) => reportDate(b) - reportDate(a))[0] || null;
}

function ageOf(member, now) {
  const born = member?.birthDate && new Date(member.birthDate);
  if (!born || Number.isNaN(born.getTime())) return null;
  let age = now.getFullYear() - born.getFullYear();
  const beforeBirthday = now.getMonth() < born.getMonth()
    || (now.getMonth() === born.getMonth() && now.getDate() < born.getDate());
  if (beforeBirthday) age -= 1;
  return age;
}

function addReason(candidate, points, reason) {
  candidate.score += points;
  if (reason && !candidate.reasons.includes(reason)) candidate.reasons.push(reason);
}

function memberGoalText(member) {
  return [member?.category, member?.goal, member?.purpose, ...(member?.classTypes || [])]
    .filter(Boolean)
    .join(' ');
}

function conditionSafety(bodyRecords, now) {
  const recent = latest((bodyRecords || []).filter((record) => {
    const at = reportDate(record);
    return at > 0 && (now.getTime() - at) <= 14 * DAY;
  }));
  const pain = recent?.painNrs === '' || recent?.painNrs == null ? null : Number(recent.painNrs);
  const fatigue = recent?.fatigue === '' || recent?.fatigue == null ? null : Number(recent.fatigue);
  return {
    record: recent,
    pain: Number.isFinite(pain) ? pain : null,
    fatigue: Number.isFinite(fatigue) ? fatigue : null,
  };
}

/**
 * 회원의 저장 데이터만 사용해 다음 측정 후보를 순위화한다.
 * 안전 판정은 점수보다 우선하며, 모미가 이 결과를 임의로 변경하지 않는 계약이다.
 */
export function buildMemberTestRecommendations({
  member,
  bodyRecords = [],
  reportsByKind = {},
  now = new Date(),
} = {}) {
  if (!member?.id) return null;

  const candidates = Object.fromEntries(RECOMMENDABLE_TESTS.map((test) => [test.id, {
    ...test,
    score: 40,
    safety: 'allowed',
    reasons: [],
    safetyReasons: [],
    lastMeasuredAt: null,
  }]));

  const latestByKind = {};
  RECOMMENDABLE_TESTS.forEach(({ id }) => {
    const report = latest(reportsByKind[id] || []);
    latestByKind[id] = report;
    const measured = reportDate(report);
    if (!measured) {
      addReason(candidates[id], 25, '아직 저장된 측정 기록이 없습니다.');
      return;
    }
    candidates[id].lastMeasuredAt = new Date(measured).toISOString();
    const days = Math.max(0, Math.floor((now.getTime() - measured) / DAY));
    if (days >= 90) addReason(candidates[id], 20, `마지막 측정 후 ${days}일이 지났습니다.`);
    else if (days >= 30) addReason(candidates[id], 10, `마지막 측정 후 ${days}일이 지났습니다.`);
    else if (days <= 13) addReason(candidates[id], -18, `최근 ${days === 0 ? '오늘' : `${days}일 전`} 측정해 중복 우선순위를 낮췄습니다.`);
  });

  const latestBody = latest(bodyRecords);
  const bodyAge = latestBody ? Math.floor((now.getTime() - reportDate(latestBody)) / DAY) : null;
  if (!latestBody) addReason(candidates.body, 20, '키·몸무게와 오늘 컨디션을 먼저 확인해야 합니다.');
  else if (bodyAge >= 30) addReason(candidates.body, 12, `신체 정보 기록이 ${bodyAge}일 전 자료입니다.`);

  const goalText = memberGoalText(member);
  GOAL_SIGNALS.forEach((signal) => {
    if (!signal.words.some((word) => goalText.includes(word))) return;
    signal.tests.forEach((id, index) => addReason(candidates[id], 16 - index * 3, `${signal.label}과 연관성이 높습니다.`));
  });

  const age = ageOf(member, now);
  if (age != null && age >= 65) {
    addReason(candidates.stance, 18, '연령을 고려해 균형 능력을 우선 확인합니다.');
    addReason(candidates.gait, 12, '연령을 고려해 이동 패턴을 함께 확인합니다.');
  }

  Object.entries(latestByKind).forEach(([kind, report]) => {
    if (!report || !COMPLEMENTS[kind]) return;
    const focus = buildProblemFocus(kind, report);
    if (focus?.severity !== 'risk' && focus?.severity !== 'caution') return;
    COMPLEMENTS[kind].forEach((target, index) => {
      const level = focus.severity === 'risk' ? 18 : 11;
      addReason(candidates[target], level - index * 2, `${candidates[kind].title}의 ${focus.severity === 'risk' ? '위험' : '주의'} 결과를 교차 확인합니다.`);
    });
  });

  const safety = conditionSafety(bodyRecords, now);
  if (safety.pain != null && safety.pain >= 7) {
    ['jump', 'lifting'].forEach((id) => {
      candidates[id].safety = 'blocked';
      candidates[id].safetyReasons.push(`최근 통증 NRS ${safety.pain}점으로 고강도 측정을 제한합니다.`);
    });
    ['posture', 'rom', 'gait', 'stance', 'squat'].forEach((id) => {
      candidates[id].safety = 'review';
      candidates[id].safetyReasons.push(`최근 통증 NRS ${safety.pain}점: 트레이너가 동작 가능 범위를 먼저 확인하세요.`);
    });
    addReason(candidates.body, 30, '높은 통증이 기록되어 오늘 컨디션 재확인이 우선입니다.');
  } else if (safety.pain != null && safety.pain >= 4) {
    ['jump', 'lifting'].forEach((id) => {
      candidates[id].safety = 'review';
      candidates[id].safetyReasons.push(`최근 통증 NRS ${safety.pain}점: 고강도 측정 전 트레이너 확인이 필요합니다.`);
    });
    addReason(candidates.body, 18, '최근 중등도 통증 기록을 다시 확인해야 합니다.');
  }
  if (safety.fatigue != null && safety.fatigue >= 4) {
    ['jump', 'lifting'].forEach((id) => {
      if (candidates[id].safety === 'allowed') candidates[id].safety = 'review';
      candidates[id].safetyReasons.push(`최근 피로도 ${safety.fatigue}/5: 고강도 측정 전 회복 상태를 확인하세요.`);
    });
  }

  Object.values(candidates).forEach((candidate) => {
    candidate.score = Math.max(0, Math.min(100, Math.round(candidate.score)));
    if (!candidate.reasons.length) candidate.reasons.push('기본 측정 주기와 회원 정보를 기준으로 계산했습니다.');
  });

  const ranked = Object.values(candidates).sort((a, b) => {
    const safetyRank = { allowed: 0, review: 1, blocked: 2 };
    return safetyRank[a.safety] - safetyRank[b.safety] || b.score - a.score || a.title.localeCompare(b.title, 'ko');
  });

  return {
    memberId: member.id,
    generatedAt: now.toISOString(),
    engineVersion: TEST_RECOMMENDATION_VERSION,
    recommendations: ranked.filter((item) => item.safety !== 'blocked').slice(0, 3),
    candidates: ranked,
    safetySummary: {
      latestPainNrs: safety.pain,
      latestFatigue: safety.fatigue,
      conditionRecordedAt: safety.record ? new Date(reportDate(safety.record)).toISOString() : null,
    },
  };
}
