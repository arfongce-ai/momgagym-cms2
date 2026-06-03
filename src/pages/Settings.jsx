// Settings.jsx — v5.1
// ✅ 백업: body records 포함 + 완전한 Timestamp 직렬화
// ✅ 파기: 스케줄+수납+신체정보 일괄 삭제
import { useState, useEffect } from 'react';
import { store } from '../demoData';
import { useAuth } from '../contexts/AuthContext';

function serializeDate(v) {
  if (!v) return null;
  if (typeof v === 'object' && v.seconds !== undefined)
    return new Date(v.seconds * 1000).toISOString().slice(0,16).replace('T',' ');
  if (v instanceof Date)
    return v.toISOString().slice(0,16).replace('T',' ');
  if (typeof v === 'string') {
    if (/^\d{4}-\d{2}-\d{2}T/.test(v)) return v.slice(0,16).replace('T',' ');
    return v;
  }
  return String(v);
}

function serializeDoc(obj) {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'object' && !Array.isArray(obj) && obj.seconds !== undefined) return serializeDate(obj);
  if (obj instanceof Date) return serializeDate(obj);
  if (Array.isArray(obj)) return obj.map(serializeDoc);
  if (typeof obj === 'object') {
    return Object.fromEntries(Object.entries(obj).map(([k,v]) => [k, serializeDoc(v)]));
  }
  return obj;
}

export default function Settings({ darkMode, setDarkMode }) {
  const { user } = useAuth();
  const [backupYear,   setBackupYear]   = useState(new Date().getFullYear());
  const [backupMonth,  setBackupMonth]  = useState(new Date().getMonth() + 1);
  const [purgeList,    setPurgeList]    = useState([]);
  const [purgeLoading, setPurgeLoading] = useState(false);
  const [purgeMsg,     setPurgeMsg]     = useState('');

  // ── JSON 백업 (수납 + 신체정보 포함) ──────────────────
  const handleBackup = () => {
    const mm         = String(backupMonth).padStart(2, '0');
    const datePrefix = `${backupYear}-${mm}`;

    const members   = serializeDoc(store.getMembers());
    const trainers  = serializeDoc(store.getTrainers());
    const schedules = serializeDoc(
      store.getSchedules().filter(s => (s.date || '').startsWith(datePrefix))
    );

    // 수납 기록 (해당 월)
    const allPayments = JSON.parse(localStorage.getItem('fitcms_payments') || '{}');
    const payments    = Object.fromEntries(
      Object.entries(allPayments)
        .map(([mid, list]) => [
          mid,
          serializeDoc((list || []).filter(p => (p.paidAt || '').startsWith(datePrefix)))
        ])
        .filter(([, list]) => list.length > 0)
    );

    // 신체정보 기록 (전체 — 월별 필터 없음, 날짜 필드 직렬화만)
    const allBody = JSON.parse(localStorage.getItem('fitcms_body') || '{}');
    const bodyRecords = Object.fromEntries(
      Object.entries(allBody)
        .map(([mid, list]) => [mid, serializeDoc(list || [])])
        .filter(([, list]) => list.length > 0)
    );

    const payload = JSON.stringify({
      exportedAt: new Date().toISOString().slice(0, 16).replace('T', ' '),
      year: backupYear, month: backupMonth,
      members, trainers, schedules, payments, bodyRecords,
    }, null, 2);

    const blob = new Blob([payload], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url;
    a.download = `몸가짐_백업_${backupYear}_${mm}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── 파기 대상 조회 ─────────────────────────────────────
  const loadPurgeList = () => {
    const twoYearsAgo = new Date(Date.now() - 2 * 365 * 24 * 60 * 60 * 1000)
      .toISOString().slice(0, 10);
    const list = store.getMembers().filter(m => {
      if (!m.lastAttendedDate) {
        return m.joinDate && m.joinDate <= twoYearsAgo;
      }
      return m.lastAttendedDate <= twoYearsAgo;
    });
    setPurgeList(list);
    setPurgeMsg(list.length === 0 ? '파기 대상 회원이 없습니다.' : '');
  };

  useEffect(() => {
    if (user?.role === 'admin') loadPurgeList();
  }, [user]);

  // ── 파기 실행 ──────────────────────────────────────────
  const handlePurge = async () => {
    if (purgeList.length === 0) return;
    if (!window.confirm(
      `${purgeList.length}명의 회원 데이터를 영구 삭제합니다.\n` +
      `· 회원 기본 정보\n· 관련 스케줄 전체\n· 수납 기록 전체\n· 신체정보 기록 전체\n\n이 작업은 되돌릴 수 없습니다.`
    )) return;

    setPurgeLoading(true);
    await new Promise(r => setTimeout(r, 600));

    purgeList.forEach(m => {
      store.getSchedules()
        .filter(s => s.memberId === m.id)
        .forEach(s => store.deleteSchedule(s.id));
      store.deleteAllPayments(m.id);
      store.deleteAllBodyRecords(m.id);
      store.deleteMember(m.id);
    });

    setPurgeMsg(`✅ ${purgeList.length}명 파기 완료`);
    setPurgeList([]);
    setPurgeLoading(false);
  };

  return (
    <div className="space-y-6 max-w-lg">
      <h1 className="text-2xl font-black tracking-tight">설정</h1>

      {/* 다크모드 */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
        <h2 className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-3">화면 설정</h2>
        <div className="flex items-center justify-between">
          <div>
            <p className="font-semibold text-sm">다크 모드</p>
            <p className="text-slate-500 text-xs">어두운 테마로 전환합니다</p>
          </div>
          <button onClick={() => setDarkMode(!darkMode)}
            className={`w-12 h-6 rounded-full transition-colors relative ${darkMode ? 'bg-amber-500' : 'bg-slate-700'}`}>
            <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200
              ${darkMode ? 'translate-x-6' : 'translate-x-0.5'}`} />
          </button>
        </div>
      </div>

      {/* 데모 안내 */}
      <div className="bg-amber-500/10 border border-amber-500/20 rounded-2xl p-4">
        <h2 className="text-xs font-bold uppercase tracking-widest text-amber-400 mb-2">데모 모드 안내</h2>
        <div className="text-xs text-slate-400 space-y-1.5">
          <p>• 데이터는 브라우저 <strong className="text-slate-300">localStorage</strong>에 저장됩니다</p>
          <p>• 실제 운영 시 <strong className="text-slate-300">Firebase</strong>로 전환하세요</p>
          <p className="pt-1 border-t border-amber-500/20">관리자: <code className="text-amber-400">admin@fitcms.demo</code> / <code className="text-amber-400">admin1234</code></p>
          <p>트레이너: <code className="text-amber-400">trainer@fitcms.demo</code> / <code className="text-amber-400">trainer1234</code></p>
        </div>
        <button
          onClick={() => {
            if (!window.confirm('데모 데이터를 초기화하시겠습니까?')) return;
            localStorage.removeItem('fitcms_seeded');
            ['members','trainers','schedules','notices','payments','body']
              .forEach(k => localStorage.removeItem('fitcms_' + k));
            window.location.reload();
          }}
          className="mt-3 text-xs text-red-400 hover:text-red-300 font-semibold transition-colors">
          🔄 데모 데이터 초기화
        </button>
      </div>

      {user?.role === 'admin' && (
        <>
          {/* JSON 백업 */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
            <h2 className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-1">
              데이터 백업 (관리자)
            </h2>
            <p className="text-xs text-slate-500 mb-3">
              월 단위 데이터를 JSON으로 다운로드합니다.<br/>
              <span className="text-slate-600">포함: 전체 회원·트레이너, 해당 월 스케줄·수납, 전체 신체정보</span><br/>
              <span className="text-slate-600">Timestamp → 'YYYY-MM-DD HH:mm' 자동 변환</span>
            </p>
            <div className="flex gap-2 mb-3">
              <select value={backupYear} onChange={e => setBackupYear(Number(e.target.value))}
                className="flex-1 bg-slate-800 border border-slate-700 text-slate-100 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-amber-500">
                {[2023, 2024, 2025, 2026].map(y => <option key={y} value={y}>{y}년</option>)}
              </select>
              <select value={backupMonth} onChange={e => setBackupMonth(Number(e.target.value))}
                className="flex-1 bg-slate-800 border border-slate-700 text-slate-100 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-amber-500">
                {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                  <option key={m} value={m}>{m}월</option>
                ))}
              </select>
            </div>
            <button onClick={handleBackup}
              className="w-full bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold py-2.5 rounded-xl text-sm transition-colors">
              📥 JSON 다운로드
            </button>
          </div>

          {/* 개인정보 파기 */}
          <div className="bg-slate-900 border border-red-500/20 rounded-2xl p-4">
            <h2 className="text-xs font-bold uppercase tracking-widest text-red-400 mb-1">
              개인정보 파기 (관리자)
            </h2>
            <p className="text-xs text-slate-500 mb-3">
              최근 출석일 기준 <strong className="text-slate-300">2년 이상 미방문</strong> 회원을 조회 후 영구 삭제합니다.<br/>
              <span className="text-slate-600">스케줄·수납 기록·신체정보도 함께 삭제됩니다.</span>
            </p>
            <button onClick={loadPurgeList}
              className="w-full mb-3 border border-slate-700 text-slate-300 hover:text-white py-2 rounded-xl text-sm font-semibold transition-colors">
              🔍 파기 대상 조회
            </button>
            {purgeMsg && (
              <p className={`text-xs mb-3 font-semibold ${purgeMsg.startsWith('✅') ? 'text-emerald-400' : 'text-slate-400'}`}>
                {purgeMsg}
              </p>
            )}
            {purgeList.length > 0 && (
              <>
                <div className="bg-red-500/5 border border-red-500/10 rounded-xl p-3 mb-3 max-h-48 overflow-y-auto space-y-1">
                  {purgeList.map(m => (
                    <div key={m.id} className="flex items-center justify-between text-xs py-1 border-b border-slate-800 last:border-0 gap-2">
                      <span className="text-red-400 font-semibold flex-shrink-0">{m.name}</span>
                      <span className="text-slate-500 flex-shrink-0">{m.phone}</span>
                      <span className="text-slate-600 text-[10px]">
                        마지막 출석: {m.lastAttendedDate || '없음'}
                      </span>
                    </div>
                  ))}
                </div>
                <button onClick={handlePurge} disabled={purgeLoading}
                  className="w-full bg-red-600 hover:bg-red-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-2.5 rounded-xl text-sm transition-colors">
                  {purgeLoading ? '파기 중…' : `⚠️ ${purgeList.length}명 일괄 파기`}
                </button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
