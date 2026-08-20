// ai-measure/menus/JumpPrecisionAnalysis.jsx
// ════════════════════════════════════════════════════════════════════════
//  점프 정밀 측정 (라이브) — 보행&러닝(GaitRunningAnalysis)과 동일 수준의 UX
//   · BlazePose 스켈레톤 오버레이로 인식 상태를 눈으로 확인
//   · 서 있는 자세 캘리브레이션(키 자동 보정) → 점프 검출 → 비행시간 높이
//   · 골반 변위 교차검증(±오차) + 키 sanity → valid 플래그로 무효 측정 차단
//   · 유효 측정만 자동 저장 (gait 와 동일한 저장 흐름)
//
//  요구사항 매핑:
//   [1] 측정 시작 시 member.height 로 px↔cm 스케일 자동 산출 (StandingCalibrator)
//   [2] 상단에 "회원 키(000cm)로 자동 보정 중..." 표시 / 키 없으면 입력 팝업
//   [3] 서 있는 자세 불안정(가시성↓·흔들림↑)이면 "올바르게 서 주세요" → 측정 차단
// ════════════════════════════════════════════════════════════════════════
import React, { useState, useEffect, useRef } from 'react';
import {
  StandingCalibrator, JumpFlightTracker,
  JumpBiomechAccumulator, jumpPhaseOf, currentJointAngles, pelvisCenterY,
} from '../core/jumpBiomechanics';
import { calcJump, calcRSI } from '../core/performance';
import { computeRSIFromFlights, rsiGrade, RSI_TUNING } from '../core/reactiveJump';
import { requiredJumpsFor, minCyclesOverrideFor } from '../core/jumpTypes';
import { applyRepFreeze } from '../core/repFreeze';
import { OrientationVoter } from '../core/gaitBiomechanics';
import { loadPoseLandmarker, detectPoseFrame, isPoseReady, closePoseLandmarker } from '../core/poseBackend';
import { openMainCameraStream, describeCameraError } from '../core/cameraSelect';
import { pickRecorderMime } from '../core/recordSink';
import { beepTick, beepGo, primeAudio } from '../core/audioCue';
import { lockZoom, unlockZoom } from '../../utils/viewportLock';
import ReportActions from '../../components/report/ReportActions';
import { store } from '../../demoData';
import { isSkeletonEnabled } from '../core/skeletonPref';
import SkeletonToggleChip from './SkeletonToggleChip';
import { useCameraRotation } from '../core/useCameraRotation';
import { rotateLandmarksNormalized } from '../core/recordAspect';
import { drawGaugeHud } from '../core/recordingOverlay';
import GaugeHud from './GaugeHud';

// 회원 신체기록에서 최신 체중을 보조 조회 (member.weight 없을 때 Sayers 파워용)
function resolveWeight(member, fallback = null) {
  let w = member?.weight != null ? Number(member.weight) : fallback;
  try {
    if (w == null && member?.id && typeof store?.getBodyRecords === 'function') {
      const recs = store.getBodyRecords(member.id) || [];
      const sorted = [...recs].sort((a, b) => String(b.recordedAt).localeCompare(String(a.recordedAt)));
      const hit = sorted.find(r => r.weight != null);
      if (hit) w = Number(hit.weight);
    }
  } catch (e) { /* member 값 사용 */ }
  return Number.isFinite(w) ? w : null;
}

const RECORD_FPS = 30;
const REC_SIZE = { width: 720, height: 960 }; // 3:4 세로
const LAND_WINDOW = 10; // 착지 직후 생체역학 지표를 누적할 프레임 수
const RSI_REQUIRED_JUMPS = 3;

// [2026-08-12 수정] 라이브 화면(카드·게이지·녹화 번인)이 쓰는 RSI 미리보기.
//  이전엔 접지시간이 0보다 크기만 하면 그대로 통과시켰다 — 포즈 인식이 착지를
//  순간적으로(예: 20~30ms) 오판하면 분모가 극단적으로 작아져 RSI가 10~20대
//  같은 비현실적인 값으로 튀었다(실사용 리포트에서 확인된 증상). 최종 리포트
//  계산(computeRSIFromFlights)은 RSI_TUNING.minContactMs~maxContactMs(80~800ms)
//  로 이미 이런 구간을 걸러내고 있었는데, 이 미리보기 함수만 그 검증이 빠져
//  있었다 — 같은 RSI_TUNING을 그대로 재사용해 두 경로를 일치시킨다.
//  ⚠ 무효 구간은 continue로 건너뛰지 않고 null로 자리를 채운다: 그냥 건너뛰면
//  이후 사이클들이 배열에서 한 칸씩 당겨져(index shift), "몇 번째 점프인지"를
//  배열 위치로 찾는 flightRows/allFlightRows의 매칭이 전부 어긋난다(다른 점프의
//  RSI·접지시간이 엉뚱한 카드 번호에 표시됨) — computeRSIFromFlights의
//  perCycleByIndex 와 동일한 계약.
function buildRsiCyclePreview(flights = []) {
  const cycles = [];
  const sorted = [...flights].sort((a, b) => a.takeoffMs - b.takeoffMs);
  for (let i = 0; i < sorted.length - 1; i++) {
    const contactMs = sorted[i + 1].takeoffMs - sorted[i].landingMs;
    const flightMs = sorted[i + 1].flightMs;
    const inRange = contactMs >= RSI_TUNING.minContactMs && contactMs <= RSI_TUNING.maxContactMs;
    if (!inRange || !(flightMs > 0)) { cycles.push(null); continue; }
    const jump = calcJump(flightMs / 1000, null);
    cycles.push({
      contactMs: Math.round(contactMs),
      flightMs: Math.round(flightMs),
      heightCm: jump?.heightCm ?? null,
      rsi: Math.round((flightMs / contactMs) * 100) / 100,
    });
  }
  return cycles;
}

function flightRows(flights = [], cycles = []) {
  return flights.slice(-5).map((f, i, arr) => {
    const originalIndex = flights.length - arr.length + i;
    const jump = calcJump((f.flightMs || 0) / 1000, null);
    return {
      no: originalIndex + 1,
      flightMs: Math.round(f.flightMs || 0),
      heightCm: jump?.heightCm ?? null,
      rsi: originalIndex > 0 ? cycles[originalIndex - 1]?.rsi ?? null : null,
      contactMs: originalIndex > 0 ? cycles[originalIndex - 1]?.contactMs ?? null : null,
    };
  });
}

function allFlightRows(flights = [], cycles = []) {
  return flights.map((f, i) => {
    const jump = calcJump((f.flightMs || 0) / 1000, null);
    return {
      no: i + 1,
      takeoffMs: Math.round(f.takeoffMs || 0),
      landingMs: Math.round(f.landingMs || 0),
      flightMs: Math.round(f.flightMs || 0),
      heightCm: jump?.heightCm ?? null,
      rsi: i > 0 ? cycles[i - 1]?.rsi ?? null : null,
      contactMs: i > 0 ? cycles[i - 1]?.contactMs ?? null : null,
    };
  });
}

// 대형 시인성 HUD(녹화 번인): RSI/점프높이(주지표)·접지/체공을 상단 좌/우
// 가장자리에 크게, 회차별 기록은 하단 카드 스트립으로 — 피사체(중앙) 미가림.
function drawJumpLiveOverlay(ctx, width, height, snap = {}) {
  const isRsi = snap.jumpType === 'reactive';
  const phase = snap.phase || 'arming';
  const accent = phase === 'air' ? '#fbbf24' : phase === 'ready' ? '#34d399' : phase === 'low_visibility' ? '#f87171' : '#22d3ee';
  const statusTxt = phase === 'ready' ? 'READY' : phase === 'air' ? 'AIR'
    : phase === 'low_visibility' ? '자세 확인' : '준비 중';
  const latest = snap.latestCycle || null;

  const rows = (snap.jumpRows || []).slice(-5);
  const cards = rows.length
    ? rows.map((r, i) => ({
        top: `#${r.no}`,
        main: isRsi
          ? (r.rsi != null ? String(r.rsi) : (r.heightCm != null ? `${r.heightCm}` : '--'))
          : (r.heightCm != null ? String(r.heightCm) : '--'),
        sub: isRsi
          ? (r.contactMs != null ? `${r.contactMs}ms` : (r.flightMs ? `${r.flightMs}ms` : ''))
          : (r.flightMs ? `${r.flightMs}ms` : ''),
        latest: i === rows.length - 1,
      }))
    : null;

  const gauge = isRsi
    ? { label: 'RSI', value: latest?.rsi ?? null, unit: '', arc: true, min: 0, max: 3 }
    : { label: '점프 높이', value: snap.liveJump?.heightCm ?? snap.bestHeight ?? null, unit: 'cm' };
  // [무릎·고관절 각도 HUD 2026-08-18] 기존 2개(접지/진행 또는 체공/점프)에
  // 실시간 관절 각도 2개를 더해 GaugeHud 카드 한도(4개)를 채운다.
  const kneeStat = { label: '무릎각', value: snap.liveAngles?.knee ?? null, unit: '°' };
  const hipStat = { label: '고관절각', value: snap.liveAngles?.hip ?? null, unit: '°' };
  const stats = isRsi
    ? [
        { label: '접지시간', value: latest?.contactMs ?? null, unit: 'ms' },
        { label: '진행', value: `${snap.jumpCount || 0}/${snap.requiredJumps || RSI_REQUIRED_JUMPS}` },
        kneeStat, hipStat,
      ]
    : [
        { label: '체공시간', value: snap.liveJump?.flightMs ?? null, unit: 'ms' },
        { label: '점프', value: `${snap.jumpCount || 0}`, unit: '회' },
        kneeStat, hipStat,
      ];

  drawGaugeHud(ctx, width, height, {
    title: isRsi ? 'RSI · SIDE' : 'JUMP · FRONT',
    status: statusTxt,
    recording: true,
    accent,
    gauge, stats, cards,
  });
}

// 녹화 캔버스에 비디오를 꽉 채워 그린다(검은 여백 없이 크롭) — gait drawCover 와 동일.
// rotationDeg: useCameraRotation 값과 동일한 값을 넘기면 회전 보정된 화면이 그대로 녹화된다.
function drawCoverJump(ctx, video, width, height, rotationDeg = 0) {
  const sw0 = video.videoWidth, sh0 = video.videoHeight;
  if (!sw0 || !sh0) return;
  const rot = (((Math.round((Number(rotationDeg) || 0) / 90) * 90) % 360) + 360) % 360;
  if (!rot) {
    const sr = sw0 / sh0, tr = width / height;
    let sx = 0, sy = 0, sw = sw0, sh = sh0;
    if (sr > tr) { sw = sh0 * tr; sx = (sw0 - sw) / 2; }
    else { sh = sw0 / tr; sy = (sh0 - sh) / 2; }
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, width, height);
    return;
  }
  const swapped = rot === 90 || rot === 270;
  const tw = swapped ? height : width, th = swapped ? width : height;
  const sr = sw0 / sh0, tr = tw / th;
  let sx = 0, sy = 0, sw = sw0, sh = sh0;
  if (sr > tr) { sw = sh0 * tr; sx = (sw0 - sw) / 2; }
  else { sh = sw0 / tr; sy = (sh0 - sh) / 2; }
  ctx.save();
  ctx.translate(width / 2, height / 2);
  ctx.rotate((rot * Math.PI) / 180);
  ctx.drawImage(video, sx, sy, sw, sh, -tw / 2, -th / 2, tw, th);
  ctx.restore();
}

// 캘리브레이션 안정 유지 시간(깜빡임 방지). 충분히 서 있으면 거의 즉시 락.
const POSE_BONES = [
  [11, 12], [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [27, 29], [27, 31], [29, 31],
  [24, 26], [26, 28], [28, 30], [28, 32], [30, 32],
  [0, 11], [0, 12], // 머리~어깨 (전신 프레이밍 확인용)
];

function drawSkeleton(canvas, video, landmarks, phase) {
  if (!canvas || !video) return;
  const cw = canvas.clientWidth, ch = canvas.clientHeight;
  if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, cw, ch);
  if (!landmarks) return;
  if (!isSkeletonEnabled()) return; // OFF: 스켈레톤 미표시(기준선은 별도 draw 로 유지)
  const vw = video.videoWidth, vh = video.videoHeight;
  if (!vw || !vh) return;
  // [2026-07-31] cover(Math.max, 크롭)→contain(Math.min, 여백 포함 전체 표시)로 변경.
  // 다른 측정 화면(Squat/Posture 등)과 동일한 기준 — 키오스크처럼 화면비가 카메라와
  // 다른 환경에서 상단/하단이 잘려 보이던 문제를 없앤다.
  const scale = Math.min(cw / vw, ch / vh);
  const dw = vw * scale, dh = vh * scale;
  const ox = (cw - dw) / 2, oy = (ch - dh) / 2;
  const px = (p) => ox + p.x * dw;
  const py = (p) => oy + p.y * dh;
  // 색상: 캘리브 중=시안, 측정 준비=초록, 공중=앰버
  const col = phase === 'air' ? 'rgba(251,191,36,0.95)'
    : phase === 'ready' ? 'rgba(52,211,153,0.95)'
    : 'rgba(34,211,238,0.95)';
  ctx.strokeStyle = col; ctx.lineWidth = 3; ctx.lineCap = 'round';
  for (const [a, b] of POSE_BONES) {
    const pa = landmarks[a], pb = landmarks[b];
    if (!pa || !pb) continue;
    if ((pa.visibility != null && pa.visibility < 0.3) || (pb.visibility != null && pb.visibility < 0.3)) continue;
    ctx.beginPath(); ctx.moveTo(px(pa), py(pa)); ctx.lineTo(px(pb), py(pb)); ctx.stroke();
  }
  ctx.fillStyle = phase === 'ready' || phase === 'air' ? col : 'rgba(255,255,255,0.95)';
  for (const i of [0, 11, 12, 23, 24, 25, 26, 27, 28, 31, 32]) {
    const p = landmarks[i];
    if (!p || (p.visibility != null && p.visibility < 0.3)) continue;
    ctx.beginPath(); ctx.arc(px(p), py(p), 5, 0, Math.PI * 2); ctx.fill();
  }
}

// 캘리브 기준선을 화면에 가로선으로 표시 (사용자 피드백)
// rotationDeg: 90/270에서는 이 캔버스 전체가 바깥 래퍼에서 CSS로 통째로 돌아간다.
// 스켈레톤(drawSkeleton)은 점 하나하나를 x·y 둘 다 매핑해서 그 회전에 자동으로
// 맞지만, 이 기준선은 "버퍼 폭 전체를 가로지르는 선" 하나뿐이라 축이 안 맞았다 —
// 90/270에서 그대로 가로로 그리면 회전 후 화면에는 세로선으로 보인다(보고된 증상).
function drawBaseline(canvas, video, baselineFeetY, rotationDeg = 0) {
  if (!canvas || !video || baselineFeetY == null) return;
  const cw = canvas.width, ch = canvas.height;
  const vw = video.videoWidth, vh = video.videoHeight;
  if (!vw || !vh) return;
  // drawSkeleton과 동일한 contain 기준으로 맞춰야 기준선이 실제 영상과 어긋나지 않는다.
  const scale = Math.min(cw / vw, ch / vh);
  const dh = vh * scale;
  const oy = (ch - dh) / 2;
  const y = oy + baselineFeetY * dh;
  const ctx = canvas.getContext('2d');
  ctx.strokeStyle = 'rgba(52,211,153,0.5)'; ctx.lineWidth = 2; ctx.setLineDash([8, 6]);
  ctx.beginPath();
  if (rotationDeg === 90 || rotationDeg === 270) {
    // 90/270에서는 버퍼 로컬 세로선으로 그려야 회전 후 화면에서 가로로 보인다.
    ctx.moveTo(y, 0); ctx.lineTo(y, ch);
  } else {
    ctx.moveTo(0, y); ctx.lineTo(cw, y);
  }
  ctx.stroke();
  ctx.setLineDash([]);
}

export default function JumpPrecisionAnalysis({ member, onBack, onSaveToFirebase, onSave, onMemberHeightChange, onManualComplete, onComplete, onOpenSavedReport, jumpType = 'power', jumpSubType = 'cmj', leg = null }) {
  const saveToFirebase = onSaveToFirebase || onSave;
  // [2026-08-10 추가] 세부 종류(CMJ/SJ/DJ/SLJ/RSI)에 따른 파생값. jumpType은
  // 기존 그대로 'power'|'reactive' 엔진 분기용으로 계속 쓰고, 아래 두 값만
  // 새로 추가— 안 넘기면(jumpSubType 기본값 'cmj') 전부 기존 RSI(연속) 동작과
  // 동일한 상수(RSI_REQUIRED_JUMPS=3, override 없음)로 떨어져 회귀가 없다.
  const requiredJumps = requiredJumpsFor(jumpSubType);
  const minCyclesOverride = minCyclesOverrideFor(jumpSubType);

  const [view, setView] = useState('camera');     // camera | preview
  const [showManual, setShowManual] = useState(false);
  const [phase, setPhase] = useState('arming');    // arming | low_visibility | ready | air
  const [calibMsg, setCalibMsg] = useState('');
  const [reportData, setReportData] = useState(null);
  const [poseLoaded, setPoseLoaded] = useState(false);
  const [warning, setWarning] = useState('');
  // 카메라 획득 자체가 실패했는지(권한/기기 사용 중 등) — true 면 경고 배너에
  // '다시 시도' 버튼을 노출한다. 보정 미완료 등 다른 warning 문구와는 구분한다.
  const [cameraFailed, setCameraFailed] = useState(false);
  const [saveState, setSaveState] = useState('idle'); // idle|saving|saved|error
  const [jumpCount, setJumpCount] = useState(0);
  const [rsiCycles, setRsiCycles] = useState([]);
  const [jumpRows, setJumpRows] = useState([]);
  const [liveJump, setLiveJump] = useState({ flightMs: null, heightCm: null });
  // [무릎·고관절 각도 HUD 2026-08-18] 실시간 관절 각도 표시. currentJointAngles()로
  // 매 프레임 계산은 하되, 렌더(setState)는 아래 loop()에서 ~150ms 간격으로만
  // 흘려보낸다(60fps 그대로 setState하면 불필요한 리렌더 폭증 — 다른 값들처럼
  // ref로 최신값을 들고 있다가 스로틀링해서 반영하는 기존 패턴과 동일).
  const [liveAngles, setLiveAngles] = useState({ knee: null, hip: null });
  const liveAnglesTsRef = useRef(0);
  // [점프 리플레이 그래프 2026-08-20] 라이브 무게중심 높이 파형 — "서 있는
  // 기준선 대비 지금 얼마나 뜨고 가라앉았는가"를 측정 중에 실시간으로 그려
  // 보여준다(비디오 동기화 아님 — 그건 측정 종료 후 리포트 화면의
  // JumpReplayGraph가 담당). armed(측정 단계)에서만 값이 쌓인다 —
  // biomechAccRef가 그 전엔 'stand' 표본을 안 모으므로 자연히 비어 있다.
  const [liveHeightSeries, setLiveHeightSeries] = useState([]);
  const liveHeightTsRef = useRef(0);
  // 측정 시작 게이트: 스켈레톤이 잡혀도 자동으로 측정을 시작하지 않고,
  // 사용자가 '측정 시작' 버튼을 누르면 3초 카운트다운 후 측정을 개시한다.
  const [armed, setArmed] = useState(false);       // true → 점프 트래킹/녹화 진행 중
  const [countdown, setCountdown] = useState(null); // 3,2,1 표시값. null이면 비표시.

  // 키/체중 입력 팝업 (회원 미정 또는 신체정보 부족 시)
  const initialWeight = resolveWeight(member);
  const [heightCm, setHeightCm] = useState(member?.height ? Number(member.height) : null);
  const [bodyWeight, setBodyWeight] = useState(initialWeight);
  const [needHeight, setNeedHeight] = useState(!member?.height || (!member?.id && initialWeight == null));
  const [heightInput, setHeightInput] = useState('');
  const [weightInput, setWeightInput] = useState(initialWeight ? String(initialWeight) : '');

  const videoRef = useRef(null);
  const skeletonCanvasRef = useRef(null);
  const streamRef = useRef(null);
  const reqFrameRef = useRef(null);
  const [rotationDeg, cycleRotation] = useCameraRotation();
  const lastTsRef = useRef(0);
  const viewRef = useRef('camera');
  const phaseRef = useRef('arming');

  const calibRef = useRef(null);     // StandingCalibrator
  const trackerRef = useRef(null);   // JumpFlightTracker
  const biomechAccRef = useRef(null); // JumpBiomechAccumulator
  const prevInAirRef = useRef(false);
  const landFramesLeftRef = useRef(0);
  const frameDtRef = useRef([]);     // 측정 단계 프레임 간격(ms) 모음 — RSI fps 경고용
  const orientRef = useRef(null);    // OrientationVoter — 반응(RSI) 모드 측면뷰 강제용
  const prevFrameTsRef = useRef(0);  // 직전 프레임 타임스탬프(간격 계산용)
  const heightRef = useRef(heightCm);
  const weightRef = useRef(bodyWeight);
  // [2026-08-10 추가 — SLJ] rotationDegRef 등과 동일한 이유로 ref 미러링한다:
  // resetPipeline()이 mount-effect 안 startCamera()에서도 호출되는데, 그
  // 이펙트가 leg를 직접(클로저로) 참조하면 이후 다리를 바꿔도 옛값을 볼 수
  // 있다 — 항상 최신값을 읽도록 ref로 감싼다.
  const legRef = useRef(leg);
  const overlayRef = useRef({});
  const autoSavedRef = useRef(null);
  // 점프별 카드 동결 — 다음 점프가 착지해 사이클이 완성된 점프의 카드값
  //  (flightMs·heightCm·contactMs·rsi)을 no 키로 고정한다. 이후 트래커가
  //  뒤 프레임으로 착지/이지 시점을 미세 보정해도 이미 나온 카드는 불변
  //  (VBT 렙 카드 동결과 동일 계약 — 반복 기록은 측정되면 고정).
  const jumpFreezeRef = useRef(new Map());
  const armedRef = useRef(false);          // 측정 개시 게이트(루프에서 참조)
  const calibLockedRef = useRef(false);    // 캘리브레이션 잠금 완료 여부
  const countdownTimerRef = useRef(null);  // 카운트다운 인터벌 정리용
  // [2026-07-31] rotationDeg를 loop()가 직접 클로저로 참조하면, loop는
  // startVisionPipeline() 호출 시점에 딱 한 번 만들어져 계속 자기 자신을
  // requestAnimationFrame으로 재호출하는 장수(長壽) 클로저라 그 시점 이후의
  // rotationDeg 변경(회전 버튼 클릭 등)을 못 본다 — 화면(JSX)은 매 렌더 최신
  // rotationDeg를 그대로 쓰므로 비디오는 항상 맞게 보이는데, loop 안의
  // drawBaseline만 옛값을 써서 기준선이 어긋나 보였다(armedRef 등과 동일하게
  // ref로 미러링해 loop가 항상 최신값을 읽게 한다).
  const rotationDegRef = useRef(0);

  // 오버레이 녹화 파이프라인 (보행과 동일 구조)
  const recordCanvasRef = useRef(null);
  const recordStreamRef = useRef(null);
  const composeRafRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const recordedBlobRef = useRef(null);
  const recStartedAtRef = useRef(0);
  const jumpCountRef = useRef(0);
  const bestHeightRef = useRef(null);

  useEffect(() => { viewRef.current = view; }, [view]);
  useEffect(() => { phaseRef.current = phase; }, [phase]);
  useEffect(() => { armedRef.current = armed; }, [armed]);
  useEffect(() => { rotationDegRef.current = rotationDeg; }, [rotationDeg]);
  useEffect(() => { heightRef.current = heightCm; }, [heightCm]);
  useEffect(() => { weightRef.current = bodyWeight; }, [bodyWeight]);
  useEffect(() => { legRef.current = leg; }, [leg]);
  useEffect(() => {
    overlayRef.current = {
      jumpType,
      phase,
      jumpCount,
      liveJump,
      rsiCycles,
      latestCycle: rsiCycles.at(-1) || null,
      jumpRows,
      bestHeight: bestHeightRef.current,
      heightCm,
      requiredJumps,
      liveAngles,
    };
  }, [jumpType, phase, jumpCount, liveJump, rsiCycles, jumpRows, heightCm, requiredJumps, liveAngles]);

  // 카메라 생명주기
  useEffect(() => {
    if (view === 'camera' && !streamRef.current && !needHeight) startCamera();
    else if (view === 'preview') stopCamera();
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, needHeight]);

  useEffect(() => () => stopCamera(), []);
  // [2026-07-30] 되돌림: 화면 간 포즈 모델 공유 캐시가 인식 실패(광범위 회귀)를
  // 유발한 것으로 추정되어, 나갈 때마다 모델을 다시 닫는 원래 방식으로 복원.
  useEffect(() => () => closePoseLandmarker(), []);
  useEffect(() => () => { if (countdownTimerRef.current) clearInterval(countdownTimerRef.current); }, []);
  // 카메라 측정 화면: 확대 잠금 (언마운트 시 복원)
  useEffect(() => { lockZoom(); return () => unlockZoom(); }, []);

  const resetPipeline = () => {
    calibRef.current = new StandingCalibrator({ heightCm: heightRef.current, forcedAnkleSide: legRef.current });
    trackerRef.current = null;
    biomechAccRef.current = new JumpBiomechAccumulator({ heightCm: heightRef.current });
    prevInAirRef.current = false;
    landFramesLeftRef.current = 0;
    frameDtRef.current = [];
    prevFrameTsRef.current = 0;
    setPhase('arming');
    setArmed(false);
    armedRef.current = false;
    calibLockedRef.current = false;
    setCountdown(null);
    if (countdownTimerRef.current) { clearInterval(countdownTimerRef.current); countdownTimerRef.current = null; }
    setJumpCount(0);
    setRsiCycles([]);
    setJumpRows([]);
    jumpFreezeRef.current = new Map(); // 렙/점프 카드 동결 초기화
    setLiveJump({ flightMs: null, heightCm: null });
    setLiveAngles({ knee: null, hip: null }); // [무릎·고관절 각도 HUD 2026-08-18]
    liveAnglesTsRef.current = 0;
    setLiveHeightSeries([]); // [점프 리플레이 그래프 2026-08-20]
    liveHeightTsRef.current = 0;
    setReportData(null);
    setSaveState('idle');
    autoSavedRef.current = null;
    jumpCountRef.current = 0;
    bestHeightRef.current = null;
    recordedBlobRef.current = null;
  };

  const startCamera = async () => {
    setWarning('');
    setCameraFailed(false);
    try {
      // 단발성 getUserMedia 대신 공통 헬퍼 사용: exact deviceId → environment
      // 1080p → 720p → 단순 environment → 임의 카메라 순으로 재시도해
      // 특정 제약 조건 실패(OverconstrainedError 등)로 통째 실패하지 않는다.
      const stream = await openMainCameraStream({ audio: false });
      streamRef.current = stream;
      // ref.current 를 지역 변수로 한 번만 캡처 — await 도중 컴포넌트가
      // 언마운트돼 videoRef.current 가 null 로 바뀌어도(예: 초기화 중 화면
      // 이탈) 아래 play() 호출이 null 참조로 죽지 않는다(usePoseEngine 동일).
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        // 메타데이터(해상도)가 준비되기 전에 재생을 시작하면 videoWidth 가 0인
        // 프레임이 한동안 이어져 포즈 인식이 "자세 인식 중..."에 멈춰 보일 수
        // 있다 — usePoseEngine 과 동일하게 loadedmetadata 를 짧게 기다린다.
        if (!video.videoWidth) {
          await new Promise((res) => {
            let done = false;
            const finish = () => { if (!done) { done = true; res(); } };
            video.addEventListener('loadedmetadata', finish, { once: true });
            setTimeout(finish, 1500); // 안전장치
          });
        }
        try { await video.play(); } catch (e) { /* 자동재생 정책: 무음·playsInline이라 보통 통과 */ }
      }
      loadPoseLandmarker({ numPoses: 1, modelTier: 'full' })
        .then(() => setPoseLoaded(true))
        .catch((e) => { setPoseLoaded(false); setWarning(e?.message || 'AI 분석 모듈 로드 실패'); });
      resetPipeline();
      startVisionPipeline();
    } catch (err) {
      // 실제 원인(권한 거부/기기 사용 중/카메라 없음 등)에 맞는 메시지 +
      // 재시도 버튼(cameraFailed)을 노출해, 일시적 실패로 화면이 영구히
      // 멈추지 않게 한다("기준 다시 잡기"는 카메라 재획득을 하지 않으므로
      // 별도 재시도 경로가 필요했다).
      setCameraFailed(true);
      setWarning(describeCameraError(err));
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    if (reqFrameRef.current) { cancelAnimationFrame(reqFrameRef.current); reqFrameRef.current = null; }
    if (composeRafRef.current) { cancelAnimationFrame(composeRafRef.current); composeRafRef.current = null; }
    if (recordStreamRef.current) { recordStreamRef.current.getTracks().forEach(t => t.stop()); recordStreamRef.current = null; }
  };

  // 오버레이(스켈레톤 없이 측정값 텍스트) 합성 녹화 스트림 — 보행과 동일 구조.
  const createRecordedStream = () => {
    const video = videoRef.current;
    const canvas = recordCanvasRef.current || document.createElement('canvas');
    canvas.width = REC_SIZE.width; canvas.height = REC_SIZE.height;
    recordCanvasRef.current = canvas;
    const ctx = canvas.getContext('2d', { alpha: false });
    const draw = () => {
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      drawCoverJump(ctx, video, canvas.width, canvas.height, rotationDegRef.current);
      drawJumpLiveOverlay(ctx, canvas.width, canvas.height, {
        ...overlayRef.current,
        phase: phaseRef.current,
        jumpCount: jumpCountRef.current,
        bestHeight: bestHeightRef.current,
      });
      composeRafRef.current = requestAnimationFrame(draw);
    };
    if (composeRafRef.current) cancelAnimationFrame(composeRafRef.current);
    draw();
    const cs = canvas.captureStream ? canvas.captureStream(RECORD_FPS) : null;
    if (!cs) return streamRef.current;
    const mixed = new MediaStream();
    cs.getVideoTracks().forEach(t => mixed.addTrack(t));
    recordStreamRef.current = mixed;
    return mixed;
  };

  const startRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') return;
    chunksRef.current = [];
    recStartedAtRef.current = performance.now();
    // [2026-08-03] 로컬 mp4-우선 배열 대신 공용 pickRecorderMime()을 쓴다 —
    // 코덱까지 명시해야 크로미움에서 mp4가 실제로 잡힌다(recordSink.js 참고).
    const mime = pickRecorderMime();
    try {
      const stream = createRecordedStream();
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      mediaRecorderRef.current = rec;
      rec.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      rec.onstop = () => {
        if (composeRafRef.current) { cancelAnimationFrame(composeRafRef.current); composeRafRef.current = null; }
        if (recordStreamRef.current) { recordStreamRef.current.getTracks().forEach(t => t.stop()); recordStreamRef.current = null; }
        recordedBlobRef.current = chunksRef.current.length ? new Blob(chunksRef.current, { type: mime || 'video/webm' }) : null;
      };
      rec.start();
    } catch (e) { /* 녹화 불가 환경 — 측정은 계속 */ }
  };

  const stopRecording = () => new Promise((resolve) => {
    const rec = mediaRecorderRef.current;
    if (!rec || rec.state !== 'recording') { resolve(); return; }
    rec.onstop = ((orig) => function (...a) { orig?.apply(this, a); resolve(); })(rec.onstop);
    try { rec.stop(); } catch (e) { resolve(); }
  });

  // '측정 시작' 버튼 → 3초 카운트다운(큰 숫자 + 소리) 후 측정 개시.
  const beginCountdown = () => {
    if (armed || countdown != null) return;             // 중복 시작 방지
    // [2026-07-30] "기준 미확보 시 무시" 가드 제거 — 촬영 대상자가 카메라 앞이
    // 아니라 노트북 앞에서 버튼을 누르는 경우(또는 트레이너가 미리 눌러두는
    // 경우)를 지원한다. 카운트다운은 캘리브레이션과 무관하게 시작되고, 실제
    // 점프 트래킹은 아래 루프가 calib.locked 를 계속 기다렸다가 시작한다.
    primeAudio();                                      // 사용자 제스처에서 오디오 워밍업
    let n = 3;
    setCountdown(n);
    beepTick();
    if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
    countdownTimerRef.current = setInterval(() => {
      n -= 1;
      if (n > 0) {
        setCountdown(n);
        beepTick();
      } else {
        // 0 → 측정 시작(armed). 트래커 생성은 실제로 캘리브레이션이 끝나는 시점에
        // 루프에서 한다 — 버튼을 미리 눌러서 카운트다운이 캘리브레이션보다 먼저
        // 끝나는 경우(촬영 대상자가 이제 막 자리로 이동 중인 경우)를 지원하기 위함.
        clearInterval(countdownTimerRef.current);
        countdownTimerRef.current = null;
        setCountdown(null);
        beepGo();
        startRecording();
        setArmed(true);
        armedRef.current = true;
      }
    }, 1000);
  };

  const startVisionPipeline = () => {
    if (reqFrameRef.current) cancelAnimationFrame(reqFrameRef.current);
    let lastPhase = null, lastMsg = null;
    const setPhaseOnce = (v) => { if (v !== lastPhase) { lastPhase = v; setPhase(v); } };
    const setMsgOnce = (v) => { if (v !== lastMsg) { lastMsg = v; setCalibMsg(v); } };
    let lastCount = 0;

    const loop = () => {
      const video = videoRef.current;
      let ts = performance.now();
      if (ts <= lastTsRef.current) ts = lastTsRef.current + 1;
      lastTsRef.current = ts;

      let landmarks = null;
      try {
        const res = detectPoseFrame(video, ts);
        landmarks = res?.landmarks || null;
      } catch (e) { landmarks = null; }

      const calib = calibRef.current;
      let tracker = trackerRef.current;

      // 스켈레톤 + 기준선 — 라이브 오버레이는 CameraStage와 같은 CSS 회전
      // 래퍼를 공유하므로 원본(raw) 좌표를 그대로 쓴다(이중 회전 방지).
      try {
        const ph = tracker ? (tracker.inAir ? 'air' : 'ready') : 'arming';
        drawSkeleton(skeletonCanvasRef.current, video, landmarks, ph);
        if (calib?.result) drawBaseline(skeletonCanvasRef.current, video, calib.result.baselineFeetY, rotationDegRef.current);
      } catch (e) { /* noop */ }

      // [2026-08-02] 카메라 원본이 회전된 채로 들어오는 기종(키오스크) 보정 —
      // 점프 높이는 발/골반의 "수직" 변위를 재는 판정이라, 회전 보정 없이는
      // 완전히 다른 축(좌우 흔들림 등)을 재게 된다. 캘리브레이션·트래킹·
      // 생체역학 누적·방향 판별 전부 보정된 좌표를 써야 한다.
      const corrected = landmarks ? rotateLandmarksNormalized(landmarks, rotationDegRef.current) : null;

      // [무릎·고관절 각도 HUD 2026-08-18] 위상(calib/armed)과 무관하게 지금
      // 보이는 프레임의 관절 각도를 HUD에 흘려보낸다. 매 프레임 계산은 가볍지만
      // (좌표 몇 개로 각도 계산) setState는 ~150ms 간격으로 스로틀링해 리렌더가
      // 과도하게 일어나지 않게 한다(다른 라이브 값들과 동일한 절제 패턴).
      if (corrected && viewRef.current === 'camera' && ts - liveAnglesTsRef.current > 150) {
        liveAnglesTsRef.current = ts;
        const ang = currentJointAngles(corrected);
        if (ang.knee != null || ang.hip != null) setLiveAngles(ang);
      }

      if (corrected && viewRef.current === 'camera') {
        if (!calib.locked) {
          // ── 캘리브레이션 단계 ──
          calib.push(corrected, ts);
          const st = calib.status();
          if (st.ready) {
            // 락 완료 → 기준 확보. 단, 자동으로 측정을 시작하지 않는다.
            // 사용자가 '측정 시작' 버튼 → 3초 카운트다운 후 armed 가 되면 측정 개시.
            calibLockedRef.current = true;
            setPhaseOnce('ready');
            // [2026-07-31] 정상 잠금이면 문구를 비우고, 타임아웃 폴백으로
            // 잠긴 거면(정확도가 덜 검증된 임시 기준) 알려준다 — "기준 다시
            // 잡기"를 눌러 카메라 위치를 조정한 뒤 재시도할 수 있도록.
            setMsgOnce(calib.result?.basis === 'timeout_fallback'
              ? '기준을 임시로 잡았습니다(정확도 낮을 수 있음) — 카메라 위치를 조정했다면 기준 다시 잡기를 눌러보세요'
              : '');
          } else if (st.reason === 'low_visibility') {
            // 요구사항 3: 자세 불안정 → 측정 차단 경고
            // [2026-07-31] 실제 인식률(%)을 같이 보여준다 — "발목을 못 잡는다"는
            // 리포트를 트레이너가 스스로 진단할 수 있게(예: 인식률이 계속
            // 한 자릿수면 카메라 거리·각도·조명 조정이 필요하다는 신호).
            setPhaseOnce('low_visibility');
            setMsgOnce(`발/골반 인식률 ${Math.round((st.visRatio || 0) * 100)}% — 카메라에 발까지 잘 보이게 서 주세요`);
          } else {
            setPhaseOnce('arming');
            setMsgOnce(`자세 보정 중... ${Math.round(st.progress * 100)}%`);
          }
        } else if (!armedRef.current) {
          // ── 측정 대기 단계: 기준은 잡혔으나 아직 '측정 시작' 전 ──
          // 스켈레톤만 계속 그리고, 점프 트래킹/녹화는 하지 않는다.
          setPhaseOnce('ready');
          setMsgOnce('');
        } else {
          // ── 측정 단계 ── (armed=true 시점에 트래커가 아직 없으면 여기서 생성 —
          // 카운트다운이 캘리브레이션보다 먼저 끝난 경우 대비)
          if (!trackerRef.current) {
            trackerRef.current = new JumpFlightTracker(calib.result);
            trackerRef.current.calibHeightCm = heightRef.current;
            orientRef.current = jumpType === 'reactive' ? new OrientationVoter() : null;
            prevInAirRef.current = false;
            landFramesLeftRef.current = 0;
            frameDtRef.current = [];
            prevFrameTsRef.current = 0;
          }
          tracker = trackerRef.current; // 위에서 방금 생성됐을 수 있으니 다시 읽는다
          // 프레임 간격(ms) 수집 — RSI 접지시간 정확도(fps) 판정용
          tracker.push(corrected, ts);
          const curInAir = tracker.inAir;
          const prevInAir = prevInAirRef.current;
          if (prevInAir && !curInAir) landFramesLeftRef.current = LAND_WINDOW;
          const landActive = landFramesLeftRef.current > 0;
          const { phase: jp, justTookOff } = jumpPhaseOf(prevInAir, curInAir, landActive);
          biomechAccRef.current?.push(corrected, ts, jp, justTookOff);
          // [점프 리플레이 그래프 2026-08-20] 라이브 파형 — 무릎/고관절 각도와
          // 동일한 스로틀 절제(100ms) 후 setState. 롤링 윈도우(최근 60개 표본
          // ≈ 6초)만 유지해 메모리·리렌더 부담을 낮춘다.
          if (ts - liveHeightTsRef.current > 100) {
            liveHeightTsRef.current = ts;
            const comYNow = pelvisCenterY(corrected);
            const h = biomechAccRef.current?.liveComHeightCm(comYNow) ?? null;
            setLiveHeightSeries((prev) => {
              const next = [...prev, { tMs: ts, comHeightCm: h }];
              return next.length > 60 ? next.slice(-60) : next;
            });
          }
          if (landActive && !curInAir) landFramesLeftRef.current--;
          prevInAirRef.current = curInAir;
          // 반응(RSI) 모드: 측면뷰 판정용 방향 누적.
          // ⚠ 공중(air) 프레임은 자세가 왜곡되어(팔 스윙, 몸통 회전 등) 방향 오판을
          //   유발할 수 있다 — JumpBiomechAccumulator.push 의 방향 투표(354행 부근)와
          //   동일하게 공중 프레임은 제외한다. RSI는 반응 점프 특성상 체공 비중이
          //   커서(파워 점프 대비) 이 필터를 빼먹으면 투표가 쉽게 오염된다.
          if (orientRef.current && jp !== 'air') orientRef.current.push(corrected);
          const prevTs = prevFrameTsRef.current;
          if (prevTs > 0) {
            const dt = ts - prevTs;
            if (dt > 0 && dt < 200) {
              const arr = frameDtRef.current;
              arr.push(dt);
              if (arr.length > 300) arr.shift();
            }
          }
          prevFrameTsRef.current = ts;
          setPhaseOnce(tracker.inAir ? 'air' : 'ready');
          const c = tracker.flights.length;
          if (c !== lastCount) {
            lastCount = c; setJumpCount(c); jumpCountRef.current = c;
            // 오버레이용 최고 높이 갱신
            try {
              const s = tracker.summary({ heightCm: heightRef.current });
              if (s?.heightCm != null) bestHeightRef.current = s.heightCm;
              const latest = tracker.flights.at(-1);
              let nextLiveJump = overlayRef.current.liveJump || { flightMs: null, heightCm: null };
              if (latest?.flightMs) {
                const jump = calcJump(latest.flightMs / 1000, null);
                nextLiveJump = {
                  flightMs: Math.round(latest.flightMs),
                  heightCm: jump?.heightCm ?? null,
                };
                setLiveJump(nextLiveJump);
              }
              let nextCycles = [];
              let nextRows = [];
              if (jumpType === 'reactive') {
                const cyclePreview = buildRsiCyclePreview(tracker.flights);
                nextCycles = cyclePreview;
                nextRows = applyRepFreeze(
                  flightRows(tracker.flights, cyclePreview),
                  jumpFreezeRef.current, tracker.flights.length,
                );
                setRsiCycles(nextCycles);
                setJumpRows(nextRows);
              } else {
                nextRows = applyRepFreeze(
                  flightRows(tracker.flights, []),
                  jumpFreezeRef.current, tracker.flights.length,
                );
                setJumpRows(nextRows);
              }
              overlayRef.current = {
                ...overlayRef.current,
                jumpType,
                phase: phaseRef.current,
                jumpCount: c,
                liveJump: nextLiveJump,
                rsiCycles: nextCycles,
                latestCycle: nextCycles[nextCycles.length - 1] || null,
                jumpRows: nextRows,
                bestHeight: bestHeightRef.current,
                heightCm: heightRef.current,
              };
            } catch (e) { /* noop */ }
          }
        }
      } else if (viewRef.current === 'camera') {
        if (!calib?.locked) {
          setPhaseOnce('arming');
          setMsgOnce(isPoseReady()
            ? '전신(머리~발)이 화면에 들어오게 해주세요'
            : 'AI 분석 모듈 로딩 중...');
        }
      }

      reqFrameRef.current = requestAnimationFrame(loop);
    };
    loop();
  };

  // 측정 종료 → 결과 산출
  const finishMeasure = async () => {
    const tracker = trackerRef.current;
    if (!tracker) { setWarning('아직 보정이 끝나지 않았습니다.'); return; }
    // 오버레이 녹화 종료 → blob 확보
    await stopRecording();
    const videoBlob = recordedBlobRef.current || null;
    const sum = tracker.summary({ heightCm: heightRef.current });
    const biomech = biomechAccRef.current?.summary() || null;
    // [점프 리플레이 그래프 2026-08-20] biomech.timeline의 tMs는
    // performance.now() 절대값 — 녹화 영상(videoBlob)의 currentTime(0부터
    // 시작)과 동기화하려면 녹화 시작 시각(recStartedAtRef, startRecording()에서
    // 기록)을 원점으로 다시 맞춰야 한다. armed 진입과 녹화 시작이 같은 틱에서
    // 일어나므로(beginCountdown 참고) 거의 항상 0 근처에서 시작하지만, 정확한
    // 동기화를 위해 명시적으로 재계산한다. 녹화 시작 이전 표본(음수)은
    // 영상에 없는 구간이라 버린다.
    if (biomech?.timeline?.length && recStartedAtRef.current) {
      const t0 = recStartedAtRef.current;
      biomech.timeline = biomech.timeline
        .map((p) => ({ ...p, tMs: Math.round(p.tMs - t0) }))
        .filter((p) => p.tMs >= 0);
    }
    // performance.calcJump 로 파워(Sayers)까지 일관 산출 (체중 있으면)
    const power = calcJump(sum.flightTimeSec, resolveWeight(member, weightRef.current));

    // ── 반응 탄성 점프 모드: 사이클 간 접지시간으로 RSI 산출 ──
    // 측면뷰 강제: 누적된 방향이 'side'가 아니면 코어가 무효 처리한다.
    let rsiResult = null;
    if (jumpType === 'reactive') {
      const dts = frameDtRef.current.slice().sort((a, b) => a - b);
      const medDt = dts.length ? dts[Math.floor(dts.length / 2)] : null;
      const decidedView = orientRef.current ? orientRef.current.decide() : undefined;
      rsiResult = computeRSIFromFlights(tracker.flights, {
        frameIntervalMs: medDt,
        view: decidedView,
        minCycles: minCyclesOverride, // null이면(RSI 연속) 코어가 기존 RSI_TUNING.minCycles(3) 그대로 씀
      });
    }
    const liveCyclePreview = buildRsiCyclePreview(tracker.flights);
    // perCycleByIndex(무효 구간 null 보존)를 써야 "#N 점프"가 실제 N번째 점프의
    // 값과 짝지어진다 — perCycle(무효 제외)을 쓰면 위와 동일한 index shift가
    // 저장되는 리포트(report.perJump)에도 그대로 들어간다.
    const perJump = allFlightRows(tracker.flights, rsiResult?.perCycleByIndex || liveCyclePreview);

    const report = {
      ...sum,
      heightCm: sum.heightCm,
      takeoffVelocity: sum.takeoffVelocity,
      peakPower: power?.peakPower ?? null,
      bodyWeight: resolveWeight(member, weightRef.current),
      calibHeightCm: heightRef.current,
      jumpType,                       // 'power' | 'reactive' (엔진 — 하위호환 유지)
      jumpSubType,                    // 'cmj' | 'sj' | 'dj' | 'slj' | 'rsi' (세부 종류)
      leg: jumpSubType === 'slj' ? leg : null, // SLJ만 의미 있음
      rsi: rsiResult,                 // 반응 모드에서만 채워짐(null 가능)
      source: 'live',
      videoBlob, // 오버레이 합성 녹화본 (저장은 안 함, 화면에서 '동영상 저장'에 사용)
      perJump,
      videoMetrics: {
        overlayRecorded: Boolean(videoBlob),
        recordingFps: RECORD_FPS,
        recommendedView: jumpType === 'reactive' ? 'side' : 'front',
        detectedView: biomech?.view ?? null,
      },
      biomech,
      member: { id: member?.id || null, name: member?.name || null },
      measuredAt: new Date().toISOString(),
    };
    // 반응 모드는 RSI(접지시간) 측정 성공 여부까지 유효성에 반영
    if (jumpType === 'reactive') {
      report.valid = report.valid === true && rsiResult?.valid === true;
      if (rsiResult && rsiResult.valid !== true) report.reason = rsiResult.reason;
    }
    stopCamera();
    // [SLJ 다리 자동전환 2026-08-19] onComplete가 있으면(JumpAnalysisHub.jsx가
    // 항상 넘겨줌) 여기서 직접 미리보기를 띄우거나 저장하지 않고 Hub로 결과를
    // 그대로 넘긴다 — '고속영상 업로드'(JumpUploadAnalysis.jsx)가 이미 쓰고
    // 있는 것과 동일한 onComplete 패턴이다. 이렇게 해야 Hub의 기록확인→
    // 다회차평균(combineJumpTrials)→(SLJ) "반대쪽 다리도 측정할까요?" 프롬프트가
    // 라이브 카메라 경로에도 똑같이 걸린다 — 예전엔 라이브만 이 흐름을 건너뛰고
    // 여기서 곧장 Firestore에 개별 저장해서, SLJ 왼쪽→오른쪽 자동 전환이 라이브
    // 모드에서는 아예 동작하지 않았다(Hub 쪽 로직 자체가 호출되지 않았으므로).
    // onComplete가 없는 호출부(예전 방식/독립 사용)에서는 기존처럼 이 화면
    // 자체에서 미리보기 + 자동저장한다(하위호환 — 아래 else 분기).
    if (typeof onComplete === 'function') {
      await onComplete(report);
      return;
    }
    setReportData(report);
    setView('preview');
    // 유효 측정만 자동 저장 (gait 와 동일 철학) — videoBlob 은 저장 페이로드에서 제외
    if (report.valid === true && saveToFirebase && autoSavedRef.current !== report.measuredAt) {
      autoSavedRef.current = report.measuredAt;
      const { videoBlob: _vb, ...dataOnly } = report;
      autoSave(dataOnly);
    }
  };

  const autoSave = async (report) => {
    setSaveState('saving');
    try {
      const saved = await saveToFirebase(report);
      setSaveState('saved');
      return { ok: true, saved };
    }
    catch (e) { setSaveState('error'); return { ok: false, saved: null }; }
  };

  const handleManualSave = async () => {
    if (!reportData || reportData.valid !== true || !saveToFirebase) return;
    // 자동 저장과 동일하게 videoBlob 은 저장 페이로드에서 제외(Firestore 오염 방지).
    const { videoBlob: _vb, ...dataOnly } = reportData;
    autoSavedRef.current = reportData.measuredAt;   // 중복 저장 방지 마킹
    const res = await autoSave(dataOnly);
    if (!res?.ok) return;
    const nextReport = res.saved && typeof res.saved === 'object' ? { ...reportData, ...res.saved } : reportData;
    setReportData(nextReport);
  };

  const retry = () => { setView('camera'); };

  const applyHeight = () => {
    const h = Number(heightInput || heightCm);
    const w = Number(weightInput || bodyWeight);
    if (!h || h < 80 || h > 250) { setWarning('키를 80~250cm로 입력하세요.'); return; }
    if (!w || w < 20 || w > 250) { setWarning('몸무게를 20~250kg으로 입력하세요.'); return; }
    setHeightCm(h);
    setBodyWeight(w);
    heightRef.current = h;
    weightRef.current = w;
    setNeedHeight(false);
    onMemberHeightChange?.(h);
    setWarning('');
  };

  // ── 키/몸무게 입력 팝업 (회원 미정 또는 신체정보 부족) ──
  if (needHeight) {
    return (
      <div className="fixed inset-0 z-[80] bg-slate-50 dark:bg-slate-950 flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-800">
          <button onClick={onBack} className="text-slate-600 dark:text-slate-300 font-bold text-sm">← 뒤로</button>
          <h2 className="text-white font-black">점프 정밀 측정</h2>
          <div className="w-12" />
        </div>
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="w-full max-w-sm bg-white dark:bg-slate-900 border border-amber-500/30 rounded-2xl p-5 space-y-4">
            <div className="text-center space-y-1">
              <p className="text-3xl">📏</p>
              <p className="text-white font-black">키와 몸무게가 필요합니다</p>
              <p className="text-slate-500 dark:text-slate-400 text-xs leading-relaxed">
                {member?.name ? `${member.name} 회원의 ` : '회원 미정 상태입니다. '}
                cm 보정과 파워 계산을 위해 지금 입력해 주세요.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="mb-1 block text-[10px] font-bold text-slate-500">키</span>
                <div className="flex items-center gap-2">
                  <input type="number" inputMode="numeric" value={heightInput}
                    onChange={e => setHeightInput(e.target.value)} placeholder="170"
                    className="min-w-0 flex-1 bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-100 rounded-lg px-3 py-2.5 text-sm font-mono focus:outline-none focus:border-amber-500" />
                  <span className="text-slate-500 dark:text-slate-400 text-xs font-bold">cm</span>
                </div>
              </label>
              <label className="block">
                <span className="mb-1 block text-[10px] font-bold text-slate-500">몸무게</span>
                <div className="flex items-center gap-2">
                  <input type="number" inputMode="decimal" value={weightInput}
                    onChange={e => setWeightInput(e.target.value)} placeholder="70"
                    className="min-w-0 flex-1 bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-100 rounded-lg px-3 py-2.5 text-sm font-mono focus:outline-none focus:border-amber-500" />
                  <span className="text-slate-500 dark:text-slate-400 text-xs font-bold">kg</span>
                </div>
              </label>
            </div>
            <button onClick={applyHeight}
              className="w-full rounded-xl bg-amber-500 text-slate-950 font-black py-3 active:scale-95">
              입력하고 측정 시작
            </button>
            {warning && <p className="text-center text-xs text-red-700 dark:text-red-400">{warning}</p>}
          </div>
        </div>
      </div>
    );
  }

  const phaseColor = phase === 'air' ? 'text-amber-700 dark:text-amber-400'
    : phase === 'ready' ? 'text-emerald-700 dark:text-emerald-400'
    : phase === 'low_visibility' ? 'text-red-700 dark:text-red-400' : 'text-cyan-700 dark:text-cyan-400';

  return (
    <div className="fixed inset-0 z-[80] bg-slate-50 dark:bg-slate-950 overflow-hidden" style={{ height: '100dvh' }}>
      {view === 'camera' && (
        <div className="relative w-full h-full">
          <div className={rotationDeg ? '' : 'absolute inset-0 w-full h-full'} style={rotationDeg ? {
            position: 'absolute', top: '50%', left: '50%',
            width: (rotationDeg === 90 || rotationDeg === 270) ? '100vh' : '100%',
            height: (rotationDeg === 90 || rotationDeg === 270) ? '100vw' : '100%',
            transform: `translate(-50%, -50%) rotate(${rotationDeg}deg)`,
          } : undefined}>
            <video ref={videoRef} className="absolute inset-0 w-full h-full object-contain" playsInline muted />
            <canvas ref={skeletonCanvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />
          </div>

          {/* 헤더 — [2026-08-05] safe-area-inset-top을 안 챙기고 있었다. 노치·
              다이내믹 아일랜드가 있는 폰에서는 이 줄 전체가 시스템 상태바 밑에
              깔려 버튼이 눌리지도, 글자가 보이지도 않았다(CameraStage 기반
              화면들은 이미 이 처리가 돼 있음 — 여긴 자체 헤더라 빠져 있었다). */}
          <div className="absolute top-0 z-20 inset-x-0 flex items-center justify-between px-4 pb-3 bg-gradient-to-b from-black/60 to-transparent"
            style={{ paddingTop: 'calc(env(safe-area-inset-top) + 12px)' }}>
            <button onClick={onBack} className="text-white font-bold text-sm">← 뒤로</button>
            <h2 className="text-white font-black text-sm">점프 정밀 측정</h2>
            <div className="flex items-center gap-1.5">
              <button onClick={cycleRotation}
                className="rounded-full bg-black/55 border border-white/25 text-white text-[10px] font-bold px-2.5 py-1 active:scale-95">
                ↻{rotationDeg ? ` ${rotationDeg}°` : ''}
              </button>
              <SkeletonToggleChip />
            </div>
          </div>

          <JumpLiveOverlay
            jumpType={jumpType}
            phase={phase}
            phaseColor={phaseColor}
            calibMsg={calibMsg}
            heightCm={heightCm}
            jumpCount={jumpCount}
            liveJump={liveJump}
            bestHeight={bestHeightRef.current}
            rsiCycles={rsiCycles}
            jumpRows={jumpRows}
            requiredJumps={requiredJumps}
            liveAngles={liveAngles}
            liveHeightSeries={liveHeightSeries}
          />

          {warning && (
            <div className="absolute top-1/2 inset-x-6 -translate-y-1/2 bg-red-500/90 text-white text-center rounded-xl px-4 py-3 font-bold text-sm space-y-2">
              <p>{warning}</p>
              {cameraFailed && (
                <button onClick={startCamera}
                  className="mx-auto block rounded-lg bg-white text-red-600 px-4 py-1.5 text-xs font-black active:scale-95">
                  다시 시도
                </button>
              )}
            </div>
          )}

          {/* 측정 시작 3초 카운트다운 — 화면 중앙 큰 숫자 */}
          {countdown != null && (
            <div className="absolute inset-0 z-30 flex items-center justify-center pointer-events-none">
              <div className="flex h-44 w-44 items-center justify-center rounded-full bg-black/55 backdrop-blur-sm ring-4 ring-amber-300/80 animate-pulse">
                <span className="font-black text-amber-700 dark:text-amber-300 leading-none" style={{ fontSize: '7rem' }}>
                  {countdown}
                </span>
              </div>
            </div>
          )}

          {/* 하단 컨트롤 */}
          <div className="absolute bottom-[max(24px,calc(env(safe-area-inset-bottom)+24px))] z-20 inset-x-0 flex flex-col items-center gap-3">
            {!armed ? (
              <>
                {/* 측정 시작 전: 녹화버튼 형태의 측정 시작 버튼 */}
                <button
                  onClick={beginCountdown}
                  disabled={countdown != null}
                  className={`flex h-20 w-20 items-center justify-center rounded-full border-4 shadow-lg transition active:scale-95
                    ${countdown == null
                      ? 'border-white bg-red-500'
                      : 'border-white/40 bg-white/15'}`}>
                  <span className="text-[11px] font-black text-white leading-tight text-center whitespace-pre-line">
                    {countdown != null ? String(countdown) : '측정\n시작'}
                  </span>
                </button>
                <p className="text-white/80 text-xs font-bold text-center px-6">
                  {phase === 'ready'
                    ? (calibMsg || '버튼을 누르면 3초 후 측정이 시작됩니다')
                    : (calibMsg || '자세 기준을 잡는 중입니다 — 카메라 앞에 똑바로 서 주세요')}
                </p>
                <div className="flex flex-col items-center gap-2">
                  <button onClick={() => setShowManual(true)}
                    className="text-white/70 text-xs underline underline-offset-2">
                    ✍️ 카메라 대신 수동 입력 (체공시간)
                  </button>
                  {/* 기준(서 있는 자세) 재보정 — 측정 전에도 언제든 다시 잡을 수 있게.
                      [2026-07-31] 누르면 바로 위 문구가 "버튼을 누르면..."에서
                      calibMsg(보정 진행률)로 바뀌는 게 재보정이 실제로 시작됐다는
                      눈에 띄는 확인 신호다 — 예전엔 이 버튼 바로 옆에는 아무 변화가
                      없고(진행률 표시는 화면 위쪽에만, 그나마도 안 그려지고 있었음)
                      "눌러도 반응이 없다"로 보였다. */}
                  <button onClick={resetPipeline}
                    className="rounded-full bg-black/50 border border-white/15 px-3 py-1 text-[11px] font-bold text-white/80 backdrop-blur active:scale-95">
                    ↻ 기준 다시 잡기
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="flex w-full max-w-sm gap-2 px-4">
                  <button
                    onClick={async () => { await stopRecording(); resetPipeline(); }}
                    className="flex-1 rounded-xl bg-black/60 border border-white/15 py-3 text-sm font-black text-white backdrop-blur">
                    측정 취소
                  </button>
                  <button
                    onClick={finishMeasure}
                    disabled={jumpCount < requiredJumps}
                    className={`flex-[1.25] rounded-xl py-3 font-black text-sm shadow-lg transition
                      ${jumpCount >= requiredJumps ? 'bg-emerald-500 text-slate-950 active:scale-95' : 'bg-white/20 text-white/50'}`}>
                    {jumpType === 'reactive'
                      ? `측정 완료 ${jumpCount}/${requiredJumps}`
                      : `측정 완료 ${jumpCount >= 1 ? `(${jumpCount}회)` : ''}`}
                  </button>
                </div>
                {/* 요구사항 8: 수동 입력을 실시간 화면 안에서 바로 (점프매트/타이머 값) */}
                <button onClick={() => setShowManual(true)}
                  className="text-white/70 text-xs underline underline-offset-2">
                  ✍️ 카메라 대신 수동 입력 (체공시간)
                </button>
              </>
            )}
          </div>
          {showManual && (
            <ManualEntryModal member={member} jumpType={jumpType} jumpSubType={jumpSubType} leg={leg}
              onClose={() => setShowManual(false)}
              onSubmit={async (report) => { setShowManual(false); await (onManualComplete || onSaveToFirebase)?.(report); }} />
          )}
        </div>
      )}

      {view === 'preview' && reportData && (
        <JumpReport
          report={reportData}
          saveState={saveState}
          onSave={handleManualSave}
          onRetry={retry}
          onBack={onBack}
          onOpenSavedReport={onOpenSavedReport}
        />
      )}
    </div>
  );
}

// ── 리포트 화면 ──
function JumpReport({ report, saveState, onSave, onRetry, onBack, onOpenSavedReport }) {
  const isRsi = report.jumpType === 'reactive';
  const biomech = report.biomech || {};
  const viewLabel = report.videoMetrics?.detectedView === 'side' ? '측면'
    : report.videoMetrics?.detectedView === 'back' ? '정면'
    : '미확인';
  const recommendedView = report.videoMetrics?.recommendedView === 'side' ? '측면'
    : report.videoMetrics?.recommendedView === 'front' ? '정면'
    : '미지정';
  const measuredAt = report.measuredAt
    ? new Date(report.measuredAt).toLocaleString('ko-KR', { hour12: false })
    : '—';
  // 등급 배지: 파워 점프는 점프 높이 기준, RSI는 반응 탄성(RSI 비율) 기준.
  // ⚠ 회귀 방지: 예전에는 RSI 리포트에도 파워 점프용 키 임계값(50/40/30cm)을
  //   그대로 썼다. RSI(반응 탄성)는 접지시간을 최소화하는 게 목적이라 점프
  //   높이 자체가 낮게 나오는 게 정상인데, 그 값을 파워 점프 기준으로 채점하면
  //   거의 모든 정상적인 RSI 측정이 "개선 필요"로 표시된다. computeRSIFromFlights
  //   가 이미 RSI 비율 기준으로 계산해 둔 rsi.grade를 그대로 쓴다.
  const grade = !report.valid ? null
    : isRsi
      ? (report.rsi?.grade
          ? { label: report.rsi.grade.label, color: `text-${report.rsi.grade.tone}-400` }
          : { label: '평가 불가', color: 'text-slate-500 dark:text-slate-400' })
      : report.heightCm >= 50 ? { label: '매우 우수', color: 'text-blue-700 dark:text-blue-400' }
      : report.heightCm >= 40 ? { label: '우수', color: 'text-emerald-700 dark:text-emerald-400' }
      : report.heightCm >= 30 ? { label: '보통', color: 'text-amber-700 dark:text-amber-400' }
      : { label: '개선 필요', color: 'text-red-700 dark:text-red-400' };

  const cc = report.crossCheck || {};
  return (
    <div className="absolute inset-0 bg-slate-50 dark:bg-slate-950 flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-800">
        <button onClick={onRetry} className="text-slate-600 dark:text-slate-300 font-bold text-sm">← 다시 측정</button>
        <h2 className="text-white font-black">측정 리포트</h2>
        <button onClick={onBack} className="text-slate-500 dark:text-slate-400 text-sm font-bold">닫기</button>
      </div>

      <div id="jump-live-report-sheet" className="flex-1 overflow-y-auto p-5 space-y-4">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">Jump Report</p>
              <p className="text-xl font-black text-white">{isRsi ? 'RSI 반응 점프' : '파워 점프'} 결과 리포트</p>
            </div>
            <span className="shrink-0 rounded-full bg-slate-100 dark:bg-slate-800 px-3 py-1 text-xs font-bold text-slate-700 dark:text-slate-200">
              {report.source === 'live' ? '실시간 측정' : '영상 분석'}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <InfoRow label="회원" value={report.member?.name || '회원 미정'} />
            <InfoRow label="측정일" value={measuredAt} />
            <InfoRow label="권장 방향" value={recommendedView} />
            <InfoRow label="감지 방향" value={viewLabel} />
            <InfoRow label="기준 키" value={report.calibHeightCm ? `${report.calibHeightCm}cm` : '—'} />
            <InfoRow label="체중" value={report.bodyWeight ? `${report.bodyWeight}kg` : '미입력'} />
          </div>
        </div>

        {report.valid !== true ? (
          <div className="bg-red-500/10 border border-red-500/40 rounded-2xl p-5 text-center space-y-2">
            <p className="text-3xl">⚠</p>
            <p className="text-red-700 dark:text-red-400 font-black">측정 무효</p>
            <p className="text-slate-600 dark:text-slate-300 text-sm">
              {report.reason === 'no_jump' ? '점프 동작이 감지되지 않았습니다.'
                : report.reason === 'sanity_fail' ? '측정값이 키 대비 비현실적입니다. 카메라 각도/위치를 확인하고 다시 측정하세요.'
                : report.rsi?.message ? report.rsi.message
                : '측정이 무효합니다. 다시 시도해 주세요.'}
            </p>
          </div>
        ) : (
          <>
            <div className="bg-white dark:bg-slate-900 border border-amber-500/30 rounded-2xl p-5 space-y-3">
              <div className="flex items-baseline justify-between">
                <p className="text-xs font-bold text-amber-700 dark:text-amber-400 uppercase tracking-widest">점프 높이</p>
                <p className={`text-sm font-bold ${grade.color}`}>{grade.label}</p>
              </div>
              <p className="text-center font-mono font-black text-6xl text-slate-800 dark:text-slate-100">
                {report.heightCm}<span className="text-xl text-slate-500"> cm</span>
              </p>
              <div className="grid grid-cols-3 gap-2 text-center">
                <Stat label="체공시간" value={`${report.flightTimeMs}ms`} />
                <Stat label="이륙속도" value={`${report.takeoffVelocity} m/s`} />
                <Stat label="최고파워" value={report.peakPower != null ? `${report.peakPower}W` : '체중 미입력'} />
              </div>
            </div>

            {isRsi
              ? <RsiReportSections report={report} biomech={biomech} viewLabel={viewLabel} />
              : <PowerReportSections report={report} biomech={biomech} viewLabel={viewLabel} crossCheck={cc} />}
          </>
        )}
      </div>

      {/* 액션 (캡처 영역 밖): 리포트 저장 + 동영상 저장 + 회차 기록 */}
      <div className="p-5 pt-0 space-y-2">
        <ReportActions
          reportNodeId="jump-live-report-sheet"
          videoBlob={report.videoBlob || null}
          onReportClick={() => onOpenSavedReport?.(report)}
          reportButtonLabel="📄 결과 리포트 보기"
          baseName={`${report.member?.name || '회원'}_점프`} onMessage={() => {}} />
        {report.valid === true && saveState !== 'saved' && (
          <button onClick={onSave}
            disabled={saveState === 'saving' || saveState === 'saved'}
            className="w-full rounded-xl bg-slate-200 dark:bg-slate-700 text-white font-bold py-3 disabled:opacity-60 flex items-center justify-center gap-2">
            {saveState === 'saving' && <span className="h-4 w-4 rounded-full border-2 border-white border-t-transparent animate-spin" />}
            {saveState === 'saved' ? '✓ 자동 저장됨' : saveState === 'saving' ? '저장 중...' : saveState === 'error' ? '↻ 다시 저장' : '💾 회차 기록 (데이터)'}
          </button>
        )}
        <button onClick={onRetry} className="w-full rounded-xl border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 font-bold py-3">
          다시 측정
        </button>
        {saveState === 'error' && <p className="text-center text-xs text-red-700 dark:text-red-400">자동 저장 실패 — 위 버튼으로 다시 시도하세요</p>}
        {report.valid !== true && <p className="text-center text-xs text-amber-700 dark:text-amber-400">무효 측정은 저장되지 않습니다.</p>}
      </div>
    </div>
  );
}

function PowerReportSections({ report, biomech, viewLabel, crossCheck }) {
  const relativePower = report.peakPower != null && report.bodyWeight
    ? Math.round((report.peakPower / report.bodyWeight) * 10) / 10
    : null;
  const heightPct = report.calibHeightCm && report.heightCm
    ? Math.round((report.heightCm / report.calibHeightCm) * 1000) / 10
    : null;
  const rows = Array.isArray(report.perJump) ? report.perJump : [];

  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        <MetricCard label="상대 파워" value={relativePower != null ? `${relativePower}W/kg` : '체중 필요'} />
        <MetricCard label="키 대비 높이" value={heightPct != null ? `${heightPct}%` : '—'} />
        <MetricCard label="감지 점프" value={`${report.jumps || 0}회`} />
        <MetricCard label="녹화 HUD" value={report.videoMetrics?.overlayRecorded ? '포함' : '미녹화'} />
      </div>

      <ReportPanel title="파워 점프 핵심 해석" tone="amber">
        <div className="grid grid-cols-2 gap-2">
          <MetricCard label="폭발력 지표" value={report.peakPower != null ? `${report.peakPower}W` : '체중 필요'} />
          <MetricCard label="도약 속도" value={report.takeoffVelocity != null ? `${report.takeoffVelocity}m/s` : '—'} />
          <MetricCard label="체공 시간" value={report.flightTimeMs != null ? `${report.flightTimeMs}ms` : '—'} />
          <MetricCard label="주 측정값" value="최고 점프" />
        </div>
        <p className="text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
          파워 점프는 한 번의 최대 수직 도약 능력을 보는 리포트입니다. 높이, 이륙속도, 최고파워, 체중 대비 파워를 함께 보고
          정면 촬영에서는 좌우 안정성과 착지 대칭을 보조 지표로 확인합니다.
        </p>
      </ReportPanel>

      <ReportPanel title="정면 안정성 및 착지 품질" tone="slate">
        <div className="grid grid-cols-2 gap-2">
          <MetricCard label="감지 방향" value={viewLabel} />
          <MetricCard label="착지 대칭" value={biomech.footLandingSymmetry?.symmetryPct != null ? `${biomech.footLandingSymmetry.symmetryPct}%` : '—'} />
          <MetricCard label="골반 불균형" value={biomech.pelvicImbalance != null ? `${biomech.pelvicImbalance}°` : '—'} />
          <MetricCard label="신전 정렬도" value={biomech.extensionAlignment?.alignmentScore != null ? `${biomech.extensionAlignment.alignmentScore}점` : '—'} />
        </div>
        <p className="text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
          파워 점프의 추천 방향은 정면입니다. 정면에서는 좌우 흔들림, 착지 발끝 대칭, 골반 기울기 변화를 더 직관적으로 확인할 수 있습니다.
        </p>
      </ReportPanel>

      <ReportPanel title="높이 교차 확인" tone="slate">
        <div className="grid grid-cols-2 gap-2">
          <MetricCard label="비행시간 기반" value={`${report.heightCm}cm`} />
          <MetricCard label="골반변위 참고" value={crossCheck.heightCrossCm != null ? `${crossCheck.heightCrossCm}cm` : '—'} />
          <MetricCard label="차이" value={crossCheck.deltaPct != null ? `${crossCheck.deltaPct}%` : '—'} />
          <MetricCard label="판정" value={crossCheck.agree == null ? '참고' : crossCheck.agree ? '일치' : '차이 큼'} />
        </div>
        <p className="text-[11px] leading-relaxed text-slate-500">
          최종 높이는 비행시간 기반 값을 사용합니다. 골반변위 추정은 카메라 거리와 각도 영향을 많이 받아 참고값으로만 표시합니다.
        </p>
      </ReportPanel>

      {rows.length > 0 && (
        <ReportPanel title="회차별 파워 점프 측정값" tone="amber">
          <div className="space-y-1.5">
            {rows.map((row) => {
              const jump = calcJump((row.flightMs || 0) / 1000, report.bodyWeight || null);
              return (
                <div key={row.no} className="grid grid-cols-5 gap-1 rounded-lg bg-slate-100/70 dark:bg-slate-800/70 px-2 py-2 text-center">
                  <Stat label={`#${row.no}`} value={`${row.heightCm ?? '—'}cm`} />
                  <Stat label="체공" value={`${row.flightMs ?? '—'}ms`} />
                  <Stat label="속도" value={jump?.takeoffVelocity != null ? `${jump.takeoffVelocity}` : '—'} />
                  <Stat label="파워" value={jump?.peakPower != null ? `${jump.peakPower}W` : '—'} />
                  <Stat label="구간" value={`${Math.round((row.takeoffMs || 0) / 1000)}-${Math.round((row.landingMs || 0) / 1000)}s`} />
                </div>
              );
            })}
          </div>
        </ReportPanel>
      )}

      <ReportPanel title="추천 코칭 포인트" tone="amber">
        <GuideList items={[
          '정면 기준으로 무릎과 발끝 방향이 좌우로 크게 흔들리지 않는지 확인합니다.',
          '최고 높이만 보지 말고 체중 대비 파워와 착지 대칭을 함께 봅니다.',
          '다음 재측정은 같은 카메라 위치와 같은 기준 키로 진행해야 비교가 안정적입니다.',
        ]} />
      </ReportPanel>
    </>
  );
}

function RsiReportSections({ report, biomech, viewLabel }) {
  const rsi = report.rsi || {};
  const cycles = Array.isArray(rsi.perCycle) ? rsi.perCycle : [];
  const rows = Array.isArray(report.perJump) ? report.perJump : [];
  const basisText = rsi.rsiBasis === 'mean' ? '변동률 높음 · 평균값 채택' : '안정적 · 최고값 채택';

  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        <MetricCard label="대표 RSI" value={rsi.rsi ?? '—'} />
        <MetricCard label="등급" value={rsi.grade?.label || '—'} />
        <MetricCard label="평균 접지" value={rsi.contactTimeMeanMs != null ? `${rsi.contactTimeMeanMs}ms` : '—'} />
        <MetricCard label="변동률" value={rsi.cvPct != null ? `${rsi.cvPct}%` : '—'} />
      </div>

      <ReportPanel title="RSI 반응성 핵심 해석" tone="emerald">
        <div className="grid grid-cols-2 gap-2">
          <MetricCard label="최고 RSI" value={rsi.rsiBest ?? '—'} />
          <MetricCard label="평균 RSI" value={rsi.rsiMean ?? '—'} />
          <MetricCard label="대표값 기준" value={basisText} />
          <MetricCard label="유효 사이클" value={`${cycles.length}회`} />
          <MetricCard label="최고 접지" value={rsi.contactTimeMs != null ? `${rsi.contactTimeMs}ms` : '—'} />
          <MetricCard label="최고 체공" value={rsi.flightTimeMs != null ? `${rsi.flightTimeMs}ms` : '—'} />
        </div>
        <p className="text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
          RSI는 높게 뛰는 능력보다 짧게 접지하고 빠르게 다시 튀어 오르는 반응 탄성을 봅니다. 회차 간 변동률이 높으면
          우연히 짧게 잡힌 접지시간을 피하기 위해 평균 RSI를 대표값으로 사용합니다.
        </p>
      </ReportPanel>

      {rsi.lowFps && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-xs font-bold leading-relaxed text-amber-700 dark:text-amber-300">
          접지 시간이 짧아 프레임 오차 영향이 커질 수 있습니다. RSI는 측면에서 120fps 이상, 가능하면 240fps 슬로우 모션 촬영을 권장합니다.
        </div>
      )}

      <ReportPanel title="연속 점프 사이클 분석" tone="emerald">
        <div className="space-y-1.5">
          {cycles.map((c, i) => (
            <div key={i} className="grid grid-cols-5 gap-1 rounded-lg bg-slate-100/70 dark:bg-slate-800/70 px-2 py-2 text-center">
              <Stat label={`Cycle ${i + 1}`} value={c.rsi} />
              <Stat label="접지" value={`${c.contactMs}ms`} />
              <Stat label="체공" value={`${c.flightMs}ms`} />
              <Stat label="높이" value={`${c.heightCm}cm`} />
              <Stat label="보조" value={c.rsiHeight ?? '—'} />
            </div>
          ))}
        </div>
        <p className="text-[11px] leading-relaxed text-slate-500">
          최소 {RSI_REQUIRED_JUMPS}회 이상 연속 점프해야 접지시간과 체공시간의 반복 패턴을 안정적으로 볼 수 있습니다.
        </p>
      </ReportPanel>

      {rows.length > 0 && (
        <ReportPanel title="원본 점프별 영상 측정값" tone="slate">
          <div className="space-y-1.5">
            {rows.map((row) => (
              <div key={row.no} className="grid grid-cols-5 gap-1 rounded-lg bg-slate-100/70 dark:bg-slate-800/70 px-2 py-2 text-center">
                <Stat label={`#${row.no}`} value={`${row.heightCm ?? '—'}cm`} />
                <Stat label="체공" value={`${row.flightMs ?? '—'}ms`} />
                <Stat label="접지" value={row.contactMs != null ? `${row.contactMs}ms` : '—'} />
                <Stat label="RSI" value={row.rsi ?? '—'} />
                <Stat label="구간" value={`${Math.round((row.takeoffMs || 0) / 1000)}-${Math.round((row.landingMs || 0) / 1000)}s`} />
              </div>
            ))}
          </div>
        </ReportPanel>
      )}

      <ReportPanel title="측면 자세 및 접지 품질" tone="slate">
        <div className="grid grid-cols-2 gap-2">
          <MetricCard label="감지 방향" value={viewLabel} />
          <MetricCard label="착지 무릎각" value={biomech.landingKneeAngle != null ? `${biomech.landingKneeAngle}°` : '—'} />
          <MetricCard label="상체 변화" value={biomech.trunkLeanChange != null ? `${biomech.trunkLeanChange}°` : '—'} />
          <MetricCard label="착지 대칭" value={biomech.footLandingSymmetry?.symmetryPct != null ? `${biomech.footLandingSymmetry.symmetryPct}%` : '—'} />
        </div>
        <p className="text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
          RSI의 추천 방향은 측면입니다. 측면에서는 발이 바닥에 닿는 순간과 다시 떨어지는 순간을 더 명확히 구분할 수 있어 접지시간 신뢰도가 올라갑니다.
        </p>
      </ReportPanel>

      <ReportPanel title="추천 코칭 포인트" tone="emerald">
        <GuideList items={[
          '착지 후 오래 버티지 말고 즉시 다시 튀어 오르는 리듬을 유지합니다.',
          '높이보다 접지시간과 회차별 RSI 변동률을 먼저 확인합니다.',
          '연속 점프 중 무릎이 과도하게 접히거나 상체가 무너지면 반응성이 떨어질 수 있습니다.',
        ]} />
      </ReportPanel>
    </>
  );
}

function ReportPanel({ title, tone = 'slate', children }) {
  const toneClass = tone === 'emerald'
    ? 'border-emerald-500/25'
    : tone === 'amber'
      ? 'border-amber-500/25'
      : 'border-slate-200 dark:border-slate-800';
  const titleClass = tone === 'emerald'
    ? 'text-emerald-700 dark:text-emerald-300'
    : tone === 'amber'
      ? 'text-amber-700 dark:text-amber-300'
      : 'text-slate-600 dark:text-slate-300';
  return (
    <div className={`bg-white dark:bg-slate-900 border ${toneClass} rounded-2xl p-4 space-y-3`}>
      <p className={`text-xs font-bold ${titleClass}`}>{title}</p>
      {children}
    </div>
  );
}

function GuideList({ items }) {
  return (
    <div className="space-y-2">
      {items.map((item, i) => (
        <div key={item} className="flex gap-2 rounded-xl bg-slate-100/70 dark:bg-slate-800/70 px-3 py-2 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
          <span className="font-black text-slate-500">{i + 1}</span>
          <span>{item}</span>
        </div>
      ))}
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="bg-slate-100 dark:bg-slate-800 rounded-xl py-2">
      <p className="text-[10px] text-slate-500">{label}</p>
      <p className="font-mono font-bold text-slate-700 dark:text-slate-200 text-sm">{value}</p>
    </div>
  );
}

function InfoRow({ label, value }) {
  return (
    <div className="rounded-xl bg-slate-100 dark:bg-slate-800 px-3 py-2">
      <p className="text-[10px] font-bold text-slate-500">{label}</p>
      <p className="truncate text-sm font-bold text-slate-800 dark:text-slate-100">{value}</p>
    </div>
  );
}

function MetricCard({ label, value }) {
  return (
    <div className="rounded-xl bg-slate-100 dark:bg-slate-800 px-3 py-2 text-center">
      <p className="text-[10px] font-bold text-slate-500">{label}</p>
      <p className="font-mono text-base font-black text-slate-800 dark:text-slate-100">{value}</p>
    </div>
  );
}

function JumpLiveOverlay({
  jumpType, phase, phaseColor, calibMsg, heightCm, jumpCount,
  liveJump, bestHeight, rsiCycles, jumpRows, requiredJumps = RSI_REQUIRED_JUMPS,
  liveAngles = { knee: null, hip: null }, liveHeightSeries = [],
}) {
  const isRsi = jumpType === 'reactive';
  const latestCycle = rsiCycles.at(-1) || null;
  const readyText = isRsi ? `측면 · 연속 ${requiredJumps}회` : '정면 · 1회 최대 점프';
  const statusText = phase === 'air' ? '공중'
    : phase === 'ready' ? '준비됨'
    : phase === 'low_visibility' ? '자세 확인'
    : '기준 잡는 중';
  const accent = phase === 'air' ? '#fbbf24' : phase === 'ready' ? '#34d399' : phase === 'low_visibility' ? '#f87171' : '#22d3ee';

  const gauge = isRsi
    ? { label: 'RSI', value: latestCycle?.rsi ?? null, unit: '', decimals: 2, arc: true, min: 0, max: 3 }
    : { label: '점프 높이', value: liveJump.heightCm ?? bestHeight ?? null, unit: 'cm' };
  // [무릎·고관절 각도 HUD 2026-08-18] 실시간 관절 각도 — 카메라에 잡히는 대로
  // 즉시 표시(캘리브레이션/대기 중에도 갱신됨). 값이 없으면 GaugeHud가 '—'로 표시.
  const kneeStat = { label: '무릎각', value: liveAngles?.knee ?? null, unit: '°' };
  const hipStat = { label: '고관절각', value: liveAngles?.hip ?? null, unit: '°' };
  const stats = isRsi
    ? [
        { label: '접지', value: latestCycle?.contactMs ?? null, unit: 'ms' },
        { label: '진행', value: `${jumpCount}/${requiredJumps}` },
        kneeStat, hipStat,
      ]
    : [
        { label: '체공', value: liveJump.flightMs ?? null, unit: 'ms' },
        { label: '점프', value: `${jumpCount}`, unit: '회' },
        kneeStat, hipStat,
      ];

  return (
    <div className="pointer-events-none absolute inset-x-0 top-[max(50px,calc(env(safe-area-inset-top)+50px))] z-20 px-3">
      <div className="mx-auto max-w-[420px] rounded-2xl border border-white/12 bg-black/55 px-3 py-2 text-white shadow-xl backdrop-blur-md">
        <div className="flex items-center gap-2">
          <span className={`h-2.5 w-2.5 rounded-full ${
            phase === 'air' ? 'bg-amber-400' : phase === 'ready' ? 'bg-emerald-400' : phase === 'low_visibility' ? 'bg-red-400' : 'bg-cyan-400'
          }`} />
          <p className="truncate text-xs font-black text-white/90">{isRsi ? 'RSI 측정' : '파워 점프'} · {readyText}</p>
          <span className={`ml-auto text-[11px] font-bold ${phaseColor}`}>{statusText}</span>
        </div>
        {/* [2026-07-31] calibMsg(보정 진행률 "자세 보정 중... N%"·안내 문구)를
            그동안 prop으로 받기만 하고 화면엔 안 그리고 있었다 — "기준 다시
            잡기"를 눌러도 실제로는 보정이 재시작되는데(phase→arming) 진행률이
            어디에도 안 보여서 "아무 반응이 없다"로 보였다. */}
        {calibMsg && phase !== 'air' && (
          <p className="mt-0.5 truncate text-[10px] font-bold text-white/70">{calibMsg}</p>
        )}
      </div>
      <GaugeHud {...gauge} accent={accent} stats={stats} />
      <LiveHeightWave series={liveHeightSeries} accent={accent} />
    </div>
  );
}

// [점프 리플레이 그래프 2026-08-20] 라이브 무게중심 높이 파형 — 순수 SVG
// 스파크라인(TrendChart.jsx·JumpAngleTimelineChart.jsx와 동일한 "외부
// 의존성 0" 패턴). 측정 종료 후 리포트 화면의 JumpReplayGraph(비디오
// 스크러버 동기화)와는 별개 — 이건 지금 쌓이고 있는 값을 그대로 그리는
// 실시간 표시일 뿐이다. 표본이 2개 미만이면(선을 그릴 수 없음) 아무것도
// 그리지 않는다.
function LiveHeightWave({ series = [], accent = '#22d3ee' }) {
  const pts = series.filter((p) => p.comHeightCm != null);
  if (pts.length < 2) return null;
  const W = 380, H = 56, padX = 6, padY = 8;
  const vals = pts.map((p) => p.comHeightCm);
  let min = Math.min(...vals, 0), max = Math.max(...vals, 0); // 0(서 있는 기준선) 항상 포함
  if (min === max) { min -= 1; max += 1; }
  const t0 = pts[0].tMs, t1 = pts[pts.length - 1].tMs;
  const xAt = (t) => padX + (t1 === t0 ? 0 : ((t - t0) / (t1 - t0)) * (W - padX * 2));
  const yAt = (v) => padY + (H - padY * 2) * (1 - (v - min) / (max - min));
  const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xAt(p.tMs).toFixed(1)} ${yAt(p.comHeightCm).toFixed(1)}`).join(' ');
  const zeroY = yAt(0);
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} className="mt-1.5 rounded-xl bg-black/40" style={{ display: 'block' }}>
      <line x1={padX} y1={zeroY} x2={W - padX} y2={zeroY} stroke="rgba(255,255,255,0.25)" strokeWidth="1" strokeDasharray="3,3" />
      <path d={path} fill="none" stroke={accent} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

// 수동 입력 모달 — 실시간 화면 안에서 체공시간 직접 입력(점프매트/타이머).
// 자동 측정과 동일한 리포트 페이로드를 만들어 동일 저장 흐름을 탄다.
function ManualEntryModal({ member, jumpType = 'power', jumpSubType = 'cmj', leg = null, onClose, onSubmit }) {
  const isReactive = jumpType === 'reactive';
  const [flight, setFlight] = useState('');
  const [contact, setContact] = useState('');   // 반응 모드 전용(접지 시간)
  const [weight, setWeight] = useState(() => {
    const w = resolveWeight(member);
    return w != null ? String(w) : '';
  });
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const ft = Number(flight);
    if (!ft || ft <= 0 || ft > 1.5) { alert('체공 시간을 초 단위로 입력하세요. (예: 0.50)'); return; }

    // ── 반응(RSI) 모드: 접지 시간이 있어야 RSI 산출 가능 ──
    if (isReactive) {
      const r = calcRSI(ft, Number(contact));
      if (!r) { alert('접지 시간을 초 단위로 입력하세요. (예: 0.20)'); return; }
      if (r.error) { alert(r.message); return; }
      setBusy(true);
      await onSubmit?.({
        valid: true, reason: 'ok', source: 'manual', jumpType: 'reactive', jumpSubType, jumps: 1,
        flightTimeSec: ft, flightTimeMs: Math.round(ft * 1000),
        contactTimeSec: Number(contact), contactTimeMs: Math.round(Number(contact) * 1000),
        heightCm: r.heightCm, takeoffVelocity: r.takeoffVelocity,
        // 수동 RSI 결과를 카메라 RSI 와 같은 형태로 담아 리포트가 동일하게 표시
        rsi: {
          valid: true, reason: 'ok', mode: 'reactive', method: 'flight_over_contact',
          view: null, cycles: 1, rsi: r.rsi, rsiBasis: 'manual', rsiBest: r.rsi,
          rsiMean: r.rsi, rsiHeight: r.rsiHeight,
          contactTimeMs: Math.round(Number(contact) * 1000),
          flightTimeMs: Math.round(ft * 1000), heightCm: r.heightCm,
          cvPct: null, grade: rsiGrade(r.rsi), lowFps: false,
          frameIntervalMs: null, framesPerContact: null, perCycle: [],
        },
        member: { id: member?.id || null, name: member?.name || null },
        measuredAt: new Date().toISOString(),
      });
      setBusy(false);
      return;
    }

    // ── 파워 모드: 체공시간만으로 높이/파워 ──
    const r = calcJump(ft, weight ? Number(weight) : null);
    if (!r) { alert('계산 실패 — 입력값을 확인하세요.'); return; }
    setBusy(true);
    await onSubmit?.({
      valid: true, reason: 'ok', source: 'manual', jumpType: 'power', jumpSubType,
      leg: jumpSubType === 'slj' ? leg : null, jumps: 1,
      flightTimeSec: ft, flightTimeMs: Math.round(ft * 1000),
      heightCm: r.heightCm, takeoffVelocity: r.takeoffVelocity, peakPower: r.peakPower,
      bodyWeight: weight ? Number(weight) : null,
      crossCheck: { heightCrossCm: null, deltaPct: null, agree: null },
      calibHeightCm: member?.height || null,
      member: { id: member?.id || null, name: member?.name || null },
      measuredAt: new Date().toISOString(),
    });
    setBusy(false);
  };

  return (
    <div className="absolute inset-0 z-[88] bg-black/70 backdrop-blur-sm flex items-center justify-center p-6" onClick={onClose}>
      <div className="w-full max-w-sm bg-white dark:bg-slate-900 border border-amber-500/30 rounded-2xl p-5 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <p className="text-white font-black">✍️ 수동 입력 {isReactive && <span className="text-emerald-700 dark:text-emerald-400 text-xs">· RSI</span>}</p>
          <button onClick={onClose} className="text-slate-500 dark:text-slate-400 text-sm font-bold">닫기 ✕</button>
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1.5">체공 시간 (초)</label>
          <input type="number" inputMode="decimal" step="0.01" value={flight}
            onChange={e => setFlight(e.target.value)} placeholder="0.50"
            className="w-full bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-100 rounded-lg px-3 py-2.5 text-base font-mono focus:outline-none focus:border-amber-500" />
          <p className="text-[11px] text-slate-500 mt-1">점프매트·앱 타이머로 잰 발이 떠 있던 시간</p>
        </div>
        {isReactive ? (
          <div>
            <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1.5">접지 시간 (초)</label>
            <input type="number" inputMode="decimal" step="0.01" value={contact}
              onChange={e => setContact(e.target.value)} placeholder="0.20"
              className="w-full bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-100 rounded-lg px-3 py-2.5 text-base font-mono focus:outline-none focus:border-emerald-500" />
            <p className="text-[11px] text-slate-500 mt-1">착지 후 다시 뛰기까지 지면에 닿은 시간. RSI = 체공 ÷ 접지</p>
          </div>
        ) : (
          <div>
            <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1.5">체중 (kg) <span className="text-slate-600">— 파워 계산 시</span></label>
            <input type="number" inputMode="numeric" step="0.1" value={weight}
              onChange={e => setWeight(e.target.value)} placeholder="70"
              className="w-full bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-100 rounded-lg px-3 py-2.5 text-base font-mono focus:outline-none focus:border-amber-500" />
          </div>
        )}
        <button onClick={submit} disabled={busy}
          className="w-full rounded-xl bg-amber-500 text-slate-950 font-black py-3 active:scale-95 disabled:opacity-60">
          {busy ? '계산 중...' : isReactive ? 'RSI 분석' : '점프 분석'}
        </button>
        <p className="text-[11px] text-slate-500">
          {isReactive
            ? 'RSI = 체공 ÷ 접지(무단위). 높이 h=g·t²/8 추정값.'
            : '높이 h=g·t²/8, 이륙속도 v=g·t/2, 최고파워는 Sayers(체중 입력 시) 추정값.'}
        </p>
      </div>
    </div>
  );
}
