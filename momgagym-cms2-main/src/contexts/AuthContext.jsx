import { createContext, useContext, useState, useEffect } from 'react';
import {
  signInWithEmailAndPassword, signOut, onAuthStateChanged,
} from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { store } from '../demoData';

const AuthContext = createContext(null);

// 역할 결정: Custom Claims(token.admin) 우선 → 없으면 roles/{uid} 문서로 폴백.
// claim 기반은 토큰 안에 서명되어 있어 위조 불가하고 문서 조회도 필요 없다.
async function resolveRole(fbUser) {
  try {
    const res = await fbUser.getIdTokenResult();
    if (res.claims && res.claims.admin === true) return 'admin';
  } catch (e) { console.error('[claim 조회 실패]', e); }
  // 폴백: roles 문서
  try {
    const snap = await getDoc(doc(db, 'roles', fbUser.uid));
    if (snap.exists()) return snap.data().role || null;
  } catch (e) { console.error('[역할 조회 실패]', e); }
  return null;
}

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null);
  const [loading, setLoading] = useState(true);

  // Firebase 로그인 상태를 신뢰의 원천으로 사용한다.
  // (localStorage의 role을 더 이상 신뢰하지 않음 → 관리자 위장 불가)
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (fbUser) => {
      if (fbUser) {
        // 관리자/직원: Firebase 계정 → roles 문서로 역할 확정
        const role = await resolveRole(fbUser);
        setUser({
          id: fbUser.uid,
          email: fbUser.email,
          role: role || 'staff',     // roles 문서 없으면 일반 직원(관리자 화면 불가)
          name: fbUser.displayName || fbUser.email,
          source: 'firebase',
        });
      } else {
        // Firebase 비로그인 상태 — 트레이너(앱 자체 계정) 세션이 있으면 복원
        try {
          const s = localStorage.getItem('fitcms_trainer_session');
          if (s) { setUser(JSON.parse(s)); setLoading(false); return; }
        } catch {}
        setUser(null);
      }
      setLoading(false);
    });
    return () => unsub();
  }, []);

  const login = async (email, password) => {
    const e = (email || '').trim().toLowerCase();

    // 1) Firebase 계정(관리자/직원)으로 먼저 시도
    try {
      const cred = await signInWithEmailAndPassword(auth, e, password);
      const role = await resolveRole(cred.user);
      const u = {
        id: cred.user.uid, email: cred.user.email,
        role: role || 'staff', name: cred.user.displayName || cred.user.email,
        source: 'firebase',
      };
      // onAuthStateChanged가 user를 세팅하지만, 즉시 반환값도 제공
      return u;
    } catch (fbErr) {
      // 2) Firebase에 없으면 트레이너(앱 자체 계정)에서 찾기
      //    빈 이메일/비번이면 조회하지 않음(로그인 계정 없는 트레이너 오매칭 방지)
      if (!e || !password) {
        throw new Error('이메일 또는 비밀번호가 올바르지 않습니다.');
      }
      const t = store.getTrainers().find(
        t => (t.loginEmail || '').trim().toLowerCase() === e && t.loginPassword === password
      );
      if (t) {
        const u = { id: t.id, email: t.loginEmail, role: 'trainer', name: t.name, trainerId: t.id, source: 'trainer' };
        localStorage.setItem('fitcms_trainer_session', JSON.stringify(u));
        setUser(u);
        return u;
      }
      throw new Error('이메일 또는 비밀번호가 올바르지 않습니다.');
    }
  };

  const logout = async () => {
    localStorage.removeItem('fitcms_trainer_session');
    try { await signOut(auth); } catch {}
    setUser(null);
  };

  return <AuthContext.Provider value={{ user, loading, login, logout }}>{children}</AuthContext.Provider>;
}
export function useAuth() { return useContext(AuthContext); }
