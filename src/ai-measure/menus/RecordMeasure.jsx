// ai-measure/menus/RecordMeasure.jsx
// 메뉴 0: 일반 영상 녹화 — 카메라로 녹화 후 재생·다운로드.
// AI 분석 없이 순수 녹화. MediaRecorder API 사용.
import { useRef, useState, useEffect, useCallback } from 'react';
import { todayYMD } from '../../utils/dates';
import { drawGuides } from '../core/cameraGuide';
import { openMainCameraStream } from '../core/cameraSelect';

export default function RecordMeasure({ member, onBack }) {
  const videoRef    = useRef(null);   // 라이브 프리뷰
  const canvasRef   = useRef(null);   // 가이드 오버레이
  const streamRef   = useRef(null);
  const recorderRef = useRef(null);
  const chunksRef   = useRef([]);
  const blobRef     = useRef(null);
  const mimeRef     = useRef('video/webm');
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
      const stream = await openMainCameraStream({ audio: true });
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
    // 지원 포맷 선택 — 갤러리(사진앱) 호환성 위해 mp4 우선, 없으면 webm
    let mime = 'video/mp4;codecs=h264,aac';
    if (!MediaRecorder.isTypeSupported(mime)) mime = 'video/mp4';
    if (!MediaRecorder.isTypeSupported(mime)) mime = 'video/webm;codecs=vp9,opus';
    if (!MediaRecorder.isTypeSupported(mime)) mime = 'video/webm;codecs=vp8,opus';
    if (!MediaRecorder.isTypeSupported(mime)) mime = 'video/webm';
    if (!MediaRecorder.isTypeSupported(mime)) mime = '';
    mimeRef.current = mime || 'video/webm';
    // 비트레이트 제한 — 파일 크기를 줄여 카카오톡 전송 속도/안정성 향상.
    // 측정용 영상은 4Mbps면 충분히 선명하며, 무제한 대비 파일이 수배 작아진다.
    const recOpts = { videoBitsPerSecond: 4_000_000, audioBitsPerSecond: 128_000 };
    if (mime) recOpts.mimeType = mime;
    const rec = new MediaRecorder(streamRef.current, recOpts);
    rec.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
    rec.onstop = () => {
      const type = mimeRef.current;
      const blob = new Blob(chunksRef.current, { type });
      blobRef.current = blob;
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
  const ext = (mimeRef.current || '').includes('mp4') ? 'mp4' : 'webm';
  // 폴더 의미를 파일명 접두어로 부여(갤러리 앱이 같은 접두어끼리 묶어 보여줌)
  const fname = `몸가짐_측정영상_${member?.name||'영상'}_${todayYMD().replace(/-/g,'')}.${ext}`;

  // 사진앱/갤러리에 저장 — Web Share(파일 공유 시트)로 "사진에 저장" 가능(S25/iPhone)
  const [shareSupported] = useState(() =>
    typeof navigator !== 'undefined' && !!navigator.canShare
  );
  // 카카오톡은 webm을 영상으로 인식하지 못해 전송이 느리거나 실패한다.
  // mp4가 아니면 "사진앱 저장 후 갤러리에서 전송"을 안내한다.
  const isWebm = ext === 'webm';
  const saveToGallery = async () => {
    try {
      const blob = blobRef.current;
      if (!blob) return;
      const file = new File([blob], fname, { type: blob.type });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: fname });
      } else {
        // 폴백: 다운로드
        const a = document.createElement('a');
        a.href = videoUrl; a.download = fname; a.click();
      }
    } catch (e) {
      if (e?.name !== 'AbortError') {
        alert('갤러리 저장 공유 시트를 열 수 없습니다. "영상 다운로드"로 저장하세요.');
      }
    }
  };

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

          <div className="measure-camera" style={{ aspectRatio: aspect.replace('/', ' / ') }}>
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
            {shareSupported ? (
              <button onClick={saveToGallery} className="btn btn-primary">
                📷 사진앱에 저장
              </button>
            ) : (
              <a href={videoUrl} download={fname} className="btn btn-primary">
                영상 다운로드
              </a>
            )}
          </div>
          {shareSupported && (
            <a href={videoUrl} download={fname}
              className="block text-center text-[11px] text-slate-400 underline">
              또는 파일로 다운로드
            </a>
          )}
          <p className="text-[11px] text-slate-500 text-center leading-relaxed">
            "사진앱에 저장"을 누르면 공유 시트에서 <strong className="text-slate-300">사진/갤러리</strong>를
            선택해 카메라 롤에 바로 넣을 수 있습니다. 파일명은 <strong className="text-slate-300">몸가짐_측정영상</strong>으로
            시작해 갤러리에서 모아 보기 쉽습니다.
          </p>
          {isWebm && (
            <p className="text-[11px] text-amber-400/90 text-center leading-relaxed">
              ⚠️ 이 기기는 webm 형식으로 녹화됩니다. 카카오톡으로 영상을 바로 보내면
              느리거나 실패할 수 있으니, <strong>먼저 "사진앱에 저장"</strong>한 뒤
              <strong> 갤러리(사진)에서 카카오톡으로 전송</strong>하세요. 갤러리에 저장될 때
              mp4로 변환되어 전송이 빠르고 안정적입니다.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
