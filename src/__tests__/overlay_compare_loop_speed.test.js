// overlay_compare_loop_speed.test.js
// ════════════════════════════════════════════════════════════════════════
//  '전/후 비교' 반복재생 · 재생 속도 조절 — overlay_compare_registry.test.js와
//  같은 정적 소스 패턴 테스트. 이 화면은 렌더 테스트 하네스가 프로젝트에
//  없어 다른 측정 화면들처럼 소스 문자열 배선을 확인한다.
//
//  변경 요지: 영상 오버레이 비교에 (1) 반복재생 토글, (2) 리뷰용 전역
//  재생 속도 슬라이더를 추가한다. 전역 속도는 기존 "A 길이에 맞춘 B 자동
//  편집(rate)"과 곱해서 함께 적용되며(값을 서로 덮어쓰지 않음), 반복재생은
//  영상으로 저장(녹화) 중에는 자연 종료 시 자동으로 녹화를 멈추는 기존
//  동작을 지키기 위해 일시적으로 꺼진다.
// ════════════════════════════════════════════════════════════════════════
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const src = fs.readFileSync(
  path.resolve(__dirname, '..', 'ai-measure/menus/OverlayCompare.jsx'),
  'utf-8',
);

describe('OverlayCompare.jsx — 반복재생', () => {
  it('loop 상태와 토글 핸들러가 정의돼 있다', () => {
    expect(src).toContain("const [loop, setLoop] = useState(false);");
    expect(src).toContain('const onLoopToggle = useCallback');
  });

  it('반복재생 체크박스는 재생/정지 버튼과 함께 스테이지 바로 아래(showVideoPanel)에서 항상 노출된다', () => {
    const idx = src.indexOf('checked={loop} onChange={(e) => onLoopToggle(e.target.checked)}');
    expect(idx).toBeGreaterThan(-1);
    const advancedBlockIdx = src.indexOf('{showAdvanced && (');
    expect(idx).toBeLessThan(advancedBlockIdx);
  });

  it('반복재생 시 두 레이어를 함께 처음(0)으로 되돌리고 계속 재생한다', () => {
    const idx = src.indexOf('const maybeLoopRestart = useCallback');
    expect(idx).toBeGreaterThan(-1);
    const end = src.indexOf('}, []);', idx);
    const block = src.slice(idx, end);
    expect(block).toContain('videoARef.current.currentTime = 0');
    expect(block).toContain('videoBRef.current.currentTime = 0');
    expect(block).toContain('.play()');
  });

  it('영상 저장(녹화) 중에는 자연 종료 시 반복재생을 건너뛰어 기존 자동 정지 동작을 지킨다', () => {
    const idx = src.indexOf('const maybeLoopRestart = useCallback');
    const block = src.slice(idx, idx + 400);
    expect(block).toContain('recorderRef.current');
  });

  it('handleEnded는 두 레이어(A/B) 영상 모두에 연결되어 있다', () => {
    const countOnEnded = (src.match(/onEnded=\{handleEnded\}/g) || []).length;
    expect(countOnEnded).toBe(2);
  });
});

describe('OverlayCompare.jsx — 재생 속도 조절', () => {
  it('playbackSpeed 상태와 변경 핸들러가 정의돼 있다', () => {
    expect(src).toContain('const [playbackSpeed, setPlaybackSpeed] = useState(1);');
    expect(src).toContain('const onSpeedChange = useCallback');
  });

  it('재생 속도 슬라이더는 재생/정지 버튼과 함께 스테이지 바로 아래(showVideoPanel)에서 항상 노출된다', () => {
    const idx = src.indexOf('onChange={(e) => onSpeedChange((+e.target.value) / 100)}');
    expect(idx).toBeGreaterThan(-1);
    const advancedBlockIdx = src.indexOf('{showAdvanced && (');
    expect(idx).toBeLessThan(advancedBlockIdx);
  });

  it('videoA.playbackRate = playbackSpeed, videoB.playbackRate = rate × playbackSpeed로 함께 적용된다(자동 편집 값을 덮어쓰지 않음)', () => {
    const idx = src.indexOf('const onSpeedChange = useCallback');
    const end = src.indexOf('}, []);', idx);
    const block = src.slice(idx, end);
    expect(block).toContain('videoARef.current.playbackRate = v');
    expect(block).toContain('videoBRef.current.playbackRate = rateRef.current * v');
  });

  it('applyAutoSpeedMatch도 전역 재생 속도를 곱해서 videoB.playbackRate에 반영한다', () => {
    const idx = src.indexOf('const applyAutoSpeedMatch = useCallback');
    const end = src.indexOf('}, []);', idx);
    const block = src.slice(idx, end);
    expect(block).toContain('vB.playbackRate = nextRate * playbackSpeedRef.current');
  });
});
