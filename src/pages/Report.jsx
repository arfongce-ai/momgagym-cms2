// pages/Report.jsx
// 측정 리포트 페이지: 회원 선택 → 실측 데이터 그래프/요약 → JPG 다운로드.
import { useState, useMemo } from 'react';
import { todayYMD } from '../utils/dates';
import { useAuth } from '../contexts/AuthContext';
import { scopeMembersToTrainer, sortByName } from '../utils/memberList';
import { store, aiStore } from '../demoData';
import { buildFullReport, buildAnalysisTrend } from '../services/reportService';
import { buildReportSvg, downloadSvgAsJpg } from '../components/report/reportImage';
import TrendChart from '../components/report/TrendChart';

const COLORS = { weight:'#f59e0b', systolic:'#ef4444', diastolic:'#3b82f6', height:'#22d3ee' };

export default function Report() {
  const { user } = useAuth();
  // 트레이너 모드: 담당 회원만 / 모든 회원은 가나다 순으로 노출.
  const members = useMemo(() => sortByName(scopeMembersToTrainer(store.getMembers(), user)), [user]);
  const [memberId, setMemberId] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [msg, setMsg] = useState(null);

  const member = members.find(m => m.id === memberId);

  const report = useMemo(() => {
    if (!member) return null;
    return buildFullReport({
      member,
      bodyRecords: store.getBodyRecords(member.id),
      aiSessions:  aiStore.getSessions(member.id),
    });
  }, [member]);

  // 보행/점프 분석 회차별 추세 (gait_reports)
  const trend = useMemo(() => {
    if (!member) return null;
    return buildAnalysisTrend(aiStore.getGaitReports(member.id));
  }, [member]);

  const handleDownload = async () => {
    if (!report) return;
    setDownloading(true); setMsg(null);
    try {
      const svg = buildReportSvg(report);
      const name = `리포트_${member.name}_${todayYMD()}.jpg`;
      await downloadSvgAsJpg(svg, name, 2);
      setMsg('이미지가 다운로드되었습니다.');
    } catch (e) {
      setMsg('다운로드 실패: ' + e.message);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="space-y-5 max-w-md mx-auto">
      <div>
        <h1 className="text-2xl font-black tracking-tight">측정 리포트</h1>
        <p className="text-slate-500 text-sm mt-1">실제 측정된 데이터만 리포트로 출력됩니다.</p>
      </div>

      {/* 회원 선택 */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
        <label className="block text-xs font-semibold text-slate-400 uppercase tracking-widest mb-2">회원 선택</label>
        <select value={memberId} onChange={e => setMemberId(e.target.value)}
          className="w-full bg-slate-800 border border-slate-700 text-slate-100 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-amber-500">
          <option value="">선택하세요</option>
          {members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
      </div>

      {report && !report.hasData && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 text-center text-slate-500 text-sm">
          측정된 데이터가 없습니다.<br />신체정보나 AI 측정을 먼저 기록하세요.
        </div>
      )}

      {report && report.hasData && (
        <>
          {/* 요약 카드 (최대값 기준) */}
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">측정 요약 (최대값)</p>
            <div className="grid grid-cols-2 gap-2">
              {report.body.summary.map(s => (
                <div key={s.key} className="bg-slate-900 border border-slate-800 rounded-xl p-3">
                  <p className="text-[11px] text-slate-500">{s.label}</p>
                  <p className="font-mono font-black text-lg text-slate-100">
                    {s.max}<span className="text-slate-500 text-[10px] font-normal"> {s.unit}</span>
                  </p>
                  {s.change != null && (
                    <p className={`text-[11px] font-bold ${s.change > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                      {s.change > 0 ? '▲' : '▼'} {Math.abs(s.change)}{s.unit} (최초 대비)
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* 추이 그래프 (실측 시계열만) */}
          {report.body.fields.filter(f => report.body.series[f.key]?.length > 1).length > 0 && (
            <div>
              <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">회차별 추이</p>
              <div className="space-y-3">
                {report.body.fields
                  .filter(f => report.body.series[f.key]?.length > 1)
                  .map(f => (
                    <TrendChart key={f.key} title={f.label} unit={f.unit}
                      points={report.body.series[f.key]}
                      color={COLORS[f.key] || '#f59e0b'} width={320} height={150} />
                  ))}
              </div>
            </div>
          )}

          {/* AI 측정 이력 (자세·1RM·RSI·VBT·점프 등) */}
          {report.ai.menuSummaries?.length > 0 && (
            <div>
              <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">AI 측정 이력</p>
              <div className="space-y-2">
                {report.ai.menuSummaries.map((m, i) => (
                  <div key={i} className="bg-slate-900 border border-slate-800 rounded-xl px-3 py-2.5 flex items-center justify-between">
                    <div>
                      <p className="text-sm font-bold text-slate-200">{m.title}</p>
                      <p className="text-[11px] text-slate-500">{m.metric}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[11px] text-slate-400">{m.count}회</p>
                      <p className="text-[10px] text-slate-600">{m.latestDate}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 점프 회차별 추세 */}
          {trend?.jump?.count > 0 && (
            <div>
              <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">
                점프 추세 ({trend.jump.count}회)
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {trend.jump.height.length > 1 && (
                  <TrendChart title="점프 높이" unit="cm" points={trend.jump.height} color="#f59e0b" width={320} height={150} />
                )}
                {trend.jump.peakPower.length > 1 && (
                  <TrendChart title="최대 파워" unit="W" points={trend.jump.peakPower} color="#22d3ee" width={320} height={150} />
                )}
                {trend.jump.footSym.length > 1 && (
                  <TrendChart title="착지 대칭" unit="%" points={trend.jump.footSym} color="#34d399" width={320} height={150} />
                )}
                {trend.jump.landKnee.length > 1 && (
                  <TrendChart title="착지 무릎각" unit="°" points={trend.jump.landKnee} color="#a78bfa" width={320} height={150} />
                )}
              </div>
              {trend.jump.height.length === 1 && (
                <p className="text-[11px] text-slate-500 mt-1">측정이 1회뿐이라 추세 그래프는 2회차부터 표시됩니다.</p>
              )}
            </div>
          )}

          {/* 보행 회차별 추세 */}
          {trend?.gait?.count > 0 && (
            <div>
              <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">
                보행 추세 ({trend.gait.count}회)
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {trend.gait.cadence.length > 1 && (
                  <TrendChart title="케이던스" unit="SPM" points={trend.gait.cadence} color="#f59e0b" width={320} height={150} />
                )}
                {trend.gait.pelvicDrop.length > 1 && (
                  <TrendChart title="골반 드롭" unit="%" points={trend.gait.pelvicDrop} color="#ef4444" width={320} height={150} />
                )}
                {trend.gait.kneeSym.length > 1 && (
                  <TrendChart title="무릎 대칭" unit="%" points={trend.gait.kneeSym} color="#34d399" width={320} height={150} />
                )}
              </div>
              {trend.gait.cadence.length === 1 && (
                <p className="text-[11px] text-slate-500 mt-1">측정이 1회뿐이라 추세 그래프는 2회차부터 표시됩니다.</p>
              )}
            </div>
          )}
          {report.notes.length > 0 && (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
              <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">분석 설명</p>
              <ul className="space-y-1.5">
                {report.notes.map((n, i) => (
                  <li key={i} className="text-xs text-slate-300 leading-relaxed">· {n}</li>
                ))}
              </ul>
            </div>
          )}

          {/* JPG 다운로드 */}
          <button onClick={handleDownload} disabled={downloading}
            className="btn btn-primary w-full disabled:opacity-50">
            {downloading ? '이미지 생성 중…' : '📷 리포트 JPG 다운로드'}
          </button>
          {msg && <p className="text-center text-xs text-slate-400">{msg}</p>}
        </>
      )}
    </div>
  );
}
