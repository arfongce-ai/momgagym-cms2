import { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';

// 민감 탭 이중 잠금 게이트.
//  · adminOnly=true(트레이너 관리): 관리자만 접근 + 관리자 비번 재확인. 비관리자는 차단.
//  · adminOnly=false(매출관리): 관리자만 이중 잠금을 통과해야 하고, 트레이너 등 비관리자는
//    그대로 통과시켜 컴포넌트 내부에서 본인 화면(조회 전용)을 보게 한다.
//  · 통과하면 UNLOCK_MINUTES 분 동안 열린다(sessionStorage). 그 뒤 자동 재잠금.
//  · 비번은 Firebase 가 검증하며 앱 어디에도 저장하지 않는다(reauth).

const UNLOCK_MINUTES = 30;               // 잠금 해제 지속 시간(분)
const KEY = 'fitcms_admin_unlock_until'; // sessionStorage 키(해제 만료 시각)

function isUnlocked() {
  try {
    const until = Number(sessionStorage.getItem(KEY) || 0);
    return Number.isFinite(until) && Date.now() < until;
  } catch { return false; }
}
function setUnlocked() {
  try { sessionStorage.setItem(KEY, String(Date.now() + UNLOCK_MINUTES * 60 * 1000)); } catch {}
}

export default function AdminLockGate({ title = '관리자 확인', adminOnly = false, children }) {
  const { user, reauth } = useAuth();
  const [unlocked, setUnlockedState] = useState(isUnlocked());
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const isAdmin = user?.role === 'admin';

  // 만료 시각이 되면 자동 재잠금(타이머)
  useEffect(() => {
    if (!unlocked) return;
    const until = Number(sessionStorage.getItem(KEY) || 0);
    const ms = until - Date.now();
    if (ms <= 0) { setUnlockedState(false); return; }
    const t = setTimeout(() => setUnlockedState(false), ms);
    return () => clearTimeout(t);
  }, [unlocked]);

  // 비관리자 처리:
  //  · adminOnly 화면(트레이너 관리) → 접근 차단
  //  · 그 외(매출관리) → 그대로 통과(본인 조회 화면은 컴포넌트 내부에서 제한)
  if (!isAdmin) {
    if (adminOnly) {
      return (
        <div className="flex items-center justify-center h-[60vh] p-6">
          <div className="text-center max-w-sm">
            <div className="text-4xl mb-3">🔒</div>
            <div className="text-slate-200 font-bold text-lg mb-1">접근 권한이 없습니다</div>
            <div className="text-slate-400 text-sm">이 화면은 관리자만 볼 수 있어요.</div>
          </div>
        </div>
      );
    }
    return children; // 트레이너 등 → 본인 화면 그대로
  }

  if (unlocked) return children;

  const submit = async () => {
    if (!pw) { setErr('비밀번호를 입력해 주세요.'); return; }
    setBusy(true); setErr('');
    try {
      const ok = await reauth(pw);
      if (ok) {
        setUnlocked();
        setUnlockedState(true);
        setPw('');
      } else {
        setErr('비밀번호가 올바르지 않습니다.');
      }
    } catch (e) {
      setErr('확인 중 오류가 발생했습니다. 다시 시도해 주세요.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center justify-center h-[60vh] p-6">
      <div className="w-full max-w-sm bg-slate-900 border border-slate-800 rounded-2xl p-6">
        <div className="text-center mb-5">
          <div className="text-4xl mb-2">🔐</div>
          <div className="text-slate-100 font-bold text-lg">{title}</div>
          <div className="text-slate-400 text-xs mt-1">보안을 위해 관리자 비밀번호를 한 번 더 입력해 주세요.</div>
        </div>
        <input
          type="password"
          value={pw}
          onChange={e => { setPw(e.target.value); setErr(''); }}
          onKeyDown={e => { if (e.key === 'Enter') submit(); }}
          placeholder="관리자 비밀번호"
          autoFocus
          className="w-full bg-slate-800 border border-slate-700 text-slate-100 rounded-xl px-3 py-2.5 text-sm placeholder-slate-500 focus:outline-none focus:border-amber-500"
        />
        {err && <div className="text-red-400 text-xs mt-2">{err}</div>}
        <button
          onClick={submit}
          disabled={busy}
          className="w-full mt-4 px-4 py-2.5 rounded-xl bg-amber-500 text-slate-950 font-bold text-sm hover:bg-amber-400 transition-colors disabled:opacity-50"
        >
          {busy ? '확인 중…' : '잠금 해제'}
        </button>
        <div className="text-[11px] text-slate-500 text-center mt-3">
          해제 후 {UNLOCK_MINUTES}분이 지나면 자동으로 다시 잠깁니다.
        </div>
      </div>
    </div>
  );
}
