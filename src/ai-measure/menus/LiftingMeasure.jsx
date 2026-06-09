// ai-measure/menus/LiftingMeasure.jsx
// 메뉴 8: 역도 — 바벨 궤적 추적(손목 중점 기준) + 수직 변위/추진시간 기록.
//  - 카메라로 바벨(양 손목 중점)을 추적해 한 동작의 수직 이동(ROM)과 시간을 잰다.
//  - 옆에서 촬영 권장. cm 환산은 회원 키 기준(근사).
//  - 측정값은 회원 측정이력에 저장.
import { useRef, useState, useEffect, useCallback } from 'react';
import { usePoseEngine } from '../core/usePoseEngine';
import { drawGuides } from '../core/cameraGuide';
import {
  barbellPoint, createBarbellTracker, personHeightRatio, romToCm,
} from '../core/barbell';

export default function LiftingMeasure({ member, onSave, onBack }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const trackerRef = useRef(createBarbellTracker());
  const pathRef = useRef([]);              // 화면에 그릴 궤적 점들(정규화)
  const phRef = useRef(null);              // 사람키 비율(최근값)
  const recordingRef = useRef(false);

  const [recording, setRecording] = useState(false);
  const [result, setResult] = useState(null);
  const [heightCm, setHeightCm] = useState(member?.height || '');

  const handleResult = useCallback((lms, ts, video) => {
    const canvas = canvasRef.current;
    if (!canvas || !video) return;
    const cw = canvas.width, ch = canvas.height;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, cw, ch);
    drawGuides(ctx, cw, ch, {});

    const ph = personHeightRatio(lms);
    if (ph) phRef.current = ph;

    const bp = barbellPoint(lms);
    if (bp) {
      if (recordingRef.current) {
        trackerRef.current.push(bp, ts);
        pathRef.current.push({ x: bp.x, y: bp.y });
        if (pathRef.current.length > 300) pathRef.current.shift();
      }
      // 바벨 궤적 그리기
      ctx.save();
      ctx.strokeStyle = 'rgba(34,211,238,0.9)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      pathRef.current.forEach((p, i) => {
        const X = p.x * cw, Y = p.y * ch;
        i === 0 ? ctx.moveTo(X, Y) : ctx.lineTo(X, Y);
      });
      ctx.stroke();
      // 현재 바벨 점
      ctx.fillStyle = '#f59e0b';
      ctx.beginPath(); ctx.arc(bp.x * cw, bp.y * ch, 8, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  }, []);

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

  const startCam = () => { setResult(null); setTimeout(() => start(videoRef.current), 50); };

  const toggleRecord = () => {
    if (!recording) {
      trackerRef.current.reset();
      pathRef.current = [];
      recordingRef.current = true;
      setRecording(true);
    } else {
      recordingRef.current = false;
      setRecording(false);
      const sum = trackerRef.current.summary();
      if (!sum) { alert('기록된 움직임이 부족합니다. 다시 측정하세요.'); return; }
      const H = Number(heightCm) || null;
      const cm = romToCm(sum.romRatio, phRef.current, H);
      const sec = sum.durationMs / 1000;
      const velocity = cm && sec ? Math.round((cm / 100 / sec) * 100) / 100 : null; // m/s
      setResult({ ...sum, romCm: cm, sec: Math.round(sec * 100) / 100, velocity });
    }
  };

  const save = () => {
    if (!result) return;
    onSave?.({
      type: 'lifting',
      romRatio: result.romRatio,
      romCm: result.romCm,
      durationSec: result.sec,
      meanVelocity: result.velocity,
      heightCm: Number(heightCm) || null,
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="measure-back">← 메뉴</button>
        <h2 className="measure-title">역도 · 바벨 추적</h2>
        <span className="w-12" />
      </div>

      <div className="flex items-center gap-2">
        <input type="number" value={heightCm} onChange={e => setHeightCm(e.target.value)}
          placeholder="키(cm)" className="w-28 bg-slate-800 border border-slate-700 text-slate-100 rounded-lg px-2 py-1 text-xs font-mono" />
        {member?.height && Number(heightCm) === Number(member.height) && (
          <span className="text-[9px] text-emerald-400">기록에서 불러옴</span>
        )}
        <span className="text-[10px] text-slate-500">cm 환산에 사용</span>
      </div>

      <div className="relative w-full rounded-2xl overflow-hidden bg-black mx-auto" style={{ aspectRatio: '3 / 4', maxHeight: '56vh' }}>
        <video ref={videoRef} autoPlay playsInline muted className="absolute inset-0 w-full h-full object-contain" />
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full object-contain pointer-events-none" />
        {status !== 'running' && (
          <div className="absolute inset-0 flex items-center justify-center text-slate-400 text-sm text-center px-4">
            {status === 'loading' ? 'AI 모델 로딩 중…' : status === 'error' ? `오류: ${error}` : '카메라를 시작하세요 (옆에서 촬영 권장)'}
          </div>
        )}
        {status === 'running' && (
          <>
            <div className="absolute top-2 left-2 right-2">
              <span className="bg-black/65 rounded-full px-2.5 py-1 text-[10px] text-cyan-300 font-bold">
                바벨(손목)을 추적합니다 · 측정 시작을 누르고 동작하세요
              </span>
            </div>
            <div className="absolute bottom-4 left-0 right-0 flex items-center justify-center gap-6">
              <button onClick={stop} className="w-11 h-11 rounded-full bg-black/50 border border-white/30 text-white text-xs font-bold">정지</button>
              <button onClick={toggleRecord}
                className={`px-5 h-12 rounded-full text-sm font-black active:scale-95 ${recording ? 'bg-red-500 text-white' : 'bg-amber-500 text-slate-950'}`}>
                {recording ? '■ 측정 종료' : '● 측정 시작'}
              </button>
              <span className="w-11" />
            </div>
          </>
        )}
      </div>

      {status !== 'running' && (
        <button onClick={startCam} className="btn btn-primary w-full">카메라 시작</button>
      )}

      {result && (
        <div className="card-accent p-4 space-y-3 animate-fade-in">
          <p className="text-xs font-bold text-amber-400 uppercase tracking-widest">바벨 추적 결과</p>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="bg-slate-800 rounded-xl py-2">
              <p className="text-[10px] text-slate-500">수직 이동</p>
              <p className="font-mono font-bold text-slate-100">{result.romCm != null ? `${result.romCm}cm` : `${result.romRatio}`}</p>
            </div>
            <div className="bg-slate-800 rounded-xl py-2">
              <p className="text-[10px] text-slate-500">소요 시간</p>
              <p className="font-mono font-bold text-slate-100">{result.sec}s</p>
            </div>
            <div className="bg-slate-800 rounded-xl py-2">
              <p className="text-[10px] text-slate-500">평균 속도</p>
              <p className="font-mono font-bold text-slate-100">{result.velocity != null ? `${result.velocity}m/s` : '-'}</p>
            </div>
          </div>
          {onSave && <button onClick={save} className="btn btn-primary w-full">이 측정 저장</button>}
        </div>
      )}

      <p className="text-[11px] text-slate-500 leading-relaxed">
        ※ 바벨 위치는 양 손목 중점으로 근사합니다. 옆에서 전신이 보이게 촬영하면 정확도가 올라갑니다.
        cm·속도는 키 기준 추정값으로 참고용입니다.
      </p>
    </div>
  );
}
