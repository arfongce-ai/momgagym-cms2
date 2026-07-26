import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';

export default function Login() {
  const { login } = useAuth();
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);
  const [channelOpen, setChannelOpen] = useState(true);

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
        <p className="text-center text-slate-500 text-xs mb-4">관리자·트레이너 모두 이곳에서 이메일로 로그인합니다</p>
        <form onSubmit={handleSubmit} className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-400 uppercase tracking-widest mb-1.5">이메일</label>
            <input type="email" required value={email} onChange={e=>setEmail(e.target.value)} placeholder="이메일 주소"
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
        <button type="button" onClick={() => setChannelOpen(true)}
          className="mt-4 w-full rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm font-bold text-amber-300 transition-colors hover:bg-amber-500/15 hover:text-amber-200">
          공식 채널 안내
        </button>
        <p className="text-center text-slate-600 text-xs mt-4">몸가짐운동센터 · 관리 시스템</p>
      </div>

      {channelOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 px-4 py-6 backdrop-blur-sm"
          role="dialog" aria-modal="true" aria-labelledby="official-channel-title"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setChannelOpen(false); }}>
          <div className="w-full max-w-sm rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-2xl shadow-black/40">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-widest text-amber-400">Official Channel</p>
                <h2 id="official-channel-title" className="mt-1 text-lg font-black text-white">몸가짐 공식 채널</h2>
              </div>
              <button type="button" onClick={() => setChannelOpen(false)}
                className="rounded-lg border border-slate-700 px-2 py-1 text-xs font-bold text-slate-400 hover:border-slate-500 hover:text-white"
                aria-label="팝업 닫기">
                닫기
              </button>
            </div>
            <p className="mt-4 text-sm leading-6 text-slate-300">
              항상 몸가짐 운동센터를 아껴주셔서 감사합니다.
            </p>
            <div className="mt-5 space-y-2">
              <a href="https://blog.naver.com/posture_gym" target="_blank" rel="noreferrer"
                className="block rounded-xl border border-slate-700 bg-slate-800 px-4 py-3 transition-colors hover:border-amber-500/50 hover:bg-slate-800/80">
                <span className="block text-sm font-black text-amber-300">공식블로그</span>
                <span className="mt-1 block break-all text-xs text-slate-400">https://blog.naver.com/posture_gym</span>
              </a>
              <a href="https://www.instagram.com/posture_gym_official/" target="_blank" rel="noreferrer"
                className="block rounded-xl border border-slate-700 bg-slate-800 px-4 py-3 transition-colors hover:border-amber-500/50 hover:bg-slate-800/80">
                <span className="block text-sm font-black text-amber-300">공식 인스타그램</span>
                <span className="mt-1 block break-all text-xs text-slate-400">https://www.instagram.com/posture_gym_official/</span>
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
