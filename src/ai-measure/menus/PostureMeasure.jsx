import { useMemo, useState } from 'react';
import { todayYMD } from '../../utils/dates';
import { analyzePostureFromLandmarks } from '../core/postureMath';
import PostureReport from './PostureReport.jsx';

const sampleLandmarks = Array.from({ length: 33 }, (_, index) => ({
  index,
  x: 0.5,
  y: 0.5,
  z: 0,
  visibility: 0.99,
}));

Object.assign(sampleLandmarks[0], { x: 0.5, y: 0.08 });
Object.assign(sampleLandmarks[7], { x: 0.47, y: 0.11 });
Object.assign(sampleLandmarks[8], { x: 0.53, y: 0.11 });
Object.assign(sampleLandmarks[11], { x: 0.42, y: 0.25 });
Object.assign(sampleLandmarks[12], { x: 0.58, y: 0.25 });
Object.assign(sampleLandmarks[23], { x: 0.43, y: 0.52 });
Object.assign(sampleLandmarks[24], { x: 0.57, y: 0.52 });
Object.assign(sampleLandmarks[25], { x: 0.44, y: 0.71 });
Object.assign(sampleLandmarks[26], { x: 0.56, y: 0.71 });
Object.assign(sampleLandmarks[27], { x: 0.43, y: 0.92 });
Object.assign(sampleLandmarks[28], { x: 0.57, y: 0.92 });
Object.assign(sampleLandmarks[29], { x: 0.42, y: 0.94 });
Object.assign(sampleLandmarks[30], { x: 0.58, y: 0.94 });
Object.assign(sampleLandmarks[31], { x: 0.41, y: 0.96 });
Object.assign(sampleLandmarks[32], { x: 0.59, y: 0.96 });

const sampleJson = JSON.stringify(sampleLandmarks, null, 2);

export default function PostureMeasure({ member, onSave, onBack }) {
  const defaultHeight = member?.height || member?.heightCm || '';
  const defaultAge = getAge(member?.birthDate) || member?.age || '';
  const [form, setForm] = useState({
    heightCm: defaultHeight,
    actualAge: defaultAge,
    round: 1,
    phase: 'before',
    frontUrl: '',
    sideLeftUrl: '',
    sideRightUrl: '',
    backUrl: '',
    previousFrontUrl: '',
    landmarksJson: sampleJson,
    previousLandmarksJson: '',
  });
  const [error, setError] = useState('');
  const [report, setReport] = useState(null);
  const [saving, setSaving] = useState(false);

  const currentLandmarks = useMemo(() => safeParseLandmarks(form.landmarksJson), [form.landmarksJson]);
  const previousLandmarks = useMemo(() => safeParseLandmarks(form.previousLandmarksJson), [form.previousLandmarksJson]);

  const setField = (key) => (event) => setForm((prev) => ({ ...prev, [key]: event.target.value }));

  const analyze = () => {
    setError('');
    if (!currentLandmarks) {
      setError('BlazePose 0~32 랜드마크 JSON 배열을 확인해 주세요.');
      return;
    }
    const heightCm = form.heightCm ? Number(form.heightCm) : member?.height || null;
    const actualAge = form.actualAge ? Number(form.actualAge) : getAge(member?.birthDate);
    const analysis = analyzePostureFromLandmarks(currentLandmarks, { heightCm, actualAge });
    setReport(buildReport({ form, member, currentLandmarks, previousLandmarks, analysis, heightCm, actualAge }));
  };

  const save = async () => {
    if (!member) {
      alert('저장하려면 먼저 회원을 선택해 주세요.');
      return;
    }
    const finalReport = report || createReportFromForm({ form, member, currentLandmarks, previousLandmarks });
    if (!finalReport) {
      setError('저장할 수 있는 분석 결과가 없습니다.');
      return;
    }
    setSaving(true);
    try {
      await onSave?.(finalReport);
      alert('자세·체형 분석 리포트가 저장되었습니다.');
    } catch (event) {
      alert(`저장에 실패했습니다. ${event?.message || ''}`);
    } finally {
      setSaving(false);
    }
  };

  const INP = 'w-full bg-slate-800 border border-slate-700 text-slate-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-500';
  const LBL = 'block text-xs font-bold text-slate-400 uppercase tracking-widest mb-1.5';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="measure-back">← 메뉴</button>
        <h2 className="measure-title">자세·체형 측정</h2>
        <span className="w-12" />
      </div>

      <section className="rounded-2xl border border-slate-800 bg-slate-900 p-4 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={LBL}>키(cm)</label>
            <input className={INP} type="number" step="0.1" value={form.heightCm} onChange={setField('heightCm')} placeholder="175" />
          </div>
          <div>
            <label className={LBL}>실제 나이</label>
            <input className={INP} type="number" step="1" value={form.actualAge} onChange={setField('actualAge')} placeholder="35" />
          </div>
          <div>
            <label className={LBL}>측정 회차</label>
            <input className={INP} type="number" step="1" value={form.round} onChange={setField('round')} />
          </div>
          <div>
            <label className={LBL}>구분</label>
            <select className={INP} value={form.phase} onChange={setField('phase')}>
              <option value="before">Before</option>
              <option value="after">After</option>
              <option value="followup">Follow-up</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div><label className={LBL}>전면 이미지 URL</label><input className={INP} value={form.frontUrl} onChange={setField('frontUrl')} /></div>
          <div><label className={LBL}>이전 전면 URL</label><input className={INP} value={form.previousFrontUrl} onChange={setField('previousFrontUrl')} /></div>
          <div><label className={LBL}>좌측면 이미지 URL</label><input className={INP} value={form.sideLeftUrl} onChange={setField('sideLeftUrl')} /></div>
          <div><label className={LBL}>우측면 이미지 URL</label><input className={INP} value={form.sideRightUrl} onChange={setField('sideRightUrl')} /></div>
          <div className="col-span-2"><label className={LBL}>후면 이미지 URL</label><input className={INP} value={form.backUrl} onChange={setField('backUrl')} /></div>
        </div>

        <div>
          <label className={LBL}>오늘 BlazePose 랜드마크 JSON</label>
          <textarea className={`${INP} min-h-[180px] resize-y font-mono text-xs`} value={form.landmarksJson} onChange={setField('landmarksJson')} />
        </div>
        <div>
          <label className={LBL}>이전 BlazePose 랜드마크 JSON</label>
          <textarea className={`${INP} min-h-[100px] resize-y font-mono text-xs`} value={form.previousLandmarksJson} onChange={setField('previousLandmarksJson')} placeholder="Before/After Ghosting 비교 시 입력" />
        </div>

        {error && <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>}

        <div className="flex gap-2">
          <button onClick={analyze} className="btn btn-primary flex-1">분석</button>
          <button onClick={save} disabled={saving || !currentLandmarks} className="btn flex-1 disabled:opacity-40">
            {saving ? '저장 중...' : '리포트 저장'}
          </button>
        </div>
      </section>

      {report && (
        <PostureReport
          report={report}
          member={member}
          currentLandmarks={currentLandmarks}
          previousLandmarks={previousLandmarks}
          currentImageUrl={form.frontUrl}
          previousImageUrl={form.previousFrontUrl}
          heightCm={Number(form.heightCm) || null}
          actualAge={Number(form.actualAge) || null}
        />
      )}
    </div>
  );
}

function createReportFromForm({ form, member, currentLandmarks, previousLandmarks }) {
  if (!currentLandmarks) return null;
  const heightCm = form.heightCm ? Number(form.heightCm) : member?.height || null;
  const actualAge = form.actualAge ? Number(form.actualAge) : getAge(member?.birthDate);
  const analysis = analyzePostureFromLandmarks(currentLandmarks, { heightCm, actualAge });
  return buildReport({ form, member, currentLandmarks, previousLandmarks, analysis, heightCm, actualAge });
}

function safeParseLandmarks(raw) {
  if (!raw?.trim()) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length < 33) return null;
    return parsed.map((point) => ({
      x: Number(point.x),
      y: Number(point.y),
      z: point.z == null ? 0 : Number(point.z),
      visibility: point.visibility == null ? 1 : Number(point.visibility),
    }));
  } catch {
    return null;
  }
}

function buildReport({ form, member, currentLandmarks, previousLandmarks, analysis, heightCm, actualAge }) {
  return {
    kind: 'posture',
    member: member ? { id: member.id, name: member.name } : null,
    memberId: member?.id || null,
    memberName: member?.name || '',
    measurementRound: Number(form.round) || 1,
    pairKey: member?.id ? `${member.id}_posture` : 'posture_unassigned',
    phase: form.phase,
    measuredAt: new Date().toISOString(),
    recordedAt: todayYMD(),
    heightCm,
    actualAge,
    view: 'front',
    imageUrl: form.frontUrl || '',
    image_urls: {
      front: form.frontUrl || '',
      side_left: form.sideLeftUrl || '',
      side_right: form.sideRightUrl || '',
      back: form.backUrl || '',
      current: {
        front: form.frontUrl || '',
        side_left: form.sideLeftUrl || '',
        side_right: form.sideRightUrl || '',
        back: form.backUrl || '',
      },
      before: {
        front: form.previousFrontUrl || '',
      },
    },
    rawLandmarks: currentLandmarks,
    analysis,
    postureScore: analysis.score,
    bodyAge: analysis.bodyAge,
    summaryComment: analysis.summaryComment,
    comparison: {
      previousImageUrl: form.previousFrontUrl || '',
      previousLandmarks: previousLandmarks || null,
      image_urls: {
        front: form.previousFrontUrl || '',
      },
    },
  };
}

function getAge(birthDate) {
  if (!birthDate) return null;
  const birth = new Date(birthDate);
  if (Number.isNaN(birth.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) age -= 1;
  return age > 0 ? age : null;
}
