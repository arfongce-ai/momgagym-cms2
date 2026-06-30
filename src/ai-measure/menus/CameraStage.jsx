// ai-measure/menus/CameraStage.jsx
// 공통 풀스크린 카메라 스테이지(오버레이).
//  - 카메라가 켜지면 화면 전체(fixed inset-0)를 덮고, 가이드·컨트롤·결과를
//    모두 영상 위에 겹쳐 한 화면에서 측정→확인이 끝나게 한다(스크롤 0).
//  - object-contain 좌표 보정 탭 처리 내장(엔드캡 색 지정용).
//  - 역도/VBT/1RM이 동일한 UX를 공유하도록 통일.
//
// props:
//   videoRef, canvasRef : 부모가 보유(추적 로직과 공유)
//   status, error       : usePoseEngine 상태
//   onTapVideo          : 영상 탭 핸들러(엔드캡 지정)
//   onClose             : 카메라 닫기(정지)
//   topBar              : 상단 가이드 영역(JSX)
//   controls            : 하단 컨트롤 영역(JSX)
//   children            : 결과/추가 패널(하단 시트, 선택)
//   tappable            : true면 영상 탭 입력 레이어 활성
import { useEffect } from 'react';

export default function CameraStage({
  videoRef, canvasRef, status, error,
  onTapVideo, onClose, topBar, controls, children, tappable = true,
  recording = false, recordingLabel = '측정 중',
}) {
  // 오버레이가 떠 있는 동안 바디 스크롤 잠금
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  return (
    <div className="cam-stage">
      <video ref={videoRef} autoPlay playsInline muted
        className="absolute inset-0 w-full h-full object-contain" />
      <canvas ref={canvasRef}
        className="absolute inset-0 w-full h-full object-contain pointer-events-none" />

      {recording && status === 'running' && (
        <div className="absolute top-[max(env(safe-area-inset-top),12px)] left-1/2 z-20 -translate-x-1/2 rounded-full bg-red-500/80 border border-white/20 px-3 py-1.5 text-xs font-black text-white shadow-lg backdrop-blur">
          <span className="mr-1 inline-block h-2 w-2 rounded-full bg-white animate-pulse" />
          {recordingLabel}
        </div>
      )}

      {/* 탭 입력 레이어(엔드캡 색 지정) */}
      {tappable && status === 'running' && (
        <div className="absolute inset-0 z-10" onClick={onTapVideo} onTouchStart={onTapVideo} />
      )}

      {/* 로딩/오류 안내 */}
      {status !== 'running' && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center text-slate-300 text-sm text-center px-6 gap-3">
          {status === 'loading' && (
            <>
              <div className="w-10 h-10 border-4 border-amber-500 border-t-transparent rounded-full animate-spin" />
              <p>카메라·AI 모델 준비 중…</p>
            </>
          )}
          {status === 'error' && (
            <>
              <p className="text-red-400 font-bold">카메라를 열 수 없습니다</p>
              <p className="text-xs text-slate-400 break-keep">{error || '권한을 허용했는지 확인하세요.'}</p>
            </>
          )}
        </div>
      )}

      {/* 상단 닫기 + 가이드 */}
      <div className="absolute top-0 left-0 right-0 z-20 pt-[max(env(safe-area-inset-top),12px)] px-3 pb-2 bg-gradient-to-b from-black/70 to-transparent">
        <div className="flex items-start justify-between gap-2">
          <button onClick={onClose}
            className="shrink-0 rounded-full bg-black/55 border border-white/25 text-white text-xs font-bold px-3 py-1.5 active:scale-95">
            ✕ 닫기
          </button>
          <div className="flex-1 min-w-0 flex flex-col items-end gap-1">{topBar}</div>
        </div>
      </div>

      {/* 하단 컨트롤 + (선택)결과 시트 */}
      <div className="absolute bottom-0 left-0 right-0 z-20 pb-[max(env(safe-area-inset-bottom),16px)] pt-3 px-3 bg-gradient-to-t from-black/80 via-black/55 to-transparent space-y-3">
        {children}
        <div className="flex items-center justify-center gap-5">{controls}</div>
      </div>
    </div>
  );
}
