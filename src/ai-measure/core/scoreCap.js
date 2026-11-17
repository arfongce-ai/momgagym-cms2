// 확정 판정 상한 규칙: 측정 단계에서 이미 위험/주의로 확정된 리포트는 세부 지표 평균이 높아도 그 등급 범위를 넘지 않는다(위험≤59, 주의≤79).
export function capScoreByStatus(score, status) {
  if (score == null) return null;
  if (status === 'risk') return Math.min(score, 59);
  if (status === 'caution') return Math.min(score, 79);
  return score;
}
