// ai-measure/menus/VbtMeasure.jsx
// 메뉴 7: VBT (속도 기반 트레이닝) — 바벨 엔드캡(봉 끝) 탭 추적으로 자동 측정.
//  - [재설계] 카메라를 켜면 화면 전체를 덮는 풀스크린 오버레이로 전환.
//  - 화면에서 엔드캡을 한 번 누르면 그 색을 학습해 따라간다.
//  - 측정 시작 → 한 렙 동작 → 종료 시: 수직 이동거리(키 환산 m) ÷ 시간 = 평균속도.
import { useRef, useState, useEffect, useCallback } from 'react';
import { usePoseEngine } from '../core/usePoseEngine';
import { drawGuides } from '../core/cameraGuide';
import { personHeightRatio, romToCm } from '../core/barbell';
import { createMultiTracker } from '../core/endcapTracker';
import { calcVBT, VBT_ZONES } from '../core/performance';
import { totalWeight } from '../core/plates';
import { assessFraming, FRAMING_PRESETS } from '../core/framingGuide';
import PlateWeightInput from './PlateWeightInput';
import FramingIntro from './FramingIntro';
import HeightField from './HeightField';
import CameraStage from './CameraStage';

const ZONE_COLOR = {
  blue:   'text-blue-400',
  green:  'text-emerald-400',
  yellow: 'text-amber-400',
  orange: 'text-orange-400',
  red:    'text-red-400',
};

export default function VbtMeasure({ member, onSave, onBack }) {
  const canvasRef = useRef(null);
  const capRef = useRef(createMultiTracker());
  const phRef = useRef(null);
  const phSamplesRef = useRef([]);
  const frameStatsRef = useRef({ total: 0, lost: 0 });
  const recordingRef = useRef(false);
  const seededRef = useRef(false);
  const framingRef = useRef({ level: 'bad', message: '' });

  const [recording, setRecording] = useState(false);
  const [seeded, setSeeded] = useState(false);
  const [ptCount, setPtCount] = useState(0);
  const [activePts, setActivePts] = useState(0);
  const [result, setResult] = useState(null);
  const [heightCm, setHeightCm] = useState(member?.height || '');
  const [plate, setPlate] = useState({ barKg: 20, sidePlates: [] });
  const [framing, setFraming] = useState({ level: 'bad', message: '카메라 준비 중…' });

  const handleResult = useCallback((lms, ts, video) => {
    const canvas = canvasRef.current;
    if (!canvas || !video) return;
    const cw = canvas.width, ch = canvas.height;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, cw, ch);
    drawGuides(ctx, cw, ch, {});

    const ph = personHeightRatio(lms);
    if (ph) {
      phRef.current = ph;
      if (recordingRef.current) phSamplesRef.current.push(ph);
    }

    const fr = assessFraming(lms, { want: FRAMING_PRESETS.vbt.want });
    if (fr.level !== framingRef.current.level || fr.message !== framingRef.current.message) {
      framingRef.current = fr;
      setFraming({ level: fr.level, message: fr.message });
    }

    const cap = capRef.current;
    if (cap.isSeeded()) {
      const p = cap.update(video);
      if (p && recordingRef.current) cap.push(p, ts);
      const act = cap.activeCount();
      if (act !== activePts) setActivePts(act);
      if (recordingRef.current) {
        frameStatsRef.current.total += 1;
        if (act === 0) frameStatsRef.current.lost += 1;
      }

      const path = cap.path();
      ctx.save();
      ctx.strokeStyle = 'rgba(34,211,238,0.95)';
      ctx.lineWidth = 6;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      path.forEach((q, i) => {
        const X = q.x * cw, Y = q.y * ch;
        i === 0 ? ctx.moveTo(X, Y) : ctx.lineTo(X, Y);
      });
      ctx.stroke();
      cap.points().forEach(pt => {
        if (!pt.ema) return;
        ctx.fillStyle = pt.alive ? 'rgba(16,185,129,0.95)' : 'rgba(148,163,184,0.6)';
        ctx.beginPath(); ctx.arc(pt.ema.x * cw, pt.ema.y * ch, 11, 0, Math.PI * 2); ctx.fill();
        ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,255,255,0.8)';
        ctx.beginPath(); ctx.arc(pt.ema.x * cw, pt.ema.y * ch, 11, 0, Math.PI * 2); ctx.stroke();
      });
      if (p) {
        ctx.fillStyle = '#f59e0b';
        ctx.beginPath(); ctx.arc(p.x * cw, p.y * ch, 16, 0, Math.PI * 2); ctx.fill();
        ctx.lineWidth = 3; ctx.strokeStyle = '#fff';
        ctx.beginPath(); ctx.arc(p.x * cw, p.y * ch, 16, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.restore();
    }
  }, [activePts]);

  const { videoRef, start, stop, status, error } = usePoseEngine({ onResult: handleResult });

  const syncCanvas = useCallback(() => {
    const v = videoRef.current, c = canvasRef.current;
    if (v && c && v.videoWidth) { c.width = v.videoWidth; c.height = v.videoHeight; }
  }, []);

  useEffect(() => {
    const v = videoRef.current;
    if (v) v.addEventListener('loadedmetadata', syncCanvas);
    return () => { if (v) v.removeEventListener('loadedmetadata', syncCanvas); stop(); };
  }, [syncCanvas, stop]);

  const startCam = () => {
    setResult(null);
    seededRef.current = false; setSeeded(false);
    setPtCount(0); setActivePts(0);
    capRef.current.clear();
    start();
  };
  const closeCam = () => { stop(); recordingRef.current = false; setRecording(false); };

  const onTapVideo = (e) => {
    const v = videoRef.current;
    if (!v || !v.videoWidth || status !== 'running') return;
    const rect = e.currentTarget.getBoundingClientRect();
    const clientX = (e.touches?.[0]?.clientX ?? e.clientX) - rect.left;
    const clientY = (e.touches?.[0]?.clientY ?? e.clientY) - rect.top;
    const vAR = v.videoWidth / v.videoHeight;
    const bAR = rect.width / rect.height;
    let drawW = rect.width, drawH = rect.height, offX = 0, offY = 0;
    if (vAR > bAR) { drawH = rect.width / vAR; offY = (rect.height - drawH) / 2; }
    else { drawW = rect.height * vAR; offX = (rect.width - drawW) / 2; }
    const nx = (clientX - offX) / drawW;
    const ny = (clientY - offY) / drawH;
    if (nx < 0 || nx > 1 || ny < 0 || ny > 1) return;
    const ok = capRef.current.seed(v, nx, ny);
    if (ok) {
      seededRef.current = true; setSeeded(true);
      setPtCount(capRef.current.pointCount());
    }
  };

  const toggleRecord = () => {
    if (!seededRef.current) { alert('먼저 화면에서 바벨 끝이나 원판을 눌러 추적점을 1개 이상 지정하세요.'); return; }
    if (!recording) {
      capRef.current.reset();
      phSamplesRef.current = [];
      frameStatsRef.current = { total: 0, lost: 0 };
      recordingRef.current = true;
      setRecording(true);
      setResult(null);
    } else {
      recordingRef.current = false;
      setRecording(false);
      const sum = capRef.current.summary();
      if (!sum) { alert('기록된 움직임이 부족합니다. 다시 측정하세요.'); return; }
      const fs = frameStatsRef.current;
      const lostRatio = fs.total ? fs.lost / fs.total : 1;
      if (lostRatio > 0.4) {
        alert('추적이 자주 끊겼습니다(인식 ' + Math.round((1 - lostRatio) * 100) + '%). 더 잘 보이는 지점을 2~3곳 눌러 다시 측정하면 정확합니다.');
      }
      const H = Number(heightCm) || null;
      const phs = phSamplesRef.current.filter(Boolean).sort((a, b) => a - b);
      const phMed = phs.length ? phs[Math.floor(phs.length / 2)] : phRef.current;
      const cm = romToCm(sum.romRatio, phMed, H);
      if (!cm) { alert('키(cm)를 입력·적용한 뒤, 사람 전신이 보이게 측정하세요.'); return; }
      const distanceM = cm / 100;
      const timeSec = sum.durationMs / 1000;
      const vbt = calcVBT(distanceM, timeSec);
      if (!vbt) { alert('측정값이 부족합니다. 다시 시도하세요.'); return; }
      setResult({ ...vbt, distanceM: Math.round(distanceM * 1000) / 1000, timeSec: Math.round(timeSec * 100) / 100, romCm: cm });
    }
  };

  const save = () => {
    if (!result) return;
    const weight = totalWeight(plate.sidePlates, plate.barKg).total;
    onSave?.({
      type: 'vbt',
      distance: result.distanceM,
      time: result.timeSec,
      meanVelocity: result.meanVelocity,
      zone: result.zone?.label,
      heightCm: Number(heightCm) || null,
      weight: weight || null,
      barKg: plate.barKg,
      sidePlates: plate.sidePlates,
    });
  };

  // ───────── 풀스크린 카메라(측정 중) ─────────
  if (status !== 'idle') {
    const topBar = (
      <>
        <div className="flex items-center gap-1.5 flex-wrap justify-end">
          <span className="bg-black/65 rounded-full px-2.5 py-1 text-[10px] text-cyan-300 font-bold">
            {ptCount === 0
              ? '바벨 끝·원판을 눌러 추적점 지정 (최대 3개)'
              : recording
                ? `추적점 ${activePts}/${ptCount} 인식 중`
                : `추적점 ${ptCount}개 · 측정 시작 후 1렙`}
          </span>
          {ptCount > 0 && (
            <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${activePts >= 2 ? 'bg-emerald-500/85 text-slate-950' : activePts === 1 ? 'bg-amber-500/85 text-slate-950' : 'bg-red-500/85 text-white'}`}>
              신뢰도 {activePts >= 2 ? '높음' : activePts === 1 ? '보통' : '낮음'}
            </span>
          )}
        </div>
        <span className={`rounded-full px-3 py-1 text-[11px] font-bold ${framing.level === 'good' ? 'bg-emerald-500/85 text-slate-950' : framing.level === 'warn' ? 'bg-amber-500/85 text-slate-950' : 'bg-red-500/85 text-white'}`}>
          {framing.level === 'good' ? '✓ ' : '⚠ '}{framing.message}
        </span>
        {!heightCm && (
          <span className="rounded-full px-2.5 py-1 text-[10px] font-bold bg-amber-500/85 text-slate-950">
            키 미입력 — 속도 계산엔 키 필요
          </span>
        )}
      </>
    );

    const controls = (
      <button onClick={toggleRecord}
        className={`px-6 h-14 rounded-full text-base font-black active:scale-95 shadow-lg ${recording ? 'bg-red-500 text-white' : seeded ? 'bg-amber-500 text-slate-950' : 'bg-slate-600 text-slate-200'}`}>
        {recording ? '■ 측정 종료' : '● 측정 시작'}
      </button>
    );

    return (
      <CameraStage
        videoRef={videoRef} canvasRef={canvasRef} status={status} error={error}
        onTapVideo={onTapVideo} onClose={closeCam} topBar={topBar} controls={controls}
        recording={recording}
      >
        {result && (
          <div className="mx-auto max-w-md w-full card-accent p-3 space-y-2 animate-fade-in">
            <div className="flex items-baseline justify-between">
              <p className="text-[11px] font-bold text-amber-400 uppercase tracking-widest">평균 속도</p>
              {result.zone && <p className={`text-xs font-bold ${ZONE_COLOR[result.zone.color]}`}>{result.zone.label}</p>}
            </div>
            <p className="text-center font-mono font-black text-4xl text-slate-100">{result.meanVelocity}<span className="text-base text-slate-500"> m/s</span></p>
            <div className="grid grid-cols-2 gap-2 text-center">
              <div className="bg-slate-800 rounded-xl py-2">
                <p className="text-[10px] text-slate-500">이동 거리</p>
                <p className="font-mono font-bold text-slate-100 text-sm">{result.romCm}cm</p>
              </div>
              <div className="bg-slate-800 rounded-xl py-2">
                <p className="text-[10px] text-slate-500">추진 시간</p>
                <p className="font-mono font-bold text-slate-100 text-sm">{result.timeSec}s</p>
              </div>
            </div>
            {onSave && <button onClick={save} className="btn btn-primary w-full">이 측정 저장</button>}
          </div>
        )}
      </CameraStage>
    );
  }

  // ───────── 준비 화면(카메라 꺼짐) ─────────
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="measure-back">← 메뉴</button>
        <h2 className="measure-title">VBT · 속도기반</h2>
        <span className="w-12" />
      </div>

      <HeightField value={heightCm} onChange={setHeightCm} member={member}
        hint="거리·속도 환산에 사용" />

      <FramingIntro preset={FRAMING_PRESETS.vbt} onStart={startCam} startLabel="📷 카메라 시작 (전체화면)" />

      <PlateWeightInput value={plate} onChange={setPlate} getVideo={null} />

      <div className="bg-slate-800 rounded-xl p-3 space-y-1">
        <p className="text-[10px] text-slate-500 mb-1">속도 구간별 훈련 목적 (참고)</p>
        {VBT_ZONES.map((z, i) => (
          <div key={i} className="flex justify-between text-[11px] px-2 py-1">
            <span className="text-slate-500">{z.min}{z.max === Infinity ? '+' : `~${z.max}`} m/s</span>
            <span className="text-slate-400">{z.label}</span>
          </div>
        ))}
      </div>

      <p className="text-[11px] text-slate-500 leading-relaxed">
        ※ 카메라를 켜면 전체 화면으로 전환됩니다. 옆에서 촬영해야 바벨 수직 속도가 정확히 잡히며,
        한 번에 1렙만 측정하면 속도가 더 정확합니다. 카메라 한 대 추정이라 전용 엔코더보다
        정밀하진 않으며 평균속도 추세 파악용으로 적합합니다.
      </p>
    </div>
  );
}
