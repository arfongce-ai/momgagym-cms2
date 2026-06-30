// ai-measure/menus/BarbellLiftingHub.jsx
// ════════════════════════════════════════════════════════════════════════
//  바벨 리프팅 통합 탭 — 세 측정을 한 메뉴에서 유기적으로.
//   mode='lifting' → LiftingMeasure   (역도 · 바벨 엔드캡 궤적 추적)
//   mode='vbt'     → VbtMeasure       (속도 기반 트레이닝)
//   mode='onerm'   → OneRMEstimate    (1RM 추정 · Velocity-Load 대시보드)
//
//  설계(측정 정직성 · 근거기반):
//   - 상단에 [역도/VBT/1RM] 모드 선택기 + 공통 [종목] 선택기를 오버레이로 둠.
//   - 저장은 Hub 가 단일 책임으로 처리: 각 모듈의 onSave 페이로드를 표준
//     exerciseType + source + metrics 규약(buildLiftingPayload)으로 변환.
//   - peakVelocity 는 lifting.js 의 게이트로 고속영상에서만 채워진다.
//   - 별도 컬렉션을 새로 파지 않고 기존 'ai' + unifiedReport 흐름을 그대로 사용
//     (점프/보행/자세/ROM 과 동일) — 통합 리포트·카카오 공유·이력에 자연 합류.
//   - JumpAnalysisHub 패턴을 그대로 따른다(검증된 구조 재사용).
// ════════════════════════════════════════════════════════════════════════
import React, { useState, useCallback, useMemo } from 'react';
import LiftingMeasure from './LiftingMeasure';
import VbtMeasure from './VbtMeasure';
import OneRMEstimate from './OneRMEstimate';
import {
  exercisesForMode, exerciseLabel, lift1rmToExercise,
  vbtConfidence, estimateMeanPower, buildLiftingPayload,
} from '../core/lifting';

const MODES = [
  ['lifting', '🏋️ 역도'],
  ['vbt',     '⚡ VBT'],
  ['onerm',   '💪 1RM'],
];

export default function BarbellLiftingHub({ member, onBack, onSave, onSaveToFirebase, onMemberHeightChange }) {
  const save = onSaveToFirebase || onSave;
  const [mode, setMode] = useState('lifting');
  // 공통 종목 — 모드 전환 시 해당 모드에서 유효하면 유지, 아니면 첫 항목으로.
  const [exerciseType, setExerciseType] = useState('squat');
  const [showGuide, setShowGuide] = useState(false);

  const modeExercises = useMemo(() => exercisesForMode(mode), [mode]);

  const switchMode = useCallback((next) => {
    setMode(next);
    const valid = exercisesForMode(next).some(e => e.key === exerciseType);
    if (!valid) setExerciseType(exercisesForMode(next)[0]?.key || 'squat');
  }, [exerciseType]);

  // ── 저장 래퍼: 각 모듈의 raw 페이로드 → 표준 페이로드로 변환 후 상위 저장 ──
  const handleSaveLifting = useCallback(async (raw) => {
    // LiftingMeasure raw: { type:'lifting', romRatio, romCm, durationSec,
    //                       meanVelocity, heightCm, weight, barKg, sidePlates, source? }
    const source = raw?.source || 'live';
    const conf = vbtConfidence({
      isCalibrated: !!raw?.heightCm,
      lostRatio: raw?.lostRatio,
      durationSec: raw?.durationSec,
      source,
      romCm: raw?.romCm,
    });
    const payload = buildLiftingPayload({
      mode: 'lifting',
      exerciseType,
      source,
      metrics: {
        meanVelocity: raw?.meanVelocity ?? null,
        peakVelocity: raw?.peakVelocity ?? null,       // 고속영상 모듈만 채움
        peakReason: raw?.peakReason ?? (source === 'upload' ? 'ok' : 'live_fps_too_low'),
        rangeOfMotion: raw?.romCm ?? null,
        meanPower: estimateMeanPower(raw?.weight, raw?.meanVelocity),
        confidenceScore: conf.score,
      },
      metadata: {
        weight: raw?.weight ?? null,
        isCalibrated: !!raw?.heightCm,
        heightCm: raw?.heightCm ?? null,
        barKg: raw?.barKg ?? null,
        sidePlates: raw?.sidePlates ?? null,
        confidenceReasons: conf.reasons,
      },
      extra: { romRatio: raw?.romRatio ?? null, durationSec: raw?.durationSec ?? null },
    });
    return save?.(payload);
  }, [exerciseType, save]);

  const handleSaveVbt = useCallback(async (raw) => {
    // VbtMeasure raw: { type:'vbt', distance, time, meanVelocity, zone,
    //                   heightCm, weight, barKg, sidePlates, source? }
    const source = raw?.source || 'live';
    const conf = vbtConfidence({
      isCalibrated: !!raw?.heightCm,
      lostRatio: raw?.lostRatio,
      durationSec: raw?.time,
      source,
      romCm: raw?.romCm,
    });
    const payload = buildLiftingPayload({
      mode: 'vbt',
      exerciseType,
      source,
      metrics: {
        meanVelocity: raw?.meanVelocity ?? null,
        peakVelocity: raw?.peakVelocity ?? null,
        peakReason: raw?.peakReason ?? (source === 'upload' ? 'ok' : 'live_fps_too_low'),
        rangeOfMotion: raw?.romCm ?? null,
        meanPower: estimateMeanPower(raw?.weight, raw?.meanVelocity),
        confidenceScore: conf.score,
      },
      metadata: {
        weight: raw?.weight ?? null,
        isCalibrated: !!raw?.heightCm,
        heightCm: raw?.heightCm ?? null,
        zone: raw?.zone ?? null,
        distanceM: raw?.distance ?? null,
        timeSec: raw?.time ?? null,
        barKg: raw?.barKg ?? null,
        sidePlates: raw?.sidePlates ?? null,
        confidenceReasons: conf.reasons,
      },
    });
    return save?.(payload);
  }, [exerciseType, save]);

  const handleSaveOneRm = useCallback(async (raw) => {
    // OneRMEstimate raw: { lift, liftLabel, weight, reps, oneRM, epley, brzycki,
    //                      barKg, sidePlates, weightSource }
    // 1RM은 내부 lift('bench')를 표준 exerciseType('bench_press')로 매핑해 저장.
    const exType = lift1rmToExercise(raw?.lift) || exerciseType;
    const payload = buildLiftingPayload({
      mode: 'onerm',
      exerciseType: exType,
      source: 'manual',  // 1RM은 무게·반복 입력 기반(영상 보조). 항상 manual 산출.
      metrics: {
        oneRM: raw?.oneRM ?? null,
        confidenceScore: raw?.reps >= 1 && raw?.reps <= 10 ? 0.9 : 0.6, // 1~10회 고신뢰
      },
      metadata: {
        weight: raw?.weight ?? null,
        isCalibrated: raw?.weightSource === 'manual', // 직접 입력이 가장 확실
        reps: raw?.reps ?? null,
        weightSource: raw?.weightSource ?? null,
        barKg: raw?.barKg ?? null,
        sidePlates: raw?.sidePlates ?? null,
      },
      extra: {
        epley: raw?.epley ?? null,
        brzycki: raw?.brzycki ?? null,
        formulas: raw?.formulas ?? null,
      },
    });
    return save?.(payload);
  }, [exerciseType, save]);

  return (
    <div className="fixed inset-0 z-[80] bg-slate-950" style={{ height: '100dvh' }}>
      {/* ── 상단 모드·종목 선택기(오버레이) ── */}
      <div className="absolute top-[max(8px,calc(env(safe-area-inset-top)+8px))] inset-x-0 z-[86] flex flex-col items-center gap-1.5 px-3 pointer-events-none">
        {/* 모드 선택 */}
        <div className="pointer-events-auto flex gap-1 rounded-full bg-black/55 backdrop-blur p-1 border border-white/10 shadow-lg">
          {MODES.map(([k, label]) => (
            <button key={k} onClick={() => switchMode(k)}
              className={`rounded-full px-3.5 py-1 text-xs font-black transition-colors ${
                mode === k ? 'bg-amber-500 text-slate-950' : 'text-slate-300'}`}>
              {label}
            </button>
          ))}
        </div>
        {/* 종목 선택 + 도움말 */}
        <div className="flex items-center gap-2">
          <div className="pointer-events-auto flex gap-1 rounded-full bg-black/55 backdrop-blur p-1 border border-white/10 shadow-lg">
            {modeExercises.map(e => (
              <button key={e.key} onClick={() => setExerciseType(e.key)}
                className={`rounded-full px-3 py-1 text-[11px] font-black transition-colors ${
                  exerciseType === e.key ? 'bg-emerald-500 text-slate-950' : 'text-slate-300'}`}>
                {e.label}
              </button>
            ))}
          </div>
          <button onClick={() => setShowGuide(true)}
            className="pointer-events-auto h-8 w-8 shrink-0 rounded-full bg-black/55 backdrop-blur border border-white/10 text-white font-black shadow-lg">
            ⓘ
          </button>
        </div>
        <p className="pointer-events-none text-[10px] font-bold text-amber-300 bg-black/55 backdrop-blur rounded-full px-3 py-0.5 border border-amber-500/30">
          {mode === 'onerm'
            ? '무게·반복 입력 기반 추정 · 1~10회에서 가장 정확'
            : mode === 'vbt'
              ? '측면 촬영 권장 · 1렙씩 · 고속영상(120/240fps)이면 최고속도까지 산출'
              : '측면 촬영 권장 · 바벨 끝/원판 2~3점 지정 · 신장 기준 cm 환산'}
        </p>
      </div>

      {showGuide && <LiftingGuide mode={mode} onClose={() => setShowGuide(false)} />}

      {/* ── 측정 모드 본체(검증된 기존 모듈 재사용) ── */}
      {mode === 'lifting' && (
        <LiftingMeasure member={member} onBack={onBack} onSave={handleSaveLifting}
          onMemberHeightChange={onMemberHeightChange}
          exerciseType={exerciseType} embedded />
      )}
      {mode === 'vbt' && (
        <VbtMeasure member={member} onBack={onBack} onSave={handleSaveVbt}
          onMemberHeightChange={onMemberHeightChange}
          exerciseType={exerciseType} embedded />
      )}
      {mode === 'onerm' && (
        <OneRMEstimate member={member} onBack={onBack} onSave={handleSaveOneRm}
          exerciseType={exerciseType} embedded />
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
//  측정 방법 안내 (가이드 시트)
// ════════════════════════════════════════════════════════════════════════
function LiftingGuide({ mode, onClose }) {
  return (
    <div className="fixed inset-0 z-[90] bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center"
      onClick={onClose}>
      <div className="w-full sm:max-w-md max-h-[85dvh] overflow-y-auto bg-slate-900 border-t sm:border border-slate-700 rounded-t-3xl sm:rounded-3xl p-5 space-y-4"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-white font-black text-lg">바벨 리프팅 측정 방법</h3>
          <button onClick={onClose} className="text-slate-400 font-bold text-sm">닫기 ✕</button>
        </div>

        <div className="grid grid-cols-3 gap-2">
          {[['lifting', '🏋️ 역도', '바벨 끝 궤적·수직 변위'], ['vbt', '⚡ VBT', '속도 기반 존 판정'], ['onerm', '💪 1RM', '무게·반복 → 최대근력']].map(([k, t, d]) => (
            <div key={k} className={`rounded-xl p-2.5 border ${mode === k ? 'bg-amber-500/10 border-amber-500/40' : 'bg-slate-800/60 border-slate-700'}`}>
              <p className="text-white font-bold text-[11px] mb-0.5">{t}</p>
              <p className="text-slate-300 text-[10px] leading-snug">{d}</p>
            </div>
          ))}
        </div>

        {mode === 'onerm' ? (
          <GuideSection title="1RM 추정" emoji="💪" highlight>
            무게와 반복 횟수를 입력하면 검증된 7개 공식(Epley·Brzycki 등)의 평균으로
            최대 1회 무게를 추정합니다. <b className="text-white">무게 직접 입력이 가장 확실</b>하며,
            원판 색 인식은 보조입니다. <b className="text-white">1~10회에서 정확도가 가장 높습니다.</b>
            수집된 무게-속도(Velocity-Load) 데이터가 쌓이면 대시보드로 추세를 봅니다.
          </GuideSection>
        ) : (
          <>
            <GuideSection title="바벨 추적 촬영" emoji="📹" highlight>
              <b className="text-white">옆에서 전신이 보이게</b> 삼각대로 고정 촬영하세요. 카메라를 켜면
              전체 화면으로 전환되고, <b className="text-white">바벨 끝·원판 등 잘 보이는 곳을 2~3군데
              눌러</b> 추적점을 지정합니다. 한 점이 가려지거나 튀어도 나머지 점이 보완해 오차를 줄입니다.
              키를 입력하면 화면비율→cm 환산과 속도 정확도가 올라갑니다(신장 기준 정규화).
            </GuideSection>
            <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-3">
              <p className="text-emerald-300 text-xs font-bold mb-1">⏱ 고속영상과 최고속도</p>
              <p className="text-slate-300 text-[11px] leading-relaxed">
                실시간(보통 30fps)에서는 <b className="text-white">평균속도</b>만 신뢰할 수 있습니다.
                순간 <b className="text-white">최고속도(peak)는 120/240fps 고속영상</b>에서만 산출되며,
                그 외에는 정확도를 위해 표시하지 않습니다(근거기반 정직성).
              </p>
            </div>
          </>
        )}

        <p className="text-[11px] text-slate-500 leading-relaxed">
          ※ 카메라 한 대 추정은 전용 엔코더/포스플레이트보다 정밀하진 않으며, 동일 조건에서의
          <b className="text-slate-300"> 추세 파악</b>에 적합합니다. 신뢰도 점수가 낮게 표시되면
          조명·각도·키 입력·촬영 방향을 점검하세요.
        </p>
      </div>
    </div>
  );
}

function GuideSection({ title, emoji, highlight, children }) {
  return (
    <div className={`rounded-xl p-3 ${highlight ? 'bg-amber-500/10 border border-amber-500/25' : 'bg-slate-800/60'}`}>
      <p className="text-white font-bold text-sm mb-1">{emoji} {title}</p>
      <p className="text-slate-300 text-[11px] leading-relaxed">{children}</p>
    </div>
  );
}
