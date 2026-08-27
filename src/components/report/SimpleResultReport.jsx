// components/report/SimpleResultReport.jsx
// ════════════════════════════════════════════════════════════════════════
//  회원에게 공유하는 "쉬운 버전" 결과 리포트 — 초등학생도 뜻을 알 수 있을
//  만큼 쉬운 말과 큰 아이콘 중심으로 구성한다. 트레이너가 CMS에서 보는
//  상세 리포트(숫자·전문용어 포함)는 그대로 두고, 회원에게 나가는 카드만
//  이 컴포넌트로 새로 만든다 — 기존 화면은 건드리지 않는다.
//
//  자세·보행·점프·ROM·리프팅·스쿼트·스탠스 등 측정 종류가 몇 가지든,
//  이 컴포넌트는 하나만 존재한다. unifiedReport.js의 buildSummaryData()가
//  이미 모든 측정 종류를 같은 모양(overallScore/status/keyMetrics/
//  topFindings/recommendations)으로 통일해두었기 때문에, 그 요약 데이터
//  하나만 받으면 어떤 측정이든 같은 방식으로 쉽게 그릴 수 있다.
//  → 새 측정 종류가 추가돼도 이 파일은 수정할 필요가 없다.
//
//  "좌우 비대칭 12% · 주의" 처럼 라벨+숫자+상태를 기계적으로 이어붙인
//  문장을 그대로 보여주는 대신, 라벨과 상태(정상/주의/위험)만 가지고
//  이 파일 안에서 매번 새로 아주 쉬운 한 문장을 만든다(simpleMetricLine).
//  전문용어 사전(REPORT_TERM_MAP, 38개 항목)을 손으로 다 쉬운 말로
//  바꿔쓰는 대신 이 방식을 쓰는 이유: 측정 종류·항목이 계속 늘어나는
//  중이라, 항목별 문구를 일일이 새로 써주지 않아도 항상 쉬운 문장이
//  자동으로 나온다.
//
//  회원 중에는 학생선수(어린이·청소년)뿐 아니라 재활·노인 회원도 있어서,
//  아동 전용 호칭 대신 이름+"님"을 쓰고, 이모지도 과하지 않게 상태당
//  1~2개로 절제했다 — "쉬운 말"이지 "아이용 말투"가 아니다.
// ════════════════════════════════════════════════════════════════════════
import { UnifiedReportCanvas, UnifiedReportPage } from './UnifiedReportPrimitives';

const SIMPLE_STATUS = {
  normal: {
    emoji: '😊',
    word: '좋아요',
    tone: 'text-emerald-700 dark:text-emerald-300',
    bg: 'bg-emerald-500/10',
    border: 'border-emerald-400/40',
    headline: (title) => `${title}, 아주 좋아요!`,
    detail: '지금처럼 하면 돼요.',
  },
  caution: {
    emoji: '🙂',
    word: '조금 신경써요',
    tone: 'text-amber-700 dark:text-amber-300',
    bg: 'bg-amber-500/10',
    border: 'border-amber-400/40',
    headline: (title) => `${title}, 몇 가지만 더 신경 쓰면 좋아요`,
    detail: '아래 항목을 같이 확인해봐요.',
  },
  risk: {
    emoji: '💪',
    word: '꼭 확인해요',
    tone: 'text-red-700 dark:text-red-300',
    bg: 'bg-red-500/10',
    border: 'border-red-400/40',
    headline: (title) => `${title}, 트레이너 선생님과 자세히 확인해봐요`,
    detail: '아래 항목을 트레이너 선생님과 같이 봐주세요.',
  },
  observed: {
    emoji: '👀',
    word: '다음에 다시 봐요',
    tone: 'text-slate-600 dark:text-slate-300',
    bg: 'bg-slate-500/10',
    border: 'border-slate-400/40',
    headline: (title) => `${title}, 한 번 더 확인하면 더 정확해요`,
    detail: '한 번만 나온 결과라 다음에 다시 봐요.',
  },
  unknown: {
    emoji: '📋',
    word: '정리 중',
    tone: 'text-slate-500 dark:text-slate-400',
    bg: 'bg-slate-500/10',
    border: 'border-slate-400/40',
    headline: (title) => `${title} 결과를 정리하고 있어요`,
    detail: '트레이너 선생님이 곧 설명해드릴 거예요.',
  },
};

function statusFor(key) {
  return SIMPLE_STATUS[key] || SIMPLE_STATUS.unknown;
}

// "라벨 + 상태"만으로 항목별 문장을 새로 짓는다 — 측정 종류를 안 가린다.
function simpleMetricLine(metric) {
  const key = metric?.status?.key;
  if (key === 'normal') return '좋아요';
  if (key === 'caution') return '조금 신경써요';
  if (key === 'risk') return '꼭 확인해요';
  if (key === 'observed') return '다음에 다시 봐요';
  return '확인 중';
}

function formatDateOnly(value) {
  return String(value || '').slice(0, 10);
}

/**
 * @param {object} summary  unifiedReport.buildSummaryData() 결과
 *   { title, overallScore, status, statusLabel, keyMetrics[], topFindings[], recommendations[], measuredAt }
 * @param {object} member   { name }
 * @param {string} id       캡처용 DOM id (지정 없으면 기본값 사용)
 */
export default function SimpleResultReport({ summary, member, id }) {
  if (!summary) return null;

  const status = statusFor(summary.status);
  const title = summary.title || '측정';
  const memberName = member?.name || '회원';
  const measuredAt = formatDateOnly(summary.measuredAt);
  const metrics = (summary.keyMetrics || []).slice(0, 6);
  const recommendation = (summary.recommendations || []).filter(Boolean)[0];

  return (
    <UnifiedReportCanvas>
      <UnifiedReportPage id={id || 'simple-result-report'} className="mx-auto flex flex-col items-center gap-5 py-8 text-center">
        <div>
          <p className="text-sm font-bold text-slate-500">{memberName}님의</p>
          <h1 className="mt-1 break-keep text-2xl font-black leading-snug text-white sm:text-3xl">{title} 결과예요</h1>
          {measuredAt && <p className="mt-1 text-[11px] font-semibold text-slate-500">{measuredAt} 측정</p>}
        </div>

        <div className={`flex w-full flex-col items-center gap-2 rounded-3xl border ${status.border} ${status.bg} px-6 py-7 sm:px-10`}>
          <span className="text-6xl leading-none">{status.emoji}</span>
          <p className={`break-keep text-xl font-black leading-snug ${status.tone}`}>{status.headline(title)}</p>
          <p className="break-keep text-[12px] font-semibold text-slate-500">{status.detail}</p>
        </div>

        {metrics.length > 0 && (
          <div className="grid w-full grid-cols-2 gap-3 text-left">
            {metrics.map((metric) => {
              const s = statusFor(metric.status?.key);
              return (
                <div key={metric.key} className={`rounded-2xl border ${s.border} ${s.bg} p-3`}>
                  <div className="flex items-start gap-2">
                    <span className="text-xl leading-none">{s.emoji}</span>
                    <p className="break-keep text-[12.5px] font-black leading-tight text-white">{metric.label}</p>
                  </div>
                  <p className={`mt-2 text-[12px] font-bold ${s.tone}`}>{simpleMetricLine(metric)}</p>
                  {metric.displayValue != null && metric.displayValue !== '' && metric.displayValue !== '-' && (
                    <p className="mt-1 text-[10px] font-semibold text-slate-500">
                      참고 수치 {metric.displayValue}{metric.unit || ''}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {recommendation && (
          <div className="w-full rounded-2xl bg-slate-100/60 dark:bg-slate-800/60 p-4 text-left">
            <p className="mb-1 text-[11px] font-black uppercase tracking-widest text-amber-600 dark:text-amber-400">
              다음에 확인해보면 좋아요
            </p>
            <p className="break-keep text-[13px] font-semibold leading-relaxed text-slate-700 dark:text-slate-200">
              {recommendation}
            </p>
          </div>
        )}

        <p className="break-keep text-[11px] font-semibold text-slate-500">
          궁금한 점은 언제든 트레이너 선생님께 물어보세요.
        </p>
      </UnifiedReportPage>
    </UnifiedReportCanvas>
  );
}
