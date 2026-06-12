// components/common/MemberPicker.jsx
// 검색 가능한 회원 선택기. 이름/초성으로 즉시 필터링한다.
import { useState, useMemo, useRef, useEffect } from 'react';

function getChosung(str) {
  const cs = ['ㄱ','ㄲ','ㄴ','ㄷ','ㄸ','ㄹ','ㅁ','ㅂ','ㅃ','ㅅ','ㅆ','ㅇ','ㅈ','ㅉ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];
  return [...String(str || '')].map(c => {
    const code = c.charCodeAt(0) - 0xAC00;
    return code >= 0 && code <= 11171 ? cs[Math.floor(code / 588)] : c;
  }).join('');
}

export default function MemberPicker({ members, value, onChange, placeholder = '이름 / 초성 검색', allowNone = true, noneLabel = '선택 안 함' }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);

  const selected = members.find(m => m.id === value);

  // 바깥 클릭 시 닫기
  useEffect(() => {
    const h = e => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim();
    if (!q) return members;
    const qU = q.toUpperCase();
    return members.filter(m => {
      const name = m.name || '';
      const cs = getChosung(name);
      const tail = (m.phone || '').replace(/-/g, '').slice(-4);
      return name.includes(q) || cs.includes(qU) || tail.includes(q.replace(/-/g, ''));
    });
  }, [members, query]);

  const pick = (m) => {
    onChange(m ? m.id : '');
    setOpen(false);
    setQuery('');
  };

  return (
    <div ref={boxRef} className="relative">
      {/* 선택 표시 / 토글 버튼 */}
      <button type="button" onClick={() => setOpen(o => !o)}
        className="input w-full text-left flex items-center justify-between">
        <span className={selected ? 'text-slate-100' : 'text-slate-500'}>
          {selected ? `${selected.name}${selected.phone ? ` (${selected.phone.slice(-4)})` : ''}` : noneLabel}
        </span>
        <span className="text-slate-500 text-xs ml-2">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="absolute z-30 mt-1 w-full bg-slate-900 border border-slate-700 rounded-xl shadow-xl overflow-hidden">
          {/* 검색창 */}
          <div className="p-2 border-b border-slate-800">
            <input autoFocus value={query} onChange={e => setQuery(e.target.value)}
              placeholder={placeholder}
              className="w-full bg-slate-800 border border-slate-700 text-slate-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-500" />
          </div>
          {/* 목록 */}
          <div className="max-h-60 overflow-y-auto">
            {allowNone && (
              <button type="button" onClick={() => pick(null)}
                className="w-full text-left px-3 py-2 text-sm text-slate-400 hover:bg-slate-800 transition-colors">
                {noneLabel}
              </button>
            )}
            {filtered.length === 0 ? (
              <p className="px-3 py-4 text-center text-xs text-slate-600">검색 결과가 없습니다</p>
            ) : (
              filtered.map(m => (
                <button key={m.id} type="button" onClick={() => pick(m)}
                  className={`w-full text-left px-3 py-2 text-sm transition-colors hover:bg-slate-800
                    ${m.id === value ? 'bg-amber-500/10 text-amber-400' : 'text-slate-200'}`}>
                  <span className="font-semibold">{m.name}</span>
                  {m.phone && <span className="text-slate-500 text-xs ml-2">{m.phone.slice(-4)}</span>}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
