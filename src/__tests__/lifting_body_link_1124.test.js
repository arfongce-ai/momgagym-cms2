import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
const src = fs.readFileSync('src/ai-measure/menus/BarbellLiftingHub.jsx', 'utf8');
describe('바벨 리프팅 허브 신체정보 연동', () => {
  it('공용 resolveBodyMetrics 로 키·체중을 불러온다', () => {
    expect(src).toContain("import { resolveBodyMetrics } from '../../services/bodyMetrics';");
    expect(src).toContain('const initBody = resolveBodyMetrics(member);');
    expect(src).toContain('useState(!initBody.height)');
  });
  it('member.height 만 보고 needBody 를 정하지 않는다', () => {
    expect(src).not.toContain('useState(!member?.height)');
  });
});
