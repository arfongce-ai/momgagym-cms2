// [측정 준비 신호등 2026-11-16]
// 카메라를 쓰는 모든 측정 화면 위에 뜨는 작은 상태 막대.
// 두 인식 엔진이 보고한 값(captureQuality.js)만 읽는다 — 각 측정 화면 코드는 건드리지 않는다.
// 카메라가 꺼져 있으면(최근 1.2초 프레임 없음) 아무것도 안 보인다.
import React, { useEffect, useState } from 'react';
import { subscribeCapture, getCaptureLive } from './core/captureQuality';

const TONE = {
  good: { dot: '#10b981', box: 'bg-emerald-600/95', label: '준비 완료' },
  warn: { dot: '#f59e0b', box: 'bg-amber-500/95', label: '조정 필요' },
  bad: { dot: '#ef4444', box: 'bg-red-600/95', label: '측정 불가' },
};

function Chip({ item, name }) {
  if (!item || !item.text) return null;
  const t = TONE[item.level] || TONE.warn;
  return (
    <span className="flex items-center gap-1 whitespace-nowrap rounded-full bg-black/25 px-2 py-0.5 text-[11px] font-bold">
      <span className="h-2 w-2 rounded-full" style={{ background: t.dot }} />
      {name ? `${name} ` : ''}{item.text}
    </span>
  );
}

export default function CaptureReadinessBar() {
  const [live, setLive] = useState(() => getCaptureLive());
  useEffect(() => {
    const off = subscribeCapture(setLive);
    // 카메라가 꺼지면 구독 알림이 끊기므로 주기적으로 꺼짐 상태를 확인한다.
    const id = setInterval(() => setLive(getCaptureLive()), 700);
    return () => { off(); clearInterval(id); };
  }, []);
  if (!live) return null;
  const t = TONE[live.level] || TONE.warn;
  return (
    <div className="mb-2 flex justify-center" data-testid="capture-readiness"> {/* [2026-11-16] 화면 위에 떠서 측정종목 글자를 가리던 fixed 배치 → 일반 흐름(내용을 밀어냄)으로 변경 */}
      <div className={`w-full rounded-2xl px-3 py-2 text-white shadow-sm ${t.box}`}>
        <p className="text-center text-[13px] font-black leading-tight">
          {t.label}{live.level !== 'good' && live.frame.level !== 'good' ? ` · ${live.frame.text}` : ''}
        </p>
        <div className="mt-1 flex flex-wrap justify-center gap-1">
          <Chip item={{ ...live.frame, text: live.frame.level === 'good' ? '전신·거리' : '구도' }} />
          <Chip item={live.resolution} />
          <Chip item={live.fps} />
          {live.delegate.level !== 'good' && <Chip item={live.delegate} />}
        </div>
      </div>
    </div>
  );
}
