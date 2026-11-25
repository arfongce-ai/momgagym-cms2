// ai-measure/core/measureSubtype.js
// ════════════════════════════════════════════════════════════════════════
//  측정 안의 "세부 테스트" 구분 — 단일 소스.
//
//  같은 측정(예: 8번 바벨 리프팅)이라도 1RM 벤치프레스와 VBT 스내치는 측정 위치·
//  데이터·기준이 전혀 다르다. 종합 분석·기간 종합·직전 비교에서 이를 한 덩어리로
//  묶으면 ①최신 1건만 남아 나머지 세부 테스트가 사라지고 ②서로 다른 테스트의 값이
//  한 평균·추이에 섞인다. 모든 곳이 이 함수 하나로 세부 테스트를 나눈다.
//
//  subtypeOf(kind, report) → { key, label }
//   · key   : 같은 세부 테스트끼리만 같은 값('' = 세부 구분 없음)
//   · label : 화면 표시용("VBT · 스내치", "CMJ (반동점프)", "견관절 · 서서" …)
// ════════════════════════════════════════════════════════════════════════
import { JUMP_SUBTYPES } from './jumpTypes';
import { exerciseLabel, normalizeExerciseType } from './lifting';
import { SPRINT_TEST_TYPES } from './sprintTests';
import { CARDIO_MACHINES, CARDIO_PROTOCOLS } from './cardioTest';
import { resolveGaitMode, GAIT_MODE_LABEL } from './gaitMode';
import { SENIOR_TESTS } from './seniorTests';
import { PAPS_TESTS, papsGroupKey } from './papsTests';

const JOINT_KO = { HIP: '고관절', KNEE: '슬관절', SHOULDER: '견관절', ANKLE: '족관절', ELBOW: '주관절' };
const POSE_KO = { STANDING: '서서', SUPINE: '누워서', PRONE: '엎드려', SEATED: '앉아서' };
const ORIENT_KO = { side: '측면', front: '정면', back: '후면' };
const LEG_KO = { left: '왼발', right: '오른발', L: '왼발', R: '오른발' };
const MODE_KO = { vbt: 'VBT', onerm: '1RM' };

const flat = (r) => ((r && typeof r.data === 'object' && r.data && !Array.isArray(r.data)) ? { ...r.data, ...r } : (r || {}));
const NONE = Object.freeze({ key: '', label: '' });

export function subtypeOf(kind, report) {
  const r = flat(report);
  switch (kind) {
    case 'lifting':
    case 'vbt':
    case 'one_rm': {
      const mode = r.mode || (kind === 'one_rm' ? 'onerm' : kind === 'vbt' ? 'vbt' : '');
      const exRaw = r.exerciseType || r.metadata?.exerciseType || '';
      const ex = exRaw ? normalizeExerciseType(exRaw) : '';
      if (!mode && !ex) return NONE;
      // 기간 종합의 vbt/one_rm 유형은 이름에 이미 VBT/1RM 이 있어 종목만 붙인다.
      const parts = kind === 'lifting' ? [MODE_KO[mode] || mode, exerciseLabel(ex)] : [exerciseLabel(ex)];
      return { key: `${mode}:${ex}`, label: parts.filter(Boolean).join(' · ') };
    }
    case 'jump': {
      const st = r.jumpSubType || 'cmj';
      const meta = JUMP_SUBTYPES[st];
      const leg = meta?.singleLeg && r.leg ? r.leg : '';
      return { key: leg ? `${st}:${leg}` : st, label: [meta?.label || st, LEG_KO[leg] || leg].filter(Boolean).join(' · ') };
    }
    case 'sprint':
    case 'agility': {
      const tk = r.testKey || '';
      if (!tk) return NONE;
      return { key: tk, label: SPRINT_TEST_TYPES[tk]?.label || tk };
    }
    case 'rom': {
      const joint = r.joint || r.basic_info?.joint || '';
      const pose = r.poseMode || r.basic_info?.poseMode || '';
      if (!joint) return NONE;
      return { key: `${joint}:${pose}`, label: [JOINT_KO[joint] || joint, POSE_KO[pose] || pose].filter(Boolean).join(' · ') };
    }
    case 'gait': {
      const mode = resolveGaitMode(r.metrics?.cadence ?? r.cadence, r.metrics?.gaitMode) || '';
      const ori = r.orientation || '';
      if (!mode && !ori) return NONE;
      return { key: `${mode}:${ori}`, label: [GAIT_MODE_LABEL[mode], ORIENT_KO[ori] || ori].filter(Boolean).join(' · ') };
    }
    case 'cardio': {
      const m = r.machineId || '';
      const p = r.protocolId || '';
      if (!m && !p) return NONE;
      const pl = CARDIO_PROTOCOLS.find((x) => x.id === p)?.label || p;
      return { key: `${m}:${p}`, label: [CARDIO_MACHINES[m]?.label || m, pl].filter(Boolean).join(' · ') };
    }
    case 'senior': {
      // [시니어 2026-11-24] 30초 의자·5회 의자·TUG 는 서로 다른 테스트라 값을 섞지 않는다.
      const id = r.testId || '';
      if (!id) return NONE;
      return { key: id, label: SENIOR_TESTS[id]?.label || r.testLabel || id };
    }
    case 'paps': {
      // [PAPS 2026-11-25] 테스트(·무릎 방식)마다 따로 비교한다.
      const id = r.testId || '';
      if (!id) return NONE;
      return { key: papsGroupKey(r), label: `${PAPS_TESTS[id]?.label || r.testLabel || id}${r.variant === 'knee' ? ' (무릎)' : ''}` };
    }
    default:
      return NONE;
  }
}

/** 종합 분석 선택 키: 'kind' 또는 'kind|세부키'. */
export function subtypeEntryKey(kind, report) {
  const st = subtypeOf(kind, report);
  return st.key ? `${kind}|${st.key}` : kind;
}

/** 'kind|세부키' → kind */
export function kindOfEntryKey(entryKey) {
  return String(entryKey || '').split('|')[0];
}

/** 같은 세부 테스트인가(직전 비교·종합 묶음용). */
export function sameSubtype(kind, a, b) {
  return subtypeOf(kind, a).key === subtypeOf(kind, b).key;
}

/** 목록을 세부 테스트별 최신 1건으로 줄인다(최신순). */
export function latestPerSubtype(kind, list = []) {
  const t = (x) => Date.parse(x?.createdAt || x?.measuredAt || x?.recordedAt || 0) || 0;
  const map = new Map();
  [...(list || [])].filter(Boolean).sort((a, b) => t(b) - t(a)).forEach((r) => {
    const k = subtypeOf(kind, r).key;
    if (!map.has(k)) map.set(k, r);
  });
  return [...map.values()];
}
