// Schedule.jsx — v5
// ✅ 요구사항1: 트레이너별 세션 배지
// ✅ 요구사항2: 회원 기반 트레이너 필터링
// ✅ 요구사항3: 회원 기반 수업종류 필터링
// ✅ 요구사항4: 10분 단위 스냅 + 종료시간 자동 +1hr
// ✅ 요구사항5: 외부 일정 탭 (출강/교육/현장, 자유 시간, memberId=null)
import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { store } from '../demoData';
import { toYMD } from '../utils/dates';
import { sortByName } from '../utils/memberList';
import { findDuplicateSchedules, summarizeDuplicates } from '../services/scheduleAudit';

// ── 시간 유틸 ─────────────────────────────────────────────
// 10분 단위 반올림 스냅
function snapTo10(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const rounded = Math.round(m / 10) * 10;
  if (rounded === 60) {
    const nh = Math.min(h + 1, 23);
    return `${String(nh).padStart(2,'0')}:00`;
  }
  return `${String(h).padStart(2,'0')}:${String(rounded).padStart(2,'0')}`;
}
// 시작 +1시간
function addHour(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const nh = h + 1;
  return nh <= 23 ? `${String(nh).padStart(2,'0')}:${String(m).padStart(2,'0')}` : t;
}

const WEEKDAYS = ['일','월','화','수','목','금','토'];
const weekday  = d => d ? WEEKDAYS[new Date(d+'T12:00:00').getDay()] : '';
const fmt      = toYMD; // CV-A: 로컬 시간 기준(UTC 버그 수정 — 새벽에 '오늘'이 어제로 표시되던 문제)
const fmtKo    = d => new Date(d+'T12:00:00').toLocaleDateString('ko-KR',{month:'short',day:'numeric',weekday:'short'});
const addD     = (d,n) => { const r=new Date(d+'T12:00:00'); r.setDate(r.getDate()+n); return fmt(r); };

// 회원이름(잔여N) 표시용 — 해당 스케줄의 회원·트레이너 기준 잔여 세션 조회.
// members 배열을 받아 실시간 잔여를 계산(자동 변경 반영).
function remainOf(s, members) {
  if (!s.memberId) return null;
  const m = (members||[]).find(x => x.id === s.memberId);
  if (!m || !m.trainerSessions) return null;
  const ts = m.trainerSessions[s.trainerId];
  return ts ? ts.remaining : null;
}
// ── 기존 스케줄 회차 표기 보정 ─────────────────────────────
// ⚠ 과거에는 total-i 로 회차를 '역산'했으나, 이는 재등록/취소/노쇼가 섞이면
//    실제 잔여(remaining)와 어긋나 잘못된 회차(예: 차감 안 됐는데 20→19 처럼)를
//    만들어냈다. 측정 정직성 원칙에 따라 추정 역산을 폐기했다.
//    회차(sessionAtBooking)는 오직 createScheduleWithDeduction 이 예약 시점에
//    기록한 실제 차감-직전 잔여값만 신뢰한다.

// 과거 backfill(total-i 역산)이 잘못 기록한 회차를 1회 정리한다.
// sessionBackfilled=true 인 예약의 추정 회차를 비워(null) 잘못된 숫자 노출을 막는다.
// 실제 차감으로 기록된(sessionDeducted=true) 예약은 건드리지 않는다.
async function cleanupBackfilledSessions() {
  const all = store.getSchedules();
  const wrong = all.filter(s => s.sessionBackfilled && !s.sessionDeducted);
  for (const s of wrong) {
    try {
      await store.updateSchedule(s.id, {
        sessionAtBooking: null,
        sessionTotalAtBooking: null,
        sessionBackfilled: false,
      });
    } catch (e) { console.error('[backfill 정리 실패]', s.id, e); }
  }
  return wrong.length;
}

// 과거 회차 자동 재배정(renumberSessionAtBooking) 버그가 남긴 잘못된 표시값을
// 1회 정리한다. 그 버그는 실제로 차감되지 않은 예약(잔여 0이라 건너뛴 예약 —
// 항상 sessionAtBooking=0 이어야 함)까지 재배정 대상에 포함시켜, 날짜가
// 뒤로 갈수록 회차가 0 밑으로(-1, -2 …) 떨어지는 오표시를 만들어냈다.
// sessionDeducted!==true 인데 sessionAtBooking 이 0이 아닌 예약은 이 버그가
// 아니면 나올 수 없는 조합이므로(정상 코드 경로는 항상 0을 기록), 원래
// 값인 0으로 되돌린다. 트레이너가 세션 탭에서 직접 고친 값(sessionManual)은
// 정당한 값일 수 있으므로 건드리지 않는다.
async function cleanupCorruptedSessionRenumbering() {
  const all = store.getSchedules();
  const wrong = all.filter(s =>
    s.sessionDeducted !== true && !s.sessionManual &&
    s.sessionAtBooking != null && s.sessionAtBooking !== 0
  );
  for (const s of wrong) {
    try {
      await store.updateSchedule(s.id, { sessionAtBooking: 0 });
    } catch (e) { console.error('[회차 재배정 오표시 정리 실패]', s.id, e); }
  }
  return wrong.length;
}

// 회원이름 + 회차 표기
//  - sessionAtBooking(예약 시점 차감 직전 잔여) = 이 수업의 시작 회차값
//  - 첫 수업(시작값 == 총횟수): "N(s)"  / 마지막 수업(시작값 == 1): "1(e)"
//    그 외 중간 수업: 숫자만 "N"
//    예) 10회 등록 → 10(s), 9, 8 ... 2, 1(e)
//  - sessionAtBooking이 없는 구버전 레코드는 현재 잔여값으로 폴백
function nameWithRemain(s, members) {
  if (s.isConsult || s.classType === '상담') return '상담';
  if (s.isExternal || !s.memberId) return s.memo?.slice(0,8) || '외부';
  const base = s.memberName;
  if (s.sessionAtBooking != null) {
    const n = s.sessionAtBooking;                  // 이 수업 시작 시 잔여
    const total = s.sessionTotalAtBooking ?? null; // 예약 당시 총 등록 횟수
    let tag = '';
    if (total != null && n === total) tag = '(s)'; // 첫 수업
    else if (n === 1) tag = '(e)';                 // 마지막 수업
    return `${base} ${n}${tag}`;
  }
  // 구버전 폴백: 현재 잔여값
  const r = remainOf(s, members);
  return r != null ? `${base}(${r})` : base;
}

const STATUS_MAP = {
  scheduled:{ label:'예정', bg:'bg-slate-700 text-slate-300',        dot:'bg-slate-400'   },
  attended: { label:'출석', bg:'bg-emerald-500/20 text-emerald-400', dot:'bg-emerald-400' },
  canceled: { label:'취소', bg:'bg-red-500/20 text-red-400',         dot:'bg-red-400'     },
  noshow:   { label:'노쇼', bg:'bg-orange-500/20 text-orange-400',   dot:'bg-orange-400'  },
};

const SEL = "w-full bg-slate-800 border border-slate-700 text-slate-100 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-amber-500 disabled:opacity-40 disabled:cursor-not-allowed";
const INP = "w-full bg-slate-800 border border-slate-700 text-slate-100 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-amber-500";
const LBL = "block text-xs font-semibold text-slate-400 uppercase tracking-widest mb-1.5";

const getUserTrainerId = user => (user?.role === 'trainer' ? (user.trainerId || user.id) : null);
const memberHasTrainer = (member, trainerId) => Boolean(trainerId && member?.trainerSessions?.[trainerId]);
const memberSearchText = member => [
  member?.name || '',
  member?.phone || '',
  member?.memo || '',
  ...(member?.classTypes || []),
].join(' ').toLowerCase();

// ── 날짜+요일 인풋 ────────────────────────────────────────
function DateWd({ label, value, onChange }) {
  const wd = weekday(value);
  return (
    <div>
      <label className={LBL}>{label}</label>
      <div className="flex items-center gap-2">
        <input type="date" value={value} onChange={e=>onChange(e.target.value)}
          className="flex-1 bg-slate-800 border border-slate-700 text-slate-100 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-amber-500"/>
        {wd && (
          <span className="text-amber-400 font-black text-sm px-2.5 py-2 bg-amber-500/10 border border-amber-500/20 rounded-xl whitespace-nowrap">
            {wd}요일
          </span>
        )}
      </div>
    </div>
  );
}

// ── 세션 복원 (예약 취소/삭제 시 +1) ──────────────────────
// 주/일 뷰 공통 일정 행 (동일 높이·스타일)
function CompactRow({ s, members, onClick }) {
  const isExt = s.isExternal || !s.memberId;
  const nm = nameWithRemain(s, members);
  const st = STATUS_MAP[s.status] || STATUS_MAP.scheduled;
  return (
    <div onClick={() => onClick(s)}
      className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-slate-800/50 transition-colors">
      <div className="w-1 h-8 rounded-full flex-shrink-0" style={{ background: s.trainerColor || '#94a3b8' }} />
      <div className="flex-shrink-0 w-12 text-[11px] font-mono text-slate-400 leading-tight">{s.startTime}</div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold truncate text-slate-200">
          {isExt && <span className="text-purple-400 text-[10px] mr-1">[외]</span>}{nm}
        </p>
        <p className="text-[10px] text-slate-500 truncate">{s.trainerName || '트레이너'}{s.classType ? ` · ${s.classType}` : ''}</p>
      </div>
      <span className={`flex-shrink-0 w-1.5 h-1.5 rounded-full ${st.dot}`} />
    </div>
  );
}

// ── 예약 상세/수정/삭제 모달 ─────────────────────────────
function ScheduleDetailModal({ schedule:initS, onClose, onUpdate, onDelete }) {
  const [s, setS]           = useState(initS);
  const [editMode, setEdit] = useState(false);
  const [trainers, setTr]   = useState([]);
  const [members,  setMb]   = useState([]);
  const [form, setForm]     = useState({
    date:initS.date, startTime:initS.startTime, endTime:initS.endTime||'',
    classType:initS.classType, trainerId:initS.trainerId||'',
    memberId:initS.memberId||'', memo:initS.memo||'',
    sessionAtBooking: initS.sessionAtBooking ?? '',
  });

  useEffect(() => {
    setTr(store.getTrainers()); setMb(store.getMembers());
    const fresh = store.getSchedules().find(sc=>sc.id===initS.id);
    if (fresh) {
      setS(fresh);
      setForm(p=>({...p, sessionAtBooking: fresh.sessionAtBooking ?? ''}));
    }
  }, [initS.id]);

  const st     = STATUS_MAP[s.status] || STATUS_MAP.scheduled;
  const wd     = weekday(s.date);
  const isExt  = s.isExternal || !s.memberId;
  const isConsult = s.isConsult || s.classType === '상담';
  const dispName = isConsult ? '💬 상담' : (isExt ? (s.memo||'외부 일정') : s.memberName);

  const [processing, setProcessing] = useState(false);

  const markStatus = async status => {
    if (processing) return;
    const fresh = store.getSchedules().find(sc=>sc.id===s.id);
    if (fresh?.statusFinalized) { alert('이미 처리된 스케줄입니다.'); return; }
    setProcessing(true);
    try {
      await store.finalizeSchedule(s.id, status);  // 상태확정+출석일/세션복원 원자적 처리
      onUpdate();
    } catch (e) {
      console.error('[상태 확정 실패]', e);
      alert(e?.message || '처리에 실패했습니다. 네트워크 확인 후 다시 시도하세요.');
    } finally {
      setProcessing(false);
    }
  };

  const removeSchedule = async () => {
    if (processing || !window.confirm('예약을 삭제하시겠습니까?')) return;
    setProcessing(true);
    try {
      // 삭제+세션복원을 한 batch로 원자 처리(둘 다 성공 또는 둘 다 실패)
      await store.deleteScheduleWithRestore(s.id);
      onDelete();
    } catch (e) {
      console.error('[삭제 실패]', e);
      alert(e?.message || '삭제에 실패했습니다. 네트워크 확인 후 다시 시도하세요.');
    } finally {
      setProcessing(false);
    }
  };

  const saveEdit = () => {
    const t = trainers.find(tr=>tr.id===form.trainerId);
    const m = members.find(me=>me.id===form.memberId);
    // 회차 수동 수정 처리 (일반 회원 수업만)
    const sessionPatch = {};
    if (!isExt && !isConsult) {
      const raw = String(form.sessionAtBooking).trim();
      if (raw !== '') {
        const n = parseInt(raw, 10);
        if (!isNaN(n) && n >= 0 && n !== s.sessionAtBooking) {
          sessionPatch.sessionAtBooking = n;
          sessionPatch.sessionManual = true; // 자동 보정이 덮어쓰지 않도록
        }
      }
    }
    store.updateSchedule(s.id, {
      date:form.date, startTime:form.startTime, endTime:form.endTime,
      classType:form.classType, trainerId:form.trainerId,
      trainerName:t?.name||s.trainerName, trainerColor:t?.color||s.trainerColor,
      ...(isExt ? { memo:form.memo } : { memberId:form.memberId, memberName:m?.name||s.memberName }),
      ...sessionPatch,
    });
    setEdit(false); onUpdate();
  };

  const trainerCT = trainers.find(t=>t.id===form.trainerId)?.classTypes||[];
  const pf = f => e => setForm(p=>({...p,[f]:e.target.value}));

  return (
    <div className="modal-overlay">
      <div className="modal-box">

        {/* 헤더 */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-800 flex-shrink-0">
          <div className="w-3 h-10 rounded-full flex-shrink-0" style={{background:s.trainerColor||'#94a3b8'}}/>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="font-bold truncate">{dispName}</h3>
              {isExt && (
                <span className="text-[10px] bg-purple-500/20 text-purple-400 border border-purple-500/30 px-1.5 py-0.5 rounded font-bold flex-shrink-0">외부</span>
              )}
            </div>
            <p className="text-slate-500 text-xs">{s.trainerName||'트레이너'} · {s.date} ({wd}요일) · {s.startTime}</p>
          </div>
          <span className={`text-xs px-2 py-1 rounded-lg font-bold flex-shrink-0 ${st.bg}`}>{st.label}</span>
          <button onClick={onClose} className="text-slate-500 hover:text-white text-2xl leading-none ml-1">×</button>
        </div>

        <div className="modal-body p-5 space-y-4">
          {!editMode ? (
            <>
              {[
                {l: isExt?'메모':'회원',  v: dispName},
                {l:'트레이너',           v: s.trainerName||'-'},
                {l:'날짜',               v: `${s.date} (${wd}요일)`},
                {l:'시간',               v: `${s.startTime} — ${s.endTime}`},
                {l:'수업',               v: s.classType},
                ...(!isExt && !isConsult && s.sessionAtBooking != null ? [{
                  l:'회차',
                  v: (() => {
                    const n = s.sessionAtBooking;
                    const total = s.sessionTotalAtBooking;
                    if (total != null && n === total) return `${n}(s) · 첫 수업`;
                    if (n === 1) return `1(e) · 마지막 수업`;
                    return `${n}회차`;
                  })()
                }] : []),
              ].map(row=>(
                <div key={row.l} className="flex items-center justify-between py-2 border-b border-slate-800">
                  <span className="text-xs text-slate-500 uppercase tracking-wide font-semibold w-20 flex-shrink-0">{row.l}</span>
                  <span className="text-sm font-medium text-right">{row.v}</span>
                </div>
              ))}

              {/* 처리: 예약 시 차감 완료. 출석/노쇼=차감 유지, 취소=잔여 복원 */}
              {!s.statusFinalized ? (
                <div>
                  <p className="text-xs text-slate-500 uppercase tracking-widest font-semibold mb-2">
                    처리 {isExt && <span className="text-purple-400">(외부·세션 차감 없음)</span>}
                  </p>
                  <div className="grid grid-cols-3 gap-2">
                    {['attended','canceled','noshow'].map(status=>(
                      <button key={status} onClick={()=>markStatus(status)} disabled={processing}
                        className={`py-3 rounded-xl text-xs font-bold border transition-all active:scale-95 ${STATUS_MAP[status].bg} border-current/20 hover:opacity-80 disabled:opacity-50`}>
                        <div className={`w-2 h-2 rounded-full mx-auto mb-1 ${STATUS_MAP[status].dot}`}/>
                        {STATUS_MAP[status].label}
                      </button>
                    ))}
                  </div>
                  <p className="text-[10px] text-slate-600 mt-2">* 노쇼는 횟수 차감 유지(정산 수업 포함) · 취소만 잔여 복원</p>
                </div>
              ) : (
                <div className={`text-center py-3 rounded-xl text-xs font-bold ${st.bg}`}>
                  ✓ {st.label} 처리 완료
                  {!isExt && (s.status==='canceled' ? ' · 세션 복원됨' : ' · 세션 차감됨')}
                </div>
              )}

              <div className="flex gap-2 pt-1">
                <button onClick={()=>setEdit(true)}
                  className="btn btn-ghost flex-1">
                  ✏️ 수정
                </button>
                <button onClick={removeSchedule} disabled={processing}
                  className="flex-1 py-2.5 rounded-xl border border-red-500/30 text-red-400 hover:bg-red-500/10 text-sm font-semibold transition-colors disabled:opacity-50">
                  🗑 삭제
                </button>
              </div>
            </>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-amber-400 font-bold uppercase tracking-widest">✏️ 수정</p>
              {!isExt && (
                <div>
                  <label className={LBL}>회원</label>
                  <select value={form.memberId} onChange={pf('memberId')} className={SEL}>
                    {sortByName(members).map(m=><option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                </div>
              )}
              {isExt && (
                <div>
                  <label className={LBL}>메모</label>
                  <input value={form.memo} onChange={pf('memo')} className={INP}/>
                </div>
              )}
              <div>
                <label className={LBL}>트레이너</label>
                <select value={form.trainerId} onChange={pf('trainerId')} className={SEL}>
                  <option value="">선택 안 함</option>
                  {trainers.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
              <DateWd label="날짜" value={form.date} onChange={v=>setForm(p=>({...p,date:v}))}/>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className={LBL}>시작</label>
                  <input type="time" step={isExt?undefined:"600"} value={form.startTime}
                    onChange={e=>{
                      const t = isExt ? e.target.value : snapTo10(e.target.value);
                      setForm(p=>({...p, startTime:t, ...(!isExt && {endTime:addHour(t)})}));
                    }} className={INP}/>
                </div>
                <div>
                  <label className={LBL}>종료</label>
                  <input type="time" value={form.endTime} onChange={pf('endTime')} className={INP}/>
                </div>
              </div>
              <div>
                <label className={LBL}>수업 종류</label>
                <select value={form.classType} onChange={pf('classType')} className={SEL}>
                  <option value="">선택</option>
                  {(isExt ? ['출강','교육','현장'] : (trainerCT.length?trainerCT:['트레이닝','선수','재활','외부','컨디셔닝'])).map(ct=>(
                    <option key={ct} value={ct}>{ct}</option>
                  ))}
                </select>
              </div>
              {!isExt && !isConsult && (
                <div>
                  <label className={LBL}>
                    회차 (시작 시 잔여)
                    <span className="ml-1 text-slate-500 normal-case font-normal">— 첫 수업=총횟수, 마지막=1</span>
                  </label>
                  <input type="number" min="0" value={form.sessionAtBooking}
                    onChange={pf('sessionAtBooking')}
                    placeholder="예: 10"
                    className={INP}/>
                  <p className="text-[11px] text-slate-500 mt-1">
                    이 값이 총횟수와 같으면 (s), 1이면 (e)로 표시됩니다. 직접 고치면 자동 보정 대상에서 제외됩니다.
                  </p>
                </div>
              )}
              <div className="flex gap-2">
                <button onClick={()=>setEdit(false)}
                  className="btn btn-ghost">취소</button>
                <button onClick={saveEdit}
                  className="btn btn-primary flex-1">저장</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── 예약 추가 모달 — 5가지 요구사항 통합 ─────────────────
function AddModal({ members, trainers, fixedTrainerId, onAdd, onClose }) {
  const today = fmt(new Date());
  const fixedTrainer = fixedTrainerId ? trainers.find(t=>t.id===fixedTrainerId) : null;
  // 탭: 'regular' | 'external'
  const [tab, setTab] = useState('regular');
  const [memberQuery, setMemberQuery] = useState('');
  const [submitting, setSubmitting] = useState(false); // 중복 제출(더블탭) 방지

  const [form, setForm] = useState({
    memberId:'', trainerId:fixedTrainerId || '', date:today,
    startTime:'', endTime:'',
    classType:'', memo:'', externalType:'출강',
    // ★ 외부 일정 기간 모드 — 'single'(하루) | 'range'(여러 날)
    extDateMode:'single', endDate:today,
    // ★ 일반 수업 모드 — 'member'(회원 수업) | 'consult'(상담, 회원 없음)
    regularMode:'member',
  });

  const pf = f => val => setForm(p=>({...p,[f]:val}));
  const pe = f => e  => setForm(p=>({...p,[f]:e.target.value}));

  // 탭 전환 시 폼 리셋
  const switchTab = t => {
    setTab(t);
    setMemberQuery('');
    setForm({ memberId:'', trainerId:fixedTrainerId || '', date:today, startTime:'', endTime:'', classType:'', memo:'', externalType:'출강', extDateMode:'single', endDate:today, regularMode:'member' });
  };

  // ── 트레이너 먼저 선택 → 담당 회원 필터링 ─────────────────
  const selectedTrainerObj = trainers.find(t=>t.id===form.trainerId) || fixedTrainer;
  // 선택된 트레이너를 담당 트레이너로 둔 회원만 표시
  const trainerMembers = form.trainerId
    ? sortByName(members.filter(m => memberHasTrainer(m, form.trainerId)))
    : [];
  const memberQ = memberQuery.trim().toLowerCase();
  const filteredMembers = memberQ
    ? trainerMembers.filter(m => memberSearchText(m).includes(memberQ))
    : trainerMembers;
  const selectedMember   = members.find(m=>m.id===form.memberId);
  const memberClassTypes = selectedMember?.classTypes || [];

  // 트레이너 변경 시 회원/수업종류 리셋
  const handleTrainerChange = id => {
    if (fixedTrainerId) return;
    setMemberQuery('');
    setForm(p=>({...p, trainerId:id, memberId:'', classType:''}));
  };
  // 회원 변경 시 수업종류 리셋
  const handleMemberChange = id => {
    setForm(p=>({...p, memberId:id, classType:''}));
  };

  // ── 요구사항4: 10분 스냅 + 자동 종료 ──────────────────
  const handleStartTimeRegular = e => {
    const snapped = snapTo10(e.target.value);
    setForm(p=>({...p, startTime:snapped, endTime:addHour(snapped)}));
  };
  // 요구사항5: 외부 일정 — 스냅 없이 자유 입력
  const handleStartTimeExternal = e => {
    setForm(p=>({...p, startTime:e.target.value}));
  };

  // 완성 여부
  // 일반 수업: 회원 수업 모드는 회원·수업종류 필수 / 상담 모드는 회원·수업종류 불필요
  const isConsult = form.regularMode === 'consult';
  const canSubmitRegular = isConsult
    ? (form.trainerId && form.date && form.startTime)
    : (form.memberId && form.trainerId && form.date && form.startTime && form.classType);
  // 외부 일정: 기간 모드면 종료 날짜가 시작 날짜 이상이어야 함
  //  · 상한도 둔다 — 종료일 오타(연도 등)로 수백 건이 한 번에 순차 생성되는 걸 막는다.
  const MAX_EXTERNAL_RANGE_DAYS = 180;
  const isRange = form.extDateMode === 'range';
  const rangeSpanDays = isRange && form.date && form.endDate
    ? Math.round((new Date(`${form.endDate}T00:00:00`) - new Date(`${form.date}T00:00:00`)) / 86400000)
    : 0;
  const rangeTooLong = isRange && rangeSpanDays > MAX_EXTERNAL_RANGE_DAYS;
  const rangeValid = !isRange || (form.endDate && form.endDate >= form.date && !rangeTooLong);
  const canSubmitExternal = form.date && form.startTime && form.endTime && form.externalType && rangeValid;

  const handleAdd = async () => {
    if (submitting) return; // 중복 제출 방지(더블탭·연타로 인한 이중 예약/이중 차감 차단)
    setSubmitting(true);
    try {
      await runAdd();
    } finally {
      setSubmitting(false);
    }
  };

  const runAdd = async () => {
    if (tab === 'regular') {
      if (!canSubmitRegular) return;
      const t = trainers.find(tr=>tr.id===form.trainerId);
      if (isConsult) {
        // ★ 상담: 회원 없음, 세션 차감 없음 (isExternal=true로 차감 방어)
        await onAdd({
          memberId:null, memberName:null,
          trainerId:form.trainerId, trainerName:t?.name||'',
          trainerColor:t?.color||'#94a3b8',
          date:form.date, startTime:form.startTime, endTime:form.endTime||addHour(form.startTime),
          classType:'상담', memo:form.memo||'',
          status:'scheduled', sessionDeducted:true, isExternal:true, isConsult:true,
        });
      } else {
        const m = members.find(me=>me.id===form.memberId);
        await onAdd({
          memberId:form.memberId, memberName:m?.name||'',
          trainerId:form.trainerId, trainerName:t?.name||'',
          trainerColor:t?.color||'#94a3b8',
          date:form.date, startTime:form.startTime, endTime:form.endTime||addHour(form.startTime),
          classType:form.classType, memo:'',
          status:'scheduled', sessionDeducted:false, isExternal:false,
        });
      }
    } else {
      if (!canSubmitExternal) return;
      const t = trainers.find(tr=>tr.id===form.trainerId);
      // ★ 기간 모드: 시작~종료 날짜 사이 모든 날에 일정 생성
      const dates = [];
      if (isRange) {
        let d = form.date;
        while (d <= form.endDate) { dates.push(d); d = addD(d, 1); }
      } else {
        dates.push(form.date);
      }
      // 순차 생성(await) — 동시 생성으로 인한 캐시 경쟁을 피한다.
      for (const d of dates) {
        // eslint-disable-next-line no-await-in-loop
        await onAdd({
          // ★ memberId = null, sessionDeducted = true (영구 차감 방지)
          memberId:null, memberName:null,
          trainerId:form.trainerId||null, trainerName:t?.name||'외부',
          trainerColor:t?.color||'#a855f7',
          date:d, startTime:form.startTime, endTime:form.endTime,
          classType:form.externalType, memo:form.memo,
          status:'scheduled', sessionDeducted:true, isExternal:true,
        });
      }
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-box modal-box-large">

        {/* 헤더 + 탭 */}
        <div className="flex-shrink-0">
          <div className="flex items-center justify-between px-5 pt-4 pb-3">
            <h3 className="font-bold text-base">수업 예약</h3>
            <button onClick={onClose} className="text-slate-500 hover:text-white text-2xl">×</button>
          </div>
          {/* 탭 전환 */}
          <div className="flex mx-5 mb-3 bg-slate-800 rounded-xl p-1">
            {[['regular','📋 일반 수업'],['external','📤 외부 일정']].map(([t,l])=>(
              <button key={t} onClick={()=>switchTab(t)}
                className={`flex-1 py-2 rounded-lg text-xs font-bold transition-colors ${tab===t?'bg-amber-500 text-slate-950':'text-slate-400 hover:text-white'}`}>
                {l}
              </button>
            ))}
          </div>
        </div>

        <div className="modal-body px-5 pb-5 space-y-4">

          {/* ══ 일반 수업 탭 ══════════════════════════════ */}
          {tab==='regular' && (
            <>
              {/* ★ 모드 선택: 회원 수업 / 상담 */}
              <div>
                <label className={LBL}>유형</label>
                <div className="flex gap-2">
                  {[['member','👤 회원 수업'],['consult','💬 상담 (회원 없음)']].map(([m,l])=>(
                    <div key={m} onClick={()=>{ setMemberQuery(''); setForm(p=>({...p, regularMode:m, memberId:'', classType:''})); }}
                      className={`flex-1 py-2.5 rounded-xl text-sm font-bold border cursor-pointer text-center transition-colors select-none
                        ${form.regularMode===m
                          ? 'bg-amber-500/20 border-amber-500/40 text-amber-300'
                          : 'border-slate-700 text-slate-400 hover:border-slate-500 hover:text-slate-300'}`}>
                      {l}
                    </div>
                  ))}
                </div>
              </div>

              {/* ① 트레이너 선택 */}
              <div>
                <label className={LBL}>① 담당 트레이너 <span className="text-red-400">*</span></label>
                <select value={form.trainerId} onChange={e=>handleTrainerChange(e.target.value)} disabled={!!fixedTrainerId} className={SEL}>
                  <option value="">트레이너를 먼저 선택하세요</option>
                  {trainers.map(t=>(
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
                {selectedTrainerObj && (
                  <div className="flex items-center gap-1.5 mt-1.5">
                    <div className="w-3 h-3 rounded-full" style={{background:selectedTrainerObj.color}}/>
                    <span className="text-xs text-slate-500">{selectedTrainerObj.name} 트레이너</span>
                  </div>
                )}
              </div>

              {/* ② 회원 선택 — 상담 모드에서는 숨김 */}
              {!isConsult && (
              <div>
                <label className={LBL}>
                  ② 회원 선택
                  {form.trainerId && filteredMembers.length === 0 && (
                    <span className="ml-1 text-red-400 normal-case font-normal">— 담당 회원이 없습니다</span>
                  )}
                  {!form.trainerId && <span className="ml-1 text-slate-600 normal-case font-normal">— 트레이너 선택 후 활성화</span>}
                </label>
                <input
                  value={memberQuery}
                  onChange={e=>setMemberQuery(e.target.value)}
                  disabled={!form.trainerId}
                  placeholder="회원 이름·전화번호 검색"
                  className={INP+" mb-2"}
                />
                <select value={form.memberId} onChange={e=>handleMemberChange(e.target.value)}
                  disabled={!form.trainerId}
                  className={SEL}>
                  <option value="">회원 선택</option>
                  {filteredMembers.map(m=>(
                    <option key={m.id} value={m.id}>
                      {m.name} (잔여 {m.trainerSessions?.[form.trainerId]?.remaining||0}회)
                    </option>
                  ))}
                </select>
              </div>
              )}

              {/* ③ 날짜 + 요일 */}
              <DateWd label="③ 날짜" value={form.date} onChange={pf('date')}/>

              {/* ④ 시작 시간 — 10분 단위 스냅 */}
              <div>
                <label className={LBL}>
                  ④ 시작 시간
                  <span className="ml-1 text-slate-500 normal-case font-normal">(10분 단위 자동 보정)</span>
                </label>
                <input type="time" step="600" value={form.startTime}
                  onChange={handleStartTimeRegular}
                  className={INP}/>
              </div>

              {/* 종료 시간 — 시작+1시간 자동 + 수정 가능 */}
              <div>
                <label className={LBL}>
                  종료 시간
                  <span className="ml-1 text-slate-500 normal-case font-normal">(시작 +1시간 자동 설정)</span>
                </label>
                <input type="time" step="600" value={form.endTime}
                  onChange={e=>setForm(p=>({...p,endTime:e.target.value}))}
                  className={INP}/>
              </div>

              {/* ⑤ 수업 종류 — 회원 수업 모드에서만, 상담은 '상담' 고정 */}
              {!isConsult ? (
              <div>
                <label className={LBL}>
                  ⑤ 수업 종류
                  {!form.memberId && <span className="ml-1 text-slate-600 normal-case font-normal">— 회원 선택 후 활성화</span>}
                </label>
                <select value={form.classType} onChange={pe('classType')}
                  disabled={!form.memberId}
                  className={SEL}>
                  <option value="">{form.memberId ? '수업 선택' : '회원을 먼저 선택하세요'}</option>
                  {memberClassTypes.map(ct=><option key={ct} value={ct}>{ct}</option>)}
                </select>
                {form.memberId && memberClassTypes.length === 0 && (
                  <p className="text-xs text-orange-400 mt-1">이 회원에게 등록된 수업 종류가 없습니다</p>
                )}
              </div>
              ) : (
              <div>
                <label className={LBL}>일정 내용 메모 (선택)</label>
                <textarea rows={2} value={form.memo} onChange={pe('memo')}
                  placeholder="상담 내용을 입력하세요 (예: 신규 회원 상담)"
                  className={INP+" resize-none"}/>
              </div>
              )}

              {/* 예약 미리보기 */}
              {canSubmitRegular && (
                <div className="bg-slate-800 border border-amber-500/20 rounded-xl p-3 space-y-1">
                  <p className="text-xs text-amber-400 font-semibold">{isConsult ? '상담 확인' : '예약 확인'}</p>
                  <div className="flex items-center gap-2 text-sm">
                    <div className="w-2 h-2 rounded-full" style={{background:selectedTrainerObj?.color}}/>
                    {isConsult
                      ? <span className="font-semibold text-amber-300">💬 상담</span>
                      : <span className="font-semibold">{members.find(m=>m.id===form.memberId)?.name}</span>}
                    <span className="text-slate-500">·</span>
                    <span className="text-slate-300">{selectedTrainerObj?.name}</span>
                  </div>
                  <p className="text-slate-400 text-xs">
                    {form.date} ({weekday(form.date)}요일) · {form.startTime} — {form.endTime} · {isConsult ? '상담' : form.classType}
                  </p>
                </div>
              )}
            </>
          )}

          {/* ══ 외부 일정 탭 ══════════════════════════════ */}
          {tab==='external' && (
            <>
              {/* 외부 종류: 출강/교육/현장 */}
              <div>
                <label className={LBL}>외부 일정 종류 <span className="text-red-400">*</span></label>
                <div className="flex gap-2">
                  {['출강','교육','현장'].map(type=>(
                    <div key={type} onClick={()=>setForm(p=>({...p,externalType:type}))}
                      className={`flex-1 py-2.5 rounded-xl text-sm font-bold border cursor-pointer text-center transition-colors select-none
                        ${form.externalType===type
                          ? 'bg-purple-500/20 border-purple-500/40 text-purple-300'
                          : 'border-slate-700 text-slate-400 hover:border-slate-500 hover:text-slate-300'}`}>
                      {type}
                    </div>
                  ))}
                </div>
              </div>

              {/* 메모 — 회원 대신 */}
              <div>
                <label className={LBL}>일정 내용 메모</label>
                <textarea rows={3} value={form.memo} onChange={pe('memo')}
                  placeholder="외부 일정 내용을 입력하세요&#10;예: ○○짐 출강, 트레이너 교육 세미나 등"
                  className={INP+" resize-none"}/>
              </div>

              {/* 담당 트레이너 (선택사항) */}
              <div>
                <label className={LBL}>트레이너 (선택사항)</label>
                <select value={form.trainerId} onChange={pe('trainerId')} disabled={!!fixedTrainerId} className={SEL}>
                  <option value="">선택 안 함</option>
                  {trainers.map(t=>(
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </div>

              {/* ★ 기간 모드 선택: 하루 / 여러 날 */}
              <div>
                <label className={LBL}>기간 설정</label>
                <div className="flex gap-2">
                  {[['single','📅 하루'],['range','🗓 여러 날 (기간)']].map(([m,l])=>(
                    <div key={m} onClick={()=>setForm(p=>({...p, extDateMode:m, endDate:p.date}))}
                      className={`flex-1 py-2.5 rounded-xl text-sm font-bold border cursor-pointer text-center transition-colors select-none
                        ${form.extDateMode===m
                          ? 'bg-purple-500/20 border-purple-500/40 text-purple-300'
                          : 'border-slate-700 text-slate-400 hover:border-slate-500 hover:text-slate-300'}`}>
                      {l}
                    </div>
                  ))}
                </div>
              </div>

              {/* 날짜 + 요일 — 하루 모드면 '날짜', 기간 모드면 '시작 날짜' */}
              <DateWd label={isRange ? '시작 날짜' : '날짜'} value={form.date}
                onChange={v=>setForm(p=>({...p, date:v, endDate:(p.endDate < v ? v : p.endDate)}))}/>

              {/* ★ 기간 모드일 때만 종료 날짜 */}
              {isRange && (
                <>
                  <DateWd label="종료 날짜" value={form.endDate} onChange={pf('endDate')}/>
                  {!rangeValid && rangeTooLong && (
                    <p className="text-xs text-red-400 -mt-2">기간은 최대 {MAX_EXTERNAL_RANGE_DAYS}일까지 설정할 수 있습니다(현재 {rangeSpanDays + 1}일 — 종료 날짜를 확인해 주세요)</p>
                  )}
                  {!rangeValid && !rangeTooLong && (
                    <p className="text-xs text-red-400 -mt-2">종료 날짜는 시작 날짜와 같거나 이후여야 합니다</p>
                  )}
                  {rangeValid && (
                    <div className="bg-purple-500/5 border border-purple-500/20 rounded-xl px-3 py-2 -mt-1">
                      <p className="text-xs text-purple-300 font-semibold">
                        총 {(() => { let n=0,d=form.date; while(d<=form.endDate){n++;d=addD(d,1);} return n; })()}일간 일정이 등록됩니다
                      </p>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        {fmtKo(form.date)} ~ {fmtKo(form.endDate)} · 매일 {form.startTime||'--:--'}~{form.endTime||'--:--'}
                      </p>
                    </div>
                  )}
                </>
              )}

              {/* 시작/종료 시간 — 자유 입력 (스냅 없음, 독립 설정) */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={LBL}>
                    시작 시간
                    <span className="block text-[10px] text-purple-400 normal-case font-normal mt-0.5">자유 입력</span>
                  </label>
                  {/* ★ step 없음, 분 단위 자유 */}
                  <input type="time" value={form.startTime}
                    onChange={handleStartTimeExternal}
                    className={INP}/>
                </div>
                <div>
                  <label className={LBL}>
                    종료 시간
                    <span className="block text-[10px] text-purple-400 normal-case font-normal mt-0.5">독립 입력</span>
                  </label>
                  <input type="time" value={form.endTime}
                    onChange={e=>setForm(p=>({...p,endTime:e.target.value}))}
                    className={INP}/>
                </div>
              </div>

              {/* 안내 */}
              <div className="bg-purple-500/5 border border-purple-500/20 rounded-xl px-3 py-2.5">
                <p className="text-xs text-purple-400 font-semibold mb-1">외부 일정 안내</p>
                <p className="text-xs text-slate-500 leading-relaxed">
                  외부 일정은 특정 회원에 종속되지 않으며, 세션 차감이 일어나지 않습니다.
                  {isRange && ' 여러 날 모드에서는 시작~종료 날짜의 모든 날에 같은 시간으로 일정이 만들어집니다.'}
                </p>
              </div>
            </>
          )}
        </div>

        {/* 하단 등록 버튼 */}
        <div className="flex gap-2 px-5 py-4 border-t border-slate-800 flex-shrink-0">
          <button onClick={onClose}
            className="btn btn-ghost">
            취소
          </button>
          <button onClick={handleAdd}
            disabled={submitting || (tab==='regular' ? !canSubmitRegular : !canSubmitExternal)}
            className={`flex-1 font-bold py-2.5 rounded-xl text-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed
              ${tab==='external'
                ? 'bg-purple-600 hover:bg-purple-500 text-white'
                : 'bg-amber-500 hover:bg-amber-400 text-slate-950'}`}>
            {submitting
              ? '처리 중…'
              : tab==='regular'
                ? (isConsult ? '상담 등록' : '수업 예약')
                : (isRange ? '기간 일정 등록' : '외부 일정 등록')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 스케줄 블록 ───────────────────────────────────────────
function Block({ s, onClick, compact=false, members }) {
  const st    = STATUS_MAP[s.status] || STATUS_MAP.scheduled;
  const isExt = s.isExternal || !s.memberId;
  const name  = nameWithRemain(s, members);
  const bColor = s.trainerColor || '#94a3b8';

  if (compact) return (
    <div onClick={()=>onClick(s)}
      className={`text-[10px] rounded-md px-1.5 py-1 mb-0.5 cursor-pointer hover:opacity-75 transition-opacity border-l-2 ${isExt?'bg-purple-900/30':'bg-slate-800'}`}
      style={{borderColor:bColor}}>
      <div className="flex items-center gap-1">
        {isExt && <span className="text-purple-400 text-[8px] font-bold">외</span>}
        <p className="font-bold truncate text-slate-200 leading-tight">{name}</p>
      </div>
      <p className="text-slate-500 leading-tight">{s.startTime}</p>
      <div className="flex items-center gap-0.5 mt-0.5">
        <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${st.dot}`}/>
        <span className="text-slate-500">{st.label}</span>
      </div>
    </div>
  );
  return (
    <div onClick={()=>onClick(s)} className="flex items-start gap-3 p-4 hover:bg-slate-800/50 cursor-pointer transition-colors">
      <div className="w-1 min-h-12 rounded-full flex-shrink-0 mt-0.5" style={{background:bColor}}/>
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <p className="font-semibold text-sm">{name}</p>
              {isExt && <span className="text-[10px] bg-purple-500/20 text-purple-400 border border-purple-500/30 px-1.5 py-0.5 rounded font-bold">외부</span>}
            </div>
            <p className="text-slate-500 text-xs mt-0.5">{s.trainerName||'트레이너'} · {s.classType}</p>
            <p className="text-slate-500 text-xs">{s.startTime} – {s.endTime}</p>
          </div>
          <span className={`text-[10px] px-2 py-1 rounded-lg font-bold flex-shrink-0 ${st.bg}`}>{st.label}</span>
        </div>
      </div>
    </div>
  );
}

// ── 월 뷰 ─────────────────────────────────────────────────
function MonthView({ pivotDate, schedules, onBlockClick, todayStr, members, onDayClick }) {
  const d=new Date(pivotDate+'T12:00:00');
  const y=d.getFullYear(), mo=d.getMonth();
  // 달력은 일요일 시작 고정(일·월·화·수·목·금·토). JS getDay()가 일=0 이므로
  // 헤더(일 시작)와 오프셋이 정확히 정합한다. 이 순서는 변경하지 않는다.
  const first=new Date(y,mo,1).getDay(), days=new Date(y,mo+1,0).getDate();
  const cells=Array.from({length:Math.ceil((first+days)/7)*7},(_,i)=>{
    const day=i-first+1;
    return (day>0&&day<=days)?`${y}-${String(mo+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`:null;
  });
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
      <div className="grid grid-cols-7 text-center text-xs font-bold text-slate-500 border-b border-slate-800">
        {['일','월','화','수','목','금','토'].map(d=><div key={d} className="py-2">{d}</div>)}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((date,i)=>{
          if(!date) return <div key={i} className="min-h-16 border-b border-r border-slate-800 opacity-20"/>;
          const ds=schedules.filter(s=>s.date===date), isToday=date===todayStr;
          return (
            <div key={date} onClick={()=>onDayClick&&onDayClick(date)}
              className={`min-h-16 border-b border-r border-slate-800 p-1 cursor-pointer hover:bg-slate-800/40 transition-colors ${isToday?'bg-amber-500/5':''}`}>
              <p className={`text-[10px] font-mono font-bold mb-0.5 ${isToday?'text-amber-400':'text-slate-400'}`}>
                {parseInt(date.split('-')[2])}
              </p>
              {ds.slice(0,2).map(s=>{
                const isExt=s.isExternal||!s.memberId;
                const name=nameWithRemain(s, members);
                return (
                  <div key={s.id} onClick={(e)=>{e.stopPropagation(); onBlockClick(s);}}
                    className="text-[9px] rounded px-1 py-0.5 mb-0.5 truncate cursor-pointer hover:opacity-80 transition-opacity"
                    style={{background:(s.trainerColor||'#94a3b8')+'33', color:(isExt?'#c084fc':s.trainerColor)||'#94a3b8'}}>
                    {isExt?'[외]':''}{name}
                  </div>
                );
              })}
              {ds.length>2&&<p className="text-[9px] text-slate-600">+{ds.length-2}</p>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── 메인 ──────────────────────────────────────────────────
export default function Schedule() {
  const { user } = useAuth();
  const [view, setView]         = useState('week');
  const [pivot, setPivot]       = useState(fmt(new Date()));
  const [schedules, setSchedules] = useState([]);
  const [members,   setMembers]   = useState([]);
  const [trainers,  setTrainers]  = useState([]);
  const [showAdd,   setShowAdd]   = useState(false);
  const [detail,    setDetail]    = useState(null);
  const [query,     setQuery]     = useState('');
  const [showAudit, setShowAudit] = useState(false); // 중복 점검 모달

  const load = () => {
    const mb = store.getMembers();
    // ★ 과거 backfill 역산이 남긴 잘못된 회차를 1회 정리(멱등 — 정리 대상 없으면 no-op)
    cleanupBackfilledSessions()
      .then(() => setSchedules(store.getSchedules()))
      .catch(e => console.error('[회차 정리 오류]', e));
    // ★ 과거 회차 자동 재배정 버그가 남긴 음수 등 오표시를 1회 정리(멱등)
    cleanupCorruptedSessionRenumbering()
      .then(() => setSchedules(store.getSchedules()))
      .catch(e => console.error('[회차 재배정 정리 오류]', e));
    setSchedules(store.getSchedules());
    setMembers(mb);
    setTrainers(store.getTrainers());
  };
  useEffect(load, []);

  const todayStr = fmt(new Date());
  const nav = view==='day'?1:view==='week'?7:30;
  const fixedTrainerId = getUserTrainerId(user);
  const visibleSchedules = fixedTrainerId
    ? schedules.filter(s => s.trainerId === fixedTrainerId)
    : schedules;
  const visibleMembers = fixedTrainerId
    ? members.filter(m => memberHasTrainer(m, fixedTrainerId))
    : members;
  const visibleTrainers = fixedTrainerId
    ? trainers.filter(t => t.id === fixedTrainerId)
    : trainers;

  // 주 뷰도 일요일 시작 고정(달력 전체 일관). getDay() 일=0 이므로 그만큼 빼면 그 주 일요일.
  const weekDates = Array.from({length:7},(_,i)=>{
    const base=new Date(pivot+'T12:00:00');
    const day=base.getDay();
    const sun=new Date(base); sun.setDate(base.getDate()-day);
    return addD(fmt(sun),i);
  });

  const trainerName = id => trainers.find(t=>t.id===id)?.name || '';
  const matchQ = s => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    const fields = [
      nameWithRemain(s, members),
      s.memberName || '',
      trainerName(s.trainerId),
      s.memo || '',
      s.classType || '',
    ].join(' ').toLowerCase();
    return fields.includes(q);
  };

  const forDate = d => visibleSchedules.filter(s=>s.date===d && matchQ(s)).sort((a,b)=>a.startTime.localeCompare(b.startTime));
  const filteredSchedules = visibleSchedules.filter(matchQ);

  // 중복 점검: 트레이너 계정이면 본인 담당분만, 관리자면 전체 대상.
  //  · 배지는 "미확인" 건수만 반영한다 — 이미 확인(리뷰 완료)한 그룹은 다시
  //    알리지 않는다. 수정으로 해결된 경우는 예약 자체가 바뀌어 시그니처가
  //    달라지므로 자동으로 새 상태로 다시 잡히거나 사라진다.
  const duplicateGroups = findDuplicateSchedules(visibleSchedules);
  const confirmedGroupSigs = readConfirmedGroupSignatures();
  const unconfirmedGroups = duplicateGroups.filter(g => !confirmedGroupSigs[groupSignature(g)]);
  const auditSummary = summarizeDuplicates(unconfirmedGroups);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-2xl font-black tracking-tight">스케줄</h1>
        <div className="flex items-center gap-2">
          <div className="flex bg-slate-800 rounded-xl p-1 text-xs">
            {[['day','일'],['week','주'],['month','월']].map(([v,l])=>(
              <button key={v} onClick={()=>setView(v)}
                className={`px-3 py-1.5 rounded-lg font-bold transition-colors ${view===v?'bg-amber-500 text-slate-950':'text-slate-400 hover:text-white'}`}>
                {l}
              </button>
            ))}
          </div>
          <button onClick={()=>setShowAudit(true)}
            className={`relative btn btn-sm ${auditSummary.hasIssues ? 'bg-red-500/20 text-red-300 border border-red-500/40' : 'bg-slate-800 text-slate-400 border border-slate-700'}`}
            title="중복 예약 점검">
            점검
            {auditSummary.hasIssues && (
              <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-black flex items-center justify-center">
                {auditSummary.groupCount}
              </span>
            )}
          </button>
          <button onClick={()=>setShowAdd(true)}
            className="btn btn-primary btn-sm">
            + 예약
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button onClick={()=>setPivot(addD(pivot,-nav))}
          className="w-8 h-8 rounded-lg border border-slate-700 text-slate-400 hover:text-white flex items-center justify-center transition-colors text-lg">‹</button>
        <span className="text-sm font-semibold flex-1 text-center text-slate-300">
          {view==='week'
            ? `${fmtKo(weekDates[0])} — ${fmtKo(weekDates[6])}`
            : view==='month'
            ? new Date(pivot+'T12:00:00').toLocaleDateString('ko-KR',{year:'numeric',month:'long'})
            : fmtKo(pivot)}
        </span>
        <button onClick={()=>setPivot(addD(pivot,nav))}
          className="w-8 h-8 rounded-lg border border-slate-700 text-slate-400 hover:text-white flex items-center justify-center transition-colors text-lg">›</button>
        <button onClick={()=>setPivot(todayStr)}
          className="text-xs border border-amber-500/30 text-amber-400 px-3 py-1.5 rounded-lg hover:bg-amber-500/10 transition-colors font-semibold">오늘</button>
      </div>

      {/* 검색 */}
      <div className="relative">
        <input
          value={query}
          onChange={e=>setQuery(e.target.value)}
          placeholder={fixedTrainerId ? "내 회원·메모 검색" : "회원·트레이너·메모 검색"}
          className="w-full bg-slate-900 border border-slate-800 text-slate-100 rounded-xl pl-9 pr-9 py-2.5 text-sm focus:outline-none focus:border-amber-500"
        />
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm">🔍</span>
        {query && (
          <button onClick={()=>setQuery('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white text-sm">✕</button>
        )}
      </div>
      {query.trim() && (
        <p className="text-xs text-slate-500">검색 결과 {filteredSchedules.length}건</p>
      )}

      {view==='week'&&(
        <div className="space-y-2">
          {weekDates.map(date=>{
            const ds=forDate(date), isToday=date===todayStr;
            const dObj=new Date(date+'T12:00:00');
            const wd=dObj.toLocaleDateString('ko-KR',{weekday:'short'});
            const dayNum=dObj.getDate();
            return (
              <div key={date} className={`bg-slate-900 border rounded-xl overflow-hidden ${isToday?'border-amber-500/40':'border-slate-800'}`}>
                {/* 요일 헤더 — 클릭 시 일 뷰로 */}
                <button onClick={()=>{ setPivot(date); setView('day'); }}
                  className={`w-full flex items-center gap-2 px-3 py-2 border-b border-slate-800 hover:bg-slate-800/50 transition-colors ${isToday?'bg-amber-500/5':''}`}>
                  <span className={`font-mono font-black text-lg ${isToday?'text-amber-400':'text-slate-300'}`}>{dayNum}</span>
                  <span className={`text-xs font-bold ${isToday?'text-amber-400':'text-slate-500'}`}>{wd}요일</span>
                  {isToday && <span className="text-[10px] text-amber-400 font-bold">오늘</span>}
                  <span className="ml-auto text-[11px] text-slate-600">{ds.length>0?`${ds.length}건`:'일정 없음'}</span>
                </button>
                {/* 해당 요일 일정 — 내용만큼 표시, 많으면 스크롤 */}
                {ds.length>0 && (
                  <div className="max-h-[40vh] overflow-y-auto divide-y divide-slate-800/60">
                    {ds.map(s=><CompactRow key={s.id} s={s} members={members} onClick={setDetail}/>)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {view==='day'&&(
        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
          <div className="p-4 border-b border-slate-800">
            <p className="font-bold">{fmtKo(pivot)}</p>
            <p className="text-slate-500 text-xs">{forDate(pivot).length}개 일정</p>
          </div>
          {forDate(pivot).length===0
            ? <p className="text-center text-slate-600 py-12 text-sm">예정된 일정이 없습니다</p>
            : <div className="divide-y divide-slate-800 max-h-[65vh] overflow-y-auto">{forDate(pivot).map(s=><CompactRow key={s.id} s={s} members={members} onClick={setDetail}/>)}</div>
          }
        </div>
      )}

      {view==='month'&&(
        <MonthView pivotDate={pivot} schedules={filteredSchedules} onBlockClick={setDetail} todayStr={todayStr}
          members={members}
          onDayClick={(date)=>{ setPivot(date); setView('day'); }}/>
      )}

      {showAdd && (
        <AddModal
          members={visibleMembers}
          trainers={visibleTrainers.length ? visibleTrainers : trainers}
          fixedTrainerId={fixedTrainerId}
          onAdd={async d=>{
            try {
              const res = await store.createScheduleWithDeduction(d);  // 예약+세션차감 원자적 처리
              // 일반 수업인데 세션이 차감되지 않았으면 사유를 알려준다(조용한 실패 방지)
              if (res && res._deductionSkipReason && !d.isExternal && !d.isConsult && d.memberId) {
                const reasonMsg = {
                  no_session_slot: '이 회원에게 선택한 트레이너의 세션 등록 내역이 없어 회차가 차감되지 않았습니다.',
                  no_remaining: '잔여 회차가 0이라 차감할 회차가 없습니다. 세션을 재등록해 주세요.',
                  member_not_found: '회원 정보를 찾지 못해 차감되지 않았습니다.',
                  not_deductible: '세션 차감 대상이 아닌 예약입니다.',
                }[res._deductionSkipReason];
                if (reasonMsg) alert(`예약은 저장되었으나, ${reasonMsg}`);
              }
            } catch(e) {
              console.error('[예약 추가 실패]', e);
              alert('예약 저장에 실패했습니다. 네트워크 확인 후 다시 시도하세요.');
            }
            setShowAdd(false); load();
          }}
          onClose={()=>setShowAdd(false)}
        />
      )}

      {detail && (
        <ScheduleDetailModal
          schedule={detail}
          onClose={()=>setDetail(null)}
          onUpdate={()=>{load(); setDetail(null);}}
          onDelete={()=>{load(); setDetail(null);}}
        />
      )}

      {showAudit && (
        <ScheduleAuditModal
          groups={duplicateGroups}
          user={user}
          onOpenItem={(s)=>{ setShowAudit(false); setDetail(s); }}
          onClose={()=>setShowAudit(false)}
        />
      )}
    </div>
  );
}

// ── 중복 예약 점검 모달 ──────────────────────────────────
//  탐지 결과만 보여주고, 실제 삭제·수정은 항목을 눌러 상세 모달에서 처리한다
//  (되돌릴 수 없는 처리는 운영자 확인을 거치도록 — 데이터 정직성).
//
//  확인(리뷰 완료) 처리: 그룹 전체를 한 번에 "확인 안 함/확인함"으로 두지 않고,
//  그룹마다(해당 그룹을 이루는 예약 id 조합 = 시그니처) 개별로 기억한다.
//   · 수정해서 해결한 경우 → 그 예약이 삭제/변경되어 시그니처 자체가 바뀌므로
//     다음 점검에서 자동으로 "새 상태"로 다시 잡히거나 그룹이 사라진다.
//   · 살펴봤지만 손댈 필요 없다고 판단한 경우 → 트레이너가 직접 "확인" 눌러
//     그 시그니처를 기억해두면, 같은 조합은 다시 배지를 띄우지 않는다.
//   · 둘 다 "몇 시 몇 분에 누가 확인했는지"는 기록하지 않고, 시그니처 존재
//     여부만 본다(운영 로그가 아니라 반복 알림 억제용 — 팀 공유 로그는 아님).
const AUDIT_CONFIRM_KEY = 'fitcms_schedule_audit_confirmed_groups';

function groupSignature(group) {
  const ids = (group.items || []).map(i => i.id).sort().join(',');
  return `${group.type}|${ids}`;
}

function readConfirmedGroupSignatures() {
  try {
    const raw = JSON.parse(localStorage.getItem(AUDIT_CONFIRM_KEY) || '{}');
    return (raw && typeof raw === 'object') ? raw : {};
  } catch { return {}; }
}

function ScheduleAuditModal({ groups, user, onOpenItem, onClose }) {
  const STATUS_KO = { scheduled:'예정', attended:'출석', canceled:'취소', noshow:'노쇼' };
  const [confirmedMap, setConfirmedMap] = useState(readConfirmedGroupSignatures);

  const confirmGroup = (group) => {
    const sig = groupSignature(group);
    const next = { ...confirmedMap, [sig]: { at: Date.now(), byName: user?.name || '' } };
    try { localStorage.setItem(AUDIT_CONFIRM_KEY, JSON.stringify(next)); } catch { /* noop */ }
    setConfirmedMap(next);
  };
  const fmtConfirmedAt = (ms) => {
    try {
      return new Date(ms).toLocaleString('ko-KR', {
        year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
      });
    } catch { return ''; }
  };

  const unconfirmedCount = groups.filter(g => !confirmedMap[groupSignature(g)]).length;

  return (
    <div className="modal-overlay">
      <div className="modal-box modal-box-large">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 flex-shrink-0">
          <h2 className="font-black text-white">예약 점검 · 중복 감지</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl leading-none">×</button>
        </div>

        <div className="modal-body p-4 space-y-3">
          {groups.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-4xl mb-2">✓</p>
              <p className="text-emerald-400 font-bold">중복으로 의심되는 예약이 없습니다.</p>
              <p className="text-slate-500 text-xs mt-1">같은 회차 중복·같은 시간 이중 예약을 자동 점검합니다.</p>
            </div>
          ) : unconfirmedCount === 0 ? (
            <div className="text-center py-10">
              <p className="text-4xl mb-2">✓</p>
              <p className="text-emerald-400 font-bold">감지된 항목을 모두 확인했습니다.</p>
              <p className="text-slate-500 text-xs mt-1">아래에서 확인 내역을 다시 볼 수 있습니다.</p>
            </div>
          ) : (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2.5">
              <p className="text-sm font-bold text-amber-200">
                확인 필요 {unconfirmedCount}건{groups.length > unconfirmedCount ? ` · 확인됨 ${groups.length - unconfirmedCount}건` : ''}
              </p>
              <p className="text-[11px] text-amber-300/70 mt-0.5">
                항목을 눌러 상세에서 확인 후 삭제·수정하거나, 손댈 필요 없다고 판단되면 "확인"을 누르세요.
              </p>
            </div>
          )}

          {groups.length > 0 && (
            <>
              {/* 미확인 그룹을 먼저, 확인된 그룹은 아래로 */}
              {[...groups].sort((a, b) => {
                const ca = confirmedMap[groupSignature(a)] ? 1 : 0;
                const cb = confirmedMap[groupSignature(b)] ? 1 : 0;
                return ca - cb;
              }).map((g) => {
                const sig = groupSignature(g);
                const rec = confirmedMap[sig];
                return (
                  <div key={sig} className={`rounded-xl border overflow-hidden ${rec ? 'border-slate-800/60 bg-slate-900/40 opacity-60' : 'border-slate-800 bg-slate-900'}`}>
                    <div className={`px-3 py-2 ${rec ? 'bg-slate-800/30' : g.type==='same_lot' ? 'bg-red-500/10' : 'bg-slate-800/60'}`}>
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className={`rounded px-1.5 py-0.5 text-[10px] font-black flex-shrink-0 ${g.type==='same_lot' ? 'bg-red-500/30 text-red-200' : 'bg-slate-600/50 text-slate-300'}`}>
                            {g.type==='same_lot' ? '회차 중복' : '같은 시간'}
                          </span>
                          <p className="text-sm font-bold text-slate-200 truncate">{g.label}</p>
                        </div>
                        {rec ? (
                          <span className="flex-shrink-0 text-[10px] font-bold text-emerald-400 whitespace-nowrap">
                            ✓ 확인됨{rec.byName ? ` · ${rec.byName}` : ''}
                          </span>
                        ) : (
                          <button onClick={() => confirmGroup(g)}
                            className="flex-shrink-0 rounded-lg bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 text-[11px] font-bold px-2.5 py-1 hover:bg-emerald-500/25 transition-colors">
                            확인
                          </button>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-400 mt-1">{g.reason}</p>
                      {rec?.at && <p className="text-[10px] text-slate-600 mt-0.5">{fmtConfirmedAt(rec.at)}</p>}
                    </div>
                    <div className="divide-y divide-slate-800">
                      {g.items.map((s) => (
                        <button key={s.id} onClick={()=>onOpenItem(s)}
                          className="w-full flex items-center justify-between px-3 py-2.5 text-left hover:bg-slate-800/50 transition-colors">
                          <div>
                            <p className="text-sm font-semibold text-slate-200">
                              {s.date} {s.startTime} · {s.classType || '수업'}
                            </p>
                            <p className="text-[11px] text-slate-500">
                              {s.trainerName || ''}
                              {s.sessionAtBooking != null && ` · 회차 ${s.sessionAtBooking}`}
                              {s.consumedIndexAtBooking != null && ` · 누적 ${s.consumedIndexAtBooking + 1}번째`}
                              {s.sessionDeducted ? ' · 차감됨' : ' · 미차감'}
                            </p>
                          </div>
                          <span className="text-[11px] font-bold text-slate-400 flex-shrink-0">
                            {STATUS_KO[s.status] || s.status} ›
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}

              <div className="rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2.5">
                <p className="text-[11px] leading-relaxed text-slate-400">
                  <b className="text-slate-300">정리 팁</b> — 같은 회차가 두 번 차감된 유령 항목이면,
                  실제 수업이 아닌 쪽을 상세에서 삭제하세요. 삭제 후 회원 세션 잔여가 잘못 올라갔는지
                  확인하고, 맞지 않으면 세션 탭에서 «−1 차감»으로 보정하면 됩니다.
                </p>
              </div>
            </>
          )}
        </div>

        <div className="flex-shrink-0 p-3 border-t border-slate-800">
          <button onClick={onClose} className="w-full font-bold py-2.5 rounded-xl text-sm bg-slate-700 hover:bg-slate-600 text-white transition-colors">닫기</button>
        </div>
      </div>
    </div>
  );
}
