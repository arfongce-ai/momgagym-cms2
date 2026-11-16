import { describe, it, expect } from 'vitest';
import fs from 'fs';
import { ANIM_MUSCLES, muscleAnimSrc, MUSCLE_ATLAS, REGION_ATLAS, atlasForRegions, muscleImageSrc } from '../ai-measure/core/muscleAtlas';

describe('근육 도감', () => {
  it('47개 근육, 번호 1~47', () => {
    expect(MUSCLE_ATLAS).toHaveLength(47);
    expect(MUSCLE_ATLAS.map((m) => m.no)).toEqual(Array.from({ length: 47 }, (_, i) => i + 1));
  });
  it('모든 근육의 긴장·약화 그림 파일이 있다', () => {
    MUSCLE_ATLAS.forEach((m) => {
      ['tight', 'weak'].forEach((k) => {
        expect(fs.existsSync(`public${muscleImageSrc(m.no, k)}`)).toBe(true);
      });
    });
  });
  it('부위 연결은 도감에 있는 번호만 쓰고, 활성 부위가 없으면 비어 있다', () => {
    Object.values(REGION_ATLAS).forEach(({ tight, weak }) => [...tight, ...weak].forEach((n) => expect(MUSCLE_ATLAS.some((m) => m.no === n)).toBe(true)));
    expect(atlasForRegions([])).toEqual({ tight: [], weak: [] });
    const a = atlasForRegions(['shoulder_back']);
    expect(a.tight).toContain(12);
    expect(a.weak).toContain(5);
  });
  it('움직임 영상 파일이 있고, 없는 근육은 null', () => {
    ANIM_MUSCLES.forEach((n) => expect(fs.existsSync(`public${muscleAnimSrc(n)}`)).toBe(true));
    expect(muscleAnimSrc(1)).toBeNull();
  });
});
