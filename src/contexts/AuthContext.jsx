import { createContext, useContext, useState, useEffect } from 'react';
import {
  signInWithEmailAndPassword, signOut, onAuthStateChanged,
} from 'firebase/auth';
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { store, initStore } from '../demoData';

const AuthContext = createContext(null);
const OWNER_EMAIL = 'momgagym@naver.com';
let approvalRun = null;
const AUTH_STEP_TIMEOUT_MS = 20000;

function withTimeout(promise, label, timeoutMs = AUTH_STEP_TIMEOUT_MS) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error(`${label} 시간이 초과되었습니다.`), { code: 'request-timeout' })), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// 역할 결정: Custom Claims(token.admin) 우선 → 없으면 roles/{uid} 문서로 폴백.
async function resolveRole(fbUser) {
  const normalizedEmail = (fbUser?.email || '').trim().toLowerCase();
  let tokenResult = null;
  try {
    tokenResult = await fbUser.getIdTokenResult(true);
  } catch (e) { console.error('[claim 조회 실패]', e); }

  // 역할 확인과 누락된 트레이너 연결 복구는 서버에서 처리한다.
  // 계정 생성은 성공했지만 roles 문서 저장만 실패한 상태도 로그인 순간 자동 복구된다.
  if (tokenResult?.token) {
    try {
      const response = await fetch('/api/login-role', {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokenResult.token}` },
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok && data?.ok && data?.role) return data.role;
      // 서버가 계정 충돌·권한 없음으로 명확히 거절한 경우, 오래된 로컬 역할로 우회하지 않는다.
      if (response.status === 401 || response.status === 403) return null;
    } catch (e) {
      console.error('[서버 역할 확인 실패]', e);
    }
  }

  // 서버가 일시적으로 응답하지 않을 때도 기존 정상 계정은 로그인할 수 있게 한다.
  if (normalizedEmail === OWNER_EMAIL || tokenResult?.claims?.admin === true) return 'admin';
  try {
    const snap = await getDoc(doc(db, 'roles', fbUser.uid));
    if (snap.exists()) return snap.data().role || null;
  } catch (e) { console.error('[역할 조회 실패]', e); }
  return null;
}

async function submitLoginRequest(fbUser) {
  if (!fbUser?.uid || !fbUser?.email) return;
  await setDoc(doc(db, 'loginRequests', fbUser.uid), {
    email: fbUser.email.trim().toLowerCase(),
    requestedAt: Date.now(),
  });
}

async function approveKnownTrainerRequests(role) {
  if (role !== 'admin') return 0;
  if (approvalRun) return approvalRun;
  approvalRun = (async () => {
    try {
      const snapshot = await getDocs(collection(db, 'loginRequests'));
      let approved = 0;
      for (const requestDoc of snapshot.docs) {
        const email = (requestDoc.data()?.email || '').trim().toLowerCase();
        const trainer = (store.getTrainers() || []).find(
          item => (item.loginEmail || '').trim().toLowerCase() === email
        );
        if (!trainer || (trainer.authUid && trainer.authUid !== requestDoc.id)) continue;
        try {
          await setDoc(doc(db, 'roles', requestDoc.id), { role: 'trainer', email });
          await store.updateTrainer(trainer.id, { authUid: requestDoc.id });
          await deleteDoc(requestDoc.ref);
          approved += 1;
        } catch (error) {
          try { await deleteDoc(doc(db, 'roles', requestDoc.id)); } catch { /* 원래 오류 유지 */ }
          console.error('[trainer 로그인 요청 승인 실패]', error);
        }
      }
      return approved;
    } catch (error) {
      // 보조 작업 실패가 관리자 로그인을 무한 로딩으로 만들면 안 된다.
      console.error('[trainer 로그인 요청 목록 조회 실패]', error);
      return 0;
    }
  })();
  try { return await approvalRun; }
  finally { approvalRun = null; }
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

// 예전에 콘솔에서 수동 생성한 계정도 한 번 로그인하면 트레이너 문서에 UID를 연결한다.
// 이후 삭제·이메일 변경 시 이 UID의 roles 문서를 제거해 접근 권한을 즉시 끊을 수 있다.
async function linkTrainerUid(role, trainer, uid) {
  if (role !== 'trainer' || !trainer || !uid || trainer.authUid === uid) return;
  try {
    await store.updateTrainer(trainer.id, { authUid: uid });
  } catch (error) {
    console.error('[trainer UID 연결 실패]', error);
  }
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
      await withTimeout(initStore(), '센터 데이터 불러오기');
      setDataReady(true);
      setDataError(null);
    } catch (e) {
      console.error('[FitCMS] 데이터 로딩 실패:', e);
      const detail = [e?.collection, e?.code || e?.message || String(e)].filter(Boolean).join(': ');
      setDataError(detail);
    }
  };

  // 권한 오류 뒤의 재시도는 데이터만 다시 읽지 않는다.
  // 서버 역할 복구 → 강제 전체 동기화 순서로 처음부터 다시 진행한다.
  const retryData = async () => {
    setLoading(true);
    setDataError(null);
    try {
      const fbUser = auth.currentUser;
      if (!fbUser) throw Object.assign(new Error('다시 로그인하세요.'), { code: 'auth-session-missing' });
      const role = await withTimeout(resolveRole(fbUser), '로그인 권한 복구');
      if (!role) throw Object.assign(new Error('등록된 CMS 역할을 찾지 못했습니다.'), { code: 'role-not-found' });
      await withTimeout(initStore({ force: true }), '센터 데이터 다시 불러오기');
      setDataReady(true);
      setDataError(null);
    } catch (e) {
      console.error('[FitCMS] 권한·데이터 복구 실패:', e);
      const detail = [e?.collection, e?.code || e?.message || String(e)].filter(Boolean).join(': ');
      setDataReady(false);
      setDataError(detail);
    } finally {
      setLoading(false);
    }
  };

  const purgeLegacyTrainerPasswords = async role => {
    if (role !== 'admin') return;
    try {
      const removed = await store.purgeLegacyTrainerPasswords();
      if (removed) console.info(`[FitCMS] 트레이너 평문 비밀번호 ${removed}건 제거 완료`);
    } catch (e) {
      console.error('[FitCMS] 트레이너 평문 비밀번호 제거 실패:', e);
      throw new Error('보안 데이터 정리에 실패했습니다. 네트워크 확인 후 다시 로그인하세요.');
    }
  };

  // Firebase 로그인 + roles/{uid} 문서를 신뢰의 원천으로 사용한다.
  // 익명 인증으로 운영 데이터를 미리 읽지 않는다. 로그인 계정에 역할이 확인된
  // 뒤에만 Firestore를 로드해, 로그인 화면에서 개인정보가 노출되지 않게 한다.
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (fbUser) => {
      setLoading(true);
      try {
        if (fbUser) {
          if (fbUser.isAnonymous) {
            await signOut(auth).catch(() => {});
            setUser(null);
            setDataReady(false);
            setDataError(null);
            return;
          }
          const role = await withTimeout(resolveRole(fbUser), '로그인 권한 확인');
          if (!role) {
            // 인증 계정이라도 역할이 등록되지 않았으면 운영 데이터 접근을 허용하지 않는다.
            setUser(null);
          } else {
            await ensureData();
            try {
              await purgeLegacyTrainerPasswords(role);
            } catch (e) {
              setDataError(e?.message || 'security-cleanup-failed');
            }
            await approveKnownTrainerRequests(role);
            const asTrainer = await findTrainerByEmail(fbUser.email);
            await linkTrainerUid(role, asTrainer, fbUser.uid);
            setUser({
              id: fbUser.uid,
              email: fbUser.email,
              role,
              name: fbUser.displayName || fbUser.email,
              source: 'firebase',
              ...(asTrainer ? { trainerId: asTrainer.id } : {}),
            });
          }
        } else {
          setUser(null);
          setDataReady(false);
          setDataError(null);
        }
      } catch (error) {
        // 어떤 인증 후속 작업이 실패해도 loading을 반드시 해제한다.
        console.error('[FitCMS] 로그인 초기화 실패:', error);
        setUser(null);
        setDataReady(false);
          const detail = [error?.collection, error?.code || error?.message || 'login-initialization-failed'].filter(Boolean).join(': ');
          setDataError(detail);
      } finally {
        setLoading(false);
      }
    });
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = async (email, password) => {
    const e = (email || '').trim().toLowerCase();
    if (!e || !password) {
      throw new Error('이메일 또는 비밀번호가 올바르지 않습니다.');
    }

    try {
      const cred = await signInWithEmailAndPassword(auth, e, password);
      const role = await resolveRole(cred.user);
      if (!role) {
        try { await submitLoginRequest(cred.user); }
        catch (error) { console.error('[로그인 권한 연결 요청 실패]', error); }
        await signOut(auth);
        throw new Error('트레이너 권한 연결 요청을 보냈습니다. 관리자가 한 번 로그인한 뒤 다시 시도하세요.');
      }
      await ensureData();
      await purgeLegacyTrainerPasswords(role);
      await approveKnownTrainerRequests(role);
      const asTrainer = await findTrainerByEmail(cred.user.email);
      await linkTrainerUid(role, asTrainer, cred.user.uid);
      const u = {
        id: cred.user.uid,
        email: cred.user.email,
        role,
        name: cred.user.displayName || cred.user.email,
        source: 'firebase',
        ...(asTrainer ? { trainerId: asTrainer.id } : {}),
      };
      setUser(u);
      return u;
    } catch (fbErr) {
      if (fbErr?.message?.includes('권한 연결 요청') || fbErr?.message?.includes('보안 데이터 정리')) throw fbErr;
      if (fbErr?.code === 'auth/too-many-requests') {
        throw new Error('로그인을 너무 많이 시도해 Firebase가 잠시 차단했습니다. 잠시 후 한 번만 다시 시도하세요.');
      }
      throw new Error('이메일 또는 비밀번호가 올바르지 않습니다.');
    }
  };

  const logout = async () => {
    setUser(null);
    setDataReady(false);
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

  return <AuthContext.Provider value={{ user, loading, login, logout, reauth, dataReady, dataError, retryData }}>{children}</AuthContext.Provider>;
}
export function useAuth() { return useContext(AuthContext); }
