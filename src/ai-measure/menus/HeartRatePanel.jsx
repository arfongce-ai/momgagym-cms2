// ai-measure/menus/HeartRatePanel.jsx
// ════════════════════════════════════════════════════════════════════════
//  [심박 밴드 2026-11-11] 초시계·타이머·인터벌·메트로놈 아래에 항상 떠 있는
//  실시간 심박 패널. 개인(1명) / 그룹(최대 5명) 전환.
//  · 연결·해석은 core/heartRateBle.js 가 맡고, 여기는 화면만 그린다.
//  · 심박 값은 저장하지 않는다(화면 표시 전용). 밴드 이름표·나이만 이 기기에 기억.
//  · 이 화면을 나가면 모든 밴드 연결을 끊는다.
//  · [회원 연계 준비] 측정 허브에서 회원을 골라 두면 개인 모드에서 그 회원의
//    나이(생년월일)를 자동으로 써서 강도 색을 보여준다. 회원을 안 골라도
//    그대로 쓸 수 있다(단순 측정). 저장 연동은 아직 없음 — 동의 절차와 함께 추후.
// ════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  MAX_HEART_RATE_BANDS,
  HEART_RATE_ZONE_LABELS,
  ageFromBirthDate,
  connectHeartRateBand,
  heartRateZone,
  isHeartRateBleSupported,
  loadBandProfiles,
  maxHeartRateFromAge,
  saveBandProfile,
  shortBandId,
} from '../core/heartRateBle';

// 구간별 색(1 가볍게 → 5 최대). Tailwind가 클래스를 찾을 수 있게 전부 풀어서 적는다.
const ZONE_STYLE = {
  1: 'bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-800 dark:text-slate-100 dark:border-slate-600',
  2: 'bg-sky-100 text-sky-800 border-sky-400 dark:bg-sky-900/60 dark:text-sky-100 dark:border-sky-500',
  3: 'bg-emerald-100 text-emerald-800 border-emerald-400 dark:bg-emerald-900/60 dark:text-emerald-100 dark:border-emerald-500',
  4: 'bg-amber-100 text-amber-800 border-amber-500 dark:bg-amber-900/60 dark:text-amber-100 dark:border-amber-500',
  5: 'bg-red-100 text-red-800 border-red-500 dark:bg-red-900/60 dark:text-red-100 dark:border-red-500',
};
const NO_ZONE_STYLE = 'bg-white text-slate-800 border-slate-300 dark:bg-slate-900 dark:text-slate-100 dark:border-slate-600';

// 이 시간 동안 새 값이 없으면 숫자 대신 "--"를 보여준다(밴드가 헐겁거나 멀어짐).
const STALE_MS = 5000;

function errorMessage(err) {
  if (err?.message === 'duplicate') return '이미 연결된 밴드입니다. 다른 밴드를 골라 주세요.';
  if (err?.name === 'NotFoundError') return ''; // 기기 선택 창에서 취소 — 안내 불필요
  if (err?.name === 'SecurityError' || err?.name === 'NotAllowedError') return '블루투스 권한이 꺼져 있습니다. 브라우저·기기 설정에서 허용해 주세요.';
  return '연결하지 못했습니다. 밴드를 팔에 찬 상태에서 다시 눌러 주세요.';
}

function BandCard({ band, big, memberAge = null, onRemove, onEdit }) {
  const stale = !band.bpm || Date.now() - band.at > STALE_MS;
  // 밴드에 직접 넣은 나이가 먼저, 없으면 연결된 회원의 나이.
  const maxHr = maxHeartRateFromAge(band.age || memberAge);
  const zone = stale ? null : heartRateZone(band.bpm, maxHr);
  const style = zone ? ZONE_STYLE[zone.zone] : NO_ZONE_STYLE;
  const title = band.label || `밴드 ${shortBandId(band.name) || ''}`.trim();
  const statusText = band.status === 'reconnecting' ? '다시 연결 중…'
    : band.status === 'disconnected' ? '연결 끊김'
      : band.contact === false ? '밴드를 피부에 밀착해 주세요'
        : stale ? '신호 대기 중…'
          : zone ? `${HEART_RATE_ZONE_LABELS[zone.zone]} · 최대의 ${zone.pct}%`
            : '나이를 넣으면 강도가 색으로 보입니다';

  return (
    <div className={`relative rounded-2xl border-2 text-center ${style} ${big ? 'px-4 py-5' : 'px-2 py-3'}`}>
      <div className="flex items-center justify-between gap-1">
        <button onClick={onEdit} className={`truncate font-bold underline decoration-dotted underline-offset-2 ${big ? 'text-sm' : 'text-xs'}`} aria-label="밴드 이름·나이 수정">
          {title}
        </button>
        <button onClick={onRemove} className="shrink-0 rounded-md px-1.5 text-xs font-bold opacity-60 active:scale-90" aria-label="밴드 연결 끊기">✕</button>
      </div>
      <p className={`font-mono font-black tabular-nums leading-none ${big ? 'text-7xl mt-2' : 'text-4xl mt-1'}`}>
        {stale ? '--' : band.bpm}
        <span className={`ml-1 font-bold ${big ? 'text-base' : 'text-[10px]'}`}>bpm</span>
      </p>
      <p className={`mt-1 truncate font-bold ${big ? 'text-sm' : 'text-[10px]'}`}>{statusText}</p>
      {band.battery != null && band.battery <= 20 && (
        <p className="mt-0.5 text-[10px] font-bold">배터리 {band.battery}% — 충전 필요</p>
      )}
    </div>
  );
}

function EditSheet({ band, onSave, onClose }) {
  const [label, setLabel] = useState(band.label || '');
  const [age, setAge] = useState(band.age ? String(band.age) : '');
  return (
    <div className="rounded-xl border-2 border-amber-400 bg-white dark:bg-slate-900 p-3 space-y-2">
      <p className="text-xs font-bold text-slate-600 dark:text-slate-300">
        밴드 {shortBandId(band.name)} 설정 <span className="font-normal">(뒷면 ID 끝 4자리)</span>
      </p>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-[11px] font-bold text-slate-500 dark:text-slate-400">
          이름표 (번호 스티커)
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            maxLength={12}
            placeholder="예: 7번"
            className="mt-1 w-full rounded-lg border-2 border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1.5 text-sm text-slate-800 dark:text-slate-100"
          />
        </label>
        <label className="text-[11px] font-bold text-slate-500 dark:text-slate-400">
          나이 (선택)
          <input
            value={age}
            onChange={(e) => setAge(e.target.value.replace(/\D+/g, '').slice(0, 3))}
            inputMode="numeric"
            placeholder="예: 35"
            className="mt-1 w-full rounded-lg border-2 border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1.5 text-sm text-slate-800 dark:text-slate-100"
          />
        </label>
      </div>
      <p className="text-[10px] text-slate-500 dark:text-slate-400">회원 실명 대신 밴드 번호를 적어 주세요. 이 기기에만 기억됩니다.</p>
      <div className="grid grid-cols-2 gap-2">
        <button onClick={onClose} className="rounded-lg border-2 border-slate-300 dark:border-slate-600 py-2 text-xs font-bold text-slate-600 dark:text-slate-200">취소</button>
        <button onClick={() => onSave({ label: label.trim(), age: age ? Number(age) : null })} className="rounded-lg bg-amber-500 py-2 text-xs font-bold text-slate-950">저장</button>
      </div>
    </div>
  );
}

export default function HeartRatePanel({ member = null }) {
  const supported = isHeartRateBleSupported();
  const [mode, setMode] = useState('solo'); // 'solo' 개인 | 'group' 그룹
  const [bands, setBands] = useState([]);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [, setNow] = useState(0); // 1초마다 다시 그려 "신호 대기 중" 판정을 갱신
  const handlesRef = useRef(new Map()); // id → { disconnect }

  const limit = mode === 'solo' ? 1 : MAX_HEART_RATE_BANDS;
  // 회원 연계는 개인 모드에서만(그룹은 밴드별 이름표·나이로 구분).
  const linkedMember = mode === 'solo' && member ? member : null;
  const memberAge = linkedMember ? (ageFromBirthDate(linkedMember.birthDate) || Number(linkedMember.age) || null) : null;

  const patchBand = useCallback((id, patch) => {
    setBands((items) => items.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  }, []);

  const removeBand = useCallback((id) => {
    handlesRef.current.get(id)?.disconnect();
    handlesRef.current.delete(id);
    setBands((items) => items.filter((b) => b.id !== id));
    setEditingId((cur) => (cur === id ? null : cur));
  }, []);

  const addBand = async () => {
    if (connecting || bands.length >= limit) return;
    setError('');
    setConnecting(true);
    // 연결이 끝나기 전에 값이 먼저 올 수 있어, id를 나중에 채우는 상자를 둔다.
    const box = { id: null, early: {} };
    try {
      const handle = await connectHeartRateBand({
        excludeIds: [...handlesRef.current.keys()],
        onValue: ({ bpm, contact }) => {
          const patch = { bpm, contact, at: Date.now() };
          if (box.id) patchBand(box.id, patch); else Object.assign(box.early, patch);
        },
        onStatus: (status) => {
          if (box.id) patchBand(box.id, { status }); else box.early.status = status;
        },
      });
      box.id = handle.id;
      handlesRef.current.set(handle.id, handle);
      const profile = loadBandProfiles()[handle.name] || {};
      setBands((items) => [...items, {
        id: handle.id,
        name: handle.name,
        battery: handle.battery,
        label: profile.label || '',
        age: profile.age || null,
        bpm: 0,
        contact: null,
        at: 0,
        status: 'connected',
        ...box.early,
      }]);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setConnecting(false);
    }
  };

  // 그룹 → 개인으로 바꾸면 첫 번째 밴드만 남긴다.
  const switchMode = (next) => {
    if (next === mode) return;
    if (next === 'solo') bands.slice(1).forEach((b) => removeBand(b.id));
    setMode(next);
  };

  useEffect(() => {
    if (bands.length === 0) return undefined;
    const timer = setInterval(() => setNow((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [bands.length]);

  // 화면을 나가면 전부 끊는다 — 밴드는 한 번에 한 기기에만 연결되므로 꼭 놓아 준다.
  useEffect(() => {
    const handles = handlesRef.current;
    return () => {
      handles.forEach((h) => h.disconnect());
      handles.clear();
    };
  }, []);

  const editing = bands.find((b) => b.id === editingId) || null;

  return (
    <div className="rounded-xl bg-slate-100/80 dark:bg-slate-800/80 border border-white/10 px-3 py-3 space-y-2" data-testid="heart-rate-panel">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-bold text-slate-600 dark:text-slate-300">♥ 심박수</p>
        <div className="flex gap-1 rounded-lg bg-white dark:bg-slate-900 p-0.5">
          {[['solo', '개인'], ['group', '그룹']].map(([k, l]) => (
            <button key={k} onClick={() => switchMode(k)} className={`rounded-md px-3 py-1 text-xs font-bold ${mode === k ? 'bg-amber-500 text-slate-950' : 'text-slate-500 dark:text-slate-400'}`}>
              {l}
            </button>
          ))}
        </div>
      </div>

      {supported && mode === 'solo' && (
        <p className="text-[11px] text-slate-500 dark:text-slate-400" data-testid="heart-rate-member-line">
          {linkedMember
            ? `${linkedMember.isVirtual ? '미등록회원' : `${linkedMember.name || '회원'} 회원`} 기준${memberAge ? ` · 나이 ${memberAge}세 자동 적용` : ''}`
            : '단순 측정 (회원 선택 없이 사용 중)'}
        </p>
      )}

      {!supported ? (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          이 기기·브라우저는 밴드 연결을 지원하지 않습니다. 안드로이드 폰·태블릿이나 PC의 크롬에서 열어 주세요. (아이폰·아이패드 미지원)
        </p>
      ) : (
        <>
          {bands.length > 0 && (
            <div className={mode === 'solo' ? '' : 'grid grid-cols-2 sm:grid-cols-3 gap-2'}>
              {bands.map((band) => (
                <BandCard
                  key={band.id}
                  band={band}
                  big={mode === 'solo'}
                  memberAge={memberAge}
                  onRemove={() => removeBand(band.id)}
                  onEdit={() => setEditingId(band.id)}
                />
              ))}
            </div>
          )}

          {editing && (
            <EditSheet
              band={editing}
              onClose={() => setEditingId(null)}
              onSave={(profile) => {
                saveBandProfile(editing.name, profile);
                patchBand(editing.id, profile);
                setEditingId(null);
              }}
            />
          )}

          {bands.length < limit && (
            <button
              onClick={addBand}
              disabled={connecting}
              className="w-full rounded-xl border-2 border-dashed border-slate-400 dark:border-slate-500 py-2.5 text-sm font-bold text-slate-600 dark:text-slate-200 disabled:opacity-50"
            >
              {connecting ? '밴드 찾는 중…' : bands.length === 0 ? '+ 밴드 연결' : `+ 밴드 추가 (${bands.length}/${limit})`}
            </button>
          )}

          {bands.length === 0 && !error && (
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              밴드를 팔에 찬 뒤 눌러 주세요. 목록에서 뒷면 ID와 같은 번호를 고르면 됩니다.
            </p>
          )}
          {error && <p className="text-xs font-bold text-red-600 dark:text-red-400">{error}</p>}
        </>
      )}
    </div>
  );
}
