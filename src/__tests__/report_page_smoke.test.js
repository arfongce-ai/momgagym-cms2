import { describe, expect, it } from 'vitest';
import Report from '../pages/Report';
describe('Report page smoke', () => {
  it('임포트/문법 정상', () => { expect(typeof Report).toBe('function'); });
});
