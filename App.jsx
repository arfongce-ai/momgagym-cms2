import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { useState, useEffect } from 'react';
import AppLayout from './components/layout/AppLayout';
import Login from './pages/Login';
import Home from './pages/Home';
import Members from './pages/Members';
import Trainers from './pages/Trainers';
import Revenue from './pages/Revenue';
import Schedule from './pages/Schedule';
import Settings from './pages/Settings';
import AiMeasureHub from './ai-measure/AiMeasureHub';
import Report from './pages/Report';
import AdminLockGate from './components/common/AdminLockGate';
import TodayScheduleMorningAlert from './components/schedule/TodayScheduleMorningAlert';

function RequireAuth({ children, adminOnly = false }) {
  const { user, loading, dataReady, dataError, retryData } = useAuth();
  if (loading) return (
    <div className="flex items-center justify-center h-screen bg-slate-950">
      <div className="w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );
  if (!user) return <Navigate to="/login" replace />;

  // 로그인은 됐으나 데이터 로딩이 실패한 경우 — 원인 표시 + 재시도
  if (dataError) return (
    <div className="flex items-center justify-center h-screen bg-slate-950 p-6">
      <div className="text-center max-w-sm">
        <div className="text-red-400 font-bold text-lg mb-2">데이터를 불러오지 못했어요</div>
        <div className="text-slate-400 text-sm mb-3">로그인은 되었지만 데이터 읽기에 실패했습니다.</div>
        <div className="text-red-300 text-xs bg-red-950/40 border border-red-900 rounded-lg p-3 mb-4 font-mono break-all text-left">{dataError}</div>
        <button onClick={retryData} className="px-4 py-2 rounded-lg bg-amber-500 text-slate-950 font-bold">다시 시도</button>
      </div>
    </div>
  );

  // 로그인됐고 아직 데이터 로딩 중
  if (!dataReady) return (
    <div className="flex items-center justify-center h-screen bg-slate-950">
      <div className="text-center">
        <div className="w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
        <div className="text-slate-400 text-sm">데이터를 불러오는 중…</div>
      </div>
    </div>
  );

  if (adminOnly && user.role !== 'admin') return <Navigate to="/" replace />;
  return children;
}

function AppRoutes() {
  const { user } = useAuth();
  const [darkMode, setDarkMode] = useState(true);

  useEffect(() => {
    const saved = localStorage.getItem('fitcms_dark');
    if (saved !== null) setDarkMode(saved === 'true');
  }, []);

  useEffect(() => {
    localStorage.setItem('fitcms_dark', String(darkMode));
    document.documentElement.classList.toggle('dark', darkMode);
    document.body.style.background = darkMode ? '#0f172a' : '#f8fafc';
    document.body.style.color = darkMode ? '#f1f5f9' : '#0f172a';
  }, [darkMode]);

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />
      <Route path="/*" element={
        <RequireAuth>
          <AppLayout darkMode={darkMode}>
            <TodayScheduleMorningAlert user={user} />
            <div className="page-fade">
              <Routes>
                <Route path="/"         element={<Home />} />
                <Route path="/members"  element={<Members />} />
                <Route path="/schedule" element={<Schedule />} />
                <Route path="/trainers" element={<RequireAuth adminOnly><AdminLockGate title="트레이너 관리 잠금" adminOnly><Trainers /></AdminLockGate></RequireAuth>} />
                <Route path="/revenue"  element={<AdminLockGate title="매출관리 잠금"><Revenue /></AdminLockGate>} />
                {/* /revenue: 관리자=이중잠금 후 전체, 트레이너=본인 정산 조회(게이트 통과) */}
                <Route path="/settings" element={<Settings darkMode={darkMode} setDarkMode={setDarkMode} />} />
                <Route path="/ai"       element={<AiMeasureHub />} />
                <Route path="/report"   element={<Report />} />
                <Route path="*"         element={<Navigate to="/" replace />} />
              </Routes>
            </div>
          </AppLayout>
        </RequireAuth>
      } />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AuthProvider>
  );
}
