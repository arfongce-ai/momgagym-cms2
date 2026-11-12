// [가로 허용 2026-11-12] 카메라 판정이 없는 메뉴(1·11·12·13·14)는 세로·가로 모두 허용,
// 카메라 판정 측정은 계속 세로 고정, 스프린트(7)는 기존 가로 그대로인지 소스로 확인한다.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (f) => readFileSync(join(process.cwd(), 'src', f), 'utf8');
const registry = read('ai-measure/registry.js');
const hub = read('ai-measure/AiMeasureHub.jsx');
const tool = read('ai-measure/menus/TimerTool.jsx');

function orientationOf(id) {
  const start = registry.indexOf(`id: '${id}'`);
  const next = registry.indexOf("id: '", start + 5);
  const block = registry.slice(start, next === -1 ? undefined : next);
  const m = block.match(/orientation: '(\w+)'/);
  return m ? m[1] : null;
}

describe('registry.js — 메뉴별 화면 방향', () => {
  it.each(['body', 'compare', 'imaging', 'record', 'timer'])('%s 는 any(세로·가로 모두)', (id) => {
    expect(orientationOf(id)).toBe('any');
  });
  it.each(['posture', 'rom', 'gait', 'jump', 'broadjump', 'lifting', 'stance', 'squat'])('%s 는 세로 고정(표시 없음)', (id) => {
    expect(orientationOf(id)).toBeNull();
  });
  it('sprint 는 기존 가로 유지', () => {
    expect(orientationOf('sprint')).toBe('landscape');
  });
});

describe('AiMeasureHub.jsx — any/landscape 메뉴와 메뉴 목록은 세로 고정을 끈다', () => {
  it('세로 고정은 active 메뉴가 landscape·any 가 아닐 때만', () => {
    expect(hub).toContain("const needsPortrait = Boolean(active) && active.orientation !== 'landscape' && active.orientation !== 'any';");
    expect(hub).toContain('useLockPortrait(needsPortrait)');
  });
  it('초시계는 가로일 때 넓은 2열 폭', () => {
    expect(hub).toContain("active.id === 'timer' ? 'max-w-md landscape:max-w-4xl'");
    expect(tool).toContain('landscape:grid landscape:grid-cols-2');
  });
});
