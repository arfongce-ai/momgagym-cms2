// ai-measure/registry.js
// 측정 메뉴 레지스트리. 여기에 등록하면 허브에 자동으로 나타난다.
// status: 'ready'(구동) | 'planned'(준비중, 비활성 표시)
// 새 메뉴 추가 시: menus/ 에 컴포넌트 만들고 → 여기에 한 줄 등록.
import { lazy } from 'react';

export const MEASURE_MENUS = [
  {
    id: 'posture',
    no: 1,
    title: '자세 · 체형 측정',
    desc: '재설계 예정',
    icon: '🧍',
    status: 'planned',
  },
  {
    id: 'onerm',
    no: 5,
    title: '1RM 추정',
    desc: '벤치·스쿼트·데드리프트 · 무게×횟수',
    icon: '🏋️',
    status: 'ready',
    component: lazy(() => import('./menus/OneRMEstimate.jsx')),
  },
  {
    id: 'timer',
    no: 11,
    title: '초시계 · 메트로놈',
    desc: '초시계 · 타이머 · 메트로놈',
    icon: '⏱️',
    status: 'ready',
    component: lazy(() => import('./menus/TimerTool.jsx')),
  },
  {
    id: 'rsi',
    no: 4,
    title: 'RSI',
    desc: '반응강도지수 · 체공/접지 시간',
    icon: '⚡',
    status: 'ready',
    component: lazy(() => import('./menus/RsiMeasure.jsx')),
  },
  {
    id: 'vbt',
    no: 7,
    title: 'VBT',
    desc: '속도 기반 트레이닝 · 거리/시간',
    icon: '📈',
    status: 'ready',
    component: lazy(() => import('./menus/VbtMeasure.jsx')),
  },
  {
    id: 'jump',
    no: 3,
    title: '점프',
    desc: '반동점프 · 카메라/고속영상/수동 · 자동 측정',
    icon: '🦘',
    status: 'ready',
    component: lazy(() => import('./menus/JumpAnalysisHub.jsx')),
  },
  {
    id: 'body',
    no: 12,
    title: '신체 정보',
    desc: '키·몸무게·혈압 (2026 지침 분석)',
    icon: '📋',
    status: 'ready',
    component: lazy(() => import('./menus/BodyInfoMeasure.jsx')),
  },
  // ── 이후 단계적으로 추가 (현재는 준비중 표시) ──
  { id: 'record',  no: 0,  title: '일반 영상 녹화',   desc: '카메라 녹화 · 저장',           icon: '🎥', status: 'ready', component: lazy(() => import('./menus/RecordMeasure.jsx')) },
  { id: 'rom',     no: 2,  title: 'ROM 좌우 비교',    desc: '관절가동범위 · 좌우 대칭',     icon: '🔄', status: 'planned' },
  { id: 'throw',   no: 6,  title: '슬램 & 던지기',    desc: '가속도·파워·시속',             icon: '💥', status: 'planned' },
  { id: 'lifting', no: 8,  title: '역도',             desc: '스내치·저크 · 바벨 추적',      icon: '🏋️', status: 'ready', component: lazy(() => import('./menus/LiftingMeasure.jsx')) },
  { id: 'swing',   no: 9,  title: '스윙',             desc: '골프·배트 · ROM·속도',         icon: '🏌️', status: 'planned' },
  { id: 'gait',    no: 10, title: '보행 & 러닝',      desc: '측면·후면 · 각도·케이던스·주기',  icon: '🏃', status: 'ready', component: lazy(() => import('./menus/GaitAnalysisHub.jsx')) },
];
