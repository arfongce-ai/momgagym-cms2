// ai-measure/menus/ImagingMeasure.jsx
// 메뉴: 근골격계 영상 판독 (X-ray · CT · 초음파 · MRI).
//  다른 측정처럼 카메라·MediaPipe로 값을 계산하는 도구가 아니라, 담당자가
//  올린 영상(파일 업로드 또는 DICOM)에 직접 각도/거리를 재고 소견을 태그하는
//  "내부 참고용 판독 보조 도구"다. 엔진 자체(캔버스 렌더링·DICOM 파싱·측정
//  로직, 약 1,500줄)는 이미 별도로 광범위하게 테스트된 단일 HTML 산출물이라,
//  React로 다시 옮겨 적기보다 같은 출처(public/imaging-tool.html)를 iframe으로
//  그대로 구동하고, 결과만 postMessage로 받아 이 화면이 공용 저장 흐름
//  (MEASURE_FLOW.md: 측정 → 측정완료 → 기록 → 확인·저장)에 연결한다.
//   · iframe은 같은 출처(same-origin)라 CORS/CSP 문제가 없다.
//   · 이 도구는 회원 카메라 캡처가 아니라 "이미 촬영된" 영상 판독이라, 어떤
//     회원 것인지는 저장 단계(이 화면)에서만 필요하다 — 엔진 자체는 회원 정보를
//     몰라도 된다(관심사 분리).
import { useEffect, useRef, useState } from 'react';
import MeasureRecordConfirm from '../components/MeasureRecordConfirm.jsx';

const IMAGING_TOOL_SRC = '/imaging-tool.html';

export default function ImagingMeasure({ member, onSave, onBack }) {
  const [view, setView] = useState('measure'); // 'measure' | 'record' | 'saved'
  const [pending, setPending] = useState(null); // iframe에서 받은 결과 payload
  const [iframeKey, setIframeKey] = useState(0); // 값을 바꾸면 iframe이 새로 마운트(도구 초기화)
  const [saveState, setSaveState] = useState('idle'); // idle | saving | saved | error
  const iframeRef = useRef(null);

  useEffect(() => {
    function onMessage(e) {
      // 같은 출처(same-origin)로만 서빙되므로 origin도 함께 확인한다.
      if (e.origin !== window.location.origin) return;
      const data = e.data;
      if (!data || data.source !== 'momgagym-imaging-tool' || data.type !== 'IMAGING_RESULT') return;
      setPending(data.payload || null);
      setSaveState('idle');
      setView('record');
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const summaryRows = pending ? [
    { label: '파일', value: pending.fileName || '-' },
    { label: '측정/소견 기록', value: `${pending.annotationCount || 0}건` },
    { label: '보정 상태', value: pending.calibration ? `${pending.calibration.pixelsPerMM.toFixed(2)} px/mm (${pending.calibration.source})` : '미보정 (px 단위)' },
    { label: '종합 소견', value: pending.summaryHeadline || '특이 소견 없음' },
  ] : [];

  const backToTool = () => setView('measure');

  const handleConfirm = async (record) => {
    if (!member) { alert('저장하려면 먼저 회원을 선택하거나, 미등록회원 신체정보를 입력해 주세요(허브 상단).'); return; }
    setSaveState('saving');
    try {
      // Firestore는 undefined 필드를 거부하므로 JSON 왕복으로 안전하게 정리한다.
      const cleanPayload = JSON.parse(JSON.stringify({
        fileName: pending?.fileName || null,
        imageWidth: pending?.imageWidth || null,
        imageHeight: pending?.imageHeight || null,
        modality: pending?.modality || null,
        calibration: pending?.calibration || null,
        annotationCount: pending?.annotationCount || 0,
        summaryHeadline: pending?.summaryHeadline || null,
        summaryText: pending?.summaryText || null,
        annotations: pending?.annotations || [],
        note: record?.note || '',
      }));
      await onSave?.(cleanPayload);
      setSaveState('saved');
      setView('saved');
    } catch (e) {
      console.warn('[ImagingMeasure] 저장 실패:', e?.code || e?.message);
      setSaveState('error');
    }
  };

  const startNew = () => {
    setPending(null);
    setSaveState('idle');
    setIframeKey((k) => k + 1); // 도구를 완전히 새로 불러와 이전 판독 상태를 지운다
    setView('measure');
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="measure-back">← 메뉴</button>
        <h2 className="measure-title">근골격계 영상 판독</h2>
        <span className="w-12" />
      </div>

      {!member && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          회원을 선택하지 않으면 미등록회원으로 저장됩니다. 저장하려면 허브 상단에서 회원을 선택하거나 미등록회원 신체정보를 입력하세요.
        </div>
      )}

      {/* 도구 화면은 언마운트하지 않고 숨김만 처리 — '다시 판독'으로 돌아가도
          이미지·측정 상태가 그대로 유지된다. */}
      <div style={{ display: view === 'measure' ? 'block' : 'none' }}>
        <iframe
          key={iframeKey}
          ref={iframeRef}
          src={IMAGING_TOOL_SRC}
          title="근골격계 영상 판독 도구"
          className="w-full rounded-2xl border border-slate-200 dark:border-slate-800"
          style={{ height: 'calc(100vh - 220px)', minHeight: 560 }}
        />
        <p className="mt-2 text-[11px] text-slate-500 leading-relaxed">
          영상을 불러와 측정·소견 태그를 마친 뒤, 도구 안의 <strong className="text-slate-700 dark:text-slate-300">"CMS로 전송 · 회원 기록에 저장"</strong> 버튼을 누르면 이 화면으로 결과가 넘어옵니다.
        </p>
      </div>

      {view === 'record' && pending && (
        <MeasureRecordConfirm
          title="근골격계 영상 판독"
          summaryRows={summaryRows}
          noteMode
          onConfirm={handleConfirm}
          onBack={backToTool}
          saving={saveState === 'saving'}
          saved={saveState === 'saved'}
          error={saveState === 'error'}
        />
      )}

      {view === 'saved' && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-center">
            <p className="text-lg font-black text-emerald-700 dark:text-emerald-300">✓ 저장되었습니다</p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {member?.isVirtual ? '미등록회원 측정 기록으로' : `${member?.name || '회원'}님의 측정이력으로`} 저장되었습니다.
            </p>
          </div>
          <button onClick={startNew}
            className="w-full rounded-xl bg-amber-500 px-4 py-4 text-base font-black text-slate-950 active:scale-[0.99]">
            새 영상 판독 시작
          </button>
          <button onClick={onBack}
            className="w-full rounded-xl border border-slate-300 dark:border-slate-700 px-4 py-3 text-sm font-bold text-slate-600 dark:text-slate-300">
            메뉴로 돌아가기
          </button>
        </div>
      )}
    </div>
  );
}
