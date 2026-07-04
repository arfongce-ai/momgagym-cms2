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

  // ── 3) [항목 5] 끝범위(end-range) 안정성 — 측정이 불확실하여 진단에서 제외한다.
  //    (2D 추정 좌표의 종말 잔떨림은 신뢰도가 낮아, 그럴듯한 오진을 만들 수 있음)

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

  // ── 4-b) [보상 프로파일] 시작 자세 기준선 대비 다축 보상 (전 자세모드 공통) ──
  //  · 체간 기울기: 동작 중 몸통이 기준선에서 기울며 가동범위를 보태는 패턴.
  //  · 회전(비틀기): 측정면을 벗어나 몸통을 돌리는 패턴 — 각도 자체의 신뢰도를
  //    떨어뜨리므로(측정면 이탈) 임계 초과 시 재측정 권고까지 붙인다.
  const profile = summary?.compensation_profile || null;
  if (profile) {
    const leanDev = profile.lean_max_dev_deg;
    if (leanDev != null && leanDev >= 8) {
      const severe = leanDev >= 15;
      details.push(`동작 중 체간이 시작 자세 대비 최대 ${leanDev}° 기울었습니다 — ${severe ? '기울기 보상이 커 가동범위가 과대평가되었을 가능성이 높습니다.' : '체간 고정(코어 안정화) 후 재측정하면 순수 관절 가동범위에 가까워집니다.'}`);
      flags.push(severe ? 'trunk_lean_severe' : 'trunk_lean_compensation');
    }
    const rot = profile.rotation_max_pct;
    if (rot != null && rot >= 12) {
      const severe = rot >= 25;
      details.push(`몸통 회전(비틀기) 보상이 감지되었습니다(측정면 이탈 ${rot}%) — ${severe ? '측정면을 크게 벗어나 각도 신뢰도가 낮습니다. 몸통을 고정하고 재측정을 권장합니다.' : '동작 중 몸통이 살짝 돌아갑니다. 회전을 억제하면 좌우 비교가 더 정확해집니다.'}`);
      flags.push(severe ? 'trunk_rotation_severe' : 'trunk_rotation_compensation');
    }
  }

  // ── 종합 등급 ──
  let grade = 'good';
  if (
    flags.includes('left_restricted') || flags.includes('right_restricted') || flags.includes('asymmetry')
    || flags.includes('trunk_lean_severe') || flags.includes('trunk_rotation_severe')
  ) {
    grade = 'attention';
  }
  if (
    flags.includes('left_restricted') && flags.includes('right_restricted')
  ) {
    grade = 'focus';
  }

  const gradeKo = { good: '양호', attention: '관리 필요', focus: '집중 관리', insufficient: '측정 보완' }[grade];
  const headline = `${poseName} ${jointName} 가동범위 종합 평가: ${gradeKo}.`;

  return { grade, headline, details, flags };
}
