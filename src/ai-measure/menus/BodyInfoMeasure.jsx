// ai-measure/menus/BodyInfoMeasure.jsx
// 메뉴 12: 신체 정보 (키·몸무게·혈압). 카메라 불필요.
//  - 입력값을 회원 신체기록(store.addBodyRecord)에 저장
//  - 2026 대한고혈압학회 지침 기반 분석(analyzeBody) 재사용
import { useState } from 'react';
import { store } from '../../demoData';
import { analyzeBody } from '../../services/aiService';

const TIER_STYLE = {
  good: 'text-emerald-400',
  warn: 'text-amber-400',
  bad:  'text-red-400',
};

export default function BodyInfoMeasure({ member, onSave, onBack }) {
  const [form, setForm] = useState({ height: '', weight: '', systolic: '', diastolic: '' });
  const [result, setResult] = useState(null);
  const pf = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  const analyze = () => {
    if (!form.weight) { alert('몸무게는 필수입니다.'); return; }
    const measurements = {
      height:    form.height    ? Number(form.height)    : null,
      weight:    Number(form.weight),
      systolic:  form.systolic  ? Number(form.systolic)  : null,
      diastolic: form.diastolic ? Number(form.diastolic) : null,
    };
    setResult(analyzeBody(measurements));
  };

  const save = async () => {
    if (!member) { alert('저장하려면 먼저 회원을 선택하세요(허브 상단).'); return; }
    try {
      await store.addBodyRecord(member.id, {
        recordedAt: new Date().toISOString().slice(0, 10),
        height:    form.height    ? Number(form.height)    : null,
        weight:    Number(form.weight),
        systolic:  form.systolic  ? Number(form.systolic)  : null,
        diastolic: form.diastolic ? Number(form.diastolic) : null,
        note: 'AI 측정 입력',
      });
    } catch (e) { alert('신체정보 저장에 실패했습니다. 네트워크 확인 후 다시 시도하세요.'); return; }
    // 허브의 onSave 도 호출(측정 이력 누적용)
    onSave?.({
      height: form.height ? Number(form.height) : null,
      weight: Number(form.weight),
      systolic: form.systolic ? Number(form.systolic) : null,
      diastolic: form.diastolic ? Number(form.diastolic) : null,
    });
    alert('신체정보가 저장되었습니다. (회원 신체기록 + 리포트에 반영)');
  };

  const INP = 'w-full bg-slate-800 border border-slate-700 text-slate-100 rounded-xl px-3 py-2.5 text-sm font-mono focus:outline-none focus:border-amber-500';
  const LBL = 'block text-xs font-semibold text-slate-400 uppercase tracking-widest mb-1.5';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="measure-back">← 메뉴</button>
        <h2 className="measure-title">신체 정보</h2>
        <span className="w-12" />
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 grid grid-cols-2 gap-3">
        <div><label className={LBL}>키 (cm)</label><input type="number" step="0.1" value={form.height} onChange={pf('height')} placeholder="175" className={INP} /></div>
        <div><label className={LBL}>몸무게 (kg) <span className="text-red-400">*</span></label><input type="number" step="0.1" value={form.weight} onChange={pf('weight')} placeholder="70" className={INP} /></div>
        <div><label className={LBL}>최고혈압</label><input type="number" value={form.systolic} onChange={pf('systolic')} placeholder="120" className={INP} /></div>
        <div><label className={LBL}>최저혈압</label><input type="number" value={form.diastolic} onChange={pf('diastolic')} placeholder="80" className={INP} /></div>
      </div>

      <button onClick={analyze} className="btn btn-primary w-full">분석</button>

      {result && (
        <div className="card-accent p-4 space-y-3 animate-fade-in">
          <p className="text-xs font-bold text-amber-400 uppercase tracking-widest">분석 결과</p>
          {result.items.map(item => (
            <div key={item.key} className="bg-slate-800 rounded-xl px-3 py-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-400">{item.label}</span>
                <span className="font-mono font-black text-sm text-slate-100">
                  {item.value}<span className="text-slate-500 text-[10px]"> {item.unit}</span>
                  <span className={`ml-2 ${TIER_STYLE[item.grade]}`}>{item.status || ''}</span>
                </span>
              </div>
              <p className="text-[11px] text-slate-500 mt-1">{item.description}</p>
            </div>
          ))}
          <div className="bg-slate-800/50 rounded-xl px-3 py-2.5">
            <p className="text-[11px] text-slate-300 leading-relaxed">{result.summary}</p>
          </div>
          <button onClick={save} className="btn btn-primary w-full">회원 기록에 저장</button>
        </div>
      )}

      <p className="text-[11px] text-slate-500 leading-relaxed">
        ※ 혈압 분석은 「대한고혈압학회 고혈압 진료지침 2026」 기준입니다. 저장 시 회원의
        신체기록과 리포트에 함께 반영됩니다.
      </p>
    </div>
  );
}
