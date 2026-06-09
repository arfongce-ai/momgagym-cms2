import { NavLink } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';

const NAV = [
  { path:'/',         label:'홈',       icon:'🏠', exact:true },
  { path:'/members',  label:'회원관리', icon:'👥' },
  { path:'/schedule', label:'스케줄',   icon:'📅' },
  { path:'/trainers', label:'트레이너', icon:'💪', adminOnly:true },
  { path:'/revenue',  label:'매출관리', icon:'💰', adminOnly:true },
  { path:'/ai',       label:'AI분석',   icon:'🤖' },
  { path:'/report',   label:'리포트',   icon:'📊' },
  { path:'/settings', label:'설정',     icon:'⚙️' },
];

function NavItem({ item, isMobile=false }) {
  const { user } = useAuth();
  if (item.adminOnly && user?.role !== 'admin') return null;
  const base = isMobile
    ? 'flex flex-col items-center gap-0.5 py-2 px-3 text-slate-500 transition-colors'
    : 'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-slate-400 hover:text-white hover:bg-slate-800 transition-colors';
  const active = isMobile ? 'text-amber-400' : 'bg-amber-500/10 text-amber-400 border border-amber-500/20';
  return (
    <NavLink to={item.path} end={item.exact} className={({isActive})=>`${base} ${isActive?active:''}`}>
      <span className={isMobile?'text-xl leading-none':'text-base'}>{item.icon}</span>
      <span className={isMobile?'text-[10px] font-semibold':''}>{item.label}</span>
    </NavLink>
  );
}

export default function AppLayout({ children, darkMode }) {
  const { user, logout } = useAuth();
  const side  = darkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200';
  const txt   = darkMode ? 'text-slate-100' : 'text-slate-900';
  const sub   = darkMode ? 'text-slate-500' : 'text-slate-400';
  const botBg = darkMode ? 'bg-slate-900/95 border-slate-800' : 'bg-white/95 border-slate-200';
  const bg    = darkMode ? 'bg-slate-950' : 'bg-slate-50';

  return (
    <div className={`flex h-screen overflow-hidden ${bg} ${txt}`}>
      {/* 사이드바 (데스크탑) */}
      <aside className={`hidden md:flex flex-col w-60 shrink-0 border-r ${side} p-4 gap-1`}>
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
          {NAV.map(item=><NavItem key={item.path} item={item}/>)}
        </nav>
        <div className={`mt-auto pt-4 border-t ${darkMode?'border-slate-800':'border-slate-200'}`}>
          <div className="flex items-center gap-2 px-2 mb-2">
            <div className="w-7 h-7 bg-amber-500 rounded-full flex items-center justify-center text-xs font-bold text-slate-950">{user?.name?.[0]??'U'}</div>
            <div><p className="text-xs font-semibold">{user?.name}</p><p className={`text-[10px] ${sub}`}>{user?.role==='admin'?'관리자':'트레이너'}</p></div>
          </div>
          <button onClick={logout} className={`w-full text-left text-xs px-3 py-2 rounded-lg ${sub} hover:text-red-400 transition-colors`}>로그아웃</button>
        </div>
      </aside>

      {/* 메인 */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* 모바일 헤더 */}
        <header className={`md:hidden flex items-center justify-between px-4 py-3 border-b ${side}`}>
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 bg-amber-500 rounded-lg flex items-center justify-center text-slate-950 font-black text-xs">몸</div>
            <div>
              <p className="font-black text-xs leading-tight">몸가짐운동센터</p>
              <p className="text-[10px] text-slate-500 leading-tight">관리 시스템</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className={`text-xs ${sub}`}>{user?.name}</span>
            <button onClick={logout} className="text-xs text-red-400 hover:text-red-300">로그아웃</button>
          </div>
        </header>
        <div className="flex-1 overflow-y-auto pb-20 md:pb-0">
          <div className="p-4 md:p-6 max-w-5xl mx-auto w-full">{children}</div>
        </div>
        {/* 모바일 하단 네비 */}
        <nav className={`md:hidden fixed bottom-0 inset-x-0 border-t backdrop-blur-md ${botBg} flex justify-around items-center px-2`}
             style={{paddingBottom:'env(safe-area-inset-bottom, 0px)'}}>
          {NAV.map(item=><NavItem key={item.path} item={item} isMobile/>)}
        </nav>
      </main>
    </div>
  );
}
