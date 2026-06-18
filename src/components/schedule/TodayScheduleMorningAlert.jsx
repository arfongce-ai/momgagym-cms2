import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { store } from '../../demoData';
import { todayYMD } from '../../utils/dates';

const MORNING_START_HOUR = 6;
const MORNING_END_HOUR = 12;

const STATUS_LABEL = {
  scheduled: '예정',
  attended: '출석',
  canceled: '취소',
  noshow: '노쇼',
};

function isMorningOpenTime(now = new Date()) {
  const hour = now.getHours();
  return hour >= MORNING_START_HOUR && hour < MORNING_END_HOUR;
}

function getVisibleSchedules(user, today) {
  const trainerId = user?.role === 'trainer' ? (user.trainerId || user.id) : null;
  return store.getSchedules()
    .filter(s => s.date === today)
    .filter(s => s.status !== 'canceled')
    .filter(s => !trainerId || s.trainerId === trainerId)
    .sort((a, b) => `${a.startTime || ''}`.localeCompare(`${b.startTime || ''}`));
}

export default function TodayScheduleMorningAlert({ user }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const today = todayYMD();

  const storageKey = useMemo(() => (
    user?.id ? `fitcms_today_schedule_seen_${user.id}_${today}` : null
  ), [user?.id, today]);

  const schedules = useMemo(() => (
    user ? getVisibleSchedules(user, today) : []
  ), [user, today]);

  useEffect(() => {
    if (!user || !storageKey || !isMorningOpenTime()) return;
    if (localStorage.getItem(storageKey) === '1') return;
    setOpen(true);
  }, [user, storageKey]);

  const markSeen = () => {
    if (storageKey) localStorage.setItem(storageKey, '1');
  };

  const close = () => {
    markSeen();
    setOpen(false);
  };

  const goSchedule = () => {
    markSeen();
    setOpen(false);
    navigate('/schedule');
  };

  if (!open) return null;

  return (
    <div className="modal-overlay z-[70]">
      <div className="modal-box max-w-md">
        <div className="px-5 py-4 border-b border-slate-800">
          <p className="text-xs font-bold uppercase tracking-widest text-amber-400">Morning Brief</p>
          <h2 className="text-xl font-black mt-1">오늘 수업 스케줄</h2>
          <p className="text-xs text-slate-500 mt-1">{today} · 오늘 하루 한 번만 표시됩니다</p>
        </div>

        <div className="modal-body px-5 py-4">
          {schedules.length === 0 ? (
            <div className="rounded-xl border border-slate-800 bg-slate-900/70 px-4 py-5 text-center">
              <p className="font-bold text-slate-200">오늘 예정된 수업이 없습니다.</p>
              <p className="text-xs text-slate-500 mt-1">아침 확인 완료</p>
            </div>
          ) : (
            <div className="space-y-2">
              {schedules.map(s => {
                const title = s.isExternal || !s.memberId
                  ? (s.memo || s.classType || '외부 일정')
                  : s.memberName;
                return (
                  <div key={s.id} className="flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-900 px-3 py-3">
                    <div className="w-1.5 h-11 rounded-full flex-shrink-0" style={{ background: s.trainerColor || '#f59e0b' }} />
                    <div className="w-12 flex-shrink-0 font-mono text-sm font-black text-amber-400">{s.startTime || '--:--'}</div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold text-slate-100">{title}</p>
                      <p className="truncate text-xs text-slate-500">
                        {s.trainerName || '트레이너'}{s.classType ? ` · ${s.classType}` : ''} · {STATUS_LABEL[s.status] || s.status || '예정'}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex gap-2 px-5 py-4 border-t border-slate-800">
          <button type="button" onClick={close} className="btn btn-ghost flex-1">닫기</button>
          <button type="button" onClick={goSchedule} className="btn btn-primary flex-1">스케줄 보기</button>
        </div>
      </div>
    </div>
  );
}
