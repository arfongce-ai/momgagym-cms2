import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { useState, useEffect } from 'react';
import AppLayout from './components/layout/AppLayout';
import Login from './pages/Login';
import Home from './pages/Home';
import Members from './pages/Members';
import Trainers from './pages/Trainers';
import Schedule from './pages/Schedule';
import Settings from './pages/Settings';
import AiMeasureHub from './ai-measure/AiMeasureHub';
import Report from './pages/Report';

function RequireAuth({ children, adminOnly = false }) {
  const { user, loading } = useAuth();
  if (loading) return (
    <div className="flex items-center justify-center h-screen bg-slate-950">
      <div className="w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );
  if (!user) return <Navigate to="/login" replace />;
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
            <div className="page-fade">
              <Routes>
                <Route path="/"         element={<Home />} />
                <Route path="/members"  element={<Members />} />
                <Route path="/schedule" element={<Schedule />} />
                <Route path="/trainers" element={<RequireAuth adminOnly><Trainers /></RequireAuth>} />
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
