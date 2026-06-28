// ai-measure/core/romClinical.js
// ════════════════════════════════════════════════════════════════════════
//  [출력 요구 3] ROM 측정 수치 → 리포트용 'AI 자동 진단 코멘트 엔진'.
//  측정 정직성 원칙: 데이터가 불충분/모호하면 단정적 진단 대신 "측정 보완 필요"를
//  명확히 안내한다. 절대 그럴듯한 가짜 결론을 내지 않는다.
//
//  입력: bodyMechanics 의 RomAccumulator.summary() 결과 + 자세/관절 메타.
//  출력: { grade, headline, details[], flags[] }
// ════════════════════════════════════════════════════════════════════════

import { ROM_NORMS } from './bodyMechanics';

const JOINT_KO = { HIP: '고관절', KNEE: '슬관절', SHOULDER: '견관절', ANKLE: '족관절' };
const POSE_KO = { STANDING: '서서(체중지지)', SUPINE: '누워서(앙와위)', PRONE: '엎드려(복와위)', SEATED: '앉아서' };

// 자세·관절 정상치(평균)에서 핵심 동작(첫 키)의 normal/min/max 를 꺼낸다.
function normFor(joint, poseMode) {
  const spec = ROM_NORMS[joint]?.[poseMode];
  if (!spec) return null;
  const motionKey = Object.keys(spec)[0];
  return { motionKey, ...spec[motionKey] };
}

export function generateRomDiagnosis(summary, { joint, poseMode } = {}) {
  const jointName = JOINT_KO[joint] || joint;
  const poseName = POSE_KO[poseMode] || poseMode;
  const norm = normFor(joint, poseMode);
  const details = [];
  const flags = [];

  const L = summary?.left_max_rom;
  const R = summary?.right_max_rom;
  const sym = summary?.symmetry_index_score;
  const stab = summary?.end_range_stability_score || {};
  const comp = summary?.compensation || {};

  // ── 측정 정직성 가드: 데이터 자체가 빈약하면 진단을 보류 ──
  if (!summary || summary.valid === false || (L == null && R == null)) {
    return {
      grade: 'insufficient',
      headline: '측정 데이터가 부족해 진단을 보류합니다.',
      details: ['전신(특히 측정 관절)이 화면에 안정적으로 잡히도록 다시 촬영해 주세요.'],
      flags: ['insufficient_data'],
    };
  }

  // ── 1) 좌우 절대 가동범위 평가 (자세별 정상치 대비) ──
  if (norm) {
    for (const [sideKo, val] of [['좌', L], ['우', R]]) {
      if (val == null) {
        details.push(`${sideKo}측 ${jointName} 각도를 신뢰 구간 안에서 산출하지 못했습니다(가림/흔들림 가능).`);
        continue;
      }
      if (val < norm.min) {
        details.push(`${sideKo}측 ${jointName} 가동범위 ${val}°로 정상 하한(${norm.min}°)보다 제한적입니다 — 가동성 제한 의심.`);
        flags.push(`${sideKo === '좌' ? 'left' : 'right'}_restricted`);
      } else if (val > norm.max) {
        details.push(`${sideKo}측 ${jointName} ${val}°로 정상 상한(${norm.max}°)을 초과 — 과가동성(hypermobility) 또는 보상 동작 확인.`);
        flags.push(`${sideKo === '좌' ? 'left' : 'right'}_hypermobile`);
      } else {
        details.push(`${sideKo}측 ${jointName} ${val}°로 정상 범위(${norm.min}~${norm.max}°) 안에 있습니다.`);
      }
    }
  }

  // ── 2) 좌우 대칭성 ──
  if (sym != null) {
    if (sym >= 15) {
      const weaker = (L ?? 0) < (R ?? 0) ? '좌' : '우';
      details.push(`좌우 비대칭 ${sym}% — ${weaker}측이 더 제한적입니다. 편측 보상·근막 단축을 확인하세요.`);
      flags.push('asymmetry');
    } else if (sym >= 8) {
      details.push(`좌우 차이 ${sym}%로 경미한 비대칭이 관찰됩니다(추적 관찰 권장).`);
    } else {
      details.push(`좌우 대칭성 양호(${sym}% 차이).`);
    }
  }

  // ── 3) 끝범위 안정성(등척성 잔떨림) — SUPINE/PRONE 에서 특히 의미 ──
  const stabVals = [stab.left, stab.right].filter((v) => v != null);
  if (stabVals.length) {
    const minStab = Math.min(...stabVals);
    if (minStab < 55) {
      details.push(`동작 끝범위에서 잔떨림이 큽니다(안정성 ${minStab}점) — 신경근 조절·종말 제어 훈련이 필요합니다.`);
      flags.push('end_range_instability');
    } else if (minStab >= 80) {
      details.push(`끝범위 안정성 우수(${minStab}점) — 종말 위치 제어가 견고합니다.`);
    }
  }

  // ── 4) 보상 작용 (STANDING 의 골반 불균형 / 체간 기울기) ──
  if (poseMode === 'STANDING') {
    const compMax = Math.max(Math.abs(comp.left ?? 0), Math.abs(comp.right ?? 0));
    if (joint === 'HIP' || joint === 'KNEE') {
      if (compMax >= 8) {
        details.push(`동작 중 골반 불균형(pelvic drop ${compMax}%)이 감지되어 가동범위 수치에 보상이 섞였을 수 있습니다.`);
        flags.push('pelvic_compensation');
      }
    } else if (joint === 'SHOULDER') {
      if (compMax >= 7) {
        details.push(`팔을 들 때 체간 측방 기울기(${compMax}°) 보상이 동반됩니다 — 순수 견관절 가동범위는 다소 과대평가될 수 있습니다.`);
        flags.push('trunk_compensation');
      }
    }
  } else {
    details.push(`${poseName} 측정이라 보상 작용을 지면 지지로 통제한 '순수 구조적 가동범위'에 가깝습니다.`);
  }

  // ── 종합 등급 ──
  let grade = 'good';
  if (flags.includes('left_restricted') || flags.includes('right_restricted') || flags.includes('asymmetry')) {
    grade = 'attention';
  }
  if (
    (flags.includes('left_restricted') && flags.includes('right_restricted')) ||
    flags.includes('end_range_instability')
  ) {
    grade = 'focus';
  }

  const gradeKo = { good: '양호', attention: '관리 필요', focus: '집중 관리', insufficient: '측정 보완' }[grade];
  const headline = `${poseName} ${jointName} 가동범위 종합 평가: ${gradeKo}.`;

  return { grade, headline, details, flags };
}
