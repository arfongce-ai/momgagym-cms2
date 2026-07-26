import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const read = (relPath) => fs.readFileSync(path.resolve(__dirname, '..', relPath), 'utf-8');

// 결과리포트(A4 카드)는 회원에게 카카오톡으로 그대로 공유될 수 있으므로,
// 전문가만 알아볼 수 있는 축약어·영어 용어가 라벨/제목에 남아있으면 안 된다.
// (측정값 자체나 계산 로직이 아니라 "사람이 읽는 문구"만 검증한다.)
describe('결과리포트 — 일반인이 읽기 어려운 라벨 회귀 가드', () => {
  it('PostureReport: Roll/Pitch/Yaw, deg 단위, Rule-based 문구가 없다', () => {
    const src = read('ai-measure/menus/PostureReport.jsx');
    expect(src).not.toMatch(/label="Roll"|label="Pitch"|label="Yaw"/);
    expect(src).not.toMatch(/unit="deg"/);
    expect(src).not.toContain('Rule-based 평가');
    expect(src).not.toContain('ASI 평균');
  });

  it('GaitReportDashboard: 케이던스(SPM)/입각기·유각기, 영문 부제가 없다', () => {
    const src = read('ai-measure/menus/GaitReportDashboard.jsx');
    expect(src).not.toContain('label="케이던스"');
    expect(src).not.toContain('unit="SPM"');
    expect(src).not.toContain('입각기 / 유각기');
    expect(src).not.toMatch(/subtitle="Kinematic|subtitle="Symmetry|subtitle="Spatial|subtitle="Feedback/);
  });

  it('postureMath.js findings 문구에 "편측 보상 패턴" 같은 임상 표현이 없다', () => {
    const src = read('ai-measure/core/postureMath.js');
    expect(src).not.toContain('편측 보상 패턴');
    expect(src).not.toContain('체중지지 균형 훈련');
  });
});
