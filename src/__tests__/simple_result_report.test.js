import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const read = (relPath) => fs.readFileSync(path.resolve(__dirname, '..', relPath), 'utf-8');

// 쉬운 버전 리포트(회원 공유용)는 report_plain_language.test.js보다 한 단계 더
// 쉬운 말을 목표로 한다 — 전문용어는 물론, "친구야" 같은 어린이 전용 말투도
// 없어야 한다(회원 중에는 재활·노인 회원도 있어서 "쉬운 말"이지 "아동용 말투"가
// 아니어야 함, SimpleResultReport.jsx 상단 주석 참고).
describe('쉬운 버전 결과리포트(SimpleResultReport) — 문구 회귀 가드', () => {
  it('전문용어·영문 축약어(CoG/BoS/RSI/Roll/Pitch/Yaw/deg)가 화면 문구에 없다', () => {
    const src = read('components/report/SimpleResultReport.jsx');
    expect(src).not.toMatch(/\bCoG\b|\bBoS\b|\bRSI\b|\bRoll\b|\bPitch\b|\bYaw\b/);
    expect(src).not.toContain('deg');
    expect(src).not.toContain('PROBLEM FOCUS');
  });

  it('"위험" 같은 단정적·경고성 단어 대신 행동 유도형 문구를 쓴다', () => {
    const src = read('components/report/SimpleResultReport.jsx');
    expect(src).not.toContain('"위험"');
    expect(src).not.toContain('위험해요');
  });

  it('나이 무관하게 쓸 수 있도록 이름+"님" 호칭을 쓰고 아동 전용 말투는 쓰지 않는다', () => {
    const src = read('components/report/SimpleResultReport.jsx');
    expect(src).toContain('님의');
    expect(src).not.toContain('친구야');
    expect(src).not.toContain('어린이 여러분');
  });

  it('기존 A4 캡처 파이프라인과 호환되도록 UnifiedReportPage/Canvas를 사용한다', () => {
    const src = read('components/report/SimpleResultReport.jsx');
    expect(src).toContain("import { UnifiedReportCanvas, UnifiedReportPage } from './UnifiedReportPrimitives'");
    expect(src).toContain('<UnifiedReportPage');
  });

  it('요약 데이터가 없으면 아무것도 렌더링하지 않는다(측정 정직성 원칙)', () => {
    const src = read('components/report/SimpleResultReport.jsx');
    expect(src).toContain('if (!summary) return null;');
  });
});
