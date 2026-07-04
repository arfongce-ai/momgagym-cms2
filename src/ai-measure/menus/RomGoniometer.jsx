// ai-measure/menus/RomGoniometer.jsx
// ════════════════════════════════════════════════════════════════════════
//  [항목 4] 전자 각도기 (수동 ROM 측정)
//  자동(BlazePose) 인식이 어려운 부위·자세도 트레이너가 직접 각도를 잰다.
//
//  흐름:
//   1) 이미지 확보 — 카메라로 촬영(권장) 또는 갤러리/파일에서 업로드.
//   2) 세 점 지정 — ① 한쪽 끝 → ② 관절(꼭짓점) → ③ 다른쪽 끝 을 화면에서 탭.
//      (점을 다시 탭/드래그해 미세 조정 가능. 관절점은 항상 가운데 점.)
//   3) 각도 산출 — 세 점이 이루는 사이각(0~180°)을 실시간 표시.
//      필요 시 '보각(180−θ)'으로 토글해 굴곡/신전 정의에 맞춰 읽는다.
//
//  측정 정직성:
//   · 2D 사진 기반이므로 '측면 촬영 + 관절이 화면과 평행'일 때만 정확하다.
//     리포트/캡처에 "수동 2D 각도기 · 촬영면 주의" 표기를 남긴다(추측 아님).
//   · 세 점이 다 찍히기 전에는 각도를 숫자로 만들지 않는다(빈값 유지).
// ════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useRef, useState } from 'react';

// 세 점 사이각(가운데 b 가 꼭짓점). 화면 픽셀 좌표 기준 2D. (테스트용 export)
export function angleAt(a, b, c) {
  if (!a || !b || !c) return null;
  const v1 = { x: a.x - b.x, y: a.y - b.y };
  const v2 = { x: c.x - b.x, y: c.y - b.y };
  const m1 = Math.hypot(v1.x, v1.y);
  const m2 = Math.hypot(v2.x, v2.y);
  if (m1 < 1 || m2 < 1) return null;
  const cos = Math.max(-1, Math.min(1, (v1.x * v2.x + v1.y * v2.y) / (m1 * m2)));
  return Math.round((Math.acos(cos) * 180) / Math.PI * 10) / 10;
}

const POINT_LABELS = ['① 끝점 A', '② 관절(꼭짓점)', '③ 끝점 B'];
const POINT_COLORS = ['#38bdf8', '#f59e0b', '#34d399'];

export default function RomGoniometer({ member, jointName, onBack, onUseAngle }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const canvasRef = useRef(null);
  const imgRef = useRef(null);           // 로드된 이미지(HTMLImageElement)
  const wrapRef = useRef(null);          // 좌표 변환 기준 컨테이너

  const [stage, setStage] = useState('capture'); // capture | annotate
  const [imgUrl, setImgUrl] = useState('');
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraErr, setCameraErr] = useState('');
  const [points, setPoints] = useState([]); // [{x,y}] 픽셀(표시 좌표계)
  const [dragIdx, setDragIdx] = useState(null);
  const [supplementary, setSupplementary] = useState(false); // 보각(180−θ) 표시
  const [savedMsg, setSavedMsg] = useState('');

  // ── 카메라 시작/정지 ──
  const startCamera = useCallback(async () => {
    setCameraErr('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      setCameraOn(true);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
    } catch (e) {
      setCameraErr('카메라를 열 수 없습니다. 파일 업로드로 측정하거나 권한을 확인해 주세요.');
      setCameraOn(false);
    }
  }, []);

  const stopCamera = useCallback(() => {
    const s = streamRef.current;
    if (s) s.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraOn(false);
  }, []);

  useEffect(() => () => { stopCamera(); if (imgUrl) URL.revokeObjectURL(imgUrl); }, [stopCamera]); // eslint-disable-line react-hooks/exhaustive-deps

  // 촬영: 현재 비디오 프레임을 캡처해 주석 단계로.
  const shoot = () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const c = document.createElement('canvas');
    c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
    const url = c.toDataURL('image/jpeg', 0.92);
    stopCamera();
    loadImage(url);
  };

  // 파일 업로드
  const onFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    stopCamera();
    loadImage(url);
  };

  const loadImage = (url) => {
    if (imgUrl && imgUrl.startsWith('blob:')) URL.revokeObjectURL(imgUrl);
    setImgUrl(url);
    setPoints([]);
    setStage('annotate');
  };

  // ── 좌표 변환: 컨테이너 픽셀 → 표시 좌표(그대로 사용, 각도는 비율 무관) ──
  const eventToPoint = (evt) => {
    const wrap = wrapRef.current;
    if (!wrap) return null;
    const rect = wrap.getBoundingClientRect();
    const src = evt.touches?.[0] || evt.changedTouches?.[0] || evt;
    const x = src.clientX - rect.left;
    const y = src.clientY - rect.top;
    return { x: Math.max(0, Math.min(rect.width, x)), y: Math.max(0, Math.min(rect.height, y)) };
  };

  const nearestPointIdx = (p) => {
    let best = -1, bestD = 24; // 24px 이내면 그 점을 잡아 이동
    points.forEach((pt, i) => {
      const d = Math.hypot(pt.x - p.x, pt.y - p.y);
      if (d < bestD) { bestD = d; best = i; }
    });
    return best;
  };

  const handleDown = (evt) => {
    const p = eventToPoint(evt);
    if (!p) return;
    const hit = nearestPointIdx(p);
    if (hit >= 0) { setDragIdx(hit); return; }
    if (points.length < 3) {
      setPoints((prev) => [...prev, p]);
    } else {
      // 이미 3점 → 가장 가까운 점을 새 위치로 이동
      const idx = nearestPointIdx(p);
      if (idx >= 0) setPoints((prev) => prev.map((pt, i) => (i === idx ? p : pt)));
    }
  };
  const handleMove = (evt) => {
    if (dragIdx == null) return;
    evt.preventDefault();
    const p = eventToPoint(evt);
    if (!p) return;
    setPoints((prev) => prev.map((pt, i) => (i === dragIdx ? p : pt)));
  };
  const handleUp = () => setDragIdx(null);

  const rawAngle = points.length === 3 ? angleAt(points[0], points[1], points[2]) : null;
  const shownAngle = rawAngle == null ? null : (supplementary ? Math.round((180 - rawAngle) * 10) / 10 : rawAngle);

  const resetPoints = () => setPoints([]);
  const retake = () => {
    setPoints([]);
    setStage('capture');
    if (imgUrl && imgUrl.startsWith('blob:')) URL.revokeObjectURL(imgUrl);
    setImgUrl('');
  };

  // 각도를 리포트/기록으로 넘김(선택). 상위(RomMeasure)가 처리하지 않으면 캡처만.
  const useThisAngle = () => {
    if (shownAngle == null) return;
    onUseAngle?.({
      angle: shownAngle,
      rawAngle,
      supplementary,
      jointName,
      method: 'manual_goniometer_2d',
      snapshotUrl: imgUrl,
      note: '수동 2D 전자 각도기 — 촬영면(관절이 카메라와 평행)에서만 정확',
    });
    setSavedMsg('각도가 기록에 반영되었습니다.');
    setTimeout(() => setSavedMsg(''), 2500);
  };

  // ════════════════ 촬영/업로드 화면 ════════════════
  if (stage === 'capture') {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <button onClick={onBack} className="measure-back">← 뒤로</button>
          <h2 className="measure-title">전자 각도기 (수동)</h2>
          <span className="w-12" />
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4 space-y-3">
          <p className="text-sm font-bold text-slate-200">측정할 부위를 촬영하거나 사진을 올리세요</p>
          <p className="text-[12px] leading-relaxed text-slate-400">
            자동 인식이 어려운 손목·손가락·목·특정 자세도 직접 각도를 잴 수 있습니다.
            <span className="text-amber-300"> 관절이 카메라와 나란한 측면</span>에서 촬영해야 각도가 정확합니다.
          </p>

          {!cameraOn ? (
            <button onClick={startCamera}
              className="w-full rounded-xl bg-amber-500 px-4 py-4 text-left active:scale-[0.99] transition">
              <p className="text-base font-black text-slate-950">카메라로 촬영</p>
              <p className="mt-0.5 text-xs font-bold text-slate-900/80">부위가 화면 안에 크게 들어오게 맞추고 촬영하세요.</p>
            </button>
          ) : (
            <div className="space-y-2">
              <div className="relative overflow-hidden rounded-xl bg-black">
                <video ref={videoRef} className="w-full" playsInline muted />
              </div>
              <div className="flex gap-2">
                <button onClick={shoot}
                  className="flex-1 rounded-xl bg-amber-500 px-4 py-3 text-sm font-black text-slate-950">촬영</button>
                <button onClick={stopCamera}
                  className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-3 text-sm font-black text-slate-300">중지</button>
              </div>
            </div>
          )}
          {cameraErr && <p className="text-xs text-red-400">{cameraErr}</p>}

          <label className="block">
            <span className="text-xs font-bold text-slate-400">또는 사진 파일 업로드</span>
            <input type="file" accept="image/*" capture="environment" onChange={onFile}
              className="mt-1 block w-full text-sm text-slate-300 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-700 file:px-3 file:py-1.5 file:text-sm file:font-bold file:text-slate-100" />
          </label>
        </div>
      </div>
    );
  }

  // ════════════════ 각도 지정 화면 ════════════════
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="measure-back">← 뒤로</button>
        <h2 className="measure-title">전자 각도기</h2>
        <button onClick={retake} className="measure-back">다시 촬영</button>
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-3 space-y-3">
        <p className="text-xs font-bold text-slate-300">
          {points.length < 3
            ? `${POINT_LABELS[points.length]} 위치를 탭하세요`
            : '점을 다시 탭/드래그해 미세 조정할 수 있습니다'}
        </p>

        {/* 이미지 + 오버레이(각도기). 탭/드래그로 세 점 지정. */}
        <div
          ref={wrapRef}
          className="relative select-none overflow-hidden rounded-xl bg-black touch-none"
          onMouseDown={handleDown}
          onMouseMove={handleMove}
          onMouseUp={handleUp}
          onMouseLeave={handleUp}
          onTouchStart={handleDown}
          onTouchMove={handleMove}
          onTouchEnd={handleUp}
          style={{ cursor: 'crosshair' }}
        >
          {imgUrl && (
            <img ref={imgRef} src={imgUrl} alt="측정 대상" className="block w-full pointer-events-none" draggable={false} />
          )}
          <GoniometerOverlay points={points} angle={rawAngle} />
        </div>

        {/* 각도 리드아웃 */}
        <div className="flex items-center justify-between rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3">
          <div>
            <p className="text-[10px] font-bold text-amber-300/80 uppercase tracking-widest">
              {jointName ? `${jointName} · ` : ''}측정 각도
            </p>
            <p className="mt-0.5 text-3xl font-black tabular-nums text-amber-200">
              {shownAngle == null ? '—' : `${shownAngle}°`}
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <button onClick={() => setSupplementary((v) => !v)}
              disabled={rawAngle == null}
              className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-1.5 text-[11px] font-black text-slate-200 disabled:opacity-40">
              {supplementary ? '사이각(θ) 보기' : '보각(180−θ) 보기'}
            </button>
            <button onClick={resetPoints}
              className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-[11px] font-bold text-slate-300">
              점 초기화
            </button>
          </div>
        </div>

        {onUseAngle && (
          <button onClick={useThisAngle} disabled={shownAngle == null}
            className="w-full rounded-xl bg-amber-500 px-4 py-3 text-sm font-black text-slate-950 disabled:bg-slate-700 disabled:text-slate-400">
            이 각도 기록에 반영
          </button>
        )}
        {savedMsg && <p className="text-center text-xs font-bold text-emerald-400">{savedMsg}</p>}

        <p className="text-[11px] leading-relaxed text-slate-500">
          ※ 2D 사진 기반 수동 측정입니다. 관절이 카메라와 나란한 측면에서 촬영했을 때 가장 정확하며,
          비스듬한 촬영은 오차가 생깁니다(측정 정직성).
        </p>
      </div>
    </div>
  );
}

// 세 점 + 각도 호(arc)를 그리는 SVG 오버레이.
function GoniometerOverlay({ points, angle }) {
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full" xmlns="http://www.w3.org/2000/svg">
      {/* 두 팔(선) */}
      {points.length >= 2 && (
        <line x1={points[1]?.x ?? points[0].x} y1={points[1]?.y ?? points[0].y}
          x2={points[0].x} y2={points[0].y}
          stroke="#38bdf8" strokeWidth="2.5" strokeLinecap="round" />
      )}
      {points.length >= 3 && (
        <line x1={points[1].x} y1={points[1].y} x2={points[2].x} y2={points[2].y}
          stroke="#34d399" strokeWidth="2.5" strokeLinecap="round" />
      )}
      {/* 각도 호 */}
      {points.length === 3 && angle != null && (
        <ArcAtVertex a={points[0]} b={points[1]} c={points[2]} />
      )}
      {/* 점 */}
      {points.map((p, i) => (
        <g key={i}>
          <circle cx={p.x} cy={p.y} r="8" fill={POINT_COLORS[i]} fillOpacity="0.25" />
          <circle cx={p.x} cy={p.y} r="5" fill={POINT_COLORS[i]} stroke="#0f172a" strokeWidth="1.5" />
        </g>
      ))}
    </svg>
  );
}

function ArcAtVertex({ a, b, c }) {
  const r = 34;
  const a1 = Math.atan2(a.y - b.y, a.x - b.x);
  const a2 = Math.atan2(c.y - b.y, c.x - b.x);
  // 짧은 호 방향으로 그리기
  let d = a2 - a1;
  while (d <= -Math.PI) d += 2 * Math.PI;
  while (d > Math.PI) d -= 2 * Math.PI;
  const largeArc = 0;
  const sweep = d > 0 ? 1 : 0;
  const x1 = b.x + r * Math.cos(a1);
  const y1 = b.y + r * Math.sin(a1);
  const x2 = b.x + r * Math.cos(a1 + d);
  const y2 = b.y + r * Math.sin(a1 + d);
  return (
    <path d={`M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} ${sweep} ${x2} ${y2}`}
      fill="none" stroke="#f59e0b" strokeWidth="2.5" />
  );
}
