// aiService.js — AI 측정 세션 데이터 서비스
// AiSession = { id, memberId, recordedAt, measurements, analysisResult, memo }
//
// 원본 Spec [6][7]:
//   - 측정값 + AI 리포트를 단일 AiSession 객체로 병합 저장
//   - 예외 처리: try-catch 완비
//   - 리포트 데이터는 로컬 저장 (클라우드 비디오 업로드는 2차 개발)

import { aiStore } from '../demoData';

// ── 분석 엔진 (Demo: 규칙 기반 시뮬레이션) ─────────────────
// 실제 배포 시 MediaPipe / Web Worker로 교체
export function analyzeBody(measurements) {
  const { weight, systolic, diastolic, height } = measurements;
  const results = [];

  try {
    // BMI 계산
    if (weight && height) {
      const bmi = weight / ((height / 100) ** 2);
      const bmiStatus =
        bmi < 18.5 ? { status:'저체중', color:'blue',  grade:'warn' } :
        bmi < 23   ? { status:'정상',   color:'green', grade:'good' } :
        bmi < 25   ? { status:'과체중', color:'yellow',grade:'warn' } :
                     { status:'비만',   color:'red',   grade:'bad'  };
      results.push({
        key:   'bmi',
        label: 'BMI 체질량지수',
        value: bmi.toFixed(1),
        unit:  '',
        ...bmiStatus,
        description: `키 ${height}cm / 몸무게 ${weight}kg 기준`,
      });
    }

    // 혈압 분석 — 「대한고혈압학회 고혈압 진료지침 2026」(6차 개정) 기준
    //  · 고혈압 진단 기준: 140/90 mmHg 이상 (기존 유지)
    //  · 이완기단독고혈압(IDH) 신설: 수축기<140 이면서 이완기≥90
    //    → 젊은 층에 흔하며 표적장기 손상·심혈관 위험과 관련, 별도 관리 강조
    //  · 주의(주의혈압/고혈압전단계): 120~139 / 80~89
    if (systolic != null || diastolic != null) {
      const sys = systolic  != null ? Number(systolic)  : null;
      const dia = diastolic != null ? Number(diastolic) : null;

      let bpStatus, description;
      const isHTN  = (sys != null && sys >= 140) || (dia != null && dia >= 90); // 고혈압
      const isIDH  = (sys == null || sys < 140) && (dia != null && dia >= 90);  // 이완기단독고혈압
      const isElev = !isHTN && ((sys != null && sys >= 120) || (dia != null && dia >= 80)); // 주의

      if (isIDH) {
        // 수축기 정상 + 이완기만 높음 → IDH (2026 신설 분류)
        bpStatus    = { status:'이완기단독고혈압(IDH)', color:'red', grade:'bad' };
        description = '수축기는 정상이나 이완기 혈압이 높습니다. 젊은 층에 흔하며 조기 관리가 필요합니다(2026 지침 신설 분류).';
      } else if (isHTN) {
        bpStatus    = { status:'고혈압', color:'red', grade:'bad' };
        description = '고혈압 범위(140/90 이상)입니다. 의료기관 상담을 권장합니다.';
      } else if (isElev) {
        bpStatus    = { status:'주의', color:'yellow', grade:'warn' };
        description = '주의 범위(120~139 / 80~89)입니다. 생활습관 관리가 필요합니다.';
      } else {
        bpStatus    = { status:'정상', color:'green', grade:'good' };
        description = '정상 혈압 범위입니다(120/80 미만).';
      }

      const valueStr = (sys != null ? sys : '-') + ' / ' + (dia != null ? dia : '-');
      results.push({
        key:   'bloodPressure',
        label: '혈압 (최고/최저)',
        value: valueStr,
        unit:  'mmHg',
        ...bpStatus,
        description,
      });
    }

    // 종합 의견
    const badCount  = results.filter(r => r.grade === 'bad').length;
    const warnCount = results.filter(r => r.grade === 'warn').length;
    const summary =
      badCount >= 2   ? '집중 관리가 필요한 상태입니다. 전문 트레이너 상담을 권장합니다.' :
      badCount === 1  ? '일부 지표 개선이 필요합니다. 식이 조절과 운동 병행을 추천합니다.' :
      warnCount >= 1  ? '전반적으로 양호하나 경계 지표가 있습니다. 꾸준한 관리가 필요합니다.' :
                        '모든 측정 지표가 건강한 범위 내에 있습니다. 현재 루틴을 유지하세요!';

    return { items: results, summary, analyzedAt: new Date().toISOString() };
  } catch (err) {
    console.error('[analyzeBody] 분석 오류:', err);
    return {
      items:      [],
      summary:    '분석 중 오류가 발생했습니다. 측정값을 확인해 주세요.',
      analyzedAt: new Date().toISOString(),
      error:      true,
    };
  }
}

// ── 변화율 계산 ───────────────────────────────────────────
export function calcChanges(current, previous) {
  if (!previous) return {};
  const changes = {};
  const fields  = ['weight', 'systolic', 'diastolic'];
  fields.forEach(f => {
    const cur = Number(current[f]);
    const prv = Number(previous[f]);
    if (!isNaN(cur) && !isNaN(prv) && prv !== 0) {
      const diff = cur - prv;
      changes[f] = {
        diff:  diff,
        diffStr: (diff >= 0 ? '+' : '') + diff.toFixed(1),
        trend: diff > 0 ? 'up' : diff < 0 ? 'down' : 'same',
      };
    }
  });
  return changes;
}

// ── AiSession 생성 및 저장 (원자적 try-catch) ────────────
export async function createAiSession(memberId, measurements, memo = '') {
  try {
    // 측정값 유효성 검사
    if (!memberId) throw new Error('memberId가 필요합니다.');
    if (!measurements.weight) throw new Error('체중은 필수 입력값입니다.');

    // AI 분석 실행
    const analysisResult = analyzeBody(measurements);

    // AiSession 객체 병합
    const session = {
      memberId,
      recordedAt:     new Date().toISOString().slice(0, 10),
      recordedAtFull: new Date().toISOString(),
      measurements:   { ...measurements },
      analysisResult,
      memo,
    };

    // 저장 (실패 시 예외 전파)
    const saved = aiStore.addSession(memberId, session);
    if (!saved) throw new Error('저장에 실패했습니다.');

    return { success: true, session: saved };
  } catch (err) {
    console.error('[createAiSession]', err);
    return { success: false, error: err.message };
  }
}

// ── 이력 조회 ─────────────────────────────────────────────
export function getAiSessions(memberId) {
  try {
    return aiStore.getSessions(memberId)
      .sort((a, b) => b.recordedAtFull?.localeCompare(a.recordedAtFull || ''));
  } catch (err) {
    console.error('[getAiSessions]', err);
    return [];
  }
}

// ── 삭제 ─────────────────────────────────────────────────
export function deleteAiSession(memberId, sessionId) {
  try {
    aiStore.deleteSession(memberId, sessionId);
    return { success: true };
  } catch (err) {
    console.error('[deleteAiSession]', err);
    return { success: false, error: err.message };
  }
}

// ── 리포트 텍스트 생성 (상담 메모 복사용) ─────────────────
export function generateReportText(session) {
  try {
    const { measurements: m, analysisResult: r, recordedAt } = session;
    const lines = [
      `📋 몸가짐운동센터 체성분 리포트 (${recordedAt})`,
      ``,
      `[측정값]`,
      m.height    ? `· 키: ${m.height}cm`              : '',
      m.weight    ? `· 몸무게: ${m.weight}kg`          : '',
      m.systolic  ? `· 최고혈압: ${m.systolic}mmHg`    : '',
      m.diastolic ? `· 최저혈압: ${m.diastolic}mmHg`   : '',
      ``,
      `[분석 결과]`,
      ...(r.items || []).map(i => `· ${i.label}: ${i.value}${i.unit} (${i.status || ''})`),
      ``,
      `[종합 의견]`,
      r.summary || '',
      session.memo ? `\n[트레이너 메모]\n${session.memo}` : '',
    ];
    return lines.filter(l => l !== '').join('\n');
  } catch (err) {
    return '리포트 생성 중 오류가 발생했습니다.';
  }
}
