// [측정 방법 팝업 2026-11-24] 측정 메뉴를 열 때 순서·설명을 팝업으로 보여준다.
//  '일주일간 보지 않기'를 누르면 그 메뉴는 7일 동안 자동으로 뜨지 않는다(기기별 저장).
//  자동으로 안 뜰 때도 "측정 방법" 버튼으로 언제든 다시 열 수 있다.
import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { getMeasureHowTo, shouldShowHowTo, snoozeHowTo } from '../core/measureHowTo';

const storageOrNull = () => { try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch (e) { return null; } };

export default function MeasureHowToPopup({ menuId }) {
  const guide = getMeasureHowTo(menuId);
  const [open, setOpen] = useState(() => shouldShowHowTo(storageOrNull(), menuId));
  // 다른 측정 메뉴로 바뀌면 그 메뉴 기준으로 다시 판단한다.
  useEffect(() => { setOpen(shouldShowHowTo(storageOrNull(), menuId)); }, [menuId]);
  if (!guide) return null;

  const close = () => setOpen(false);
  const snooze = () => { snoozeHowTo(storageOrNull(), menuId); setOpen(false); };

  return (
    <>
      <div className="mb-2 flex justify-end">
        <button type="button" onClick={() => setOpen(true)} data-testid="howto-open"
          className="rounded-full border border-slate-300 px-3 py-1 text-[11px] font-bold text-slate-600 dark:border-slate-600 dark:text-slate-300">
          측정 방법
        </button>
      </div>
      {open && createPortal(
        <div className="fixed inset-0 z-[100000] flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" data-testid="howto-popup">
          <div className="max-h-[85vh] w-full max-w-sm overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl ring-1 ring-slate-300 dark:bg-slate-900 dark:ring-slate-700">
            <p className="text-base font-black text-slate-900 dark:text-slate-100">{guide.title} · 측정 방법</p>
            <ol className="mt-3 space-y-2">
              {guide.steps.map((step, i) => (
                <li key={step} className="flex gap-2 text-sm leading-snug text-slate-800 dark:text-slate-200">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-500 text-[11px] font-black text-slate-950">{i + 1}</span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
            {guide.note && <p className="mt-3 text-xs font-semibold text-slate-500 dark:text-slate-400">※ {guide.note}</p>}
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button type="button" onClick={snooze} data-testid="howto-snooze"
                className="rounded-xl border-2 border-slate-300 py-3 text-xs font-bold text-slate-700 dark:border-slate-600 dark:text-slate-200">
                일주일간 보지 않기
              </button>
              <button type="button" onClick={close} data-testid="howto-close"
                className="rounded-xl bg-amber-500 py-3 text-sm font-black text-slate-950">
                확인
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
