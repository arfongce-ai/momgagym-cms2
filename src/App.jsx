import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { useState, useEffect } from 'react';
import AppLayout from './components/layout/AppLayout';
import Login from './pages/Login';
import MicTest from './pages/MicTest';
import Home from './pages/Home';
import Members from './pages/Members';
import Trainers from './pages/Trainers';
import Revenue from './pages/Revenue';
import Schedule from './pages/Schedule';
import Settings from './pages/Settings';
import AiMeasureHub from './ai-measure/AiMeasureHub';
import Report from './pages/Report';
import Dashboard from './pages/Dashboard';
import AdminLockGate from './components/common/AdminLockGate';
import TodayScheduleMorningAlert from './components/schedule/TodayScheduleMorningAlert';
import { useKioskMode } from './hooks/useKioskMode';

function RequireAuth({ children, adminOnly = false }) {
  const { user, loading, dataReady, dataError, retryData, logout } = useAuth();
  if (loading) return (
    <div className="flex items-center justify-center h-screen bg-slate-50 dark:bg-slate-950">
      <div className="w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );
  if (!user) return <Navigate to="/login" replace />;

  // 로그인은 됐으나 데이터 로딩이 실패한 경우 — 원인 표시 + 재시도
  if (dataError) return (
    <div className="flex items-center justify-center h-screen bg-slate-50 dark:bg-slate-950 p-6">
      <div className="text-center max-w-sm">
        <div className="text-red-600 dark:text-red-400 font-bold text-lg mb-2">데이터를 불러오지 못했어요</div>
        <div className="text-slate-500 dark:text-slate-400 text-sm mb-3">로그인은 되었지만 데이터 읽기에 실패했습니다.</div>
        <div className="flex justify-center gap-2">
          <button onClick={retryData} className="px-4 py-2 rounded-lg bg-amber-500 text-slate-950 font-bold">다시 시도</button>
          <button onClick={logout} className="px-4 py-2 rounded-lg border border-slate-700 text-slate-300 font-bold">로그아웃</button>
        </div>
        <details className="mt-4 text-left text-xs text-slate-500">
          <summary className="cursor-pointer">오류 정보 보기</summary>
          <div className="mt-2 text-red-300 bg-red-950/40 border border-red-900 rounded-lg p-3 font-mono break-all">{dataError}</div>
        </details>
      </div>
    </div>
  );

  // 로그인됐고 아직 데이터 로딩 중
  if (!dataReady) return (
    <div className="flex items-center justify-center h-screen bg-slate-50 dark:bg-slate-950">
      <div className="text-center">
        <div className="w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
        <div className="text-slate-500 dark:text-slate-400 text-sm">데이터를 불러오는 중…</div>
      </div>
    </div>
  );

  if (adminOnly && user.role !== 'admin') return <Navigate to="/" replace />;
  return children;
}

// [모미 신규] 키오스크 모드가 켜져 있으면 허용 경로 이외는 전부 /ai로 되돌린다.
// AppLayout의 메뉴 숨김은 "안 보이게"만 할 뿐이라, 주소창 직접 입력으로 우회되는 걸
// 여기서 한 번 더 막는다(메뉴 숨김 + 라우트 가드 이중 방어).
// [2026-08-11] 홈·설정 추가 — AppLayout.jsx KIOSK_ALLOWED와 반드시 같이 맞춘다
// (한쪽만 바꾸면 메뉴엔 보이는데 실제 진입은 막히는 식으로 어긋난다).
function KioskGuard({ children }) {
  const { kioskOn } = useKioskMode();
  const location = useLocation();
  const allowed =
    location.pathname === '/' ||
    location.pathname === '/ai' ||
    location.pathname.startsWith('/ai/') ||
    location.pathname === '/report' ||
    location.pathname.startsWith('/report/') ||
    location.pathname === '/settings' ||
    location.pathname.startsWith('/settings/');
  if (kioskOn && !allowed) {
    return <Navigate to="/ai" replace />;
  }
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
    // [라이트모드 2026-08-11] body 배경/글자색을 여기서 인라인으로 직접
    // 칠하던 방식은 제거했다 — 이제 index.css가 .dark 클래스 유무에 따라
    // CSS 변수(--bg/--text)로 제대로 처리한다(카드·버튼 등 나머지 전부와
    // 같은 방식으로 통일 — 예전엔 body만 따로 인라인으로 바뀌고 나머지는
    // 그대로라 뒤죽박죽이었던 게 바로 이 버그의 원인이었다).
    document.documentElement.classList.toggle('dark', darkMode);
  }, [darkMode]);

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />
      {/* 로그인·인증·데이터 로딩과 완전히 무관한 독립 진단 페이지. 원격 디버깅이
          막힌 기기에서 브라우저 SpeechRecognition 동작을 직접 눈으로 확인하기 위함. */}
      <Route path="/mic-test" element={<MicTest />} />
      <Route path="/*" element={
        <RequireAuth>
          <AppLayout>
            <TodayScheduleMorningAlert user={user} />
            <div className="page-fade">
              <KioskGuard>
                <Routes>
                  <Route path="/"         element={<Home />} />
                  <Route path="/members"  element={<Members />} />
                  <Route path="/schedule" element={<Schedule />} />
                  <Route path="/trainers" element={<RequireAuth adminOnly><AdminLockGate title="트레이너 관리 잠금" adminOnly><Trainers /></AdminLockGate></RequireAuth>} />
                  <Route path="/dashboard" element={<RequireAuth adminOnly><Dashboard /></RequireAuth>} />
                  {/* 9장 대시보드: 회원 개인정보가 없는 집계 그래프라 트레이너 관리처럼
                      AdminLockGate(2차 PIN)까지는 걸지 않음 — adminOnly 라우트 가드만. */}
                  <Route path="/revenue"  element={<AdminLockGate title="매출관리 잠금"><Revenue /></AdminLockGate>} />
                  {/* /revenue: 관리자=이중잠금 후 전체, 트레이너=본인 정산 조회(게이트 통과) */}
                  <Route path="/settings" element={<Settings darkMode={darkMode} setDarkMode={setDarkMode} />} />
                  <Route path="/ai"       element={<AiMeasureHub />} />
                  <Route path="/report"   element={<Report />} />
                  {/* [리포트 통합 2026-08-09] 종합리포트(day/week/month 트렌드)는 Report.jsx
                      안의 ComprehensiveReportSection으로 완전히 흡수됨(이상 데이터 삭제
                      기능까지 이관 완료) — 별도 페이지가 더 이상 필요 없다. 기존
                      북마크/딥링크가 죽지 않도록 리다이렉트만 남긴다. */}
                  <Route path="/summary"  element={<Navigate to="/report" replace />} />
                  <Route path="*"         element={<Navigate to="/" replace />} />
                </Routes>
              </KioskGuard>
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
