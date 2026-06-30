import { describe, expect, it, vi } from 'vitest';
import {
  buildKakaoFeedTemplate,
  buildSummaryData,
  buildUnifiedReportDocument,
  extractKakaoSummary,
  getLaymanTerm,
  sanitizeReportPayload,
  shareSummaryToKakao,
  toLaymanMetric,
} from '../ai-measure/core/unifiedReport';

describe('unified report utilities', () => {
  it('전문 용어를 일반 회원용 용어로 변환한다', () => {
    expect(getLaymanTerm('Pelvic Drop').label).toBe('골반 틀어짐');
    expect(getLaymanTerm('RSI').label).toBe('반응 탄성');
    expect(toLaymanMetric('peakPower', 3591, { unit: 'W' })).toMatchObject({
      label: '폭발력',
      displayValue: '3591',
      unit: 'W',
    });
  });

  it('Firestore 저장 payload에서 영상 원본과 blob URL을 제거한다', () => {
    const videoBlob = new Blob(['video'], { type: 'video/webm' });
    const sanitized = sanitizeReportPayload({
      heightCm: 34.8,
      videoBlob,
      previewVideoUrl: 'blob:http://local/video',
      nested: {
        videoUrl: 'https://storage.example/video.mp4',
        keep: 1,
      },
    });

    expect(sanitized.heightCm).toBe(34.8);
    expect(sanitized.videoBlob).toBeUndefined();
    expect(sanitized.previewVideoUrl).toBeUndefined();
    expect(sanitized.nested.videoUrl).toBeUndefined();
    expect(sanitized.nested.keep).toBe(1);
  });

  it('raw 데이터와 summary 데이터를 분리한 통합 문서를 만든다', () => {
    const doc = buildUnifiedReportDocument({
      id: 'jump1',
      kind: 'jump',
      heightCm: 34.8,
      peakPower: 3591,
      videoBlob: new Blob(['video']),
      member: { id: 'm1', name: '김동규' },
      problem_focus: {
        severity: 'caution',
        primaryFinding: '착지 좌우 대칭성이 낮습니다(0%).',
      },
    });

    expect(doc.reportId).toBe('jump1');
    expect(doc.userId).toBe('m1');
    expect(doc.storagePolicy.videoStored).toBe(false);
    expect(doc.raw.data.videoBlob).toBeUndefined();
    expect(doc.summary.keyMetrics.some((metric) => metric.label === '점프 높이')).toBe(true);
    expect(doc.summary.topFindings[0].text).toContain('착지 좌우 대칭성');
  });

  it('기준 범위가 없는 근력형 결과는 위험으로 오판하지 않는다', () => {
    const summary = buildSummaryData({
      kind: 'one_rm',
      oneRM: 110,
      member: { id: 'm1', name: '김동규' },
    }, { reportType: 'one_rm' });

    expect(summary.overallScore).toBe(0);
    expect(summary.status).toBe('unknown');
    expect(summary.statusLabel).toBe('확인 필요');
    expect(summary.keyMetrics[0].label).toBe('최대 근력');
  });

  it('카카오 공유용 핵심 3개 요약과 Feed 템플릿을 만든다', () => {
    const summary = extractKakaoSummary({
      member: { name: '김동규' },
      summary: {
        reportType: 'jump',
        overallScore: 78,
        status: 'caution',
        statusLabel: '주의',
        topFindings: [
          { rank: 1, text: '착지 대칭성이 낮습니다.', status: 'caution' },
          { rank: 2, text: '점프 높이는 주의 범위입니다.', status: 'caution' },
          { rank: 3, text: '폭발력은 유지 중입니다.', status: 'normal' },
          { rank: 4, text: '공유에는 포함되지 않습니다.', status: 'normal' },
        ],
      },
    }, { webUrl: 'https://example.com/report' });

    expect(summary.topFindings).toHaveLength(3);
    const template = buildKakaoFeedTemplate(summary, { webUrl: 'https://example.com/report' });
    expect(template.objectType).toBe('feed');
    expect(template.content.title).toBe('몸가짐CMS 측정 결과 요약');
    expect(template.buttons[0].title).toBe('앱/웹에서 자세히 보기');
  });

  it('Kakao SDK의 Share.sendDefault를 호출한다', () => {
    const sendDefault = vi.fn();
    const Kakao = {
      isInitialized: () => true,
      Share: { sendDefault },
    };

    shareSummaryToKakao({
      title: '몸가짐CMS 측정 결과 요약',
      score: 90,
      statusLabel: '정상',
      topFindings: [{ text: '큰 위험 신호는 없습니다.' }],
    }, { Kakao, webUrl: 'https://example.com/report' });

    expect(sendDefault).toHaveBeenCalledTimes(1);
    expect(sendDefault.mock.calls[0][0].objectType).toBe('feed');
  });
});
