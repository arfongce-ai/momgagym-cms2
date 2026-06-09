// ai-measure/menus/RecordMeasure.jsx
// 메뉴 0: 일반 영상 녹화 — 카메라로 녹화 후 재생·다운로드.
// AI 분석 없이 순수 녹화. MediaRecorder API 사용.
import { useRef, useState, useEffect, useCallback } from 'react';
import { drawGuides } from '../core/cameraGuide';

export default function RecordMeasure({ member, onBack }) {
  const videoRef    = useRef(null);   // 라이브 프리뷰
  const canvasRef   = useRef(null);   // 가이드 오버레이
  const streamRef   = useRef(null);
  const recorderRef = useRef(null);
  const chunksRef   = useRef([]);
  const rafRef      = useRef(null);

  const [status, setStatus] = useState('idle'); // idle|ready|recording|done
  const [error, setError]   = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const [videoUrl, setVideoUrl] = useState(null);
  const [aspect, setAspect] = useState('3/4');
  const startTsRef = useRef(0);
  const timerRef   = useRef(null);

  // 가이드 오버레이 루프
  const drawLoop = useCallback(() => {
    const v = videoRef.current, c = canvasRef.current;
    if (v && c && v.videoWidth) {
      if (c.width !== v.videoWidth) { c.width = v.videoWidth; c.height = v.videoHeight; }
      const ctx = c.getContext('2d');
      ctx.clearRect(0, 0, c.width, c.height);
      drawGuides(ctx, c.width, c.height);
    }
    rafRef.current = requestAnimationFrame(drawLoop);
  }, []);

  const startCamera = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: true,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(()=>{});
      }
      setStatus('ready');
      rafRef.current = requestAnimationFrame(drawLoop);
    } catch (e) {
      setError('카메라를 열 수 없습니다. 권한을 허용했는지 확인하세요.');
      setStatus('idle');
    }
  };

  const startRec = () => {
    if (!streamRef.current) return;
    chunksRef.current = [];
    // 지원 포맷 선택
    let mime = 'video/webm;codecs=vp9,opus';
    if (!MediaRecorder.isTypeSupported(mime)) mime = 'video/webm;codecs=vp8,opus';
    if (!MediaRecorder.isTypeSupported(mime)) mime = 'video/webm';
    if (!MediaRecorder.isTypeSupported(mime)) mime = '';
    const rec = new MediaRecorder(streamRef.current, mime ? { mimeType: mime } : undefined);
    rec.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
    rec.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: mime || 'video/webm' });
      const url = URL.createObjectURL(blob);
      setVideoUrl(url);
      setStatus('done');
    };
    rec.start();
    recorderRef.current = rec;
    startTsRef.current = Date.now();
    setElapsed(0);
    timerRef.current = setInterval(() => setElapsed(Math.floor((Date.now()-startTsRef.current)/1000)), 250);
    setStatus('recording');
  };

  const stopRec = () => {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') recorderRef.current.stop();
    if (timerRef.current) clearInterval(timerRef.current);
  };

  const stopAll = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
    if (recorderRef.current && recorderRef.current.state !== 'inactive') { try { recorderRef.current.stop(); } catch(e){} }
    if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    streamRef.current = null;
  }, []);

  const reset = () => {
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    setVideoUrl(null);
    setStatus('ready');
    rafRef.current = requestAnimationFrame(drawLoop);
  };

  useEffect(() => () => { stopAll(); if (videoUrl) URL.revokeObjectURL(videoUrl); }, [stopAll, videoUrl]);

  const mmss = `${String(Math.floor(elapsed/60)).padStart(2,'0')}:${String(elapsed%60).padStart(2,'0')}`;
  const fname = `녹화_${member?.name||'영상'}_${new Date().toISOString().slice(0,10)}.webm`;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="measure-back">← 메뉴</button>
        <h2 className="measure-title">일반 영상 녹화</h2>
        <span className="w-12" />
      </div>

      {status !== 'done' ? (
        <>
          {/* 비율 선택 */}
          {status === 'ready' && (
            <div className="flex gap-1 rounded-lg bg-slate-800 p-0.5 w-fit">
              {['3/4','1/1'].map(r=>(
                <button key={r} onClick={()=>setAspect(r)}
                  className={`px-3 py-1 rounded text-[11px] font-bold ${aspect===r?'bg-amber-500 text-slate-950':'text-slate-400'}`}>
                  {r==='3/4'?'3:4':'1:1'}
                </button>
              ))}
            </div>
          )}

          <div className="measure-camera">
            <video ref={videoRef} autoPlay playsInline muted
              className="absolute inset-0 w-full h-full object-contain" />
            <canvas ref={canvasRef}
              className="absolute inset-0 w-full h-full object-contain pointer-events-none" />
            {status === 'idle' && (
              <div className="absolute inset-0 flex items-center justify-center text-slate-400 text-sm text-center px-4">
                {error || '카메라를 시작하세요'}
              </div>
            )}
            {status === 'recording' && (
              <div className="absolute top-3 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-black/60 rounded-full px-3 py-1">
                <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
                <span className="text-white font-mono font-bold text-sm">{mmss}</span>
              </div>
            )}
            {/* 버튼 오버레이 — 카메라 위에 고정 */}
            {status === 'ready' && (
              <div className="absolute bottom-3 left-1/2 -translate-x-1/2 w-[90%]">
                <button onClick={startRec}
                  className="w-full rounded-xl bg-red-500 text-white font-black py-3 text-base shadow-lg active:scale-95 transition-transform">
                  ● 녹화 시작
                </button>
              </div>
            )}
            {status === 'recording' && (
              <div className="absolute bottom-3 left-1/2 -translate-x-1/2 w-[90%]">
                <button onClick={stopRec}
                  className="w-full rounded-xl bg-white text-slate-950 font-black py-3 text-base shadow-lg active:scale-95 transition-transform">
                  ■ 녹화 정지
                </button>
              </div>
            )}
          </div>

          {status === 'idle' && (
            <button onClick={startCamera} className="btn btn-primary w-full">
              카메라 시작
            </button>
          )}

          <p className="text-[11px] text-slate-500 leading-relaxed">
            ※ 녹화 버튼은 화면 위에 있어 스크롤 없이 바로 누를 수 있습니다. 후면 카메라로
            녹화되며, 정지하면 바로 재생·다운로드할 수 있습니다.
          </p>
        </>
      ) : (
        <div className="space-y-4 animate-fade-in">
          <div className="rounded-2xl overflow-hidden bg-black">
            <video src={videoUrl} controls playsInline className="w-full" style={{maxHeight:'60vh'}} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={reset}
              className="rounded-xl border border-slate-700 text-slate-300 font-bold py-3 text-sm">
              다시 녹화
            </button>
            <a href={videoUrl} download={fname}
              className="btn btn-primary">
              영상 저장
            </a>
          </div>
          <p className="text-[11px] text-slate-500 text-center">
            저장한 영상은 휴대폰 다운로드 폴더에 들어갑니다 (.webm 형식).
          </p>
        </div>
      )}
    </div>
  );
}
