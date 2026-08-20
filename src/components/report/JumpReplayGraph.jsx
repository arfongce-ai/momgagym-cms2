// components/report/JumpReplayGraph.jsx
// [점프 리플레이 그래프 2026-08-20] 녹화 영상 재생과 동기화된 무게중심(골반)
// 높이 곡선 — 지면반력을 카메라만으로는 잴 수 없어(기존과 동일한 한계), 그
// 대체 시각화로 "서 있는 기준선 대비 얼마나 뜨고 가라앉았는가"를 영상
// 스크러버와 함께 보여준다(경쟁 앱의 "점프 구간 리플레이" 스타일 참고).
//
// videoBlob이 있으면(라이브 카메라 측정 — 오버레이 합성 녹화본) 영상 +
// 커스텀 스크러버 + 재생 위치에 맞춰 움직이는 흰색 플레이헤드를 그린다.
// videoBlob이 없으면(고속영상 업로드 흐름은 영상을 결과에 실어 보내지
// 않음 — JumpUploadAnalysis.jsx 참고) 정적인 곡선만 보여준다(순수 SVG,
// TrendChart.jsx·JumpAngleTimelineChart.jsx와 동일한 "외부 의존성 0" 패턴).
//
// ⚠ 참고용 시각화 — StandingCalibrator의 정식 px↔cm 스케일이 아니라
//   어깨~발목 정규화 거리 기반 근사치다(jumpBiomechanics.js summary() 참고).
//   "측정 정직성" 원칙에 따라 절대 수치보다 곡선의 형태(도약/착지 타이밍)에
//   의미를 둔다.

import { useEffect, useMemo, useRef, useState } from 'react';

const fmtTime = (s) => {
  if (!Number.isFinite(s)) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
};

export default function JumpReplayGraph({ videoBlob = null, timeline = [], width = 340, height = 170 }) {
  const pts = useMemo(
    () => (timeline || []).filter((p) => p && p.tMs != null && p.comHeightCm != null),
    [timeline]
  );

  const videoRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [curSec, setCurSec] = useState(0);
  const [durSec, setDurSec] = useState(0);

  // Blob → object URL. 언마운트/blob 변경 시 반드시 해제(메모리 누수 방지).
  const videoUrl = useMemo(() => (videoBlob ? URL.createObjectURL(videoBlob) : null), [videoBlob]);
  useEffect(() => () => { if (videoUrl) URL.revokeObjectURL(videoUrl); }, [videoUrl]);

  if (!pts.length) return null; // 그릴 데이터가 없으면 아무것도 안 그린다(허위 그래프 방지)

  const padL = 34, padR = 12, padT = 14, padB = 20;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;

  const vals = pts.map((p) => p.comHeightCm);
  let min = Math.min(...vals, 0), max = Math.max(...vals, 0); // 0(기준선) 항상 포함
  if (min === max) { min -= 1; max += 1; }
  const range = max - min;

  const t0 = pts[0].tMs, t1 = pts[pts.length - 1].tMs;
  const spanMs = Math.max(1, t1 - t0);
  const xAt = (tMs) => padL + ((tMs - t0) / spanMs) * innerW;
  const yAt = (v) => padT + innerH - ((v - min) / range) * innerH;
  const zeroY = yAt(0);

  const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xAt(p.tMs).toFixed(1)} ${yAt(p.comHeightCm).toFixed(1)}`).join(' ');

  // 재생 위치(ms, 영상 기준) → 플레이헤드 x좌표. 영상이 timeline 구간보다
  // 길면(측정 종료 후 몇 프레임 더 녹화됨) 범위 밖은 양끝으로 clamp.
  const playedMs = curSec * 1000;
  const playheadX = videoUrl ? Math.max(padL, Math.min(padL + innerW, xAt(playedMs))) : null;

  const seekToClientX = (clientX, svgEl) => {
    const video = videoRef.current;
    if (!video || !svgEl) return;
    const rect = svgEl.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const targetMs = t0 + frac * spanMs;
    video.currentTime = Math.max(0, targetMs / 1000);
  };

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) { video.play(); setPlaying(true); } else { video.pause(); setPlaying(false); }
  };

  return (
    <div className="w-full">
      <p className="mb-1.5 text-[11px] font-bold text-slate-400">
        점프 구간 리플레이 · 무게중심 높이(cm, 참고용){videoUrl ? '' : ' — 정적 그래프'}
      </p>

      {videoUrl && (
        // data-html2canvas-ignore: 리포트 JPG로 캡처할 때(ReportActions →
        // reportShare.js html2canvas) 재생 중인 비디오 프레임이 그대로
        // 스틸컷으로 찍히면 혼란스러우므로 캡처에서는 제외한다 — 그래프(SVG)는
        // 그대로 캡처된다.
        <div data-html2canvas-ignore="true" className="relative mb-2 overflow-hidden rounded-xl bg-black" style={{ aspectRatio: '9/16', maxHeight: 320 }}>
          <video
            ref={videoRef}
            src={videoUrl}
            className="h-full w-full object-contain"
            playsInline
            onTimeUpdate={(e) => setCurSec(e.currentTarget.currentTime)}
            onLoadedMetadata={(e) => setDurSec(e.currentTarget.duration || 0)}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={() => setPlaying(false)}
          />
          <button
            onClick={togglePlay}
            className="absolute inset-0 flex items-center justify-center bg-black/0 text-white transition active:bg-black/20"
            aria-label={playing ? '일시정지' : '재생'}
          >
            {!playing && (
              <span className="rounded-full bg-black/55 p-3 text-2xl">▶</span>
            )}
          </button>
        </div>
      )}

      <svg
        width="100%" viewBox={`0 0 ${width} ${height}`}
        style={{ background: '#0f172a', borderRadius: 12, touchAction: 'none', cursor: videoUrl ? 'pointer' : 'default' }}
        xmlns="http://www.w3.org/2000/svg"
        onClick={(e) => videoUrl && seekToClientX(e.clientX, e.currentTarget)}
      >
        {/* y=0 기준선(서 있을 때) */}
        <line x1={padL} y1={zeroY} x2={width - padR} y2={zeroY} stroke="#334155" strokeWidth="1" strokeDasharray="4,3" />
        <text x={padL - 4} y={zeroY + 3} fill="#64748b" fontSize="9" textAnchor="end" fontFamily="system-ui">0</text>

        {/* 무게중심 높이 곡선 */}
        <path d={path} fill="none" stroke="#38bdf8" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />

        {/* 영상 재생 위치 플레이헤드 */}
        {playheadX != null && (
          <line x1={playheadX} y1={padT} x2={playheadX} y2={height - padB} stroke="#fff" strokeWidth="2" opacity="0.9" />
        )}

        <text x={padL} y={height - 6} fill="#64748b" fontSize="9" fontFamily="system-ui">준비</text>
        <text x={width - padR} y={height - 6} fill="#64748b" fontSize="9" textAnchor="end" fontFamily="system-ui">착지</text>
      </svg>

      {videoUrl && (
        <div data-html2canvas-ignore="true" className="mt-2 flex items-center gap-2">
          <button onClick={togglePlay} className="rounded-lg bg-white/10 px-2.5 py-1 text-xs font-bold text-white active:scale-95">
            {playing ? '⏸' : '▶'}
          </button>
          <input
            type="range" min={0} max={durSec || 0.001} step={0.01} value={Math.min(curSec, durSec || 0)}
            onChange={(e) => { const v = Number(e.target.value); if (videoRef.current) videoRef.current.currentTime = v; }}
            className="h-1.5 flex-1 accent-sky-400"
          />
          <span className="w-[74px] shrink-0 text-right text-[10px] font-mono text-slate-400">
            {fmtTime(curSec)} / {fmtTime(durSec)}
          </span>
        </div>
      )}
    </div>
  );
}
