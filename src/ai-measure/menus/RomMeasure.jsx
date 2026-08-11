// ai-measure/menus/RomMeasure.jsx
// ════════════════════════════════════════════════════════════════════════
//  ROM(관절 가동범위) 측정 — 자세·점프·보행 모듈과 동일한 UI/UX 언어를 따른다.
//   1) 설정 화면: 관절(고/슬/견/족) · 자세모드(서서/누워서/엎드려/앉아서) ·
//      측정 측(좌/우/양쪽) 선택. (Posture 의 면 선택 칩 패턴 재사용)
//   2) 측정 방식: 라이브 녹화(동작을 수행하며 각도 시계열 누적) 또는
//      슬로모 영상 업로드(120/240fps — videoAnalyzer 가 실제 시간축 보정).
//   3) 결과: RomReport(A4) + ReportActions(사진/리포트 저장 → 회원기록 저장).
//
//  측정 정직성: 동작은 '한 번 천천히 끝까지' 수행하라고 안내하고, 정상치 범위를
//  벗어난 값은 대표값 산출에서 제외하며, 데이터가 부족하면 진단을 보류한다.
// ════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { todayYMD } from '../../utils/dates';
import { usePoseEngine } from '../core/usePoseEngine';
import { createSmoother } from '../core/smoothing';
import { RomAccumulator, jointAngleByMode, normalizePose, LM, symmetryIndex } from '../core/bodyMechanics';
import { generateRomDiagnosis } from '../core/romClinical';
import { pickRecorderMime } from '../core/recordSink';
import { beepGo, beepSuccess, primeAudio } from '../core/audioCue';
import CameraStage from './CameraStage.jsx';
import GaugeHud from './GaugeHud.jsx';
import RomReport from './RomReport.jsx';
import ReportActions from '../../components/report/ReportActions';
import { dataUrlToFile } from '../core/reportShare';
import { useHardwareBack } from '../core/useHardwareBack';
import RomSensorGoniometer from './RomSensorGoniometer.jsx';
import RomVideoAngle from './RomVideoAngle.jsx';
import { isSkeletonEnabled } from '../core/skeletonPref';
import { drawGaugeHud } from '../core/recordingOverlay';
import { DEFAULT_ASPECT, outputSize, aspectLabel, drawVideoCover, coverTransform, rotateLandmarksNormalized } from '../core/recordAspect';
import { useCameraRotation } from '../core/useCameraRotation';

const MAX_RECORD_MS = 60000;

const JOINTS = [
  { key: 'HIP', label: '고관절', short: '고관절' },
  { key: 'KNEE', label: '슬관절(무릎)', short: '무릎' },
  { key: 'SHOULDER', label: '견관절(어깨)', short: '어깨' },
  { key: 'ANKLE', label: '족관절(발목)', short: '발목' },
  { key: 'ELBOW', label: '주관절(팔꿈치)', short: '팔꿈치' },
];

// 관절별 허용 자세모드 (해부학적으로 의미 있는 조합만 노출).
const POSE_MODES_BY_JOINT = {
  HIP: [
    { key: 'STANDING', label: '서서 (기능적)', desc: '체중지지 상태의 기능적 굴곡' },
    { key: 'SUPINE', label: '누워서 (구조적)', desc: '보상 통제, 순수 고관절 굴곡' },
    { key: 'PRONE', label: '엎드려 (신전)', desc: '고관절 신전 가동범위' },
  ],
  KNEE: [
    { key: 'STANDING', label: '서서', desc: '체중지지 굴곡' },
    { key: 'SUPINE', label: '누워서', desc: '보상 통제 굴곡' },
    { key: 'PRONE', label: '엎드려', desc: '무릎 굴곡(prone)' },
  ],
  SHOULDER: [
    { key: 'STANDING', label: '서서', desc: '팔 들어올림(굴곡)' },
    { key: 'SEATED', label: '앉아서', desc: '체간 안정 상태 굴곡' },
  ],
  ANKLE: [
    { key: 'STANDING', label: '서서', desc: '배측굴곡' },
    { key: 'SEATED', label: '앉아서', desc: '배측굴곡' },
  ],
  // [2026-08-02 신규] 어깨와 동일하게 눕지 않고 서서/앉아서 능동 굴곡만 본다.
  ELBOW: [
    { key: 'STANDING', label: '서서', desc: '팔꿈치 능동 굴곡(손을 어깨쪽으로)' },
    { key: 'SEATED', label: '앉아서', desc: '체간 안정 상태 굴곡' },
  ],
};

const SIDES = [
  { key: 'left', label: '좌측' },
  { key: 'right', label: '우측' },
  { key: 'both', label: '양쪽' },
];

const BONES = [
  [11, 12], [11, 23], [12, 24], [23, 24],
  [11, 13], [13, 15], [12, 14], [14, 16],
  [23, 25], [25, 27], [27, 29], [27, 31], [29, 31],
  [24, 26], [26, 28], [28, 30], [28, 32], [30, 32],
];

export default function RomMeasure({ member, onSave, onBack, onViewInReport }) {
  // 설정
  const [joint, setJoint] = useState('HIP');
  const [poseMode, setPoseMode] = useState('STANDING');
  const [side, setSide] = useState('both');
  const [mode, setMode] = useState('select'); // select | live | upload | manual(사진) | sensor(센서)

  // 라이브
  const canvasRef = useRef(null);
  const smootherRef = useRef(createSmoother(0.3));
  const accRef = useRef(null);
  const latestLandmarksRef = useRef(null);
  const latestVideoRef = useRef(null);
  const recordingRef = useRef(false);
  const startTsRef = useRef(0);
  const [recording, setRecording] = useState(false);
  const [aspect, setAspect] = useState(DEFAULT_ASPECT);
  const aspectRef = useRef(DEFAULT_ASPECT);
  useEffect(() => { aspectRef.current = aspect; }, [aspect]);
  const [liveAngle, setLiveAngle] = useState({ left: null, right: null });
  const [elapsed, setElapsed] = useState(0);
  const [guide, setGuide] = useState('관절이 보이게 서서, 녹화 버튼을 누른 뒤 동작을 한 번 천천히 끝까지 수행하세요.');

  // ── 녹화(MediaRecorder) — 보행/점프와 동일하게 스켈레톤 오버레이를 합성한
  //    영상 blob 을 만들어 결과 리포트에 첨부(저장·공유)한다. ROM 은 정지 촬영이
  //    아니라 '동작 구간 전체'를 녹화해 회차별로 동작을 되돌려 볼 수 있어야 한다.
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const recordedBlobRef = useRef(null);
  const recordCanvasRef = useRef(null);     // 합성용 오프스크린 캔버스
  const composeRafRef = useRef(null);        // 합성 루프
  const composeIntervalRef = useRef(null);
  const maxRecordTimerRef = useRef(null);
  const recordStreamRef = useRef(null);      // 캔버스 captureStream
  const previewUrlRef = useRef(null);        // blob URL (해제 관리)
  const [previewUrl, setPreviewUrl] = useState(''); // 리포트 영상 미리보기 src
  const [videoBlob, setVideoBlob] = useState(null); // ReportActions 영상 저장용

  // 결과
  const [report, setReport] = useState(null);
  const [snapshotUrl, setSnapshotUrl] = useState('');
  const [saveState, setSaveState] = useState('idle');
  const [actionMsg, setActionMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  // 관절을 바꾸면 그 관절의 첫 허용 자세모드로 보정.
  useEffect(() => {
    const allowed = POSE_MODES_BY_JOINT[joint] || [];
    if (!allowed.some((m) => m.key === poseMode)) setPoseMode(allowed[0]?.key || 'STANDING');
  }, [joint, poseMode]);

  const jointName = JOINTS.find((j) => j.key === joint)?.label || joint;

  // ── [항목 2] 폰 뒤로가기 연동 ──
  // 하위 화면(결과/라이브/업로드/각도기)에서 폰 뒤로가기 = '한 단계'만 뒤로.
  //  결과 → 설정 / 라이브·업로드·각도기 → 설정 / 설정 → (허브가 처리)
  const inSubView = !!report || mode !== 'select';
  const goBackOneStep = () => {
    if (report) { resetAll(); return; }
    if (mode !== 'select') {
      // 라이브 녹화 중이었으면 상태도 함께 정리(카메라 정지는 mode 이펙트 cleanup 이 처리)
      recordingRef.current = false;
      setRecording(false);
      setElapsed(0);
      accRef.current = null;
      setMode('select');
      return;
    }
    onBack?.();
  };
  useHardwareBack(inSubView, goBackOneStep);

  const [rotationDeg] = useCameraRotation();

  // ── 라이브 프레임 콜백 ──
  const handlePose = useCallback((landmarks, ts, video) => {
    latestVideoRef.current = video || latestVideoRef.current;
    const smoothed = landmarks ? smootherRef.current(landmarks) : smootherRef.current(null);
    latestLandmarksRef.current = smoothed || latestLandmarksRef.current;
    // 라이브 스켈레톤 오버레이는 CameraStage의 video와 같은 CSS 회전 래퍼
    // 안에 있어 원본(raw) 좌표를 그대로 써야 한다(이중 회전 방지).
    drawSkeleton(canvasRef.current, video, smoothed, side, joint, poseMode);

    if (!smoothed) return;

    // [2026-08-02] 카메라 원본이 회전된 채로 들어오는 기종(키오스크) 보정 —
    // 각도 판정(accRef 누적·라이브 각도 표시)은 "위/아래" 기준 계산이 섞여
    // 있어 회전 보정된 좌표를 써야 한다.
    const corrected = rotateLandmarksNormalized(smoothed, rotationDeg);
    if (recordingRef.current && accRef.current) {
      const tMs = ts - startTsRef.current;
      accRef.current.push(corrected, tMs);
      setElapsed(Math.round(tMs / 100) / 10);
      // 라이브 각도 표시(정규화 후 현재 프레임)
      const norm = normalizePose(corrected) || corrected;
      const L = jointAngleByMode(norm, joint, 'left', poseMode).angle;
      const R = jointAngleByMode(norm, joint, 'right', poseMode).angle;
      setLiveAngle({ left: L, right: R });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [joint, poseMode, side, rotationDeg]);

  const { videoRef, start, stop, status, error } = usePoseEngine({ onResult: handlePose, modelTier: 'full' });

  useEffect(() => {
    if (mode !== 'live') return undefined;
    const timer = setTimeout(() => start(videoRef.current), 80);
    return () => {
      clearTimeout(timer);
      stop();
      if (composeRafRef.current) { cancelAnimationFrame(composeRafRef.current); composeRafRef.current = null; }
      if (composeIntervalRef.current) { clearInterval(composeIntervalRef.current); composeIntervalRef.current = null; }
      if (maxRecordTimerRef.current) { clearTimeout(maxRecordTimerRef.current); maxRecordTimerRef.current = null; }
      if (recordStreamRef.current) { recordStreamRef.current.getTracks().forEach((t) => t.stop()); recordStreamRef.current = null; }
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        try { mediaRecorderRef.current.stop(); } catch (e) { /* noop */ }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // 녹화용 합성 스트림: 카메라 영상 + 스켈레톤 오버레이를 캔버스에 매 프레임
  // 그려 captureStream 으로 뽑는다(보행 createRecordedStream 과 동일 구조).
  const createRecordedStream = () => {
    const video = videoRef.current;
    const size = outputSize(aspectRef.current); // 인스타 비율 통일(3:4 / 1:1)
    const canvas = recordCanvasRef.current || document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    recordCanvasRef.current = canvas;
    const ctx = canvas.getContext('2d', { alpha: false });
    const draw = () => {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      drawVideoCover(ctx, video, canvas.width, canvas.height, rotationDeg); // 검은 여백 없이 중앙 크롭(+회전 보정)
      const cover = coverTransform(video, canvas.width, canvas.height, rotationDeg); // 스켈레톤 좌표 정렬용
      // 스켈레톤(측정 측 강조) + 좌우 각도 HUD 를 영상 위에 베이크.
      drawSkeletonToRecord(ctx, latestLandmarksRef.current, side, joint, poseMode, canvas.width, canvas.height, cover);
      drawRomHud(ctx, latestLandmarksRef.current, joint, poseMode, canvas.width, canvas.height,
        (performance.now() - startTsRef.current) / 1000, side);
    };
    const rafLoop = () => { draw(); composeRafRef.current = requestAnimationFrame(rafLoop); };
    if (composeRafRef.current) cancelAnimationFrame(composeRafRef.current);
    rafLoop();
    if (composeIntervalRef.current) clearInterval(composeIntervalRef.current);
    composeIntervalRef.current = setInterval(draw, 66);
    const canvasStream = canvas.captureStream ? canvas.captureStream(30) : null;
    if (!canvasStream) return null;
    recordStreamRef.current = canvasStream;
    return canvasStream;
  };

  // 라이브 측정 중(녹화 전) 위치(관절) 전환. 누적 각도/가이드를 리셋한다.
  const changeJointLive = (nextJoint) => {
    if (recording) return;
    setJoint(nextJoint);
    const allowed = POSE_MODES_BY_JOINT[nextJoint] || [];
    if (!allowed.some((m) => m.key === poseMode)) {
      setPoseMode(allowed[0]?.key || 'STANDING');
    }
    setLiveAngle({ left: null, right: null });
    accRef.current = null;
    const nm = JOINTS.find((j) => j.key === nextJoint)?.label || nextJoint;
    setGuide(`${nm} 위치로 변경했습니다. 관절이 보이게 선 뒤 녹화를 시작하세요.`);
  };

  // 라이브 측정 중(녹화 전) 자세 모드 전환.
  const changePoseLive = (nextPose) => {
    if (recording) return;
    setPoseMode(nextPose);
    setLiveAngle({ left: null, right: null });
    accRef.current = null;
  };

  const beginRecord = () => {
    primeAudio();
    accRef.current = new RomAccumulator({ joint, poseMode });
    startTsRef.current = performance.now();
    chunksRef.current = [];
    recordedBlobRef.current = null;
    setVideoBlob(null);
    setErrorMsg(''); // 새 시도 시작 — 이전 시도의 녹화 실패 메시지가 남아있지 않게 초기화.
    if (previewUrlRef.current) { URL.revokeObjectURL(previewUrlRef.current); previewUrlRef.current = null; }
    setPreviewUrl('');

    // MediaRecorder 시작 (지원 시). 미지원 환경이면 분석만 진행(영상 없음).
    try {
      // [2026-08-03] 로컬 mp4-우선 배열 대신 공용 pickRecorderMime()을 쓴다 —
      // 코덱까지 명시해야 크로미움에서 mp4가 실제로 잡힌다(recordSink.js 참고).
      const selectedMime = pickRecorderMime();
      const stream = createRecordedStream();
      if (stream) {
        const mr = new MediaRecorder(stream, selectedMime ? { mimeType: selectedMime } : undefined);
        mediaRecorderRef.current = mr;
        mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
        mr.onstop = () => {
          if (composeRafRef.current) { cancelAnimationFrame(composeRafRef.current); composeRafRef.current = null; }
          if (composeIntervalRef.current) { clearInterval(composeIntervalRef.current); composeIntervalRef.current = null; }
          if (recordStreamRef.current) { recordStreamRef.current.getTracks().forEach((t) => t.stop()); recordStreamRef.current = null; }
          const type = mr.mimeType || 'video/webm';
          const blob = new Blob(chunksRef.current, { type });
          recordedBlobRef.current = blob;
          const url = URL.createObjectURL(blob);
          if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
          previewUrlRef.current = url;
          setPreviewUrl(url);
          setVideoBlob(blob);
          finalizeReport(url);
        };
        mr.start();
      }
    } catch (e) {
      mediaRecorderRef.current = null;
      // [버그 수정 2026-08-08] 예전엔 여기서 조용히 null만 세팅해서, 녹화가 아예
      // 시작 안 됐는데도 사용자는 그걸 알 방법이 없었다(측정은 정상 진행되고
      // 리포트도 나오지만 영상만 소리 없이 빠짐). errorMsg는 있었는데 실제로
      // 어디서도 set/렌더 안 되던 죽은 state였다 — 여기가 그 용도에 맞는 지점.
      setErrorMsg('영상 녹화를 시작하지 못했어요. 측정은 계속 진행되지만 영상은 저장되지 않습니다.');
    }

    recordingRef.current = true;
    setRecording(true);
    setElapsed(0);
    if (maxRecordTimerRef.current) clearTimeout(maxRecordTimerRef.current);
    maxRecordTimerRef.current = setTimeout(() => {
      if (recordingRef.current) finishRecord();
    }, MAX_RECORD_MS);
    setGuide('동작을 한 번 천천히 최대 지점까지 수행한 뒤 돌아오세요.');
    beepGo();
  };

  const finishRecord = () => {
    if (maxRecordTimerRef.current) { clearTimeout(maxRecordTimerRef.current); maxRecordTimerRef.current = null; }
    recordingRef.current = false;
    setRecording(false);
    const acc = accRef.current;
    if (!acc) return;
    const summary = acc.summary();
    if (!summary.valid) {
      setGuide('측정 프레임이 부족합니다. 관절이 보이게 하고 동작을 다시 수행해 주세요.');
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        try { mediaRecorderRef.current.stop(); } catch (e) { /* noop */ }
      }
      return;
    }
    beepSuccess();
    const snap = captureVideoSnapshot(latestVideoRef.current, rotationDeg);
    setSnapshotUrl(snap);
    pendingSnapRef.current = snap;
    pendingSummaryRef.current = summary;
    // MediaRecorder 가 있으면 onstop 에서 영상 URL 과 함께 리포트를 확정한다.
    // 없으면(미지원) 즉시 영상 없이 리포트를 만든다.
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      try { mediaRecorderRef.current.stop(); } catch (e) { finalizeReport(''); }
    } else {
      finalizeReport('');
    }
    stop();
  };

  // 녹화 종료(또는 미지원) 후 리포트 확정. snap/summary 는 finishRecord 에서 보관.
  const pendingSnapRef = useRef('');
  const pendingSummaryRef = useRef(null);
  const finalizeReport = (videoUrl) => {
    const summary = pendingSummaryRef.current;
    if (!summary) return;
    buildAndSetReport(summary, 'live', pendingSnapRef.current, videoUrl);
  };

  // ── 업로드 ──
  const buildAndSetReport = (summary, captureMode, snap, videoUrl = '', extra = {}) => {
    const diagnosis = generateRomDiagnosis(summary, { joint, poseMode });
    const r = {
      kind: 'rom',
      member: member ? { id: member.id, name: member.name } : null,
      memberId: member?.id || null,
      memberName: member?.name || '',
      recordedAt: todayYMD(),
      measuredAt: new Date().toISOString(),
      isVirtualMember: member?.isVirtual === true,
      linkedPostureReportId: '',
      basic_info: {
        memberId: member?.id || '',
        trainerId: '',
        createdAt: new Date(),
        linkedPostureReportId: '',
      },
      // test_configuration (스키마)
      joint,
      poseMode,
      side,
      viewAngle: poseMode === 'STANDING' ? 'SIDE' : 'SIDE',
      captureMode,
      // evaluation_result + raw_time_series_data (스키마)
      summary,
      diagnosis,
      snapshotUrl: snap || '',
      previewVideoUrl: videoUrl || '', // 화면 전용(저장 제외) — 녹화 영상 미리보기
      hasVideo: !!videoUrl,
      // 회차별 비교용 키
      pairKey: member?.id ? `${member.id}_rom_${joint}_${poseMode}` : `rom_${joint}_${poseMode}`,
      ...extra,
    };
    setReport(r);
    setSaveState('idle');
    return r;
  };

  // 리포트 payload 를 직접 저장(자동 저장용). report state 를 기다리지 않고
  // 방금 만든 리포트를 바로 Firestore 로 넘긴다.
  const persistReport = async (r) => {
    if (!member) { setActionMsg('회원이 선택되지 않아 기록 저장은 건너뜁니다.'); return; }
    if (!r) return;
    setSaveState('saving');
    try {
      const { snapshotUrl: _snap, previewVideoUrl: _pv, ...payload } = r;
      await onSave?.(payload);
      setSaveState('saved');
    } catch (e) {
      setSaveState('error');
    }
  };

  // ── 센서 각도기 측정 완료 → 기존 ROM 리포트/저장 파이프라인에 합류 ──
  //  results = { left?: {side, angle, recordedAt}, right?: {...} }
  //  · 좌우 비대칭: 카메라 측정과 동일한 symmetryIndex 공식으로 자동 산출.
  //  · Firestore: 기존 rom 리포트 스키마에 measureType/sensor_records/
  //    confidenceScore 를 추가해 통합 저장(허브 handleSave → addRomReport).
  const handleSensorComplete = (results, meta = {}) => {
    // 좌/우 구분 없이 단일 측정. { single: { angle, recordedAt } }
    const A = results?.single?.angle ?? null;
    const recordedAtIso = results?.single?.recordedAt || new Date().toISOString();
    const movement = meta.movement || '';
    const summary = {
      valid: A != null,
      joint,
      poseMode,
      movement, // 수기 기록한 세부 움직임
      max_rom: A,             // 단일 가동각
      left_max_rom: A,        // 리포트/차트 호환(단일값을 대표값으로)
      right_max_rom: null,
      symmetry_index_score: null, // 단일 측정이라 좌우 비대칭 없음
      compensation: {}, // 센서 측정은 골반/체간 보상 추정 불가(카메라 전용) — 비워둠(정직성)
    };
    const memberId = member?.id || '';
    const sensorRecords = A == null ? [] : [{
      memberId,
      measureType: 'sensor_goniometer',
      jointName: joint.toLowerCase(),
      movement,
      angle: A,
      recordedAt: recordedAtIso,
      confidenceScore: 1.0, // 센서(하드웨어) 기울기 — 카메라 추정 대비 고신뢰 표시
    }];
    // 회차 비교 키: 같은 관절·자세·움직임끼리 묶는다(수기 움직임 라벨 반영).
    const movementSlug = movement ? `_${movement.replace(/\s+/g, '').slice(0, 24)}` : '';
    const pairKey = memberId
      ? `${memberId}_rom_${joint}_${poseMode}${movementSlug}`
      : `rom_${joint}_${poseMode}${movementSlug}`;
    const r = buildAndSetReport(summary, 'sensor', '', '', {
      measureType: 'sensor_goniometer',
      movement,
      sensor_records: sensorRecords,
      confidenceScore: 1.0,
      pairKey,
      // 허브가 저장 성공 후 회원 신체기록에 ROM 요약을 남기도록 하는 힌트
      romBodySummary: {
        joint,
        poseMode,
        movement,
        angle: A,
        unit: 'deg',
        measureType: 'sensor_goniometer',
        confidenceScore: 1.0,
      },
    });
    // 확인 즉시 데이터 자동 저장(회원 측정이력·ROM리포트·신체기록 요약).
    // 저장 후 리포트 화면이 떠 '기록 확인'이 가능하다.
    persistReport(r);
  };

  const handleSave = async () => {
    if (!member) { setActionMsg('회원이 선택되지 않아 기록 저장은 건너뜁니다.'); return; }
    if (!report) return;
    setSaveState('saving');
    try {
      const { snapshotUrl: _snap, previewVideoUrl: _pv, ...payload } = report; // ObjectURL 은 저장 제외
      await onSave?.(payload);
      setSaveState('saved');
    } catch (e) {
      setSaveState('error');
    }
  };

  const resetAll = () => {
    setReport(null);
    setSnapshotUrl('');
    setSaveState('idle');
    setActionMsg('');
    setErrorMsg('');
    accRef.current = null;
    recordingRef.current = false;
    setRecording(false);
    if (previewUrlRef.current) { URL.revokeObjectURL(previewUrlRef.current); previewUrlRef.current = null; }
    setPreviewUrl('');
    setVideoBlob(null);
    recordedBlobRef.current = null;
    chunksRef.current = [];
    pendingSummaryRef.current = null;
    pendingSnapRef.current = '';
    setMode('select');
  };

  // ════════════════ 결과 화면 ════════════════
  if (report) {
    let snapFile = null;
    if (report.snapshotUrl) {
      try { snapFile = dataUrlToFile(report.snapshotUrl, `몸가짐_${member?.name || '회원'}_ROM_${joint}.jpg`); } catch (e) { snapFile = null; }
    }
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <button onClick={onBack} className="measure-back">← 메뉴</button>
          <h2 className="measure-title">ROM 가동범위</h2>
          <button onClick={resetAll} className="measure-back">다시 측정</button>
        </div>

        <div className="overflow-x-auto">
          <RomReport report={{ ...report, snapshotUrl: report.snapshotUrl }} member={member} />
        </div>

        {/* 녹화 영상 미리보기 — 리포트 캡처 노드(#rom-report-sheet) 바깥에 둔다
            (html2canvas 는 video 를 캡처하지 못하므로). 동작 전 구간을 되돌려 본다. */}
        {report.previewVideoUrl && (
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3">
            <p className="mb-2 text-xs font-bold text-slate-500 dark:text-slate-400">측정 녹화 영상 (스켈레톤·각도 오버레이)</p>
            <video
              src={report.previewVideoUrl}
              className="w-full rounded-xl bg-black"
              controls playsInline loop muted
              style={{ maxHeight: 360 }}
            />
          </div>
        )}

        <div className="space-y-2 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/95 dark:bg-slate-950/95 p-3">
          <ReportActions
            reportNodeId="rom-report-sheet"
            videoBlob={videoBlob}
            imageFiles={snapFile ? [snapFile] : null}
            imageButtonLabel="📸 캡처 저장"
            baseName={`${member?.name || '회원'}_ROM`}
            reportButtonLabel={saveState === 'saved' ? '✓ 리포트 저장됨' : '🖼 리포트 저장'}
            onAfterReportSave={handleSave}
            onMessage={setActionMsg}
          />
          {actionMsg && <p className="text-center text-xs text-slate-500 dark:text-slate-400">{actionMsg}</p>}
          {saveState === 'saved' && <p className="text-center text-xs font-bold text-emerald-700 dark:text-emerald-400">회원 기록에 저장되었습니다.</p>}
          {saveState === 'error' && <p className="text-center text-xs text-red-700 dark:text-red-400">저장 실패. ‘리포트 저장’을 다시 눌러 주세요.</p>}
          {errorMsg && <p className="text-center text-xs text-red-700 dark:text-red-400">{errorMsg}</p>}
          {/* [리포트 통합 2026-08-09] PostureMeasure.jsx와 동일 패턴 — 강제 이동 아님. */}
          {saveState === 'saved' && !member?.isVirtual && typeof onViewInReport === 'function' && (
            <button
              onClick={onViewInReport}
              className="w-full rounded-xl border border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300 font-bold text-sm py-2.5"
            >
              📊 결과리포트에서 보기
            </button>
          )}
        </div>
      </div>
    );
  }

  // ════════════════ 고니오메타(폰 밀착 센서) 화면 ════════════════
  if (mode === 'sensor') {
    return (
      <RomSensorGoniometer
        jointName={jointName}
        jointKey={joint}
        onBack={() => setMode('select')}
        onComplete={handleSensorComplete}
      />
    );
  }

  // ════════════════ [항목 4] 영상 업로드 — 스포츠 수행 각도 확인 ════════════════
  //  특정 관절 자동 ROM 이 아니라, 수행 영상에서 원하는 장면의 각도를 직접 측정.
  //  [4-1] 속도조절 · [4-2] 캡처 · [4-3] 캡처 프레임에서 사진 각도기(3점 탭).
  if (mode === 'upload') {
    return (
      <RomVideoAngle
        member={member}
        onBack={() => setMode('select')}
      />
    );
  }

  // ════════════════ 라이브 화면 ════════════════
  if (mode === 'live') {
    return (
      <CameraStage
        videoRef={videoRef}
        canvasRef={canvasRef}
        status={status}
        error={error}
        onClose={onBack}
        tappable={false}
        showSkeletonToggle
        recording={recording}
        recordingLabel={`측정 중 ${elapsed}s`}
        aspectFrame={aspect}
        topBar={
          <div className="w-full text-right">
            <p className="text-sm font-black text-white">ROM · {jointName}</p>
            <p className="text-[11px] font-bold text-amber-700 dark:text-amber-300">
              {member?.name || '회원 미선택'} · {POSE_LABEL[poseMode]} · {side === 'both' ? '양쪽' : side === 'left' ? '좌측' : '우측'}
            </p>
            <div className="mt-1 flex justify-end gap-0.5">
              {['3/4', '1/1'].map((r) => (
                <button key={r} onClick={() => !recording && setAspect(r)} disabled={recording}
                  className={`rounded-full px-2 py-0.5 text-[10px] font-black transition-colors disabled:opacity-50 ${aspect === r ? 'bg-amber-500 text-slate-950' : 'bg-black/45 text-slate-600 dark:text-slate-300'}`}>
                  {aspectLabel(r)}
                </button>
              ))}
            </div>
          </div>
        }
        controls={
          !recording ? (
            <button onClick={beginRecord} disabled={status !== 'running'}
              className="h-20 w-20 rounded-full border-4 border-white bg-red-500 text-xs font-black text-white shadow-lg disabled:bg-slate-300 dark:disabled:bg-slate-600 disabled:text-slate-600 dark:disabled:text-slate-300">
              녹화<br />시작
            </button>
          ) : (
            <button onClick={finishRecord}
              className="h-20 w-20 rounded-full border-4 border-white bg-white dark:bg-slate-900 text-xs font-black text-amber-700 dark:text-amber-300 shadow-lg">
              ■<br />종료
            </button>
          )
        }
      >
        <div className="mx-auto max-w-md space-y-2">
          {/* 측정 중 위치(관절)·자세 변경: 녹화 전에는 자유롭게 바꿀 수 있다.
              녹화 중에는 일관성을 위해 비활성화. */}
          <div className="flex flex-wrap justify-center gap-1">
            {JOINTS.map((j) => (
              <button
                key={j.key}
                type="button"
                disabled={recording}
                onClick={() => changeJointLive(j.key)}
                className={`rounded-full border px-2.5 py-1 text-[11px] font-black transition ${
                  joint === j.key
                    ? 'border-amber-300 bg-amber-400 text-slate-950'
                    : 'border-white/20 bg-black/45 text-white/80'
                } ${recording ? 'opacity-40' : ''}`}>
                {j.short}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap justify-center gap-1">
            {(POSE_MODES_BY_JOINT[joint] || []).map((m) => (
              <button
                key={m.key}
                type="button"
                disabled={recording}
                onClick={() => changePoseLive(m.key)}
                className={`rounded-full border px-2.5 py-1 text-[11px] font-bold transition ${
                  poseMode === m.key
                    ? 'border-emerald-300 bg-emerald-400 text-slate-950'
                    : 'border-white/15 bg-black/40 text-white/70'
                } ${recording ? 'opacity-40' : ''}`}>
                {m.label}
              </button>
            ))}
          </div>
          {recording && (() => {
            const L = liveAngle.left, R = liveAngle.right;
            const primary = side === 'left' ? L : side === 'right' ? R
              : (L != null && R != null ? Math.max(L, R) : (L ?? R));
            return (
              <GaugeHud
                label="가동범위"
                value={primary == null ? null : Math.round(primary)}
                unit="°"
                accent="#38bdf8"
                stats={[
                  { label: '좌측', value: L == null ? null : Math.round(L), unit: '°', tone: side === 'right' ? 'text-slate-500' : 'text-white' },
                  { label: '우측', value: R == null ? null : Math.round(R), unit: '°', tone: side === 'left' ? 'text-slate-500' : 'text-white' },
                ]}
              />
            );
          })()}
          <div className="rounded-2xl border border-white/10 bg-black/55 px-4 py-3 text-center text-sm font-bold text-white backdrop-blur">
            <span className="text-amber-700 dark:text-amber-300">{jointName}</span> · {guide}
          </div>
        </div>
      </CameraStage>
    );
  }

  // ════════════════ 설정/시작 화면 ════════════════
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="measure-back">← 메뉴</button>
        <h2 className="measure-title">ROM 관절 가동범위</h2>
        <span className="w-12" />
      </div>

      {/* 측정 관절·자세는 라이브 측정 화면에서 즉시 바꾼다(첫 페이지 중복 제거). */}

      {/* 측정 측 */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
        <p className="mb-2 text-xs font-bold text-slate-500 dark:text-slate-400">측정 측</p>
        <div className="flex gap-2">
          {SIDES.map((s) => (
            <button key={s.key} type="button" onClick={() => setSide(s.key)}
              className={`flex-1 rounded-lg border py-2 text-sm font-black ${
                side === s.key ? 'border-amber-400 bg-amber-400 text-slate-950' : 'border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'
              }`}>
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* 측정 방식 시작 */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-3">
        <p className="text-sm font-bold text-slate-700 dark:text-slate-200">측정 방식을 선택하세요</p>
        <button onClick={() => setMode('live')}
          className="w-full rounded-xl bg-amber-500 px-4 py-4 text-left active:scale-[0.99] transition">
          <p className="text-base font-black text-slate-950">라이브 측정 (권장) <span className="text-[10px] font-bold text-slate-900/60 align-middle">카메라 분석</span></p>
          <p className="mt-0.5 text-xs font-bold text-slate-900/80">카메라 앞에서 동작을 한 번 천천히 수행 → 최대 가동범위 자동 산출.</p>
        </button>
        <button onClick={() => setMode('upload')}
          className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 px-4 py-4 text-left active:scale-[0.99] transition">
          <p className="text-base font-black text-white">영상 업로드 <span className="text-[10px] font-bold text-slate-500 align-middle">수행 각도 확인</span></p>
          <p className="mt-0.5 text-xs font-bold text-slate-500 dark:text-slate-400">스포츠 수행 영상 → 속도 조절·프레임 캡처 후, 그 장면에서 각도 직접 측정.</p>
        </button>
        <button onClick={() => setMode('sensor')}
          className="w-full rounded-xl border border-emerald-500/50 bg-emerald-500/10 px-4 py-4 text-left active:scale-[0.99] transition">
          <p className="text-base font-black text-emerald-200">고니오메타 <span className="text-[10px] font-bold text-emerald-700 dark:text-emerald-400/70 align-middle">카메라 불필요 · 폰 밀착 센서</span></p>
          <p className="mt-0.5 text-xs font-bold text-emerald-700 dark:text-emerald-300/80">폰을 관절 부위에 밀착 → 기울기 센서로 가동각 측정 · 좌우 비대칭 자동 산출.</p>
        </button>
        <p className="text-[11px] text-slate-500 leading-relaxed">
          ※ {POSE_LABEL[poseMode]} 자세에서는{' '}
          {poseMode === 'STANDING'
            ? '체중지지 상태의 기능적 가동성과 골반 보상 작용을 함께 평가합니다.'
            : '지면 지지로 보상을 통제한 순수 구조적 가동범위를 평가합니다.'}
        </p>
      </div>
    </div>
  );
}

const POSE_LABEL = { STANDING: '서서', SUPINE: '누워서', PRONE: '엎드려', SEATED: '앉아서' };

// ── 스켈레톤 드로잉 (측정 측 강조) ──
function drawSkeleton(canvas, video, landmarks, side, joint, poseMode) {
  if (!canvas || !video) return;
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, width, height);
  if (!landmarks) return;
  if (!isSkeletonEnabled()) return; // OFF: 캔버스만 비우고 오버레이 미표시(추적은 계속)
  const mapper = objectContainMapper(video, width, height);

  // 측정 측 관절 인덱스(강조용)
  const leftIdx = new Set([11, 13, 15, 23, 25, 27, 29, 31]);
  const rightIdx = new Set([12, 14, 16, 24, 26, 28, 30, 32]);

  ctx.lineWidth = 2.25;
  ctx.lineCap = 'round';
  BONES.forEach(([a, b]) => {
    const pa = landmarks[a]; const pb = landmarks[b];
    if (!vis(pa) || !vis(pb)) return;
    const onLeft = leftIdx.has(a) && leftIdx.has(b);
    const onRight = rightIdx.has(a) && rightIdx.has(b);
    let active = true;
    if (side === 'left') active = onLeft || (!onRight);
    else if (side === 'right') active = onRight || (!onLeft);
    ctx.strokeStyle = active ? 'rgba(52,211,153,0.9)' : 'rgba(148,163,184,0.35)';
    ctx.beginPath();
    ctx.moveTo(mapper.x(pa), mapper.y(pa));
    ctx.lineTo(mapper.x(pb), mapper.y(pb));
    ctx.stroke();
  });

  [11, 12, 13, 14, 23, 24, 25, 26, 27, 28].forEach((i) => {
    const p = landmarks[i];
    if (!vis(p)) return;
    const isL = leftIdx.has(i); const isR = rightIdx.has(i);
    let active = true;
    if (side === 'left') active = isL;
    else if (side === 'right') active = isR;
    ctx.fillStyle = active ? 'rgba(251,191,36,0.95)' : 'rgba(255,255,255,0.55)';
    ctx.beginPath();
    ctx.arc(mapper.x(p), mapper.y(p), active ? 4.5 : 3, 0, Math.PI * 2);
    ctx.fill();
  });

  drawMeasuredJointOverlay(ctx, landmarks, side, joint, poseMode, width, height, mapper);
}

function vis(p, threshold = 0.35) {
  return !!p && Number.isFinite(p.x) && (p.visibility == null || p.visibility >= threshold);
}

function objectContainMapper(video, width, height) {
  const vw = video?.videoWidth || width;
  const vh = video?.videoHeight || height;
  const scale = Math.min(width / vw, height / vh);
  const drawW = vw * scale;
  const drawH = vh * scale;
  const ox = (width - drawW) / 2;
  const oy = (height - drawH) / 2;
  return { x: (p) => ox + p.x * drawW, y: (p) => oy + p.y * drawH };
}

function captureVideoSnapshot(video, rotationDeg = 0) {
  if (!video?.videoWidth || !video?.videoHeight) return '';
  const swapped = rotationDeg === 90 || rotationDeg === 270;
  const canvas = document.createElement('canvas');
  // [2026-08-02] 회전 보정: 90/270에서는 저장될 사진의 가로/세로가 원본과 반대.
  canvas.width = swapped ? video.videoHeight : video.videoWidth;
  canvas.height = swapped ? video.videoWidth : video.videoHeight;
  const ctx = canvas.getContext('2d');
  if (!drawVideoCover(ctx, video, canvas.width, canvas.height, rotationDeg)) return '';
  return canvas.toDataURL('image/jpeg', 0.82);
}

// ── 녹화 합성용: 스켈레톤을 '캔버스 전체(가득 채움)' 좌표로 직접 그린다.
//   record 캔버스는 영상을 edge-to-edge 로 그리므로 정규화 좌표(0~1)에
//   width/height 만 곱하면 된다(레터박스 보정 불필요).
function drawSkeletonToRecord(ctx, landmarks, side, joint, poseMode, width, height, cover = null) {
  if (!landmarks) return;
  if (!isSkeletonEnabled()) return; // OFF: 녹화 영상도 스켈레톤 없이 원본+HUD만
  const X = cover?.X || ((p) => p.x * width);
  const Y = cover?.Y || ((p) => p.y * height);
  const leftIdx = new Set([11, 13, 15, 23, 25, 27, 29, 31]);
  const rightIdx = new Set([12, 14, 16, 24, 26, 28, 30, 32]);
  ctx.lineWidth = Math.max(2, width / 280);
  ctx.lineCap = 'round';
  RECORD_BONES.forEach(([a, b]) => {
    const pa = landmarks[a]; const pb = landmarks[b];
    if (!vis(pa) || !vis(pb)) return;
    const onLeft = leftIdx.has(a) && leftIdx.has(b);
    const onRight = rightIdx.has(a) && rightIdx.has(b);
    let active = true;
    if (side === 'left') active = onLeft || (!onRight);
    else if (side === 'right') active = onRight || (!onLeft);
    ctx.strokeStyle = active ? 'rgba(52,211,153,0.92)' : 'rgba(148,163,184,0.4)';
    ctx.beginPath();
    ctx.moveTo(X(pa), Y(pa));
    ctx.lineTo(X(pb), Y(pb));
    ctx.stroke();
  });
  [11, 12, 13, 14, 23, 24, 25, 26, 27, 28].forEach((i) => {
    const p = landmarks[i];
    if (!vis(p)) return;
    ctx.fillStyle = 'rgba(251,191,36,0.95)';
    ctx.beginPath();
    ctx.arc(X(p), Y(p), Math.max(3, width / 180), 0, Math.PI * 2);
    ctx.fill();
  });

  drawMeasuredJointOverlay(ctx, landmarks, side, joint, poseMode, width, height, { x: X, y: Y }, true);
}

function drawMeasuredJointOverlay(ctx, landmarks, side, joint, poseMode, width, height, mapper, strong = false) {
  if (!landmarks || !joint) return;
  const norm = normalizePose(landmarks) || landmarks;
  const sides = side === 'both' ? ['left', 'right'] : [side === 'right' ? 'right' : 'left'];
  sides.forEach((targetSide) => {
    const geometry = romOverlayGeometry(landmarks, targetSide, joint, poseMode, mapper, width, height);
    if (!geometry) return;
    const angle = jointAngleByMode(norm, joint, targetSide, poseMode).angle;
    drawAngleBadge(ctx, geometry, {
      label: `${targetSide === 'left' ? 'L' : 'R'} ${angle == null ? '--' : Math.round(angle)}°`,
      color: targetSide === 'left' ? '#38bdf8' : '#f59e0b',
      strong,
    });
  });
}

function romOverlayGeometry(landmarks, side, joint, poseMode, mapper, width, height) {
  const S = side === 'left' ? 'LEFT' : 'RIGHT';
  const p = (name) => {
    const lm = landmarks?.[LM[`${S}_${name}`]];
    return vis(lm) ? { x: mapper.x(lm), y: mapper.y(lm) } : null;
  };
  const hip = p('HIP');
  const knee = p('KNEE');
  const ankle = p('ANKLE');
  const shoulder = p('SHOULDER');
  const elbow = p('ELBOW');
  const wrist = p('WRIST');
  const foot = p('FOOT_INDEX');
  const refLen = Math.max(42, Math.min(width, height) * 0.16);
  // 기준선 표시점: STANDING/SEATED는 화면상 '위쪽'(중력수직선, 실제 계산과 일치).
  // 그 외(SUPINE/PRONE)는 몸통 축(trunkRef→v)을 v 너머로 연장한 점 — 화면 고정
  // 방향이 아니라 실제 계산 기준선(어깨↔고관절)과 항상 일치하도록 한다
  // (2026-08-01: 각도 계산을 몸통 축 기준으로 바꾼 것과 오버레이 표시를 통일).
  const refPoint = (v, trunkRef) => {
    if (!v) return null;
    if (poseMode === 'STANDING' || poseMode === 'SEATED') return { x: v.x, y: v.y - refLen };
    if (trunkRef) {
      const dx = v.x - trunkRef.x;
      const dy = v.y - trunkRef.y;
      const len = Math.hypot(dx, dy) || 1;
      return { x: v.x + (dx / len) * refLen, y: v.y + (dy / len) * refLen };
    }
    return { x: v.x + refLen, y: v.y }; // 폴백(반대쪽 몸통 랜드마크 미검출 시)
  };
  if (joint === 'HIP' && hip && knee) return { a: refPoint(hip, shoulder), b: hip, c: knee };
  if (joint === 'KNEE' && hip && knee && ankle) return { a: hip, b: knee, c: ankle };
  if (joint === 'SHOULDER' && shoulder && elbow) return { a: refPoint(shoulder, hip), b: shoulder, c: elbow };
  if (joint === 'ANKLE' && knee && ankle && foot) return { a: knee, b: ankle, c: foot };
  if (joint === 'ELBOW' && shoulder && elbow && wrist) return { a: shoulder, b: elbow, c: wrist };
  return null;
}

function drawAngleBadge(ctx, geometry, { label, color, strong }) {
  const { a, b, c } = geometry;
  if (!a || !b || !c) return;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = strong ? 5 : 3;
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = strong ? 10 : 5;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.lineTo(c.x, c.y);
  ctx.stroke();

  const va = Math.atan2(a.y - b.y, a.x - b.x);
  const vc = Math.atan2(c.y - b.y, c.x - b.x);
  const radius = strong ? 34 : 24;
  ctx.beginPath();
  ctx.arc(b.x, b.y, radius, va, vc, Math.abs(vc - va) > Math.PI);
  ctx.stroke();

  const labelX = b.x + Math.cos((va + vc) / 2) * (radius + 12);
  const labelY = b.y + Math.sin((va + vc) / 2) * (radius + 12);
  const fs = strong ? 22 : 15;
  ctx.font = `800 ${fs}px sans-serif`;
  const w = ctx.measureText(label).width + 18;
  const h = fs + 12;
  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(15,23,42,0.84)';
  roundRect(ctx, labelX - w / 2, labelY - h / 2, w, h, 8);
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, labelX, labelY + 1);
  ctx.restore();
}

function roundRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

// ── 녹화 합성용 HUD: 좌/우 현재 각도를 대형 카드로, 경과시간을 칩으로 베이크. ──
//  · 피사체(중앙)를 가리지 않도록 상단 좌/우 가장자리 배치, 수치는 크게(시인성).
//  · 측정하지 않는 쪽은 강조 해제(라벨만 회색) — 핵심 정보 위주.
function drawRomHud(ctx, landmarks, joint, poseMode, width, height, elapsedSec, side = 'both') {
  const norm = normalizePose(landmarks) || landmarks;
  const L = norm ? jointAngleByMode(norm, joint, 'left', poseMode).angle : null;
  const R = norm ? jointAngleByMode(norm, joint, 'right', poseMode).angle : null;
  // 게이지 주값 = 측정 측(좌/우/양쪽이면 큰 각도). 각도 게이지는 0~180°.
  const primary = side === 'left' ? L : side === 'right' ? R
    : (L != null && R != null ? Math.max(L, R) : (L ?? R));
  drawGaugeHud(ctx, width, height, {
    title: 'ROM',
    recording: true,
    elapsedSec: Number.isFinite(elapsedSec) ? elapsedSec : 0,
    accent: '#38bdf8',
    gauge: { label: '가동범위', value: primary == null ? null : Math.round(primary), unit: '°' },
    stats: [
      { label: '좌측', value: L == null ? null : Math.round(L), unit: '°' },
      { label: '우측', value: R == null ? null : Math.round(R), unit: '°' },
    ],
  });
}

const RECORD_BONES = [
  [11, 12], [11, 23], [12, 24], [23, 24],
  [11, 13], [13, 15], [12, 14], [14, 16],
  [23, 25], [25, 27], [27, 29], [27, 31], [29, 31],
  [24, 26], [26, 28], [28, 30], [28, 32], [30, 32],
];
