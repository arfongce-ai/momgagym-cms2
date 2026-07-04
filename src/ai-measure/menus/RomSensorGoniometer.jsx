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
  applyZero, isStill, hapticFeedback,
} from '../core/sensorTilt';

const OFF_PLANE_WARN = 0.45; // |gx|/|g| 이 비율 이상이면 측정면 이탈 경고

const SIDE_KO = { left: '좌측', right: '우측' };

export default function RomSensorGoniometer({ jointName, side = 'both', onBack, onComplete }) {
  // 진행할 측 순서: both → 좌, 우 / 단측 → 해당 측만
  const sidesToMeasure = side === 'both' ? ['left', 'right'] : [side];

  const [phase, setPhase] = useState('permission'); // permission | measure | done
  const [permErr, setPermErr] = useState('');
  const [sideIdx, setSideIdx] = useState(0);
  const [zero, setZero] = useState(null);          // 0점(언랩각 기준)
  const [liveDeg, setLiveDeg] = useState(null);    // 표시각(0점 반영)
  const [maxDeg, setMaxDeg] = useState(0);         // 이번 측 최대 |가동각|
  const [offPlane, setOffPlane] = useState(0);
  const [still, setStill] = useState(false);
  const [results, setResults] = useState({});      // { left: {...}, right: {...} }

  const trackerRef = useRef(null);
  const zeroRef = useRef(null);
  const maxRef = useRef(0);
  const recentRef = useRef([]); // 정지 판정용 최근 표시각

  const currentSide = sidesToMeasure[sideIdx];

  // 센서 샘플 수신 → 0점 반영 표시각, 최대각, 정지 판정 갱신
  const handleSample = ({ angleDeg, offPlane: off }) => {
    setOffPlane(off ?? 0);
    if (angleDeg == null) { setLiveDeg(null); return; }
    const shown = zeroRef.current == null ? null : applyZero(angleDeg, zeroRef.current);
    // 0점 전에는 각을 확정하지 않되, 0점 버튼이 참조할 원시각은 ref 로 보관
    lastRawRef.current = angleDeg;
    if (shown == null) { setLiveDeg(null); return; }
    const rounded = Math.round(shown * 10) / 10;
    setLiveDeg(rounded);
    // 측정면 이탈 중에는 최대각을 갱신하지 않는다(오염 방지 — 측정 정직성)
    if ((off ?? 0) < OFF_PLANE_WARN && Math.abs(rounded) > maxRef.current) {
      maxRef.current = Math.round(Math.abs(rounded) * 10) / 10;
      setMaxDeg(maxRef.current);
    }
    const buf = recentRef.current;
    buf.push(rounded);
    if (buf.length > 12) buf.shift();
    setStill(isStill(buf));
  };
  const lastRawRef = useRef(null);

  // 측정 화면 진입 시 트래커 시작, 이탈 시 정지
  useEffect(() => {
    if (phase !== 'measure') return undefined;
    const tracker = createTiltTracker({ onSample: handleSample });
    trackerRef.current = tracker;
    tracker.start();
    return () => { tracker.stop(); trackerRef.current = null; };
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

  const calibrateZero = () => {
    if (lastRawRef.current == null) return;
    zeroRef.current = lastRawRef.current;
    setZero(lastRawRef.current);
    maxRef.current = 0;
    setMaxDeg(0);
    recentRef.current = [];
    hapticFeedback([30]);
  };

  const resetSide = () => {
    zeroRef.current = null;
    setZero(null);
    setLiveDeg(null);
    maxRef.current = 0;
    setMaxDeg(0);
    recentRef.current = [];
  };

  // 현재 측 확정 → 진동 알림 → 다음 측 또는 완료
  const captureSide = () => {
    if (zero == null || maxRef.current <= 0) return;
    hapticFeedback([60, 40, 60]);
    const rec = {
      side: currentSide,
      angle: maxRef.current,
      recordedAt: new Date().toISOString(),
    };
    const nextResults = { ...results, [currentSide]: rec };
    setResults(nextResults);
    if (sideIdx + 1 < sidesToMeasure.length) {
      setSideIdx(sideIdx + 1);
      resetSide();
      return;
    }
    setPhase('done');
    onComplete?.(nextResults);
  };

  // ════════════════ 권한/안내 화면 ════════════════
  if (phase === 'permission') {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <button onClick={onBack} className="measure-back">← 뒤로</button>
          <h2 className="measure-title">센서 측정 (전자 각도기)</h2>
          <span className="w-12" />
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4 space-y-3">
          <p className="text-sm font-bold text-slate-200">폰을 관절 부위에 밀착해 기울기로 측정합니다</p>
          <ol className="space-y-1.5 text-[12px] leading-relaxed text-slate-400 list-decimal list-inside">
            <li>화면이 바깥을 향하게 폰을 측정 부위(팔·다리)에 평평하게 밀착합니다.</li>
            <li>시작 자세에서 <span className="font-black text-amber-300">0점</span>을 누른 뒤, 동작을 끝까지 수행합니다.</li>
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
        <h2 className="measure-title">센서 측정 · {jointName || '관절'}</h2>
        <span className="w-12" />
      </div>

      {/* 측 진행 표시 */}
      <div className="flex justify-center gap-2">
        {sidesToMeasure.map((s, i) => (
          <span key={s} className={`rounded-full px-3 py-1 text-[11px] font-black border ${
            results[s] ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
            : i === sideIdx ? 'bg-amber-500/20 border-amber-500/50 text-amber-300'
            : 'border-slate-700 text-slate-500'
          }`}>
            {SIDE_KO[s]} {results[s] ? `✓ ${results[s].angle}°` : i === sideIdx ? '측정 중' : '대기'}
          </span>
        ))}
      </div>

      {/* 실시간 각도 — 크게 표시 */}
      <div className={`rounded-2xl border p-5 text-center ${
        offPlaneWarn ? 'border-red-500/40 bg-red-500/10' : 'border-amber-500/30 bg-slate-900'
      }`}>
        <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400">
          {SIDE_KO[currentSide]} · 현재 각도 {zero == null && '(0점을 먼저 잡아주세요)'}
        </p>
        <p className="mt-1 font-black tabular-nums text-amber-300" style={{ fontSize: '4.5rem', lineHeight: 1.1 }}>
          {liveDeg == null ? '—' : `${liveDeg}°`}
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
        <button onClick={calibrateZero}
          className="rounded-xl border border-sky-500/50 bg-sky-500/15 px-4 py-3.5 text-sm font-black text-sky-200 active:scale-[0.99]">
          {zero == null ? '0점 잡기 (시작 자세)' : '0점 다시 잡기'}
        </button>
        <button onClick={resetSide}
          className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-3.5 text-sm font-black text-slate-300 active:scale-[0.99]">
          이 측 다시 측정
        </button>
      </div>
      <button onClick={captureSide} disabled={zero == null || maxDeg <= 0}
        className="w-full rounded-xl bg-amber-500 px-4 py-4 text-base font-black text-slate-950 disabled:bg-slate-700 disabled:text-slate-400 active:scale-[0.99]">
        {SIDE_KO[currentSide]} 측정 완료 {sideIdx + 1 < sidesToMeasure.length ? '→ 다음 측' : '→ 결과'}
      </button>

      <p className="text-[11px] leading-relaxed text-slate-500">
        ※ 0점(시작 자세) 대비 최대 이동 각도를 가동범위로 기록합니다. 기기(iOS/Android) 간
        센서 부호 차이는 0점 보정으로 자동 상쇄됩니다.
      </p>
    </div>
  );
}
