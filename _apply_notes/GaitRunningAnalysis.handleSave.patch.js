// ════════════════════════════════════════════════════════════════════════
//  [요구사항 2] GaitRunningAnalysis.jsx 수정 — 데이터 파이프라인만 변경
//  ⚠ 화면 UI / 렌더링 / JSX 는 한 줄도 건드리지 않습니다.
//  아래 4곳만 정확히 바꾸면 됩니다. (handleSave 자체는 이미 reportData 를
//  그대로 서버에 넘기므로, reportData 페이로드에 고급지표를 넣는 것이 핵심)
// ════════════════════════════════════════════════════════════════════════


// ── (1) import 에 BiomechAccumulator 추가 ──────────────────────────────
//
// 기존:
//   import {
//     GaitCycleTracker, jointAnglesFromPose, AngleAccumulator,
//     pelvisRelativeFeet, cameraAngleQuality, detectOrientation
//   } from '../core/gaitBiomechanics';
//
// 변경 (BiomechAccumulator 한 개만 추가):
   import {
     GaitCycleTracker, jointAnglesFromPose, AngleAccumulator,
     pelvisRelativeFeet, cameraAngleQuality, detectOrientation,
     BiomechAccumulator
   } from '../core/gaitBiomechanics';


// ── (2) 누적기 인스턴스 ref 추가 ───────────────────────────────────────
//
// 기존:
//   const trackerRef = useRef(new GaitCycleTracker());
//   const angleAccRef = useRef(new AngleAccumulator());
//
// 변경 (한 줄 추가):
   const trackerRef = useRef(new GaitCycleTracker());
   const angleAccRef = useRef(new AngleAccumulator());
   const biomechAccRef = useRef(new BiomechAccumulator());


// ── (3) 녹화 루프에서 프레임 누적 한 줄 추가 ───────────────────────────
//   startVisionPipeline 내부, recording 분기:
//
// 기존:
//   if (viewRef.current === 'recording') {
//     trackerRef.current.push(pelvisRelativeFeet(landmarks), ts);
//     angleAccRef.current.push(jointAnglesFromPose(landmarks));
//   } else {
//
// 변경 (raw landmarks 를 그대로 push — 한 줄 추가):
   if (viewRef.current === 'recording') {
     trackerRef.current.push(pelvisRelativeFeet(landmarks), ts);
     angleAccRef.current.push(jointAnglesFromPose(landmarks));
     biomechAccRef.current.push(landmarks);
   } else {


// ── (4) 녹화 시작 시 초기화 + 종료 시 페이로드에 metrics 포함 ──────────
//
//   (4-a) startRecording 안에서 다른 누적기와 함께 리셋:
//
// 기존:
//   trackerRef.current = new GaitCycleTracker();
//   angleAccRef.current = new AngleAccumulator();
//
// 변경:
   trackerRef.current = new GaitCycleTracker();
   angleAccRef.current = new AngleAccumulator();
   biomechAccRef.current = new BiomechAccumulator();


//   (4-b) onstop 콜백에서 summary 추출 + setReportData 페이로드 확장.
//         기존 reportData 필드(cadence/stancePct/angles 등)는 100% 유지하고,
//         Firestore gait_reports 의 metrics JSON 객체를 통째로 추가한다.
//
// 기존:
//   const cycleSummary = trackerRef.current.summary();
//   const angleSummary = angleAccRef.current.summary();
//
//   setReportData({
//     cadence: cycleSummary.averageCadenceSpm,
//     stancePct: cycleSummary.stancePct,
//     swingPct: cycleSummary.swingPct,
//     totalSteps: cycleSummary.totalSteps,
//     valid: cycleSummary.valid,
//     signalAmp: cycleSummary.signalAmp,
//     angles: angleSummary,
//     aspect: aspectRef.current,
//     member: { id: member?.id || null, name: member?.name || null },
//     measuredAt: new Date().toISOString(),
//   });
//
// 변경 (biomech summary 추가 + metrics 객체 구성):
   const cycleSummary = trackerRef.current.summary();
   const angleSummary = angleAccRef.current.summary();
   const biomech = biomechAccRef.current.summary();

   // Firestore gait_reports 에 그대로 저장될 정량 지표 묶음.
   // 대시보드(GaitReportDashboard)는 report.metrics 만 보면 전부 그릴 수 있다.
   const metrics = {
     // ── 요약(상단) ──
     cadence: cycleSummary.averageCadenceSpm,   // SPM
     stancePct: cycleSummary.stancePct,
     swingPct: cycleSummary.swingPct,
     totalSteps: cycleSummary.totalSteps,
     signalAmp: cycleSummary.signalAmp,
     valid: cycleSummary.valid,

     // ── Kinematic ──
     angles: angleSummary,                      // { hip:{avg,rom}, knee, ankle } (좌측 기준, 기존)
     trunkLean: biomech.trunkLean,              // { avg, max, min } 몸통 전방 기울기(도)
     kneeFlexion: biomech.kneeFlexion,          // { left, right, leftMaxFlex, rightMaxFlex, leftStrike, rightStrike }

     // ── Symmetry ──
     pelvicDrop: biomech.pelvicDrop,            // { avg, max, min } (% 신장 대비)
     pelvicDropAbs: biomech.pelvicDropAbs,      // 좌우 진폭(비대칭 크기)
     verticalOscillation: biomech.verticalOscillation, // 수직 진폭 비율(%)
     kneeSymmetry: biomech.kneeSymmetry,        // 좌우 무릎 대칭(%)

     // ── Spatial ──
     strideToHeight: biomech.strideToHeight,    // 보폭/신장 비율
   };

   setReportData({
     // ── 기존 필드(미리보기 화면이 그대로 읽음) — 절대 제거 금지 ──
     cadence: cycleSummary.averageCadenceSpm,
     stancePct: cycleSummary.stancePct,
     swingPct: cycleSummary.swingPct,
     totalSteps: cycleSummary.totalSteps,
     valid: cycleSummary.valid,
     signalAmp: cycleSummary.signalAmp,
     angles: angleSummary,
     aspect: aspectRef.current,
     member: { id: member?.id || null, name: member?.name || null },
     measuredAt: new Date().toISOString(),

     // ── 신규: 고급 지표 일체 (Firestore gait_reports.metrics 로 저장) ──
     metrics,
   });
