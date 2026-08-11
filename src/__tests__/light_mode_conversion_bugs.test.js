// [라이트모드 2026-08-11] 대량 변환 스크립트에서 실제로 두 번 발생했던 버그를
// 전체 src/**/*.jsx에서 검사한다 — 특정 파일이 아니라 "이 패턴 자체가 코드베이스
// 어디에도 없어야 한다"는 불변식이라 전체 스캔이 맞는 방식이다.
//
// 버그 1(slate- 누락): bg-slate-800을 라이트 버전으로 바꿀 때 'bg-100'처럼
//   색상 이름(slate-)이 빠진 채로 만들어진 적이 있었다. Tailwind가 인식 못 하는
//   클래스라 그냥 아무 효과 없이 조용히 무시된다 — 빌드·린트 전부 통과되고
//   화면에서만 "배경색이 하나도 안 칠해짐"으로 나타나는 가장 위험한 유형의 버그.
// 버그 2(prefix 불일치): hover:bg-slate-800처럼 의사클래스가 붙은 경우, 라이트/
//   다크 버전을 나눌 때 dark: 앞에 hover:를 빠뜨려 'hover:bg-X dark:bg-Y'가
//   되던 문제(정답은 'hover:bg-X dark:hover:bg-Y') — 의도와 다르게 라이트모드
//   에서 마우스오버 전에도 색이 미리 발동하거나, 다크모드에서 마우스오버가
//   전혀 안 먹는 식으로 나타난다.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

function listJsxFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listJsxFiles(full));
    else if (entry.name.endsWith('.jsx')) out.push(full);
  }
  return out;
}

const files = listJsxFiles(join(process.cwd(), 'src'));

describe('라이트모드 변환 버그 회귀 방지 — 전체 src/**/*.jsx 스캔', () => {
  it('파일 목록이 비어있지 않다(글롭 설정 자체가 깨지면 이 검사 전체가 무의미해지므로)', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it('color-less shade 클래스(bg-50/100/200/300처럼 slate- 등 색상 이름이 빠진 무효 클래스)가 어디에도 없다', () => {
    const broken = /(?<![\w-])bg-(?:50|100|200|300)(?![\w-])/;
    const offenders = [];
    for (const abs of files) {
      const content = readFileSync(abs, 'utf8');
      if (broken.test(content)) offenders.push(abs);
    }
    expect(offenders, `slate- 등 색상 이름이 빠진 무효 bg 클래스 발견: ${offenders.join(', ')}`).toEqual([]);
  });

  it('의사클래스(hover:/focus:/active:/group-hover:)와 dark:가 짝이 어긋난 곳이 없다 (hover:X dark:Y 금지, hover:X dark:hover:Y여야 함)', () => {
    const broken = /\b(hover|focus|active|group-hover|group-focus|disabled):[\w-]+-slate-\d+(?:\/\d+)?\s+dark:(?!\1:)[\w-]+-slate-\d+(?:\/\d+)?\b/;
    const offenders = [];
    for (const abs of files) {
      const content = readFileSync(abs, 'utf8');
      if (broken.test(content)) offenders.push(abs);
    }
    expect(offenders, `의사클래스-dark: 짝 불일치 발견: ${offenders.join(', ')}`).toEqual([]);
  });
});
