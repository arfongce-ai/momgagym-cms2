// [무료 확장 2026-08-11] 세션조정 규칙기반 매칭의 "트레이너 이름 언급되면
// Claude로" 안전장치가 실제로 작동하려면 두 음성 컴포넌트가 allTrainers를
// processVoiceCommand에 넘겨줘야 한다 — 안 넘기면 항상 빈 배열([])이라
// 안전장치가 무력화된다(트레이너 이름이 있어도 못 알아채고 무료 경로가 계속
// 진행됨). 이 배선이 두 파일 모두에 있는지 정적 소스 패턴으로 확인.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const readSrc = (...segs) => readFileSync(join(process.cwd(), ...segs), 'utf8');

describe.each([
  ['GlobalVoiceCommand.jsx', 'src/components/common/GlobalVoiceCommand.jsx'],
  ['KioskVoiceCommand.jsx', 'src/components/common/KioskVoiceCommand.jsx'],
])('%s — allTrainers 배선', (label, path) => {
  const src = readSrc(path);

  it('store.getTrainers()로 allTrainers를 만든다', () => {
    expect(src).toContain('const allTrainers = useMemo(() => store.getTrainers(), []);');
  });

  it('processVoiceCommand 호출부에 allTrainers를 넘긴다(안 넘기면 트레이너 언급 안전장치가 무력화됨)', () => {
    const start = src.indexOf('const result = await processVoiceCommand({');
    const end = src.indexOf('});', start);
    const body = src.slice(start, end);
    expect(body).toContain('allTrainers,');
  });
});
