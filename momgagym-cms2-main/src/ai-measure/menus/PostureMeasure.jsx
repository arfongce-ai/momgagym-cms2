// ai-measure/menus/PostureMeasure.jsx
// 메뉴 1: 자세·체형 측정 — 재설계 예정(기존 구현 전면 삭제됨).
// 현재 registry에서 'planned' 상태라 메뉴에 노출되지 않는다.
// 새 설계를 이 파일에 처음부터 작성한다.

export default function PostureMeasure({ member, onSave, onBack }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="measure-back">← 메뉴</button>
        <h2 className="measure-title">자세 · 체형 측정</h2>
        <span className="w-12" />
      </div>
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 text-center">
        <p className="text-slate-400 text-sm">재설계 예정입니다.</p>
      </div>
    </div>
  );
}
