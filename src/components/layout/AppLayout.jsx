// AppLayout.jsx — UX 개선판
//  · 모바일 하단 네비: 8개 → 핵심 4개 + "전체" 시트 (터치 영역 확대, 한눈에 파악)
//  · 데스크탑 사이드바는 기존과 동일 (전체 메뉴 노출)
//  · [모미 신규] 키오스크 모드: 켜지면 AI측정·리포트만 남기고 메뉴를 숨긴다.
//    (주소창 직접 진입 방어는 App.jsx의 KioskGuard가 별도로 담당)
import { useState, useEffect } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useKioskMode } from '../../hooks/useKioskMode';
import GlobalVoiceCommand from '../common/GlobalVoiceCommand';
import KioskVoiceCommand from '../common/KioskVoiceCommand';
import AdminLockGate from '../common/AdminLockGate';

// 전체 메뉴 (사이드바 · 전체메뉴 시트 공용)
const NAV = [
  { path:'/',         label:'홈',       icon:'🏠', exact:true },
  { path:'/members',  label:'회원관리', icon:'👥' },
  { path:'/schedule', label:'스케줄',   icon:'📅' },
  { path:'/ai',       label:'AI분석',   icon:'🤖' },
  // [리포트 통합 2026-08-09] 종합리포트는 별도 메뉴가 아니라 '리포트' 안의 한
  // 섹션으로 흡수됐다(ComprehensiveReportSection) — 메뉴 항목을 따로 안 둔다.
  { path:'/report',   label:'리포트',   icon:'📊' },
  { path:'/trainers', label:'트레이너', icon:'💪', adminOnly:true },
  { path:'/revenue',  label:'매출관리', icon:'💰' },
  { path:'/settings', label:'설정',     icon:'⚙️' },
];
// 키오스크 모드에서 유일하게 남는 메뉴
const KIOSK_ALLOWED = ['/ai', '/report'];
// 모바일 하단 바에 항상 보이는 핵심 4개 (나머지는 "전체" 시트)
const MOBILE_MAIN = ['/', '/members', '/schedule', '/ai'];

function NavItem({ item }) {
  const { user } = useAuth();
  if (item.adminOnly && user?.role !== 'admin') return null;
  const base = 'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors';
  const active = 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20';
  return (
    <NavLink to={item.path} end={item.exact} className={({isActive})=>`${base} ${isActive?active:''}`}>
      <span className="text-base">{item.icon}</span>
      <span>{item.label}</span>
    </NavLink>
  );
}

// 모바일 하단 탭 (터치 영역 크게)
function MobileTab({ item }) {
  return (
    <NavLink to={item.path} end={item.exact}
      className={({isActive})=>`flex flex-col items-center justify-center gap-0.5 flex-1 py-2.5 min-h-[56px] transition-colors
        ${isActive?'text-amber-400':'text-slate-500'}`}>
      <span className="text-[22px] leading-none">{item.icon}</span>
      <span className="text-[11px] font-bold">{item.label}</span>
    </NavLink>
  );
}

// 전체 메뉴 시트 (모바일) — 큰 아이콘 그리드, 누구나 한눈에
function MenuSheet({ onClose, visibleNav }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const visible = visibleNav.filter(it => !(it.adminOnly && user?.role !== 'admin'));
  const go = (path) => { onClose(); navigate(path); };
  return (
    <div className="fixed inset-0 z-[70] md:hidden" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-fade-in" />
      <div onClick={e=>e.stopPropagation()}
        className="absolute bottom-0 inset-x-0 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-700 rounded-t-3xl p-5 pb-8 animate-fade-in"
        style={{paddingBottom:'calc(env(safe-area-inset-bottom, 0px) + 24px)'}}>
        <div className="w-10 h-1 rounded-full bg-slate-300 dark:bg-slate-700 mx-auto mb-4" />
        <div className="flex items-center gap-3 mb-4 px-1">
          <div className="w-10 h-10 bg-amber-500 rounded-full flex items-center justify-center text-base font-black text-slate-950">{user?.name?.[0]??'U'}</div>
          <div className="flex-1">
            <p className="text-sm font-bold text-slate-900 dark:text-slate-100">{user?.name}</p>
            <p className="text-xs text-slate-500">{user?.role==='admin'?'관리자':'트레이너'}</p>
          </div>
          <button onClick={logout}
            className="text-xs font-bold text-red-500 dark:text-red-400 border border-red-500/30 rounded-xl px-3 py-2 active:scale-95 transition-transform">
            로그아웃
          </button>
        </div>
        <div className="grid grid-cols-4 gap-2">
          {visible.map(it=>(
            <button key={it.path} onClick={()=>go(it.path)}
              className="flex flex-col items-center gap-1.5 py-3.5 rounded-2xl bg-slate-100 dark:bg-slate-800/70 active:scale-95 active:bg-slate-200 dark:active:bg-slate-700 transition-all">
              <span className="text-2xl leading-none">{it.icon}</span>
              <span className="text-[11px] font-bold text-slate-700 dark:text-slate-300">{it.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// [모미 신규] AdminLockGate 통과 즉시(=관리자 재인증 성공) 콜백을 1회 실행하는 트리거.
// AdminLockGate가 children을 "인증 성공 후에만" 렌더링하는 기존 동작을 그대로 재사용해,
// 별도의 PIN 시스템 없이 키오스크 해제를 관리자 재인증으로 처리한다.
function KioskUnlockTrigger({ onUnlock }) {
  useEffect(() => { onUnlock(); }, [onUnlock]);
  return null;
}

export default function AppLayout({ children }) {
  const { user, logout } = useAuth();
  const location = useLocation();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [unlockOpen, setUnlockOpen] = useState(false);
  const { kioskOn, enableKiosk, disableKiosk } = useKioskMode();

  // 키오스크 모드면 NAV 자체를 AI측정·리포트만 남기고 걸러낸다(주소창 방어는 App.jsx가 담당).
  const visibleNav = kioskOn ? NAV.filter(it => KIOSK_ALLOWED.includes(it.path)) : NAV;
  const mobileTabs = kioskOn
    ? visibleNav
    : NAV.filter(it => MOBILE_MAIN.includes(it.path));
  // "전체" 버튼 활성 표시: 핵심 4개 외의 페이지에 있을 때(키오스크 모드에서는 전체 시트 자체를 안 씀)
  const onOtherPage = !MOBILE_MAIN.some(p => p==='/' ? location.pathname==='/' : location.pathname.startsWith(p));

  const handleUnlockSuccess = () => {
    disableKiosk();
    setUnlockOpen(false);
  };

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      {/* 사이드바 (데스크탑) */}
      <aside className="hidden md:flex flex-col w-60 shrink-0 border-r bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 p-4 gap-1">
        <div className="mb-5 px-2">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-amber-500 rounded-lg flex items-center justify-center text-slate-950 font-black text-sm">몸</div>
            <div>
              <p className="font-black text-sm tracking-tight leading-tight">몸가짐운동센터</p>
              <p className="font-semibold text-xs text-slate-500 leading-tight">관리 시스템</p>
            </div>
          </div>
        </div>
        <nav className="flex-1 flex flex-col gap-0.5">
          {visibleNav.map(item=><NavItem key={item.path} item={item}/>)}
        </nav>
        <div className="mt-auto pt-4 border-t border-slate-200 dark:border-slate-800">
          {/* [모미 신규] 키오스크 켜기/끄기. 켜기는 누구나, 끄기는 관리자 재인증 필요. */}
          {kioskOn ? (
            <button onClick={() => setUnlockOpen(true)}
              className="w-full text-left text-xs px-3 py-2 mb-1 rounded-lg text-amber-600 dark:text-amber-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
              🔒 키오스크 모드 해제
            </button>
          ) : (
            <button onClick={enableKiosk}
              className="w-full text-left text-xs px-3 py-2 mb-1 rounded-lg text-slate-500 hover:text-amber-600 dark:hover:text-amber-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
              키오스크 모드 켜기
            </button>
          )}
          <div className="flex items-center gap-2 px-2 mb-2">
            <div className="w-7 h-7 bg-amber-500 rounded-full flex items-center justify-center text-xs font-bold text-slate-950">{user?.name?.[0]??'U'}</div>
            <div><p className="text-xs font-semibold">{user?.name}</p><p className="text-[10px] text-slate-500">{user?.role==='admin'?'관리자':'트레이너'}</p></div>
          </div>
          <button onClick={logout} className="w-full text-left text-xs px-3 py-2 rounded-lg text-slate-500 hover:text-red-500 dark:hover:text-red-400 transition-colors">로그아웃</button>
        </div>
      </aside>

      {/* 메인 */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* 모바일 헤더 */}
        <header className="md:hidden flex items-center justify-between px-4 py-3 border-b bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 bg-amber-500 rounded-lg flex items-center justify-center text-slate-950 font-black text-xs">몸</div>
            <div>
              <p className="font-black text-xs leading-tight">몸가짐운동센터</p>
              <p className="text-[10px] text-slate-500 leading-tight">관리 시스템</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {kioskOn ? (
              <button onClick={() => setUnlockOpen(true)} className="text-[11px] font-bold text-amber-600 dark:text-amber-400">🔒 해제</button>
            ) : (
              <span className="text-xs font-semibold text-slate-500">{user?.name}</span>
            )}
          </div>
        </header>
        <div className="flex-1 overflow-y-auto pb-24 md:pb-0">
          <div className="p-4 md:p-6 max-w-5xl mx-auto w-full">{children}</div>
        </div>
        {/* 모바일 하단 네비 — 핵심 4개 + 전체 (키오스크 모드면 남은 메뉴만) */}
        <nav className="md:hidden fixed bottom-0 inset-x-0 border-t backdrop-blur-md bg-white/95 dark:bg-slate-900/95 border-slate-200 dark:border-slate-800 flex items-stretch px-1"
             style={{paddingBottom:'env(safe-area-inset-bottom, 0px)'}}>
          {mobileTabs.map(item=><MobileTab key={item.path} item={item}/>)}
          {!kioskOn && (
            <button onClick={()=>setSheetOpen(true)}
              className={`flex flex-col items-center justify-center gap-0.5 flex-1 py-2.5 min-h-[56px] transition-colors
                ${onOtherPage?'text-amber-600 dark:text-amber-400':'text-slate-500'}`}>
              <span className="text-[22px] leading-none">☰</span>
              <span className="text-[11px] font-bold">전체</span>
            </button>
          )}
        </nav>
        {sheetOpen && !kioskOn && <MenuSheet onClose={()=>setSheetOpen(false)} visibleNav={NAV} />}
      </main>

      {/* [모미 신규] 키오스크 해제 — 기존 AdminLockGate(관리자 재인증)를 그대로 재사용 */}
      {unlockOpen && (
        <AdminLockGate title="키오스크 모드 해제" onClose={() => setUnlockOpen(false)}>
          <KioskUnlockTrigger onUnlock={handleUnlockSuccess} />
        </AdminLockGate>
      )}

      {/* [모미 신규] "모미야" 음성 명령 — 키오스크는 버튼 없는 상시 감지, 그 외(폰·태블릿·
          데스크탑)는 클릭식 버튼. 둘 다 useMomiVoice/처리 로직은 동일, UI만 다름. */}
      {kioskOn ? <KioskVoiceCommand /> : <GlobalVoiceCommand />}
    </div>
  );
}
