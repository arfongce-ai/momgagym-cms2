// ai-measure/menus/SquatLiveAnalysis.jsx
// ════════════════════════════════════════════════════════════════════════
//  오버헤드 딥 스쿼트 실시간 카메라 측정 — StanceLiveAnalysis.jsx와 거의 동일한
//  구조(usePoseEngine + CameraStage + 녹화 파이프라인). 캘리브레이션·반복(rep)
//  추적 로직은 squatBiomechanicsTracker.js를 공유.
//
//  [정면+측면 2단계 촬영 — 2026-07-30 추가]
//  기존엔 정면에서만 2회 반복을 잡았는데, 무릎외반·골반기울기는 정면이 정확하고
//  상체 전방 기울기는 측면이 정확하다는 한계(파일 하단 squatBiomechanics.js 참고)
//  때문에, 이제 "정면 1회 → 전환 화면 → 측면 1회"로 나눠 촬영하고 두 결과를
//  합쳐 판정한다(view 상태: 'front' | 'side'). 카메라 각도가 바뀌므로 측면으로
//  넘어갈 때 캘리브레이션(서기 기준선)을 새로 잡는다 — 녹화는 정면 시작 시점부터
//  측면 완료까지 끊기지 않고 하나로 이어간다.
//
//  [녹화 파이프라인 — ROM/보행/SLST와 동일 구조로 통일]
//  캘리브레이션이 잠기는 순간부터 화면 전체를 연속 녹화한다 — 스켈레톤+GaugeHud를
//  캔버스에 합성 → captureStream → MediaRecorder. 측정 완료 시 blob을 summary와
//  함께 Hub로 넘겨, 판정 리포트 화면에서 ReportActions로 영상까지 저장/공유.
//
//  SLST(유지 시간 기반)와 달리 스쿼트는 반복(내려갔다 올라오는 사이클) 기반이라
//  실시간 피드백도 "몇 초째"가 아니라 "지금 이 반복이 얼마나 깊이 내려갔는지"를
//  보여준다(liveDepthState()).
// ════════════════════════════════════════════════════════════════════════
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { usePoseEngine } from '../core/usePoseEngine';
import { StandingCalibrator, SquatBiomechanicsTracker, pelvicTiltDegOf, kneeValgusDegOf } from '../core/squatBiomechanicsTracker';
import { DEFAULT_ASPECT, outputSize, drawVideoCover, coverTransform, rotateLandmarksNormalized } from '../core/recordAspect';
import { useCameraRotation } from '../core/useCameraRotation';
import { computeDisplayAngles } from '../core/squatJointAngles';
import { colorForBone, evaluateSquatFrame, depthPctFromThighIncline, COMPENSATION_KO, scoreDeepSquatFms, worstOfTrials } from '../core/squatFms';
import { evaluateSquatBiomechanics } from '../core/squatBiomechanics';
import { pickRecorderMime } from '../core/recordSink';
import { drawGaugeHud } from '../core/recordingOverlay';
import CameraStage from './CameraStage.jsx';
import GaugeHud from './GaugeHud.jsx';

// SquatAnalysisHub.jsx·StanceAnalysisHub.jsx와 동일한 상태 표기 — 이 화면의
// '측정 완료' 직전 미리보기 배지도 리포트와 같은 어휘를 써야 한다([2026-08-03]
// 이전엔 여기만 FMS 점수 텍스트를 따로 썼는데, 앱 전체가 쓰는 정상/주의/위험과
// 달라 혼란스럽다는 피드백으로 통일).
const STATUS_KO = { normal: '정상', caution: '주의', risk: '위험', unknown: '확인 필요' };

const MAX_RECORD_MS = 60000;
// [2026-07-31] 운영 방식 확정: 정면 2회 → 측면 2회(총 4회)로 측정한다. 뷰당 몇 회를
// 모을지 한 곳에서만 바꾸면 되도록 상수화(트래커 생성부 2곳 + 화면 표시 여러 곳에서 공유).
const SQUAT_LIVE_MAX_TRIALS_PER_VIEW = 2;
const SQUAT_LIVE_TOTAL_TRIALS = SQUAT_LIVE_MAX_TRIALS_PER_VIEW * 2;

// 자세·보행·SLST 모듈과 동일한 본(bone) 목록 — 상체 코어 + 양다리 + (오버헤드
// 자세 확인용) 어깨-팔꿈치-손목. [2026-08-03] 판정 로직(squatBiomechanics.js)도
// 이제 armDropDeg를 통해 손목 좌표를 쓴다 — 순수 표시용이 아니라 실제 정상/
// 주의/위험 판정에 반영된다(이전엔 시각 표시 전용이라고 적혀 있었으나 갱신).
const BONES = [
  [11, 12], [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [27, 29], [27, 31], [29, 31],
  [24, 26], [26, 28], [28, 30], [28, 32], [30, 32],
  [11, 13], [13, 15], [12, 14], [14, 16],
];

function vis(p, threshold = 0.3) {
  return !!p && (p.visibility == null || p.visibility >= threshold);
}

function objectContainMapper(video, width, height) {
  const vw = video?.videoWidth || width;
  const vh = video?.videoHeight || height;
  const scale = Math.min(width / vw, height / vh);
  const drawW = vw * scale, drawH = vh * scale;
  const ox = (width - drawW) / 2, oy = (height - drawH) / 2;
  return { x: (p) => ox + p.x * drawW, y: (p) => oy + p.y * drawH };
}

function drawAngleLabel(ctx, x, y, text, color = '#fbbf24') {
  ctx.font = 'bold 13px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(0,0,0,0.85)';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

function fmtDeg(v) {
  return v == null ? '—' : `${Math.round(v)}°`;
}

// [2026-07-30 신규] 요청 스펙: 측면 5개(발목기준 CoG·어깨/고관절/무릎/발목 굽힘),
// 정면 6개(CoG 좌우기울기·무릎외반/내반·골반기울기·팔꿈치폄 양쪽·머리-어깨).
// 판정(정상/주의/위험)에는 아직 연결하지 않고 순수 표시만 한다.
function drawJointAngleLabels(ctx, landmarks, view, X, Y) {
  if (!landmarks) return;
  ctx.save();
  if (view === 'side') {
    const a = computeDisplayAngles(landmarks, 'side');
    if (!a) { ctx.restore(); return; }
    const sho = landmarks[11] ?? landmarks[12];
    const hip = landmarks[23] ?? landmarks[24];
    const knee = landmarks[25] ?? landmarks[26];
    const ank = landmarks[27] ?? landmarks[28];
    if (vis(sho)) drawAngleLabel(ctx, X(sho) + 26, Y(sho), `어깨 ${fmtDeg(a.shoulderFlexion)}`, '#38bdf8');
    if (vis(hip)) drawAngleLabel(ctx, X(hip) + 26, Y(hip), `고관절 ${fmtDeg(a.hipFlexion)}`, '#a78bfa');
    if (vis(knee)) drawAngleLabel(ctx, X(knee) + 26, Y(knee), `무릎 ${fmtDeg(a.kneeFlexion)}`, '#fbbf24');
    if (vis(ank)) drawAngleLabel(ctx, X(ank) + 26, Y(ank) - 14, `발목 ${fmtDeg(a.ankleFlexion)}`, '#34d399');
    // 발목 기준 CoG: 발목에서 수직 기준선 + 실제 CoG까지 선으로 표시
    if (vis(sho) && vis(hip) && vis(ank)) {
      const cog = { x: (sho.x + hip.x) / 2, y: (sho.y + hip.y) / 2 };
      const ax = X(ank), ay = Y(ank);
      ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.setLineDash([4, 4]); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(ax, ay - 140); ctx.stroke(); // 수직 기준선(플럼라인)
      ctx.setLineDash([]);
      ctx.strokeStyle = 'rgba(248,113,113,0.9)'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(X(cog), Y(cog)); ctx.stroke();
      drawAngleLabel(ctx, ax - 34, ay - 70, `CoG ${fmtDeg(a.cogOverAnkle)}`, '#f87171');
    }
  } else {
    const a = computeDisplayAngles(landmarks, 'front');
    if (!a) { ctx.restore(); return; }
    const lSho = landmarks[11], rSho = landmarks[12];
    const lElb = landmarks[13], rElb = landmarks[14];
    const lHip = landmarks[23], rHip = landmarks[24];
    const lAnk = landmarks[27], rAnk = landmarks[28];
    const nose = landmarks[0];
    const kneeValgus = kneeValgusDegOf(landmarks);
    const pelvicTilt = pelvicTiltDegOf(landmarks);
    if (vis(lElb)) drawAngleLabel(ctx, X(lElb) - 30, Y(lElb), `팔꿈치 ${fmtDeg(a.elbowExtL)}`, '#38bdf8');
    if (vis(rElb)) drawAngleLabel(ctx, X(rElb) + 30, Y(rElb), `팔꿈치 ${fmtDeg(a.elbowExtR)}`, '#38bdf8');
    if (vis(lHip) && vis(rHip)) {
      const hipMid = { x: (lHip.x + rHip.x) / 2, y: (lHip.y + rHip.y) / 2 };
      drawAngleLabel(ctx, X(hipMid), Y(hipMid) + 22, `골반기울기 ${fmtDeg(pelvicTilt)}`, '#a78bfa');
    }
    if (kneeValgus != null) {
      const kneeMid = landmarks[25] && landmarks[26]
        ? { x: (landmarks[25].x + landmarks[26].x) / 2, y: (landmarks[25].y + landmarks[26].y) / 2 }
        : (landmarks[25] ?? landmarks[26]);
      if (vis(kneeMid)) drawAngleLabel(ctx, X(kneeMid), Y(kneeMid) + 22, `무릎정렬 ${fmtDeg(kneeValgus)}`, '#fbbf24');
    }
    if (vis(nose)) drawAngleLabel(ctx, X(nose), Y(nose) - 18, `머리기울기 ${fmtDeg(a.headTilt)}`, '#34d399');
    // 정면 CoG 기울기: 발목 중점 기준 수직선 + 실제 CoG까지 선
    if (vis(lSho) && vis(rSho) && vis(lHip) && vis(rHip) && vis(lAnk) && vis(rAnk)) {
      const shoMid = { x: (lSho.x + rSho.x) / 2, y: (lSho.y + rSho.y) / 2 };
      const hipMid = { x: (lHip.x + rHip.x) / 2, y: (lHip.y + rHip.y) / 2 };
      const ankMid = { x: (lAnk.x + rAnk.x) / 2, y: (lAnk.y + rAnk.y) / 2 };
      const cog = { x: (shoMid.x + hipMid.x) / 2, y: (shoMid.y + hipMid.y) / 2 };
      const ax = X(ankMid), ay = Y(ankMid);
      ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.setLineDash([4, 4]); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(ax, ay - 160); ctx.stroke();
      ctx.setLineDash([]);
      ctx.strokeStyle = 'rgba(248,113,113,0.9)'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(X(cog), Y(cog)); ctx.stroke();
      drawAngleLabel(ctx, ax + 46, ay - 80, `CoG ${fmtDeg(a.cogTilt)}`, '#f87171');
    }
  }
  ctx.restore();
}

// clearFirst: 미리보기 캔버스는 매 프레임 지워야 잔상(뒤엉킨 그물망)이 안 남는다.
// 반대로 녹화 합성 캔버스는 바로 앞에서 영상 프레임을 그려둔 상태라 지우면
// 영상이 사라지고 스켈레톤만 남는다([2026-08-02] 오버헤드스쿼트 저장 영상에
// 스켈레톤만 나오던 버그의 원인) — 합성 루프에서는 clearFirst=false 로 부른다.
function drawSkeleton(canvas, video, landmarks, locked, mapper, view, clearFirst = true, fmsParts = null) {
  if (!canvas || !video) return;
  const cw = canvas.clientWidth || canvas.width, ch = canvas.clientHeight || canvas.height;
  if (clearFirst && (canvas.width !== cw || canvas.height !== ch)) { canvas.width = cw; canvas.height = ch; }
  const ctx = canvas.getContext('2d');
  if (clearFirst) ctx.clearRect(0, 0, cw, ch);
  if (!landmarks) return;
  const { x: X, y: Y } = mapper || objectContainMapper(video, cw, ch);
  // [2026-08-02] 부위별 색상 오버레이 — 요청대로 정상은 푸른색, 이상은 붉은색.
  // fmsParts가 있으면(측정 중) 뼈대별로 그 부위의 판정 색을 쓰고, 없으면
  // (캘리브레이션 중) 기존 단색 동작을 그대로 유지한다.
  const col = locked ? 'rgba(52,211,153,0.95)' : 'rgba(34,211,238,0.95)';
  ctx.lineWidth = 3; ctx.lineCap = 'round';
  BONES.forEach(([a, b]) => {
    const pa = landmarks[a], pb = landmarks[b];
    if (!vis(pa) || !vis(pb)) return;
    ctx.strokeStyle = fmsParts ? colorForBone(a, b, fmsParts) : col;
    ctx.beginPath(); ctx.moveTo(X(pa), Y(pa)); ctx.lineTo(X(pb), Y(pb)); ctx.stroke();
  });
  ctx.fillStyle = locked ? 'rgba(52,211,153,1)' : 'rgba(255,255,255,0.95)';
  [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32].forEach((i) => {
    const p = landmarks[i];
    if (!vis(p)) return;
    ctx.beginPath(); ctx.arc(X(p), Y(p), 5, 0, Math.PI * 2); ctx.fill();
  });
  // 캘리브레이션이 잠긴 뒤(실제 측정 중)에만 각도 라벨을 그려 계산 중 화면이
  // 어수선해지지 않게 한다.
  if (locked) drawJointAngleLabels(ctx, landmarks, view, X, Y);
}

// [2026-08-03] 정면·측면 각 뷰의 저장된 시행(trial1/trial2, 이미 armDropDeg 포함)으로
// FMS 3/2/1/0 점수를 계산 — 'finished' 단계 화면 표시와 finishAndSubmit() 양쪽에서
// 재사용한다(같은 데이터를 다르게 두 번 계산하지 않도록). sideSummary가 없으면(측면
// 생략) scoreDeepSquatFms 자체가 "한쪽만 있으면 점수를 확정하지 않는다" 원칙으로
// score:null을 돌려준다 — 여기서 따로 처리하지 않는다.
function computeFmsResult(frontSummary, sideSummary) {
  const frontAssess = worstOfTrials(
    frontSummary?.trial1 ? evaluateSquatFrame(frontSummary.trial1, 'front') : null,
    frontSummary?.trial2 ? evaluateSquatFrame(frontSummary.trial2, 'front') : null,
  );
  const sideAssess = worstOfTrials(
    sideSummary?.trial1 ? evaluateSquatFrame(sideSummary.trial1, 'side') : null,
    sideSummary?.trial2 ? evaluateSquatFrame(sideSummary.trial2, 'side') : null,
  );
  return scoreDeepSquatFms(frontAssess, sideAssess);
}

export default function SquatLiveAnalysis({ member, onBack, onComplete }) {

  // calibrating | low_visibility | ready | active | rep_done | front_done | finished
  const [uiPhase, setUiPhase] = useState('calibrating');
  const [view, setView] = useState('front'); // 'front' | 'side' — 2026-07-31부터 정면 2회 + 측면 2회
  const [calibProgress, setCalibProgress] = useState(0);
  const [depthPct, setDepthPct] = useState(0);
  const [belowParallel, setBelowParallel] = useState(false);
  const [fmsCompensations, setFmsCompensations] = useState([]);
  const [trialsFound, setTrialsFound] = useState(0); // 현재 단계(view) 트래커 안에서의 완료 수(0~2)
  const [lastTrialNote, setLastTrialNote] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [finishing, setFinishing] = useState(false);

  const calibRef = useRef(null);
  const trackerRef = useRef(null);
  const frontSummaryRef = useRef(null); // 정면 2회 결과 요약({trial1,trial2,trialsFound}, 측면 진행 중에도 유지)
  const lastTsRef = useRef(0);
  const canvasRef = useRef(null);
  const startedRef = useRef(false);
  const countdownTimerRef = useRef(null);
  const measureStartedRef = useRef(false); // 캘리브레이션 완료 후 "촬영 시작" 버튼+카운트다운을 거쳤는지
  const [countdown, setCountdown] = useState(null);
  const [started, setStarted] = useState(false);
  const [recordingActive, setRecordingActive] = useState(false); // MediaRecorder 실제 동작 여부(정면→측면 전환 중에도 계속 true)

  // ── 녹화 ──
  const latestVideoElRef = useRef(null);
  const latestLandmarksRef = useRef(null);
  const recordCanvasRef = useRef(null);
  const composeRafRef = useRef(null);
  const composeIntervalRef = useRef(null);
  const recordStreamRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const recordStartTsRef = useRef(0);
  const maxRecordTimerRef = useRef(null);
  const recordingStartedRef = useRef(false);
  const pendingSummaryRef = useRef(null);
  const depthPctRef = useRef(0);
  const belowParallelRef = useRef(false);
  // 부위별 판정 결과 — 그리기 루프(미리보기/녹화 합성)가 매 프레임 읽는다.
  const fmsPartsRef = useRef(null);
  const viewRef = useRef('front');
  const trialsFoundRef = useRef(0);

  const createRecordedStream = () => {
    const video = latestVideoElRef.current;
    const size = outputSize(DEFAULT_ASPECT);
    const canvas = recordCanvasRef.current || document.createElement('canvas');
    canvas.width = size.width; canvas.height = size.height;
    recordCanvasRef.current = canvas;
    const ctx = canvas.getContext('2d', { alpha: false });
    const draw = () => {
      if (!video) return;
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      if (!drawVideoCover(ctx, video, canvas.width, canvas.height, rotationDeg)) return;
      const cover = coverTransform(video, canvas.width, canvas.height, rotationDeg);
      drawSkeleton(canvas, video, latestLandmarksRef.current, !!calibRef.current?.locked, { x: cover.X, y: cover.Y }, viewRef.current, false, fmsPartsRef.current);
      const elapsedSec = recordingStartedRef.current ? (performance.now() - recordStartTsRef.current) / 1000 : 0;
      drawGaugeHud(ctx, canvas.width, canvas.height, {
        title: 'SQUAT',
        recording: true,
        elapsedSec,
        accent: '#f59e0b',
        gauge: { label: belowParallelRef.current ? '패러렐 이하 ✓' : '패러렐까지', value: depthPctRef.current, unit: '%', arc: true, min: 0, max: 100 },
        stats: [{ label: viewRef.current === 'front' ? '정면' : '측면', value: (viewRef.current === 'side' ? (frontSummaryRef.current?.trialsFound || 0) : 0) + trialsFoundRef.current, unit: `/${SQUAT_LIVE_TOTAL_TRIALS}` }],
      });
    };
    const rafLoop = () => { draw(); composeRafRef.current = requestAnimationFrame(rafLoop); };
    if (composeRafRef.current) cancelAnimationFrame(composeRafRef.current);
    rafLoop();
    if (composeIntervalRef.current) clearInterval(composeIntervalRef.current);
    composeIntervalRef.current = setInterval(draw, 66);
    const stream = canvas.captureStream ? canvas.captureStream(30) : null;
    if (!stream) return null;
    recordStreamRef.current = stream;
    return stream;
  };

  const stopComposeLoop = () => {
    if (composeRafRef.current) { cancelAnimationFrame(composeRafRef.current); composeRafRef.current = null; }
    if (composeIntervalRef.current) { clearInterval(composeIntervalRef.current); composeIntervalRef.current = null; }
    if (recordStreamRef.current) { recordStreamRef.current.getTracks().forEach(t => t.stop()); recordStreamRef.current = null; }
  };

  const beginRecording = () => {
    if (recordingStartedRef.current) return;
    try {
      // [2026-08-03] 로컬 mp4-우선 배열 대신 공용 pickRecorderMime()을 쓴다 —
      // 코덱까지 명시해야 크로미움에서 mp4가 실제로 잡힌다(recordSink.js 참고).
      // 이게 카카오톡 영상 전송 오류의 원인이었다: 코드는 mp4를 우선한다고
      // 돼 있었지만 실제로는 항상 webm으로 녹화되고 있었다.
      const selectedMime = pickRecorderMime();
      const stream = createRecordedStream();
      if (stream) {
        const mr = new MediaRecorder(stream, selectedMime ? { mimeType: selectedMime } : undefined);
        mediaRecorderRef.current = mr;
        chunksRef.current = [];
        mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
        mr.onstop = () => {
          stopComposeLoop();
          const type = mr.mimeType || 'video/webm';
          const blob = new Blob(chunksRef.current, { type });
          finishWithBlob(blob);
        };
        mr.start();
        recordStartTsRef.current = performance.now();
        recordingStartedRef.current = true;
        setRecordingActive(true);
        maxRecordTimerRef.current = setTimeout(() => { if (recordingStartedRef.current) finishAndSubmit(); }, MAX_RECORD_MS);
      }
    } catch (e) { mediaRecorderRef.current = null; }
  };

  // VBT/점프와 동일한 "버튼 → 3-2-1 → 시작" 패턴(UI 통일성).
  const clearCountdown = useCallback(() => {
    if (countdownTimerRef.current) { clearInterval(countdownTimerRef.current); countdownTimerRef.current = null; }
    setCountdown(null);
  }, []);

  const runStartCountdown = useCallback((onDone) => {
    if (countdownTimerRef.current) return;
    let next = 3;
    setCountdown(next);
    countdownTimerRef.current = setInterval(() => {
      next -= 1;
      if (next <= 0) {
        clearInterval(countdownTimerRef.current);
        countdownTimerRef.current = null;
        setCountdown(null);
        onDone?.();
      } else {
        setCountdown(next);
      }
    }, 1000);
  }, []);

  // [2026-08-02] 3-2-1 카운트다운 복원. SLST와 마찬가지로 runStartCountdown 이
  // 정의만 되어 있고 호출되지 않아 화면에 카운트다운이 뜨지 않았다.
  // [2026-07-30] 버튼이 캘리브레이션 완료를 기다리지 않고 언제든 눌리게 변경 —
  // 촬영 대상자가 카메라 앞이 아니라 노트북 앞에서(또는 트레이너가 미리) 버튼을
  // 누르는 경우를 지원한다. 트래커 생성은 실제로 캘리브레이션이 끝나는 시점에
  // handleResult에서 한다(버튼이 먼저 눌렸든 캘리브레이션이 먼저 끝났든 동일하게
  // 처리됨). maxTrials — 정면/측면 각 단계는 SQUAT_LIVE_MAX_TRIALS_PER_VIEW회씩 잡고 넘어간다.
  const startMeasurement = () => {
    if (measureStartedRef.current) return;
    if (countdownTimerRef.current) return; // 이미 카운트다운 중이면 중복 실행 방지
    runStartCountdown(() => {
      if (measureStartedRef.current) return;
      measureStartedRef.current = true;
      setStarted(true);
      beginRecording();
    });
  };

  // 정면 시행을 마치고 측면으로 넘어간다 — 카메라 각도가 바뀌므로 캘리브레이션을
  // 새로 잡아야 한다(기준선 재확보). 녹화는 이미 켜져 있으면 계속 이어간다
  // (beginRecording 은 recordingStartedRef 가드로 두 번째 호출을 무시함).
  const proceedToSide = () => {
    calibRef.current = null;
    trackerRef.current = null;
    measureStartedRef.current = false;
    setStarted(false);
    setTrialsFound(0);
    trialsFoundRef.current = 0;
    setCalibProgress(0);
    setView('side');
    viewRef.current = 'side';
    setUiPhase('calibrating');
  };

  const [rotationDeg] = useCameraRotation();

  const handleResult = useCallback((landmarks, ts, video) => {
    lastTsRef.current = ts;
    latestVideoElRef.current = video || latestVideoElRef.current;
    // 원본(raw) 그대로 보관 — 녹화 합성 루프가 이 값을 coverTransform(rotationDeg)에
    // 직접 넘겨 자체적으로 회전 보정하므로 여기서 미리 보정하면 이중 회전이 된다.
    latestLandmarksRef.current = landmarks;
    if (!calibRef.current) calibRef.current = new StandingCalibrator({});
    const calib = calibRef.current;

    // 라이브 스켈레톤 오버레이도 CameraStage와 같은 CSS 회전 래퍼를 공유하므로
    // 원본(raw) 좌표를 그대로 쓴다(이중 회전 방지).
    drawSkeleton(canvasRef.current, video, landmarks, calib.locked, null, view, true, fmsPartsRef.current);
    if (!landmarks) return;

    // [2026-08-02] 카메라 원본이 회전된 채로 들어오는 기종(키오스크) 보정 —
    // 스쿼트 판정(기준선·체간기울기·무릎각도·골반높이)은 전부 "수직/좌우" 축을
    // 가정하는 계산이라 회전 보정된 좌표가 필요하다.
    const corrected = rotateLandmarksNormalized(landmarks, rotationDeg);

    if (!calib.locked) {
      calib.push(corrected);
      const st = calib.status();
      if (st.ready) {
        setUiPhase('ready'); // 캘리브레이션 완료
        if (measureStartedRef.current && !trackerRef.current) {
          // 버튼을 캘리브레이션보다 먼저 눌러둔 경우 — 지금 트래커 생성.
          trackerRef.current = new SquatBiomechanicsTracker(calib.result, { maxTrials: SQUAT_LIVE_MAX_TRIALS_PER_VIEW });
        }
      } else if (st.reason === 'low_visibility') {
        setUiPhase('low_visibility');
      } else {
        setUiPhase('calibrating');
        setCalibProgress(st.progress);
      }
      return;
    }

    if (!measureStartedRef.current) return; // 캘리브레이션 완료, 아직 촬영 시작 버튼 대기 중

    if (!trackerRef.current) {
      // 캘리브레이션이 버튼보다 먼저 끝난 일반적인 경우 — 여기서 트래커 생성.
      trackerRef.current = new SquatBiomechanicsTracker(calib.result, { maxTrials: SQUAT_LIVE_MAX_TRIALS_PER_VIEW });
    }
    const tracker = trackerRef.current;
    if (!tracker || tracker.trials.length >= tracker.maxTrials) return;

    const beforeCount = tracker.trials.length;
    tracker.push(corrected, ts);

    if (tracker.phase === 'active') {
      setUiPhase('active');
      const live = tracker.liveDepthState();
      // [2026-08-02] "깊이 120%"가 무슨 뜻인지 알 수 없다는 피드백 반영.
      // 예전 값은 (엉덩이 하강거리 ÷ 선 자세의 엉덩이~무릎 간격)이라 패러렐을
      // 넘으면 100%를 넘고 1.2에서 잘려, 깊게 앉으면 항상 120%로 고정됐다.
      // 이제는 FMS 기준선인 "대퇴골 수평(패러렐)"까지의 진행도로 바꾼다:
      //   0% = 선 자세, 100% = 대퇴골이 수평에 도달(패러렐).
      // 패러렐보다 더 내려가면 thighIncline이 0에서 더 줄지 않으므로 100%에서
      // 자연스럽게 멈추고, 그 아래로 내려갔는지는 belowParallel 배지로 알린다.
      const pct = live ? depthPctFromThighIncline(live.thighInclineDeg) : 0;
      setDepthPct(pct);
      depthPctRef.current = pct;
      const below = !!live && live.depthFrac >= 1;
      setBelowParallel(below);
      belowParallelRef.current = below;

      // 부위별 색상 판정 — 현재 뷰(정면/측면)에서 볼 수 있는 지표만 채점하고
      // 나머지는 unknown(회색)으로 남는다.
      const metrics = tracker.liveMetrics();
      if (metrics) {
        const assessment = evaluateSquatFrame(metrics, view);
        fmsPartsRef.current = assessment.parts;
        setFmsCompensations(assessment.compensations);
      }
    } else if (tracker.trials.length > beforeCount) {
      const t = tracker.trials[tracker.trials.length - 1];
      setLastTrialNote(t.heelLift ? '뒤꿈치 들림이 감지됐어요' : '정상 종료로 기록됨');
      setTrialsFound(tracker.trials.length);
      trialsFoundRef.current = tracker.trials.length;
      setDepthPct(0);
      depthPctRef.current = 0;
      setBelowParallel(false);
      belowParallelRef.current = false;
      fmsPartsRef.current = null;
      setFmsCompensations([]);
      if (tracker.trials.length >= tracker.maxTrials) {
        // 이 뷰(정면/측면)에 필요한 반복을 다 채움 — 다음 단계로.
        if (view === 'front') {
          frontSummaryRef.current = tracker.summary();
          setUiPhase('front_done'); // 정면 완료 — 측면으로 넘어가는 전환 화면 표시
        } else {
          setUiPhase('finished'); // 측면까지 완료 — 종합 제출 가능
        }
      } else {
        // 이 뷰에 반복이 더 필요함(예: 정면 1/2 완료) — 카메라·녹화는 계속
        // 이어지고, 같은 트래커가 다음 반복을 자동으로 이어서 잡는다.
        setUiPhase('rep_done');
      }
    } else {
      setUiPhase('ready');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, rotationDeg]);

  const { videoRef, start, stop, status, error } = usePoseEngine({ onResult: handleResult });

  useEffect(() => {
    if (!startedRef.current) {
      startedRef.current = true;
      start();
    }
    return () => {
      stop();
      stopComposeLoop();
      clearCountdown();
      if (maxRecordTimerRef.current) { clearTimeout(maxRecordTimerRef.current); maxRecordTimerRef.current = null; }
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        try { mediaRecorderRef.current.stop(); } catch (e) { /* noop */ }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (status === 'error' && error) setErrorMsg(error);
  }, [status, error]);

  const markBalanceLoss = () => trackerRef.current?.markBalanceLoss();

  const finishWithBlob = async (blob) => {
    const summary = pendingSummaryRef.current;
    if (!summary) return;
    const previewVideoUrl = blob ? URL.createObjectURL(blob) : '';
    if (typeof onComplete === 'function') {
      await onComplete({ ...summary, videoBlob: blob || null, previewVideoUrl, hasVideo: !!blob });
    }
    setFinishing(false);
  };

  const finishAndSubmit = async () => {
    // view가 'side'이고 측면 트래커가 있으면 그 시행(1~2회, 몇 회든)을 포함,
    // 아니면 정면만으로 종료("측면 생략하고 마치기" 경로 — view는 아직 'front'인
    // 상태로 호출됨). tracker.summary()가 {trial1,trial2,trialsFound}를 그대로
    // 주므로, 반복이 1회뿐이었어도(예: 도중에 마치기) 안전하게 처리된다.
    let sideSummary = null;
    if (view === 'side' && trackerRef.current) {
      trackerRef.current.finalize(lastTsRef.current);
      sideSummary = trackerRef.current.summary();
    }
    const frontSummary = frontSummaryRef.current;
    stop();
    if (maxRecordTimerRef.current) { clearTimeout(maxRecordTimerRef.current); maxRecordTimerRef.current = null; }
    if (!frontSummary?.trial1 && !sideSummary?.trial1) {
      setErrorMsg('유효한 반복(스쿼트)이 없습니다. 무릎 높이까지 충분히 앉는 동작이 카메라에 잘 보이는지 확인하고 다시 시도해 주세요.');
      stopComposeLoop();
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        try { mediaRecorderRef.current.stop(); } catch (e) { /* noop */ }
      }
      return;
    }
    const fms = computeFmsResult(frontSummary, sideSummary);
    const summary = {
      front1: frontSummary?.trial1,
      front2: frontSummary?.trial2,
      side1: sideSummary?.trial1,
      side2: sideSummary?.trial2,
      trialsFound: (frontSummary?.trialsFound || 0) + (sideSummary?.trialsFound || 0),
      fmsScore: fms.score,
      fmsReasons: fms.reasons,
    };
    pendingSummaryRef.current = summary;
    setFinishing(true);
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      try { mediaRecorderRef.current.stop(); } catch (e) { finishWithBlob(null); }
    } else {
      finishWithBlob(null);
    }
  };

  const totalDone = view === 'front' ? trialsFound : (frontSummaryRef.current?.trialsFound || 0) + trialsFound;
  // uiPhase가 'finished'가 되는 시점엔 측면 트래커가 아직 finalize()/초기화되지
  // 않은 채로 trials 2개를 들고 있다(finishAndSubmit에서 하는 것과 동일 소스) —
  // 그 시점에만 계산해 트레이너가 "측정 완료" 누르기 전에 바로 확인한다.
  // [2026-08-03] "종합 판정" 배지는 SquatAnalysisHub.jsx의 리포트 화면과 정확히
  // 같은 함수(evaluateSquatBiomechanics)로 계산한다 — 라이브 미리보기와 잠시 뒤
  // 뜨는 정식 리포트가 서로 다른 상태를 말하는 일이 없도록. FMS 점수는 보조
  // 정보로 같은 배지 안에 작게 덧붙인다.
  const finishedBio = uiPhase === 'finished'
    ? evaluateSquatBiomechanics({
        front1: frontSummaryRef.current?.trial1,
        front2: frontSummaryRef.current?.trial2,
        side1: trackerRef.current?.summary()?.trial1,
        side2: trackerRef.current?.summary()?.trial2,
      })
    : null;
  const finishedFms = uiPhase === 'finished'
    ? computeFmsResult(frontSummaryRef.current, trackerRef.current?.summary())
    : null;

  const topBar = (
    <>
      <p className="text-sm font-black text-white">오버헤드 딥 스쿼트 · {view === 'front' ? '정면' : '측면'}</p>
      {uiPhase === 'calibrating' && <p className="text-xs font-bold text-amber-300">자세 보정 중… {Math.round(calibProgress * 100)}%</p>}
      {uiPhase === 'low_visibility' && <p className="text-xs font-bold text-red-300">전신이 보이도록 서 주세요</p>}
      {!started && !['calibrating', 'low_visibility', 'front_done', 'finished'].includes(uiPhase) && (
        <p className="text-xs font-bold text-emerald-300">준비됐어요 — 녹화 시작을 눌러주세요</p>
      )}
      {started && uiPhase === 'ready' && <p className="text-xs font-bold text-emerald-300">양팔 들고 스쿼트 시작</p>}
      {uiPhase === 'rep_done' && (
        <p className="text-xs font-bold text-emerald-300">
          {trialsFound}회차 완료 — 같은 자세로 한 번 더 스쿼트해 주세요({trialsFound}/{SQUAT_LIVE_MAX_TRIALS_PER_VIEW})
        </p>
      )}
      {uiPhase === 'front_done' && <p className="text-xs font-bold text-emerald-300">정면 촬영 완료! 이제 옆으로 돌아서 주세요</p>}
      {uiPhase === 'finished' && <p className="text-xs font-bold text-emerald-300">정면·측면 모두 완료 — {lastTrialNote}</p>}
      {finishing && <p className="text-xs font-bold text-amber-300">영상 정리 중…</p>}
      {errorMsg && <p className="text-xs font-bold text-red-300">{errorMsg}</p>}
      {/* [2026-08-05] 예전엔 이 아래에 fixed top-3 right-3로 회차 배지를 따로
          띄웠는데, CameraStage의 topBar 자체가 이미 top-right에 이 텍스트들을
          쌓는 중이라 서로 겹쳤다. topBar 스택 안에 넣으면 같은 flex-col
          gap-1.5가 자동으로 줄 간격을 잡아줘서 절대 겹치지 않는다. */}
      <p className="text-xs font-bold text-slate-300">회차 {totalDone}/{SQUAT_LIVE_TOTAL_TRIALS}</p>
    </>
  );

  const controls = (
    <>
      {!started && !['front_done', 'finished'].includes(uiPhase) && (
        <button onClick={startMeasurement} disabled={status !== 'running'}
          className="h-20 w-20 rounded-full border-4 border-white bg-red-500 text-xs font-black text-white shadow-lg disabled:bg-slate-600 disabled:text-slate-300 active:scale-95">
          녹화<br />시작
        </button>
      )}
      {uiPhase === 'active' && (
        <button onClick={markBalanceLoss}
          className="rounded-full bg-red-500/20 border border-red-500/40 text-red-300 font-black text-xs px-4 py-2.5 active:scale-95">
          ⚠ 균형 상실 표시
        </button>
      )}
      {uiPhase === 'front_done' && !finishing && (
        <div className="flex flex-col items-center gap-2">
          <button onClick={proceedToSide}
            className="rounded-full bg-gradient-to-r from-amber-400 to-orange-500 text-slate-950 font-black text-sm px-6 py-3 active:scale-95">
            다음: 측면 촬영 →
          </button>
          <button onClick={finishAndSubmit}
            className="rounded-full bg-slate-700 text-white font-bold text-xs px-4 py-2 active:scale-95">
            측면 생략하고 정면만으로 마치기
          </button>
        </div>
      )}
      {uiPhase === 'finished' && !finishing && (
        <button onClick={finishAndSubmit}
          className="rounded-full bg-emerald-500 text-slate-950 font-black text-xs px-5 py-2.5 active:scale-95">
          측정 완료 →
        </button>
      )}
      {finishing && (
        <div className="flex items-center gap-2 text-xs font-bold text-amber-300">
          <div className="w-4 h-4 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
          저장 중…
        </div>
      )}
    </>
  );

  return (
    <>
    <CameraStage
      videoRef={videoRef} canvasRef={canvasRef} status={status} error={error}
      onClose={onBack} tappable={false} showSkeletonToggle
      topBar={topBar} controls={controls} countdown={countdown}
      recording={recordingActive} recordingLabel={uiPhase === 'active' ? `진행 중 · 깊이 ${depthPct}%` : '녹화 중'}
    >
      {/* [2026-08-05] 예전엔 보상패턴·대퇴골수평·종합판정 배지가 fixed
          bottom-28/bottom-40 고정 픽셀 위치에 떠 있어서, GaugeHud·컨트롤
          버튼 실제 크기와 무관하게 항상 같은 자리를 차지했다 — 보상패턴이
          여러 개 뜨면 그 스택이 GaugeHud를 그대로 뒤덮었다. CameraStage의
          children은 controls 위에 정상 문서 흐름(space-y-3)으로 쌓이므로,
          여기 안에 넣으면 내용이 많아져도 서로 겹치지 않고 위로 밀려날 뿐이다. */}
      {uiPhase === 'active' && (
        <div className="flex flex-col items-center gap-2">
          {fmsCompensations.length > 0 && (
            <div className="flex flex-col items-center gap-1">
              {fmsCompensations.map((c) => (
                <span key={c} className="rounded-full bg-red-500/25 border border-red-400/60 px-3 py-1 text-xs font-bold text-red-200 backdrop-blur">
                  ⚠ {COMPENSATION_KO[c] || c}
                </span>
              ))}
            </div>
          )}
          {belowParallel && (
            <div className="rounded-full bg-sky-500/25 border border-sky-400/60 px-4 py-1.5 backdrop-blur">
              <span className="text-sm font-black text-sky-200">✓ 대퇴골 수평 이하</span>
            </div>
          )}
          <GaugeHud label="패러렐까지" value={depthPct} unit="%" arc min={0} max={100}
            accent={belowParallel ? '#38bdf8' : '#f59e0b'}
            stats={[{ label: '회차', value: `${totalDone}/${SQUAT_LIVE_TOTAL_TRIALS}` }]} />
        </div>
      )}
      {uiPhase === 'finished' && finishedBio && (() => {
        const st = finishedBio.status;
        const theme = st === 'risk'
          ? { border: 'border-red-500/40', bg: 'bg-red-500/20', text: 'text-red-300' }
          : st === 'caution'
          ? { border: 'border-amber-500/40', bg: 'bg-amber-500/20', text: 'text-amber-300' }
          : st === 'normal'
          ? { border: 'border-emerald-500/40', bg: 'bg-emerald-500/20', text: 'text-emerald-300' }
          : { border: 'border-slate-500/40', bg: 'bg-slate-500/20', text: 'text-slate-300' };
        return (
          <div className={`mx-auto w-fit rounded-2xl border ${theme.border} ${theme.bg} px-5 py-2.5 text-center backdrop-blur`}>
            <div className="text-[10px] font-bold text-slate-300 tracking-wide">종합 판정</div>
            <div className={`text-sm font-black ${theme.text}`}>
              {STATUS_KO[st] || '확인 필요'}
              {finishedFms?.score != null && <span className="text-slate-300 font-bold"> · FMS {finishedFms.score}점</span>}
            </div>
          </div>
        );
      })()}
    </CameraStage>
    </>
  );
}
