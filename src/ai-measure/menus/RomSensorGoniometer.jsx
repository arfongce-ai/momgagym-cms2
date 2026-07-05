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
  applyZero, isStill, hapticFeedback, roundToStep, meanDeg,
} from '../core/sensorTilt';

const OFF_PLANE_WARN = 0.45; // |gx|/|g| 이 비율 이상이면 측정면 이탈 경고
const ZERO_SAMPLE_MS = 700;   // 0점 캘리브레이션 표본 수집 시간
const ZERO_MAX_WOBBLE = 5;    // 0점 수집 중 허용 흔들림(°) — 초과 시 재시도 요구
const UI_UPDATE_MS = 90;      // 표시 갱신 최소 간격(스로틀)
const UI_DEADBAND = 0.25;     // 표시 데드밴드(°) — 이하 변화는 갱신 안 함
const DISPLAY_STEP = 0.5;     // 표시 스텝(°)
const SETTLE_AFTER_ZERO_MS = 300; // 0점 직후 최대각 갱신 유예(평활 정착 시간)


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

  const [phase, setPhase] = useState('permission'); // permission | measure | record
  const [permErr, setPermErr] = useState('');
  const [zero, setZero] = useState(null);          // 0점(평활 언랩각 기준)
  const [zeroing, setZeroing] = useState(false);   // 0점 표본 수집 중
  const [zeroMsg, setZeroMsg] = useState('');      // 0점 안내/재시도 메시지
  const [liveDeg, setLiveDeg] = useState(null);    // 표시각(0점 반영, 스텝 반올림)
  const [maxDeg, setMaxDeg] = useState(0);         // 최대 |가동각|
  const [offPlane, setOffPlane] = useState(0);
  const [still, setStill] = useState(false);
  const [measuredAngle, setMeasuredAngle] = useState(null); // 확정된 측정각

  const trackerRef = useRef(null);
  const zeroRef = useRef(null);
  const maxRef = useRef(0);
  const recentRef = useRef([]);      // 정지 판정용 최근 표시각
  const lastSmoothedRef = useRef(null); // 최신 평활각(0점 전)
  const lastUiAtRef = useRef(0);     // 표시 스로틀 타임스탬프
  const lastShownRef = useRef(null); // 데드밴드 비교용 직전 표시값
  const recent3Ref = useRef([]);     // 최대각 스파이크 방지용 최근 3표본
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
    zeroRef.current = z;
    setZero(z);
    zeroDoneAtRef.current = Date.now();
    maxRef.current = 0;
    setMaxDeg(0);
    recentRef.current = [];
    recent3Ref.current = [];
    lastShownRef.current = null;
    setZeroMsg('');
    hapticFeedback([30]);
  };

  // 센서 샘플 수신 → 0점 수집 / 표시각(스로틀·데드밴드) / 최대각(중앙값) 갱신
  const handleSample = ({ angleDeg, offPlane: off }) => {
    setOffPlane(off ?? 0);
    if (angleDeg == null) { setLiveDeg(null); return; }
    lastSmoothedRef.current = angleDeg;

    // ── 0점 표본 수집 중이면 버퍼에 쌓고 시간이 차면 확정 ──
    const zb = zeroBufRef.current;
    if (zb) {
      zb.samples.push(angleDeg);
      if (Date.now() - zb.t0 >= ZERO_SAMPLE_MS) finishZeroing();
      return; // 수집 중에는 표시각·최대각 갱신 중단(수집 안내 표시)
    }

    if (zeroRef.current == null) { setLiveDeg(null); return; }
    const shown = applyZero(angleDeg, zeroRef.current);

    // ── 최대각: 최근 3표본 중앙값으로 순간 스파이크 제거, 0점 직후 유예 ──
    const buf3 = recent3Ref.current;
    buf3.push(shown);
    if (buf3.length > 3) buf3.shift();
    const med3 = [...buf3].sort((a, b) => a - b)[Math.floor(buf3.length / 2)];
    const settled = Date.now() - zeroDoneAtRef.current > SETTLE_AFTER_ZERO_MS;
    if (settled && (off ?? 0) < OFF_PLANE_WARN && buf3.length === 3 && Math.abs(med3) > maxRef.current) {
      maxRef.current = Math.round(Math.abs(med3) * 10) / 10;
      setMaxDeg(maxRef.current);
    }

    // ── 표시각: 스로틀 + 데드밴드 + 0.5° 스텝 (예민한 잔떨림 숫자 제거) ──
    const now = Date.now();
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
    zeroBufRef.current = { samples: [], t0: Date.now() };
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
    recent3Ref.current = [];
    lastShownRef.current = null;
  };

  // 측정완료(촬영완료) → 진동 알림 → '움직임 기록' 단계로
  const finishMeasurement = () => {
    if (zero == null || maxRef.current <= 0) return;
    hapticFeedback([60, 40, 60]);
    setMeasuredAngle(maxRef.current);
    // 측정완료 후 '움직임 기록' 화면으로 (자동저장은 확인 버튼에서)
    setPhase('record');
  };

  // 움직임 기록 확인 → 자동 저장(onComplete). 저장되면 상위(RomMeasure)가
  // ROM 결과 리포트로 전환되어 기록을 바로 확인할 수 있다.
  const confirmAndSave = () => {
    hapticFeedback([40]);
    const rec = { angle: measuredAngle, recordedAt: new Date().toISOString() };
    onComplete?.({ single: rec }, { movement: effMovement, jointKey, jointName });
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
          <p className="text-[11px] font-bold uppercase tracking-widest text-emerald-300/80">측정완료 · 최대 가동각</p>
          <div className="mt-1 flex items-center justify-center">
            <div><p className="text-[11px] text-slate-400">가동각</p><p className="text-4xl font-black tabular-nums text-emerald-200">{measuredAngle != null ? `${measuredAngle}°` : '—'}</p></div>
          </div>
        </div>

        {/* 움직임 라벨 기록 */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4 space-y-2">
          <p className="text-xs font-black text-slate-300">측정한 움직임을 기록하세요</p>
          <select value={movement} onChange={(e) => setMovement(e.target.value)}
            className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2.5 text-sm font-bold text-slate-100">
            <option value="">움직임 선택</option>
            {MOVEMENT_PRESETS.map((m) => <option key={m} value={m}>{m}</option>)}
            <option value="__custom">직접 입력…</option>
          </select>
          {movement === '__custom' && (
            <input type="text" value={movementCustom} onChange={(e) => setMovementCustom(e.target.value)}
              placeholder="예: 어깨 굴곡, 발목 외번, 목 좌측 회전"
              className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2.5 text-sm text-slate-100" />
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
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4 space-y-3">
          <p className="text-sm font-bold text-slate-200">폰을 관절 부위에 밀착해 기울기로 측정합니다</p>

          <ol className="space-y-1.5 text-[12px] leading-relaxed text-slate-400 list-decimal list-inside">
            <li>화면이 바깥을 향하게 폰을 측정 부위(팔·다리)에 평평하게 밀착합니다.</li>
            <li>시작 자세에서 <span className="font-black text-amber-300">0점</span>을 누르고 0.7초간 그대로 유지하면 평균값으로 0점이 잡힙니다.</li>
            <li>최대 가동각이 자동 기록되며, <span className="font-black text-amber-300">측정 완료</span> 시 진동으로 알립니다.</li>
          </ol>
          <button onClick={activate}
            className="w-full rounded-xl bg-amber-500 px-4 py-4 text-base font-black text-slate-950 active:scale-[0.99] transition">
            센서 활성화 후 측정 시작
          </button>
          {permErr && <p className="text-xs text-red-400">{permErr}</p>}
          <p className="text-[11px] leading-relaxed text-slate-500">
            ※ iOS 는 버튼을 누르면 동작·방향 접근 권한 창이 뜹니다. 센서 기울기는 하드웨어
            측정값이라 정확하지만, 폰이 부위에서 미끄러지거나 비틀리면 오차가 생깁니다.
          </p>
        </div>
      </div>
    );
  }

  // ════════════════ 측정 화면 ════════════════
  const offPlaneWarn = offPlane >= OFF_PLANE_WARN;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="measure-back">← 뒤로</button>
        <h2 className="measure-title">고니오메타 · {jointName || '측정'}</h2>
        <span className="w-12" />
      </div>

      {/* 실시간 각도 — 크게 표시 */}
      <div className={`rounded-2xl border p-5 text-center ${
        offPlaneWarn ? 'border-red-500/40 bg-red-500/10' : 'border-amber-500/30 bg-slate-900'
      }`}>
        <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400">
          현재 각도 {zeroing ? '(0점 측정 중 — 그대로 유지)' : zero == null ? '(0점을 먼저 잡아주세요)' : ''}
        </p>
        <p className="mt-1 font-black tabular-nums text-amber-300" style={{ fontSize: '4.5rem', lineHeight: 1.1 }}>
          {zeroing ? '···' : liveDeg == null ? '—' : `${liveDeg}°`}
        </p>
        <div className="mt-2 flex items-center justify-center gap-4 text-sm">
          <span className="text-slate-400">최대 가동각 <b className="text-emerald-300 tabular-nums">{maxDeg > 0 ? `${maxDeg}°` : '—'}</b></span>
          {still && zero != null && <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[11px] font-bold text-emerald-300">멈춤 감지</span>}
        </div>
        {offPlaneWarn && (
          <p className="mt-2 text-xs font-bold text-red-300">
            ⚠ 폰이 측정면에서 비틀렸습니다 — 부위에 평평하게 다시 밀착해 주세요 (이 동안 최대각은 갱신되지 않음)
          </p>
        )}
      </div>

      {/* 조작 버튼 */}
      <div className="grid grid-cols-2 gap-2">
        <button onClick={calibrateZero} disabled={zeroing}
          className="rounded-xl border border-sky-500/50 bg-sky-500/15 px-4 py-3.5 text-sm font-black text-sky-200 active:scale-[0.99] disabled:opacity-60">
          {zeroing ? '0점 측정 중…' : zero == null ? '0점 잡기 (자세 유지 0.7초)' : '0점 다시 잡기'}
        </button>
        <button onClick={resetSide}
          className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-3.5 text-sm font-black text-slate-300 active:scale-[0.99]">
          다시 측정
        </button>
      </div>
      {zeroMsg && <p className="text-xs font-bold text-amber-300">{zeroMsg}</p>}
      <button onClick={finishMeasurement} disabled={zero == null || maxDeg <= 0}
        className="w-full rounded-xl bg-amber-500 px-4 py-4 text-base font-black text-slate-950 disabled:bg-slate-700 disabled:text-slate-400 active:scale-[0.99]">
        촬영완료
      </button>

      <p className="text-[11px] leading-relaxed text-slate-500">
        ※ 0점(시작 자세) 대비 최대 이동 각도를 가동범위로 기록합니다. 기기(iOS/Android) 간
        센서 부호 차이는 0점 보정으로 자동 상쇄됩니다.
      </p>
    </div>
  );
}
