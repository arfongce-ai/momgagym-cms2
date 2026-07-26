// src/voice/commandRegistry.js
// "모미야" 음성 명령이 이동할 수 있는 8개 목적지.
// id는 functions/api/voice-command.js의 ALL_TOOLS destinationId와 반드시 같아야 한다
// (프론트/백엔드가 별도 번들이라 직접 import는 안 되고 값만 동기화해서 씀).

export const VOICE_DESTINATIONS = [
  { id: 'home', label: '홈', path: '/', adminOnly: false },
  { id: 'members', label: '회원관리', path: '/members', adminOnly: false },
  { id: 'schedule', label: '스케줄', path: '/schedule', adminOnly: false },
  { id: 'settings', label: '설정', path: '/settings', adminOnly: false },
  { id: 'trainers', label: '트레이너관리', path: '/trainers', adminOnly: true },
  { id: 'revenue', label: '매출관리', path: '/revenue', adminOnly: true },
  { id: 'ai_measure', label: 'AI측정', path: '/ai', adminOnly: false },
  { id: 'report', label: '리포트', path: '/report', adminOnly: false },
];

export function findDestination(id) {
  return VOICE_DESTINATIONS.find((d) => d.id === id) || null;
}
