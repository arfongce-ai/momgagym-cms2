// ai-measure/core/measureRecorder.js
// ════════════════════════════════════════════════════════════════════════
//  [PAPS·스텝 영상 녹화 2026-11-25] 측정 화면 공용 녹화기.
//  카메라 영상 + 스켈레톤 + HUD(종목·초시계·횟수·메트로놈 박자·인식률·심박)를 캔버스에 합성해
//  captureStream → MediaRecorder 로 한 파일로 만든다. 저장은 호출자가 saveVideoToPhone 으로 한다(폰 저장, 서버 업로드 없음).
//  · HUD 값은 getHud() 가 매 프레임 돌려주는 객체를 그대로 그린다(없는 값은 '--').
//  · 이 파일의 hudLines/recognitionLabel 은 순수 함수라 테스트한다. 캔버스·MediaRecorder 는 브라우저에서만 쓴다.
// ════════════════════════════════════════════════════════════════════════
import { coverTransform, drawVideoCover, outputSize, DEFAULT_ASPECT } from './recordAspect';
import { formatStopwatch } from './recordingOverlay';
import { pickRecorderMime } from './recordSink';

/** 인식률(0~1) → 화면 문구. 값이 없으면 '--'. 허위 수치를 만들지 않는다. */
export function recognitionLabel(snapshot) {
  if (!snapshot || !Number.isFinite(snapshot.ratio) || !snapshot.frames) return '인식률 --';
  return `인식률 ${Math.round(snapshot.ratio * 100)}%`;
}

/** HUD 에 그릴 줄 목록(순수). hud: {title, elapsedMs, remainMs, count, unit, bpm, beat, recognition, hr, note} */
export function hudLines(hud = {}) {
  const lines = [];
  const clock = hud.remainMs != null ? hud.remainMs : hud.elapsedMs;
  lines.push({ key: 'clock', text: clock == null ? '--:--.--' : formatStopwatch(clock), big: true });
  if (hud.remainMs != null) lines.push({ key: 'clockHint', text: '남은 시간' });
  if (hud.count != null) lines.push({ key: 'count', text: `${hud.count}${hud.unit || '회'}`, big: true });
  if (hud.bpm) lines.push({ key: 'metro', text: `메트로놈 ${hud.bpm}`, beat: Boolean(hud.beat) });
  lines.push({ key: 'recog', text: recognitionLabel(hud.recognition) });
  if (hud.hr != null) lines.push({ key: 'hr', text: `심박 ${hud.hr}` });
  if (hud.note) lines.push({ key: 'note', text: String(hud.note) });
  return lines;
}

function drawHud(ctx, w, h, hud) {
  const u = Math.max(0.6, Math.min(2.2, Math.min(w / 720, h / 960) * 1.4));
  const pad = Math.round(16 * u);
  ctx.save();
  ctx.textBaseline = 'top';
  const title = String(hud.title || '').slice(0, 24);
  ctx.font = `800 ${Math.round(16 * u)}px system-ui, sans-serif`;
  const tw = ctx.measureText ? ctx.measureText(title).width : title.length * 9 * u;
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(pad, pad, tw + 40 * u, 32 * u);
  ctx.fillStyle = '#ef4444';
  ctx.beginPath(); ctx.arc(pad + 14 * u, pad + 16 * u, 6 * u, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.fillText(title, pad + 28 * u, pad + 7 * u);

  // 좌하단 패널: 초시계·횟수·박자·인식률
  const lines = hudLines(hud);
  const lh = (l) => Math.round((l.big ? 40 : 22) * u);
  const total = lines.reduce((a, l) => a + lh(l), 0) + 16 * u;
  const pw = Math.round(250 * u);
  const py = h - pad - total;
  ctx.fillStyle = 'rgba(0,0,0,0.58)';
  ctx.fillRect(pad, py, pw, total);
  let y = py + 8 * u;
  lines.forEach((l) => {
    ctx.font = `${l.big ? 900 : 700} ${Math.round((l.big ? 34 : 15) * u)}px system-ui, sans-serif`;
    ctx.fillStyle = l.key === 'recog' ? '#34d399' : l.key === 'count' ? '#fbbf24' : '#fff';
    ctx.fillText(l.text, pad + 12 * u, y);
    if (l.key === 'metro') {
      ctx.fillStyle = l.beat ? '#fbbf24' : 'rgba(255,255,255,0.25)';
      ctx.beginPath(); ctx.arc(pad + pw - 20 * u, y + 9 * u, 8 * u, 0, Math.PI * 2); ctx.fill();
    }
    y += lh(l);
  });
  ctx.restore();
}

/**
 * 녹화기 생성. 지원 안 되면 supported=false (측정은 그대로 진행, 영상만 없음).
 * opts: { getVideo(), getLandmarks(), getRotation(), getHud(), getTracked(), bones, dots, aspect }
 */
export function createMeasureRecorder(opts = {}) {
  const supported = typeof window !== 'undefined' && typeof MediaRecorder !== 'undefined'
    && typeof document !== 'undefined' && !!document.createElement('canvas').captureStream;
  let canvas = null; let raf = null; let timer = null; let stream = null; let mr = null; let chunks = [];
  let resolveStop = null;

  const draw = () => {
    const video = opts.getVideo?.();
    if (!video || !canvas) return;
    const ctx = canvas.getContext('2d', { alpha: false });
    const rot = opts.getRotation?.() || 0;
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (!drawVideoCover(ctx, video, canvas.width, canvas.height, rot)) return;
    const lm = opts.getLandmarks?.();
    if (lm && opts.showSkeleton?.() !== false) {
      const c = coverTransform(video, canvas.width, canvas.height, rot);
      const vis = (p) => p && (p.visibility ?? 1) >= 0.4;
      ctx.strokeStyle = opts.getTracked?.() ? 'rgba(52,211,153,0.95)' : 'rgba(251,191,36,0.95)';
      ctx.lineWidth = 4; ctx.lineCap = 'round';
      (opts.bones || []).forEach(([a, b]) => {
        if (!vis(lm[a]) || !vis(lm[b])) return;
        ctx.beginPath(); ctx.moveTo(c.X(lm[a]), c.Y(lm[a])); ctx.lineTo(c.X(lm[b]), c.Y(lm[b])); ctx.stroke();
      });
      ctx.fillStyle = '#fff';
      (opts.dots || []).forEach((i) => {
        if (!vis(lm[i])) return;
        ctx.beginPath(); ctx.arc(c.X(lm[i]), c.Y(lm[i]), 5, 0, Math.PI * 2); ctx.fill();
      });
    }
    drawHud(ctx, canvas.width, canvas.height, opts.getHud?.() || {});
  };

  function cleanup() {
    if (raf) { cancelAnimationFrame(raf); raf = null; }
    if (timer) { clearInterval(timer); timer = null; }
    if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
  }

  return {
    supported,
    get recording() { return Boolean(mr && mr.state === 'recording'); },
    start() {
      if (!supported || mr) return false;
      try {
        const size = outputSize(opts.aspect || DEFAULT_ASPECT);
        canvas = document.createElement('canvas');
        canvas.width = size.width; canvas.height = size.height;
        const loop = () => { draw(); raf = requestAnimationFrame(loop); };
        loop();
        timer = setInterval(draw, 66); // 탭이 가려져 raf 가 멈춰도 프레임 유지
        stream = canvas.captureStream(30);
        const mime = pickRecorderMime();
        mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
        chunks = [];
        mr.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunks.push(e.data); };
        mr.onstop = () => {
          cleanup();
          const blob = chunks.length ? new Blob(chunks, { type: mr.mimeType || 'video/webm' }) : null;
          mr = null;
          if (resolveStop) { resolveStop(blob); resolveStop = null; }
        };
        mr.start();
        return true;
      } catch (e) { cleanup(); mr = null; return false; }
    },
    /** 녹화를 끝내고 Blob(없으면 null)을 돌려준다. */
    stop() {
      if (!mr) return Promise.resolve(null);
      return new Promise((resolve) => {
        resolveStop = resolve;
        try { mr.stop(); } catch (e) { cleanup(); mr = null; resolve(null); }
      });
    },
    abort() { try { if (mr) { mr.onstop = null; mr.stop(); } } catch (e) { /* noop */ } cleanup(); mr = null; },
  };
}
