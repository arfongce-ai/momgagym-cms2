// ai-measure/menus/RomSensorGoniometer.jsx
// ════════════════════════════════════════════════════════════════════════
//  센서 측정(전자 각도기) — 폰을 관절 부위에 밀착해 기울기로 ROM 측정.
//
//  흐름:
//   1) 센서 활성화(iOS 는 버튼 제스처로 권한 요청) → 측정 화면.
//   2) 시작 자세에서 [0점] → 동작 수행 → 실시간 각도 + 최대 가동각 추적.
//   3) [측정 완료] → 진동(Haptic) + 해당 측(좌/우) 최대각 확정.
//   4) side='both' 면 좌 → 우 순서로 반복 후, 좌우 비대칭 자동 산출.
//
//  측정 정직성:
//   · 0점을 잡기 전에는 각도를 확정하지 않는다(— 표시).
//   · 측정면 이탈(폰 비틀림)이 크면 경고를 띄우고 최대각 갱신을 멈춘다.
//   · 완료 콜백에는 measureType='sensor_goniometer' 와 confidenceScore 를
//     동봉해, 카메라 추정치와 출처가 구분되게 저장한다.
// ════════════════════════════════════════════════════════════════════════
import { useEffect, useRef, useState } from 'react';
import {
  createTiltTracker, requestSensorPermission, isSensorSupported,
  applyZero, isStill, hapticFeedback, roundToStep, meanDeg, createHoldDetector,
  createPeakTracker, median, sensorConfidence,
} from '../core/sensorTilt';
import { getSensorJointTip } from '../core/sensorJointTips';

const OFF_PLANE_WARN = 0.45; // (방향센서 폴백 경로 전용) |gx|/|g| 이 이 비율 이상이면 측정면 이탈 경고
// 중력 센서 경로는 폰 비틀림으로 "예상되는 각도 오차"로 판정한다(각도가 클수록 같은 비틀림도
// 오차가 커지므로 고정 비율보다 정확). 교재 28쪽: 3~4° 이내는 측정 잡음 수준 → 4°부터 경고.
const TILT_ERR_WARN = 4;      // 예상 오차(°) 이상이면 경고(최대각 갱신·자동확정 중단)
const TILT_ERR_CLEAR = 2.5;   // 이 값 미만으로 내려가야 경고 해제(깜빡임 방지 히스테리시스)
const ACC_DEV_MAX = 0.08;     // 0점 때 중력 크기 대비 가속도 편차 비율 — 넘으면 동작 가속으로 각도 신뢰 불가
const PEAK_WINDOW_MS = 300;   // 최대각 = 최근 0.3초 중앙값의 최고치(순간 튐 제거)
const ZERO_SAMPLE_MS = 700;   // 0점 캘리브레이션 표본 수집 시간
const ZERO_MAX_WOBBLE = 2;    // 0점 수집 중 허용 흔들림(최대−최소, °) — 초과 시 재시도 요구
const UI_UPDATE_MS = 90;      // 표시 갱신 최소 간격(스로틀)
const UI_DEADBAND = 0.25;     // 표시 데드밴드(°) — 이하 변화는 갱신 안 함
const DISPLAY_STEP = 0.5;     // 표시 스텝(°)
const SETTLE_AFTER_ZERO_MS = 300; // 0점 직후 최대각 갱신 유예(평활 정착 시간)

// ── [항목 5] 자동 측정(끝범위 유지 감지) 설정 ──
//  끝 자세에서 각도 변화 없이 AUTO_HOLD_MS 유지되면 자동 확정.
//  민감도 낮춤 = AUTO_BAND 를 넓게 잡아 잔떨림으로 타이머가 리셋되지 않게 함.
const AUTO_HOLD_MS = 800;   // 끝범위 유지 시간(0.8초)
const AUTO_BAND = 2.5;      // 유지 허용 변동폭(°) — 넓을수록 민감도 낮음
const AUTO_MIN_DEG = 5;     // 이 각도 미만(≈시작자세)에서는 자동 확정 안 함

// 원형 다이얼(viewBox 200) 치수
const DIAL_R = 84;
const DIAL_C = 2 * Math.PI * DIAL_R;
const DIAL_C_OUT = 2 * Math.PI * (DIAL_R + 8);


export default function RomSensorGoniometer({ jointName, jointKey, onBack, onComplete }) {
  // 좌/우 구분 없이 한 번 측정하고 '측정완료'로 끝낸다(단일 측정).

  // [수기 기록] 어느 움직임을 쟀는지 트레이너가 직접 라벨링(신체 움직임 최대 적용).
  const MOVEMENT_PRESETS = [
    '굴곡 (Flexion)',
    '신전 (Extension)',
    '과신전 (Hyperextension)',
    '외전 (Abduction)',
    '내전 (Adduction)',
    '내회전 (Internal rotation)',
    '외회전 (External rotation)',
    '회내 (Pronation)',
    '회외 (Supination)',
    '배측굴곡 (Dorsiflexion)',
    '족저굴곡 (Plantarflexion)',
    '외번 (Eversion)',
    '내번 (Inversion)',
    '측굴 (Lateral flexion)',
    '회전 (Rotation)',
    '올림 (Elevation)',
    '내림 (Depression)',
    '전인 (Protraction)',
    '후인 (Retraction)',
    '휘돌림 (Circumduction)',
    '요측편위 (Radial deviation)',
    '척측편위 (Ulnar deviation)',
    '대립 (Opposition)',
  ];
  const [movement, setMovement] = useState('');
  const [movementCustom, setMovementCustom] = useState('');
  const effMovement = movement === '__custom' ? movementCustom.trim() : movement;

  // [관절별 부착 안내] 교재 확인된 관절만 데이터가 있다(현재 팔꿈치). 없으면 패널 자체가 안 보인다.
  const jointTip = getSensorJointTip(jointKey);
  const [showTip, setShowTip] = useState(false);

  const [phase, setPhase] = useState('permission'); // permission | measure | record
  const [permErr, setPermErr] = useState('');
  const [zero, setZero] = useState(null);          // 0점(평활 언랩각 기준)
  const [zeroing, setZeroing] = useState(false);   // 0점 표본 수집 중
  const [zeroMsg, setZeroMsg] = useState('');      // 0점 안내/재시도 메시지
  const [liveDeg, setLiveDeg] = useState(null);    // 표시각(0점 반영, 스텝 반올림)
  const [maxDeg, setMaxDeg] = useState(0);         // 최대 |가동각|
  const [tiltWarn, setTiltWarn] = useState(false);   // 폰 비틀림 경고
  const [unstable, setUnstable] = useState(false);    // 동작 가속으로 값이 불안정
  const [qualityInfo, setQualityInfo] = useState(null); // 확정 시점 품질 지표(신뢰도 산출용)
  const [still, setStill] = useState(false);
  const [measuredAngle, setMeasuredAngle] = useState(null); // 확정된 측정각
  const [autoMode, setAutoMode] = useState(true);  // [항목 5] 자동 측정 on/off (기본 on)
  const [holdPct, setHoldPct] = useState(0);       // 자동 확정 진행률(0~1) — 링 표시

  const holdRef = useRef(null);     // 끝범위 유지 감지기
  const autoModeRef = useRef(true); // 콜백 안에서 최신 자동모드 참조
  const autoFinishRef = useRef(null); // 자동 확정 트리거(최신 finishMeasurement 참조)
  // ※ 반드시 autoMode·autoModeRef 선언 '뒤'에 둔다 — 앞에 두면 렌더 즉시 예외로 화면이 안 뜬다.
  useEffect(() => { autoModeRef.current = autoMode; }, [autoMode]);
  const trackerRef = useRef(null);
  const zeroRef = useRef(null);
  const maxRef = useRef(0);
  const recentRef = useRef([]);      // 정지 판정용 최근 표시각
  const lastSmoothedRef = useRef(null); // 최신 평활각(0점 전)
  const lastUiAtRef = useRef(0);     // 표시 스로틀 타임스탬프
  const lastShownRef = useRef(null); // 데드밴드 비교용 직전 표시값
  const peakRef = useRef(null);      // 최대각 추적기(0.3초 창 중앙값)
  if (!peakRef.current) peakRef.current = createPeakTracker({ windowMs: PEAK_WINDOW_MS });
  const plateauRef = useRef(null);   // 자동 확정 시 유지 구간 { angle, spread }
  const accBaseRef = useRef(null);   // 0점 때 측정한 중력 크기(정지 기준)
  const accDevRef = useRef(0);       // 가속도 편차 EMA
  const tiltBadRef = useRef(false);  // 비틀림 경고 상태(히스테리시스)
  const unstableRef = useRef(false);
  const zeroRangeRef = useRef(0);    // 0점 수집 중 흔들림 폭
  const tiltErrAtPeakRef = useRef(0);// 최대각 갱신 시점의 예상 비틀림 오차
  const zeroBufRef = useRef(null);   // 0점 수집 버퍼 { samples: [], t0 }
  const zeroTimerRef = useRef(null); // 0점 수집 안전 타이머
  const zeroDoneAtRef = useRef(0);   // 0점 확정 시각(정착 유예용)

  // 0점 확정: 수집 버퍼 평균. 흔들림이 크면 확정하지 않고 재시도 요구(정직성).
  const finishZeroing = () => {
    if (zeroTimerRef.current) { clearTimeout(zeroTimerRef.current); zeroTimerRef.current = null; }
    const buf = zeroBufRef.current;
    zeroBufRef.current = null;
    setZeroing(false);
    const samples = buf?.samples || [];
    if (samples.length < 5) {
      setZeroMsg('센서 표본이 부족합니다 — 잠시 후 다시 0점을 잡아주세요.');
      return;
    }
    const lo = Math.min(...samples);
    const hi = Math.max(...samples);
    if (hi - lo > ZERO_MAX_WOBBLE) {
      setZeroMsg(`기기가 흔들려 0점을 잡지 못했습니다(±${((hi - lo) / 2).toFixed(1)}°) — 부위에 밀착 고정 후 다시 시도해 주세요.`);
      return;
    }
    const z = meanDeg(samples);
    zeroRangeRef.current = hi - lo;
    // 정지 상태의 중력 크기를 기준으로 삼아 기기별 단위(m/s²·g) 차이를 흡수
    const accs = buf?.acc || [];
    accBaseRef.current = accs.length >= 5 ? median(accs) : null;
    accDevRef.current = 0;
    zeroRef.current = z;
    setZero(z);
    zeroDoneAtRef.current = Date.now();
    maxRef.current = 0;
    setMaxDeg(0);
    recentRef.current = [];
    peakRef.current.reset();
    lastShownRef.current = null;
    if (holdRef.current) holdRef.current.reset(); // 자동 유지 감지 초기화
    setHoldPct(0);
    setZeroMsg('');
    hapticFeedback([30]);
  };

  // 센서 샘플 수신 → 0점 수집 / 표시각(스로틀·데드밴드) / 최대각(창 중앙값) 갱신
  //  최대각·자동확정은 "신뢰 가능한 표본"일 때만 반영한다:
  //   ① 0점 직후 정착 ② 폰 비틀림 예상 오차 < TILT_ERR_WARN ③ 동작 가속 없음(중력만 측정)
  const handleSample = ({ angleDeg, offPlane: off, tiltErrDeg, accMag }) => {
    if (angleDeg == null) { setLiveDeg(null); return; }
    lastSmoothedRef.current = angleDeg;

    // ── 0점 표본 수집 중이면 버퍼에 쌓고 시간이 차면 확정 ──
    const zb = zeroBufRef.current;
    if (zb) {
      zb.samples.push(angleDeg);
      if (accMag != null) zb.acc.push(accMag);
      if (Date.now() - zb.t0 >= ZERO_SAMPLE_MS) finishZeroing();
      return; // 수집 중에는 표시각·최대각 갱신 중단(수집 안내 표시)
    }

    if (zeroRef.current == null) { setLiveDeg(null); return; }
    const now = Date.now();
    const shown = applyZero(angleDeg, zeroRef.current);

    // ── 폰 비틀림: 예상 오차 기반(히스테리시스). 방향센서 폴백은 기존 비율 기준 ──
    const prevBad = tiltBadRef.current;
    const bad = tiltErrDeg != null
      ? (prevBad ? tiltErrDeg >= TILT_ERR_CLEAR : tiltErrDeg >= TILT_ERR_WARN)
      : (off ?? 0) >= OFF_PLANE_WARN;
    if (bad !== prevBad) { tiltBadRef.current = bad; setTiltWarn(bad); }

    // ── 동작 가속: 0점 때 중력 크기 대비 편차(EMA). 가속이 크면 중력 방향 추정이 틀어진다 ──
    const base = accBaseRef.current;
    if (accMag != null && base) {
      accDevRef.current = 0.7 * accDevRef.current + 0.3 * (Math.abs(accMag - base) / base);
    }
    const moving = accDevRef.current > ACC_DEV_MAX;
    if (moving !== unstableRef.current) { unstableRef.current = moving; setUnstable(moving); }

    const settled = now - zeroDoneAtRef.current > SETTLE_AFTER_ZERO_MS;
    const reliable = settled && !bad && !moving;

    // ── 최대각: 최근 PEAK_WINDOW_MS 중앙값의 최고치(순간 스파이크는 창 중앙값이 걸러냄) ──
    if (reliable) {
      const before = peakRef.current.peak();
      const p = peakRef.current.push(shown, now);
      if (p > before) {
        maxRef.current = Math.round(p * 10) / 10;
        tiltErrAtPeakRef.current = tiltErrDeg ?? 0;
        setMaxDeg(maxRef.current);
      }
    } else {
      peakRef.current.push(null, now);
    }

    // ── 자동 측정: 끝범위에서 각도 변화 없이 0.8초 유지 시 확정(확정값 = 유지 구간 중앙값) ──
    //  측정면 이탈·가속 중·정착 전에는 유지 창을 끊는다(끝범위 아닌데 확정되는 것 방지)
    if (autoModeRef.current && holdRef.current) {
      if (reliable) {
        const r = holdRef.current.push(shown, now);
        setHoldPct(r.fired ? 1 : Math.min(0.99, r.heldMs / AUTO_HOLD_MS));
        if (r.fired) {
          plateauRef.current = { angle: r.angle, spread: r.spread };
          autoFinishRef.current?.();
        }
      } else {
        holdRef.current.push(null, now);
        setHoldPct(0);
      }
    }

    // ── 표시각: 스로틀 + 데드밴드 + 0.5° 스텝 (예민한 잔떨림 숫자 제거) ──
    if (now - lastUiAtRef.current < UI_UPDATE_MS) return;
    const stepped = roundToStep(shown, DISPLAY_STEP);
    if (lastShownRef.current != null && Math.abs(shown - lastShownRef.current) < UI_DEADBAND) return;
    lastUiAtRef.current = now;
    lastShownRef.current = shown;
    setLiveDeg(stepped);

    const sbuf = recentRef.current;
    sbuf.push(shown);
    if (sbuf.length > 12) sbuf.shift();
    setStill(isStill(sbuf, { maxRange: 2.0 }));
  };

  // 측정 화면 진입 시 트래커 시작, 이탈 시 정지(+0점 수집 타이머 정리)
  useEffect(() => {
    if (phase !== 'measure') return undefined;
    // 자동 유지 감지기 준비(측정 진입마다 새로) — 민감도 낮춤(AUTO_BAND 넓음)
    holdRef.current = createHoldDetector({ band: AUTO_BAND, holdMs: AUTO_HOLD_MS, minAbsDeg: AUTO_MIN_DEG });
    setHoldPct(0);
    // '다시 측정'으로 돌아온 경우 이전 최대각이 새 측정에 섞이지 않게 비운다(0점은 유지)
    maxRef.current = 0; setMaxDeg(0);
    peakRef.current.reset();
    plateauRef.current = null;
    const tracker = createTiltTracker({ onSample: handleSample });
    trackerRef.current = tracker;
    tracker.start();
    return () => {
      tracker.stop();
      trackerRef.current = null;
      if (zeroTimerRef.current) { clearTimeout(zeroTimerRef.current); zeroTimerRef.current = null; }
      zeroBufRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const activate = async () => {
    setPermErr('');
    if (!isSensorSupported()) {
      setPermErr('이 기기/브라우저는 동작 센서를 지원하지 않습니다. 카메라 분석 또는 사진 각도기를 사용해 주세요.');
      return;
    }
    const res = await requestSensorPermission();
    if (res !== 'granted') {
      setPermErr(res === 'denied'
        ? '센서 권한이 거부되었습니다. 브라우저 설정에서 동작·방향 접근을 허용한 뒤 다시 시도해 주세요.'
        : '이 환경에서는 센서에 접근할 수 없습니다. (HTTPS 접속인지 확인해 주세요)');
      return;
    }
    setPhase('measure');
  };

  // 0점 잡기: 즉시 확정하지 않고 ZERO_SAMPLE_MS 동안 표본을 모아 평균으로 확정.
  // (단일 표본 0점은 손떨림 노이즈가 그대로 박혀 예민해지는 원인이었음)
  const calibrateZero = () => {
    if (zeroing) return;
    if (lastSmoothedRef.current == null) {
      setZeroMsg('센서 신호 수신 대기 중입니다 — 잠시 후 다시 시도해 주세요.');
      return;
    }
    setZeroMsg('');
    setZeroing(true);
    zeroBufRef.current = { samples: [], acc: [], t0: Date.now() };
    // 표본이 끊겨도(폰이 완전 정지 등) 시간이 지나면 확정 시도
    if (zeroTimerRef.current) clearTimeout(zeroTimerRef.current);
    zeroTimerRef.current = setTimeout(() => {
      zeroTimerRef.current = null;
      if (zeroBufRef.current) finishZeroing();
    }, ZERO_SAMPLE_MS + 250);
  };

  const resetSide = () => {
    if (zeroTimerRef.current) { clearTimeout(zeroTimerRef.current); zeroTimerRef.current = null; }
    zeroRef.current = null;
    setZero(null);
    setZeroing(false);
    setZeroMsg('');
    zeroBufRef.current = null;
    setLiveDeg(null);
    maxRef.current = 0;
    setMaxDeg(0);
    recentRef.current = [];
    peakRef.current.reset();
    plateauRef.current = null;
    accDevRef.current = 0;
    tiltBadRef.current = false; setTiltWarn(false);
    unstableRef.current = false; setUnstable(false);
    lastShownRef.current = null;
    if (holdRef.current) holdRef.current.reset();
    setHoldPct(0);
  };

  // 측정완료(촬영완료) → 진동 알림 → '움직임 기록' 단계로.
  //  auto=true 면 자동 측정(끝범위 유지)으로 확정된 경우 — 진동 패턴을 다르게 준다.
  //  자동: 유지 구간의 중앙값(plateauRef) / 수동: 신뢰 구간에서 얻은 최대각(창 중앙값 최고치).
  const finishMeasurement = (auto = false) => {
    const pl = auto ? plateauRef.current : null;
    if (zero == null || (!pl && maxRef.current <= 0)) return;
    const value = pl ? Math.round(Math.abs(pl.angle) * 10) / 10 : maxRef.current;
    hapticFeedback(auto ? [40, 30, 40, 30, 60] : [60, 40, 60]);
    setMeasuredAngle(value);
    const tiltErr = tiltErrAtPeakRef.current || 0;
    const spread = pl ? pl.spread : 0;
    setQualityInfo({
      confidence: sensorConfidence({ zeroRange: zeroRangeRef.current, spread, tiltErr, manual: !pl, zeroMax: ZERO_MAX_WOBBLE }),
      zeroRange: Math.round(zeroRangeRef.current * 10) / 10,
      holdSpread: pl ? Math.round(spread * 10) / 10 : null,
      tiltErrDeg: Math.round(tiltErr * 10) / 10,
      method: pl ? 'hold_median' : 'peak_window_median',
    });
    // 측정완료 후 '움직임 기록' 화면으로 (자동저장은 확인 버튼에서)
    setPhase('record');
  };
  // 최신 finishMeasurement 를 콜백에서 부를 수 있게 ref 에 보관(자동 확정용).
  useEffect(() => { autoFinishRef.current = () => finishMeasurement(true); });

  // 움직임 기록 확인 → 자동 저장(onComplete). 저장되면 상위(RomMeasure)가
  // ROM 결과 리포트로 전환되어 기록을 바로 확인할 수 있다.
  const confirmAndSave = () => {
    hapticFeedback([40]);
    const rec = { angle: measuredAngle, recordedAt: new Date().toISOString() };
    onComplete?.({ single: rec }, { movement: effMovement, jointKey, jointName, quality: qualityInfo });
  };

  // ════════════════ 움직임 기록 화면 (측정완료 후) ════════════════
  if (phase === 'record') {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <button onClick={() => setPhase('measure')} className="measure-back">← 다시 측정</button>
          <h2 className="measure-title">움직임 기록</h2>
          <span className="w-12" />
        </div>

        {/* 측정 결과 요약 */}
        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-center">
          <p className="text-[11px] font-bold uppercase tracking-widest text-emerald-700 dark:text-emerald-300/80">측정완료 · 최대 가동각</p>
          <div className="mt-1 flex items-center justify-center">
            <div><p className="text-[11px] text-slate-500 dark:text-slate-400">가동각</p><p className="text-4xl font-black tabular-nums text-emerald-700 dark:text-emerald-200">{measuredAngle != null ? `${measuredAngle}°` : '—'}</p></div>
          </div>
        </div>

        {/* 움직임 라벨 기록 */}
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-2">
          <p className="text-xs font-black text-slate-600 dark:text-slate-300">측정한 움직임을 기록하세요</p>
          <select value={movement} onChange={(e) => setMovement(e.target.value)}
            className="w-full rounded-lg border border-slate-400 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2.5 text-sm font-bold text-slate-800 dark:text-slate-100">
            <option value="">움직임 선택</option>
            {MOVEMENT_PRESETS.map((m) => <option key={m} value={m}>{m}</option>)}
            <option value="__custom">직접 입력…</option>
          </select>
          {movement === '__custom' && (
            <input type="text" value={movementCustom} onChange={(e) => setMovementCustom(e.target.value)}
              placeholder="예: 어깨 굴곡, 발목 외번, 목 좌측 회전"
              className="w-full rounded-lg border border-slate-400 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2.5 text-sm text-slate-800 dark:text-slate-100" />
          )}
          <p className="text-[11px] text-slate-500">움직임을 적어두면 같은 동작끼리 회차별로 비교됩니다. (선택 사항)</p>
        </div>

        {/* [항목 3] 확인 → 자동 저장 */}
        <button onClick={confirmAndSave}
          className="w-full rounded-xl bg-amber-500 px-4 py-4 text-base font-black text-slate-950 active:scale-[0.99]">
          확인 · 저장
        </button>
      </div>
    );
  }

  // ════════════════ 권한/안내 화면 ════════════════
  if (phase === 'permission') {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <button onClick={onBack} className="measure-back">← 뒤로</button>
          <h2 className="measure-title">고니오메타</h2>
          <span className="w-12" />
        </div>
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-3">
          <p className="text-sm font-bold text-slate-700 dark:text-slate-200">폰을 관절 부위에 밀착해 기울기로 측정합니다</p>

          <ol className="space-y-1.5 text-[12px] leading-relaxed text-slate-500 dark:text-slate-400 list-decimal list-inside">
            <li>화면이 바깥을 향하게 폰을 측정 부위(팔·다리)에 평평하게 밀착합니다.</li>
            <li>시작 자세에서 <span className="font-black text-amber-700 dark:text-amber-300">0점</span>을 누르고 0.7초간 그대로 유지하면 평균값으로 0점이 잡힙니다.</li>
            <li>끝범위에서 각도 변화 없이 <span className="font-black text-amber-700 dark:text-amber-300">0.8초 유지</span>하면 <span className="font-black text-amber-700 dark:text-amber-300">자동 측정</span>됩니다. (수동 완료도 가능)</li>
          </ol>

          {jointTip && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 space-y-2">
              <p className="text-[11px] font-black text-amber-800 dark:text-amber-200">📎 {jointName || jointKey} 측정 안내 ({jointTip.source})</p>
              {jointTip.blocks.map((b) => (
                <div key={b.title} className="space-y-0.5">
                  <p className="text-[11px] font-black text-slate-700 dark:text-slate-200">· {b.title}</p>
                  <p className="text-[11px] leading-relaxed text-slate-600 dark:text-slate-300">부착: {b.mount}</p>
                  <p className="text-[11px] leading-relaxed text-slate-600 dark:text-slate-300">{b.start}</p>
                  <p className="text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">정상치: {b.norms}</p>
                  {b.note && <p className="text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">※ {b.note}</p>}
                </div>
              ))}
            </div>
          )}

          <button onClick={activate}
            className="w-full rounded-xl bg-amber-500 px-4 py-4 text-base font-black text-slate-950 active:scale-[0.99] transition">
            센서 활성화 후 측정 시작
          </button>
          {permErr && <p className="text-xs text-red-700 dark:text-red-400">{permErr}</p>}
          <p className="text-[11px] leading-relaxed text-slate-500">
            ※ iOS 는 버튼을 누르면 동작·방향 접근 권한 창이 뜹니다. 센서 기울기는 하드웨어
            측정값이라 정확하지만, 폰이 부위에서 미끄러지거나 비틀리면 오차가 생깁니다.
          </p>
        </div>
      </div>
    );
  }

  // ════════════════ 측정 화면 ════════════════
  const offPlaneWarn = tiltWarn;
  const dialArc = liveDeg == null ? 0 : (Math.min(360, Math.abs(liveDeg)) / 360) * DIAL_C;
  const canFinish = zero != null && maxDeg > 0;
  const dialHint = zeroing ? '0점 측정 중 — 그대로 유지'
    : zero == null ? '눌러서 0점 잡기'
    : canFinish ? '눌러서 측정완료' : '동작을 시작하세요';
  const onDialTap = () => {
    if (zeroing) return;
    if (zero == null) calibrateZero();
    else if (canFinish) finishMeasurement(false);
  };
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="measure-back">← 뒤로</button>
        <h2 className="measure-title">고니오메타 · {jointName || '측정'}</h2>
        {jointTip ? (
          <button type="button" onClick={() => setShowTip((v) => !v)}
            className="w-12 text-right text-xs font-black text-amber-700 dark:text-amber-300">ℹ 안내</button>
        ) : <span className="w-12" />}
      </div>

      {jointTip && showTip && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 space-y-2">
          {jointTip.blocks.map((b) => (
            <div key={b.title} className="space-y-0.5">
              <p className="text-[11px] font-black text-slate-700 dark:text-slate-200">· {b.title}</p>
              <p className="text-[11px] leading-relaxed text-slate-600 dark:text-slate-300">부착: {b.mount}</p>
              <p className="text-[11px] leading-relaxed text-slate-600 dark:text-slate-300">{b.start}</p>
              <p className="text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">정상치: {b.norms}</p>
              {b.note && <p className="text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">※ {b.note}</p>}
            </div>
          ))}
        </div>
      )}

      {/* [항목 5] 자동/수동 측정 토글 */}
      <div className="flex items-center justify-between rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-2">
        <div>
          <p className="text-xs font-black text-slate-700 dark:text-slate-200">자동 측정</p>
          <p className="text-[10px] text-slate-500">끝범위에서 각도 변화 없이 0.8초 유지하면 자동 확정</p>
        </div>
        <button type="button" onClick={() => setAutoMode((v) => !v)}
          aria-pressed={autoMode}
          className={`relative h-7 w-12 shrink-0 rounded-full border transition-colors ${
            autoMode ? 'border-emerald-400/60 bg-emerald-500/30' : 'border-slate-400 dark:border-slate-600 bg-slate-200 dark:bg-slate-700'
          }`}>
          <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${autoMode ? 'left-6' : 'left-0.5'}`} />
        </button>
      </div>

      {/* 실시간 각도 — 원형 다이얼. 다이얼 자체가 큰 버튼:
          0점 전에는 누르면 0점, 0점 후에는 누르면 측정완료(폰을 몸에 댄 채 한 손 조작). */}
      <div className="flex flex-col items-center">
        <button type="button" onClick={onDialTap} disabled={zeroing}
          aria-label={dialHint}
          className="relative block w-full max-w-[19rem] aspect-square rounded-full active:scale-[0.98] transition-transform">
          <svg viewBox="0 0 200 200" className="absolute inset-0 h-full w-full -rotate-90">
            <circle cx="100" cy="100" r={DIAL_R + 8} fill="#0f172a" />
            {/* 눈금 바탕 링 */}
            <circle cx="100" cy="100" r={DIAL_R} fill="none" stroke="#334155" strokeWidth="7" />
            {/* 현재 각도만큼 차오르는 링(360° = 한 바퀴) */}
            <circle cx="100" cy="100" r={DIAL_R} fill="none"
              stroke={offPlaneWarn ? '#f87171' : '#fbbf24'} strokeWidth="7" strokeLinecap="round"
              strokeDasharray={`${dialArc} ${DIAL_C}`} />
            {/* 자동 확정 진행 링 — 끝범위 유지 시간이 차오른다 */}
            {autoMode && zero != null && !offPlaneWarn && holdPct > 0 && (
              <circle cx="100" cy="100" r={DIAL_R + 8} fill="none" stroke="#34d399" strokeWidth="4" strokeLinecap="round"
                strokeDasharray={`${holdPct * DIAL_C_OUT} ${DIAL_C_OUT}`} />
            )}
          </svg>
          <span className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">현재 각도</span>
            <span className={`font-black tabular-nums leading-none ${offPlaneWarn ? 'text-red-300' : 'text-amber-300'}`} style={{ fontSize: '4.25rem' }}>
              {zeroing ? '···' : liveDeg == null ? '—' : `${liveDeg}°`}
            </span>
            <span className="mt-1 text-xs text-slate-400">최대 <b className="text-emerald-300 tabular-nums">{maxDeg > 0 ? `${maxDeg}°` : '—'}</b></span>
            <span className="mt-2 rounded-full bg-white/10 px-3 py-1 text-[11px] font-black text-white">{dialHint}</span>
          </span>
        </button>

        <p className="mt-2 min-h-[1rem] text-center text-[11px] font-bold text-emerald-700 dark:text-emerald-300">
          {zero == null ? '' : !autoMode ? (still ? '멈춤 감지' : '')
            : holdPct >= 1 ? '자동 확정!' : holdPct > 0 ? '끝범위 유지 중… 그대로 멈춰주세요' : '끝 자세에서 잠시 멈추면 자동 측정됩니다'}
        </p>

        {offPlaneWarn && (
          <p className="mt-1 text-center text-xs font-bold text-red-700 dark:text-red-300">
            ⚠ 폰이 측정면에서 비틀려 각도가 틀리게 나올 수 있습니다 — 부위에 평평하게 다시 밀착해 주세요 (이 동안 최대각은 갱신되지 않음)
          </p>
        )}
        {!offPlaneWarn && zero != null && unstable && (
          <p className="mt-1 text-center text-xs font-bold text-amber-700 dark:text-amber-300">
            움직임이 빨라 값이 불안정합니다 — 천천히 움직이고 끝 자세에서 잠시 멈춰 주세요
          </p>
        )}
      </div>

      {/* 조작 버튼 */}
      <div className="grid grid-cols-2 gap-2">
        <button onClick={calibrateZero} disabled={zeroing}
          className="rounded-xl border border-sky-500/50 bg-sky-500/15 px-4 py-3.5 text-sm font-black text-sky-800 dark:text-sky-200 active:scale-[0.99] disabled:opacity-60">
          {zeroing ? '0점 측정 중…' : zero == null ? '0점 잡기 (자세 유지 0.7초)' : '0점 다시 잡기'}
        </button>
        <button onClick={resetSide}
          className="rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 px-4 py-3.5 text-sm font-black text-slate-600 dark:text-slate-300 active:scale-[0.99]">
          다시 측정
        </button>
      </div>
      {zeroMsg && <p className="text-xs font-bold text-amber-700 dark:text-amber-300">{zeroMsg}</p>}
      <button onClick={() => finishMeasurement(false)} disabled={zero == null || maxDeg <= 0}
        className="w-full rounded-xl bg-amber-500 px-4 py-4 text-base font-black text-slate-950 disabled:bg-slate-200 dark:disabled:bg-slate-700 disabled:text-slate-500 dark:disabled:text-slate-400 active:scale-[0.99]">
        {autoMode ? '지금 바로 측정완료 (수동)' : '촬영완료'}
      </button>

      <p className="text-[11px] leading-relaxed text-slate-500">
        ※ 0점(시작 자세) 대비 최대 이동 각도를 가동범위로 기록합니다. 기기(iOS/Android) 간
        센서 부호 차이는 0점 보정으로 자동 상쇄됩니다.
      </p>
    </div>
  );
}
