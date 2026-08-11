// ai-measure/menus/JumpAnalysisHub.jsx
// ════════════════════════════════════════════════════════════════════════
//  점프 측정 진입점 — 세 가지 방식을 한 메뉴에서.
//   mode='upload' → JumpUploadAnalysis    (고속영상, 가장 정확 · 권장)
//   mode='live'   → JumpPrecisionAnalysis  (실시간 카메라, 빠른 확인용)
//   mode='manual' → JumpManualMeasure      (체공시간 직접 입력 · 점프매트 등)
//  저장은 Hub 가 단일 책임으로 처리(중복 저장 방지).
//  상단 ⓘ 버튼으로 측정 방법 안내(가이드)를 띄운다.
// ════════════════════════════════════════════════════════════════════════
import React, { useState, useCallback } from 'react';
import JumpPrecisionAnalysis from './JumpPrecisionAnalysis';
import JumpUploadAnalysis from './JumpUploadAnalysis';
import JumpReportDashboard from './JumpReportDashboard';
import { calcJump } from '../core/performance';
import { useHardwareBack } from '../core/useHardwareBack';
import MeasureRecordConfirm from '../components/MeasureRecordConfirm.jsx';
import { JUMP_SUBTYPES, JUMP_SUBTYPE_ORDER, LEG_LABEL, engineOf } from '../core/jumpTypes';

export default function JumpAnalysisHub({ member, onBack, onSave, onSaveToFirebase, onMemberHeightChange, onViewInReport }) {
  const save = onSaveToFirebase || onSave;
  // 요구사항 7: 실시간 → 고속영상 순서, 실시간이 기본
  const [mode, setMode] = useState('live');
  // [2026-08-10 확장] 세부 종류(CMJ/SJ/DJ/SLJ/RSI) 선택. 기존 jumpType('power'|
  // 'reactive')은 아래 파생값으로 그대로 계산해서 JumpPrecisionAnalysis·
  // JumpUploadAnalysis 등 하위 컴포넌트의 기존 분기는 손대지 않는다 — 새 종류는
  // 어차피 이 둘 중 하나의 엔진을 그대로 재사용하기 때문(jumpTypes.js 참고).
  const [jumpSubType, setJumpSubType] = useState('cmj');
  const jumpType = engineOf(jumpSubType); // 파생값 — 'power' | 'reactive'
  // SLJ(한발 점프) 전용 — 테스트할 다리. 다른 종류에서는 쓰이지 않는다.
  const [leg, setLeg] = useState('left');
  // [DJ 박스높이 수동입력 2026-08-11] DJ 전용 — 카메라로는 박스 높이 자체를
  // 잴 수 없어서(위 jumpTypes.js dj.guideBody 참고) 트레이너가 직접 입력한다.
  // leg와 동일한 패턴: measure 단계가 아니라 확인(record) 단계에서 물어보고
  // (측정 방식 3종 모두 공통으로 거치는 지점이라 Hub 한 곳에서만 처리하면
  // 됨), persist()에서 report에 실어 저장한다. 순수 참고값이라 리포트
  // 점수·유효성 판정에는 전혀 관여하지 않는다.
  const [boxHeightCm, setBoxHeightCm] = useState('');
  const [view, setView] = useState('measure'); // measure | record | report
  const [report, setReport] = useState(null);
  const [pending, setPending] = useState(null);   // 측정완료~확인 사이의 리포트 데이터
  const [saveState, setSaveState] = useState('idle'); // idle | saving | saved | error
  const [showGuide, setShowGuide] = useState(false);

  // 실제 저장(확인 시). 유효 측정만 서버 저장하고, 결과는 항상 리포트로 확인.
  // [2026-08-10] jumpSubType/leg는 하위 컴포넌트가 이미 report에 채워 보내지만,
  // 혹시 누락되는 경로가 있어도 여기서 한 번 더 보정한다(안전망 — 이중 처리라도
  // 값이 같으면 무해하고, 리포트에 세부 종류가 아예 안 남는 것보다 안전하다).
  const persist = useCallback(async (reportData, record = {}) => {
    const withRecord = {
      ...reportData,
      jumpSubType: reportData.jumpSubType || jumpSubType,
      ...(jumpSubType === 'slj' ? { leg: reportData.leg || leg } : {}),
      // [DJ 박스높이 2026-08-11] 숫자로 뭔가 입력됐을 때만 필드를 채운다 —
      // 빈 문자열이면 아예 필드를 안 만들어서(undefined) "0cm로 측정했다"는
      // 것과 "안 적었다"를 리포트에서 구분할 수 있게 한다.
      ...(jumpSubType === 'dj' && boxHeightCm !== '' && Number(boxHeightCm) > 0
        ? { boxHeightCm: Number(boxHeightCm) }
        : {}),
      note: record.note || reportData.note || '',
    };
    let saved = withRecord;
    setSaveState('saving');
    if (withRecord.valid === true && typeof save === 'function') {
      try {
        const res = await save(withRecord);
        if (res && typeof res === 'object') saved = { ...withRecord, ...res };
        setSaveState('saved');
      } catch (e) { setSaveState('error'); }
    } else { setSaveState('saved'); }
    setReport(saved);
    setView('report');
  }, [save, jumpSubType, leg, boxHeightCm]);

  // 측정 완료(업로드/수동) → 기록·확인 단계로 (즉시 저장하지 않음)
  const handleComplete = useCallback((reportData) => {
    setPending(reportData);
    setSaveState('idle');
    setView('record');
  }, []);

  const confirmRecord = useCallback((record) => {
    if (pending) persist(pending, record);
  }, [pending, persist]);

  const backToMeasure = () => { setView('measure'); setReport(null); setPending(null); setSaveState('idle'); };
  // [항목 2] 폰 뒤로가기: 리포트/기록 화면이면 측정 화면으로 한 단계만 복귀.
  useHardwareBack((view === 'report' && !!report) || view === 'record', backToMeasure);
  const openLiveReport = useCallback((reportData) => {
    // 라이브도 통일 흐름: 측정완료 → 기록·확인 → 저장 → 리포트
    setPending(reportData);
    setSaveState('idle');
    setView('record');
  }, []);

  if (view === 'record' && pending) {
    const j = pending.metrics || pending;
    const rows = [];
    if (j.jumpHeight != null) rows.push({ label: '점프 높이', value: `${j.jumpHeight}cm` });
    if (j.rsi != null) rows.push({ label: 'RSI', value: j.rsi });
    if (j.flightTime != null) rows.push({ label: '체공시간', value: `${j.flightTime}ms` });
    return (
      <div className="fixed inset-0 z-[80] bg-slate-950 overflow-y-auto" style={{ height: '100dvh' }}>
        <div className="max-w-md mx-auto p-4 space-y-3">
          {/* [DJ 박스높이 수동입력 2026-08-11] 측정 방식(실시간/고속영상) 무관하게
              여기 한 곳에서만 물어본다 — 3가지 방식 다 이 record 단계로 모이므로
              (Hub 단일 저장 지점) 각 하위 컴포넌트를 안 건드려도 된다. */}
          {jumpSubType === 'dj' && (
            <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4 space-y-2">
              <p className="text-xs font-black text-slate-300">
                박스 높이 (cm) <span className="text-slate-500 font-normal normal-case">— 참고용, 카메라로는 측정 안 됨 · 선택</span>
              </p>
              <input type="number" inputMode="decimal" step="1" min="0" value={boxHeightCm}
                onChange={(e) => setBoxHeightCm(e.target.value)} placeholder="예: 30"
                className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2.5 text-sm font-mono text-slate-100 focus:outline-none focus:border-amber-500" />
            </div>
          )}
          <MeasureRecordConfirm
            title="수직 점프"
            summaryRows={rows}
            noteMode
            onConfirm={confirmRecord}
            onBack={backToMeasure}
            saving={saveState === 'saving'}
            saved={saveState === 'saved'}
            error={saveState === 'error'}
          />
        </div>
      </div>
    );
  }

  if (view === 'report' && report) {
    return (
      <div className="fixed inset-0 z-[80] bg-slate-950 overflow-y-auto" style={{ height: '100dvh' }}>
        <JumpReportDashboard report={report} onClose={onBack} member={member} />
        {/* [리포트 통합 2026-08-09] GaitAnalysisHub.jsx와 동일 패턴. */}
        {!member?.isVirtual && typeof onViewInReport === 'function' && (
          <div className="mx-auto w-full max-w-[794px] px-4 pb-3">
            <button
              onClick={onViewInReport}
              className="w-full rounded-xl border border-amber-500/40 bg-amber-500/10 text-amber-300 font-bold text-sm py-2.5"
            >
              📊 결과리포트에서 보기
            </button>
          </div>
        )}
        <div className="sticky bottom-0 z-10 flex justify-center p-3 bg-slate-900/90 backdrop-blur border-t border-slate-800">
          <button onClick={backToMeasure} className="rounded-lg bg-slate-700 text-white font-bold text-sm px-6 py-2">← 다시 측정</button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[80] bg-slate-950" style={{ height: '100dvh' }}>
      {view === 'measure' && (
        <>
          {/* 점프 세부 종류(CMJ/SJ/DJ/SLJ/RSI) + 측정 방식(실시간/고속영상) + 도움말 */}
          <div className="absolute top-[max(8px,calc(env(safe-area-inset-top)+8px))] inset-x-0 z-[86] flex flex-col items-center gap-1.5 px-3 pointer-events-none">
            {/* 점프 세부 종류 — 5종, 가로 스크롤 허용(좁은 화면 대비) */}
            <div className="pointer-events-auto flex gap-1 rounded-full bg-black/55 backdrop-blur p-1 border border-white/10 shadow-lg max-w-full overflow-x-auto">
              {JUMP_SUBTYPE_ORDER.map((k) => (
                <button key={k} onClick={() => setJumpSubType(k)}
                  className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-black transition-colors whitespace-nowrap ${
                    jumpSubType === k ? 'bg-emerald-500 text-slate-950' : 'text-slate-300'}`}>
                  {JUMP_SUBTYPES[k].chipLabel}
                </button>
              ))}
            </div>
            {/* SLJ(한발 점프) 전용 — 테스트할 다리 선택 */}
            {JUMP_SUBTYPES[jumpSubType].singleLeg && (
              <div className="pointer-events-auto flex gap-1 rounded-full bg-black/55 backdrop-blur p-1 border border-white/10 shadow-lg">
                {[['left', LEG_LABEL.left], ['right', LEG_LABEL.right]].map(([k, label]) => (
                  <button key={k} onClick={() => setLeg(k)}
                    className={`rounded-full px-3 py-1 text-xs font-black transition-colors ${
                      leg === k ? 'bg-indigo-500 text-white' : 'text-slate-300'}`}>
                    {label}
                  </button>
                ))}
              </div>
            )}
            {/* 측정 방식 + 도움말 */}
            <div className="flex items-center gap-2">
              <div className="pointer-events-auto flex gap-1 rounded-full bg-black/55 backdrop-blur p-1 border border-white/10 shadow-lg">
                {[['live', '🔴 실시간'], ['upload', '📁 고속영상']].map(([k, label]) => (
                  <button key={k} onClick={() => setMode(k)}
                    className={`rounded-full px-3.5 py-1 text-xs font-black transition-colors ${
                      mode === k ? 'bg-amber-500 text-slate-950' : 'text-slate-300'}`}>
                    {label}
                  </button>
                ))}
              </div>
              <button onClick={() => setShowGuide(true)}
                className="pointer-events-auto h-8 w-8 shrink-0 rounded-full bg-black/55 backdrop-blur border border-white/10 text-white font-black shadow-lg">
                ⓘ
              </button>
            </div>
            <p className={`pointer-events-none text-[10px] font-bold bg-black/55 backdrop-blur rounded-full px-3 py-0.5 border ${
              jumpType === 'reactive' ? 'text-emerald-300 border-emerald-500/30' : 'text-amber-300 border-amber-500/30'}`}>
              {JUMP_SUBTYPES[jumpSubType].tip}
            </p>
          </div>

          {showGuide && <JumpGuide mode={mode} jumpSubType={jumpSubType} onClose={() => setShowGuide(false)} />}
        </>
      )}

      {mode === 'live' && (
        <JumpPrecisionAnalysis member={member} onBack={onBack} onSaveToFirebase={save}
          onMemberHeightChange={onMemberHeightChange}
          jumpType={jumpType}
          jumpSubType={jumpSubType}
          leg={JUMP_SUBTYPES[jumpSubType].singleLeg ? leg : null}
          onOpenSavedReport={openLiveReport}
          onManualComplete={handleComplete} />
      )}
      {mode === 'upload' && (
        <JumpUploadAnalysis member={member} onBack={onBack} onComplete={handleComplete}
          jumpType={jumpType}
          jumpSubType={jumpSubType}
          leg={JUMP_SUBTYPES[jumpSubType].singleLeg ? leg : null}
          onMemberHeightChange={onMemberHeightChange} />
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
//  수동 측정 — 체공시간 직접 입력 (점프매트, 외부 타이머, 슬로모 수동 카운트 등)
//  자동(카메라/영상) 측정과 동일한 저장 페이로드를 만들어 통합 리포트로 보낸다.
// ════════════════════════════════════════════════════════════════════════
function JumpManualMeasure({ member, onBack, onComplete, onOpenGuide }) {
  const [flight, setFlight] = useState('');
  const [weight, setWeight] = useState(member?.weight ? String(member.weight) : '');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const ft = Number(flight);
    if (!ft || ft <= 0 || ft > 1.5) {
      alert('체공 시간을 초 단위로 정확히 입력하세요. (예: 0.50)');
      return;
    }
    const r = calcJump(ft, weight ? Number(weight) : null);
    if (!r) { alert('계산에 실패했습니다. 입력값을 확인하세요.'); return; }
    setSaving(true);
    const report = {
      valid: true,
      reason: 'ok',
      source: 'manual',
      jumps: 1,
      flightTimeSec: ft,
      flightTimeMs: Math.round(ft * 1000),
      heightCm: r.heightCm,
      takeoffVelocity: r.takeoffVelocity,
      peakPower: r.peakPower,
      bodyWeight: weight ? Number(weight) : null,
      // 수동은 단일 측정이라 교차검증 없음(표시만 — null)
      crossCheck: { heightCrossCm: null, deltaPct: null, agree: null },
      calibHeightCm: member?.height || null,
      member: { id: member?.id || null, name: member?.name || null },
      measuredAt: new Date().toISOString(),
    };
    await onComplete?.(report);
    setSaving(false);
  };

  return (
    <div className="absolute inset-0 bg-slate-950 flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 mt-[max(44px,calc(env(safe-area-inset-top)+44px))]">
        <button onClick={onBack} className="text-slate-300 font-bold text-sm">← 뒤로</button>
        <h2 className="text-white font-black">수동 입력</h2>
        <button onClick={onOpenGuide} className="text-amber-400 text-sm font-bold">측정법 ⓘ</button>
      </div>

      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
          <div>
            <label className="block text-xs font-semibold text-slate-400 uppercase tracking-widest mb-1.5">체공 시간 (초)</label>
            <input type="number" inputMode="decimal" step="0.01" value={flight}
              onChange={e => setFlight(e.target.value)} placeholder="0.50"
              className="w-full bg-slate-800 border border-slate-700 text-slate-100 rounded-lg px-3 py-2.5 text-base font-mono focus:outline-none focus:border-amber-500" />
            <p className="text-[11px] text-slate-500 mt-1.5">점프매트·앱 타이머·슬로모 프레임 수로 잰 발이 떠 있던 시간</p>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-400 uppercase tracking-widest mb-1.5">
              체중 (kg) <span className="text-slate-600 normal-case">— 파워 계산 시</span>
            </label>
            <input type="number" inputMode="numeric" step="0.1" value={weight}
              onChange={e => setWeight(e.target.value)} placeholder="70"
              className="w-full bg-slate-800 border border-slate-700 text-slate-100 rounded-lg px-3 py-2.5 text-base font-mono focus:outline-none focus:border-amber-500" />
          </div>
        </div>

        <button onClick={submit} disabled={saving}
          className="w-full rounded-xl bg-amber-500 text-slate-950 font-black py-3.5 active:scale-95 disabled:opacity-60">
          {saving ? '저장 중...' : '점프 분석'}
        </button>

        <p className="text-[11px] text-slate-500 leading-relaxed">
          ※ 높이는 체공시간 기반 추정(h = g·t²/8), 이륙속도 v = g·t/2, 최고파워는
          Sayers 공식(체중 입력 시) 추정값입니다. 카메라가 어려운 환경에서 점프매트
          등으로 잰 체공시간을 입력해 같은 방식으로 기록할 수 있습니다.
        </p>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
//  측정 방법 안내 (가이드 시트)
// ════════════════════════════════════════════════════════════════════════
function JumpGuide({ mode, jumpSubType, onClose }) {
  const meta = JUMP_SUBTYPES[jumpSubType];
  const isReactive = meta.engine === 'reactive';
  return (
    <div className="fixed inset-0 z-[90] bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center"
      onClick={onClose}>
      <div className="w-full sm:max-w-md max-h-[85dvh] overflow-y-auto bg-slate-900 border-t sm:border border-slate-700 rounded-t-3xl sm:rounded-3xl p-5 space-y-4"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-white font-black text-lg">점프 측정 방법</h3>
          <button onClick={onClose} className="text-slate-400 font-bold text-sm">닫기 ✕</button>
        </div>

        {/* 5종 한눈에 — 현재 선택된 종류만 강조 */}
        <div className="grid grid-cols-5 gap-1">
          {JUMP_SUBTYPE_ORDER.map((k) => (
            <div key={k} className={`rounded-lg p-1.5 text-center border ${
              k === jumpSubType ? 'bg-emerald-500/10 border-emerald-500/40' : 'bg-slate-800/60 border-slate-700'}`}>
              <p className="text-white font-black text-[11px]">{JUMP_SUBTYPES[k].code}</p>
            </div>
          ))}
        </div>

        <GuideSection title={meta.guideTitle} emoji={meta.chipLabel.split(' ')[0]} highlight={isReactive}>
          {meta.guideBody}
          {jumpSubType === 'rsi' && (
            <>
              <br /><br />
              <span className="text-amber-300">※ 접지 시간은 ‘착지 → 다시 뜀’ 사이로 측정하므로
              <b className="text-white"> 1~2회만으로는 RSI 변동성을 볼 수 없습니다.</b> 최소 3회 이상 연속으로 뛰세요.
              그리고 <b className="text-white">기본 추천은 측면 촬영</b>입니다 — 정면·후면 영상은 접지시간 신뢰도가 낮아 측정하지 않습니다.</span>
            </>
          )}
          {jumpSubType === 'dj' && (
            <>
              <br /><br />
              <span className="text-amber-300">※ 이 앱은 카메라로 박스 높이를 측정하지 못합니다 — 접지시간·RSI만 기록되고
              박스 높이 자체는 참고용으로만 별도 메모하세요. <b className="text-white">기본 추천은 측면 촬영</b>이며,
              착지 순간부터 재도약까지 <b className="text-white">한 세트(2회 접지구간)</b>만 있으면 측정됩니다.</span>
            </>
          )}
        </GuideSection>

        {isReactive && (
          <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-3">
            <p className="text-emerald-300 text-xs font-bold mb-1">⏱ 접지시간 정확도</p>
            <p className="text-slate-300 text-[11px] leading-relaxed">
              접지 시간은 보통 0.15~0.25초로 매우 짧습니다. 일반 카메라(30fps)는 한 프레임이
              0.033초라 오차가 큽니다. <b className="text-white">240fps 고속영상(슬로우 모션)</b>으로
              찍어 ‘고속영상’ 탭에 올리면 가장 정확합니다. 실시간으로 측정하면 정확도 경고가
              표시될 수 있습니다.
            </p>
          </div>
        )}

        <GuideSection title="① 고속영상 (가장 정확 · 권장)" emoji="📁" highlight>
          갤럭시 카메라 → <b className="text-white">더보기 → 슬로우 모션</b>(슈퍼 슬로우 아님)으로
          240fps 촬영. <b className="text-white">{meta.code}는 {meta.view === 'side' ? '측면' : '정면'} 촬영을 추천</b>합니다.
          삼각대로 골반 높이에 고정하고 전신이 다 들어오게 찍으세요.
          점프 전 1초 이상 똑바로 선 뒤 점프 →
          영상을 ‘고속영상’ 탭에서 업로드하고 촬영 모드(240fps)를 고르면 끝.
        </GuideSection>

        <GuideSection title="② 실시간 카메라 (빠른 확인용)" emoji="🔴">
          앱에서 바로 촬영해 즉시 측정합니다. 폰 카메라가 보통 30fps라
          <b className="text-white"> 고속영상보다 정확도가 낮습니다.</b> {meta.code}는{' '}
          <b className="text-white">{meta.view === 'side' ? '측면' : '정면'}</b>에서,
          카메라를 골반 높이로 고정하고 전신이 보이게 한 뒤, 초록 보정선에 발을 맞춰 선 다음
          점프하세요. 정확한 기록은 고속영상을 권장합니다.
        </GuideSection>

        <GuideSection title="③ 수동 입력" emoji="✍️">
          점프매트·외부 타이머로 잰 체공시간(초)을 직접 입력합니다. 카메라가 어려운
          환경에서 쓰며, 체중을 입력하면 최고파워까지 계산됩니다.
        </GuideSection>

        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3">
          <p className="text-amber-300 text-xs font-bold mb-1">💡 정확도 팁</p>
          <p className="text-slate-300 text-[11px] leading-relaxed">{meta.tip}</p>
        </div>
      </div>
    </div>
  );
}

function GuideSection({ title, emoji, highlight, children }) {
  return (
    <div className={`rounded-xl p-3 ${highlight ? 'bg-emerald-500/10 border border-emerald-500/25' : 'bg-slate-800/60'}`}>
      <p className="text-white font-bold text-sm mb-1">{emoji} {title}</p>
      <p className="text-slate-300 text-[11px] leading-relaxed">{children}</p>
    </div>
  );
}
