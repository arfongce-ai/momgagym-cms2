import { createContext, useContext, useState, useEffect } from 'react';
import { DEMO_USERS } from '../demoData';

const AuthContext = createContext(null);
export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    try { const s=localStorage.getItem('fitcms_session'); if(s) setUser(JSON.parse(s)); } catch {}
    setLoading(false);
  }, []);
  const login = async (email, password) => {
    const found = DEMO_USERS.find(u=>u.email===email && u.password===password);
    if (!found) throw new Error('이메일 또는 비밀번호가 올바르지 않습니다.');
    const u = { id:found.id, email:found.email, role:found.role, name:found.name };
    localStorage.setItem('fitcms_session', JSON.stringify(u));
    setUser(u); return u;
  };
  const logout = () => { localStorage.removeItem('fitcms_session'); setUser(null); };
  return <AuthContext.Provider value={{ user, loading, login, logout }}>{children}</AuthContext.Provider>;
}
export function useAuth() { return useContext(AuthContext); }
