// components/report/ReportActions.jsx
// ════════════════════════════════════════════════════════════════════════
//  모든 AI 측정 결과 화면 공통 액션 바.
//   [리포트 저장] → 지정한 DOM 노드를 A4 비율 JPG 로 폰에 저장/공유
//   [동영상 저장] → 그래픽 오버레이가 합성된 녹화 영상을 폰에 저장/공유
//  영상이 없으면(수동/업로드 등) 동영상 버튼은 숨긴다.
//
//  props:
//   reportNodeId : 캡처할 리포트 DOM 의 id (A4 시트)
//   videoBlob    : 녹화 영상 Blob | null
//   baseName     : 파일명 접두 (예: "홍길동_점프")
//   onMessage    : (msg) => void  상태 메시지 콜백(선택)
// ════════════════════════════════════════════════════════════════════════
import { useState } from 'react';
import { captureNodeToJpgFile } from '../../ai-measure/core/reportShare';

async function shareOrDownload(file, title, onMessage) {
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ title, files: [file] });
      onMessage?.('공유했습니다.');
      return;
    }
  } catch (err) {
    if (err?.name === 'AbortError') { onMessage?.(''); return; }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url; a.download = file.name;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 200);
  onMessage?.('기기에 저장했습니다.');
}

export default function ReportActions({ reportNodeId, videoBlob = null, baseName = '측정', onMessage }) {
  const [busy, setBusy] = useState(null); // 'report' | 'video' | null

  const saveReport = async () => {
    const node = document.getElementById(reportNodeId);
    if (!node) { onMessage?.('리포트 화면을 찾을 수 없습니다.'); return; }
    setBusy('report');
    onMessage?.('리포트 이미지 생성 중...');
    try {
      const file = await captureNodeToJpgFile(node, `${baseName}_리포트.jpg`, { bg: '#0f172a' });
      await shareOrDownload(file, '측정 리포트', onMessage);
    } catch (e) {
      onMessage?.('리포트 저장 실패 — 인터넷 연결을 확인하세요');
    } finally { setBusy(null); }
  };

  const saveVideo = async () => {
    if (!videoBlob) return;
    setBusy('video');
    onMessage?.('영상 준비 중...');
    try {
      const ext = videoBlob.type.includes('mp4') ? 'mp4' : 'webm';
      const file = new File([videoBlob], `${baseName}_영상.${ext}`, { type: videoBlob.type });
      await shareOrDownload(file, '측정 영상', onMessage);
    } catch (e) {
      onMessage?.('영상 저장 실패 — 다시 시도하세요');
    } finally { setBusy(null); }
  };

  return (
    <div className={`grid ${videoBlob ? 'grid-cols-2' : 'grid-cols-1'} gap-2`}>
      <button onClick={saveReport} disabled={busy != null}
        className="rounded-xl bg-amber-500 text-slate-950 font-black py-3 text-sm active:scale-95 disabled:opacity-60 flex items-center justify-center gap-2">
        {busy === 'report' && <span className="h-4 w-4 rounded-full border-2 border-slate-950 border-t-transparent animate-spin" />}
        🖼 리포트 저장
      </button>
      {videoBlob && (
        <button onClick={saveVideo} disabled={busy != null}
          className="rounded-xl border border-slate-600 bg-slate-700 text-white font-bold py-3 text-sm active:scale-95 disabled:opacity-60 flex items-center justify-center gap-2">
          {busy === 'video' && <span className="h-4 w-4 rounded-full border-2 border-white border-t-transparent animate-spin" />}
          📹 동영상 저장
        </button>
      )}
    </div>
  );
}
