import { describe, it, expect } from 'vitest';
import { getMovementGuide, visibleMovements, displayPoseKey, normNote, REPS_TEXT } from '../ai-measure/core/romMovementGuide';
import { ROM_NORMS } from '../ai-measure/core/bodyMechanics';

const ALLOWED = {
  HIP: ['STANDING', 'SUPINE', 'PRONE', 'ABDUCTION', 'SUPINE_ABD'], KNEE: ['STANDING', 'SUPINE', 'PRONE'],
  SHOULDER: ['STANDING', 'SEATED', 'ABDUCTION'], ELBOW: ['STANDING', 'SEATED'], ANKLE: ['STANDING', 'SEATED'],
  TRUNK: ['T_FLEXION', 'T_EXTENSION', 'T_LATERAL', 'T_ROTATION'], NECK: ['FLEXION', 'EXTENSION', 'LATERAL', 'ROTATION'],
};
describe('ROM 움직임 안내', () => {
  it('모든 관절·자세에 설명 카드가 있고 단계가 있다', () => {
    for (const [j, keys] of Object.entries(ALLOWED)) for (const k of keys) {
      const g = getMovementGuide(j, k);
      expect(g, `${j}/${k}`).toBeTruthy();
      expect(g.measures.length).toBeGreaterThan(5);
      expect(g.steps.length).toBeGreaterThanOrEqual(2);
      expect(g.reps).toBe(REPS_TEXT);
    }
  });
  it('팔꿈치·발목은 탭이 1개(서서/앉아서 중복 제거), 어깨는 2개', () => {
    expect(visibleMovements('ELBOW', ALLOWED.ELBOW)).toEqual(['STANDING']);
    expect(visibleMovements('ANKLE', ALLOWED.ANKLE)).toEqual(['STANDING']);
    expect(visibleMovements('SHOULDER', ALLOWED.SHOULDER)).toEqual(['STANDING', 'ABDUCTION']);
    expect(displayPoseKey('ELBOW', 'SEATED')).toBe('STANDING');
  });
  it('참고 정상치는 ROM_NORMS 에서 가져오고 없으면 기준값 없음', () => {
    expect(normNote('ANKLE', 'STANDING')).toContain(String(ROM_NORMS.ANKLE.STANDING.dorsiflexion.normal));
    expect(normNote('TRUNK', 'T_FLEXION')).toContain('기준값 없음');
  });
});
