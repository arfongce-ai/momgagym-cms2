// components/report/ResearchExportPanel.jsx
// ════════════════════════════════════════════════════════════════════════
//  [2026-11-17] 연구·비교 논문용 데이터 내려받기(가명 CSV).
//   · 선택한 회원 1명 / (관리자만) 전체 회원. 이름·전화·생년월일·원본 영상은 들어가지 않는다(core/researchData.js).
//   · 설명서(열 설명) CSV 를 함께 내려받는다.
// ════════════════════════════════════════════════════════════════════════
import { useState } from 'react';
import { aiStore } from '../../demoData';
import { buildMemberResearchRows, researchCodebookCsv, researchRowsToCsv } from '../../ai-measure/core/researchData';

function saveText(name, text) {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 300);
}

async function rowsForMember(member) {
  if (!member?.id || member.isVirtual) return [];
  await Promise.all([
    aiStore.ensureSessions(member.id), aiStore.ensureGaitReports(member.id),
    aiStore.ensurePostureReports(member.id), aiStore.ensureRomReports(member.id),
  ]);
  return buildMemberResearchRows({
    member,
    sessions: aiStore.getSessions(member.id) || [],
    gaitReports: aiStore.getGaitReports(member.id) || [],
    postureReports: aiStore.getPostureReports(member.id) || [],
    romReports: aiStore.getRomReports(member.id) || [],
  });
}

export default function ResearchExportPanel({ member, allMembers = [], isAdmin = false }) {
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');

  const run = async (mode) => {
    if (busy) return;
    setBusy(mode); setMsg('');
    try {
      const targets = mode === 'all' ? allMembers.filter((m) => m && !m.isVirtual && m.id) : [member];
      let rows = [];
      for (const m of targets) rows = rows.concat(await rowsForMember(m));
      if (!rows.length) { setMsg('내보낼 측정 기록이 없습니다.'); return; }
      const stamp = new Date().toISOString().slice(0, 10);
      saveText(`momgagym_research_${mode === 'all' ? 'all' : 'member'}_${stamp}.csv`, researchRowsToCsv(rows));
      setTimeout(() => saveText('momgagym_research_codebook.csv', researchCodebookCsv()), 400);
      setMsg(`${rows.length}행(가명 처리)을 내려받았습니다. 설명서 파일도 함께 저장됩니다.`);
    } catch (err) {
      setMsg(`내려받지 못했습니다: ${err?.message || '알 수 없는 오류'}`);
    } finally { setBusy(''); }
  };

  return (
    <details className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-2" data-testid="research-export">
      <summary className="cursor-pointer text-xs font-bold text-slate-600 dark:text-slate-300">연구·논문용 데이터 내려받기(가명 CSV)</summary>
      <p className="mt-2 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
        이름·전화·생년월일·영상은 들어가지 않고, 가명 ID·성별·5세 단위 연령대와 측정 조건(장비·커브드 여부)·원값이 지표별로 한 줄씩 저장됩니다. 같은 조건끼리만 비교하세요.
      </p>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <button type="button" onClick={() => run('member')} disabled={!member || Boolean(busy)} className="rounded-lg border-2 border-slate-300 dark:border-slate-600 py-2 text-xs font-bold text-slate-700 dark:text-slate-200 disabled:opacity-40">
          {busy === 'member' ? '만드는 중…' : '이 회원 CSV'}
        </button>
        {isAdmin && (
          <button type="button" onClick={() => run('all')} disabled={Boolean(busy)} className="rounded-lg border-2 border-amber-400 bg-amber-50 dark:bg-amber-500/10 py-2 text-xs font-bold text-amber-700 dark:text-amber-300 disabled:opacity-40">
            {busy === 'all' ? '전체 만드는 중…' : '전체 회원 CSV'}
          </button>
        )}
      </div>
      {msg && <p className="mt-2 text-[11px] font-semibold text-slate-600 dark:text-slate-300">{msg}</p>}
    </details>
  );
}
