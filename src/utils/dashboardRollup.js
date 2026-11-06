// utils/dashboardRollup.js — 대시보드 1주·1달 보기용 순수 집계 함수.
// 입력: Firestore dashboardDaily 문서 배열({date,revenue,newMembers,reports,activeMembers,byTrainer})
// 날짜는 'YYYY-MM-DD'(KST) 문자열. 문서가 없는 날은 0이 아니라 "수집 없음"(null)으로 둔다.

export function shiftYMD(ymd, days) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export function summarizeRange(dailyDocs, nDays, todayYMD) {
  const byDate = new Map((dailyDocs || []).map((d) => [d.date, d]));
  const days = [];
  for (let i = nDays - 1; i >= 0; i -= 1) {
    const date = shiftYMD(todayYMD, -i);
    const d = byDate.get(date) || null;
    days.push({
      date,
      has: !!d,
      revenue: d ? Number(d.revenue) || 0 : null,
      newMembers: d ? Number(d.newMembers) || 0 : null,
      reports: d ? Number(d.reports) || 0 : null,
      activeMembers: d && d.activeMembers != null ? Number(d.activeMembers) : null,
    });
  }
  const have = days.filter((d) => d.has);
  const sum = (k) => have.reduce((s, d) => s + (d[k] || 0), 0);
  const trainerMap = new Map();
  days.forEach((day) => {
    const d = byDate.get(day.date);
    if (!d || !d.byTrainer) return;
    Object.entries(d.byTrainer).forEach(([id, t]) => {
      const cur = trainerMap.get(id) || { id, name: t.name || id, revenue: 0 };
      cur.revenue += Number(t.revenue) || 0;
      trainerMap.set(id, cur);
    });
  });
  return {
    days,
    missing: days.length - have.length,
    totals: { revenue: sum('revenue'), newMembers: sum('newMembers'), reports: sum('reports') },
    avgRevenue: have.length ? Math.round(sum('revenue') / have.length) : 0,
    byTrainer: [...trainerMap.values()].sort((a, b) => b.revenue - a.revenue),
  };
}
