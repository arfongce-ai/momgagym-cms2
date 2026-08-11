import { useState } from 'react';
import { captureNodeToJpgFile } from '../../ai-measure/core/reportShare';

async function shareOrDownload(files, title, onMessage) {
  const list = Array.isArray(files) ? files : [files];
  try {
    if (navigator.canShare && navigator.canShare({ files: list })) {
      await navigator.share({ title, files: list });
      onMessage?.('공유했습니다.');
      return;
    }
  } catch (err) {
    if (err?.name === 'AbortError') {
      onMessage?.('');
      return;
    }
  }

  list.forEach((file, index) => {
    setTimeout(() => {
      const url = URL.createObjectURL(file);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 300);
    }, index * 250);
  });
  onMessage?.(list.length > 1 ? `${list.length}장으로 저장했습니다.` : '기기에 저장했습니다.');
}

export default function ReportActions({
  reportNodeId,
  videoBlob = null,
  imageFiles = null,
  imageButtonLabel = '📸 사진 저장',
  baseName = '측정',
  onMessage,
  onReportClick,
  onAfterReportSave,
  reportButtonLabel = '🖼 리포트 저장',
}) {
  const [busy, setBusy] = useState(null);
  const hasImageFactory = typeof imageFiles === 'function';
  const staticImageFiles = Array.isArray(imageFiles) ? imageFiles.filter(Boolean) : [];
  const hasImages = hasImageFactory || staticImageFiles.length > 0;
  const hasSecondary = Boolean(videoBlob) || hasImages;

  const saveReport = async () => {
    if (onReportClick) {
      onReportClick();
      return;
    }

    const node = document.getElementById(reportNodeId);
    if (!node) {
      onMessage?.('리포트 화면을 찾을 수 없습니다.');
      return;
    }

    setBusy('report');
    onMessage?.('A4 리포트 이미지를 만드는 중...');
    try {
      const pages = Array.from(node.querySelectorAll('.report-a4-page'));
      const targets = pages.length > 0 ? pages : [node];
      const files = [];

      for (let i = 0; i < targets.length; i += 1) {
        const suffix = targets.length > 1 ? `_A4_${i + 1}` : '_A4';
        // width: 794 — report-a4-page의 max-width(A4 폭)와 동일. 안 주면 폰 화면의
        // 좁은 실제 렌더링 폭 그대로 캡처돼 A4 카드가 아니라 세로로 긴 이미지가 나온다.
        const file = await captureNodeToJpgFile(targets[i], `몸가짐_${baseName}${suffix}.jpg`, { bg: '#0f172a', width: 794 });
        files.push(file);
      }

      await shareOrDownload(files, '측정 리포트', onMessage);
      // 리포트 저장(A4 JPG) 성공 후 회원 기록 자동 저장 (별도 탭 불필요)
      if (onAfterReportSave) {
        try { await onAfterReportSave(); } catch (e) { /* 저장 실패는 onAfterReportSave 내부에서 처리 */ }
      }
    } catch (e) {
      onMessage?.('리포트 저장에 실패했습니다. 화면을 다시 열고 시도해주세요.');
    } finally {
      setBusy(null);
    }
  };

  const saveVideo = async () => {
    if (!videoBlob) return;
    setBusy('video');
    onMessage?.('동영상 준비 중...');
    try {
      const ext = videoBlob.type.includes('mp4') ? 'mp4' : 'webm';
      const file = new File([videoBlob], `몸가짐_${baseName}_동영상.${ext}`, { type: videoBlob.type });
      await shareOrDownload(file, '측정 동영상', onMessage);
    } catch (e) {
      onMessage?.('동영상 저장에 실패했습니다. 다시 시도해주세요.');
    } finally {
      setBusy(null);
    }
  };

  const saveImages = async () => {
    if (!hasImages) return;
    setBusy('images');
    onMessage?.('사진 준비 중...');
    try {
      const files = hasImageFactory ? await imageFiles() : staticImageFiles;
      const list = Array.isArray(files) ? files.filter(Boolean) : [];
      if (!list.length) {
        onMessage?.('저장할 사진을 찾을 수 없습니다.');
        return;
      }
      await shareOrDownload(list, '측정 사진', onMessage);
    } catch (e) {
      onMessage?.('사진 저장에 실패했습니다. 다시 시도해주세요.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className={`grid ${hasSecondary ? 'grid-cols-2' : 'grid-cols-1'} gap-2`}>
      <button
        onClick={saveReport}
        disabled={busy != null}
        className="rounded-xl bg-amber-500 text-slate-950 font-black py-3 text-sm active:scale-95 disabled:opacity-60 flex items-center justify-center gap-2"
      >
        {busy === 'report' && <span className="h-4 w-4 rounded-full border-2 border-slate-950 border-t-transparent animate-spin" />}
        {reportButtonLabel}
      </button>
      {videoBlob && (
        <button
          onClick={saveVideo}
          disabled={busy != null}
          className="rounded-xl border border-slate-400 dark:border-slate-600 bg-slate-200 dark:bg-slate-700 text-white font-bold py-3 text-sm active:scale-95 disabled:opacity-60 flex items-center justify-center gap-2"
        >
          {busy === 'video' && <span className="h-4 w-4 rounded-full border-2 border-white border-t-transparent animate-spin" />}
          🎥 동영상 저장
        </button>
      )}
      {!videoBlob && hasImages && (
        <button
          onClick={saveImages}
          disabled={busy != null}
          className="rounded-xl border border-slate-400 dark:border-slate-600 bg-slate-200 dark:bg-slate-700 text-white font-bold py-3 text-sm active:scale-95 disabled:opacity-60 flex items-center justify-center gap-2"
        >
          {busy === 'images' && <span className="h-4 w-4 rounded-full border-2 border-white border-t-transparent animate-spin" />}
          {imageButtonLabel}
        </button>
      )}
    </div>
  );
}
