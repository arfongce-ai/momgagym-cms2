// 스케줄 vs 영상 폴더 비교 — 매달 세컨드 브레인 세션이 실행
// 입력 1: data/schedule-checks/{YYYY-MM}.json (export.mjs 결과)
// 입력 2: video-inventory.json — 세컨드 브레인 세션이 PC 폴더를 device_list_dir로 훑어 만든 목록
//   형식: [{ topFolder, memberFolderRaw, dateFolder, taggedTrainerInitial, hasRealVideo }]
// 출력: 콘솔에 불일치 목록 (JSON) — "수업은 있는데 영상 없음" / "영상은 있는데 스케줄 없음"

import { readFileSync } from 'node:fs';

// 트레이너 폴더명 <-> 실제 이름 <-> 이니셜 매핑 (2026-08-31 사용자 확인 기준)
// TODO: 미확인 4명(황지영·박재만·정해정·주호진) 이니셜 확인되면 채우기
const TRAINER_MAP = [
  { folderPrefix: '1.김동규선생님', name: '김동규', initial: 'DK' },
  { folderPrefix: '2.최인영선생님', name: '최인영', initial: 'IY' },
  { folderPrefix: '3.정주인선생님', name: '정주인', initial: 'JI' },
  { folderPrefix: '4.황지영선생님', name: '황지영', initial: null },
  { folderPrefix: '5.권태희선생님', name: '권태희', initial: 'TH' },
  { folderPrefix: '6.김나영선생님', name: '김나영', initial: 'NY' },
  { folderPrefix: '7.김현우선생님', name: '김현우', initial: 'HW' },
  { folderPrefix: '8.박병준선생님', name: '박병준', initial: 'BJ' },
  { folderPrefix: '9.박재만선생님', name: '박재만', initial: null },
  { folderPrefix: '10.정해정선생님', name: '정해정', initial: null },
  { folderPrefix: '11.주호진선생님', name: '주호진', initial: null },
];

function ymdToIso(ymd6) {
  // '260314' -> '2026-03-14'
  const yy = ymd6.slice(0, 2);
  const mm = ymd6.slice(2, 4);
  const dd = ymd6.slice(4, 6);
  return `20${yy}-${mm}-${dd}`;
}

function extractMemberName(folderRaw) {
  // "정민호(스중태권도, 허리, 햄스트링)DK" -> "정민호"
  const idx = folderRaw.indexOf('(');
  return (idx === -1 ? folderRaw : folderRaw.slice(0, idx)).trim();
}

function trainerByFolder(topFolder) {
  return TRAINER_MAP.find((t) => topFolder.startsWith(t.folderPrefix)) || null;
}

function trainerByInitial(initial) {
  return TRAINER_MAP.find((t) => t.initial === initial) || null;
}

export function buildVideoIndex(inventory) {
  // key: `${실제트레이너이름}|${회원이름}|${YYYY-MM-DD}` -> true (실제 영상 있음)
  const index = new Set();
  for (const row of inventory) {
    const topTrainer = trainerByFolder(row.topFolder);
    const dateFolderMatch = row.dateFolder.match(/^(\d{6})(?:\((\w+)\))?/);
    if (!dateFolderMatch) continue; // YYMMDD 형식 아닌 폴더는 건너뜀
    const [, ymd6, taggedInitial] = dateFolderMatch;
    const actualTrainer = taggedInitial ? trainerByInitial(taggedInitial) : topTrainer;
    if (!actualTrainer || !row.hasRealVideo) continue;
    const memberName = extractMemberName(row.memberFolderRaw);
    const iso = ymdToIso(ymd6);
    index.add(`${actualTrainer.name}|${memberName}|${iso}`);
  }
  return index;
}

export function compare(scheduleExport, inventory) {
  const videoIndex = buildVideoIndex(inventory);
  const scheduleKeys = new Set();

  const scheduleWithoutVideo = [];
  for (const s of scheduleExport.schedules) {
    const key = `${s.trainerName}|${s.memberName}|${s.date}`;
    scheduleKeys.add(key);
    if (!videoIndex.has(key)) {
      scheduleWithoutVideo.push(s);
    }
  }

  const videoWithoutSchedule = [];
  for (const key of videoIndex) {
    if (!scheduleKeys.has(key)) {
      const [trainerName, memberName, date] = key.split('|');
      videoWithoutSchedule.push({ trainerName, memberName, date });
    }
  }

  return { month: scheduleExport.month, scheduleWithoutVideo, videoWithoutSchedule };
}

// CLI 실행: node compare.mjs <schedule-export.json> <video-inventory.json>
if (import.meta.url === `file://${process.argv[1]}`) {
  const [scheduleFile, inventoryFile] = process.argv.slice(2);
  const scheduleExport = JSON.parse(readFileSync(scheduleFile, 'utf8'));
  const inventory = JSON.parse(readFileSync(inventoryFile, 'utf8'));
  const result = compare(scheduleExport, inventory);
  console.log(JSON.stringify(result, null, 2));
}
