// Settings.jsx — v5.1
// ✅ 백업: body records 포함 + 완전한 Timestamp 직렬화
// ✅ 파기: 스케줄+수납+신체정보 일괄 삭제
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { daysAgoYMD } from '../utils/dates';
import { store, aiStore } from '../demoData';
import { useAuth } from '../contexts/AuthContext';
import { recomputeBodyAgeIfStale } from '../ai-measure/core/postureMath';
import { auditMemberIntegrity, filterDismissed, TAB_FOR_FINDING_TYPE, SEVERITY_LABEL } from '../services/integrityAudit';

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
  const navigate = useNavigate();
  const [backupYear,   setBackupYear]   = useState(new Date().getFullYear());
  const [backupMonth,  setBackupMonth]  = useState(new Date().getMonth() + 1);
  const [purgeList,    setPurgeList]    = useState([]);
  const [purgeLoading, setPurgeLoading] = useState(false);
  const [purgeMsg,     setPurgeMsg]     = useState('');

  // ── 체형나이 소급 보정(자세 리포트) ─────────────────────
  //  postureMath.js의 계단식→불연속 버그 수정 이후, 그 전에 저장된 자세
  //  리포트의 bodyAge는 옛 공식 값 그대로 남아있다. 점수(score)만 있으면
  //  새 랜드마크 없이 재계산 가능하므로, 여기서 스캔→미리보기→일괄 적용한다.
  const [bodyAgeScanList, setBodyAgeScanList] = useState(null); // null=아직 조회 안 함
  const [bodyAgeScanning, setBodyAgeScanning] = useState(false);
  const [bodyAgeFixing,   setBodyAgeFixing]   = useState(false);
  const [bodyAgeMsg,      setBodyAgeMsg]      = useState('');

  // ── 데이터 무결성 검사(관리자) ─────────────────────────
  const [integrityFindings, setIntegrityFindings] = useState(null); // null=아직 검사 안 함
  const [integrityScanning, setIntegrityScanning] = useState(false);
  const [integrityMsg,      setIntegrityMsg]      = useState('');

  // ── JSON 백업 (수납 + 신체정보 + AI측정 포함, Firestore 캐시 기반) ──────
  const handleBackup = async () => {
    const mm         = String(backupMonth).padStart(2, '0');
    const datePrefix = `${backupYear}-${mm}`;

    const memberList = store.getMembers();
    const members   = serializeDoc(memberList);
    const trainers  = serializeDoc(store.getTrainers());
    const schedules = serializeDoc(
      store.getSchedules().filter(s => (s.date || '').startsWith(datePrefix))
    );

    // 수납 기록 (해당 월) — store(Firestore 캐시)에서 직접 읽음
    const payments = {};
    memberList.forEach(m => {
      const list = store.getPayments(m.id).filter(p => (p.paidAt || '').startsWith(datePrefix));
      if (list.length) payments[m.id] = serializeDoc(list);
    });

    // 신체정보 기록 (전체) — store에서 직접 읽음
    const bodyRecords = {};
    memberList.forEach(m => {
      const list = store.getBodyRecords(m.id);
      if (list.length) bodyRecords[m.id] = serializeDoc(list);
    });

    // AI 측정 이력 (전체) — 백업 시점에만 회원별로 지연 로딩 후 읽음
    // (평소 앱 사용 중에는 전수 조회하지 않아 읽기를 절감한다.)
    await Promise.all(memberList.map(m => aiStore.ensureSessions(m.id)));
    const aiSessions = {};
    memberList.forEach(m => {
      const list = aiStore.getSessions(m.id);
      if (list.length) aiSessions[m.id] = serializeDoc(list);
    });

    // 백업 항목 수 (사용자 검증용)
    const counts = {
      members: members.length,
      payments: Object.values(payments).reduce((a, l) => a + l.length, 0),
      bodyRecords: Object.values(bodyRecords).reduce((a, l) => a + l.length, 0),
      aiSessions: Object.values(aiSessions).reduce((a, l) => a + l.length, 0),
    };

    const payload = JSON.stringify({
      exportedAt: new Date().toISOString().slice(0, 16).replace('T', ' '),
      year: backupYear, month: backupMonth,
      counts,
      members, trainers, schedules, payments, bodyRecords, aiSessions,
    }, null, 2);

    const blob = new Blob([payload], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url;
    a.download = `몸가짐_백업_${backupYear}_${mm}.json`;
    a.click();
    URL.revokeObjectURL(url);
    alert(`백업 완료\n· 회원 ${counts.members}명\n· 수납 ${counts.payments}건\n· 신체정보 ${counts.bodyRecords}건\n· AI측정 ${counts.aiSessions}건`);
  };

  // ── 파기 대상 조회 ─────────────────────────────────────
  const loadPurgeList = () => {
    const twoYearsAgo = daysAgoYMD(2 * 365); // CV-A: 로컬 날짜
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
      `· 회원 기본 정보\n· 관련 스케줄 전체\n· 수납 기록 전체\n· 신체정보 기록 전체\n· AI 측정 기록 전체\n\n이 작업은 되돌릴 수 없습니다.`
    )) return;

    setPurgeLoading(true);
    let ok = 0; const failed = [];
    for (const m of purgeList) {
      try { await store.purgeMember(m.id); ok++; }    // 회원별 원자적 삭제(AI 포함)
      catch (e) { console.error('[파기 실패]', m.name, e); failed.push(m.name); }
    }
    setPurgeLoading(false);

    if (failed.length === 0) {
      setPurgeMsg(`✅ ${ok}명 파기 완료`);
      setPurgeList([]);
    } else {
      setPurgeMsg(`⚠️ ${ok}명 완료, ${failed.length}명 실패: ${failed.join(', ')} — 네트워크 확인 후 다시 시도하세요.`);
      loadPurgeList();   // 실패분이 목록에 다시 남도록 갱신
    }
  };

  // ── 체형나이 소급 보정: 조회(스캔) ───────────────────────
  //  전 회원의 자세 리포트를 지연 로딩(이미 로드된 회원은 캐시 재사용,
  //  추가 읽기 없음)하며 옛 공식 값을 찾는다. 실제 쓰기는 하지 않는다.
  const scanBodyAges = async () => {
    setBodyAgeScanning(true);
    setBodyAgeMsg('');
    const found = [];
    try {
      const members = store.getMembers();
      for (const m of members) {
        // eslint-disable-next-line no-await-in-loop
        const reports = await aiStore.ensurePostureReports(m.id);
        for (const r of reports) {
          const actualAge = r.actualAge ?? r.analysis?.actualAge ?? m.age ?? null;
          const { needsUpdate, newBodyAge } = recomputeBodyAgeIfStale(r.analysis, actualAge);
          if (needsUpdate) {
            found.push({
              memberId: m.id, memberName: m.name, reportId: r.id,
              measuredAt: (r.createdAt || r.measuredAt || '').slice(0, 10),
              oldBodyAge: r.analysis.bodyAge, newBodyAge,
            });
          }
        }
      }
      setBodyAgeScanList(found);
      setBodyAgeMsg(found.length === 0 ? '보정이 필요한 리포트가 없습니다.' : '');
    } catch (e) {
      console.error('[체형나이 스캔 실패]', e);
      setBodyAgeMsg('스캔 중 오류가 발생했습니다. 네트워크 확인 후 다시 시도하세요.');
    } finally {
      setBodyAgeScanning(false);
    }
  };

  // ── 체형나이 소급 보정: 적용 ──────────────────────────────
  const applyBodyAgeFixes = async () => {
    if (!bodyAgeScanList?.length) return;
    if (!window.confirm(`${bodyAgeScanList.length}건의 자세 리포트 체형나이를 새 계산식으로 보정합니다.\n이 작업은 되돌릴 수 없습니다.`)) return;
    setBodyAgeFixing(true);
    let ok = 0; const failed = [];
    for (const item of bodyAgeScanList) {
      try {
        const reports = aiStore.getPostureReports(item.memberId);
        const report = reports.find(r => r.id === item.reportId);
        if (!report) { failed.push(item.memberName); continue; }
        // eslint-disable-next-line no-await-in-loop
        await aiStore.updatePostureReport(item.memberId, item.reportId, {
          analysis: { ...report.analysis, bodyAge: item.newBodyAge },
        });
        ok++;
      } catch (e) {
        console.error('[체형나이 보정 실패]', item.memberName, item.reportId, e);
        failed.push(item.memberName);
      }
    }
    setBodyAgeFixing(false);
    if (failed.length === 0) {
      setBodyAgeMsg(`✅ ${ok}건 보정 완료`);
      setBodyAgeScanList([]);
    } else {
      setBodyAgeMsg(`⚠️ ${ok}건 완료, ${failed.length}건 실패: ${failed.join(', ')} — 네트워크 확인 후 다시 시도하세요.`);
    }
  };

  // ── 데이터 무결성 검사: 조회(스캔) ────────────────────────
  //  읽기 전용 — 어긋난 데이터를 찾아 보여주기만 하고, 아무것도 고치지 않는다
  //  (scheduleAudit.js·체형나이 보정과 동일 원칙: 관리자가 확인 후 직접 처리).
  const scanIntegrity = async () => {
    setIntegrityScanning(true);
    setIntegrityMsg('');
    try {
      const members = store.getMembers();
      const trainers = store.getTrainers();
      const schedules = store.getSchedules();
      const payments = {};
      members.forEach(m => { payments[m.id] = store.getPayments(m.id); });
      const findings = auditMemberIntegrity({ members, trainers, schedules, payments });
      const dismissedIds = store.getIntegrityDismissals().map(d => d.id);
      setIntegrityFindings(filterDismissed(findings, dismissedIds));
      setIntegrityMsg(findings.length === 0 ? '이상 없음.' : '');
    } catch (e) {
      console.error('[무결성 검사 실패]', e);
      setIntegrityMsg('검사 중 오류가 발생했습니다. 네트워크 확인 후 다시 시도하세요.');
    } finally {
      setIntegrityScanning(false);
    }
  };

  // ── 항목 무시(정상) 처리 ──────────────────────────────────
  const dismissFinding = async (finding) => {
    try {
      await store.dismissIntegrityFinding(finding, { dismissedBy: user?.name || user?.email || '관리자' });
      setIntegrityFindings(list => (list || []).filter(f => f.key !== finding.key));
    } catch (e) {
      console.error('[무시 처리 실패]', e);
      alert('무시 처리에 실패했습니다. 네트워크 확인 후 다시 시도하세요.');
    }
  };

  // ── 회원상세로 이동(문제 유형에 맞는 탭을 열어준다) ──────────
  const openMemberForFinding = (finding) => {
    const tab = TAB_FOR_FINDING_TYPE[finding.type] || 'info';
    navigate(`/members?openMember=${finding.memberId}&tab=${tab}`);
  };

  return (
    <div className="space-y-6 max-w-lg">
      <h1 className="text-2xl font-black tracking-tight">설정</h1>

      {/* 다크모드 */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4">
        <h2 className="text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-3">화면 설정</h2>
        <div className="flex items-center justify-between">
          <div>
            <p className="font-semibold text-sm">다크 모드</p>
            <p className="text-slate-500 text-xs">어두운 테마로 전환합니다</p>
          </div>
          <button onClick={() => setDarkMode(!darkMode)}
            className={`w-12 h-6 rounded-full transition-colors relative flex-shrink-0 overflow-hidden ${darkMode ? 'bg-amber-500' : 'bg-slate-300'}`}>
            <span className={`absolute left-0.5 top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200
              ${darkMode ? 'translate-x-6' : 'translate-x-0'}`} />
          </button>
        </div>
      </div>

      {/* 저장소 안내 */}
      <div className="bg-amber-500/10 border border-amber-500/20 rounded-2xl p-4">
        <h2 className="text-xs font-bold uppercase tracking-widest text-amber-400 mb-2">저장소 안내</h2>
        <div className="text-xs text-slate-600 dark:text-slate-400 space-y-1.5">
          <p>• 데이터는 <strong className="text-slate-700 dark:text-slate-300">Firebase Firestore</strong>에 저장됩니다</p>
          <p>• 화면에 보이는 값은 빠른 조회를 위한 임시 캐시이며, 실제 저장은 Firestore에서 이뤄집니다</p>
          <p className="pt-1 border-t border-amber-500/20 text-slate-500">데이터 초기화가 필요하면 Firebase 콘솔에서 직접 컬렉션을 관리하세요. (앱에서 임의 초기화 시 운영 데이터가 손실될 수 있어 버튼을 제공하지 않습니다.)</p>
        </div>
      </div>

      {user?.role === 'admin' && (
        <>
          {/* JSON 백업 */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4">
            <h2 className="text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-1">
              데이터 백업 (관리자)
            </h2>
            <p className="text-xs text-slate-500 mb-3">
              월 단위 데이터를 JSON으로 다운로드합니다.<br/>
              <span className="text-slate-600">포함: 전체 회원·트레이너, 해당 월 스케줄·수납, 전체 신체정보</span><br/>
              <span className="text-slate-600">Timestamp → 'YYYY-MM-DD HH:mm' 자동 변환</span>
            </p>
            <div className="flex gap-2 mb-3">
              <select value={backupYear} onChange={e => setBackupYear(Number(e.target.value))}
                className="flex-1 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-amber-500">
                {[2023, 2024, 2025, 2026].map(y => <option key={y} value={y}>{y}년</option>)}
              </select>
              <select value={backupMonth} onChange={e => setBackupMonth(Number(e.target.value))}
                className="flex-1 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-amber-500">
                {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                  <option key={m} value={m}>{m}월</option>
                ))}
              </select>
            </div>
            <button onClick={handleBackup}
              className="btn btn-primary w-full">
              📥 JSON 다운로드
            </button>
          </div>

          {/* 개인정보 파기 */}
          <div className="bg-white dark:bg-slate-900 border border-red-500/20 rounded-2xl p-4">
            <h2 className="text-xs font-bold uppercase tracking-widest text-red-400 mb-1">
              개인정보 파기 (관리자)
            </h2>
            <p className="text-xs text-slate-500 mb-3">
              최근 출석일 기준 <strong className="text-slate-700 dark:text-slate-300">2년 이상 미방문</strong> 회원을 조회 후 영구 삭제합니다.<br/>
              <span className="text-slate-600">스케줄·수납 기록·신체정보도 함께 삭제됩니다.</span>
            </p>
            <button onClick={loadPurgeList}
              className="btn btn-ghost w-full mb-3">
              🔍 파기 대상 조회
            </button>
            {purgeMsg && (
              <p className={`text-xs mb-3 font-semibold ${purgeMsg.startsWith('✅') ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400'}`}>
                {purgeMsg}
              </p>
            )}
            {purgeList.length > 0 && (
              <>
                <div className="bg-red-500/5 border border-red-500/10 rounded-xl p-3 mb-3 max-h-48 overflow-y-auto space-y-1">
                  {purgeList.map(m => (
                    <div key={m.id} className="flex items-center justify-between text-xs py-1 border-b border-slate-200 dark:border-slate-800 last:border-0 gap-2">
                      <span className="text-red-600 dark:text-red-400 font-semibold flex-shrink-0">{m.name}</span>
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

          {/* 체형나이 소급 보정 */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4">
            <h2 className="text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-1">
              체형나이 재계산 (관리자)
            </h2>
            <p className="text-xs text-slate-500 mb-3">
              자세 리포트의 체형나이 계산식이 수정되어(점수 경계에서 갑자기 튀던 문제),
              이전에 저장된 리포트만 옛 값이 남아있을 수 있습니다.<br/>
              <span className="text-slate-600">새 랜드마크 측정 없이 저장된 점수로만 재계산하며, 조회 후 목록을 확인하고 적용합니다.</span>
            </p>
            <button onClick={scanBodyAges} disabled={bodyAgeScanning}
              className="btn btn-ghost w-full mb-3 disabled:opacity-50">
              {bodyAgeScanning ? '조회 중…' : '🔍 보정 대상 조회'}
            </button>
            {bodyAgeMsg && (
              <p className={`text-xs mb-3 font-semibold ${bodyAgeMsg.startsWith('✅') ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400'}`}>
                {bodyAgeMsg}
              </p>
            )}
            {bodyAgeScanList?.length > 0 && (
              <>
                <div className="bg-amber-500/5 border border-amber-500/10 rounded-xl p-3 mb-3 max-h-48 overflow-y-auto space-y-1">
                  {bodyAgeScanList.map((item) => (
                    <div key={item.reportId} className="flex items-center justify-between text-xs py-1 border-b border-slate-200 dark:border-slate-800 last:border-0 gap-2">
                      <span className="text-amber-700 dark:text-amber-300 font-semibold flex-shrink-0">{item.memberName}</span>
                      <span className="text-slate-600 text-[10px] flex-shrink-0">{item.measuredAt}</span>
                      <span className="text-slate-600 dark:text-slate-400 text-[11px]">
                        {item.oldBodyAge ?? '-'}세 → <span className="text-slate-900 dark:text-slate-200 font-bold">{item.newBodyAge}세</span>
                      </span>
                    </div>
                  ))}
                </div>
                <button onClick={applyBodyAgeFixes} disabled={bodyAgeFixing}
                  className="w-full bg-amber-500 hover:bg-amber-400 disabled:opacity-50 disabled:cursor-not-allowed text-slate-950 font-bold py-2.5 rounded-xl text-sm transition-colors">
                  {bodyAgeFixing ? '보정 중…' : `${bodyAgeScanList.length}건 일괄 보정`}
                </button>
              </>
            )}
          </div>

          {/* 데이터 무결성 검사 */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4">
            <h2 className="text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-1">
              데이터 무결성 검사 (관리자)
            </h2>
            <p className="text-xs text-slate-500 mb-3">
              전 회원 대상으로 수납·세션·스케줄·환불 사이 어긋난 데이터를 찾습니다.<br/>
              <span className="text-slate-600">자동으로 고치지 않으며, 확인 후 회원상세에서 직접 바로잡거나 정상이면 무시 처리하세요.</span>
            </p>
            <button onClick={scanIntegrity} disabled={integrityScanning}
              className="btn btn-ghost w-full mb-3 disabled:opacity-50">
              {integrityScanning ? '검사 중…' : '🔍 무결성 검사 실행'}
            </button>
            {integrityMsg && (
              <p className={`text-xs mb-3 font-semibold ${integrityMsg.startsWith('이상 없음') ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400'}`}>
                {integrityMsg}
              </p>
            )}
            {integrityFindings?.length > 0 && (
              <div className="space-y-2 max-h-72 overflow-y-auto">
                {integrityFindings.map(f => (
                  <div key={f.key} className={`rounded-xl p-3 border text-xs ${
                    f.severity === 'error' ? 'bg-red-500/5 border-red-500/20'
                    : f.severity === 'warn' ? 'bg-amber-500/5 border-amber-500/20'
                    : 'bg-slate-100 dark:bg-slate-800/50 border-slate-300 dark:border-slate-700'
                  }`}>
                    <div className="flex items-center justify-between mb-1">
                      <span className={`font-bold ${
                        f.severity === 'error' ? 'text-red-600 dark:text-red-400' : f.severity === 'warn' ? 'text-amber-600 dark:text-amber-400' : 'text-slate-500 dark:text-slate-400'
                      }`}>{SEVERITY_LABEL[f.severity]}</span>
                      <span className="text-slate-500 font-semibold">{f.memberName}</span>
                    </div>
                    <p className="text-slate-600 dark:text-slate-400 mb-2">{f.message}</p>
                    <div className="flex gap-2">
                      <button onClick={() => openMemberForFinding(f)}
                        className="flex-1 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 font-semibold py-1.5 rounded-lg transition-colors">
                        회원상세로 이동
                      </button>
                      <button onClick={() => dismissFinding(f)}
                        className="flex-1 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400 font-semibold py-1.5 rounded-lg transition-colors">
                        무시(정상)
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
