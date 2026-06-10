import { createContext, useContext, useState, useEffect } from 'react';
import { DEMO_USERS, store } from '../demoData';

const AuthContext = createContext(null);
export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null);
  const [loading, setLoading] = useState(true);

  // 한 번 로그인하면 자동 로그인 유지 (브라우저에 세션 저장)
  useEffect(() => {
    try { const s=localStorage.getItem('fitcms_session'); if(s) setUser(JSON.parse(s)); } catch {}
    setLoading(false);
  }, []);

  const login = async (email, password) => {
    const e = (email||'').trim().toLowerCase();

    // 1) 기본 계정(관리자/데모 트레이너)에서 먼저 찾기
    let found = DEMO_USERS.find(u => u.email.toLowerCase()===e && u.password===password);
    let u = null;
    if (found) {
      u = { id:found.id, email:found.email, role:found.role, name:found.name };
    } else {
      // 2) 등록된 트레이너 계정에서 찾기 (관리자가 만든 직원 계정)
      const t = store.getTrainers().find(
        t => (t.loginEmail||'').trim().toLowerCase()===e && t.loginPassword===password
      );
      if (t) {
        u = { id:t.id, email:t.loginEmail, role:'trainer', name:t.name, trainerId:t.id };
      }
    }

    if (!u) throw new Error('이메일 또는 비밀번호가 올바르지 않습니다.');
    localStorage.setItem('fitcms_session', JSON.stringify(u));
    setUser(u);
    return u;
  };

  const logout = () => { localStorage.removeItem('fitcms_session'); setUser(null); };

  return <AuthContext.Provider value={{ user, loading, login, logout }}>{children}</AuthContext.Provider>;
}
export function useAuth() { return useContext(AuthContext); }
