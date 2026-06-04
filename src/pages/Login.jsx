import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';

export default function Login() {
  const { login } = useAuth();
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);

  const fill = role => {
    setEmail(role==='admin'?'admin@fitcms.demo':'trainer@fitcms.demo');
    setPassword(role==='admin'?'admin1234':'trainer1234');
    setError('');
  };
  const handleSubmit = async e => {
    e.preventDefault(); setError(''); setLoading(true);
    try { await login(email, password); }
    catch (err) { setError(err.message); }
    finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-96 h-96 bg-amber-500/5 rounded-full blur-3xl"/>
      </div>
      <div className="w-full max-w-sm relative z-10">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-amber-500 rounded-2xl mb-4 shadow-lg shadow-amber-500/25">
            <span className="text-2xl font-black text-slate-950">몸</span>
          </div>
          <h1 className="text-2xl font-black text-white tracking-tight">몸가짐운동센터</h1>
          <p className="text-slate-400 text-sm mt-1 font-semibold">관리 시스템</p>
        </div>
        <div className="flex gap-2 mb-4">
          <button onClick={()=>fill('admin')} className="flex-1 py-2 text-xs rounded-xl border border-amber-500/30 text-amber-400 hover:bg-amber-500/10 transition-colors">관리자 데모</button>
          <button onClick={()=>fill('trainer')} className="flex-1 py-2 text-xs rounded-xl border border-slate-700 text-slate-400 hover:bg-slate-800 transition-colors">트레이너 데모</button>
        </div>
        <form onSubmit={handleSubmit} className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-400 uppercase tracking-widest mb-1.5">이메일</label>
            <input type="email" required value={email} onChange={e=>setEmail(e.target.value)} placeholder="admin@fitcms.demo"
              className="w-full bg-slate-800 border border-slate-700 text-slate-100 rounded-xl px-3 py-2.5 text-sm placeholder-slate-500 focus:outline-none focus:border-amber-500"/>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-400 uppercase tracking-widest mb-1.5">비밀번호</label>
            <input type="password" required value={password} onChange={e=>setPassword(e.target.value)} placeholder="••••••••"
              className="w-full bg-slate-800 border border-slate-700 text-slate-100 rounded-xl px-3 py-2.5 text-sm placeholder-slate-500 focus:outline-none focus:border-amber-500"/>
          </div>
          {error && <p className="text-red-400 text-xs bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>}
          <button type="submit" disabled={loading}
            className="btn btn-primary w-full disabled:opacity-50">
            {loading ? '로그인 중…' : '로그인'}
          </button>
        </form>
        <p className="text-center text-slate-600 text-xs mt-4">Demo Mode — 브라우저 로컬 저장</p>
      </div>
    </div>
  );
}
