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
  it('SDK가 없으면 throw 하지 않고 안내 메시지를 반환한다', async () => {
    // 테스트(node)에는 window.Kakao 가 없으므로 ok:false 안내가 나와야 한다.
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
    expect(sentTemplate.objectType).toBe('text');
    expect(sentTemplate.text).toContain('몸가짐CMS');
    expect(sentTemplate.link).toBeTruthy();
  });

  it('text 템플릿은 종합점수와 상위 3건을 담고 링크 버튼을 가진다', () => {
    const many = { ...sampleSummary, topFindings: [1,2,3,4,5].map(n => ({ text: `소견 ${n}` })) };
    const t = buildKakaoFeedTemplate(many);
    expect(t.objectType).toBe('text');
    expect(t.text).toContain('72');
    // 상위 3건만 포함(4·5번 소견은 제외).
    expect(t.text).toContain('소견 1');
    expect(t.text).not.toContain('소견 4');
    expect(t.buttonTitle).toBe('앱/웹에서 자세히 보기');
  });
});

describe('카카오 공유 점수 표시 (회귀)', () => {
  it('buildSummaryData 결과(overallScore)를 넘겨도 점수가 undefined 가 아니다', async () => {
    const { buildKakaoFeedTemplate, buildSummaryData } = await import('../ai-measure/core/unifiedReport');
    // 실제 앱 흐름: Report.jsx 가 buildSummaryData 결과(summary)를 그대로 공유에 넘긴다.
    const summary = buildSummaryData({ kind: 'jump', heightCm: 42, member: { id: 'm1' } }, { reportType: 'jump' });
    expect(summary.overallScore).toBeGreaterThanOrEqual(0);
    const t = buildKakaoFeedTemplate(summary);
    expect(t.objectType).toBe('text');
    expect(t.text).not.toContain('undefined');
    expect(t.text).toContain(`종합 ${summary.overallScore}/100`);
  });
});
