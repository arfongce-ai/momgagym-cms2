import { createContext, useContext, useState, useEffect } from 'react';
import {
  signInWithEmailAndPassword, signOut, onAuthStateChanged, signInAnonymously,
} from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { store, initStore } from '../demoData';

const AuthContext = createContext(null);

// 역할 결정: Custom Claims(token.admin) 우선 → 없으면 roles/{uid} 문서로 폴백.
async function resolveRole(fbUser) {
  try {
    const res = await fbUser.getIdTokenResult();
    if (res.claims && res.claims.admin === true) return 'admin';
  } catch (e) { console.error('[claim 조회 실패]', e); }
  try {
    const snap = await getDoc(doc(db, 'roles', fbUser.uid));
    if (snap.exists()) return snap.data().role || null;
  } catch (e) { console.error('[역할 조회 실패]', e); }
  return null;
}

// 트레이너를 이메일로 찾는다. initStore 가 채운 캐시를 우선 사용해 추가 읽기를 없앤다.
// 캐시가 비어 있을 때만(아주 이른 타이밍) 데이터 로딩을 1회 보장한 뒤 캐시에서 찾는다.
// → 기존엔 매 로그인마다 trainers 컬렉션을 전수 재조회(getDocs)해 읽기를 증폭시켰다.
async function findTrainerByEmail(email) {
  const e = (email || '').trim().toLowerCase();
  if (!e) return null;
  const fromCache = () => (store.getTrainers() || []).find(
    t => (t.loginEmail || t.email || '').trim().toLowerCase() === e
  ) || null;

  let hit = fromCache();
  if (hit) return hit;

  // 캐시에 없으면 전체 데이터를 1회 보장 로드(이미 로드됐다면 모듈 가드가 막아 읽기 0건).
  try {
    await initStore();
    hit = fromCache();
  } catch (err) {
    console.error('[trainer 조회용 데이터 로딩 실패]', err);
  }
  return hit;
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
          // 정식 Firebase 계정(관리자/직원). 데이터 먼저 로드 후 역할/트레이너 연결.
          await ensureData();
          const role = await resolveRole(fbUser);
          // 이 이메일이 트레이너에도 있으면 trainerId 연결(관리자 겸 트레이너).
          const asTrainer = await findTrainerByEmail(fbUser.email);
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
    if (!e || !password) {
      throw new Error('이메일 또는 비밀번호가 올바르지 않습니다.');
    }

    // 1) 먼저 트레이너(앱 자체 loginEmail/Password)인지 확인.
    //    Firebase 로그인을 먼저 시도하면 익명 세션이 흔들려 Firestore 조회가
    //    막힐 수 있으므로, 트레이너 조회를 앞에 둔다(익명 인증 상태로 안전히 읽음).
    let trainer = null;
    let lookupFailed = null;
    try {
      trainer = await findTrainerByEmail(e);
    } catch (lookupErr) {
      console.error('[trainer 조회 실패]', lookupErr);
      lookupFailed = lookupErr?.code || lookupErr?.message || 'unknown';
    }
    if (trainer && trainer.loginPassword === password) {
      const u = {
        id: trainer.id, email: trainer.loginEmail || trainer.email,
        role: 'trainer', name: trainer.name, trainerId: trainer.id, source: 'trainer',
      };
      localStorage.setItem('fitcms_trainer_session', JSON.stringify(u));
      setUser(u);
      await ensureData(); // 트레이너 로그인 후 데이터 로딩 보장
      return u;
    }
    if (trainer && trainer.loginPassword !== password) {
      throw new Error('비밀번호가 올바르지 않습니다.');
    }

    // 2) 트레이너가 아니면 Firebase 계정(관리자/직원)으로 시도
    try {
      const cred = await signInWithEmailAndPassword(auth, e, password);
      const role = await resolveRole(cred.user);
      // 관리자 겸 트레이너면 trainerId 연결
      const asTrainer = await findTrainerByEmail(cred.user.email);
      const u = {
        id: cred.user.uid, email: cred.user.email,
        role: role || 'staff', name: cred.user.displayName || cred.user.email,
        source: 'firebase',
        ...(asTrainer ? { trainerId: asTrainer.id } : {}),
      };
      return u;
    } catch (fbErr) {
      // 트레이너도 아니고 Firebase 로그인도 실패
      if (lookupFailed) {
        throw new Error(`트레이너 조회 실패 [${lookupFailed}] — 익명 인증/권한 확인 필요`);
      }
      throw new Error('이메일 또는 비밀번호가 올바르지 않습니다.');
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

  // 관리자 비번 재확인(이중 잠금용). 현재 로그인 상태를 바꾸지 않고 비번만 검증한다.
  //  · 현재 사용자의 이메일 + 입력한 비번으로 Firebase 재인증을 시도.
  //  · 비번을 앱 어디에도 저장하지 않으며, Firebase가 직접 검증한다.
  //  · 성공하면 true, 실패하면 false. (관리자 계정만 이 함수를 통과할 수 있도록 호출부에서 role 확인)
  const reauth = async (password) => {
    const email = (user?.email || auth.currentUser?.email || '').trim();
    if (!email || !password) return false;
    try {
      const { reauthenticateWithCredential, EmailAuthProvider } = await import('firebase/auth');
      if (auth.currentUser) {
        const credential = EmailAuthProvider.credential(email, password);
        await reauthenticateWithCredential(auth.currentUser, credential);
        return true;
      }
    } catch (e) {
      // Firebase 재인증 실패(익명 세션이거나 비번 틀림) → 아래 폴백 시도
    }
    // 폴백: 트레이너-겸-관리자 등 Firebase currentUser가 없는 경우, 로그인 검증 로직 재사용.
    // 별도 계정으로 재로그인하지 않고 비번 일치만 확인.
    try {
      const cred = await signInWithEmailAndPassword(auth, email, password);
      return !!cred.user;
    } catch (e) {
      return false;
    }
  };

  return <AuthContext.Provider value={{ user, loading, login, logout, reauth, dataReady, dataError, retryData: ensureData }}>{children}</AuthContext.Provider>;
}
export function useAuth() { return useContext(AuthContext); }
