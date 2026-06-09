// ai-measure/menus/HeightField.jsx
// 키(cm) 입력 + 명확한 "적용" 버튼 공통 컴포넌트.
//  - 입력 후 [적용]을 눌러야 확정된다(검증: 80~250cm).
//  - 확정되면 ✓ 표시. 회원 기록에서 불러온 값이면 안내.
// props:
//   value    : 현재 확정된 키(cm) 또는 ''
//   onChange : 확정 시 숫자를 넘겨주는 콜백
//   member   : 회원(키 기록 자동 표시용)
//   hint     : 보조 설명
import { useState, useEffect } from 'react';

export default function HeightField({ value, onChange, member, hint = 'cm 환산에 사용' }) {
  const [input, setInput] = useState(value || '');
  useEffect(() => { setInput(value || ''); }, [value]);

  const apply = () => {
    const n = Number(input);
    if (!n || n < 80 || n > 250) {
      alert('키를 80~250cm 사이로 입력한 뒤 [적용]을 누르세요.');
      return;
    }
    onChange?.(n);
  };

  const applied = value && Number(value) === Number(input);
  const fromRecord = member?.height && Number(value) === Number(member.height);

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3 space-y-2">
      <label className="block text-xs font-semibold text-slate-400 uppercase tracking-widest">키 (cm)</label>
      <div className="flex items-center gap-2">
        <input
          type="number" inputMode="numeric" value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="예: 170"
          className="flex-1 bg-slate-800 border border-slate-700 text-slate-100 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-amber-500"
        />
        <button onClick={apply}
          className="shrink-0 px-5 py-2 rounded-lg bg-amber-500 text-slate-950 text-sm font-black active:scale-95">
          적용
        </button>
      </div>
      <div className="flex items-center gap-2 min-h-[16px]">
        {applied && <span className="text-[11px] text-emerald-400 font-bold">✓ {value}cm 적용됨</span>}
        {fromRecord && <span className="text-[10px] text-emerald-400/80">회원 기록에서 불러옴</span>}
        {!applied && <span className="text-[10px] text-slate-500">{hint} · 입력 후 [적용]을 눌러주세요</span>}
      </div>
    </div>
  );
}
