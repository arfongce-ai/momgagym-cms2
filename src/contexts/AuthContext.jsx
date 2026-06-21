import { createContext, useContext, useState, useEffect } from 'react';
import {
  signInWithEmailAndPassword, signOut, onAuthStateChanged, signInAnonymously,
} from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { store, initStore } from '../demoData';

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
  const [dataReady, setDataReady] = useState(false); // 로그인 후 데이터 로딩 완료 여부
  const [dataError, setDataError] = useState(null);

  // 로그인 확정 후 1회만 Firestore 데이터를 불러온다.
  const ensureData = async () => {
    if (dataReady) return;
    try {
      await initStore();
      setDataReady(true);
      setDataError(null);
    } catch (e) {
      console.error('[FitCMS] 데이터 로딩 실패:', e);
      setDataError(e?.code || e?.message || String(e));
    }
  };

  // Firebase 로그인 상태를 신뢰의 원천으로 사용한다.
  // 트레이너는 Firebase 계정이 없으므로, 비로그인 시 '익명 인증'을 자동 수행해
  // isSignedIn() 규칙을 통과시킨다(데이터 읽기 가능). 화면용 역할은 그대로 유지.
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (fbUser) => {
      if (fbUser) {
        // Firebase 인증됨 (정식 계정 또는 익명). 이제 데이터 읽기 권한 있음.
        const trainerSession = (() => {
          try { return JSON.parse(localStorage.getItem('fitcms_trainer_session') || 'null'); }
          catch { return null; }
        })();

        if (fbUser.isAnonymous && trainerSession) {
          // 익명 인증 + 트레이너 세션 → 화면용 사용자는 트레이너 정보로 표시
          setUser(trainerSession);
          await ensureData();
        } else if (fbUser.isAnonymous) {
          // 익명 인증만 있고 트레이너 세션 없음 → 아직 로그인 화면 필요
          setUser(null);
          await ensureData(); // 로그인 화면에서 트레이너 목록을 읽을 수 있도록
        } else {
          // 정식 Firebase 계정(관리자/직원). 데이터를 먼저 로드한 뒤 역할/트레이너 연결.
          await ensureData();
          const role = await resolveRole(fbUser);
          const email = (fbUser.email || '').trim().toLowerCase();
          // 이 이메일이 트레이너 목록에도 있으면 trainerId 연결(관리자 겸 트레이너).
          const asTrainer = store.getTrainers().find(
            t => (t.loginEmail || '').trim().toLowerCase() === email
          );
          setUser({
            id: fbUser.uid,
            email: fbUser.email,
            role: role || 'staff',
            name: fbUser.displayName || fbUser.email,
            source: 'firebase',
            ...(asTrainer ? { trainerId: asTrainer.id } : {}),
          });
        }
      } else {
        // 아직 아무 인증도 없음 → 익명 인증을 자동 수행.
        // 성공하면 이 콜백이 다시 호출되어 위 분기로 들어간다.
        try {
          await signInAnonymously(auth);
          return; // onAuthStateChanged 재호출 대기 (loading 유지)
        } catch (e) {
          console.error('[익명 인증 실패]', e);
          setDataError(e?.code || e?.message || String(e));
          setUser(null);
        }
      }
      setLoading(false);
    });
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = async (email, password) => {
    const e = (email || '').trim().toLowerCase();

    // 1) Firebase 계정(관리자/직원)으로 먼저 시도
    try {
      const cred = await signInWithEmailAndPassword(auth, e, password);
      const role = await resolveRole(cred.user);
      // 이 이메일이 트레이너 목록에도 있으면 trainerId를 연결한다.
      // (관리자 겸 트레이너인 경우 → 관리자 비번 하나로 트레이너 기능까지 사용)
      const asTrainer = store.getTrainers().find(
        t => (t.loginEmail || '').trim().toLowerCase() === e
      );
      const u = {
        id: cred.user.uid, email: cred.user.email,
        role: role || 'staff', name: cred.user.displayName || cred.user.email,
        source: 'firebase',
        ...(asTrainer ? { trainerId: asTrainer.id } : {}),
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
        await ensureData(); // 트레이너 로그인 후 데이터 로딩
        return u;
      }
      throw new Error(`로그인 실패 [${fbErr?.code || fbErr?.message || 'unknown'}]`);
    }
  };

  const logout = async () => {
    localStorage.removeItem('fitcms_trainer_session');
    setUser(null);
    setDataReady(false);
    // signOut 하면 onAuthStateChanged(null)가 돌고 → 익명 인증 자동 재수행 →
    // 로그인 화면에서도 데이터(트레이너 목록 등)를 읽을 수 있다.
    try { await signOut(auth); } catch {}
  };

  return <AuthContext.Provider value={{ user, loading, login, logout, dataReady, dataError, retryData: ensureData }}>{children}</AuthContext.Provider>;
}
export function useAuth() { return useContext(AuthContext); }
