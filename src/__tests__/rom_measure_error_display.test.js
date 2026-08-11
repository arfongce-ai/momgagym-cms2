// rom_measure_error_display.test.js
// ════════════════════════════════════════════════════════════════════════
//  [버그 수정 2026-08-08] RomMeasure.jsx의 errorMsg state가 선언만 되고
//  실제로는 어디서도 set/렌더 안 되던 죽은 state였다("정밀 디버깅" 단계에서
//  발견) — 영상 녹화 시작 실패(MediaRecorder 생성 실패 등)를 조용히 삼켜서,
//  측정은 계속되고 리포트도 나오지만 영상만 소리 없이 빠지는 상황이었다.
//  다른 rom_measure_*.test.js와 마찬가지로 화면 배선만 정적 소스 패턴으로 고정.
// ════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const src = readFileSync(
  join(process.cwd(), 'src/ai-measure/menus/RomMeasure.jsx'),
  'utf8',
);

describe('RomMeasure.jsx — errorMsg가 실제로 set된다(회귀 방지: 죽은 state였음)', () => {
  it('MediaRecorder 생성 실패 catch 블록에서 errorMsg를 set한다', () => {
    const catchStart = src.indexOf('} catch (e) {\n      mediaRecorderRef.current = null;');
    const catchEnd = src.indexOf('}', catchStart + '} catch (e) {'.length + 100);
    const catchBody = src.slice(catchStart, catchEnd + 1);
    expect(catchBody).toContain('setErrorMsg(');
  });

  it('녹화 실패 메시지는 "측정은 계속 진행"됨을 명시한다(측정 자체가 막힌 게 아니라는 것을 알려줌)', () => {
    expect(src).toMatch(/setErrorMsg\(['"`].*측정은 계속 진행.*['"`]\)/);
  });

  it('새 녹화 시도(beginRecord) 시작 시 이전 errorMsg를 초기화한다(지난 실패가 계속 안 남게)', () => {
    const start = src.indexOf('const beginRecord = () => {');
    const end = src.indexOf('// MediaRecorder 시작', start);
    const body = src.slice(start, end);
    expect(body).toContain("setErrorMsg('');");
  });
});

describe('RomMeasure.jsx — errorMsg가 실제로 화면에 렌더된다(회귀 방지)', () => {
  it('errorMsg가 있으면 화면에 표시한다(saveState 에러 메시지와 같은 스타일)', () => {
    expect(src).toContain('{errorMsg && <p className="text-center text-xs text-red-700 dark:text-red-400">{errorMsg}</p>}');
  });

  it('기존 저장 실패 메시지(saveState==="error")는 그대로 남아있다(교체가 아니라 추가)', () => {
    expect(src).toContain("saveState === 'error'");
    expect(src).toContain('저장 실패');
  });
});
