// pages/Report.jsx
// 측정 리포트 페이지: 회원 선택 → 실측 데이터 그래프/요약 → JPG 다운로드.
import { useState, useMemo, useEffect, useRef, lazy, Suspense } from 'react';
import { todayYMD } from '../utils/dates';
import { useAuth } from '../contexts/AuthContext';
import { scopeMembersToTrainer, sortByName } from '../utils/memberList';
import { store, aiStore } from '../demoData';
import { buildFullReport, buildAnalysisTrend, buildPostureTrend } from '../services/reportService';
import { buildReportSvg, downloadSvgAsJpg } from '../components/report/reportImage';
import { buildSummaryData, scoreToStatus } from '../ai-measure/core/unifiedReport';
import { captureNodeToJpgFile, shareMeasurementSummaryToKakao } from '../ai-measure/core/reportShare';
import TrendChart from '../components/report/TrendChart';
import MemberPicker from '../components/common/MemberPicker';
const JumpReportDashboard = lazy(() => import('../ai-measure/menus/JumpReportDashboard'));
const GaitReportDashboard = lazy(() => import('../ai-measure/menus/GaitReportDashboard'));
const PostureReport = lazy(() => import('../ai-measure/menus/PostureReport'));
const RomReport = lazy(() => import('../ai-measure/menus/RomReport'));

const COLORS = { weight:'#f59e0b', systolic:'#ef4444', diastolic:'#3b82f6', height:'#22d3ee' };
const DETAIL_SESSION_MENUS = new Set(['jump', 'gait', 'posture', 'rom']);
const REPORT_FILTERS = [
  { key: 'all', label: '전체' },
  { key: 'posture', label: '자세' },
  { key: 'rom', label: 'ROM' },
  { key: 'jump', label: '점프' },
  { key: 'gait', label: '보행' },
  { key: 'strength', label: '근력' },
];

const REPORT_TYPE_META = {
  posture: { title: '자세·체형', badge: 'POSTURE', accent: 'text-emerald-300', bg: 'bg-emerald-500/15', border: 'border-emerald-500/25' },
  rom: { title: '관절 가동범위', badge: 'ROM', accent: 'text-sky-300', bg: 'bg-sky-500/15', border: 'border-sky-500/25' },
  jump: { title: '점프·RSI', badge: 'JUMP', accent: 'text-amber-300', bg: 'bg-amber-500/15', border: 'border-amber-500/25' },
  gait: { title: '보행·러닝', badge: 'GAIT', accent: 'text-cyan-300', bg: 'bg-cyan-500/15', border: 'border-cyan-500/25' },
  one_rm: { title: '최대 근력', badge: '1RM', accent: 'text-violet-300', bg: 'bg-violet-500/15', border: 'border-violet-500/25' },
  vbt: { title: '운동 속도 근력', badge: 'VBT', accent: 'text-fuchsia-300', bg: 'bg-fuchsia-500/15', border: 'border-fuchsia-500/25' },
  general: { title: '측정 결과', badge: 'AI', accent: 'text-slate-300', bg: 'bg-slate-700', border: 'border-slate-700' },
};

const STATUS_STYLE = {
  normal: { text: 'text-emerald-300', bg: 'bg-emerald-500/12', border: 'border-emerald-500/30' },
  caution: { text: 'text-amber-300', bg: 'bg-amber-500/12', border: 'border-amber-500/30' },
  risk: { text: 'text-red-300', bg: 'bg-red-500/12', border: 'border-red-500/30' },
  unknown: { text: 'text-slate-400', bg: 'bg-slate-700/60', border: 'border-slate-700' },
};

function isJumpRsi(data) {
  return data?.jumpType === 'reactive' || Boolean(data?.rsi);
}

function getSavedReportMeta(rep) {
  if (rep?.kind === 'jump') {
    return isJumpRsi(rep)
      ? { title: 'RSI 반응점프', badge: 'RSI', color: 'text-emerald-300', bg: 'bg-emerald-500/15' }
      : { title: '파워점프', badge: 'POWER', color: 'text-amber-300', bg: 'bg-amber-500/15' };
  }
  if (rep?.kind === 'gait') {
    return { title: '보행·러닝', badge: 'GAIT', color: 'text-sky-300', bg: 'bg-sky-500/15' };
  }
  return { title: '측정', badge: 'AI', color: 'text-slate-300', bg: 'bg-slate-700' };
}

// 세션 1건에서 회차비교용 핵심 수치/라벨을 뽑는다 (메뉴별).
function getReportDate(item) {
  return String(
    item?.createdAt
    || item?.measuredAt
    || item?.recordedAtFull
    || item?.recordedAt
    || item?.basic_info?.createdAt
    || ''
  );
}

function formatDateOnly(value) {
  return String(value || '').slice(0, 10) || '-';
}

function reportTypeFromSession(session) {
  if (session?.menu === 'onerm') return 'one_rm';
  if (session?.menu === 'vbt') return 'vbt';
  if (session?.menu === 'rsi') return 'jump';
  return session?.menu || 'general';
}

function reportFilterKey(type) {
  if (type === 'one_rm' || type === 'vbt') return 'strength';
  return type || 'general';
}

function getReportTypeMeta(type, report) {
  if (type === 'jump' && isJumpRsi(report)) {
    return { ...REPORT_TYPE_META.jump, title: 'RSI 반응 점프', badge: 'RSI', accent: 'text-emerald-300', bg: 'bg-emerald-500/15', border: 'border-emerald-500/25' };
  }
  return REPORT_TYPE_META[type] || REPORT_TYPE_META.general;
}

function makeUnifiedResult({ report, reportType, source, index, member, session }) {
  const data = {
    ...(report || {}),
    kind: (report || {}).kind || reportType,
    member: (report || {}).member || member,
    measuredAt: getReportDate(report || session) || new Date().toISOString(),
  };
  const summary = buildSummaryData(data, { reportType });
  const status = scoreToStatus(summary.overallScore);
  const meta = getReportTypeMeta(reportType, data);
  return {
    id: `${source}:${data.id || session?.id || index}`,
    source,
    index,
    session,
    report: data,
    reportType,
    filterKey: reportFilterKey(reportType),
    date: summary.measuredAt || getReportDate(data),
    summary: {
      ...summary,
      status: summary.status || status.key,
      statusLabel: summary.statusLabel || status.label,
    },
    meta,
  };
}

function buildUnifiedResults({ member, savedReports, savedPostureReports, savedRomReports, sessions }) {
  if (!member) return [];
  const items = [];

  savedPostureReports.forEach((report, index) => {
    items.push(makeUnifiedResult({ report, reportType: 'posture', source: 'posture', index, member }));
  });
  savedRomReports.forEach((report, index) => {
    items.push(makeUnifiedResult({ report, reportType: 'rom', source: 'rom', index, member }));
  });
  savedReports.forEach((report, index) => {
    const reportType = report?.kind === 'jump' || report?.jumpType || report?.heightCm != null ? 'jump' : 'gait';
    items.push(makeUnifiedResult({ report, reportType, source: 'saved-report', index, member }));
  });

  (sessions || [])
    .filter((session) => !DETAIL_SESSION_MENUS.has(session.menu))
    .forEach((session, index) => {
      const reportType = reportTypeFromSession(session);
      items.push(makeUnifiedResult({
        report: {
          ...(session.data || {}),
          kind: reportType,
          member,
          measuredAt: session.recordedAtFull || session.recordedAt,
        },
        reportType,
        source: 'session',
        index,
        member,
        session,
      }));
    });

  return items.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
}

const REPORT_CAPTURE_PAGE_SELECTOR = '.report-a4-page';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function nextFrame() {
  return new Promise(resolve => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => resolve());
      return;
    }
    setTimeout(resolve, 16);
  });
}

async function waitForShareCapture(ref, timeoutMs = 2600) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await nextFrame();
    const root = ref.current?.querySelector('[data-share-report-ready="true"]');
    const page = root?.querySelector(REPORT_CAPTURE_PAGE_SELECTOR);
    if (page && page.getBoundingClientRect().width > 0 && page.getBoundingClientRect().height > 0) {
      await nextFrame();
      return root;
    }
  }
  return ref.current?.querySelector('[data-share-report-ready="true"]') || null;
}

async function waitForImages(root, timeoutMs = 1200) {
  const images = Array.from(root?.querySelectorAll?.('img') || []).filter(img => !img.complete);
  if (!images.length) {
    await nextFrame();
    return;
  }
  await Promise.race([
    Promise.all(images.map(img => new Promise(resolve => {
      img.addEventListener('load', resolve, { once: true });
      img.addEventListener('error', resolve, { once: true });
    }))),
    sleep(timeoutMs),
  ]);
}

function canCaptureUnifiedResult(item) {
  return item?.source === 'saved-report' || item?.source === 'posture' || item?.source === 'rom';
}

function safeFileSegment(value, fallback = 'report') {
  return String(value || fallback)
    .trim()
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 60) || fallback;
}

function buildShareFileBaseName(item, member) {
  const rawDate = formatDateOnly(item?.date);
  const date = rawDate && rawDate !== '-' ? rawDate.replace(/-/g, '') : todayYMD().replace(/-/g, '');
  return [
    safeFileSegment(member?.name || item?.report?.member?.name, '회원'),
    safeFileSegment(item?.meta?.badge || item?.reportType, '리포트'),
    date,
  ].join('_');
}

function downloadFile(file) {
  const url = URL.createObjectURL(file);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = file.name;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(url), 300);
}

async function shareReportFilesOrDownload(files, { title, text } = {}) {
  const list = (Array.isArray(files) ? files : [files]).filter(Boolean);
  if (!list.length) return { ok: false, mode: 'none', msg: '공유할 리포트 이미지가 없습니다.' };

  if (typeof navigator !== 'undefined' && navigator.share) {
    try {
      const shareFiles = !navigator.canShare
        ? list
        : navigator.canShare({ files: list })
          ? list
          : list.length > 1 && navigator.canShare({ files: [list[0]] })
            ? [list[0]]
            : null;
      if (shareFiles) {
        await navigator.share({ title, text, files: shareFiles });
        return {
          ok: true,
          mode: 'share',
          msg: shareFiles.length === list.length ? '리포트 이미지를 공유했습니다.' : '리포트 첫 페이지 이미지를 공유했습니다.',
        };
      }
    } catch (err) {
      if (err?.name === 'AbortError') return { ok: false, mode: 'cancel', msg: '' };
    }
  }

  list.forEach((file, index) => setTimeout(() => downloadFile(file), index * 250));
  return {
    ok: true,
    mode: 'download',
    msg: '이 기기에서는 이미지 공유가 제한되어 리포트 JPG를 저장했습니다.',
  };
}

function ShareCaptureReport({ item, member }) {
  if (!item) return null;
  const report = item.report || {};
  const reportMember = member || report.member;

  if (item.source === 'saved-report') {
    return (
      <div data-share-report-ready="true" className="w-full bg-slate-950">
        {report.kind === 'jump'
          ? <JumpReportDashboard report={report} />
          : <GaitReportDashboard report={report} />}
      </div>
    );
  }

  if (item.source === 'posture') {
    return (
      <div data-share-report-ready="true" className="w-full bg-slate-950">
        <PostureReport
          report={report}
          member={reportMember}
          heightCm={report?.heightCm}
          actualAge={report?.actualAge}
        />
      </div>
    );
  }

  if (item.source === 'rom') {
    return (
      <div data-share-report-ready="true" className="w-full bg-slate-950">
        <RomReport report={{ ...report, member: report.member || reportMember }} />
      </div>
    );
  }

  return null;
}

function extractSessionMetric(session) {
  const d = session.data || {};
  switch (session.menu) {
    case 'onerm':   return { value: d.oneRM, unit: 'kg', label: `1RM (${d.liftLabel ?? ''} ${d.weight ?? '-'}kg×${d.reps ?? '-'})` };
    case 'rsi':     return { value: d.rsi, unit: '', label: `RSI · 높이 ${d.heightCm ?? '-'}cm` };
    case 'vbt':     return { value: d.meanVelocity, unit: 'm/s', label: `평균속도 (${d.zone ?? ''})` };
    case 'jump': {
      if (isJumpRsi(d)) {
        return { value: d.rsi?.rsi ?? d.rsi, unit: '', label: `RSI 반응점프 · 높이 ${d.heightCm ?? '-'}cm` };
      }
      return { value: d.heightCm, unit: 'cm', label: `파워점프 · ${d.peakPower ? `${d.peakPower}W` : '파워 미입력'}` };
    }
    case 'posture': return { value: d.shoulderTilt?.deg, unit: '°', label: `어깨 기울기 · 골반 ${d.hipTilt?.deg ?? '-'}°` };
    case 'gait':    return { value: d.cadence ?? d.metrics?.cadence, unit: 'SPM', label: '케이던스' };
    case 'body':    return { value: d.weight, unit: 'kg', label: `체중${d.systolic ? ` · ${d.systolic}/${d.diastolic}` : ''}` };
    default:        return { value: null, unit: '', label: '측정' };
  }
}

function UnifiedResultCard({ item, onOpen, onShare, sharing }) {
  const statusStyle = STATUS_STYLE[item.summary.status] || STATUS_STYLE.unknown;
  const findings = (item.summary.topFindings || []).slice(0, 3);
  const canOpen = item.source !== 'session' || item.session?.menu;
  return (
    <div
      className={`w-full rounded-2xl border bg-slate-900 p-4 ${item.meta.border}`}
    >
      <button
        type="button"
        onClick={() => canOpen && onOpen(item)}
        disabled={!canOpen}
        className={`block w-full text-left transition ${canOpen ? 'active:scale-[0.99] cursor-pointer' : 'cursor-default'}`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full px-2 py-0.5 text-[9px] font-black ${item.meta.bg} ${item.meta.accent}`}>
                {item.meta.badge}
              </span>
              <span className="text-[11px] font-bold text-slate-500">{formatDateOnly(item.date)}</span>
            </div>
            <p className="mt-2 break-keep text-base font-black leading-tight text-white">
              {item.summary.title || item.meta.title}
            </p>
            <p className="mt-1 break-keep text-[12px] font-semibold leading-tight text-slate-500">
              {item.meta.title}
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p className={`font-mono text-3xl font-black leading-none ${statusStyle.text}`}>
              {item.summary.overallScore ?? 0}
            </p>
            <span className={`mt-1 inline-flex rounded-full border px-2 py-0.5 text-[10px] font-black ${statusStyle.bg} ${statusStyle.border} ${statusStyle.text}`}>
              {item.summary.statusLabel || '확인 필요'}
            </span>
          </div>
        </div>

        <div className="mt-3 space-y-1.5">
          {findings.length > 0 ? findings.map((finding, idx) => (
            <p key={`${item.id}-finding-${idx}`} className="line-clamp-2 break-keep rounded-lg bg-slate-800/65 px-3 py-2 text-[12px] font-semibold leading-relaxed text-slate-300">
              {finding.text}
            </p>
          )) : (
            <p className="rounded-lg bg-slate-800/65 px-3 py-2 text-[12px] font-semibold text-slate-400">
              핵심 결과를 정리 중입니다.
            </p>
          )}
        </div>
      </button>

      {/* 카카오톡 공유: 리포트 화면이 있으면 이미지 파일 공유, 없으면 요약 공유 */}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onShare?.(item); }}
        disabled={sharing}
        className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl bg-[#FEE500] py-2.5 text-[13px] font-black text-[#191600] transition active:scale-[0.99] disabled:opacity-60"
      >
        {sharing ? '리포트 생성 중…' : '카카오톡으로 리포트 공유'}
      </button>
    </div>
  );
}

export default function Report() {
  const { user } = useAuth();
  // 트레이너 모드: 담당 회원만 / 모든 회원은 가나다 순으로 노출.
  const members = useMemo(() => sortByName(scopeMembersToTrainer(store.getMembers(), user)), [user]);
  const [memberId, setMemberId] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [msg, setMsg] = useState(null);
  const [reportFilter, setReportFilter] = useState('all');
  const [sharingId, setSharingId] = useState(null);
  const [shareCaptureItem, setShareCaptureItem] = useState(null);
  const shareCaptureRef = useRef(null);

  const member = members.find(m => m.id === memberId);

  // [읽기 절감] 선택된 회원의 측정 데이터(ai · gait_reports)만 지연 로딩.
  // 로딩 완료 후 dataReady 가 바뀌면 아래 useMemo 들이 재계산된다.
  const [dataReady, setDataReady] = useState(0);
  useEffect(() => {
    if (!member) return;
    let alive = true;
    (async () => {
      await Promise.all([
        aiStore.ensureSessions(member.id),
        aiStore.ensureGaitReports(member.id),
        aiStore.ensurePostureReports(member.id),
        aiStore.ensureRomReports(member.id),
      ]);
      if (alive) setDataReady(v => v + 1);
    })();
    return () => { alive = false; };
  }, [member?.id]);

  const report = useMemo(() => {
    if (!member) return null;
    return buildFullReport({
      member,
      bodyRecords: store.getBodyRecords(member.id),
      aiSessions:  aiStore.getSessions(member.id),
    });
  }, [member, dataReady]);

  // 보행/점프 분석 회차별 추세 (gait_reports)
  const trend = useMemo(() => {
    if (!member) return null;
    return buildAnalysisTrend(aiStore.getGaitReports(member.id));
  }, [member, dataReady]);

  // 자세·체형 측정 이력 추세 (posture_reports)
  const postureTrend = useMemo(() => {
    if (!member) return null;
    return buildPostureTrend(aiStore.getPostureReports(member.id));
  }, [member, dataReady]);

  // 저장된 자세 리포트 목록 (최신순)
  const savedPostureReports = useMemo(() => {
    if (!member) return [];
    return [...(aiStore.getPostureReports(member.id) || [])]
      .sort((a, b) => String(b.createdAt || b.measuredAt).localeCompare(String(a.createdAt || a.measuredAt)));
  }, [member, dataReady]);

  const savedRomReports = useMemo(() => {
    if (!member) return [];
    return [...(aiStore.getRomReports(member.id) || [])]
      .sort((a, b) => String(b.createdAt || b.measuredAt || b.basic_info?.createdAt).localeCompare(String(a.createdAt || a.measuredAt || a.basic_info?.createdAt)));
  }, [member, dataReady]);

  // 저장된 AI 측정 리포트 목록 (최신순) — 페이지별 열람용
  const savedReports = useMemo(() => {
    if (!member) return [];
    return [...(aiStore.getGaitReports(member.id) || [])]
      .sort((a, b) => String(b.createdAt || b.measuredAt).localeCompare(String(a.createdAt || a.measuredAt)));
  }, [member, dataReady]);
  const [viewerIdx, setViewerIdx] = useState(null); // 열람 중인 리포트 인덱스
  const [postureViewerIdx, setPostureViewerIdx] = useState(null); // 자세 리포트 열람 인덱스
  const [romViewerIdx, setRomViewerIdx] = useState(null); // ROM 리포트 열람 인덱스
  const [expandedMenu, setExpandedMenu] = useState(null); // 펼친 측정 메뉴

  // 메뉴별 개별 세션 목록 (상세/회차비교용)
  const sessionsByMenu = useMemo(() => {
    if (!member) return {};
    const all = aiStore.getSessions(member.id) || [];
    const map = {};
    for (const s of all) {
      const k = s.menu || 'etc';
      (map[k] = map[k] || []).push(s);
    }
    // 날짜 오름차순 (회차 비교는 시간순)
    for (const k of Object.keys(map)) {
      map[k].sort((a, b) => String(a.recordedAt || a.recordedAtFull).localeCompare(String(b.recordedAt || b.recordedAtFull)));
    }
    return map;
  }, [member, dataReady]);

  const unifiedResults = useMemo(() => {
    if (!member) return [];
    return buildUnifiedResults({
      member,
      savedReports,
      savedPostureReports,
      savedRomReports,
      sessions: aiStore.getSessions(member.id) || [],
    });
  }, [member, dataReady, savedReports, savedPostureReports, savedRomReports]);

  const filteredUnifiedResults = useMemo(() => {
    if (reportFilter === 'all') return unifiedResults;
    return unifiedResults.filter((item) => item.filterKey === reportFilter);
  }, [reportFilter, unifiedResults]);

  const openUnifiedResult = (item) => {
    if (item.source === 'posture') {
      setPostureViewerIdx(item.index);
      return;
    }
    if (item.source === 'rom') {
      setRomViewerIdx(item.index);
      return;
    }
    if (item.source === 'saved-report') {
      setViewerIdx(item.index);
      return;
    }
    if (item.session?.menu) {
      setExpandedMenu(item.session.menu);
      setMsg('아래 AI 측정 이력에서 해당 결과를 확인할 수 있습니다.');
      setTimeout(() => setMsg(null), 1800);
    }
  };

  const captureUnifiedResultFiles = async (item) => {
    if (!canCaptureUnifiedResult(item)) return [];
    setShareCaptureItem(item);
    try {
      await nextFrame();
      const root = await waitForShareCapture(shareCaptureRef);
      if (!root) return [];
      await waitForImages(root);
      await sleep(80);

      const pages = Array.from(root.querySelectorAll(REPORT_CAPTURE_PAGE_SELECTOR));
      const targets = pages.length ? pages : [root];
      const baseName = buildShareFileBaseName(item, member);
      const files = [];

      for (let i = 0; i < targets.length; i += 1) {
        const suffix = targets.length > 1 ? `_A4_${i + 1}` : '_A4';
        files.push(await captureNodeToJpgFile(targets[i], `${baseName}${suffix}.jpg`, { bg: '#0f172a' }));
      }

      return files;
    } finally {
      setShareCaptureItem(null);
    }
  };

  const shareUnifiedResult = async (item) => {
    if (!item || sharingId) return;
    setSharingId(item.id); setMsg(null);
    try {
      if (canCaptureUnifiedResult(item)) {
        try {
          setMsg('리포트 이미지를 만드는 중입니다...');
          const files = await captureUnifiedResultFiles(item);
          if (files.length) {
            const res = await shareReportFilesOrDownload(files, {
              title: `${member?.name || '회원'} 결과 리포트`,
              text: '몸가짐운동센터 측정 결과 리포트입니다.',
            });
            setMsg(res.msg);
            return;
          }
        } catch (captureError) {
          console.warn('[Report] result image share fallback:', captureError);
        }
      }

      const res = await shareMeasurementSummaryToKakao(item.summary, {
        memberName: member?.name || '',
        reportType: item.reportType,
        title: `몸가짐CMS 측정 결과 요약 · ${member?.name || ''}`.trim(),
      });
      setMsg(res.msg);
    } catch (e) {
      setMsg(`카카오 공유 실패: ${e?.message || '오류'}`);
    } finally {
      setSharingId(null);
      setTimeout(() => setMsg(null), 2600);
    }
  };

  const handleDownload = async () => {
    if (!report) return;
    setDownloading(true); setMsg(null);
    try {
      const svg = buildReportSvg(report);
      const name = `리포트_${member.name}_${todayYMD()}.jpg`;
      await downloadSvgAsJpg(svg, name, 2);
      setMsg('이미지가 다운로드되었습니다.');
    } catch (e) {
      setMsg('다운로드 실패: ' + e.message);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="space-y-5 max-w-md mx-auto">
      <div>
        <h1 className="text-2xl font-black tracking-tight">측정 리포트</h1>
        <p className="text-slate-500 text-sm mt-1">실제 측정된 데이터만 리포트로 출력됩니다.</p>
      </div>

      {/* 회원 선택 (다른 탭과 동일한 검색형 선택기) */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
        <label className="block text-xs font-semibold text-slate-400 uppercase tracking-widest mb-2">회원 찾기</label>
        <MemberPicker members={members} value={memberId} onChange={setMemberId}
          allowNone={false} placeholder="이름 / 초성 / 전화 뒤4자리" />
      </div>

      {member && unifiedResults.length > 0 && (
        <section className="rounded-2xl border border-slate-800 bg-slate-950/40 p-3">
          <div className="mb-3 flex items-end justify-between gap-3 px-1">
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-slate-400">전체 결과</p>
              <p className="mt-1 text-sm font-semibold text-slate-500">
                자세·ROM·점프·보행·근력 결과를 최신순으로 정리합니다.
              </p>
            </div>
            <span className="shrink-0 rounded-full bg-slate-800 px-2.5 py-1 text-[11px] font-black text-slate-300">
              {unifiedResults.length}건
            </span>
          </div>

          <div className="-mx-1 mb-3 flex gap-2 overflow-x-auto px-1 pb-1">
            {REPORT_FILTERS.map((filter) => {
              const active = reportFilter === filter.key;
              return (
                <button
                  key={filter.key}
                  type="button"
                  onClick={() => setReportFilter(filter.key)}
                  className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-black transition ${
                    active
                      ? 'border-amber-400 bg-amber-500 text-slate-950'
                      : 'border-slate-700 bg-slate-900 text-slate-400'
                  }`}
                >
                  {filter.label}
                </button>
              );
            })}
          </div>

          <div className="space-y-2">
            {filteredUnifiedResults.length > 0 ? filteredUnifiedResults.map((item) => (
              <UnifiedResultCard key={item.id} item={item} onOpen={openUnifiedResult} onShare={shareUnifiedResult} sharing={sharingId === item.id} />
            )) : (
              <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5 text-center text-sm font-semibold text-slate-500">
                선택한 유형의 리포트가 아직 없습니다.
              </div>
            )}
          </div>
        </section>
      )}

      {report && !report.hasData && unifiedResults.length === 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 text-center text-slate-500 text-sm">
          측정된 데이터가 없습니다.<br />신체정보나 AI 측정을 먼저 기록하세요.
        </div>
      )}

      {report && report.hasData && (
        <>
          {/* 요약 카드 (최대값 기준) */}
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">측정 요약 (최대값)</p>
            <div className="grid grid-cols-2 gap-2">
              {report.body.summary.map(s => (
                <div key={s.key} className="bg-slate-900 border border-slate-800 rounded-xl p-3">
                  <p className="text-[11px] text-slate-500">{s.label}</p>
                  <p className="font-mono font-black text-lg text-slate-100">
                    {s.max}<span className="text-slate-500 text-[10px] font-normal"> {s.unit}</span>
                  </p>
                  {s.change != null && (
                    <p className={`text-[11px] font-bold ${s.change > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                      {s.change > 0 ? '▲' : '▼'} {Math.abs(s.change)}{s.unit} (최초 대비)
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* 추이 그래프 (실측 시계열만) */}
          {report.body.fields.filter(f => report.body.series[f.key]?.length > 1).length > 0 && (
            <div>
              <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">회차별 추이</p>
              <div className="space-y-3">
                {report.body.fields
                  .filter(f => report.body.series[f.key]?.length > 1)
                  .map(f => (
                    <TrendChart key={f.key} title={f.label} unit={f.unit}
                      points={report.body.series[f.key]}
                      color={COLORS[f.key] || '#f59e0b'} width={320} height={150} />
                  ))}
              </div>
            </div>
          )}

          {/* AI 측정 이력 (자세·1RM·RSI·VBT·점프 등) — 탭하면 상세 + 회차비교 */}
          {report.ai.menuSummaries?.length > 0 && (
            <div>
              <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">AI 측정 이력 · 탭하여 상세</p>
              <div className="space-y-2">
                {report.ai.menuSummaries.map((m, i) => {
                  const open = expandedMenu === m.menu;
                  const sessions = sessionsByMenu[m.menu] || [];
                  const rows = sessions.map(s => ({ s, ...extractSessionMetric(s) }));
                  const numeric = rows.filter(r => typeof r.value === 'number' && !Number.isNaN(r.value));
                  const points = numeric.map(r => ({ date: String(r.s.recordedAt || '').slice(0, 10), value: r.value }));
                  const unit = numeric[0]?.unit || '';
                  const first = numeric[0]?.value, last = numeric.at(-1)?.value;
                  const delta = (first != null && last != null) ? Math.round((last - first) * 10) / 10 : null;
                  return (
                    <div key={i} className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
                      <button onClick={() => setExpandedMenu(open ? null : m.menu)}
                        className="w-full px-3 py-2.5 flex items-center justify-between text-left active:bg-slate-800/50">
                        <div>
                          <p className="text-sm font-bold text-slate-200">{m.title}</p>
                          <p className="text-[11px] text-slate-500">{m.metric}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="text-right">
                            <p className="text-[11px] text-slate-400">{m.count}회</p>
                            <p className="text-[10px] text-slate-600">{m.latestDate}</p>
                          </div>
                          <span className={`text-amber-400 text-xs transition-transform ${open ? 'rotate-90' : ''}`}>▶</span>
                        </div>
                      </button>

                      {open && (
                        <div className="border-t border-slate-800 p-3 space-y-3">
                          {/* 회차별 비교 차트 */}
                          {points.length > 1 ? (
                            <div>
                              <p className="text-[11px] font-bold text-slate-400 mb-1">회차별 비교 {delta != null && (
                                <span className={delta === 0 ? 'text-slate-500' : delta > 0 ? 'text-emerald-400' : 'text-red-400'}>
                                  (최초 대비 {delta > 0 ? '▲' : delta < 0 ? '▼' : '–'}{Math.abs(delta)}{unit})
                                </span>
                              )}</p>
                              <TrendChart title={m.title} unit={unit} points={points} color="#fbbf24" width={320} height={140} />
                            </div>
                          ) : (
                            <p className="text-[11px] text-slate-500">회차 비교는 2회차부터 표시됩니다.</p>
                          )}

                          {/* 회차별 상세 목록 (최신순) */}
                          <div className="space-y-1.5">
                            {[...rows].reverse().map((r, j) => {
                              const gIdx = savedReports.findIndex(sr => sr.measuredAt && sr.measuredAt === r.s.data?.measuredAt);
                              const openable = (m.menu === 'jump' || m.menu === 'gait') && gIdx >= 0;
                              return (
                                <div key={j} className="flex items-center justify-between bg-slate-800/60 rounded-lg px-3 py-2">
                                  <div>
                                    <p className="text-xs font-bold text-slate-200">
                                      {r.value != null ? `${r.value}${r.unit}` : '—'} <span className="text-slate-500 font-normal">{r.label}</span>
                                    </p>
                                    <p className="text-[10px] text-slate-500">{String(r.s.recordedAt || '').slice(0, 10)}</p>
                                  </div>
                                  {openable && (
                                    <button onClick={() => setViewerIdx(gIdx)} className="text-amber-400 text-[11px] font-bold">리포트 →</button>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* 점프 회차별 추세 */}
          {trend?.jump?.count > 0 && (
            <div>
              <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">
                점프 추세 ({trend.jump.count}회)
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {trend.jump.height.length > 1 && (
                  <TrendChart title="점프 높이" unit="cm" points={trend.jump.height} color="#f59e0b" width={320} height={150} />
                )}
                {trend.jump.peakPower.length > 1 && (
                  <TrendChart title="최대 파워" unit="W" points={trend.jump.peakPower} color="#22d3ee" width={320} height={150} />
                )}
                {trend.jump.footSym.length > 1 && (
                  <TrendChart title="착지 대칭" unit="%" points={trend.jump.footSym} color="#34d399" width={320} height={150} />
                )}
                {trend.jump.landKnee.length > 1 && (
                  <TrendChart title="착지 무릎각" unit="°" points={trend.jump.landKnee} color="#a78bfa" width={320} height={150} />
                )}
              </div>
              {trend.jump.height.length === 1 && (
                <p className="text-[11px] text-slate-500 mt-1">측정이 1회뿐이라 추세 그래프는 2회차부터 표시됩니다.</p>
              )}
            </div>
          )}

          {/* 보행 회차별 추세 */}
          {trend?.gait?.count > 0 && (
            <div>
              <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">
                보행 추세 ({trend.gait.count}회)
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {trend.gait.cadence.length > 1 && (
                  <TrendChart title="케이던스" unit="SPM" points={trend.gait.cadence} color="#f59e0b" width={320} height={150} />
                )}
                {trend.gait.pelvicDrop.length > 1 && (
                  <TrendChart title="골반 드롭" unit="%" points={trend.gait.pelvicDrop} color="#ef4444" width={320} height={150} />
                )}
                {trend.gait.kneeSym.length > 1 && (
                  <TrendChart title="무릎 대칭" unit="%" points={trend.gait.kneeSym} color="#34d399" width={320} height={150} />
                )}
              </div>
              {trend.gait.cadence.length === 1 && (
                <p className="text-[11px] text-slate-500 mt-1">측정이 1회뿐이라 추세 그래프는 2회차부터 표시됩니다.</p>
              )}
            </div>
          )}

          {/* 자세·체형 회차별 추세 */}
          {postureTrend?.count > 0 && (
            <div>
              <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">
                자세·체형 추세 ({postureTrend.count}회)
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {postureTrend.score.length > 1 && (
                  <TrendChart title="자세 점수" unit="점" points={postureTrend.score} color="#f59e0b" width={320} height={150} />
                )}
                {postureTrend.forwardHead.length > 1 && (
                  <TrendChart title="거북목(전방이동)" unit="mm" points={postureTrend.forwardHead} color="#ef4444" width={320} height={150} />
                )}
                {postureTrend.shoulderDiff.length > 1 && (
                  <TrendChart title="어깨 높이차" unit="mm" points={postureTrend.shoulderDiff} color="#22d3ee" width={320} height={150} />
                )}
                {postureTrend.pelvisDiff.length > 1 && (
                  <TrendChart title="골반 높이차" unit="mm" points={postureTrend.pelvisDiff} color="#a78bfa" width={320} height={150} />
                )}
              </div>
              {postureTrend.score.length === 1 && (
                <p className="text-[11px] text-slate-500 mt-1">측정이 1회뿐이라 추세 그래프는 2회차부터 표시됩니다. 거북목·어깨·골반 편차는 측정할수록 변화가 보입니다.</p>
              )}
            </div>
          )}

          {/* 저장된 자세 리포트 — 회차별 열람 */}
          {savedPostureReports.length > 0 && (
            <div>
              <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">
                자세 측정 리포트 ({savedPostureReports.length}건)
              </p>
              <div className="space-y-2">
                {savedPostureReports.map((rep, i) => {
                  const date = String(rep.createdAt || rep.measuredAt || '').slice(0, 10);
                  const sc = (rep.analysis?.score ?? rep.postureScore);
                  const ba = (rep.analysis?.bodyAge ?? rep.bodyAge);
                  return (
                    <button key={rep.id || i} onClick={() => setPostureViewerIdx(i)}
                      className="w-full flex items-center justify-between bg-slate-800/60 hover:bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 transition-colors text-left">
                      <div>
                        <p className="text-sm font-bold text-white">자세·체형 측정</p>
                        <p className="text-xs text-slate-400">{date}</p>
                      </div>
                      <div className="text-right">
                        {sc != null && <p className="text-sm font-black text-amber-400">{sc}점</p>}
                        {ba != null && <p className="text-[11px] text-slate-400">체형나이 {ba}세</p>}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* 저장된 AI 측정 리포트 — 페이지별 열람 */}
          {savedReports.length > 0 && (
            <div>
              <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">
                측정 리포트 ({savedReports.length}건) · 눌러서 열기
              </p>
              <div className="space-y-2">
                {savedReports.map((rep, i) => {
                  const meta = getSavedReportMeta(rep);
                  const date = String(rep.createdAt || rep.measuredAt || '').slice(0, 10);
                  const main = rep.kind === 'jump'
                    ? (isJumpRsi(rep)
                      ? `RSI ${rep.rsi?.rsi ?? '-'} / 높이 ${rep.heightCm ?? '-'}cm`
                      : `${rep.heightCm ?? '-'}cm / ${rep.peakPower ?? '-'}W`)
                    : (rep.cadence != null || rep.metrics?.cadence != null ? `${rep.cadence ?? rep.metrics?.cadence} SPM` : '-');
                  return (
                    <button key={rep.id || i} onClick={() => setViewerIdx(i)}
                      className="w-full flex items-center justify-between bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 text-left active:scale-[0.99] transition">
                      <div>
                        <p className="text-sm font-bold text-white flex flex-wrap items-center gap-2">
                          <span>{meta.title}</span>
                          <span className={`rounded-full px-2 py-0.5 text-[9px] font-black ${meta.bg} ${meta.color}`}>{meta.badge}</span>
                          <span className="text-slate-500 font-normal">/ {date}</span>
                        </p>
                        <p className="text-[11px] text-slate-500">{rep.valid === false ? '측정 무효' : `주요 결과 ${main}`}</p>
                      </div>
                      <span className="text-amber-400 text-sm font-bold">열기 &gt;</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {report.notes.length > 0 && (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
              <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">분석 설명</p>
              <ul className="space-y-1.5">
                {report.notes.map((n, i) => (
                  <li key={i} className="text-xs text-slate-300 leading-relaxed">· {n}</li>
                ))}
              </ul>
            </div>
          )}

          {/* JPG 다운로드 */}
          <button onClick={handleDownload} disabled={downloading}
            className="btn btn-primary w-full disabled:opacity-50">
            {downloading ? '이미지 생성 중…' : '📷 리포트 JPG 다운로드'}
          </button>
          {msg && <p className="text-center text-xs text-slate-400">{msg}</p>}
        </>
      )}

      {shareCaptureItem && (
        <div
          aria-hidden="true"
          className="fixed top-0 w-[860px] max-w-none overflow-visible bg-slate-950 pointer-events-none"
          style={{ left: '-10000px' }}
        >
          <div ref={shareCaptureRef} className="w-[860px] bg-slate-950">
            <Suspense fallback={<div className="min-h-[1123px] w-[794px] bg-slate-900" />}>
              <ShareCaptureReport item={shareCaptureItem} member={member} />
            </Suspense>
          </div>
        </div>
      )}

      {/* 페이지별 리포트 뷰어 (이전/다음으로 회차 넘김) */}
      {viewerIdx != null && savedReports[viewerIdx] && (
        <div className="fixed inset-0 z-[90] bg-slate-950 overflow-y-auto" style={{ height: '100dvh' }}>
          <div className="sticky top-0 z-10 flex items-center justify-between px-4 py-2.5 bg-slate-900/95 backdrop-blur border-b border-slate-800">
            <button onClick={() => setViewerIdx(null)} className="text-slate-300 font-bold text-sm">✕ 닫기</button>
            <span className="text-white text-xs font-bold">{viewerIdx + 1} / {savedReports.length}</span>
            <div className="flex gap-2">
              <button onClick={() => setViewerIdx(i => Math.min(savedReports.length - 1, i + 1))}
                disabled={viewerIdx >= savedReports.length - 1}
                className="text-slate-300 text-sm font-bold disabled:opacity-30">◀ 이전</button>
              <button onClick={() => setViewerIdx(i => Math.max(0, i - 1))}
                disabled={viewerIdx <= 0}
                className="text-slate-300 text-sm font-bold disabled:opacity-30">다음 ▶</button>
            </div>
          </div>
          <Suspense fallback={<div className="p-10 text-center text-slate-400">불러오는 중…</div>}>
            {savedReports[viewerIdx].kind === 'jump'
              ? <JumpReportDashboard report={savedReports[viewerIdx]} onClose={() => setViewerIdx(null)} />
              : <GaitReportDashboard report={savedReports[viewerIdx]} onClose={() => setViewerIdx(null)} />}
          </Suspense>
        </div>
      )}
      {romViewerIdx != null && savedRomReports[romViewerIdx] && (
        <div className="fixed inset-0 z-[90] bg-slate-950 overflow-y-auto" style={{ height: '100dvh' }}>
          <div className="sticky top-0 z-10 flex items-center justify-between px-4 py-2.5 bg-slate-900/95 backdrop-blur border-b border-slate-800">
            <button onClick={() => setRomViewerIdx(null)} className="text-slate-300 font-bold text-sm">✕ 닫기</button>
            <span className="text-white text-xs font-bold">{romViewerIdx + 1} / {savedRomReports.length}</span>
            <div className="flex gap-2">
              <button onClick={() => setRomViewerIdx(i => Math.min(savedRomReports.length - 1, i + 1))}
                disabled={romViewerIdx >= savedRomReports.length - 1}
                className="text-slate-300 text-sm font-bold disabled:opacity-30">◀ 이전</button>
              <button onClick={() => setRomViewerIdx(i => Math.max(0, i - 1))}
                disabled={romViewerIdx <= 0}
                className="text-slate-300 text-sm font-bold disabled:opacity-30">다음 ▶</button>
            </div>
          </div>
          <Suspense fallback={<div className="p-10 text-center text-slate-400">불러오는 중…</div>}>
            <RomReport report={savedRomReports[romViewerIdx]} member={member} />
          </Suspense>
        </div>
      )}
      {postureViewerIdx != null && savedPostureReports[postureViewerIdx] && (
        <div className="fixed inset-0 z-[90] bg-slate-950 overflow-y-auto" style={{ height: '100dvh' }}>
          <div className="sticky top-0 z-10 flex items-center justify-between px-4 py-2.5 bg-slate-900/95 backdrop-blur border-b border-slate-800">
            <button onClick={() => setPostureViewerIdx(null)} className="text-slate-300 font-bold text-sm">✕ 닫기</button>
            <span className="text-white text-xs font-bold">{postureViewerIdx + 1} / {savedPostureReports.length}</span>
            <div className="flex gap-2">
              <button onClick={() => setPostureViewerIdx(i => Math.min(savedPostureReports.length - 1, i + 1))}
                disabled={postureViewerIdx >= savedPostureReports.length - 1}
                className="text-slate-300 text-sm font-bold disabled:opacity-30">◀ 이전</button>
              <button onClick={() => setPostureViewerIdx(i => Math.max(0, i - 1))}
                disabled={postureViewerIdx <= 0}
                className="text-slate-300 text-sm font-bold disabled:opacity-30">다음 ▶</button>
            </div>
          </div>
          <Suspense fallback={<div className="p-10 text-center text-slate-400">불러오는 중…</div>}>
            <PostureReport
              report={savedPostureReports[postureViewerIdx]}
              member={member}
              heightCm={savedPostureReports[postureViewerIdx]?.heightCm}
              actualAge={savedPostureReports[postureViewerIdx]?.actualAge}
              onClose={() => setPostureViewerIdx(null)}
            />
          </Suspense>
        </div>
      )}
    </div>
  );
}
