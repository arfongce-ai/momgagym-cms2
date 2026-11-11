// pages/MyRecords.jsx
// ════════════════════════════════════════════════════════════════════════
//  [트레이너 본인 기록 2026-11-11] "내 기록" — 트레이너 본인의 신체정보·측정이력.
//  · 트레이너: 본인 기록만. 관리자(대표): 트레이너별로 골라서 본다.
//  · 화면은 회원 상세(MemberDetail)의 신체정보·측정이력 탭을 그대로 재사용한다.
//  · 새 측정은 AI분석(측정) 화면의 대상 선택에서 "○○ (트레이너)"를 고르면 된다.
// ════════════════════════════════════════════════════════════════════════
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { store } from '../demoData';
import { trainerSelfSubjectsFor } from '../utils/trainerSelf';
import MemberDetail from '../components/members/MemberDetail';

export default function MyRecords() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const trainers = store.getTrainers();
  const subjects = useMemo(() => trainerSelfSubjectsFor(user, trainers), [user, trainers]);
  const [openId, setOpenId] = useState('');
  const opened = subjects.find((s) => s.id === openId) || null;

  return (
    <div className="max-w-md mx-auto space-y-4">
      <div>
        <h1 className="text-lg font-black">내 기록</h1>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
          트레이너 본인의 신체정보와 체력측정 기록입니다. 회원 수·매출 통계에는 포함되지 않습니다.
        </p>
      </div>

      {subjects.length === 0 ? (
        <div className="rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 p-4 text-sm text-slate-600 dark:text-slate-300">
          {user?.role === 'trainer'
            ? '로그인 계정과 연결된 트레이너 정보를 찾지 못했습니다. 대표님께 트레이너 등록(로그인 이메일 연결)을 요청해 주세요.'
            : '등록된 트레이너가 없거나, 이 계정은 본인 기록 대상이 아닙니다.'}
        </div>
      ) : (
        <div className="space-y-2">
          {subjects.map((s) => {
            const bodyCount = store.getBodyRecords(s.id).length;
            return (
              <div key={s.id} className="rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-bold truncate">{s.name}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      신체정보 {bodyCount}건{s.birthDate ? '' : ' · 생년월일 미등록'}{s.gender ? '' : ' · 성별 미등록'}
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={() => setOpenId(s.id)} className="rounded-xl bg-amber-500 py-2.5 text-sm font-bold text-slate-950">기록 보기</button>
                  <button onClick={() => navigate('/ai')} className="rounded-xl border-2 border-slate-300 dark:border-slate-600 py-2.5 text-sm font-bold text-slate-600 dark:text-slate-200">측정하러 가기</button>
                </div>
              </div>
            );
          })}
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            측정 화면의 대상 선택에서 “이름 (트레이너)”를 고르면 본인 기록으로 저장됩니다. 생년월일·성별은 대표님이 트레이너 관리에서 입력합니다.
          </p>
        </div>
      )}

      {opened && (
        <MemberDetail
          key={opened.id}
          member={opened}
          trainers={trainers}
          members={[]}
          onClose={() => setOpenId('')}
        />
      )}
    </div>
  );
}
