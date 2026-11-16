// [촬영 기준 안내 2026-11-16]
// 카메라 측정 화면 맨 위에 "이렇게 찍어야 값이 맞습니다" 기준을 짧게 고정 표시한다.
// 기본은 한 줄, 누르면 측정별 상세 기준이 펼쳐진다. 접힘 상태는 기기에 기억한다.
import React, { useState } from 'react';

// 카메라로 관절을 인식하는 측정(품질 신호등·품질 등급 대상)
export const CAMERA_MEASURE_IDS = new Set(['posture', 'rom', 'gait', 'sprint', 'jump', 'broadjump', 'lifting', 'stance', 'squat']);
// 시간·속도를 프레임으로 재는 측정 — 프레임 속도가 부족하면 오차가 커서 더 엄격히 본다
export const TIMING_MEASURE_IDS = new Set(['gait', 'sprint', 'jump', 'broadjump', 'lifting']);

const COMMON = [
  '폰을 삼각대에 고정(손으로 들면 흔들림 오차)',
  '머리부터 발끝까지 화면 안에, 위아래 여유 한 뼘',
  '밝은 곳에서, 화면에는 측정자 한 명만',
  '몸에 붙는 옷(헐렁한 옷은 관절 위치가 틀어짐)',
];

export const MEASURE_TIPS = {
  posture: ['카메라와 최소 1.8m(1,800mm) 이상 · 카메라 높이 약 1m(배꼽 높이)', '정면 → 측면 → 후면 순서로 모두 촬영(측면이 없으면 거북목·굽은 등 계산 불가)', '양발을 어깨너비로 편하게, 정면 응시'],
  rom: ['움직이는 관절이 카메라와 수직이 되게(어깨 굴곡은 측면)', '거리 2~2.5m, 움직이는 팔·다리가 화면 밖으로 나가지 않게'],
  gait: ['트레드밀 옆(측면) 또는 뒤(후면) 2~3m', '발이 벨트에 닿는 모습이 잘리지 않게', '속도가 안정된 뒤 20걸음 이상'],
  sprint: ['출발선~끝선이 모두 보이도록 측면 멀리', '카메라는 달리는 방향과 수직', '역광(창문 정면)은 피하기'],
  jump: ['측면 2.5~3m, 점프 최고점까지 머리가 잘리지 않게 위쪽 여유', '착지 지점이 화면 안에'],
  broadjump: ['측면 3m 이상, 출발~착지 전체가 화면 안에', '바닥 기준선(테이프)이 보이게'],
  lifting: ['측면에서 바벨 끝(원판)이 잘 보이게', '카메라와 최소 3.2m(3,200mm) 이상, 바벨 양 끝과 경로 전체가 화면 안에'],
  stance: ['정면 최소 1.8m(1,800mm) 이상, 양팔·양발이 모두 보이게', '주변에 기댈 곳 확보(안전)'],
  squat: ['정면 1회 + 측면 1회 촬영', '팔을 머리 위로 뻗었을 때 손끝까지 화면 안에'],
};

const KEY = 'momgagym.captureGuide.open';

export default function CaptureGuideStrip({ menuId }) {
  const [open, setOpen] = useState(() => {
    try { return localStorage.getItem(KEY) === '1'; } catch (e) { return false; }
  });
  const toggle = () => {
    setOpen((v) => {
      const next = !v;
      try { localStorage.setItem(KEY, next ? '1' : '0'); } catch (e) { /* 저장 불가 기기 무시 */ }
      return next;
    });
  };
  const tips = MEASURE_TIPS[menuId] || [];
  return (
    <div className="mb-2 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 dark:border-sky-500/30 dark:bg-sky-500/10" data-testid="capture-guide">
      <button type="button" onClick={toggle} className="flex w-full items-center justify-between gap-2 text-left">
        <span className="text-xs font-black text-sky-900 dark:text-sky-100">
          📏 촬영 기준 · 삼각대 고정 · 전신 · 밝게 · 한 명만
        </span>
        <span className="shrink-0 text-[11px] font-bold text-sky-700 dark:text-sky-300">{open ? '접기' : '자세히'}</span>
      </button>
      {open && (
        <ul className="mt-2 space-y-1">
          {[...tips, ...COMMON].map((t) => (
            <li key={t} className="flex gap-1.5 text-[11px] leading-snug text-sky-900 dark:text-sky-100">
              <span>•</span><span>{t}</span>
            </li>
          ))}
          <li className="pt-1 text-[10px] text-sky-700 dark:text-sky-300">화면 위 신호등이 초록일 때 시작하세요.</li>
        </ul>
      )}
    </div>
  );
}
