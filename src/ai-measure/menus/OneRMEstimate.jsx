// ai-measure/menus/OneRMEstimate.jsx
// 메뉴 5: 1RM 추정 (벤치프레스 / 스쿼트 / 데드리프트).
//  - [재설계] 역도·VBT와 동일한 통일 UX:
//      · 무게는 "직접 입력"이 기본(가장 확실). 카메라는 원판 색 인식 보조.
//      · 카메라를 켜면 풀스크린 오버레이로 전환 → 영상 인식 후 닫으면
//        인식된 원판이 자동 채워지고, 장수를 직접 확인·수정한다.
//      · 인식이 안 되면 그냥 직접 입력으로 진행(폴백).
//  - 1RM = Epley·Brzycki 등 검증된 공식 평균.
import { useRef, useState, useEffect, useCallback } from 'react';
import { estimate1RM, LIFTS, REP_PRESETS } from '../core/strength';
import {
  IWF_PLATES, BAR_WEIGHTS, detectPlatesFromVideo,
  suggestSidePlates, totalWeight,
} from '../core/plates';
import { repTargets } from '../core/strength';
import { usePoseEngine } from '../core/usePoseEngine';
import { assessFraming, FRAMING_PRESETS } from '../core/framingGuide';
import { drawGuides } from '../core/cameraGuide';
import FramingIntro from './FramingIntro';
import CameraStage from './CameraStage';

const PLATE_HEX = { 빨강:'#D7263D', 파랑:'#0B61A4', 노랑:'#F2C200', 초록:'#1F9D55', 흰색:'#E8E8E8' };

export default function OneRMEstimate({ member, onSave, onBack, exerciseType, embedded = false }) {
  // 허브 종목(exerciseType, 예 'bench_press') → 내부 lift 키('bench') 매핑.
  const exToLift = (ex) => (ex === 'bench_press' ? 'bench' : ex === 'squat' ? 'squat' : ex === 'deadlift' ? 'deadlift' : null);
  const [lift, setLift] = useState(exToLift(exerciseType) || 'squat');
  const [reps, setReps] = useState(5);
  const [barKg, setBarKg] = useState(20);
  const [sidePlates, setSidePlates] = useState([]);
  const [manualWeight, setManualWeight] = useState('');
  const [useManual, setUseManual] = useState(true);   // 기본: 직접 입력
  const [result, setResult] = useState(null);

  // 허브에서 종목이 바뀌면 내부 lift 도 동기화(임베드 모드).
  useEffect(() => {
    const mapped = exToLift(exerciseType);
    if (embedded && mapped && mapped !== lift) { setLift(mapped); setResult(null); }
  }, [exerciseType, embedded]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 카메라(원판 색 인식 보조) ──
  const canvasRef = useRef(null);
  const roiRef = useRef({ x: 0.30, y: 0.30, w: 0.40, h: 0.45 }); // 화면 중앙 박스
  const [detected, setDetected] = useState([]);
  const framingRef = useRef({ level: 'bad', message: '' });
  const [framing, setFraming] = useState({ level: 'bad', message: '카메라 준비 중…' });
  const liftRef = useRef(lift);
  liftRef.current = lift;

  const computedWeight = useManual
    ? Number(manualWeight) || 0
    : totalWeight(sidePlates, barKg).total;

  const handleResult = useCallback((lms, ts, video) => {
    const canvas = canvasRef.current;
    if (!canvas || !video) return;
    const cw = canvas.width, ch = canvas.height;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, cw, ch);
    drawGuides(ctx, cw, ch, {});

    const want = (FRAMING_PRESETS[liftRef.current] || FRAMING_PRESETS.squat).want;
    const fr = assessFraming(lms, { want });
    if (fr.level !== framingRef.current.level || fr.message !== framingRef.current.message) {
      framingRef.current = fr;
      setFraming({ level: fr.level, message: fr.message });
    }

    // 원판 색 인식 ROI 박스 표시
    const r = roiRef.current;
    ctx.save();
    ctx.strokeStyle = 'rgba(245,158,11,0.95)';
    ctx.lineWidth = 3; ctx.setLineDash([8, 6]);
    ctx.strokeRect(r.x * cw, r.y * ch, r.w * cw, r.h * ch);
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(245,158,11,0.95)';
    ctx.font = 'bold 14px sans-serif';
    ctx.fillText('원판을 이 박스 안에', r.x * cw + 6, r.y * ch - 8);
    ctx.restore();
  }, []);

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

  const openCam = () => {
    setUseManual(false);
    setDetected([]);
    // video 요소가 풀스크린으로 렌더된 뒤 카메라 연결(검은 화면 방지)
    start();
  };
  // 카메라를 닫으면, 인식된 원판이 없을 때는 직접 입력으로 자연스럽게 되돌린다.
  const closeCam = () => {
    stop();
    if (detected.length === 0 && sidePlates.length === 0) setUseManual(true);
  };

  // 색 자동인식(보조) — 현재 프레임 ROI 색 집계 → 후보 채움
  const scanColors = () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) { alert('카메라가 아직 준비되지 않았습니다.'); return; }
    const { dominant } = detectPlatesFromVideo(v, roiRef.current);
    if (!dominant.length) { alert('원판 색을 찾지 못했습니다. 원판이 박스 안에 잘 보이게 한 뒤 다시 시도하세요.'); return; }
    setDetected(dominant);
    setSidePlates(suggestSidePlates(dominant));
    stop(); // 인식했으면 카메라 닫고 아래에서 장수 확인·수정
  };

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

  const calc = () => {
    const w = computedWeight, r = Number(reps);
    if (!w || w <= 0) { alert('무게가 0보다 커야 합니다. 무게를 직접 입력하거나 원판을 구성하세요.'); return; }
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
      formulas: result.formulas,
      barKg: useManual ? null : barKg,
      sidePlates: useManual ? null : sidePlates,
      weightSource: useManual ? 'manual' : 'plate-color',
    });
  };

  // ───────── 풀스크린 카메라(원판 색 인식) ─────────
  if (status !== 'idle') {
    const topBar = (
      <>
        <span className="bg-black/65 rounded-full px-2.5 py-1 text-[10px] text-cyan-300 font-bold">
          원판을 박스 안에 두고 [색 인식]
        </span>
        <span className={`rounded-full px-3 py-1 text-[11px] font-bold ${framing.level === 'good' ? 'bg-emerald-500/85 text-slate-950' : framing.level === 'warn' ? 'bg-amber-500/85 text-slate-950' : 'bg-red-500/85 text-white'}`}>
          {framing.level === 'good' ? '✓ ' : '⚠ '}{framing.message}
        </span>
      </>
    );
    const controls = (
      <button onClick={scanColors}
        className="px-6 h-14 rounded-full text-base font-black bg-amber-500 text-slate-950 active:scale-95 shadow-lg">
        🎨 원판 색 인식
      </button>
    );
    return (
      <CameraStage
        videoRef={videoRef} canvasRef={canvasRef} status={status} error={error}
        onClose={closeCam} topBar={topBar} controls={controls} tappable={false}
        recording={status === 'running'} recordingLabel="평가 중"
      >
        <div className="mx-auto max-w-md w-full bg-black/60 rounded-xl px-3 py-2 text-center">
          <p className="text-[11px] text-slate-300">인식이 잘 안 되면 [닫기] 후 무게를 직접 입력하세요.</p>
        </div>
      </CameraStage>
    );
  }

  // ───────── 입력/결과 화면 ─────────
  return (
    <div className={`space-y-4 ${embedded ? 'pt-24 px-3 max-w-md mx-auto overflow-y-auto pb-8' : ''}`} style={embedded ? { height: '100dvh' } : undefined}>
      {!embedded && (
        <div className="flex items-center justify-between">
          <button onClick={onBack} className="measure-back">← 메뉴</button>
          <h2 className="measure-title">1RM 추정</h2>
          <span className="w-12" />
        </div>
      )}

      {/* 종목 — 임베드(허브) 모드에서는 상단 허브 선택기가 담당하므로 숨김 */}
      {!embedded && (
        <div className="flex gap-1 rounded-xl bg-slate-800 p-1">
          {LIFTS.map(l => (
            <button key={l.key} onClick={() => { setLift(l.key); setResult(null); }}
              className={`flex-1 rounded-lg py-1.5 text-xs font-bold ${lift === l.key ? 'bg-amber-500 text-slate-950' : 'text-slate-400'}`}>
              {l.label}
            </button>
          ))}
        </div>
      )}

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
        /* ── 직접 입력(기본) ── */
        <div>
          <label className="block text-xs font-semibold text-slate-400 uppercase tracking-widest mb-1.5">든 무게 (kg)</label>
          <input type="number" step="2.5" value={manualWeight} onChange={e => setManualWeight(e.target.value)}
            placeholder="80" className="input-mono" />
        </div>
      ) : (
        /* ── 원판 색 인식(보조) + 수동 확인 ── */
        <div className="space-y-3">
          <FramingIntro
            preset={FRAMING_PRESETS[lift] || FRAMING_PRESETS.squat}
            onStart={openCam}
            startLabel="📷 카메라로 원판 색 인식 (전체화면)"
          />

          {detected.length > 0 && (
            <p className="text-[11px] text-cyan-400">
              인식된 색: {detected.map(d => `${d.label}(${Math.round(d.ratio * 100)}%)`).join(', ')} — 아래에서 장수를 확인·수정하세요.
            </p>
          )}

          {/* 봉 무게 */}
          <div>
            <label className="block text-xs font-semibold text-slate-400 uppercase tracking-widest mb-1.5">봉 무게</label>
            <select value={barKg} onChange={e => setBarKg(Number(e.target.value))} className="input">
              {BAR_WEIGHTS.map(b => <option key={b.kg} value={b.kg}>{b.label}</option>)}
            </select>
          </div>

          {/* 편측 원판 추가 */}
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

          <div className="card-accent p-3 text-center">
            <p className="text-[10px] text-slate-500">총중량 (양쪽 + 봉)</p>
            <p className="font-mono font-black text-2xl text-slate-100">{computedWeight}<span className="text-sm text-slate-500"> kg</span></p>
          </div>
        </div>
      )}

      {/* 반복 횟수 */}
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

      {result && (
        <div className="card-accent p-4 space-y-3 animate-fade-in">
          <p className="text-xs font-bold text-amber-400 uppercase tracking-widest">
            추정 1RM · {computedWeight}kg × {reps}회
          </p>
          <p className="text-center font-mono font-black text-5xl text-slate-100">
            {result.average}<span className="text-lg text-slate-500"> kg</span>
          </p>
          <p className="text-center text-[10px] text-slate-500">검증된 {result.formulas.filter(f => f.value != null).length}개 공식 평균</p>

          <div className="bg-slate-800 rounded-xl p-3">
            <p className="text-[10px] text-slate-500 mb-1.5">공식별 추정 (kg)</p>
            <div className="grid grid-cols-2 gap-1.5 text-center text-[11px]">
              {result.formulas.map(f => (
                <div key={f.key} className="flex justify-between bg-slate-900/60 rounded px-2 py-1">
                  <span className="text-slate-500">{f.label}</span>
                  <span className="font-mono font-bold text-slate-200">
                    {f.value != null ? f.value : <span className="text-slate-600">제외</span>}
                  </span>
                </div>
              ))}
            </div>
          </div>

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
        ※ 무게는 직접 입력이 가장 확실합니다. 원판 색 인식은 보조 기능으로, 조명·각도·겹침에 따라
        틀릴 수 있으니 항상 장수를 직접 확인·수정한 뒤 계산하세요. 추정식은 1~10회에서 가장 정확합니다.
      </p>
    </div>
  );
}
