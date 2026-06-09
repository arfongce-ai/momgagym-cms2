// ai-measure/menus/VbtMeasure.jsx
// 메뉴 7: VBT (속도 기반 트레이닝) — 바벨 엔드캡(봉 끝) 탭 추적으로 자동 측정.
//  - 화면에서 엔드캡을 한 번 누르면 그 색을 학습해 따라간다.
//  - 측정 시작 → 한 렙 동작 → 측정 종료 시: 수직 이동거리(키 환산 m) ÷ 시간 = 평균속도.
//  - cm·m 환산은 회원 키 기준(근사). 전용 엔코더보다 정밀하진 않으나 추세 파악엔 충분.
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

const ZONE_COLOR = {
  blue:   'text-blue-400',
  green:  'text-emerald-400',
  yellow: 'text-amber-400',
  orange: 'text-orange-400',
  red:    'text-red-400',
};

export default function VbtMeasure({ member, onSave, onBack }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const capRef = useRef(createMultiTracker());
  const phRef = useRef(null);              // 사람키 비율(최근값)
  const recordingRef = useRef(false);
  const seededRef = useRef(false);
  const framingRef = useRef({ level: 'bad', message: '' });

  const [recording, setRecording] = useState(false);
  const [seeded, setSeeded] = useState(false);
  const [ptCount, setPtCount] = useState(0);
  const [activePts, setActivePts] = useState(0);
  const [result, setResult] = useState(null);
  const [heightCm, setHeightCm] = useState(member?.height || '');
  const [plate, setPlate] = useState({ barKg: 20, sidePlates: [] }); // 원판 무게(기록용)
  const [framing, setFraming] = useState({ level: 'bad', message: '카메라 준비 중…' });

  const handleResult = useCallback((lms, ts, video) => {
    const canvas = canvasRef.current;
    if (!canvas || !video) return;
    const cw = canvas.width, ch = canvas.height;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, cw, ch);
    drawGuides(ctx, cw, ch, {});

    const ph = personHeightRatio(lms);
    if (ph) phRef.current = ph;

    // 촬영 위치·거리 실시간 판정(VBT=측면 권장)
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

      const path = cap.path();
      ctx.save();
      ctx.strokeStyle = 'rgba(34,211,238,0.9)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      path.forEach((q, i) => {
        const X = q.x * cw, Y = q.y * ch;
        i === 0 ? ctx.moveTo(X, Y) : ctx.lineTo(X, Y);
      });
      ctx.stroke();
      cap.points().forEach(pt => {
        if (!pt.ema) return;
        ctx.fillStyle = pt.alive ? 'rgba(16,185,129,0.9)' : 'rgba(148,163,184,0.6)';
        ctx.beginPath(); ctx.arc(pt.ema.x * cw, pt.ema.y * ch, 5, 0, Math.PI * 2); ctx.fill();
      });
      if (p) {
        ctx.fillStyle = '#f59e0b';
        ctx.beginPath(); ctx.arc(p.x * cw, p.y * ch, 9, 0, Math.PI * 2); ctx.fill();
        ctx.lineWidth = 2; ctx.strokeStyle = '#fff';
        ctx.beginPath(); ctx.arc(p.x * cw, p.y * ch, 9, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.restore();
    }
  }, [activePts]);

  const { start, stop, status, error } = usePoseEngine({ onResult: handleResult });

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
    setTimeout(() => start(videoRef.current), 50);
  };

  // 화면 탭 → 엔드캡 색 학습(seed). object-contain 좌표 보정 포함.
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
      recordingRef.current = true;
      setRecording(true);
    } else {
      recordingRef.current = false;
      setRecording(false);
      const sum = capRef.current.summary();
      if (!sum) { alert('기록된 움직임이 부족합니다. 다시 측정하세요.'); return; }
      const H = Number(heightCm) || null;
      const cm = romToCm(sum.romRatio, phRef.current, H);
      if (!cm) { alert('키(cm)를 입력해야 거리·속도를 환산할 수 있습니다.'); return; }
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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="measure-back">← 메뉴</button>
        <h2 className="measure-title">VBT · 속도기반</h2>
        <span className="w-12" />
      </div>

      <div className="flex items-center gap-2">
        <input type="number" value={heightCm} onChange={e => setHeightCm(e.target.value)}
          placeholder="키(cm)" className="w-28 bg-slate-800 border border-slate-700 text-slate-100 rounded-lg px-2 py-1 text-xs font-mono" />
        {member?.height && Number(heightCm) === Number(member.height) && (
          <span className="text-[9px] text-emerald-400">기록에서 불러옴</span>
        )}
        <span className="text-[10px] text-slate-500">거리·속도 환산에 사용</span>
      </div>

      <div className="measure-camera">
        <video ref={videoRef} autoPlay playsInline muted className="absolute inset-0 w-full h-full object-contain" />
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full object-contain pointer-events-none" />
        {status === 'running' && (
          <div className="absolute inset-0" onClick={onTapVideo} onTouchStart={onTapVideo} />
        )}
        {status !== 'running' && (
          <div className="absolute inset-0 flex items-center justify-center text-slate-400 text-sm text-center px-4">
            {status === 'loading' ? 'AI 모델 로딩 중…' : status === 'error' ? `오류: ${error}` : '카메라를 시작하세요 (옆에서 촬영 권장)'}
          </div>
        )}
        {status === 'running' && (
          <>
            <div className="absolute top-2 left-2 right-2 flex items-center justify-between gap-2">
              <span className="bg-black/65 rounded-full px-2.5 py-1 text-[10px] text-cyan-300 font-bold">
                {ptCount === 0
                  ? '바벨 끝·원판을 눌러 추적점 지정 (최대 3개)'
                  : recording
                    ? `추적점 ${activePts}/${ptCount} 인식 중`
                    : `추적점 ${ptCount}개 지정됨 · 측정 시작 후 1렙`}
              </span>
              {ptCount > 0 && (
                <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${activePts >= 2 ? 'bg-emerald-500/80 text-slate-950' : activePts === 1 ? 'bg-amber-500/80 text-slate-950' : 'bg-red-500/80 text-white'}`}>
                  신뢰도 {activePts >= 2 ? '높음' : activePts === 1 ? '보통' : '낮음'}
                </span>
              )}
            </div>
            {/* 실시간 촬영 위치·거리 가이드 */}
            <div className="absolute top-11 left-2 right-2 flex justify-center">
              <span className={`rounded-full px-3 py-1 text-[11px] font-bold ${framing.level === 'good' ? 'bg-emerald-500/85 text-slate-950' : framing.level === 'warn' ? 'bg-amber-500/85 text-slate-950' : 'bg-red-500/85 text-white'}`}>
                {framing.level === 'good' ? '✓ ' : '⚠ '}{framing.message}
              </span>
            </div>
            <div className="absolute bottom-4 left-0 right-0 flex items-center justify-center gap-6">
              <button onClick={stop} className="w-11 h-11 rounded-full bg-black/50 border border-white/30 text-white text-xs font-bold">정지</button>
              <button onClick={toggleRecord}
                className={`px-5 h-12 rounded-full text-sm font-black active:scale-95 ${recording ? 'bg-red-500 text-white' : seeded ? 'bg-amber-500 text-slate-950' : 'bg-slate-600 text-slate-300'}`}>
                {recording ? '■ 측정 종료' : '● 측정 시작'}
              </button>
              <span className="w-11" />
            </div>
          </>
        )}
      </div>

      {status !== 'running' && (
        <FramingIntro preset={FRAMING_PRESETS.vbt} onStart={startCam} />
      )}

      <PlateWeightInput
        value={plate}
        onChange={setPlate}
        getVideo={status === 'running' ? () => videoRef.current : null}
      />

      {result && (
        <div className="card-accent p-4 space-y-3 animate-fade-in">
          <div className="flex items-baseline justify-between">
            <p className="text-xs font-bold text-amber-400 uppercase tracking-widest">평균 속도</p>
            {result.zone && <p className={`text-sm font-bold ${ZONE_COLOR[result.zone.color]}`}>{result.zone.label}</p>}
          </div>
          <p className="text-center font-mono font-black text-5xl text-slate-100">{result.meanVelocity}<span className="text-lg text-slate-500"> m/s</span></p>

          <div className="grid grid-cols-2 gap-2 text-center">
            <div className="bg-slate-800 rounded-xl py-2">
              <p className="text-[10px] text-slate-500">이동 거리</p>
              <p className="font-mono font-bold text-slate-100">{result.romCm}cm</p>
            </div>
            <div className="bg-slate-800 rounded-xl py-2">
              <p className="text-[10px] text-slate-500">추진 시간</p>
              <p className="font-mono font-bold text-slate-100">{result.timeSec}s</p>
            </div>
          </div>

          {/* 속도 존 표 */}
          <div className="bg-slate-800 rounded-xl p-3 space-y-1">
            <p className="text-[10px] text-slate-500 mb-1">속도 구간별 훈련 목적</p>
            {VBT_ZONES.map((z, i) => {
              const active = result.zone && z.label === result.zone.label;
              return (
                <div key={i} className={`flex justify-between text-[11px] px-2 py-1 rounded ${active ? 'bg-slate-700' : ''}`}>
                  <span className={active ? ZONE_COLOR[z.color] + ' font-bold' : 'text-slate-500'}>
                    {z.min}{z.max === Infinity ? '+' : `~${z.max}`} m/s
                  </span>
                  <span className={active ? 'text-slate-100 font-bold' : 'text-slate-500'}>{z.label}</span>
                </div>
              );
            })}
          </div>
          {onSave && <button onClick={save} className="btn btn-primary w-full">이 측정 저장</button>}
        </div>
      )}

      <p className="text-[11px] text-slate-500 leading-relaxed">
        ※ 바벨 끝·원판 등 잘 보이는 곳을 2~3군데 눌러 추적점을 지정하면, 한 점이 가려지거나
        튀어도 나머지 점으로 보완해 오차를 줄입니다. 카메라 한 대 추정이라 전용 엔코더보다
        정밀하진 않으며, 평균속도 추세 파악용으로 적합합니다.
      </p>
    </div>
  );
}
