// ai-measure/core/useHardwareBack.js
// ════════════════════════════════════════════════════════════════════════
//  폰(브라우저) '뒤로가기' 버튼을 AI 측정 화면의 내부 뒤로가기와 연동한다.
//
//  문제: AI 측정 허브는 라우터가 아니라 내부 state(active/mode/report 등)로
//  화면을 전환한다. 그래서 폰 뒤로가기(popstate)를 누르면 /ai 화면 자체를
//  벗어나 홈으로 이동해 버렸다(측정 중이던 화면이 통째로 닫힘).
//
//  해결: 하위 화면 '진입' 시 history 에 더미 엔트리를 push 하고, 뒤로가기
//  (popstate)가 오면 라우터 이동 대신 등록된 onBack() 을 호출해 '한 단계'만
//  뒤로 간다. 폰 뒤로가기 = 화면 안의 '← 뒤로' 버튼과 동일해진다.
//
//  중첩 처리: 허브→모듈→리포트처럼 여러 단계가 동시에 활성일 수 있다.
//  popstate 는 window 전역 이벤트라 단계마다 리스너를 달면 한 번의 뒤로가기에
//  모든 단계가 동시에 닫히는 버그가 생긴다. 그래서 '중앙 스택 + 단일 리스너'
//  구조로, 가장 마지막(최상단)에 등록된 화면 하나만 뒤로가기를 처리한다.
//
//  사용법: 뒤로갈 수 있는 하위 화면을 렌더하는 컴포넌트에서
//    useHardwareBack(active, onBack);
//  - active(boolean): 이 화면이 '뒤로 갈 수 있는' 상태인지(true 일 때만 등록)
//  - onBack(fn): 뒤로가기 시 실행할 함수(한 단계 뒤로)
// ════════════════════════════════════════════════════════════════════════
import { useEffect, useRef } from 'react';

// 모듈 스코프 중앙 스택. 마지막 항목 = 최상단(다음 뒤로가기 담당).
const stack = [];
// 내부 정리용 history.back() 이 유발한 popstate 를 무시하기 위한 카운터.
let suppress = 0;
let listenerAttached = false;

function ensureListener() {
  if (listenerAttached) return;
  if (typeof window === 'undefined' || !window.history) return;
  listenerAttached = true;
  window.addEventListener('popstate', () => {
    if (suppress > 0) { suppress -= 1; return; }
    const top = stack.pop();
    if (top && typeof top.cb === 'function') top.cb();
    // 스택이 비어 있으면(우리가 관리하는 화면 없음) 그대로 라우터에 맡긴다.
  });
}

export function useHardwareBack(active, onBack) {
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;

  useEffect(() => {
    if (!active) return undefined;
    if (typeof window === 'undefined' || !window.history) return undefined;
    ensureListener();

    const marker = `aiBack:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
    const entry = { marker, cb: () => { if (typeof onBackRef.current === 'function') onBackRef.current(); } };

    try {
      window.history.pushState({ aiBack: marker }, '');
    } catch {
      return undefined; // history 접근 불가 환경 — 가로채기 없이 기존 동작 유지
    }
    stack.push(entry);

    return () => {
      const idx = stack.indexOf(entry);
      if (idx >= 0) {
        // 뒤로가기가 아닌 내부 버튼('← 뒤로')으로 화면이 닫힌 경우:
        // 우리가 push 한 더미 엔트리가 아직 남아 있으므로 조용히 소비한다
        // (suppress 로 다른 핸들러가 반응하지 않게 함).
        stack.splice(idx, 1);
        const st = window.history.state;
        if (st && st.aiBack === marker) {
          suppress += 1;
          try { window.history.back(); } catch { suppress -= 1; }
        }
      }
      // idx < 0 이면 이미 popstate 가 이 엔트리를 소비함(추가 정리 불필요).
    };
  }, [active]);
}

export default useHardwareBack;
