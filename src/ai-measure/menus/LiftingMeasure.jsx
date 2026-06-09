// ai-measure/menus/LiftingMeasure.jsx
// 메뉴 8: 역도 — 바벨 엔드캡(봉 끝) 탭 추적 + 수직 변위/추진시간 기록.
//  - 화면에서 엔드캡을 한 번 톡 누르면 그 색을 학습해 따라간다(원판이 손을 가려도 OK).
//  - 옆에서 촬영 권장. cm 환산은 회원 키 기준(근사).
//  - 측정값은 회원 측정이력에 저장.
import { useRef, useState, useEffect, useCallback } from 'react';
import { usePoseEngine } from '../core/usePoseEngine';
import { drawGuides } from '../core/cameraGuide';
import { personHeightRatio, romToCm } from '../core/barbell';
import { createMultiTracker } from '../core/endcapTracker';
import { assessFraming, FRAMING_PRESETS } from '../core/framingGuide';
import { totalWeight } from '../core/plates';
import PlateWeightInput from './PlateWeightInput';
import FramingIntro from './FramingIntro';

export default function LiftingMeasure({ member, onSave, onBack }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const capRef = useRef(createMultiTracker());     // 다중점 추적기
  const phRef = useRef(null);                      // 사람키 비율(최근값)
  const recordingRef = useRef(false);
  const seededRef = useRef(false);                 // 추적점 1개 이상 지정 여부
  const framingRef = useRef({ level: 'bad', message: '' });

  const [recording, setRecording] = useState(false);
  const [seeded, setSeeded] = useState(false);
  const [ptCount, setPtCount] = useState(0);       // 지정한 추적점 수
  const [activePts, setActivePts] = useState(0);   // 현재 살아있는 점 수(신뢰도)
  const [result, setResult] = useState(null);
  const [heightCm, setHeightCm] = useState(member?.height || '');
  const [plate, setPlate] = useState({ barKg: 20, sidePlates: [] }); // 원판 무게(기록용)
  const [framing, setFraming] = useState({ level: 'bad', message: '카메라 준비 중…' });

  // MediaPipe는 키 환산용 사람 비율만 갱신(엔드캡 추적은 픽셀 기반으로 별도 처리)
  const handleResult = useCallback((lms, ts, video) => {
    const canvas = canvasRef.current;
    if (!canvas || !video) return;
    const cw = canvas.width, ch = canvas.height;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, cw, ch);
    drawGuides(ctx, cw, ch, {});

    const ph = personHeightRatio(lms);
    if (ph) phRef.current = ph;

    // 촬영 위치·거리 실시간 판정(역도=측면 권장)
    const fr = assessFraming(lms, { want: FRAMING_PRESETS.lifting.want });
    if (fr.level !== framingRef.current.level || fr.message !== framingRef.current.message) {
      framingRef.current = fr;
      setFraming({ level: fr.level, message: fr.message });
    }

    // 다중점 추적(탭으로 1개 이상 지정된 경우에만)
    const cap = capRef.current;
    if (cap.isSeeded()) {
      const p = cap.update(video);
      if (p && recordingRef.current) cap.push(p, ts);
      // 신뢰도(살아있는 점 수) 갱신
      const act = cap.activeCount();
      if (act !== activePts) setActivePts(act);

      // 안정 궤적(대표 위치) 그리기
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
      // 각 추적점(보조) — 작은 점
      cap.points().forEach(pt => {
        if (!pt.ema) return;
        ctx.fillStyle = pt.alive ? 'rgba(16,185,129,0.9)' : 'rgba(148,163,184,0.6)';
        ctx.beginPath(); ctx.arc(pt.ema.x * cw, pt.ema.y * ch, 5, 0, Math.PI * 2); ctx.fill();
      });
      // 대표 위치(큰 점)
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

  // 화면 탭 → 엔드캡 색 학습(seed)
  const onTapVideo = (e) => {
    const v = videoRef.current;
    if (!v || !v.videoWidth || status !== 'running') return;
    const rect = e.currentTarget.getBoundingClientRect();
    // object-contain 보정: 실제 영상이 그려진 영역 안에서의 위치 계산
    const clientX = (e.touches?.[0]?.clientX ?? e.clientX) - rect.left;
    const clientY = (e.touches?.[0]?.clientY ?? e.clientY) - rect.top;
    const vAR = v.videoWidth / v.videoHeight;
    const bAR = rect.width / rect.height;
    let drawW = rect.width, drawH = rect.height, offX = 0, offY = 0;
    if (vAR > bAR) { drawH = rect.width / vAR; offY = (rect.height - drawH) / 2; }
    else { drawW = rect.height * vAR; offX = (rect.width - drawW) / 2; }
    const nx = (clientX - offX) / drawW;
    const ny = (clientY - offY) / drawH;
    if (nx < 0 || nx > 1 || ny < 0 || ny > 1) return; // 레터박스 영역 탭 무시
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
      const sec = sum.durationMs / 1000;
      const velocity = cm && sec ? Math.round((cm / 100 / sec) * 100) / 100 : null; // m/s
      setResult({ ...sum, romCm: cm, sec: Math.round(sec * 100) / 100, velocity });
    }
  };

  const save = () => {
    if (!result) return;
    const weight = totalWeight(plate.sidePlates, plate.barKg).total;
    onSave?.({
      type: 'lifting',
      romRatio: result.romRatio,
      romCm: result.romCm,
      durationSec: result.sec,
      meanVelocity: result.velocity,
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
        {/* 탭 입력 레이어 */}
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
                    : `추적점 ${ptCount}개 지정됨 · 더 누르거나 측정 시작`}
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
        <FramingIntro preset={FRAMING_PRESETS.lifting} onStart={startCam} />
      )}

      <PlateWeightInput
        value={plate}
        onChange={setPlate}
        getVideo={status === 'running' ? () => videoRef.current : null}
      />

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
        ※ 바벨 끝·원판 등 잘 보이는 곳을 2~3군데 눌러 추적점을 지정하면, 한 점이 가려지거나
        튀어도 나머지 점으로 보완해 오차를 줄입니다. 신뢰도 표시로 인식 상태를 확인하세요.
        옆에서 전신이 보이게 촬영하면 cm·속도 정확도가 올라갑니다.
      </p>
    </div>
  );
}
