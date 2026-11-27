// ai-measure/menus/CompareAnalysis.jsx
// 전/후 비교 '동작 분석' — 나란히 보기 · 뼈대 표시 · 점 직접 수정 · 관절 각도 비교 · 사진 저장.
//  · 각 화면에서 원하는 장면을 고르면 그 장면만 인식한다.
//  · 각도는 2D 영상 참고값이며 ROM 기록(3번)에는 저장하지 않는다.
import { useCallback, useEffect, useRef, useState } from 'react';
import { loadImagePoseLandmarker } from '../core/poseImageBackend';
import { detectPoseRobust } from '../core/poseRobust';
import { BONES, METRICS, POINT_KEYS, POINT_NAMES, computeMetrics, pickSide, pointsFromLandmarks, templatePoints } from '../core/compareAngles';
import { angleAt } from './RomGoniometer.jsx';

const COLORS = { A: '#38bdf8', B: '#f59e0b' };
const MAX_EDGE = 1280;
const STEP = 1 / 30;
// ROM 사진 각도기(RomGoniometer)와 같은 색: 끝점 A · 꼭짓점 · 끝점 B
const ANGLE_COLORS = ['#38bdf8', '#f59e0b', '#34d399'];

/** 각도기 한 개의 값(도). 세 점이 다 찍히기 전에는 null. */
function angleValue(item, w, h) {
  if (item.points.length < 3) return null;
  const v = angleAt(...item.points.map((p) => ({ x: p.x * w, y: p.y * h })));
  if (v == null) return null;
  return item.supp ? Math.round((180 - v) * 10) / 10 : v;
}

// 두 선 + 각도 호 + 숫자. 캔버스에 그리므로 저장 사진에도 그대로 남는다.
function drawAngles(ctx, w, h, angles) {
  const u = Math.max(w, h) / 200;
  angles.forEach((item, n) => {
    const pts = item.points.map((p) => ({ x: p.x * w, y: p.y * h }));
    const [a, b, c] = pts;
    ctx.lineWidth = u * 0.7; ctx.lineCap = 'round';
    [[a, ANGLE_COLORS[0]], [c, ANGLE_COLORS[2]]].forEach(([end, color]) => {
      if (!b || !end) return;
      ctx.strokeStyle = color;
      ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(end.x, end.y); ctx.stroke();
    });
    pts.forEach((p, i) => {
      ctx.beginPath(); ctx.arc(p.x, p.y, u * 1.2, 0, Math.PI * 2);
      ctx.fillStyle = ANGLE_COLORS[i]; ctx.fill();
      ctx.lineWidth = u * 0.35; ctx.strokeStyle = '#0f172a'; ctx.stroke();
    });
    const value = angleValue(item, w, h);
    if (value == null) return;
    const start = Math.atan2(a.y - b.y, a.x - b.x);
    let d = Math.atan2(c.y - b.y, c.x - b.x) - start;
    while (d <= -Math.PI) d += 2 * Math.PI;
    while (d > Math.PI) d -= 2 * Math.PI;
    ctx.strokeStyle = ANGLE_COLORS[1]; ctx.lineWidth = u * 0.7;
    ctx.beginPath(); ctx.arc(b.x, b.y, u * 7, start, start + d, d < 0); ctx.stroke();
    const text = `${n + 1}) ${value}°`;
    ctx.font = `700 ${Math.round(u * 5)}px sans-serif`; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    const tw = ctx.measureText(text).width + u * 3;
    const x = Math.max(0, Math.min(w - tw, b.x + u * 8));
    const y = Math.max(u * 4, Math.min(h - u * 4, b.y - u * 6));
    ctx.fillStyle = 'rgba(15,23,42,0.82)'; ctx.fillRect(x, y - u * 4, tw, u * 8);
    ctx.fillStyle = '#fde68a'; ctx.fillText(text, x + u * 1.5, y);
  });
}

function drawScene(canvas, frame, points, low, color, showSkeleton, angles) {
  canvas.width = frame.width; canvas.height = frame.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(frame, 0, 0);
  if (showSkeleton && points) drawSkeleton(ctx, frame, points, low, color);
  drawAngles(ctx, frame.width, frame.height, angles);
}

function drawSkeleton(ctx, frame, points, low, color) {
  const u = Math.max(frame.width, frame.height) / 200;
  const at = (k) => [points[k].x * frame.width, points[k].y * frame.height];
  ctx.lineCap = 'round'; ctx.lineWidth = u * 0.8; ctx.strokeStyle = color;
  BONES.forEach(([a, b]) => { ctx.beginPath(); ctx.moveTo(...at(a)); ctx.lineTo(...at(b)); ctx.stroke(); });
  POINT_KEYS.forEach((k) => {
    ctx.beginPath(); ctx.arc(...at(k), u * 1.3, 0, Math.PI * 2);
    ctx.fillStyle = low.includes(k) ? '#ef4444' : '#fff'; ctx.fill();
    ctx.lineWidth = u * 0.4; ctx.stroke();
  });
}

function Panel({ layer, showSkeleton, onResult, canvasRef }) {
  const mediaRef = useRef(null);
  const frameRef = useRef(null);
  const landmarksRef = useRef(null);
  const dragRef = useRef(null);
  const seqRef = useRef(0);
  const [time, setTime] = useState(layer.time || 0);
  const [duration, setDuration] = useState(0);
  const [side, setSide] = useState('left');
  const [pose, setPose] = useState(null); // { points, low }
  const [status, setStatus] = useState('장면을 불러오는 중…');
  const [gonio, setGonio] = useState(false);
  const [angles, setAngles] = useState([]); // [{ points, supp }] — 지금 장면에만 유효
  const color = COLORS[layer.key];
  const isVideo = layer.type === 'video';

  // 현재 장면을 캡처해 인식한다. 늦게 끝난 이전 장면의 결과는 버린다.
  const analyze = useCallback(async () => {
    const m = mediaRef.current;
    const w = m?.videoWidth || m?.naturalWidth;
    const h = m?.videoHeight || m?.naturalHeight;
    if (!w || !h) return;
    const seq = ++seqRef.current;
    const k = Math.min(1, MAX_EDGE / Math.max(w, h));
    const frame = document.createElement('canvas');
    frame.width = Math.round(w * k); frame.height = Math.round(h * k);
    frame.getContext('2d').drawImage(m, 0, 0, frame.width, frame.height);
    frameRef.current = frame;
    setPose(null);
    setStatus('몸을 찾는 중…');
    let found = null;
    let failed = false;
    try {
      await loadImagePoseLandmarker();
      if (seq !== seqRef.current) return;
      found = detectPoseRobust(frame);
    } catch (e) { failed = true; }
    if (seq !== seqRef.current) return;
    landmarksRef.current = found?.landmarks || null;
    if (found) {
      const s = pickSide(found.landmarks);
      setSide(s);
      const next = pointsFromLandmarks(found.landmarks, s);
      setPose(next);
      setStatus(next.low.length ? `빨간 점 확인: ${next.low.map((p) => POINT_NAMES[p]).join('·')}` : '인식 완료 · 점을 끌면 고칠 수 있어요');
    } else {
      setPose({ points: templatePoints(), low: [...POINT_KEYS] });
      setStatus(failed ? '인식 모듈을 불러오지 못했습니다. 점을 직접 끌어 맞추세요.' : '자동 인식 실패 · 점을 직접 끌어 맞추세요.');
    }
  }, []);

  useEffect(() => () => { seqRef.current += 1; }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas && frameRef.current) drawScene(canvas, frameRef.current, pose?.points, pose?.low || [], color, showSkeleton, angles);
    const f = frameRef.current;
    // 자동 인식에 실패한 기본 점은 직접 옮기기 전까지 각도를 내지 않는다.
    const untouched = pose && pose.low.length === POINT_KEYS.length;
    onResult(layer.key, f ? {
      metrics: pose && !untouched ? computeMetrics(pose.points, f.width, f.height) : null,
      low: pose?.low || [],
      angles: angles.map((item) => angleValue(item, f.width, f.height)),
    } : null);
  }, [pose, angles, showSkeleton, color, canvasRef, layer.key, onResult]);

  const seek = (t) => {
    const v = mediaRef.current;
    if (!v) return;
    const next = Math.max(0, Math.min(v.duration || 0, t));
    setTime(next);
    setAngles([]);
    v.currentTime = next;
  };

  const changeSide = (s) => {
    setSide(s);
    if (landmarksRef.current) setPose(pointsFromLandmarks(landmarksRef.current, s));
  };

  const toPoint = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)) };
  };
  const onDown = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const p = toPoint(e);
    const near = (q) => Math.hypot((q.x - p.x) * r.width, (q.y - p.y) * r.height);
    if (gonio) {
      // 찍어 둔 점 근처면 끌기, 아니면 새 점 추가(3개가 차면 다음 각도).
      let hit = null;
      angles.forEach((item, n) => item.points.forEach((q, i) => {
        const d = near(q);
        if (d < 24 && (!hit || d < hit.d)) hit = { n, i, d };
      }));
      if (!hit) {
        const last = angles[angles.length - 1];
        const open = last && last.points.length < 3;
        const n = open ? angles.length - 1 : angles.length;
        const points = open ? [...last.points, p] : [p];
        hit = { n, i: points.length - 1 };
        setAngles([...angles.slice(0, n), { points, supp: false }]);
      }
      dragRef.current = hit;
      e.currentTarget.setPointerCapture?.(e.pointerId);
      return;
    }
    if (!pose || !showSkeleton) return;
    let best = null;
    POINT_KEYS.forEach((k) => {
      const d = Math.hypot((pose.points[k].x - p.x) * r.width, (pose.points[k].y - p.y) * r.height);
      if (d < 36 && (!best || d < best.d)) best = { k, d };
    });
    if (!best) return;
    dragRef.current = best.k;
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onMove = (e) => {
    const k = dragRef.current;
    if (!k) return;
    const p = toPoint(e);
    if (typeof k === 'object') {
      setAngles((prev) => prev.map((item, n) => (n === k.n
        ? { ...item, points: item.points.map((q, i) => (i === k.i ? p : q)) } : item)));
      return;
    }
    setPose((prev) => prev && { points: { ...prev.points, [k]: p }, low: prev.low.filter((x) => x !== k) });
  };
  const onUp = () => { dragRef.current = null; };

  return (
    <div className="card p-2 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-black" style={{ color }}>{layer.label}</span>
        <div className="flex gap-1">
          {[['left', '왼쪽'], ['right', '오른쪽']].map(([k, name]) => (
            <button key={k} onClick={() => changeSide(k)} className={`btn btn-sm ${side === k ? 'btn-primary' : 'btn-ghost'}`}>{name}</button>
          ))}
        </div>
      </div>

      {isVideo ? (
        <video ref={mediaRef} src={layer.url} muted playsInline preload="auto" className="hidden"
          onLoadedMetadata={(e) => { setDuration(e.target.duration || 0); }}
          onLoadedData={(e) => { if (time > 0.001) e.target.currentTime = time; else analyze(); }}
          onSeeked={analyze} />
      ) : (
        <img ref={mediaRef} src={layer.url} alt={layer.label} className="hidden" onLoad={analyze} />
      )}

      <div className="flex justify-center rounded-xl bg-black">
        <canvas ref={canvasRef} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
          className="max-w-full max-h-[55vh] touch-none" />
      </div>

      {isVideo && (
        <div className="flex items-center gap-2">
          <button onClick={() => seek(time - STEP)} className="btn btn-ghost btn-sm">◀ 한 장면</button>
          <input type="range" min={0} max={duration || 0} step={0.01} value={time}
            onChange={(e) => seek(+e.target.value)} className="flex-1 min-w-0" />
          <button onClick={() => seek(time + STEP)} className="btn btn-ghost btn-sm">한 장면 ▶</button>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => setGonio((v) => !v)} className={`btn btn-sm ${gonio ? 'btn-primary' : 'btn-ghost'}`}>
          📐 각도기 {gonio ? '켜짐' : '꺼짐'}
        </button>
        {angles.length > 0 && (
          <>
            <button onClick={() => setAngles((prev) => prev.map((a, n) => (n === prev.length - 1 ? { ...a, supp: !a.supp } : a)))}
              className="btn btn-ghost btn-sm">180−각도</button>
            <button onClick={() => setAngles((prev) => prev.slice(0, -1))} className="btn btn-ghost btn-sm">마지막 지우기</button>
          </>
        )}
        {gonio && (
          <span className="text-[11px] font-bold text-amber-700 dark:text-amber-300">
            {['① 끝점', '② 관절(꼭짓점)', '③ 끝점'][(angles[angles.length - 1]?.points.length || 0) % 3]} 위치를 누르세요
          </span>
        )}
      </div>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400">{status}</p>
        <button onClick={analyze} className="btn btn-ghost btn-sm">다시 인식</button>
      </div>
    </div>
  );
}

export default function CompareAnalysis({ layers = [], onClose }) {
  const [results, setResults] = useState({});
  const [showSkeleton, setShowSkeleton] = useState(true);
  const refA = useRef(null);
  const refB = useRef(null);
  const onResult = useCallback((key, value) => setResults((prev) => ({ ...prev, [key]: value })), []);
  const two = layers.length === 2;

  const cell = (key, m) => {
    const r = results[key];
    const v = r?.metrics?.[m.key];
    if (v == null) return { v: null, text: '—' };
    const unsure = m.needs.some((n) => r.low.includes(n));
    return { v, unsure, text: `${v}°${unsure ? ' ?' : ''}` };
  };
  const rows = METRICS.map((m) => {
    const cols = layers.map((l) => cell(l.key, m));
    const ok = two && cols.every((c) => c.v != null && !c.unsure);
    const d = ok ? cols[1].v - cols[0].v : null;
    return { m, cols, diff: d == null ? '—' : `${d > 0 ? '+' : ''}${d}°` };
  });

  // 각도기로 잰 값: 같은 번호끼리 전·후 비교.
  const count = Math.max(0, ...layers.map((l) => results[l.key]?.angles?.length || 0));
  for (let n = 0; n < count; n += 1) {
    const cols = layers.map((l) => {
      const v = results[l.key]?.angles?.[n] ?? null;
      return { v, text: v == null ? '—' : `${v}°` };
    });
    const ok = two && cols.every((c) => c.v != null);
    const d = ok ? Math.round((cols[1].v - cols[0].v) * 10) / 10 : null;
    rows.push({ m: { key: `angle${n}`, label: `각도기 ${n + 1}`, help: '직접 찍은 세 점' }, cols, diff: d == null ? '—' : `${d > 0 ? '+' : ''}${d}°` });
  }

  // 보이는 장면 + 각도 표를 한 장의 사진으로 저장.
  const save = () => {
    const shots = layers.map((l) => (l.key === 'A' ? refA : refB).current).filter((c) => c?.width);
    if (!shots.length) return;
    const H = 900;
    const widths = shots.map((c) => Math.round((c.width / c.height) * H));
    const W = Math.max(720, widths.reduce((a, b) => a + b, 0));
    const out = document.createElement('canvas');
    out.width = W; out.height = H + 60 + rows.length * 44 + 60;
    const ctx = out.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, out.width, out.height);
    let x = (W - widths.reduce((a, b) => a + b, 0)) / 2;
    shots.forEach((c, i) => { ctx.drawImage(c, x, 0, widths[i], H); x += widths[i]; });
    ctx.textBaseline = 'middle'; ctx.textAlign = 'center'; ctx.fillStyle = '#0f172a';
    const heads = ['항목', ...layers.map((l) => l.label), ...(two ? ['차이'] : [])];
    const line = (cells, y, bold) => {
      ctx.font = `${bold ? '700' : '400'} 26px sans-serif`;
      cells.forEach((t, i) => ctx.fillText(t, (W / cells.length) * (i + 0.5), y));
    };
    line(heads, H + 34, true);
    rows.forEach((r, i) => line([r.m.label, ...r.cols.map((c) => c.text), ...(two ? [r.diff] : [])], H + 82 + i * 44));
    ctx.font = '400 20px sans-serif'; ctx.fillStyle = '#64748b';
    ctx.fillText('영상 화면에서 잰 참고값 ( ? = 확인 필요 )', W / 2, out.height - 30);
    const a = document.createElement('a');
    a.href = out.toDataURL('image/png');
    a.download = `몸가짐_동작분석_${Date.now()}.png`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-50 dark:bg-slate-950 p-3">
      <div className="mx-auto max-w-5xl space-y-3 pb-8">
        <div className="flex items-center justify-between">
          <button onClick={onClose} className="measure-back">← 비교로</button>
          <h2 className="measure-title">동작 분석</h2>
          <button onClick={() => setShowSkeleton((v) => !v)} className="measure-back">뼈대 {showSkeleton ? '끄기' : '켜기'}</button>
        </div>

        <div className={`grid gap-3 ${two ? 'md:grid-cols-2' : 'max-w-xl mx-auto'}`}>
          {layers.map((l) => (
            <Panel key={l.key} layer={l} showSkeleton={showSkeleton} onResult={onResult} canvasRef={l.key === 'A' ? refA : refB} />
          ))}
        </div>

        <div className="card p-3">
          <table className="w-full text-sm text-center">
            <thead>
              <tr className="text-xs font-black text-slate-500 dark:text-slate-400">
                <th className="text-left py-1">항목</th>
                {layers.map((l) => <th key={l.key} style={{ color: COLORS[l.key] }}>{l.label}</th>)}
                {two && <th>차이</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.m.key} className="border-t border-slate-200 dark:border-slate-800">
                  <td className="text-left py-1.5">
                    <span className="font-bold">{r.m.label}</span>
                    <span className="block text-[10px] text-slate-500">{r.m.help}</span>
                  </td>
                  {r.cols.map((c, i) => <td key={layers[i].key} className="text-lg font-black tabular-nums">{c.text}</td>)}
                  {two && <td className="text-lg font-black tabular-nums text-amber-700 dark:text-amber-300">{r.diff}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <button onClick={save} className="btn btn-primary w-full justify-center">📸 분석 사진 저장</button>
        <p className="text-[11px] text-slate-500 dark:text-slate-400">
          영상 화면에서 잰 참고값입니다. 전·후는 같은 방향·거리에서, 몸의 옆면을 찍어야 비교가 정확합니다. ROM 기록에는 저장되지 않습니다.
        </p>
      </div>
    </div>
  );
}
