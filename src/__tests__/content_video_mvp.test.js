import { describe, expect, it } from 'vitest';
import { buildFfmpegArgs, srtText, validateClip } from '../../scripts/content-video/videoMvp.mjs';

const approved = {
  id: 'exercise-balance-001',
  source: 'F:/approved-content/exercise-balance-001.mp4',
  consent: { publicContent: true, reference: 'CONSENT-REFERENCE' },
  trim: { startSec: 2, endSec: 22 },
  captionDraft: '균형 운동은 천천히 시작하세요.',
};

describe('콘텐츠 영상 MVP', () => {
  it('공개 동의·동의 참조·10~30초 길이·자막이 있어야 처리한다', () => {
    expect(validateClip(approved)).toEqual([]);
    expect(validateClip({ ...approved, consent: { publicContent: false, reference: '' } })).toHaveLength(2);
    expect(validateClip({ ...approved, trim: { startSec: 0, endSec: 31 } })[0]).toContain('10~30초');
  });

  it('세로 9:16 검수용 mp4와 로고·엔딩 카드 명령을 만든다', () => {
    const args = buildFfmpegArgs({ clip: approved, outputFile: 'review.mp4', logoPath: 'logo.png', endCardPath: 'end-card.png' });
    expect(args.some((arg) => arg.includes('scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1'))).toBe(true);
    expect(args.some((arg) => arg.includes('overlay=W-w-48:48[branded]'))).toBe(true);
    expect(args.some((arg) => arg.includes('concat=n=2:v=1:a=0[v]'))).toBe(true);
    expect(args).toContain('review.mp4');
  });

  it('자막은 영상 길이에 맞춘 검수용 SRT로 만든다', () => {
    expect(srtText(approved)).toContain('00:00:00,000 --> 00:00:20,000');
    expect(srtText(approved)).toContain(approved.captionDraft);
  });
});
