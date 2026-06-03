// ai-measure/menus/PostureMeasure.jsx
// 메뉴 1: 자세·체형 측정 (앞/옆/뒤)
//  - 어깨 기울기, 골반 기울기, 중심선(코→골반중점) 기울기 측정
//  - 실시간 관절점·선 오버레이 (Canvas, React state 우회)
//  - "측정" 누르면 현재 프레임 각도를 캡처 → 결과 표시
import { useRef, useState, useEffect, useCallback } from 'react';
import { usePoseEngine } from '../core/usePoseEngine';
import { symmetryTilt, verticalDeviationDeg, midpoint, isVisible, LM } from '../core/geometry';

const VIEWS = [
  { key: 'front', label: '앞면' },
  { key: 'side',  label: '옆면' },
  { key: 'back',  label: '뒷면' },
];

// 골격 연결선 (그리기용)
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
  const latestRef = useRef(null);   // 최신 랜드마크 (고주파, state 우회)
  const liveRef   = useRef(null);   // 실시간 수치 표시용 DOM

  const [view, setView] = useState('front');
  const [captured, setCaptured] = useState(null); // 캡처된 측정 결과

  // 매 프레임: 캔버스에 그리고, 실시간 각도를 DOM 에 직접 주입
  const handleResult = useCallback((lms, ts, video) => {
    latestRef.current = lms;
    const canvas = canvasRef.current;
    if (!canvas || !video) return;
    const cw = canvas.width, ch = canvas.height;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, cw, ch);
    if (!lms) return;

    // 관절선
    ctx.strokeStyle = 'rgba(245,158,11,0.9)';
    ctx.lineWidth = 3;
    for (const [a, b] of BONES) {
      if (isVisible(lms[a]) && isVisible(lms[b])) {
        ctx.beginPath();
        ctx.moveTo(lms[a].x * cw, lms[a].y * ch);
        ctx.lineTo(lms[b].x * cw, lms[b].y * ch);
        ctx.stroke();
      }
    }
    // 관절점
    ctx.fillStyle = '#22d3ee';
    for (const lm of lms) {
      if (isVisible(lm)) {
        ctx.beginPath();
        ctx.arc(lm.x * cw, lm.y * ch, 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // 실시간 수치 (state 우회)
    const sh = symmetryTilt(lms[LM.LEFT_SHOULDER], lms[LM.RIGHT_SHOULDER]);
    const hip = symmetryTilt(lms[LM.LEFT_HIP], lms[LM.RIGHT_HIP]);
    if (liveRef.current) {
      liveRef.current.textContent =
        `어깨 ${sh ? sh.deg + '°' : '-'}  |  골반 ${hip ? hip.deg + '°' : '-'}`;
    }
  }, []);

  const { videoRef, start, stop, status, error } = usePoseEngine({ onResult: handleResult });

  // 비디오 크기에 맞춰 캔버스 동기화
  const syncCanvas = useCallback(() => {
    const v = videoRef.current, c = canvasRef.current;
    if (v && c && v.videoWidth) { c.width = v.videoWidth; c.height = v.videoHeight; }
  }, [videoRef]);

  useEffect(() => {
    const v = videoRef.current;
    if (v) v.addEventListener('loadedmetadata', syncCanvas);
    return () => { if (v) v.removeEventListener('loadedmetadata', syncCanvas); stop(); };
  }, [videoRef, syncCanvas, stop]);

  // 현재 프레임 캡처 → 측정값 산출
  const capture = () => {
    const lms = latestRef.current;
    if (!lms) return;
    const shoulder = symmetryTilt(lms[LM.LEFT_SHOULDER], lms[LM.RIGHT_SHOULDER]);
    const hip = symmetryTilt(lms[LM.LEFT_HIP], lms[LM.RIGHT_HIP]);
    const shMid = midpoint(lms[LM.LEFT_SHOULDER], lms[LM.RIGHT_SHOULDER]);
    const hipMid = midpoint(lms[LM.LEFT_HIP], lms[LM.RIGHT_HIP]);
    const centerline = verticalDeviationDeg(shMid, hipMid);

    setCaptured({
      view,
      at: new Date().toISOString(),
      shoulderTilt: shoulder,
      hipTilt: hip,
      centerlineDeg: centerline,
    });
  };

  const dirText = (d) =>
    d === 'level' ? '균형' : d === 'right_low' ? '오른쪽 처짐' : d === 'left_low' ? '왼쪽 처짐' : '-';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="text-slate-400 text-sm">← 메뉴</button>
        <h2 className="text-lg font-black">자세 · 체형 측정</h2>
        <span className="w-12" />
      </div>

      {/* 촬영 방향 선택 */}
      <div className="flex gap-1 rounded-xl bg-slate-800 p-1">
        {VIEWS.map(v => (
          <button key={v.key} onClick={() => setView(v.key)}
            className={`flex-1 rounded-lg py-1.5 text-xs font-bold ${view === v.key ? 'bg-amber-500 text-slate-950' : 'text-slate-400'}`}>
            {v.label}
          </button>
        ))}
      </div>

      {/* 카메라 + 오버레이 */}
      <div className="relative w-full rounded-2xl overflow-hidden bg-black aspect-[3/4]">
        <video ref={videoRef} autoPlay playsInline muted
          className="absolute inset-0 w-full h-full object-contain" />
        <canvas ref={canvasRef}
          className="absolute inset-0 w-full h-full object-contain pointer-events-none" />
        {status !== 'running' && (
          <div className="absolute inset-0 flex items-center justify-center text-slate-400 text-sm">
            {status === 'loading' ? 'AI 모델 로딩 중…' :
             status === 'error' ? `오류: ${error}` :
             '아래 버튼으로 카메라를 시작하세요'}
          </div>
        )}
      </div>

      {/* 실시간 수치 */}
      <div className="rounded-xl bg-slate-900 border border-slate-800 p-3 text-center">
        <p className="text-[10px] text-slate-500 uppercase tracking-widest mb-1">실시간</p>
        <p ref={liveRef} className="font-mono font-black text-amber-400">어깨 -  |  골반 -</p>
      </div>

      {/* 컨트롤 */}
      <div className="grid grid-cols-2 gap-2">
        {status !== 'running' ? (
          <button onClick={() => start()} className="col-span-2 rounded-xl bg-amber-500 text-slate-950 font-bold py-3 text-sm">
            카메라 시작
          </button>
        ) : (
          <>
            <button onClick={() => stop()} className="rounded-xl border border-slate-700 text-slate-300 font-bold py-3 text-sm">
              정지
            </button>
            <button onClick={capture} className="rounded-xl bg-amber-500 text-slate-950 font-bold py-3 text-sm">
              측정 캡처
            </button>
          </>
        )}
      </div>

      {/* 캡처 결과 */}
      {captured && (
        <div className="rounded-2xl bg-slate-900 border border-amber-500/30 p-4 space-y-3 animate-fade-in">
          <p className="text-xs font-bold text-amber-400 uppercase tracking-widest">
            측정 결과 ({VIEWS.find(v => v.key === captured.view)?.label})
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
          {onSave && (
            <button onClick={() => onSave(captured)}
              className="w-full rounded-xl bg-amber-500 text-slate-950 font-bold py-2.5 text-sm">
              이 측정 저장
            </button>
          )}
        </div>
      )}

      <p className="text-[11px] text-slate-500 leading-relaxed">
        ※ 측정 정확도는 촬영 거리·각도·조명에 영향받습니다. 전신이 화면에 들어오도록
        2~3m 거리에서 카메라를 수평으로 고정하세요.
      </p>
    </div>
  );
}
