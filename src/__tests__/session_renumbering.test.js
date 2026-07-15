// 회차(sessionAtBooking) 자동 재배정의 순수 계산부(computeSessionRenumbering) 검증.
//
// 회귀 배경(2026-07, 회원 "지율" 사례): renumberSessionAtBooking이 재배정
// "대상"을 고를 때 sessionAtBooking != null 만 확인했다. 그런데 잔여 0이라
// 차감을 건너뛴 예약도 sessionAtBooking=0(≠null)으로 기록되므로 대상에
// 섞여 들어갔고, 취소되어 차감이 복원된 예약도 걸러지지 않았다. 재배정은
// "가장 큰 값에서 인원수만큼 1씩 빼며 채우는" 방식이라, 대상 인원수가 실제
// 차감 건수보다 많아지면 그 초과분이 0 밑으로(-1, -2 …) 떨어졌다.
//
// 아래 테스트들은 computeSessionRenumbering이 (1) 실제로 차감된 예약만
// 대상으로 삼고, (2) 재등록으로 총횟수가 바뀐 예약끼리는 섞지 않으며,
// (3) 대상들이 이미 갖고 있던 값만 재배치(치환)해서 새 값을 만들어내지
// 않는다는 것 — 즉 원리상 음수나 근거 없는 값이 나올 수 없다는 것을 검증한다.
import { describe, it, expect } from 'vitest';
import { computeSessionRenumbering } from '../demoData.js';

// 후보 예약 팩토리 (외부/상담 아닌 일반 회원 세션 수업 기준)
const sched = (id, date, sessionAtBooking, opts = {}) => ({
  id, date, startTime: opts.startTime ?? '09:00',
  memberId: 'm1', trainerId: 't1',
  isExternal: false, isConsult: false,
  sessionDeducted: opts.sessionDeducted ?? true,
  sessionAtBooking,
  sessionTotalAtBooking: opts.sessionTotalAtBooking ?? 10,
  status: opts.status ?? 'scheduled',
  sessionManual: opts.sessionManual ?? false,
});

// 재배정 후 "최종값"을 계산 — updates에 있으면 그 값, 없으면(=변경 없음) 원래 값.
function finalValuesById(candidates, updates) {
  const out = {};
  for (const c of candidates) {
    const u = updates.find((x) => x.id === c.id);
    out[c.id] = u ? u.sessionAtBooking : c.sessionAtBooking;
  }
  return out;
}

describe('computeSessionRenumbering — 회귀 방지: 미차감/취소/수동 항목이 섞여 음수가 되지 않는다', () => {
  it('잔여 0이라 차감을 건너뛴 예약(0 고정)들은 재배정 대상에서 완전히 제외된다 — 스크린샷 사례 재현', () => {
    // 실제 사례: 총 8회권의 마지막(1(e))을 예약한 뒤, 잔여가 0인 채로
    // 트레이너가 실수로 7건을 더 예약함(전부 차감 안 됨).
    const candidates = [
      sched('real', '2026-07-01', 1, { sessionTotalAtBooking: 8 }), // 진짜 마지막 회차
      sched('skip1', '2026-07-03', 0, { sessionDeducted: false, sessionTotalAtBooking: 8 }),
      sched('skip2', '2026-07-08', 0, { sessionDeducted: false, sessionTotalAtBooking: 8 }),
      sched('skip3', '2026-07-09', 0, { sessionDeducted: false, sessionTotalAtBooking: 8 }),
      sched('skip4', '2026-07-10', 0, { sessionDeducted: false, sessionTotalAtBooking: 8 }),
      sched('skip5', '2026-07-13', 0, { sessionDeducted: false, sessionTotalAtBooking: 8 }),
      sched('skip6', '2026-07-15', 0, { sessionDeducted: false, sessionTotalAtBooking: 8 }),
      sched('skip7', '2026-07-16', 0, { sessionDeducted: false, sessionTotalAtBooking: 8 }),
    ];
    const updates = computeSessionRenumbering(candidates);

    // 실제 차감 건이 대상 풀에 단 1건뿐이라(2건 미만) 재배정 자체가 발생하지 않는다.
    // (미차감 7건은 애초에 대상 풀에도 들어가지 못한다.)
    expect(updates).toEqual([]);
  });

  it('실제 차감 건 여러 개 사이에 미차감(0) 예약이 섞여도, 실제 차감 건 재배정 결과는 항상 1 이상이다', () => {
    // 진짜 차감 3건(날짜순과 생성순이 어긋나 재배정이 필요한 상태) + 미차감 5건.
    const candidates = [
      sched('mon', '2026-07-01', 8, { sessionTotalAtBooking: 10 }),
      sched('thu', '2026-07-06', 7, { sessionTotalAtBooking: 10 }),
      sched('tue', '2026-07-03', 6, { sessionTotalAtBooking: 10 }), // 날짜상 mon~thu 사이인데 6으로 낮음 → 재정렬 필요
      sched('skipA', '2026-07-08', 0, { sessionDeducted: false, sessionTotalAtBooking: 10 }),
      sched('skipB', '2026-07-09', 0, { sessionDeducted: false, sessionTotalAtBooking: 10 }),
      sched('skipC', '2026-07-10', 0, { sessionDeducted: false, sessionTotalAtBooking: 10 }),
      sched('skipD', '2026-07-13', 0, { sessionDeducted: false, sessionTotalAtBooking: 10 }),
      sched('skipE', '2026-07-15', 0, { sessionDeducted: false, sessionTotalAtBooking: 10 }),
    ];
    const updates = computeSessionRenumbering(candidates);
    const final = finalValuesById(candidates, updates);

    // 실제 차감 3건만 날짜순(월·화·목)으로 8·7·6 재배정 — 기존 단위테스트(store.test.js)와 동일 기대값.
    expect(final.mon).toBe(8);
    expect(final.tue).toBe(7);
    expect(final.thu).toBe(6);
    // 미차감 5건은 대상 풀에 들어가지 않으므로 업데이트 목록에도 나타나지 않는다(=원래 값 0 그대로).
    for (const skipId of ['skipA', 'skipB', 'skipC', 'skipD', 'skipE']) {
      expect(updates.find((u) => u.id === skipId)).toBeUndefined();
      expect(final[skipId]).toBe(0);
    }
    // 회귀 확인의 핵심: 실제로 변경된 값 중 음수/0은 없다.
    expect(updates.every((u) => u.sessionAtBooking >= 1)).toBe(true);
  });

  it('취소되어 차감이 복원된 예약은 재배정 대상에서 제외된다(값도 그대로 둔다)', () => {
    const candidates = [
      sched('a', '2026-07-01', 3, { sessionTotalAtBooking: 3 }),
      sched('b_canceled', '2026-07-02', 2, { sessionTotalAtBooking: 3, status: 'canceled' }),
      sched('c', '2026-07-03', 1, { sessionTotalAtBooking: 3 }),
      // 취소로 복원된 자리를 재사용해 새로 예약된 건 — 날짜는 가장 늦지만 값은 다시 2.
      sched('d', '2026-07-05', 2, { sessionTotalAtBooking: 3 }),
    ];
    const updates = computeSessionRenumbering(candidates);
    const final = finalValuesById(candidates, updates);

    // 취소 건은 대상에서 제외되어 원래 값(2)이 그대로 유지된다.
    expect(updates.find((u) => u.id === 'b_canceled')).toBeUndefined();
    expect(final.b_canceled).toBe(2);
    // 유효한 3건(a,c,d)의 기존 값 집합 {3,1,2}를 내림차순으로 날짜순 자리에 재배치하면 a=3,c=2,d=1.
    expect(final.a).toBe(3);
    expect(final.c).toBe(2);
    expect(final.d).toBe(1);
    // 음수 회귀 방지 확인.
    expect(updates.every((u) => u.sessionAtBooking >= 1)).toBe(true);
  });

  it('트레이너가 세션 탭에서 수동으로 고정한 값(sessionManual)은 자동 재배정이 건드리지 않는다', () => {
    const candidates = [
      sched('a', '2026-07-01', 5, { sessionTotalAtBooking: 5 }),
      sched('b_manual', '2026-07-02', 99, { sessionTotalAtBooking: 5, sessionManual: true }), // 트레이너가 임의로 고정
      sched('c', '2026-07-03', 3, { sessionTotalAtBooking: 5 }),
    ];
    const updates = computeSessionRenumbering(candidates);
    const final = finalValuesById(candidates, updates);

    // 수동 고정 값은 대상 풀에서 완전히 제외 — 다른 값을 만들어내는 재료로도 쓰이지 않고, 그대로 99 유지.
    expect(updates.find((u) => u.id === 'b_manual')).toBeUndefined();
    expect(final.b_manual).toBe(99);
    // 나머지 a,c는 값이 {5,3}뿐이라 이미 날짜순 내림차순 → 변경 없음.
    expect(final.a).toBe(5);
    expect(final.c).toBe(3);
  });

  it('재등록으로 총횟수(sessionTotalAtBooking)가 바뀌면 서로 다른 lot으로 취급해 절대 섞지 않는다', () => {
    // 이전 패키지(total=3)의 진짜 마지막 회차(1)가, 재등록 후 패키지(total=8)의
    // 숫자로 둔갑하면 안 된다 — 값 자체가 양수여도 사실과 다른 회차가 되기 때문.
    const candidates = [
      sched('old_last', '2026-07-01', 1, { sessionTotalAtBooking: 3 }),   // 이전 패키지 마지막 수업
      sched('new_first', '2026-07-10', 5, { sessionTotalAtBooking: 8 }),  // 재등록 후 첫 수업(가장 늦은 날짜인데 값은 더 큼)
    ];
    const updates = computeSessionRenumbering(candidates);
    // 서로 다른 lot이라 각 lot에 1건씩뿐 → 재배정 자체가 일어나지 않는다.
    expect(updates).toEqual([]);
  });

  it('재등록 후에도 같은 lot 안에서는 정상적으로 날짜순 재정렬되고, 다른 lot과는 섞이지 않는다', () => {
    const candidates = [
      // 이전 패키지(total=3): 이미 날짜순대로 3,2,1 — 손댈 필요 없음.
      sched('old1', '2026-06-01', 3, { sessionTotalAtBooking: 3 }),
      sched('old2', '2026-06-08', 2, { sessionTotalAtBooking: 3 }),
      sched('old3', '2026-06-15', 1, { sessionTotalAtBooking: 3 }),
      // 재등록 후 패키지(total=8): 화요일 수업을 나중에 끼워넣어 재정렬이 필요한 상태.
      sched('new_mon', '2026-07-01', 8, { sessionTotalAtBooking: 8 }),
      sched('new_thu', '2026-07-06', 7, { sessionTotalAtBooking: 8 }),
      sched('new_tue', '2026-07-03', 6, { sessionTotalAtBooking: 8 }),
    ];
    const updates = computeSessionRenumbering(candidates);
    const final = finalValuesById(candidates, updates);

    // 이전 패키지는 전혀 건드리지 않는다.
    expect(final.old1).toBe(3);
    expect(final.old2).toBe(2);
    expect(final.old3).toBe(1);
    // 새 패키지만 날짜순으로 재정렬된다.
    expect(final.new_mon).toBe(8);
    expect(final.new_tue).toBe(7);
    expect(final.new_thu).toBe(6);
    expect(updates.every((u) => u.sessionAtBooking >= 1)).toBe(true);
  });

  it('결과로 나오는 값들은 입력에 이미 존재했던 값들의 순열일 뿐이다 — 새 값을 만들어내지 않는다', () => {
    const candidates = [
      sched('a', '2026-07-01', 4, { sessionTotalAtBooking: 4 }),
      sched('b', '2026-07-02', 2, { sessionTotalAtBooking: 4 }), // 날짜상 a와 c 사이인데 값이 더 낮음 → 재정렬 필요
      sched('c', '2026-07-03', 3, { sessionTotalAtBooking: 4 }),
    ];
    const inputValues = candidates.map((c) => c.sessionAtBooking).sort((x, y) => x - y);
    const updates = computeSessionRenumbering(candidates);
    const final = finalValuesById(candidates, updates);

    const finalValues = candidates.map((c) => final[c.id]).sort((x, y) => x - y);
    expect(finalValues).toEqual(inputValues); // 값의 다중집합 자체는 절대 바뀌지 않는다(순열일 뿐).
    // 실제로 재정렬이 일어났는지도 함께 확인(퇴화 케이스가 아님).
    expect(final.a).toBe(4);
    expect(final.b).toBe(3);
    expect(final.c).toBe(2);
  });
});
