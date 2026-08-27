// ai-measure/menus/BodyInfoMeasure.jsx
// 메뉴 12: 신체 정보 (키·몸무게·혈압). 카메라 불필요.
//  - 입력값을 회원 신체기록(store.addBodyRecord)에 저장
//  - 2026 대한고혈압학회 지침 기반 분석(analyzeBody) 재사용
import { useState } from 'react';
import { todayYMD } from '../../utils/dates';
import { store } from '../../demoData';
import { analyzeBody } from '../../services/aiService';
import { evaluateCondition } from '../core/conditionAssessment';
import { askMomiDaily } from '../../services/momiService';
import BodyInfoReport from './BodyInfoReport.jsx';
import ReportActions from '../../components/report/ReportActions';

// [쉬운 버전 리포트 2026-08-27] 신체정보는 analyzeBody()가 자체 판정
// (grade: good/warn/bad)을 쓰고 있어 unifiedReport.buildSummaryData()의
// 표준 필드 구조(자세·보행 등이 쓰는 형태)와 맞지 않는다 — 그대로 넘기면
// keyMetrics가 비어 나온다. 그래서 이 화면만 별도로 SimpleResultReport가
// 기대하는 모양으로 직접 변환한다(grade→normal/caution/risk 매핑).
function buildBodyInfoSimpleSummary(result) {
  if (!result?.items?.length) return null;
  const GRADE_TO_STATUS = { good: 'normal', warn: 'caution', bad: 'risk' };
  const STATUS_LABEL = { normal: '정상', caution: '주의', risk: '확인 필요' };
  const keyMetrics = result.items.map((item) => ({
    key: item.key,
    label: item.label,
    displayValue: item.value,
    unit: item.unit,
    status: { key: GRADE_TO_STATUS[item.grade] || 'unknown', label: item.status },
  }));
  const worstKey = keyMetrics.reduce((acc, m) => {
    const rank = { risk: 2, caution: 1, normal: 0, unknown: 0 }[m.status.key] || 0;
    return rank > acc.rank ? { key: m.status.key, rank } : acc;
  }, { key: 'normal', rank: 0 }).key;
  return {
    title: '신체정보',
    overallScore: worstKey === 'normal' ? 90 : worstKey === 'caution' ? 65 : 35,
    status: worstKey,
    statusLabel: STATUS_LABEL[worstKey],
    keyMetrics,
    topFindings: [],
    recommendations: [result.summary].filter(Boolean),
    measuredAt: result.analyzedAt,
  };
}

// [모미 신규] 오늘의 컨디션 판정 상태(normal/caution/risk) → 배지 색.
// unifiedReport.js STATUS 와 동일한 컬러 매핑(다른 판정 모듈들과 톤 통일).
const CONDITION_TONE = {
  normal: 'text-emerald-700 dark:text-emerald-400',
  caution: 'text-amber-700 dark:text-amber-400',
  risk: 'text-red-700 dark:text-red-400',
  unknown: 'text-slate-500',
};

const TIER_STYLE = {
  good: 'text-emerald-700 dark:text-emerald-400',
  warn: 'text-amber-700 dark:text-amber-400',
  bad:  'text-red-700 dark:text-red-400',
};

export default function BodyInfoMeasure({ member, onSave, onBack, onGuestBodyInfoChange, onViewInReport }) {
  const isVirtual = member?.isVirtual === true;
  // 회원(실제/미등록)의 기존 키·몸무게를 초기값으로 채워, 다른 탭과의 연동 상태를
  // 눈으로 확인하고 이어서 보정할 수 있게 한다.
  const [form, setForm] = useState({
    height: member?.height != null ? String(member.height) : '',
    weight: member?.weight != null ? String(member.weight) : '',
    systolic: '',
    diastolic: '',
    // [모미 신규] 오늘의 컨디션 — 신체정보와 같은 화면·같은 저장 흐름에 통합.
    fatigue: '',
    painNrs: '',
    memo: '',
  });
  const [result, setResult] = useState(null);
  const [saveState, setSaveState] = useState('idle'); // idle | saving | saved | error
  const [saveMsg, setSaveMsg] = useState('');
  const [actionMsg, setActionMsg] = useState('');
  const [savedCondition, setSavedCondition] = useState(null); // 마지막 저장된 evaluateCondition() 결과
  const [guideState, setGuideState] = useState('idle'); // idle | loading | done | error
  const [guideText, setGuideText] = useState('');
  const [guideMsg, setGuideMsg] = useState('');
  const pf = (k) => (e) => {
    const val = e.target.value;
    setForm(f => ({ ...f, [k]: val }));
    // [항목 1] 미등록회원이면 키·몸무게 입력 즉시 허브 신체정보에 반영 → 다른 측정 탭 연동.
    if (isVirtual && (k === 'height' || k === 'weight')) {
      onGuestBodyInfoChange?.({ [k]: val });
    }
  };

  // [모미 신규] 컨디션만 입력한 날(체중 없음)도 저장 가능해야 하므로, "체중 필수"가
  // 아니라 "체중 또는 컨디션 항목 중 하나는 필수"로 완화한다. 체중이 없으면 체성분/혈압
  // 분석(analyzeBody)은 건너뛰고 컨디션만 저장한다.
  const hasBodyInput = !!form.weight;
  const hasConditionInput = !!(form.fatigue || form.painNrs || form.memo.trim());

  const analyze = async () => {
    if (!hasBodyInput && !hasConditionInput) {
      alert('몸무게 또는 오늘의 컨디션 중 하나는 입력해 주세요.');
      return;
    }
    if (hasBodyInput) {
      const measurements = {
        height:    form.height    ? Number(form.height)    : null,
        weight:    Number(form.weight),
        systolic:  form.systolic  ? Number(form.systolic)  : null,
        diastolic: form.diastolic ? Number(form.diastolic) : null,
      };
      setResult(analyzeBody(measurements));
    }
    // [항목 1] 자동 저장: 분석과 동시에 회원 신체기록에 남겨 회차별 비교(리포트 탭)에
    //  바로 반영한다. 별도 '확인·저장' 단계 없이 저장되며, 상태 배지로 결과를 알린다.
    await save();
  };

  const save = async () => {
    if (!member) { setSaveMsg('저장하려면 먼저 회원을 선택하세요(허브 상단).'); return; }
    // [모미 신규] 오늘의 컨디션 판정. conditionAssessment.js — 다른 판정 모듈과 동일하게
    // normal/caution/risk/unknown 문자열을 그대로 저장한다.
    const condition = evaluateCondition({
      fatigue: form.fatigue,
      painNrs: form.painNrs,
      memo: form.memo,
    });
    const payload = {
      height: form.height ? Number(form.height) : null,
      weight: form.weight ? Number(form.weight) : null,
      systolic: form.systolic ? Number(form.systolic) : null,
      diastolic: form.diastolic ? Number(form.diastolic) : null,
      fatigue: condition.fatigue,
      painNrs: condition.painNrs,
      conditionMemo: condition.memo,
      conditionStatus: condition.valid ? condition.status : null,
    };
    setSaveState('saving');
    if (isVirtual) {
      // [항목 1] 미등록회원: 영구 신체기록(store)에 남기지 않고, 허브 신체정보에 반영해
      // 이번 측정 묶음의 다른 탭들이 같은 키/체중을 쓰도록 연동한다.
      onGuestBodyInfoChange?.({ height: form.height, weight: form.weight });
      onSave?.(payload); // 측정 이력(ai)에 신체정보 기록 누적
      setSaveState('saved');
      setSavedCondition(condition.valid ? condition : null);
      setSaveMsg('미등록회원 신체정보가 이번 측정에 반영되었습니다. (다른 측정 탭과 연동)');
      return;
    }
    try {
      await store.addBodyRecord(member.id, {
        recordedAt: todayYMD(),
        height:    form.height ? Number(form.height) : null,
        weight:    form.weight ? Number(form.weight) : null,
        systolic:  form.systolic  ? Number(form.systolic)  : null,
        diastolic: form.diastolic ? Number(form.diastolic) : null,
        fatigue: condition.fatigue,
        painNrs: condition.painNrs,
        conditionMemo: condition.memo,
        conditionStatus: condition.valid ? condition.status : null,
        note: 'AI 측정 입력',
      });
    } catch (e) { setSaveState('error'); setSaveMsg('신체정보 저장에 실패했습니다. 네트워크 확인 후 다시 시도하세요.'); return; }
    // 허브의 onSave 도 호출(측정 이력 누적용)
    onSave?.(payload);
    setSaveState('saved');
    setSavedCondition(condition.valid ? condition : null);
    setSaveMsg('신체정보가 저장되었습니다. (회원 신체기록 + 리포트에 반영)');
  };

  // [모미 신규] "오늘의 운동가이드" — 방금 저장한 컨디션을 바탕으로 /api/momi(kind:'daily')를
  // 호출한다. MomiInsightPanel과 동일한 loading/error/answer 3단 상태 패턴.
  const askDailyGuide = async () => {
    if (!member || !savedCondition) return;
    setGuideState('loading');
    setGuideMsg('');
    try {
      const text = await askMomiDaily({ member, condition: savedCondition });
      setGuideText(text);
      setGuideState('done');
    } catch (e) {
      setGuideState('error');
      setGuideMsg(e.message || '오늘의 가이드를 불러오는 중 문제가 생겼습니다.');
    }
  };

  const INP = 'w-full bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-100 rounded-xl px-3 py-2.5 text-sm font-mono focus:outline-none focus:border-amber-500';
  const LBL = 'block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-1.5';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="measure-back">← 메뉴</button>
        <h2 className="measure-title">신체 정보</h2>
        <span className="w-12" />
      </div>

      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 grid grid-cols-2 gap-3">
        <div><label className={LBL}>키 (cm)</label><input type="number" step="0.1" value={form.height} onChange={pf('height')} placeholder="175" className={INP} /></div>
        <div><label className={LBL}>몸무게 (kg)</label><input type="number" step="0.1" value={form.weight} onChange={pf('weight')} placeholder="70" className={INP} /></div>
        <div><label className={LBL}>최고혈압</label><input type="number" value={form.systolic} onChange={pf('systolic')} placeholder="120" className={INP} /></div>
        <div><label className={LBL}>최저혈압</label><input type="number" value={form.diastolic} onChange={pf('diastolic')} placeholder="80" className={INP} /></div>
      </div>

      {/* [모미 신규] 오늘의 컨디션 — 신체정보와 같은 저장 흐름에 통합. 몸무게 없이 이것만
          입력해도 저장할 수 있다(analyze()의 hasBodyInput/hasConditionInput 참고). */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 space-y-3">
        <p className="text-xs font-bold text-amber-700 dark:text-amber-400 uppercase tracking-widest">오늘의 컨디션</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={LBL}>피로도 (1~5)</label>
            <input type="number" min="1" max="5" value={form.fatigue} onChange={pf('fatigue')} placeholder="1~5" className={INP} />
          </div>
          <div>
            <label className={LBL}>통증 NRS (0~10)</label>
            <input type="number" min="0" max="10" value={form.painNrs} onChange={pf('painNrs')} placeholder="0=없음, 10=최악" className={INP} />
          </div>
        </div>
        <div>
          <label className={LBL}>한줄메모</label>
          <input type="text" value={form.memo} onChange={pf('memo')} placeholder="예) 어제 스쿼트 후 무릎이 뻐근해요" maxLength={200} className={INP} />
        </div>
      </div>

      <button onClick={analyze} disabled={saveState === 'saving'} className="btn btn-primary w-full disabled:opacity-60">
        {saveState === 'saving' ? '저장 중…' : hasBodyInput ? '분석 · 저장' : '컨디션 저장'}
      </button>

      {result && (
        <div className="card-accent p-4 space-y-3 animate-fade-in">
          <p className="text-xs font-bold text-amber-700 dark:text-amber-400 uppercase tracking-widest">분석 결과</p>
          {result.items.map(item => (
            <div key={item.key} className="bg-slate-100 dark:bg-slate-800 rounded-xl px-3 py-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-500 dark:text-slate-400">{item.label}</span>
                <span className="font-mono font-black text-sm text-slate-800 dark:text-slate-100">
                  {item.value}<span className="text-slate-500 text-[10px]"> {item.unit}</span>
                  <span className={`ml-2 ${TIER_STYLE[item.grade]}`}>{item.status || ''}</span>
                </span>
              </div>
              <p className="text-[11px] text-slate-500 mt-1">{item.description}</p>
            </div>
          ))}
          <div className="bg-slate-100/50 dark:bg-slate-800/50 rounded-xl px-3 py-2.5">
            <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed">{result.summary}</p>
          </div>
          <button onClick={save} disabled={saveState === 'saving'} className="btn btn-primary w-full disabled:opacity-60">
            {saveState === 'saving' ? '저장 중…' : saveState === 'saved' ? '✓ 저장됨 (다시 저장)' : '확인 · 저장'}
          </button>
          {saveMsg && <p className={`text-center text-xs font-bold ${saveState === 'error' ? 'text-red-700 dark:text-red-400' : 'text-emerald-700 dark:text-emerald-400'}`}>{saveMsg}</p>}
        </div>
      )}

      {/* [모미 신규] 체중 없이 컨디션만 저장한 경우 분석 카드가 없으므로, 저장 결과는
          여기서 따로 보여준다(위 카드 안의 saveMsg는 result가 있을 때만 렌더링됨). */}
      {!result && saveMsg && (
        <p className={`text-center text-xs font-bold ${saveState === 'error' ? 'text-red-700 dark:text-red-400' : 'text-emerald-700 dark:text-emerald-400'}`}>{saveMsg}</p>
      )}

      {/* [모미 신규] 오늘의 운동가이드 — 방금 저장한 컨디션을 Momi(kind:'daily')에게 물어본다.
          MomiInsightPanel(리포트 탭)과 동일한 상태 패턴을 이 화면 톤(Tailwind)에 맞춰 재구현. */}
      {savedCondition && (
        <div className="card-accent p-4 space-y-3 animate-fade-in">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold text-amber-700 dark:text-amber-400 uppercase tracking-widest">오늘의 컨디션 판정</p>
            <span className={`text-xs font-black ${CONDITION_TONE[savedCondition.status]}`}>
              {{ normal: '정상', caution: '주의', risk: '위험' }[savedCondition.status] || '확인 필요'}
            </span>
          </div>
          <button onClick={askDailyGuide} disabled={guideState === 'loading'} className="btn btn-primary w-full disabled:opacity-60">
            {guideState === 'loading' ? '모미가 오늘의 가이드를 준비 중이에요…' : '🤖 오늘의 운동가이드 보기'}
          </button>
          {guideState === 'error' && <p className="text-center text-xs font-bold text-red-700 dark:text-red-400">{guideMsg}</p>}
          {guideState === 'done' && (
            <div className="bg-slate-100/50 dark:bg-slate-800/50 rounded-xl px-3 py-2.5">
              <p className="text-[11px] text-slate-700 dark:text-slate-200 leading-relaxed whitespace-pre-wrap">{guideText}</p>
            </div>
          )}
        </div>
      )}

      {/* [항목 6] A4 카드형 결과 리포트 + JPG 전송 */}
      {result && (
        <>
          <BodyInfoReport
            id="body-report-sheet"
            member={member}
            result={result}
            history={member && !isVirtual ? store.getBodyRecords(member.id) : []}
          />
          <div className="space-y-2 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/95 dark:bg-slate-950/95 p-3">
            <ReportActions
              reportNodeId="body-report-sheet"
              baseName={`${member?.name || '회원'}_신체정보`}
              reportButtonLabel="🖼 A4 리포트 JPG 전송"
              onMessage={setActionMsg}
              simpleSummary={buildBodyInfoSimpleSummary(result)}
              simpleMember={member}
            />
            {actionMsg && <p className="text-center text-xs text-slate-500 dark:text-slate-400">{actionMsg}</p>}
          </div>
        </>
      )}

      {/* [리포트 통합 2026-08-09] 다른 측정 종류와 동일 패턴이지만 여기선 딱히
          "열어줄 뷰어"가 없다 — 신체정보는 단일 리포트가 아니라 회원의 측정
          캘린더(Report.jsx)에 누적되는 값이고, 그 화면은 이미 가장 최근 측정일을
          기본으로 보여준다(dailyGroups[0]). 그래서 회원 선택만 해주면 저절로
          오늘 저장한 값이 보인다 — 별도 뷰어 오픈 로직이 필요 없다. 컨디션만
          저장한 경우(result 없음)에도 캘린더엔 그대로 반영되므로 saveState만 본다. */}
      {saveState === 'saved' && !isVirtual && typeof onViewInReport === 'function' && (
        <button
          onClick={onViewInReport}
          className="w-full rounded-xl border border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300 font-bold text-sm py-2.5"
        >
          📊 결과리포트에서 보기
        </button>
      )}

      <p className="text-[11px] text-slate-500 leading-relaxed">
        ※ 혈압 분석은 「대한고혈압학회 고혈압 진료지침 2026」 기준입니다. 저장 시 회원의
        신체기록과 리포트에 함께 반영됩니다.
      </p>
    </div>
  );
}
