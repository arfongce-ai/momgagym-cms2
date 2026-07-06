// ai-measure/AiMeasureHub.jsx
// AI 측정 허브. 메뉴를 고르면 해당 모듈만 lazy 로드해 구동한다(필요 기능만).
import { useState, Suspense } from 'react';
import { MEASURE_MENUS } from './registry';
import SoundVolumeControl from './menus/SoundVolumeControl';
import { store, aiStore, makeGuestId } from '../demoData';
import { todayYMD } from '../utils/dates';
import { useAuth } from '../contexts/AuthContext';
import { scopeMembersToTrainer, sortByName } from '../utils/memberList';
import { buildRomPostureIntegration, pickLinkedPostureReport } from './core/romPostureIntegration';
import { buildCrossMeasureIntegration, mergeIntegratedAssessment } from './core/crossMeasureContext';
import { sanitizeReportPayload } from './core/unifiedReport';
import { saveUnifiedReport } from '../services/unifiedReportStore';
import { useHardwareBack } from './core/useHardwareBack';
import { useLockPortrait } from './core/useLockPortrait';

export default function AiMeasureHub() {
  const { user } = useAuth();
  // 트레이너 모드: 담당 회원만 / 모든 회원은 가나다 순으로 노출.
  const [members] = useState(() => sortByName(scopeMembersToTrainer(store.getMembers(), user)));
  const [memberId, setMemberId] = useState('');
  const [heightOverrides, setHeightOverrides] = useState({});
  const [active, setActive] = useState(null); // 선택된 메뉴 객체
  // 회원 미선택 시 입력하는 '미등록회원(게스트)' 신체정보. 측정 데이터만 저장되며,
  // 측정 묶음마다 고유 guest id 로 개인별 분리 저장된다(회원 등록은 하지 않음).
  const [virtual, setVirtual] = useState({ sex: '', birthDate: '', height: '', weight: '' });
  // 현재 미등록회원 측정 묶음의 고유 id. 측정 진입 시 발급되어 그 한 사람의
  // 여러 면/여러 항목이 같은 id 로 묶인다. 새 미등록회원은 새 id 를 받는다.
  const [guestId, setGuestId] = useState(null);

  const baseMember = members.find(m => m.id === memberId);
  // 회원의 최근 신체기록에서 키·몸무게를 자동 연동
  const realMember = baseMember ? (() => {
    const records = store.getBodyRecords(baseMember.id) || [];
    const byRecent = [...records].sort((a, b) =>
      String(b.recordedAt).localeCompare(String(a.recordedAt)));
    const latestHeight = byRecent.find(r => r.height)?.height ?? null;
    const latestWeight = byRecent.find(r => r.weight != null)?.weight ?? null;
    return {
      ...baseMember,
      height: heightOverrides[baseMember.id] || baseMember.height || latestHeight || null,
      // 점프 파워(Sayers) 계산에 쓰는 체중 자동 연동 (신체정보 → 측정)
      weight: baseMember.weight ?? latestWeight ?? null,
    };
  })() : null;

  // 미등록회원(게스트) 객체: 신체정보 입력이 하나라도 있으면 구성.
  // id 는 측정 묶음별 고유 guest id(guestId). 아직 미발급이면 null 로 두고,
  // 저장 시점(handleSave)에 확정 발급해 '표시된 id = 저장된 id' 를 보장한다.
  const virtualMember = (() => {
    const hasAny = virtual.sex || virtual.birthDate || virtual.height || virtual.weight;
    if (!hasAny) return null;
    return {
      id: guestId, // 측정 진입(openMenu) 시 발급됨. null 이면 저장 직전 확정 발급.
      isVirtual: true,
      name: '미등록회원',
      sex: virtual.sex || null,
      gender: virtual.sex || null,
      birthDate: virtual.birthDate || null,
      height: virtual.height ? Number(virtual.height) : null,
      weight: virtual.weight ? Number(virtual.weight) : null,
    };
  })();

  // 측정에 실제로 넘겨줄 유효 회원: 실제 회원 우선, 없으면 미등록회원.
  const member = realMember || virtualMember;

  const rememberMemberHeight = async (heightCm) => {
    if (!member || !heightCm) return;
    setHeightOverrides(prev => ({ ...prev, [member.id]: heightCm }));
    if (member.isVirtual) return; // 미등록회원은 신체기록 영구 저장 생략(측정 데이터만)
    // 신체정보에 키가 전혀 없을 때만 영구 저장(중복 기록 방지) → 다음부터 안 물어봄
    try {
      const recs = store.getBodyRecords(member.id) || [];
      const hasHeight = recs.some(r => r.height);
      if (!hasHeight && typeof store.addBodyRecord === 'function') {
        await store.addBodyRecord(member.id, {
          recordedAt: new Date().toISOString().slice(0, 10),
          height: Number(heightCm),
          note: '점프 측정 시 자동 입력',
        });
      }
    } catch (e) { /* 저장 실패해도 세션 오버라이드로 동작 */ }
  };

  // 측정 저장 — 실제 회원이든 미등록회원이든 '모든 측정 유형'에서 저장·출력된다.
  //  • 실제 회원: 회원 측정이력(ai) + 분석 리포트 컬렉션에 누적.
  //  • 미등록회원: members 등록 없이 측정 데이터만 개별 guest id(__mid)로 분리 저장.
  const handleSave = async (data) => {
    if (!member) { alert('회원을 선택하거나, 미등록회원 신체정보를 입력해 주세요.'); return; }
    // 보행 분석은 컴포넌트가 자체 저장 상태 UI(저장 중/✓/실패)를 표시하므로
    // alert 없이 에러를 그대로 throw 해 컴포넌트가 처리하게 한다.
    const isGait = active.id === 'gait';
    const isJump = active.id === 'jump';
    const isPosture = active.id === 'posture';
    const isRom = active.id === 'rom';

    // 측정 정직성: 미등록회원인데 guest id 가 아직 없으면 저장 직전 확정 발급
    // (null __mid 로 저장되어 데이터가 유실/혼합되는 것을 방지). 같은 측정 묶음은
    // 이미 발급된 id 를 그대로 사용한다.
    let saveMid = member.id;
    if (member.isVirtual && !saveMid) {
      saveMid = guestId || makeGuestId();
      setGuestId(saveMid);
    }

    // 미등록회원이면 모든 저장 페이로드에 신체정보를 동봉(리포트 출력·해석에 사용).
    const memberRef = { id: saveMid, name: member.name, isVirtual: member.isVirtual === true };
    const virtualBody = member.isVirtual ? {
      sex: member.sex || null,
      gender: member.gender || null,
      birthDate: member.birthDate || null,
      heightCm: member.height || null,
      weightKg: member.weight || null,
      isVirtualMember: true,
    } : {};

    try {
      let enrichedData = data;
      let linkedPostureReportId = data?.basic_info?.linkedPostureReportId || data?.linkedPostureReportId || '';
      let postureReports = null;
      if (isRom) {
        postureReports = await aiStore.ensurePostureReports(saveMid);
        const linkedPostureReport = pickLinkedPostureReport(postureReports, linkedPostureReportId);
        const romPostureIntegration = buildRomPostureIntegration({ romReport: data, postureReport: linkedPostureReport });
        linkedPostureReportId = romPostureIntegration?.posture_context?.sourceReportId || linkedPostureReportId;
        enrichedData = romPostureIntegration ? { ...data, ...romPostureIntegration } : data;
      }

      const measurementKind = isPosture ? 'posture' : isRom ? 'rom' : isJump ? 'jump' : isGait ? 'gait' : '';
      if (measurementKind) {
        const [allPostureReports, romReports, gaitReports] = await Promise.all([
          postureReports ? Promise.resolve(postureReports) : aiStore.ensurePostureReports(saveMid),
          aiStore.ensureRomReports(saveMid),
          aiStore.ensureGaitReports(saveMid),
        ]);
        const crossIntegration = buildCrossMeasureIntegration({
          kind: measurementKind,
          report: enrichedData,
          postureReports: allPostureReports,
          romReports,
          gaitReports,
        });
        if (crossIntegration) {
          enrichedData = {
            ...enrichedData,
            measurement_role: crossIntegration.measurement_role,
            problem_focus: crossIntegration.problem_focus,
            cross_measure_context: crossIntegration.cross_measure_context,
            integrated_assessment: mergeIntegratedAssessment(enrichedData?.integrated_assessment, crossIntegration.integrated_assessment),
          };
        }
      }
      const storableData = measurementKind ? sanitizeReportPayload(enrichedData) : enrichedData;
      const saveUnifiedCopy = async (savedReport, reportType) => {
        try {
          await saveUnifiedReport({
            userId: saveMid,
            reportId: savedReport?.id,
            report: savedReport,
            reportType,
            member: memberRef,
          });
        } catch (error) {
          console.warn('[AiMeasureHub] unified report save skipped:', error?.code || error?.message);
        }
      };

      // 측정이력(ai): 실제 회원은 회원 id, 미등록회원은 개별 guest id 로 저장.
      await aiStore.addSession(saveMid, {
        menu: active.id,
        menuTitle: active.title,
        recordedAt: todayYMD(), // CV-A: 로컬 날짜
        recordedAtFull: new Date().toISOString(),
        isVirtual: member.isVirtual === true,
        ...virtualBody,
        data: storableData,
      });
      // 보행/점프 분석은 전용 컬렉션(gait_reports)에도 정량 리포트를 추가 저장 → 회차별 비교.
      if (isGait) {
        const saved = await aiStore.addGaitReport({ ...virtualBody, ...storableData, kind: 'gait', member: memberRef });
        await saveUnifiedCopy(saved, 'gait');
        return saved;
      }
      if (isJump && storableData?.valid === true) {
        const saved = await aiStore.addGaitReport({ ...virtualBody, ...storableData, kind: 'jump', member: memberRef });
        await saveUnifiedCopy(saved, 'jump');
        return saved;
      }
      if (isPosture) {
        const saved = await aiStore.addPostureReport({ ...virtualBody, ...storableData, kind: 'posture', member: memberRef });
        await saveUnifiedCopy(saved, 'posture');
        return saved;
      }
      if (isRom) {
        const saved = await aiStore.addRomReport({
          ...virtualBody,
          ...storableData,
          kind: 'rom',
          member: memberRef,
          basic_info: {
            ...(storableData?.basic_info || {}),
            memberId: saveMid,
            trainerId: user?.trainerId || user?.id || '',
            createdAt: new Date(),
            linkedPostureReportId,
          },
        });
        await saveUnifiedCopy(saved, 'rom');
        // 회원 신체기록에 최신 ROM 요약 남기기(실회원만). 미등록회원은 프로필이
        // 없으므로 생략. 실패해도 리포트 저장 자체는 성공으로 둔다(부가 기록).
        if (!member.isVirtual && data?.romBodySummary && typeof store.addRomSummaryToBody === 'function') {
          try {
            await store.addRomSummaryToBody(saveMid, {
              ...data.romBodySummary,
              recordedAt: todayYMD(),
              reportId: saved?.id || '',
              note: `AI ROM 측정 요약${data.romBodySummary.movement ? ` · ${data.romBodySummary.movement}` : ''}`,
            });
          } catch (bErr) {
            console.warn('[AiMeasureHub] ROM 신체기록 요약 저장 생략:', bErr?.code || bErr?.message);
          }
        }
        return saved;
      }
      alert(member.isVirtual ? '미등록회원 측정이 저장되었습니다.' : '측정이 저장되었습니다.');
    } catch (e) {
      if (isGait || isJump || isPosture || isRom) throw e; // 컴포넌트 saveState='error' 로 표시되게 전파
      alert('저장에 실패했습니다. 네트워크 확인 후 다시 시도하세요.\n' + (e?.message || ''));
    }
  };

  // ── AI 측정·분석 사용 중 화면 자동 회전 방지(세로 고정) ──
  //  네이티브 잠금이 되면 그대로 세로 고정. 안 되는 브라우저에서 가로가 되면
  //  isPortraitBlocked=true → 아래에서 "세로로 돌려주세요" 안내를 덮는다.
  const isPortraitBlocked = useLockPortrait(true);

  // ── 폰(브라우저) 뒤로가기 연동 ──
  // 측정 메뉴가 열려 있으면(active) 폰 뒤로가기 = 허브(메뉴 목록)로 복귀.
  // (하위 모듈의 더 깊은 화면은 각 모듈이 자체적으로 useHardwareBack 을 쓴다.)
  useHardwareBack(!!active, () => { setActive(null); if (member?.isVirtual) setGuestId(null); });

  // ── [항목 1] 신체 정보 탭 ↔ 각 측정 탭 연동(미등록회원) ──
  // '신체 정보' 탭에서 입력한 키·몸무게(및 성별·생년월일)를 허브의 미등록회원
  // 신체정보(virtual)에 반영한다. 그러면 자세·ROM·점프·리프팅 등 다른 측정 탭이
  // 같은 미등록회원의 키/체중/성별을 그대로 사용해 계산·리포트에 연동된다.
  //  (실제 회원은 store 신체기록으로 이미 연동되므로 이 경로를 쓰지 않는다.)
  const applyGuestBodyInfo = (patch) => {
    if (!patch) return;
    const next = {};
    if (patch.height != null && patch.height !== '') next.height = String(patch.height);
    if (patch.weight != null && patch.weight !== '') next.weight = String(patch.weight);
    if (patch.sex) next.sex = patch.sex;
    if (patch.birthDate) next.birthDate = patch.birthDate;
    if (Object.keys(next).length === 0) return;
    setVirtual((v) => ({ ...v, ...next }));
    // 측정 진행 중이 아니면 guest id 는 다음 측정에서 새로 발급되도록 둔다.
  };

  // 측정 메뉴 진입. 미등록회원(실제 회원 미선택 + 신체정보 입력)이면 이 측정 묶음용
  // 고유 guest id 를 1회 발급해, 같은 사람의 여러 면/항목이 한 id 로 묶이게 한다.
  const openMenu = (menu) => {
    const hasGuestInfo = !realMember && (virtual.sex || virtual.birthDate || virtual.height || virtual.weight);
    if (hasGuestInfo) setGuestId((prev) => prev || makeGuestId());
    setActive(menu);
  };

  // 회원 선택 변경: 실제 회원을 고르면 진행 중이던 게스트 id 는 초기화.
  const handleSelectMember = (id) => {
    setMemberId(id);
    if (id) setGuestId(null);
  };

  // 미등록회원 신체정보 변경. 측정 진행 전(active 없음)이면 guest id 를 리셋해
  // 다음 측정에서 새 사람으로 새 id 가 발급되게 한다(측정 중에는 유지).
  const updateVirtual = (patch) => {
    setVirtual((v) => ({ ...v, ...patch }));
    if (!active) setGuestId(null);
  };

  // 측정 메뉴 → 허브(메뉴 목록)로 복귀. '← 뒤로' 버튼과 폰 뒤로가기 공통 경로.
  const closeActiveMenu = () => {
    setActive(null);
    if (member?.isVirtual) setGuestId(null);
  };

  // 메뉴 구동 화면
  if (active && active.status === 'ready') {
    const Comp = active.component;
    const wideMeasure = active.id === 'gait' || active.id === 'jump' || active.id === 'posture' || active.id === 'rom' || active.id === 'lifting';
    return (
      <div className={`${wideMeasure ? 'max-w-6xl' : 'max-w-md'} mx-auto`}>
        {isPortraitBlocked && <RotateHint />}
        <Suspense fallback={<div className="text-center text-slate-400 py-10 text-sm">모듈 로딩 중…</div>}>
          <Comp
            member={member}
            onSave={handleSave}
            onBack={closeActiveMenu}
            onMemberHeightChange={rememberMemberHeight}
            onGuestBodyInfoChange={member?.isVirtual ? applyGuestBodyInfo : undefined}
          />
        </Suspense>
      </div>
    );
  }

  // 허브(메뉴 목록)
  return (
    <div className="space-y-5">
      {isPortraitBlocked && <RotateHint />}
      <div>
        <h1 className="text-2xl font-black tracking-tight">AI 측정 · 분석</h1>
        <p className="text-slate-500 text-sm mt-1">측정 항목을 선택하세요. 항목별로 필요한 기능만 구동됩니다.</p>
      </div>

      {/* 회원 선택 (선택 사항 — 저장하려면 필요) */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
        <label className="block text-xs font-semibold text-slate-400 uppercase tracking-widest mb-2">
          회원 선택 (저장 시 필요)
        </label>
        <select value={memberId} onChange={e => handleSelectMember(e.target.value)}
          className="input">
          <option value="">선택 안 함 (미등록회원으로 측정)</option>
          {members.map(m => <option key={m.id} value={m.id}>{m.name} ({m.phone?.slice(-4)})</option>)}
        </select>

        {/* 회원 미선택 시: 미등록회원 신체정보 입력. 모든 측정에서 측정 데이터가
            개별 guest id 로 저장·출력되며, 성별 기준·체형나이 정확도를 높인다. */}
        {!realMember && (
          <div className="mt-3 border-t border-slate-800 pt-3">
            <p className="text-xs font-semibold text-amber-300/90 mb-2">
              미등록회원 신체정보 <span className="text-slate-500 font-normal">(측정 데이터만 개인별로 저장 — 회원 등록 아님)</span>
            </p>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">성별</label>
                <div className="flex gap-1.5">
                  {[['male','남'],['female','여']].map(([val,lbl])=>(
                    <button type="button" key={val}
                      onClick={()=>updateVirtual({ sex: virtual.sex===val ? '' : val })}
                      className={`flex-1 rounded-lg text-sm font-bold border py-1.5 transition-colors
                        ${virtual.sex===val
                          ? 'bg-amber-500/20 border-amber-500/40 text-amber-300'
                          : 'border-slate-700 text-slate-400 hover:border-slate-500'}`}>
                      {lbl}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">생년월일</label>
                <input type="date" value={virtual.birthDate}
                  onChange={e=>updateVirtual({ birthDate: e.target.value })}
                  className="input py-1.5 text-sm"/>
              </div>
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">키 (cm)</label>
                <input type="number" inputMode="decimal" value={virtual.height}
                  onChange={e=>updateVirtual({ height: e.target.value })}
                  placeholder="예: 170" className="input py-1.5 text-sm"/>
              </div>
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">몸무게 (kg)</label>
                <input type="number" inputMode="decimal" value={virtual.weight}
                  onChange={e=>updateVirtual({ weight: e.target.value })}
                  placeholder="예: 65" className="input py-1.5 text-sm"/>
              </div>
            </div>
            {virtualMember && (
              <p className="mt-2 text-[11px] text-emerald-300/80">
                미등록회원으로 측정·저장합니다{virtualMember.sex ? ` · ${virtualMember.sex==='female'?'여':'남'}` : ''}
                {virtualMember.height ? ` · ${virtualMember.height}cm` : ''}
                {virtualMember.weight ? ` · ${virtualMember.weight}kg` : ''}.
                {guestId && <span className="block text-slate-500 mt-0.5">식별 ID: {guestId}</span>}
              </p>
            )}
          </div>
        )}
      </div>

      {/* 측정 사운드 볼륨 — 카운트다운·렙·메트로놈·인터벌·타이머 공통 */}
      <div className="rounded-2xl bg-slate-900 border border-white/10 p-3">
        <p className="text-[11px] font-bold text-slate-400 mb-2">🔊 측정 사운드 볼륨 (모든 측정 공통)</p>
        <SoundVolumeControl compact />
      </div>

      {/* 메뉴 그리드 */}
      <div className="grid grid-cols-2 gap-3">
        {[...MEASURE_MENUS].sort((a, b) => a.no - b.no).map(menu => {
          const ready = menu.status === 'ready';
          return (
            <button key={menu.id}
              onClick={() => ready && openMenu(menu)}
              disabled={!ready}
              className={`text-left rounded-2xl p-4 border transition
                ${ready
                  ? 'bg-slate-900 border-amber-500/30 hover:border-amber-500 active:scale-[0.98]'
                  : 'bg-slate-900/50 border-slate-800 opacity-50 cursor-not-allowed'}`}>
              <span className="text-2xl">{menu.icon}</span>
              <p className="font-bold text-sm mt-2">{menu.no}. {menu.title}</p>
              <p className="text-slate-500 text-xs mt-0.5 leading-relaxed">{menu.desc}</p>
              <span className={`inline-block mt-2 text-[10px] px-2 py-0.5 rounded font-semibold
                ${ready ? 'bg-amber-500/20 text-amber-400' : 'bg-slate-800 text-slate-500'}`}>
                {ready ? '이용 가능' : '준비 중'}
              </span>
            </button>
          );
        })}
      </div>

      <p className="text-[11px] text-slate-500 leading-relaxed">
        측정 항목은 단계적으로 추가됩니다. <strong className="text-slate-300">이용 가능</strong> 표시된 항목만
        구동되며, <strong className="text-slate-300">준비 중</strong> 항목은 작동 검증 후 순차 적용됩니다.
      </p>
    </div>
  );
}

// 가로 회전 시 세로로 돌려달라는 안내(자동 회전 잠금이 불가한 브라우저 폴백).
function RotateHint() {
  return (
    <div className="ai-rotate-hint">
      <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="7" y="2" width="10" height="20" rx="2" />
        <path d="M11 18h2" />
        <path d="M3 9l2-2 2 2" />
        <path d="M5 7v3a4 4 0 0 0 4 4" />
      </svg>
      <p className="text-base font-black text-white">세로로 돌려주세요</p>
      <p className="text-sm text-slate-400">AI 측정·분석은 세로 화면에서 사용하세요.<br />기기를 세로로 돌리면 자동으로 계속됩니다.</p>
    </div>
  );
}
