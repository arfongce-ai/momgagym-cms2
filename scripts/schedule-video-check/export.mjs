// 월간 수업 스케줄 내보내기 — schedule-video-check 점검용
// GitHub Actions(schedule-video-check-export.yml)에서 매달 1일 실행되어,
// 지난 달 schedules 문서를 뽑아 data/schedule-checks/{YYYY-MM}.json 으로 저장·커밋합니다.
//
// 필요한 환경변수: SCHEDULE_EXPORT_SERVICE_ACCOUNT (읽기전용 서비스 계정 json 문자열)
// 선택 환경변수: TARGET_MONTH (YYYY-MM, 지정 없으면 "지난 달"을 자동 계산)

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

function resolveTargetMonth() {
  if (process.env.TARGET_MONTH) return process.env.TARGET_MONTH;
  const now = new Date();
  // UTC 기준 계산 후 KST(UTC+9) 보정
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const y = kst.getUTCFullYear();
  const m = kst.getUTCMonth(); // 0-indexed, 이번 실행은 매달 1일이므로 "지난 달" = m-1
  const prev = new Date(Date.UTC(y, m - 1, 1));
  const yyyy = prev.getUTCFullYear();
  const mm = String(prev.getUTCMonth() + 1).padStart(2, '0');
  return `${yyyy}-${mm}`;
}

async function main() {
  const raw = process.env.SCHEDULE_EXPORT_SERVICE_ACCOUNT;
  if (!raw) throw new Error('SCHEDULE_EXPORT_SERVICE_ACCOUNT 환경변수가 없습니다.');
  const key = JSON.parse(raw);

  initializeApp({ credential: cert(key) });
  const db = getFirestore();

  const targetMonth = resolveTargetMonth(); // 'YYYY-MM'
  const start = `${targetMonth}-01`;
  const [y, m] = targetMonth.split('-').map(Number);
  const nextMonth = new Date(Date.UTC(y, m, 1)); // m은 0-indexed 다음달의 1일과 같음(m 자체가 1~12이므로 Date.UTC(y, m, 1)=다음달 1일)
  const end = nextMonth.toISOString().slice(0, 10); // 'YYYY-MM-DD' (다음 달 1일, 미만 비교용)

  const snap = await db
    .collection('schedules')
    .where('date', '>=', start)
    .where('date', '<', end)
    .get();

  const rows = [];
  snap.forEach((doc) => {
    const d = doc.data();
    if (d.status === 'canceled') return;
    rows.push({
      id: doc.id,
      date: d.date || null,
      startTime: d.startTime || null,
      trainerId: d.trainerId || null,
      trainerName: d.trainerName || null,
      memberId: d.memberId || null,
      memberName: d.memberName || null,
    });
  });

  const outPath = `data/schedule-checks/${targetMonth}.json`;
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(
    outPath,
    JSON.stringify({ month: targetMonth, generatedAt: new Date().toISOString(), count: rows.length, schedules: rows }, null, 2),
  );

  console.log(`내보내기 완료: ${outPath} (${rows.length}건, ${targetMonth})`);
}

main().catch((e) => {
  console.error('ERROR:', e);
  process.exit(1);
});
