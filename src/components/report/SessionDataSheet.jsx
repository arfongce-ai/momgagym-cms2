// 결과리포트 > 저장된 측정 기록 "원본 결과 보기" (2026-11-16)
//  전용 리포트 화면이 없는 측정(심폐·1RM·VBT·RSI·스프린트·스쿼트 등)도 저장된 값을 숫자로 바로 볼 수 있게 한다.
//  "공유"만 있고 결과 데이터가 안 보여 상담·비교가 어렵다는 현장 피드백 대응.
//  · 숫자/문자 값만 한글 이름표로 정리해서 보여준다(좌표·시계열·영상 등 큰 데이터는 제외).
//  · 이전 회차가 있으면 같은 항목의 변화량(▲▼)을 함께 표시해 비교를 돕는다.
import React, { useMemo } from 'react';

const SKIP_KEYS = new Set([
  'landmarks', 'frames', 'series', 'raw', 'samples', 'timeline', 'video', 'videoBlob', 'snapshotUrl', 'localPreviewUrl',
  'perViewSnapshots', 'momiNote', 'member', 'cross_measure_context', 'capture', 'recognition', 'trials', 'rawSeconds', 'seconds',
]);

const LABELS = {
  oneRM: '1RM(추정)', weight: '중량(kg)', reps: '반복 횟수', liftLabel: '종목', rsi: 'RSI', heightCm: '높이(cm)',
  meanVelocity: '평균속도(m/s)', peakVelocity: '최고속도(m/s)', zone: '구간', distanceCm: '이동거리(cm)',
  peakPower: '최대 파워(W)', vo2max: 'VO2max(mL/kg/min)', confirmedVo2max: '확정 VO2max', machineLabel: '장비', protocolLabel: '프로토콜',
  avgHr: '평균 심박', maxHr: '최고 심박', durationSec: '시간(초)', score: '점수', status: '판정', measuredAt: '측정 시각',
  cadence: '케이던스', leg: '다리', mode: '모드',
};

const MAX_DEPTH = 3;

function flatten(obj, prefix = '', depth = 0, out = []) {
  if (!obj || typeof obj !== 'object' || depth > MAX_DEPTH) return out;
  for (const [k, v] of Object.entries(obj)) {
    if (SKIP_KEYS.has(k) || k.startsWith('_')) continue;
    const path = prefix ? `${prefix}.${k}` : k;
    if (v == null || typeof v === 'function') continue;
    if (typeof v === 'number') { if (Number.isFinite(v)) out.push([path, k, v]); continue; }
    if (typeof v === 'string') { if (v.length <= 60 && !/^data:|^blob:/.test(v)) out.push([path, k, v]); continue; }
    if (typeof v === 'boolean') { out.push([path, k, v ? '예' : '아니오']); continue; }
    if (Array.isArray(v)) continue; // 배열(시계열)은 제외
    flatten(v, path, depth + 1, out);
  }
  return out;
}

function fmt(v) {
  if (typeof v !== 'number') return String(v);
  return Math.abs(v) >= 100 ? String(Math.round(v)) : String(Math.round(v * 100) / 100);
}

export function sessionRows(data) {
  return flatten(data || {});
}

export default function SessionDataSheet({ session, previous, title, member, onClose }) {
  const rows = useMemo(() => sessionRows(session?.data), [session]);
  const prevMap = useMemo(() => Object.fromEntries(sessionRows(previous?.data).map(([p, , v]) => [p, v])), [previous]);
  if (!session) return null;
  return (
    <div className="mx-auto w-full max-w-[794px] p-4">
      <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <p className="text-[11px] font-bold text-slate-500">{member?.name || '회원'} · {String(session.recordedAtFull || session.recordedAt || '').slice(0, 16).replace('T', ' ')}</p>
        <p className="mt-1 text-lg font-black text-slate-900 dark:text-white">{title || session.menuTitle || session.menu}</p>
        <p className="mt-1 text-[11px] text-slate-500">
          저장 위치: 이 회원의 측정 이력(AI 측정 이력 &gt; {session.menuTitle || session.menu}) · 같은 화면에서 언제든 다시 열 수 있습니다.
        </p>
      </div>
      <div className="mt-3 overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        {rows.length === 0 && <p className="p-4 text-sm text-slate-500">표시할 숫자 결과가 없습니다.</p>}
        {rows.map(([path, key, value]) => {
          const prev = prevMap[path];
          const delta = typeof value === 'number' && typeof prev === 'number' ? Math.round((value - prev) * 100) / 100 : null;
          return (
            <div key={path} className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-2.5 last:border-0 dark:border-slate-800">
              <span className="min-w-0 break-keep text-[12px] font-bold text-slate-600 dark:text-slate-300">{LABELS[key] || path}</span>
              <span className="shrink-0 text-right">
                <span className="font-mono text-sm font-black text-slate-900 dark:text-white">{fmt(value)}</span>
                {delta != null && delta !== 0 && (
                  <span className={`ml-2 text-[10px] font-bold ${delta > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                    {delta > 0 ? '▲' : '▼'}{Math.abs(delta)}
                  </span>
                )}
              </span>
            </div>
          );
        })}
      </div>
      {previous && <p className="mt-2 text-[11px] text-slate-500">▲▼ = 바로 이전 회차 대비 변화</p>}
      {onClose && <button onClick={onClose} className="mt-4 w-full rounded-xl border border-slate-300 py-2.5 text-sm font-bold text-slate-700 dark:border-slate-700 dark:text-slate-200">닫기</button>}
    </div>
  );
}
