import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import RunMechanicsCard from '../ai-measure/menus/RunMechanicsCard.jsx';

describe('RunMechanicsCard 렌더 — 2026-11-23', () => {
  it('구버전 기록(runMechanics 없음, 피드백 없음)이면 아무것도 그리지 않는다', () => {
    expect(renderToString(React.createElement(RunMechanicsCard, { metrics: { cadence: 170 }, orientation: 'side' }))).toBe('');
  });
  it('값과 쉬운 말 피드백, 측정 안 됨 이유를 그린다', () => {
    const metrics = {
      cadence: 170,
      runMechanics: {
        contact: { leftMs: 240, rightMs: 255, avgMs: 248, flightMs: 90, asymmetryPct: 6.1, asymmetryLevel: 'normal', fps: 30, resolutionMs: 33, reason: null },
        overstride: { avgPct: 30, level: 'risk', warnPct: 18, flagPct: 28, reason: null },
        armSwing: { mainRangeDeg: null, elbowAvgDeg: null, reason: '측면 촬영에서만 계산' },
      },
    };
    const html = renderToString(React.createElement(RunMechanicsCard, { metrics, orientation: 'side' }));
    expect(html).toContain('240 / 255');
    expect(html).toContain('쉬운 말 피드백');
    expect(html).toContain('발이 너무 앞에 닿아요');
    expect(html).toContain('측면 촬영에서만 계산');
  });
});
