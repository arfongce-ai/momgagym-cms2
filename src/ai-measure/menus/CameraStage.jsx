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
//   topOffset           : 상위(허브)가 화면 상단에 겹쳐 그리는 오버레이(모드/종목
//                         선택 바)의 실측 높이(px). 그만큼 이 스테이지의 상단
//                         요소들을 아래로 밀어 오버레이 겹침을 방지한다.
import { useEffect, useState } from 'react';
import SkeletonToggleChip from './SkeletonToggleChip';
import { useCameraRotation } from '../core/useCameraRotation';

export default function CameraStage({
  videoRef, canvasRef, status, error,
  onTapVideo, onClose, topBar, controls, children, tappable = true,
  recording = false, recordingLabel = '측정 중',
  seedHint = false, hintSignal = 0, countdown = null,
  topOffset = 0, showSkeletonToggle = false, aspectFrame = null,
}) {
  const [showSeedHint, setShowSeedHint] = useState(false);
  const [rotationDeg, cycleRotation] = useCameraRotation();
  const isSideways = rotationDeg === 90 || rotationDeg === 270;
  const rotateWrapStyle = rotationDeg ? {
    position: 'absolute',
    top: '50%',
    left: '50%',
    width: isSideways ? '100vh' : '100%',
    height: isSideways ? '100vw' : '100%',
    transform: `translate(-50%, -50%) rotate(${rotationDeg}deg)`,
  } : undefined;
  const off = Math.max(0, topOffset);
  const topPad = `calc(env(safe-area-inset-top) + ${10 + off}px)`;
  const recTop = `calc(max(env(safe-area-inset-top), 12px) + ${off}px)`;
  const seedHintTop = `calc(${off}px + 34%)`;

  // 오버레이가 떠 있는 동안 바디 스크롤 잠금
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  useEffect(() => {
    if (!seedHint || status !== 'running') {
      setShowSeedHint(false);
      return undefined;
    }
    setShowSeedHint(true);
    const timer = setTimeout(() => setShowSeedHint(false), 3200);
    return () => clearTimeout(timer);
  }, [seedHint, hintSignal, status]);

  return (
    <div className="cam-stage">
      <div className={rotationDeg ? '' : 'absolute inset-0 w-full h-full'} style={rotateWrapStyle}>
        <video ref={videoRef} autoPlay playsInline muted
          className="absolute inset-0 w-full h-full object-contain" />
        <canvas ref={canvasRef}
          className="absolute inset-0 w-full h-full object-contain pointer-events-none" />
      </div>

      {/* 녹화 비율 크롭 가이드(인스타 3:4/1:1) — 실제 저장 프레임 영역을 밝게 표시 */}
      {aspectFrame && status === 'running' && (
        <div className="pointer-events-none absolute inset-0 z-[15] flex items-center justify-center p-2">
          <div className="relative border-2 border-amber-400/50 rounded-sm"
            style={{ aspectRatio: aspectFrame.replace('/', ' / '), height: '96%', maxWidth: '96%' }}>
            <span className="absolute top-1 right-1 rounded bg-black/55 px-1.5 py-0.5 text-[9px] font-black text-amber-300">
              {aspectFrame === '1/1' ? '1:1' : '3:4'} 저장
            </span>
          </div>
        </div>
      )}

      {recording && status === 'running' && (
        <div className="absolute left-1/2 z-30 -translate-x-1/2 rounded-full bg-red-500/80 border border-white/20 px-3 py-1.5 text-xs font-black text-white shadow-lg backdrop-blur" style={{ top: recTop }}>
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

      {showSeedHint && status === 'running' && countdown == null && (
        <div className="pointer-events-none absolute left-1/2 z-30 w-[min(88vw,360px)] max-w-[calc(100vw-24px)] -translate-x-1/2 rounded-2xl border border-amber-400/45 bg-black/70 px-4 py-3 text-center shadow-xl backdrop-blur animate-fade-in break-keep" style={{ top: seedHintTop }}>
          <p className="text-sm font-black text-amber-300 break-keep">바벨 끝·원판 추적점을 먼저 1개 이상 눌러주세요</p>
          <p className="mt-1 text-[11px] font-bold text-slate-300 break-keep">2~3개 지정하면 가려져도 더 안정적입니다.</p>
        </div>
      )}

      {countdown != null && (
        <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center bg-black/15">
          <div className="flex h-36 w-36 items-center justify-center rounded-full border-4 border-amber-300/80 bg-black/65 shadow-2xl backdrop-blur">
            <span className="font-mono text-6xl font-black text-white">{countdown}</span>
          </div>
        </div>
      )}

      {/* 상단 닫기 + 가이드 */}
      <div className="absolute top-0 left-0 right-0 z-20 px-3 pb-8 bg-gradient-to-b from-black/55 via-black/25 to-transparent" style={{ paddingTop: topPad }}>
        <div className="flex items-start justify-between gap-2">
          <div className="flex shrink-0 flex-col items-start gap-1.5">
            <button onClick={onClose}
              className="rounded-full bg-black/55 border border-white/25 text-white text-xs font-bold px-3 py-1.5 active:scale-95">
              ✕ 닫기
            </button>
            <button onClick={cycleRotation}
              className="rounded-full bg-black/55 border border-white/25 text-white text-xs font-bold px-3 py-1.5 active:scale-95">
              ↻ 화면 회전{rotationDeg ? ` ${rotationDeg}°` : ''}
            </button>
            {showSkeletonToggle && <SkeletonToggleChip />}
          </div>
          <div className="flex-1 min-w-0 flex flex-col items-end gap-1.5 pr-0.5 text-right break-keep">{topBar}</div>
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
