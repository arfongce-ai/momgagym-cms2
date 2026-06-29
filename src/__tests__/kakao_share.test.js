// 카카오톡 공유 래퍼 회귀 테스트 (Vitest, node 환경 — window 를 직접 stub)
//   · 키 미설정 → 안내 메시지(throw 안 함)
//   · 정상 경로 → Kakao.Share.sendDefault 호출
//   · Feed 템플릿 → 종합점수 + 상위 3건만
import { describe, it, expect, afterEach, vi } from 'vitest';
import { shareMeasurementSummaryToKakao } from '../ai-measure/core/reportShare';
import { shareSummaryToKakao, buildKakaoFeedTemplate } from '../ai-measure/core/unifiedReport';

const sampleSummary = {
  title: '몸가짐CMS 측정 결과 요약',
  overallScore: 72,
  score: 72,
  statusLabel: '주의',
  topFindings: [{ text: '골반 틀어짐 주의' }, { text: '어깨 높이 차이 양호' }, { text: '거북목 경미' }],
  reportType: 'posture',
};

afterEach(() => { if (typeof globalThis.window !== 'undefined') delete globalThis.window; });

describe('카카오톡 공유 래퍼', () => {
  it('키가 없으면 throw 하지 않고 안내 메시지를 반환한다', async () => {
    // 테스트 환경엔 VITE_KAKAO_JS_KEY 가 없으므로 ok:false 안내가 나와야 한다.
    const res = await shareMeasurementSummaryToKakao(sampleSummary);
    expect(res.ok).toBe(false);
    expect(typeof res.msg).toBe('string');
    expect(res.msg.length).toBeGreaterThan(0);
  });

  it('정상 경로: Kakao SDK가 있으면 sendDefault 를 호출한다', async () => {
    const sendDefault = vi.fn().mockResolvedValue({ ok: true });
    const Kakao = { isInitialized: () => true, Share: { sendDefault } };
    await shareSummaryToKakao(sampleSummary, { Kakao });
    expect(sendDefault).toHaveBeenCalledTimes(1);
    const sentTemplate = sendDefault.mock.calls[0][0];
    expect(sentTemplate.objectType).toBe('feed');
    expect(sentTemplate.itemContent.items.length).toBe(3);
    expect(sentTemplate.content.title).toContain('몸가짐CMS');
  });

  it('Feed 템플릿은 종합점수와 상위 3건만 담는다', () => {
    const many = { ...sampleSummary, topFindings: [1,2,3,4,5].map(n => ({ text: `소견 ${n}` })) };
    const t = buildKakaoFeedTemplate(many);
    expect(t.itemContent.items.length).toBe(3);
    expect(t.itemContent.titleImageText).toContain('72');
    expect(t.buttons[0].title).toBe('앱/웹에서 자세히 보기');
  });
});
