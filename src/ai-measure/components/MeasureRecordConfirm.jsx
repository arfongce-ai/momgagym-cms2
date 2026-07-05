// ai-measure/components/MeasureRecordConfirm.jsx
// ════════════════════════════════════════════════════════════════════════
//  공용 '측정완료 → 기록 → 확인·저장' 단계
//
//  AI 측정·분석의 모든 모듈(신체정보·자세·ROM·점프·바벨·보행 및 앞으로 추가될
//  측정)이 동일한 흐름을 갖도록 하는 재사용 컴포넌트.
//
//    측정 → [측정완료] → (이 컴포넌트) 기록 → [확인·저장] → 기록 확인(리포트)
//
//  이 컴포넌트는 '기록·확인·저장' 단계만 책임진다. 측정 자체와 최종 리포트는
//  각 모듈이 담당한다. 저장 동작(Firestore 쓰기)은 onConfirm 콜백으로 위임한다.
//
//  props:
//   · title        상단 제목(예: 'ROM 가동범위', '수직 점프')
//   · summaryRows  결과 요약 표시용 [{ label, value }] (측정완료 확인용)
//   · movementMode true 면 '움직임 기록' 셀렉트 노출(ROM·관절 측정용)
//   · noteMode     true 면 자유 메모 입력 노출(그 외 측정용)
//   · presets      movementMode 프리셋 목록(미지정 시 기본 전신 움직임)
//   · onConfirm(record)  확인 시 호출 → 실제 저장. record={ movement?, note? }
//   · onBack       '다시 측정'
//   · saving/saved/error  상위 저장 상태(버튼 라벨·안내 반영)
//
//  '확인·저장'을 누르면 즉시 onConfirm 이 실행되어 데이터가 자동 저장되고,
//  상위 모듈이 리포트 화면으로 전환해 기록을 바로 확인하게 한다.
// ════════════════════════════════════════════════════════════════════════
import { useState } from 'react';

// 전신 관절 움직임 프리셋(ROM·관절 측정 공통). 필요 시 props.presets 로 대체.
export const MOVEMENT_PRESETS = [
  '굴곡 (Flexion)', '신전 (Extension)', '과신전 (Hyperextension)',
  '외전 (Abduction)', '내전 (Adduction)',
  '내회전 (Internal rotation)', '외회전 (External rotation)',
  '회내 (Pronation)', '회외 (Supination)',
  '배측굴곡 (Dorsiflexion)', '족저굴곡 (Plantarflexion)',
  '외번 (Eversion)', '내번 (Inversion)',
  '측굴 (Lateral flexion)', '회전 (Rotation)',
  '올림 (Elevation)', '내림 (Depression)',
  '전인 (Protraction)', '후인 (Retraction)',
  '휘돌림 (Circumduction)',
  '요측편위 (Radial deviation)', '척측편위 (Ulnar deviation)',
  '대립 (Opposition)',
];

export default function MeasureRecordConfirm({
  title = '측정 기록',
  summaryRows = [],
  movementMode = false,
  noteMode = false,
  presets = MOVEMENT_PRESETS,
  onConfirm,
  onBack,
  saving = false,
  saved = false,
  error = false,
  confirmLabel = '확인 · 저장',
}) {
  const [movement, setMovement] = useState('');
  const [movementCustom, setMovementCustom] = useState('');
  const [note, setNote] = useState('');
  const effMovement = movement === '__custom' ? movementCustom.trim() : movement;

  const handleConfirm = () => {
    if (saving) return;
    onConfirm?.({
      movement: movementMode ? effMovement : undefined,
      note: noteMode ? note.trim() : undefined,
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="measure-back">← 다시 측정</button>
        <h2 className="measure-title">{title}</h2>
        <span className="w-12" />
      </div>

      {/* 측정완료 결과 요약 */}
      {summaryRows.length > 0 && (
        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4">
          <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-emerald-300/80">측정완료</p>
          <div className="grid grid-cols-2 gap-2">
            {summaryRows.map((r, i) => (
              <div key={i} className="rounded-lg bg-slate-900/50 px-3 py-2">
                <p className="text-[11px] text-slate-400">{r.label}</p>
                <p className="text-lg font-black tabular-nums text-emerald-200">{r.value}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 움직임 기록(ROM·관절) */}
      {movementMode && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4 space-y-2">
          <p className="text-xs font-black text-slate-300">측정한 움직임을 기록하세요</p>
          <select value={movement} onChange={(e) => setMovement(e.target.value)}
            className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2.5 text-sm font-bold text-slate-100">
            <option value="">움직임 선택</option>
            {presets.map((m) => <option key={m} value={m}>{m}</option>)}
            <option value="__custom">직접 입력…</option>
          </select>
          {movement === '__custom' && (
            <input type="text" value={movementCustom} onChange={(e) => setMovementCustom(e.target.value)}
              placeholder="예: 어깨 굴곡, 발목 외번, 목 좌측 회전"
              className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2.5 text-sm text-slate-100" />
          )}
          <p className="text-[11px] text-slate-500">같은 동작끼리 회차별로 비교됩니다. (선택 사항)</p>
        </div>
      )}

      {/* 자유 메모(그 외 측정) */}
      {noteMode && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4 space-y-2">
          <p className="text-xs font-black text-slate-300">측정 메모 (선택)</p>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2}
            placeholder="예: 컨디션, 특이사항, 촬영 조건 등"
            className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2.5 text-sm text-slate-100" />
        </div>
      )}

      {/* 확인·저장 */}
      <button onClick={handleConfirm} disabled={saving}
        className="w-full rounded-xl bg-amber-500 px-4 py-4 text-base font-black text-slate-950 disabled:bg-slate-700 disabled:text-slate-400 active:scale-[0.99]">
        {saving ? '저장 중…' : saved ? '✓ 저장됨 · 기록 확인' : confirmLabel}
      </button>
      {error && <p className="text-center text-xs text-red-400">저장에 실패했습니다. 다시 시도해 주세요.</p>}
      <p className="text-center text-[11px] text-slate-500">
        확인을 누르면 회원 측정이력에 자동 저장되고, 이어서 기록(리포트)을 확인합니다.
      </p>
    </div>
  );
}
