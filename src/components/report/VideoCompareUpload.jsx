// components/report/VideoCompareUpload.jsx
// ════════════════════════════════════════════════════════════════════════
//  [전/후 영상 비교 · 즉석 업로드 2026-08-31] 보행·ROM·점프·리프팅·SLST·스쿼트는
//  녹화 영상이 트레이너 폰에만 저장되고 클라우드(Firestore)엔 안 남는 기존
//  정책(recordSink.js 참고)이라, 결과 리포트 화면에서 "전/후 영상 비교"를
//  자동으로 띄울 수는 없다. 대신 그 자리에서 필요한 영상을 업로드해 나란히
//  놓고 보는 가벼운 비교 패널 — 정렬·블렌드까지 필요하면 기존 '전/후 비교
//  (오버레이)' 도구(OverlayCompare.jsx, AI측정 9번 메뉴)를 계속 쓰면 된다.
//  이 컴포넌트는 값 비교와 같은 화면에서 바로 보는 가벼운 용도.
//
//  · currentVideoUrl 이 있으면(측정 직후 화면 — 방금 녹화한 영상이 메모리에
//    아직 있음) "현재" 칸은 자동으로 채워지고 "이전" 칸만 업로드받는다.
//  · currentVideoUrl 이 없으면(나중에 결과리포트에서 다시 열어본 경우 — 녹화
//    영상은 이미 트레이너 폰에만 있고 메모리엔 없음) 두 칸 다 업로드받는다.
// ════════════════════════════════════════════════════════════════════════
import { useState, useRef, useEffect, useCallback } from 'react';

function useUploadedVideoUrl() {
  const [url, setUrl] = useState(null);
  const urlRef = useRef(null);
  useEffect(() => { urlRef.current = url; }, [url]);
  useEffect(() => () => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
  }, []);
  const onFile = useCallback((file) => {
    if (!file) return;
    if (!file.type.startsWith('video/')) { alert('동영상 파일만 업로드할 수 있습니다.'); return; }
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    setUrl(URL.createObjectURL(file));
  }, []);
  return [url, onFile];
}

function VideoSlot({ label, url, onFile, uploadable = true }) {
  const videoRef = useRef(null);
  return (
    <div className="flex-1 min-w-0">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[11px] font-black text-slate-600 dark:text-slate-300">{label}</span>
        {uploadable && (
          <label className="cursor-pointer rounded-md border border-slate-300 dark:border-slate-700 px-2 py-0.5 text-[10px] font-bold text-amber-700 dark:text-amber-300 hover:border-amber-500">
            📁 업로드
            <input type="file" accept="video/*" hidden onChange={(e) => onFile(e.target.files[0])} />
          </label>
        )}
      </div>
      <div className="aspect-video w-full overflow-hidden rounded-lg border border-slate-300 dark:border-slate-700 bg-black">
        {url ? (
          <video ref={videoRef} src={url} controls playsInline className="h-full w-full object-contain" data-video-slot={label} />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-[11px] font-bold text-slate-500">영상 없음</div>
        )}
      </div>
    </div>
  );
}

export default function VideoCompareUpload({
  currentVideoUrl,
  title = '전/후 영상 비교',
  currentLabel = '현재',
  previousLabel = '이전',
}) {
  const [uploadedPreviousUrl, onUploadPrevious] = useUploadedVideoUrl();
  const [uploadedCurrentUrl, onUploadCurrent] = useUploadedVideoUrl();
  const effectiveCurrentUrl = currentVideoUrl || uploadedCurrentUrl;
  const containerRef = useRef(null);

  const playBoth = (action) => {
    const node = containerRef.current;
    if (!node) return;
    node.querySelectorAll('video').forEach((v) => {
      try {
        if (action === 'play') { v.currentTime = 0; v.play(); }
        else v.pause();
      } catch (e) { /* noop */ }
    });
  };

  const hasBoth = Boolean(effectiveCurrentUrl && uploadedPreviousUrl);

  return (
    <section className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-black text-white">{title}</p>
        {hasBoth && (
          <div className="flex items-center gap-2">
            <button onClick={() => playBoth('play')} className="rounded-md border border-slate-300 dark:border-slate-700 px-2 py-1 text-[11px] font-bold text-amber-700 dark:text-amber-300 hover:border-amber-500">▶ 동시 재생</button>
            <button onClick={() => playBoth('pause')} className="rounded-md border border-slate-300 dark:border-slate-700 px-2 py-1 text-[11px] font-bold text-slate-600 dark:text-slate-300 hover:border-slate-500">⏸ 정지</button>
          </div>
        )}
      </div>
      <div ref={containerRef} className="flex flex-col gap-3 sm:flex-row">
        <VideoSlot label={previousLabel} url={uploadedPreviousUrl} onFile={onUploadPrevious} uploadable />
        <VideoSlot label={currentLabel} url={effectiveCurrentUrl} onFile={onUploadCurrent} uploadable={!currentVideoUrl} />
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
        영상은 클라우드에 저장되지 않습니다 — 트레이너 폰/갤러리에 저장해둔 영상을 업로드해 그 자리에서 비교하세요. 정밀 정렬·오버레이가 필요하면 &apos;전/후 비교(오버레이)&apos; 도구를 이용하세요.
      </p>
    </section>
  );
}
