// ai-measure/menus/PostureMeasure.jsx
// 메뉴 1: 자세·체형 측정 (앞/옆/뒤 방향별 전문 분석)
//  - 지면선: 슬라이더로 높이 조정, 화면 고정(측정 거리 기준)
//  - 십자선: 카메라 높이·위치 기준(고정)
//  - 앞면: 양발 중앙 기준 · 어깨/골반 기울기
//  - 옆면: 좌/우 선택 · 발목 수직 기준선 · 발목→무릎→고관절→장골능→어깨→귀 스켈레톤
//          · 기준선 대비 cm 편차(키 기반) · 골반 전/후방경사
//  - 뒷면: 양발 중앙 기준 · 어깨 기울기
//  - 갤럭시 스타일 셔터 버튼
import { useRef, useState, useEffect, useCallback } from 'react';
import { usePoseEngine } from '../core/usePoseEngine';
import {
  symmetryTilt, midpoint, isVisible, LM,
  horizontalOffset, offsetToCm, pelvicTilt, estimateIliac, classifyAlignment,
} from '../core/geometry';
import { drawGuides } from '../core/cameraGuide';
import { createSmoother } from '../core/smoothing';

const VIEWS = [
  { key: 'front', label: '앞면' },
  { key: 'side',  label: '옆면' },
  { key: 'back',  label: '뒷면' },
];

// 앞/뒤 스켈레톤(관상면)
const BONES_CORONAL = [
  [LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER],
  [LM.LEFT_HIP, LM.RIGHT_HIP],
  [LM.LEFT_SHOULDER, LM.LEFT_HIP], [LM.RIGHT_SHOULDER, LM.RIGHT_HIP],
  [LM.LEFT_SHOULDER, LM.LEFT_ELBOW], [LM.LEFT_ELBOW, LM.LEFT_WRIST],
  [LM.RIGHT_SHOULDER, LM.RIGHT_ELBOW], [LM.RIGHT_ELBOW, LM.RIGHT_WRIST],
  [LM.LEFT_HIP, LM.LEFT_KNEE], [LM.LEFT_KNEE, LM.LEFT_ANKLE],
  [LM.RIGHT_HIP, LM.RIGHT_KNEE], [LM.RIGHT_KNEE, LM.RIGHT_ANKLE],
];

export default function PostureMeasure({ member, onSave, onBack }) {
  const canvasRef = useRef(null);
  const latestRef = useRef(null);
  const liveRef   = useRef(null);
  const smootherRef = useRef(createSmoother(0.4));
  const groundRef = useRef(0.85);   // 지면선 높이(고정, 슬라이더로만 변경)
  const sideRef   = useRef('right'); // 옆면 바라보는 방향

  const [step, setStep] = useState('measuring');
  const [viewIdx, setViewIdx] = useState(0);
  const [captured, setCaptured] = useState(null);
  const [results, setResults] = useState([]);
  const [aspect, setAspect] = useState('3/4');
  const [groundY, setGroundY] = useState(0.85);   // 지면선(0~1) — 고정, 슬라이더로 조정
  const [side, setSide] = useState('right');       // 옆면 방향
  const [heightCm, setHeightCm] = useState(member?.height || '');
  const view = VIEWS[viewIdx];

  useEffect(() => { groundRef.current = groundY; }, [groundY]);
  useEffect(() => { sideRef.current = side; }, [side]);

  // 사람 화면상 신장(머리~발목 y폭)
  const personHeightRatio = (lms) => {
    const top = lms[LM.LEFT_EAR] || lms[LM.RIGHT_EAR] || lms[LM.NOSE];
    const ankles = [lms[LM.LEFT_ANKLE], lms[LM.RIGHT_ANKLE]].filter(p => p);
    if (!top || !ankles.length) return null;
    const botY = Math.max(...ankles.map(a => a.y));
    return Math.abs(botY - top.y);
  };

  const handleResult = useCallback((rawLms, ts, video) => {
    const lms = smootherRef.current(rawLms);
    latestRef.current = lms;
    const canvas = canvasRef.current;
    if (!canvas || !video) return;
    const cw = canvas.width, ch = canvas.height;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, cw, ch);

    const vKey = VIEWS[viewIdxRef.current].key;

    // 지면선: 고정값(groundRef) 사용 — 자동 이동 안 함
    drawGuides(ctx, cw, ch, { groundY: groundRef.current });

    if (!lms) return;

    if (vKey === 'side') {
      drawSideSkeleton(ctx, cw, ch, lms, sideRef.current);
    } else {
      drawCoronalSkeleton(ctx, cw, ch, lms);
    }

    // 실시간 수치
    if (liveRef.current) {
      if (vKey === 'side') {
        const ankle = sideRef.current === 'right' ? lms[LM.RIGHT_ANKLE] : lms[LM.LEFT_ANKLE];
        const ear   = sideRef.current === 'right' ? lms[LM.RIGHT_EAR]   : lms[LM.LEFT_EAR];
        const off = ankle && ear ? horizontalOffset(ear, ankle.x) : null;
        liveRef.current.textContent = off != null
          ? `귀-발목 수평편차 ${(off * 100).toFixed(1)}%` : '발목·귀가 보이게 서세요';
      } else {
        const sh = symmetryTilt(lms[LM.LEFT_SHOULDER], lms[LM.RIGHT_SHOULDER]);
        const hip = symmetryTilt(lms[LM.LEFT_HIP], lms[LM.RIGHT_HIP]);
        liveRef.current.textContent =
          `어깨 ${sh ? sh.deg + '°' : '-'}  |  골반 ${hip ? hip.deg + '°' : '-'}`;
      }
    }
  }, []);

  // viewIdx 를 ref 로도 들고 있어 콜백에서 최신값 사용
  const viewIdxRef = useRef(0);
  useEffect(() => { viewIdxRef.current = viewIdx; }, [viewIdx]);

  const { videoRef, start, stop, status, error } = usePoseEngine({ onResult: handleResult });

  const syncCanvas = useCallback(() => {
    const v = videoRef.current, c = canvasRef.current;
    if (v && c && v.videoWidth) { c.width = v.videoWidth; c.height = v.videoHeight; }
  }, [videoRef]);

  useEffect(() => {
    const v = videoRef.current;
    if (v) v.addEventListener('loadedmetadata', syncCanvas);
    return () => { if (v) v.removeEventListener('loadedmetadata', syncCanvas); stop(); };
  }, [videoRef, syncCanvas, stop]);

  // 측정 캡처 → 결과 화면
  const capture = () => {
    const lms = latestRef.current;
    if (!lms) { alert('인식된 자세가 없습니다. 전신이 보이게 한 뒤 다시 시도하세요.'); return; }
    let result = { view: view.key, viewLabel: view.label, at: new Date().toISOString() };

    if (view.key === 'side') {
      const isR = side === 'right';
      const ankle = isR ? lms[LM.RIGHT_ANKLE] : lms[LM.LEFT_ANKLE];
      const knee  = isR ? lms[LM.RIGHT_KNEE]  : lms[LM.LEFT_KNEE];
      const hip   = isR ? lms[LM.RIGHT_HIP]   : lms[LM.LEFT_HIP];
      const shoulder = isR ? lms[LM.RIGHT_SHOULDER] : lms[LM.LEFT_SHOULDER];
      const ear   = isR ? lms[LM.RIGHT_EAR]   : lms[LM.LEFT_EAR];
      const hipMid = midpoint(lms[LM.LEFT_HIP], lms[LM.RIGHT_HIP]);
      const shMid  = midpoint(lms[LM.LEFT_SHOULDER], lms[LM.RIGHT_SHOULDER]);
      const iliac = estimateIliac(hipMid, shMid);
      const refX = ankle ? ankle.x : null;       // 발목 수직 기준선
      const pxH = personHeightRatio(lms);
      const H = Number(heightCm) || null;

      const offCm = (pt) => {
        if (!pt || refX == null) return null;
        return offsetToCm(horizontalOffset(pt, refX), pxH, H);
      };
      result.side = side;
      result.earOffsetCm = offCm(ear);          // 귀(forward head)
      result.shoulderOffsetCm = offCm(shoulder);
      result.hipOffsetCm = offCm(hip);
      result.kneeOffsetCm = offCm(knee);
      result.pelvic = iliac && hip ? pelvicTilt(iliac, hip, isR) : null;
      result.heightCm = H;
    } else {
      result.shoulderTilt = symmetryTilt(lms[LM.LEFT_SHOULDER], lms[LM.RIGHT_SHOULDER]);
      if (view.key === 'front') {
        result.hipTilt = symmetryTilt(lms[LM.LEFT_HIP], lms[LM.RIGHT_HIP]);
      }
    }
    setCaptured(result);
    stop();
    setStep('result');
  };

  const goNext = () => { setResults(upsertResult(results, captured)); setViewIdx(viewIdx + 1); setCaptured(null); setStep('measuring'); };
  const retry  = () => { setCaptured(null); setStep('measuring'); };
  const finish = () => {
    const merged = upsertResult(results, captured);
    if (onSave && merged.length) {
      const primary = merged.find(r => r.view === 'front') || merged[0];
      onSave({ ...primary, allViews: merged });
    }
    onBack && onBack();
  };

  const isLast = viewIdx >= VIEWS.length - 1;
  const dirText = (d) => d === 'level' ? '균형' : d === 'right_low' ? '오른쪽이 낮음(화면 기준)' : d === 'left_low' ? '왼쪽이 낮음(화면 기준)' : '-';
  const cmText = (cm) => cm == null ? '-' : `${cm > 0 ? '앞' : cm < 0 ? '뒤' : ''} ${Math.abs(cm)}cm`;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="measure-back">← 메뉴</button>
        <h2 className="measure-title">자세 · 체형 측정</h2>
        <span className="w-12" />
      </div>

      {/* 진행: 앞 → 옆 → 뒤 */}
      <div className="flex gap-1 rounded-xl bg-slate-800 p-1">
        {VIEWS.map((v, i) => (
          <div key={v.key}
            className={`flex-1 rounded-lg py-1.5 text-xs font-bold text-center
              ${i === viewIdx ? 'bg-amber-500 text-slate-950'
              : results.some(r => r.view === v.key) ? 'text-emerald-400' : 'text-slate-500'}`}>
            {results.some(r => r.view === v.key) ? '✓ ' : ''}{v.label}
          </div>
        ))}
      </div>

      {step === 'measuring' && (
        <>
          {/* 옆면 좌/우 선택 + 키 입력 */}
          {view.key === 'side' && (
            <div className="flex items-center gap-2">
              <div className="flex gap-1 rounded-lg bg-slate-800 p-0.5">
                {[['right','오른쪽'],['left','왼쪽']].map(([k,l])=>(
                  <button key={k} onClick={()=>setSide(k)}
                    className={`px-2.5 py-1 rounded text-[11px] font-bold ${side===k?'bg-amber-500 text-slate-950':'text-slate-400'}`}>
                    {l}을 카메라로
                  </button>
                ))}
              </div>
              <div className="flex flex-col">
                <input type="number" value={heightCm} onChange={e=>setHeightCm(e.target.value)}
                  placeholder="키(cm)" className="w-24 bg-slate-800 border border-slate-700 text-slate-100 rounded-lg px-2 py-1 text-xs font-mono"/>
                {member?.height && Number(heightCm)===Number(member.height) && (
                  <span className="text-[9px] text-emerald-400 mt-0.5">기록에서 불러옴</span>
                )}
              </div>
            </div>
          )}

          {/* 비율 선택 (줌 제거 — 좌표 정확도 우선) */}
          <div className="flex gap-1 rounded-lg bg-slate-800 p-0.5 w-fit">
            {['3/4','1/1'].map(r=>(
              <button key={r} onClick={()=>setAspect(r)}
                className={`px-3 py-1 rounded text-[11px] font-bold ${aspect===r?'bg-amber-500 text-slate-950':'text-slate-400'}`}>
                {r==='3/4'?'3:4':'1:1'}
              </button>
            ))}
          </div>

          <div className="relative w-full rounded-2xl overflow-hidden bg-black mx-auto"
            style={{aspectRatio:aspect.replace('/',' / '), maxHeight:'58vh'}}>
            <video ref={videoRef} autoPlay playsInline muted
              className="absolute inset-0 w-full h-full object-contain" />
            <canvas ref={canvasRef}
              className="absolute inset-0 w-full h-full object-contain pointer-events-none" />
            {status !== 'running' && (
              <div className="absolute inset-0 flex items-center justify-center text-slate-400 text-sm text-center px-4">
                {status === 'loading' ? 'AI 모델 로딩 중…'
                  : status === 'error' ? `오류: ${error}`
                  : `[${view.label}] 카메라를 시작하세요`}
              </div>
            )}
            {status === 'running' && (
              <>
                {/* 상단 안내 — 한 줄, 작게 */}
                <div className="absolute top-2 left-2 right-2 flex items-center justify-between gap-2">
                  <span className="bg-black/65 rounded-full px-2.5 py-1 text-[10px] text-cyan-300 font-bold truncate">
                    {view.label} · 지면선=발끝, 십자선=중앙
                  </span>
                  <span ref={liveRef} className="bg-black/65 rounded-full px-2.5 py-1 text-[11px] text-amber-400 font-mono font-bold whitespace-nowrap">
                    측정 준비
                  </span>
                </div>
                {/* 갤럭시 스타일 셔터 */}
                <div className="absolute bottom-4 left-0 right-0 flex items-center justify-center gap-8">
                  <button onClick={() => stop()}
                    className="w-11 h-11 rounded-full bg-black/50 border border-white/30 text-white text-xs font-bold backdrop-blur-sm active:scale-90 transition-transform">
                    정지
                  </button>
                  <button onClick={capture} aria-label="측정 캡처"
                    className="w-[72px] h-[72px] rounded-full bg-white/95 ring-4 ring-white/40 shadow-2xl active:scale-90 transition-transform flex items-center justify-center">
                    <span className="w-14 h-14 rounded-full bg-white border-2 border-slate-300" />
                  </button>
                  <div className="w-11 h-11" />
                </div>
              </>
            )}
          </div>

          {/* 지면선 높이 슬라이더 (고정·수동조정) */}
          {status === 'running' && (
            <div className="flex items-center gap-2 bg-slate-900 border border-slate-800 rounded-xl px-3 py-2">
              <span className="text-[11px] text-emerald-400 font-bold whitespace-nowrap">지면선 높이</span>
              <input type="range" min="0.5" max="0.98" step="0.01" value={groundY}
                onChange={e=>setGroundY(Number(e.target.value))} className="flex-1 accent-emerald-500"/>
              <span className="text-[11px] text-slate-500">발끝에 맞추기</span>
            </div>
          )}

          {status !== 'running' && (
            <button onClick={() => start()} className="btn btn-primary w-full">
              카메라 시작
            </button>
          )}

          <p className="text-[11px] text-slate-500 leading-relaxed">
            ※ <span className="text-emerald-400 font-bold">지면선</span>은 측정 거리 기준입니다(슬라이더로 발끝 높이에 고정).
            십자선은 카메라 높이·위치 기준입니다. 옆면은 발목 수직선 기준으로 분석하며 키를 입력하면 cm 편차가 나옵니다.
          </p>
        </>
      )}

      {/* 결과 화면 */}
      {step === 'result' && captured && (
        <div className="space-y-4 animate-fade-in">
          <div className="rounded-2xl bg-slate-900 border border-amber-500/30 p-4 space-y-3">
            <p className="text-xs font-bold text-amber-400 uppercase tracking-widest">측정 결과 · {captured.viewLabel}{captured.side?` (${captured.side==='right'?'오른쪽':'왼쪽'})`:''}</p>

            {captured.view === 'side' ? (
              <>
                {[
                  ['귀 (머리)', 'ear', captured.earOffsetCm],
                  ['어깨', 'shoulder', captured.shoulderOffsetCm],
                  ['고관절', 'hip', captured.hipOffsetCm],
                  ['무릎', 'knee', captured.kneeOffsetCm],
                ].map(([label, part, cm]) => {
                  const cls = classifyAlignment(part, cm);
                  const color = !cls ? 'text-slate-500'
                    : cls.status === 'normal' ? 'text-emerald-400' : 'text-amber-400';
                  return (
                    <div key={label} className="flex items-center justify-between bg-slate-800 rounded-xl px-3 py-2">
                      <span className="text-xs text-slate-400">{label} · 발목선 대비</span>
                      <span className="text-right">
                        <span className="font-mono font-black text-sm text-slate-100">{cmText(cm)}</span>
                        {cls && <span className={`block text-[10px] font-bold ${color}`}>{cls.note}</span>}
                      </span>
                    </div>
                  );
                })}
                <div className="flex items-center justify-between bg-slate-800 rounded-xl px-3 py-2">
                  <span className="text-xs text-slate-400">골반 경사</span>
                  <span className="font-mono font-black text-sm">
                    {captured.pelvic ? `${captured.pelvic.deg}° · ${captured.pelvic.type==='anterior'?'전방경사':captured.pelvic.type==='posterior'?'후방경사':'중립'}` : '-'}
                  </span>
                </div>
                <p className="text-[10px] text-slate-500 leading-relaxed">
                  ※ Kendall 기준: 귀·어깨는 기준선 통과, 고관절 약간 뒤, 무릎 약간 앞이 정상.
                  10mm 이상 편차가 임상적으로 유의합니다. 발목 기준선은 외측복사 약간 앞에 둡니다.
                </p>
                {!captured.heightCm && <p className="text-[11px] text-amber-400/80">※ 키 미입력 — cm 추정이 불가합니다. 키를 입력하고 다시 측정하세요.</p>}
              </>
            ) : (
              <>
                {(() => {
                  const t = captured.shoulderTilt;
                  const sig = t && t.deg >= 2; // 2° 이상이면 유의(좌우 비대칭)
                  return (
                    <div className="flex items-center justify-between bg-slate-800 rounded-xl px-3 py-2">
                      <span className="text-xs text-slate-400">어깨 기울기 (좌우 수평)</span>
                      <span className="text-right">
                        <span className="font-mono font-black text-sm text-slate-100">{t ? `${t.deg}°` : '측정 불가'}</span>
                        {t && <span className={`block text-[10px] font-bold ${sig?'text-amber-400':'text-emerald-400'}`}>{sig?dirText(t.direction):'정상 범위'}</span>}
                      </span>
                    </div>
                  );
                })()}
                {captured.view === 'front' && (() => {
                  const t = captured.hipTilt;
                  const sig = t && t.deg >= 2;
                  return (
                    <div className="flex items-center justify-between bg-slate-800 rounded-xl px-3 py-2">
                      <span className="text-xs text-slate-400">골반 기울기 (좌우 수평)</span>
                      <span className="text-right">
                        <span className="font-mono font-black text-sm text-slate-100">{t ? `${t.deg}°` : '측정 불가'}</span>
                        {t && <span className={`block text-[10px] font-bold ${sig?'text-amber-400':'text-emerald-400'}`}>{sig?dirText(t.direction):'정상 범위'}</span>}
                      </span>
                    </div>
                  );
                })()}
                <p className="text-[10px] text-slate-500 leading-relaxed">
                  ※ {captured.view==='front'?'앞면':'뒷면'}: 양발 중앙 기준선으로 좌우 대칭(어깨{captured.view==='front'?'·골반':''} 높이 차)을 봅니다. 2° 이상이면 좌우 비대칭으로 봅니다.
                </p>
              </>
            )}
          </div>

          <div className="grid grid-cols-3 gap-2">
            <button onClick={retry} className="rounded-xl border border-slate-700 text-slate-300 font-bold py-3 text-xs">재측정</button>
            {!isLast ? (
              <button onClick={goNext} className="rounded-xl bg-slate-700 text-white font-bold py-3 text-xs">다음 ({VIEWS[viewIdx + 1].label})</button>
            ) : (
              <div className="rounded-xl border border-slate-800 text-slate-600 font-bold py-3 text-xs text-center flex items-center justify-center">마지막</div>
            )}
            <button onClick={finish} className="rounded-xl bg-amber-500 text-slate-950 font-bold py-3 text-xs">종료(적용)</button>
          </div>
        </div>
      )}
    </div>
  );
}

// 앞/뒤 스켈레톤 그리기
function drawCoronalSkeleton(ctx, cw, ch, lms) {
  ctx.strokeStyle = 'rgba(245,158,11,0.9)'; ctx.lineWidth = 3;
  for (const [a, b] of BONES_CORONAL) {
    if (isVisible(lms[a], 0.3) && isVisible(lms[b], 0.3)) {
      ctx.beginPath(); ctx.moveTo(lms[a].x*cw, lms[a].y*ch); ctx.lineTo(lms[b].x*cw, lms[b].y*ch); ctx.stroke();
    }
  }
  ctx.fillStyle = '#22d3ee';
  for (const lm of lms) if (isVisible(lm, 0.3)) { ctx.beginPath(); ctx.arc(lm.x*cw, lm.y*ch, 4, 0, Math.PI*2); ctx.fill(); }
}

// 옆면 스켈레톤: 발목→무릎→고관절→장골능→어깨→귀 + 발목 수직 기준선
function drawSideSkeleton(ctx, cw, ch, lms, side) {
  const isR = side === 'right';
  const ankle = isR ? lms[LM.RIGHT_ANKLE] : lms[LM.LEFT_ANKLE];
  const knee  = isR ? lms[LM.RIGHT_KNEE]  : lms[LM.LEFT_KNEE];
  const hip   = isR ? lms[LM.RIGHT_HIP]   : lms[LM.LEFT_HIP];
  const shoulder = isR ? lms[LM.RIGHT_SHOULDER] : lms[LM.LEFT_SHOULDER];
  const ear   = isR ? lms[LM.RIGHT_EAR]   : lms[LM.LEFT_EAR];
  const hipMid = midpoint(lms[LM.LEFT_HIP], lms[LM.RIGHT_HIP]);
  const shMid  = midpoint(lms[LM.LEFT_SHOULDER], lms[LM.RIGHT_SHOULDER]);
  const iliac = estimateIliac(hipMid, shMid);

  // 발목 수직 기준선(보라)
  if (ankle) {
    ctx.strokeStyle = 'rgba(167,139,250,0.85)'; ctx.lineWidth = 2; ctx.setLineDash([8,6]);
    ctx.beginPath(); ctx.moveTo(ankle.x*cw, 0); ctx.lineTo(ankle.x*cw, ch); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(167,139,250,0.95)';
    ctx.font = `${Math.round(ch*0.02)}px sans-serif`;
    ctx.fillText('기준선(외측복사 앞)', ankle.x*cw + 6, 18);
  }

  // 체인 연결선(주황)
  const chain = [ankle, knee, hip, iliac, shMid, ear].filter(p => p);
  ctx.strokeStyle = 'rgba(245,158,11,0.95)'; ctx.lineWidth = 3;
  ctx.beginPath();
  chain.forEach((p, i) => { const x=p.x*cw, y=p.y*ch; i? ctx.lineTo(x,y): ctx.moveTo(x,y); });
  ctx.stroke();

  // 관절점(청록) + 라벨
  const pts = [[ankle,'발목'],[knee,'무릎'],[hip,'고관절'],[iliac,'장골능'],[shMid,'어깨'],[ear,'귀']];
  ctx.fillStyle = '#22d3ee';
  for (const [p] of pts) if (p) { ctx.beginPath(); ctx.arc(p.x*cw, p.y*ch, 5, 0, Math.PI*2); ctx.fill(); }
}

function upsertResult(list, item) {
  if (!item) return list;
  return [...list.filter(r => r.view !== item.view), item];
}
