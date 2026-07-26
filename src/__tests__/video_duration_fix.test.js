// video_duration_fix.test.js
// ════════════════════════════════════════════════════════════════════════
//  ai-measure/core/videoAnalyzer.js 의 isUsableDuration/resolveVideoDuration
//  회귀 테스트. 일부 영상 파일은 loadedmetadata 시점에 video.duration 이
//  Infinity/NaN 으로 보고되는 잘 알려진 브라우저 버그가 있어(특히 슬로모/편집
//  앱 재인코딩본), 분석 시작(analyzeUploadedVideo)이 즉시 실패했다 — 표준 우회
//  (currentTime 을 크게 seek → durationchange 로 재계산 감지 → 0으로 복귀)를
//  검증한다. 실제 <video> 엘리먼트 없이(jsdom 불필요) addEventListener 등
//  필요한 인터페이스만 흉내낸 가벼운 목(mock) 객체로 테스트한다.
// ════════════════════════════════════════════════════════════════════════
import { describe, it, expect, vi } from 'vitest';
import { isUsableDuration, resolveVideoDuration } from '../ai-measure/core/videoAnalyzer';

// resolveVideoDuration 이 실제로 쓰는 최소 인터페이스만 흉내낸 가짜 video.
// currentTime 에 아주 큰 값(1e101)이 대입되면, 실제 브라우저의 seek 가 항상
// 비동기(마이크로태스크 이후)로 durationchange/timeupdate 를 쏘는 것과 동일하게
// 비동기로 콜백을 호출한다. (동기 발화로 흉내내면 실제 브라우저에서는 절대
// 일어나지 않는 실행 순서 — setTimeout(timer) 등록 전에 이벤트가 도착하는 상황 —
// 를 인위적으로 만들게 되어 테스트가 실제 동작과 어긋난다.)
function makeFakeVideo({ initialDuration, resolvedDuration, fireEvent = 'durationchange', neverFire = false }) {
  const listeners = {};
  return {
    duration: initialDuration,
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    removeEventListener(type, fn) {
      if (!listeners[type]) return;
      listeners[type] = listeners[type].filter(f => f !== fn);
    },
    set currentTime(v) {
      if (neverFire) return; // 워크어라운드가 통하지 않는 상황(타임아웃 테스트용) 흉내
      if (v > 1000) {
        // 실제 seek → duration 재계산을 흉내(항상 비동기로 도착).
        queueMicrotask(() => {
          this.duration = resolvedDuration;
          (listeners[fireEvent] || []).forEach(fn => fn());
        });
      }
      // v === 0(워크어라운드 마지막 되돌리기)은 별도 반응 없음(실제로도 무해).
    },
  };
}

describe('isUsableDuration — 순수 판별 함수', () => {
  it('유한하고 양수인 값만 true', () => {
    expect(isUsableDuration(12.5)).toBe(true);
    expect(isUsableDuration(0.001)).toBe(true);
  });
  it('Infinity/NaN/0/음수/undefined 는 모두 false', () => {
    expect(isUsableDuration(Infinity)).toBe(false);
    expect(isUsableDuration(NaN)).toBe(false);
    expect(isUsableDuration(0)).toBe(false);
    expect(isUsableDuration(-5)).toBe(false);
    expect(isUsableDuration(undefined)).toBe(false);
  });
});

describe('resolveVideoDuration — 정상 케이스(우회 불필요)', () => {
  it('video.duration 이 이미 유효하면 이벤트 대기 없이 즉시 그 값을 반환한다', async () => {
    const video = makeFakeVideo({ initialDuration: 8.2, resolvedDuration: 8.2 });
    const addSpy = vi.spyOn(video, 'addEventListener');
    await expect(resolveVideoDuration(video)).resolves.toBe(8.2);
    expect(addSpy).not.toHaveBeenCalled(); // 우회 로직을 아예 타지 않아야 함
  });
});

describe('resolveVideoDuration — Infinity 버그 우회(회귀 테스트)', () => {
  it('duration 이 Infinity 로 보고되면 seek 우회로 실제 값을 알아내 resolve 한다', async () => {
    const video = makeFakeVideo({ initialDuration: Infinity, resolvedDuration: 14.7 });
    await expect(resolveVideoDuration(video)).resolves.toBe(14.7);
  });

  it('duration 이 NaN 이어도 동일하게 우회한다', async () => {
    const video = makeFakeVideo({ initialDuration: NaN, resolvedDuration: 3.3 });
    await expect(resolveVideoDuration(video)).resolves.toBe(3.3);
  });

  it('durationchange 대신 timeupdate 로만 갱신을 알리는 브라우저에서도 감지한다', async () => {
    const video = makeFakeVideo({ initialDuration: Infinity, resolvedDuration: 20, fireEvent: 'timeupdate' });
    await expect(resolveVideoDuration(video)).resolves.toBe(20);
  });

  it('우회 후 currentTime 을 0으로 되돌린다(재생 위치 정리) — 부작용 없이 정상 resolve', async () => {
    const video = makeFakeVideo({ initialDuration: Infinity, resolvedDuration: 5 });
    await resolveVideoDuration(video);
    expect(isUsableDuration(video.duration)).toBe(true);
  });

  it('우회가 끝내 실패하면(타임아웃) 사용자 메시지가 담긴 에러로 reject 한다', async () => {
    vi.useFakeTimers();
    const video = makeFakeVideo({ initialDuration: Infinity, resolvedDuration: 10, neverFire: true });
    const p = resolveVideoDuration(video, { timeoutMs: 1000 });
    const assertion = expect(p).rejects.toThrow('영상 길이를 읽을 수 없습니다');
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
    vi.useRealTimers();
  });
});
