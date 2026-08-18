import { todayYMD } from '../utils/dates.js';

function compact(value) {
  return String(value || '').replace(/\s+/g, '').toLowerCase();
}

function formatWon(value) {
  return `${Math.round(Number(value) || 0).toLocaleString('ko-KR')}원`;
}

function trainerScopedSchedules(schedules, role, currentUser) {
  if (role === 'admin') return schedules || [];
  const trainerId = currentUser?.trainerId;
  return trainerId ? (schedules || []).filter((item) => item.trainerId === trainerId) : [];
}

/**
 * 이미 Firestore에서 화면용으로 읽어 둔 캐시 데이터만 계산한다.
 * 추가 네트워크 호출과 AI 호출은 전혀 하지 않는다.
 */
export function answerFreeDataQuestion({
  transcript,
  role,
  currentUser,
  members = [],
  schedules = [],
  payments = [],
  nowYMD = todayYMD(),
}) {
  const text = compact(transcript);

  const asksTodaySchedule =
    text.includes('오늘')
    && /(예약|수업|스케줄)/u.test(text)
    && /(몇|얼마나|알려|말해|확인)/u.test(text);
  if (asksTodaySchedule) {
    const list = trainerScopedSchedules(schedules, role, currentUser)
      .filter((item) => item.date === nowYMD && item.status !== 'canceled');
    const scheduled = list.filter((item) => item.status === 'scheduled').length;
    const attended = list.filter((item) => item.status === 'attended').length;
    const noshow = list.filter((item) => item.status === 'noshow').length;
    const detail = [
      scheduled ? `예정 ${scheduled}건` : '',
      attended ? `출석 ${attended}건` : '',
      noshow ? `노쇼 ${noshow}건` : '',
    ].filter(Boolean).join(', ');
    return {
      type: 'chat',
      source: 'free-data',
      text: list.length
        ? `오늘 예약은 총 ${list.length}건이에요.${detail ? ` ${detail}입니다.` : ''}`
        : '오늘 등록된 예약은 없어요.',
    };
  }

  const asksRemaining =
    /(세션|횟수|수업)/u.test(text)
    && /(잔여|남은|몇회|몇개|얼마|남았)/u.test(text);
  if (asksRemaining) {
    const matches = (members || []).filter((member) => {
      const name = compact(member?.name);
      return name && text.includes(name);
    });
    if (matches.length === 1) {
      const member = matches[0];
      const sessions = member.trainerSessions || {};
      const trainerId = role === 'admin' ? null : currentUser?.trainerId;
      const remaining = trainerId
        ? Number(sessions[trainerId]?.remaining || 0)
        : Object.values(sessions).reduce((sum, item) => sum + Number(item?.remaining || 0), 0);
      return {
        type: 'chat',
        source: 'free-data',
        text: `${member.name} 회원님의 잔여 세션은 ${remaining}회예요.`,
      };
    }
    if (matches.length > 1) {
      return { type: 'chat', source: 'free-data', text: '같은 이름의 회원이 있어요. 회원을 한 명만 특정해주세요.' };
    }
  }

  const asksMonthlyRevenue =
    /(이번달|당월)/u.test(text)
    && /(매출|수납|결제금액|판매금액)/u.test(text)
    && /(얼마|합계|총|알려|말해|확인|보여)/u.test(text);
  if (asksMonthlyRevenue) {
    if (role !== 'admin') {
      return { type: 'chat', source: 'free-data', text: '매출 정보는 관리자만 확인할 수 있어요.' };
    }
    const ym = nowYMD.slice(0, 7);
    // Revenue.jsx와 같은 회계 원칙: 환불된 결제도 결제월 매출에는 포함하고,
    // 실제 환불액만 환불일이 속한 달에서 차감한다(부분환불 이중차감 방지).
    const valid = (payments || []).filter((payment) =>
      String(payment?.paidAt || '').startsWith(ym)
      && !payment?.isUnpaid
    );
    const refundTotal = (payments || [])
      .filter((payment) => payment?.isRefunded && String(payment?.refundedAt || '').startsWith(ym))
      .reduce((sum, payment) => sum + Number(payment?.refundAmount || 0), 0);
    const total = valid.reduce((sum, payment) => sum + Number(payment?.amount || 0), 0) - refundTotal;
    return {
      type: 'chat',
      source: 'free-data',
      text: `이번 달 매출은 ${formatWon(total)}이고, 결제 ${valid.length}건이에요. 미수금은 제외하고 이번 달 환불액은 차감했어요.`,
    };
  }

  return null;
}
