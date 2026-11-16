// MuscleAtlas.jsx — 근육 도감 화면 (2026-11-16)
// 47개 근육 그림(빨강=긴장·단축 / 파랑=약화·이완). 검색·부위 필터·큰 그림 보기.
import React, { useMemo, useState } from 'react';
import { ATLAS_GROUPS, MUSCLE_ATLAS, muscleImageSrc, muscleAnimSrc } from '../core/muscleAtlas';

export default function MuscleAtlas({ onClose, initialNo = null }) {
  const [q, setQ] = useState('');
  const [group, setGroup] = useState('all');
  const [openNo, setOpenNo] = useState(initialNo);
  const [kind, setKind] = useState('tight');

  const list = useMemo(() => {
    const t = q.trim();
    return MUSCLE_ATLAS.filter((m) => (group === 'all' || m.group === group) && (!t || m.name.includes(t)));
  }, [q, group]);
  const open = MUSCLE_ATLAS.find((m) => m.no === openNo) || null;

  return (
    <div className="fixed inset-0 z-[90] flex flex-col bg-white dark:bg-slate-950" role="dialog" aria-label="근육 도감">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800"
        style={{ paddingTop: 'calc(env(safe-area-inset-top) + 12px)' }}>
        <button type="button" onClick={onClose} className="text-sm font-bold text-slate-700 dark:text-slate-200">← 닫기</button>
        <h2 className="text-sm font-black text-slate-900 dark:text-white">근육 도감 ({MUSCLE_ATLAS.length})</h2>
        <span className="w-10" />
      </div>

      {open ? (
        <div className="flex-1 overflow-y-auto p-4">
          <button type="button" onClick={() => setOpenNo(null)} className="mb-2 text-xs font-bold text-slate-500">← 목록</button>
          <h3 className="text-center text-lg font-black text-slate-900 dark:text-white">{open.name}</h3>
          <div className="mx-auto mt-2 flex w-fit overflow-hidden rounded-full border border-slate-300 text-xs font-bold dark:border-slate-700">
            <button type="button" onClick={() => setKind('tight')} className={`px-4 py-1.5 ${kind === 'tight' ? 'bg-red-500 text-white' : 'text-slate-600 dark:text-slate-300'}`}>긴장·단축</button>
            <button type="button" onClick={() => setKind('weak')} className={`px-4 py-1.5 ${kind === 'weak' ? 'bg-blue-500 text-white' : 'text-slate-600 dark:text-slate-300'}`}>약화·이완</button>
          </div>
          <div className="mx-auto mt-3 max-w-[420px] rounded-xl bg-white p-2 dark:bg-slate-100">
            <img src={muscleImageSrc(open.no, kind)} alt={`${open.name} ${kind === 'weak' ? '약화' : '긴장'}`} className="block w-full" />
          </div>
          {muscleAnimSrc(open.no) && (
            <video key={open.no} src={muscleAnimSrc(open.no)} className="mx-auto mt-4 block w-full max-w-[420px] rounded-xl bg-white"
              autoPlay loop muted playsInline controls preload="metadata" />
          )}
          <p className="mt-3 text-center text-[11px] text-slate-500">빨강은 긴장·단축 쪽, 파랑은 약해지기 쉬운 쪽 표시입니다. 참고용 그림입니다.</p>
        </div>
      ) : (
        <>
          <div className="space-y-2 px-4 py-3">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="근육 이름 검색 (예: 둔근)"
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-white" />
            <div className="flex flex-wrap gap-1.5">
              {[{ id: 'all', label: '전체' }, ...ATLAS_GROUPS].map((g) => (
                <button key={g.id} type="button" onClick={() => setGroup(g.id)}
                  className={`rounded-full px-3 py-1 text-xs font-bold ${group === g.id ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>
                  {g.label}
                </button>
              ))}
            </div>
          </div>
          <div className="grid flex-1 grid-cols-2 gap-2 overflow-y-auto px-4 pb-6 sm:grid-cols-3 md:grid-cols-4">
            {list.map((m) => (
              <button key={m.no} type="button" onClick={() => { setKind('tight'); setOpenNo(m.no); }}
                className="rounded-xl border border-slate-200 bg-white p-2 text-center active:scale-[0.98] dark:border-slate-700 dark:bg-slate-100">
                <img src={muscleImageSrc(m.no, 'tight')} alt="" loading="lazy" className="mx-auto block h-32 w-full object-contain" />
                <span className="mt-1 block text-xs font-black text-slate-800">{m.name}</span>
              </button>
            ))}
            {!list.length && <p className="col-span-full py-8 text-center text-sm text-slate-500">검색 결과가 없습니다.</p>}
          </div>
        </>
      )}
    </div>
  );
}
