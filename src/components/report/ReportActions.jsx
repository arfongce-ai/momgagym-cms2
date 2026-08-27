import { useRef, useState } from 'react';
import { captureNodeToJpgFile } from '../../ai-measure/core/reportShare';
import SimpleResultReport from './SimpleResultReport';

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
  // [쉬운 버전 리포트 2026-08-27] buildSummaryData(report, {reportType}) 결과를
  // 넘겨주면 "🙂 쉬운 버전 공유" 버튼이 함께 나타난다. 안 넘기면(기존 화면들)
  // 지금까지와 완전히 동일하게 동작 — 기존 버튼·동작은 전혀 안 바뀐다.
  simpleSummary = null,
  simpleMember = null,
}) {
  const [busy, setBusy] = useState(null);
  const simpleNodeRef = useRef(null);
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

  // simpleSummary는 항상 화면 밖(-9999px)에 이미 렌더돼 있는 SimpleResultReport를
  // 그대로 캡처한다 — Report.jsx 쪽처럼 별도 상태 토글/오프스크린 렌더 예약이
  // 필요 없다(이 컴포넌트가 이미 열려 있는 화면 안에 항상 같이 있기 때문).
  const saveSimple = async () => {
    if (!simpleSummary) return;
    setBusy('simple');
    onMessage?.('쉬운 버전 리포트를 만드는 중...');
    try {
      const node = simpleNodeRef.current?.querySelector('.report-a4-page');
      if (!node) {
        onMessage?.('쉬운 버전 화면을 찾을 수 없습니다.');
        return;
      }
      const file = await captureNodeToJpgFile(node, `몸가짐_${baseName}_쉬운버전_A4.jpg`, { bg: '#0f172a', width: 794 });
      await shareOrDownload(file, '쉬운 버전 리포트', onMessage);
      if (onAfterReportSave) {
        try { await onAfterReportSave(); } catch (e) { /* 저장 실패는 onAfterReportSave 내부에서 처리 */ }
      }
    } catch (e) {
      onMessage?.('쉬운 버전 저장에 실패했습니다. 다시 시도해주세요.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
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

      {simpleSummary && (
        <button
          onClick={saveSimple}
          disabled={busy != null}
          className="mt-2 w-full rounded-xl border-2 border-amber-400 bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300 font-black py-3 text-sm active:scale-95 disabled:opacity-60 flex items-center justify-center gap-2"
        >
          {busy === 'simple' && <span className="h-4 w-4 rounded-full border-2 border-amber-600 border-t-transparent animate-spin" />}
          🙂 쉬운 버전 공유 (회원용)
        </button>
      )}

      {/* 화면엔 안 보이지만 항상 렌더돼 있는 캡처용 쉬운 버전 카드.
          쉬운 버전 버튼을 누르는 순간 이미 DOM에 있는 이 노드를 그대로 캡처한다. */}
      {simpleSummary && (
        <div
          ref={simpleNodeRef}
          aria-hidden="true"
          style={{ position: 'absolute', left: '-9999px', top: 0, width: '860px' }}
        >
          <SimpleResultReport summary={simpleSummary} member={simpleMember} />
        </div>
      )}
    </div>
  );
}
