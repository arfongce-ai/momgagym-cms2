// [음성 명령 확장 2026-08-09] Revenue.jsx(관리자 전용) — "모미야, 정산 열어줘"
// 같은 명령으로 도착했을 때 개요 탭이 아니라 요청한 탭을 바로 여는지 확인.
// 정적 소스 패턴 테스트(members_voice_target.test.js·schedule_voice_target.test.js
// 와 동일 컨벤션).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const src = readFileSync(join(process.cwd(), 'src/pages/Revenue.jsx'), 'utf8');

describe('Revenue.jsx — 음성으로 넘어올 때 요청한 탭(정산 등)을 바로 연다(회귀 방지)', () => {
  it('consumePendingVoiceTarget을 가져와 쓴다', () => {
    expect(src).toContain("import { consumePendingVoiceTarget } from '../voice/pendingVoiceTarget';");
  });

  it('pending.revenueTab이 있으면 setTab으로 반영한다', () => {
    const start = src.indexOf('const pending = consumePendingVoiceTarget();');
    expect(start).toBeGreaterThan(-1);
    const end = src.indexOf('}, []);', start);
    const body = src.slice(start, end);
    expect(body).toContain('if (pending?.revenueTab) setTab(pending.revenueTab);');
  });

  it('이 훅은 트레이너 전용 조기 return보다 먼저(무조건) 호출된다(React hooks 규칙 준수)', () => {
    const hookIdx = src.indexOf('const pending = consumePendingVoiceTarget();');
    const earlyReturnIdx = src.indexOf("if (user?.role !== 'admin')");
    expect(hookIdx).toBeGreaterThan(-1);
    expect(earlyReturnIdx).toBeGreaterThan(-1);
    expect(hookIdx).toBeLessThan(earlyReturnIdx);
  });

  it('새 tab state를 따로 만들지 않고 기존 것을 재사용한다(회귀 방지)', () => {
    const tabDeclCount = (src.match(/const \[tab,\s*setTab\]\s*=\s*useState/g) || []).length;
    expect(tabDeclCount).toBe(1);
  });
});
