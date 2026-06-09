// ai-measure/menus/OneRMEstimate.jsx
// 메뉴 5: 1RM 추정 (벤치프레스 / 스쿼트 / 데드리프트 3종목).
//
// 입력 방식(동규님 지침):
//   1) 무게: "색 자동인식(보조) + 수동 확인" — 카메라로 IWF 규격 플레이트 색을
//      추정해 후보를 띄우되, 최종 무게는 사용자가 +/- 로 확정/수정한다.
//   2) 반복: 3회·5회 기준(프리셋) + 직접 입력 가능.
//   3) (선택) 카메라로 바벨(손목 중점) 수직 변위(ROM)를 함께 기록.
//   4) 1RM = Epley·Brzycki 평균.
import { useRef, useState, useEffect, useCallback } from 'react';
import { estimate1RM, LIFTS, REP_PRESETS, repTargets } from '../core/strength';
import {
  IWF_PLATES, BAR_WEIGHTS, detectPlatesFromVideo,
  suggestSidePlates, totalWeight,
} from '../core/plates';
import { usePoseEngine } from '../core/usePoseEngine';
import { barbellPoint, createBarbellTracker, personHeightRatio, romToCm } from '../core/barbell';
import { drawGuides } from '../core/cameraGuide';

// 편측 원판 후보(장수 조절용) 색상 배지
const PLATE_HEX = { 빨강:'#D7263D', 파랑:'#0B61A4', 노랑:'#F2C200', 초록:'#1F9D55', 흰색:'#E8E8E8' };

export default function OneRMEstimate({ member, onSave, onBack }) {
  const [lift, setLift] = useState('squat');
  const [reps, setReps] = useState(5);
  const [barKg, setBarKg] = useState(20);
  // 편측 원판 구성 [{kg,label,count}]
  const [sidePlates, setSidePlates] = useState([]);
  const [manualWeight, setManualWeight] = useState(''); // 색인식 안 쓰고 직접 무게
  const [useManual, setUseManual] = useState(true);     // 기본: 수동 입력
  const [result, setResult] = useState(null);

  // ── 카메라(보조) ──
  const [camOpen, setCamOpen] = useState(false);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const trackerRef = useRef(createBarbellTracker());
  const roiRef = useRef({ x: 0.05, y: 0.35, w: 0.22, h: 0.45 }); // 바벨 끝(좌측) ROI
  const [detected, setDetected] = useState([]);    // 색 추정 결과(편측 후보)
  const [romCm, setRomCm] = useState(null);
  const heightCm = member?.height || null;

  // 총중량(색인식/수동 분기)
  const computedWeight = useManual
    ? Number(manualWeight) || 0
    : totalWeight(sidePlates, barKg).total;

  // ───────── 카메라 프레임 처리 ─────────
  const handleResult = useCallback((lms, ts, video) => {
    const canvas = canvasRef.current;
    if (canvas && video) {
      const cw = canvas.width, ch = canvas.height;
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, cw, ch);
      drawGuides(ctx, cw, ch, {});
      // ROI 박스(플레이트 색 인식 영역) 표시
      const r = roiRef.current;
      ctx.save();
      ctx.strokeStyle = 'rgba(245,158,11,0.9)';
      ctx.lineWidth = 2; ctx.setLineDash([5, 4]);
      ctx.strokeRect(r.x * cw, r.y * ch, r.w * cw, r.h * ch);
      ctx.fillStyle = 'rgba(245,158,11,0.9)';
      ctx.font = 'bold 12px sans-serif';
      ctx.fillText('원판을 이 박스에', r.x * cw + 4, r.y * ch - 6);
      ctx.restore();
      // 바벨(손목 중점) 점 표시
      const bp = barbellPoint(lms);
      if (bp) {
        ctx.save();
        ctx.fillStyle = '#22d3ee';
        ctx.beginPath(); ctx.arc(bp.x * cw, bp.y * ch, 7, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        trackerRef.current.push(bp, ts);
      }
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

  const openCam = async () => {
    setCamOpen(true);
    setUseManual(false);
    trackerRef.current.reset();
    setTimeout(() => start(videoRef.current), 50);
  };
  const closeCam = () => { stop(); setCamOpen(false); };

  // 색 자동인식(보조) — 현재 프레임에서 ROI 색 집계 → 후보 제시
  const scanColors = () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) { alert('카메라가 아직 준비되지 않았습니다.'); return; }
    const { dominant } = detectPlatesFromVideo(v, roiRef.current);
    if (!dominant.length) { alert('원판 색을 찾지 못했습니다. 원판이 박스 안에 잘 보이게 한 뒤 다시 시도하세요.'); return; }
    setDetected(dominant);
    setSidePlates(suggestSidePlates(dominant)); // 자동 채움(사용자가 보정)
  };

  // 바벨 ROM 기록 멈추고 cm 변환
  const finishTrack = () => {
    const sum = trackerRef.current.summary();
    const v = videoRef.current;
    // 마지막 프레임 사람키 비율로 cm 환산(근사)
    setRomCm(sum && heightCm ? `${sum.romRatio} (화면비율)` : sum ? `${sum.romRatio}` : null);
  };

  // ───────── 수동 원판 조절 ─────────
  const addPlate = (p) => {
    setUseManual(false);
    setSidePlates(prev => {
      const i = prev.findIndex(x => x.kg === p.kg);
      if (i >= 0) { const n = [...prev]; n[i] = { ...n[i], count: n[i].count + 1 }; return n; }
      return [...prev, { kg: p.kg, label: p.label, count: 1 }];
    });
  };
  const changeCount = (kg, delta) => {
    setSidePlates(prev => prev
      .map(x => x.kg === kg ? { ...x, count: Math.max(0, x.count + delta) } : x)
      .filter(x => x.count > 0));
  };

  // ───────── 계산 ─────────
  const calc = () => {
    const w = computedWeight, r = Number(reps);
    if (!w || w <= 0) { alert('무게가 0보다 커야 합니다. 원판 구성 또는 무게를 확인하세요.'); return; }
    if (!r || r <= 0) { alert('반복 횟수를 입력하세요.'); return; }
    if (r > 12) { alert('반복 횟수가 12회를 넘으면 추정 오차가 큽니다. 12회 이하로 입력하세요.'); return; }
    setResult({ ...estimate1RM(w, r), usedWeight: w });
  };

  const save = () => {
    if (!result) return;
    onSave?.({
      lift,
      liftLabel: LIFTS.find(l => l.key === lift)?.label,
      weight: result.usedWeight,
      reps: Number(reps),
      oneRM: result.average,
      epley: result.epley,
      brzycki: result.brzycki,
      barKg: useManual ? null : barKg,
      sidePlates: useManual ? null : sidePlates,
      weightSource: useManual ? 'manual' : 'plate-color',
      romRatio: trackerRef.current.summary()?.romRatio ?? null,
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="measure-back">← 메뉴</button>
        <h2 className="measure-title">1RM 추정</h2>
        <span className="w-12" />
      </div>

      {/* 종목 (3종) */}
      <div className="flex gap-1 rounded-xl bg-slate-800 p-1">
        {LIFTS.map(l => (
          <button key={l.key} onClick={() => { setLift(l.key); setResult(null); }}
            className={`flex-1 rounded-lg py-1.5 text-xs font-bold ${lift === l.key ? 'bg-amber-500 text-slate-950' : 'text-slate-400'}`}>
            {l.label}
          </button>
        ))}
      </div>

      {/* 무게 입력 방식 토글 */}
      <div className="flex gap-1 rounded-lg bg-slate-800 p-0.5 w-fit text-[11px]">
        <button onClick={() => setUseManual(true)}
          className={`px-3 py-1 rounded font-bold ${useManual ? 'bg-amber-500 text-slate-950' : 'text-slate-400'}`}>
          무게 직접 입력
        </button>
        <button onClick={() => setUseManual(false)}
          className={`px-3 py-1 rounded font-bold ${!useManual ? 'bg-amber-500 text-slate-950' : 'text-slate-400'}`}>
          원판 색 인식(보조)
        </button>
      </div>

      {useManual ? (
        /* ── 직접 입력 ── */
        <div>
          <label className="block text-xs font-semibold text-slate-400 uppercase tracking-widest mb-1.5">든 무게 (kg)</label>
          <input type="number" step="2.5" value={manualWeight} onChange={e => setManualWeight(e.target.value)}
            placeholder="80" className="input-mono" />
        </div>
      ) : (
        /* ── 원판 색 인식(보조) + 수동 확인 ── */
        <div className="space-y-3">
          {/* 카메라 */}
          {!camOpen ? (
            <button onClick={openCam} className="btn btn-primary w-full">📷 카메라로 원판 색 인식</button>
          ) : (
            <div className="space-y-2">
              <div className="relative w-full rounded-2xl overflow-hidden bg-black mx-auto" style={{ aspectRatio: '3 / 4', maxHeight: '52vh' }}>
                <video ref={videoRef} autoPlay playsInline muted className="absolute inset-0 w-full h-full object-contain" />
                <canvas ref={canvasRef} className="absolute inset-0 w-full h-full object-contain pointer-events-none" />
                {status !== 'running' && (
                  <div className="absolute inset-0 flex items-center justify-center text-slate-400 text-sm text-center px-4">
                    {status === 'loading' ? 'AI 모델 로딩 중…' : status === 'error' ? `오류: ${error}` : '카메라 준비 중…'}
                  </div>
                )}
                {status === 'running' && (
                  <div className="absolute bottom-3 left-0 right-0 flex items-center justify-center gap-4">
                    <button onClick={closeCam} className="w-10 h-10 rounded-full bg-black/50 border border-white/30 text-white text-[10px] font-bold">닫기</button>
                    <button onClick={scanColors} className="px-4 h-10 rounded-full bg-amber-500 text-slate-950 text-xs font-black active:scale-95">색 인식</button>
                    <button onClick={finishTrack} className="w-10 h-10 rounded-full bg-black/50 border border-white/30 text-white text-[10px] font-bold">ROM</button>
                  </div>
                )}
              </div>
              {detected.length > 0 && (
                <p className="text-[11px] text-cyan-400">
                  인식된 색: {detected.map(d => `${d.label}(${Math.round(d.ratio * 100)}%)`).join(', ')} — 아래에서 장수를 확인·수정하세요.
                </p>
              )}
            </div>
          )}

          {/* 봉 무게 */}
          <div>
            <label className="block text-xs font-semibold text-slate-400 uppercase tracking-widest mb-1.5">봉 무게</label>
            <select value={barKg} onChange={e => setBarKg(Number(e.target.value))} className="input">
              {BAR_WEIGHTS.map(b => <option key={b.kg} value={b.kg}>{b.label}</option>)}
            </select>
          </div>

          {/* 편측 원판 추가 버튼 */}
          <div>
            <label className="block text-xs font-semibold text-slate-400 uppercase tracking-widest mb-1.5">한쪽 원판 추가 (양쪽 동일 적용)</label>
            <div className="flex flex-wrap gap-1.5">
              {IWF_PLATES.filter(p => !p.small && !p.chrome).map(p => (
                <button key={p.label} onClick={() => addPlate(p)}
                  className="px-2.5 py-1 rounded-lg text-[11px] font-bold border"
                  style={{ borderColor: PLATE_HEX[p.label] || '#64748b', color: PLATE_HEX[p.label] || '#cbd5e1' }}>
                  + {p.kg}
                </button>
              ))}
            </div>
          </div>

          {/* 현재 편측 구성 */}
          {sidePlates.length > 0 && (
            <div className="bg-slate-800 rounded-xl p-3 space-y-2">
              <p className="text-[10px] text-slate-500">한쪽 구성 (확인·수정)</p>
              {sidePlates.map(p => (
                <div key={p.kg} className="flex items-center justify-between">
                  <span className="text-xs font-bold" style={{ color: PLATE_HEX[p.label] || '#cbd5e1' }}>
                    {p.label} {p.kg}kg
                  </span>
                  <div className="flex items-center gap-2">
                    <button onClick={() => changeCount(p.kg, -1)} className="w-7 h-7 rounded bg-slate-700 text-slate-200 font-bold">−</button>
                    <span className="font-mono font-bold text-slate-100 w-6 text-center">{p.count}</span>
                    <button onClick={() => changeCount(p.kg, +1)} className="w-7 h-7 rounded bg-slate-700 text-slate-200 font-bold">+</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* 총중량 미리보기 */}
          <div className="card-accent p-3 text-center">
            <p className="text-[10px] text-slate-500">총중량 (양쪽 + 봉)</p>
            <p className="font-mono font-black text-2xl text-slate-100">{computedWeight}<span className="text-sm text-slate-500"> kg</span></p>
          </div>
        </div>
      )}

      {/* 반복 횟수 (3·5회 프리셋 + 직접) */}
      <div>
        <label className="block text-xs font-semibold text-slate-400 uppercase tracking-widest mb-1.5">반복 횟수</label>
        <div className="flex items-center gap-2">
          {REP_PRESETS.map(r => (
            <button key={r} onClick={() => setReps(r)}
              className={`px-4 py-2 rounded-lg text-sm font-bold ${Number(reps) === r ? 'bg-amber-500 text-slate-950' : 'bg-slate-800 text-slate-400'}`}>
              {r}회
            </button>
          ))}
          <input type="number" value={reps} onChange={e => setReps(e.target.value)} className="input-mono flex-1" placeholder="직접" />
        </div>
      </div>

      <button onClick={calc} className="btn btn-primary w-full">1RM 계산</button>

      {/* 결과 */}
      {result && (
        <div className="card-accent p-4 space-y-3 animate-fade-in">
          <p className="text-xs font-bold text-amber-400 uppercase tracking-widest">
            추정 1RM · {computedWeight}kg × {reps}회
          </p>
          <p className="text-center font-mono font-black text-5xl text-slate-100">
            {result.average}<span className="text-lg text-slate-500"> kg</span>
          </p>
          <p className="text-center text-[10px] text-slate-500">검증된 {result.formulas.length}개 공식 평균</p>

          {/* 공식별 추정값 */}
          <div className="bg-slate-800 rounded-xl p-3">
            <p className="text-[10px] text-slate-500 mb-1.5">공식별 추정 (kg)</p>
            <div className="grid grid-cols-2 gap-1.5 text-center text-[11px]">
              {result.formulas.map(f => (
                <div key={f.key} className="flex justify-between bg-slate-900/60 rounded px-2 py-1">
                  <span className="text-slate-500">{f.label}</span>
                  <span className="font-mono font-bold text-slate-200">{f.value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* 3·5회 목표 무게 (표준표 기반 · 참고용) */}
          <div className="bg-slate-800 rounded-xl p-3">
            <p className="text-[10px] text-slate-500 mb-1.5">반복별 목표 무게 (참고 · 회원별 실제값은 측정으로 확정)</p>
            <div className="grid grid-cols-2 gap-1 text-center text-[11px]">
              {repTargets(result.average).map(t => (
                <div key={t.reps}>
                  <p className="text-slate-500">{t.reps}회 ({t.pct}%)</p>
                  <p className="font-mono font-bold text-amber-400">{t.weight} kg</p>
                </div>
              ))}
            </div>
          </div>
          {onSave && <button onClick={save} className="btn btn-primary w-full">이 측정 저장</button>}
        </div>
      )}

      <p className="text-[11px] text-slate-500 leading-relaxed">
        ※ 원판 색 인식은 보조 기능입니다. 조명·각도·겹침에 따라 틀릴 수 있으니 항상 장수를 직접
        확인·수정한 뒤 계산하세요. 추정식은 1~10회에서 가장 정확합니다(무거운 부하일수록 정확).
      </p>
    </div>
  );
}
