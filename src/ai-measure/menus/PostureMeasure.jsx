// ai-measure/menus/PostureMeasure.jsx
// 메뉴 1: 자세·체형 측정 (앞→옆→뒤 순서 흐름)
//  - 측정 캡처 → 결과 전용 화면으로 전환 (요청1)
//  - 결과 화면: [재측정](현재 방향) / [다음](다음 방향) / [종료(적용)](저장) (요청2)
//  - 카메라 화면에 수평·수직 가이드라인 오버레이 (요청3)
import { useRef, useState, useEffect, useCallback } from 'react';
import { usePoseEngine } from '../core/usePoseEngine';
import { symmetryTilt, verticalDeviationDeg, midpoint, isVisible, LM } from '../core/geometry';
import { drawGuides } from '../core/cameraGuide';
import { createSmoother } from '../core/smoothing';

const VIEWS = [
  { key: 'front', label: '앞면' },
  { key: 'side',  label: '옆면' },
  { key: 'back',  label: '뒷면' },
];

const BONES = [
  [LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER],
  [LM.LEFT_HIP, LM.RIGHT_HIP],
  [LM.LEFT_SHOULDER, LM.LEFT_HIP],
  [LM.RIGHT_SHOULDER, LM.RIGHT_HIP],
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

  // step: 'measuring'(카메라) | 'result'(캡처 결과)
  const [step, setStep] = useState('measuring');
  const [viewIdx, setViewIdx] = useState(0);          // 현재 방향(0앞 1옆 2뒤)
  const [captured, setCaptured] = useState(null);     // 현재 방향 결과
  const [results, setResults] = useState([]);         // 누적 결과(방향별)
  const view = VIEWS[viewIdx];

  const handleResult = useCallback((rawLms, ts, video) => {
    // 떨림 완화: 임계값으로 버리지 않고 위치를 부드럽게(요청5)
    const lms = smootherRef.current(rawLms);
    latestRef.current = lms;
    const canvas = canvasRef.current;
    if (!canvas || !video) return;
    const cw = canvas.width, ch = canvas.height;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, cw, ch);

    // 발(발목/뒤꿈치/발끝) 기준 지면선 — 가시성 낮아도 표시(요청4)
    let groundY = null;
    if (lms) {
      const feet = [lms[LM.LEFT_HEEL], lms[LM.RIGHT_HEEL], lms[LM.LEFT_FOOT], lms[LM.RIGHT_FOOT],
                    lms[LM.LEFT_ANKLE], lms[LM.RIGHT_ANKLE]]
                    .filter(p => p && (p.visibility == null || p.visibility >= 0.3));
      if (feet.length) groundY = Math.max(...feet.map(p => p.y));
    }
    drawGuides(ctx, cw, ch, { groundY });

    if (!lms) return;
    // 관절선 — 임계 0.3(다리 유지). 스무딩으로 떨림은 이미 완화됨
    ctx.strokeStyle = 'rgba(245,158,11,0.9)';
    ctx.lineWidth = 3;
    for (const [a, b] of BONES) {
      if (isVisible(lms[a], 0.3) && isVisible(lms[b], 0.3)) {
        ctx.beginPath();
        ctx.moveTo(lms[a].x * cw, lms[a].y * ch);
        ctx.lineTo(lms[b].x * cw, lms[b].y * ch);
        ctx.stroke();
      }
    }
    ctx.fillStyle = '#22d3ee';
    for (const lm of lms) {
      if (isVisible(lm, 0.3)) {
        ctx.beginPath();
        ctx.arc(lm.x * cw, lm.y * ch, 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    const sh = symmetryTilt(lms[LM.LEFT_SHOULDER], lms[LM.RIGHT_SHOULDER]);
    const hip = symmetryTilt(lms[LM.LEFT_HIP], lms[LM.RIGHT_HIP]);
    if (liveRef.current) {
      liveRef.current.textContent =
        `어깨 ${sh ? sh.deg + '°' : '-'}  |  골반 ${hip ? hip.deg + '°' : '-'}`;
    }
  }, []);

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

  // 측정 캡처 → 즉시 결과 화면으로 전환 (요청1)
  const capture = () => {
    const lms = latestRef.current;
    if (!lms) { alert('인식된 자세가 없습니다. 전신이 화면에 보이게 한 뒤 다시 시도하세요.'); return; }
    const shoulder = symmetryTilt(lms[LM.LEFT_SHOULDER], lms[LM.RIGHT_SHOULDER]);
    const hip = symmetryTilt(lms[LM.LEFT_HIP], lms[LM.RIGHT_HIP]);
    const shMid = midpoint(lms[LM.LEFT_SHOULDER], lms[LM.RIGHT_SHOULDER]);
    const hipMid = midpoint(lms[LM.LEFT_HIP], lms[LM.RIGHT_HIP]);
    const centerline = verticalDeviationDeg(shMid, hipMid);
    setCaptured({
      view: view.key,
      viewLabel: view.label,
      at: new Date().toISOString(),
      shoulderTilt: shoulder,
      hipTilt: hip,
      centerlineDeg: centerline,
    });
    stop();              // 카메라 정지
    setStep('result');
  };

  // 다음 방향으로
  const goNext = () => {
    const merged = upsertResult(results, captured);
    setResults(merged);
    setViewIdx(viewIdx + 1);
    setCaptured(null);
    setStep('measuring');
  };
  // 현재 방향 재측정
  const retry = () => {
    setCaptured(null);
    setStep('measuring');
  };
  // 종료(적용): 누적 저장 후 메뉴로
  const finish = () => {
    const merged = upsertResult(results, captured);
    if (onSave && merged.length) {
      const primary = merged.find(r => r.view === 'front') || merged[0];
      onSave({ ...primary, allViews: merged });
    }
    onBack && onBack();
  };

  const isLast = viewIdx >= VIEWS.length - 1;
  const dirText = (d) =>
    d === 'level' ? '균형' : d === 'right_low' ? '오른쪽 처짐' : d === 'left_low' ? '왼쪽 처짐' : '-';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="text-slate-400 text-sm">← 메뉴</button>
        <h2 className="text-lg font-black">자세 · 체형 측정</h2>
        <span className="w-12" />
      </div>

      {/* 진행 표시: 앞 → 옆 → 뒤 */}
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

      {/* ── 측정 화면 ── */}
      {step === 'measuring' && (
        <>
          <div className="relative w-full rounded-2xl overflow-hidden bg-black" style={{height:'60vh'}}>
            <video ref={videoRef} autoPlay playsInline muted
              className="absolute inset-0 w-full h-full object-contain" />
            <canvas ref={canvasRef}
              className="absolute inset-0 w-full h-full object-contain pointer-events-none" />
            {status !== 'running' && (
              <div className="absolute inset-0 flex items-center justify-center text-slate-400 text-sm text-center px-4">
                {status === 'loading' ? 'AI 모델 로딩 중…'
                  : status === 'error' ? `오류: ${error}`
                  : `[${view.label}] 측정 — 카메라를 시작하세요`}
              </div>
            )}
            {status === 'running' && (
              <>
                {/* 상단 안내 */}
                <div className="absolute top-2 left-1/2 -translate-x-1/2 bg-black/60 rounded-full px-3 py-1">
                  <span className="text-[11px] text-cyan-300 font-bold">{view.label} · 중심선·지면선에 맞추세요</span>
                </div>
                {/* 실시간 수치 — 카메라 위 오버레이 */}
                <div className="absolute top-12 left-1/2 -translate-x-1/2 bg-black/55 rounded-lg px-3 py-1">
                  <span ref={liveRef} className="font-mono font-bold text-amber-400 text-sm">어깨 -  |  골반 -</span>
                </div>
                {/* 측정/정지 버튼 — 카메라 하단 오버레이(요청6: 스크롤 없이 촬영) */}
                <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-2 w-[90%]">
                  <button onClick={() => stop()}
                    className="flex-1 rounded-xl bg-black/60 border border-white/20 text-white font-bold py-3 text-sm backdrop-blur-sm active:scale-95 transition-transform">
                    정지
                  </button>
                  <button onClick={capture}
                    className="flex-[2] rounded-xl bg-amber-500 text-slate-950 font-black py-3 text-base shadow-lg active:scale-95 transition-transform">
                    📸 측정 캡처
                  </button>
                </div>
              </>
            )}
          </div>

          {status !== 'running' && (
            <button onClick={() => start()} className="w-full rounded-xl bg-amber-500 text-slate-950 font-bold py-3 text-sm">
              카메라 시작
            </button>
          )}

          <p className="text-[11px] text-slate-500 leading-relaxed">
            ※ 청록색 격자·중앙 십자선에 몸을 맞추고, 초록색 <span className="text-emerald-400 font-bold">지면선</span>이
            발끝에 오도록 카메라를 수평으로 두세요. 전신이 들어오게 2~3m 거리에서 측정합니다.
            측정 버튼은 화면 위에 있어 스크롤 없이 바로 누를 수 있습니다.
          </p>
        </>
      )}

      {/* ── 결과 화면 (요청1: 캡처 즉시 전환) ── */}
      {step === 'result' && captured && (
        <div className="space-y-4 animate-fade-in">
          <div className="rounded-2xl bg-slate-900 border border-amber-500/30 p-4 space-y-3">
            <p className="text-xs font-bold text-amber-400 uppercase tracking-widest">
              측정 결과 · {captured.viewLabel}
            </p>
            {[
              { label: '어깨 기울기', d: captured.shoulderTilt },
              { label: '골반 기울기', d: captured.hipTilt },
            ].map(row => (
              <div key={row.label} className="flex items-center justify-between bg-slate-800 rounded-xl px-3 py-2">
                <span className="text-xs text-slate-400">{row.label}</span>
                <span className="font-mono font-black text-sm">
                  {row.d ? `${row.d.deg}° · ${dirText(row.d.direction)}` : '측정 불가'}
                </span>
              </div>
            ))}
            <div className="flex items-center justify-between bg-slate-800 rounded-xl px-3 py-2">
              <span className="text-xs text-slate-400">중심선 기울기</span>
              <span className="font-mono font-black text-sm">
                {captured.centerlineDeg != null ? `${Math.abs(captured.centerlineDeg)}°` : '측정 불가'}
              </span>
            </div>
          </div>

          {/* 요청2: 재측정 / 다음 / 종료(적용) */}
          <div className="grid grid-cols-3 gap-2">
            <button onClick={retry}
              className="rounded-xl border border-slate-700 text-slate-300 font-bold py-3 text-xs">
              재측정
            </button>
            {!isLast ? (
              <button onClick={goNext}
                className="rounded-xl bg-slate-700 text-white font-bold py-3 text-xs">
                다음 ({VIEWS[viewIdx + 1].label})
              </button>
            ) : (
              <div className="rounded-xl border border-slate-800 text-slate-600 font-bold py-3 text-xs text-center flex items-center justify-center">
                마지막
              </div>
            )}
            <button onClick={finish}
              className="rounded-xl bg-amber-500 text-slate-950 font-bold py-3 text-xs">
              종료(적용)
            </button>
          </div>
          <p className="text-[11px] text-slate-500 text-center">
            다음: 다른 방향 측정 · 재측정: 현재 방향 다시 · 종료: 저장 후 메뉴로
          </p>
        </div>
      )}
    </div>
  );
}

// 같은 방향이면 교체, 아니면 추가
function upsertResult(list, item) {
  if (!item) return list;
  const rest = list.filter(r => r.view !== item.view);
  return [...rest, item];
}
