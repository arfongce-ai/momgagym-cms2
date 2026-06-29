import { describe, expect, it } from 'vitest';
import { MEASURE_MENUS } from '../ai-measure/registry';

describe('AI 측정 메뉴 등록', () => {
  it('ROM 측정 메뉴는 실제 컴포넌트와 함께 활성화된다', () => {
    const rom = MEASURE_MENUS.find((menu) => menu.id === 'rom');
    expect(rom).toBeTruthy();
    expect(rom.status).toBe('ready');
    expect(rom.component).toBeTruthy();
  });
});
