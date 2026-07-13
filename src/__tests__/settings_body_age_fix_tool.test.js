// settings_body_age_fix_tool.test.js
// Settings.jsx에 추가한 "체형나이 재계산(관리자)" 소급 보정 도구 배선 검증.
//  · postureMath.js의 계단식 불연속 수정(mapScoreToBodyAge) 이후, 이미 저장된
//    자세 리포트는 옛 값이 남아있어 별도 도구로 스캔→미리보기→적용해야 한다.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const root = join(process.cwd(), 'src');
const read = (p) => readFileSync(join(root, p), 'utf8');

describe('다크모드 토글 — 손잡이가 트랙 밖으로 벗어나지 않는다', () => {
  const src = read('pages/Settings.jsx');

  it('토글 손잡이(span)에 left가 명시되어 있다(auto 위치에 의존하지 않음)', () => {
    const idx = src.indexOf('다크 모드');
    const block = src.slice(idx, idx + 600);
    expect(block).toMatch(/<span className=\{`absolute left-0\.5 top-0\.5/);
  });

  it('트랙 폭(48px) 기준 좌우 여백이 대칭이다 — 기본 2px 인셋 + on 상태 24px 이동', () => {
    const idx = src.indexOf('다크 모드');
    const block = src.slice(idx, idx + 600);
    // base left-0.5(2px) + translate-x-6(24px) = 26px 시작 ~ 46px 끝(트랙 48px, 우측 여백 2px)
    // base left-0.5(2px) + translate-x-0(0px)  = 2px 시작(좌측 여백 2px, off 상태) — 대칭
    expect(block).toContain('translate-x-6');
    expect(block).toContain('translate-x-0');
    expect(block).not.toContain('translate-x-0.5');
  });

  it('overflow-hidden을 안전장치로 둬서, 계산이 어긋나도 손잡이가 트랙 밖으로 시각적으로 삐져나올 수 없다', () => {
    const idx = src.indexOf('다크 모드');
    const block = src.slice(idx, idx + 600);
    expect(block).toMatch(/w-12 h-6 rounded-full transition-colors relative flex-shrink-0 overflow-hidden/);
  });

  it('토글 트랙(button)에 flex-shrink-0이 있어 옆 텍스트가 길어도 트랙 크기가 줄지 않는다', () => {
    const idx = src.indexOf('다크 모드');
    const block = src.slice(idx, idx + 600);
    expect(block).toContain('flex-shrink-0');
  });
});

describe('체형나이 재계산 도구 — 관리자 전용 + 조회 후 적용(안전 패턴)', () => {
  const src = read('pages/Settings.jsx');

  it('백업/파기와 같은 관리자 전용(user?.role === admin) 블록 안에 있다', () => {
    const adminBlockIdx = src.indexOf("user?.role === 'admin'");
    const toolIdx = src.indexOf('체형나이 재계산');
    expect(adminBlockIdx).toBeGreaterThan(-1);
    expect(toolIdx).toBeGreaterThan(adminBlockIdx);
  });

  it('scanBodyAges는 실제 쓰기 없이 조회만 한다(updatePostureReport 호출 없음)', () => {
    const start = src.indexOf('const scanBodyAges = async () => {');
    const end = src.indexOf('const applyBodyAgeFixes');
    const fn = src.slice(start, end);
    expect(fn).not.toContain('updatePostureReport');
    expect(fn).toContain('recomputeBodyAgeIfStale');
    expect(fn).toContain('setBodyAgeScanList(found)');
  });

  it('applyBodyAgeFixes는 되돌릴 수 없다는 확인(confirm) 후에만 실행된다', () => {
    const start = src.indexOf('const applyBodyAgeFixes = async () => {');
    const end = src.indexOf('return (', start);
    const fn = src.slice(start, end);
    expect(fn).toContain('window.confirm');
    expect(fn).toContain('되돌릴 수 없습니다');
    expect(fn).toContain('aiStore.updatePostureReport');
  });

  it('적용 버튼은 스캔 결과가 있을 때만(bodyAgeScanList?.length > 0) 노출된다', () => {
    expect(src).toContain('bodyAgeScanList?.length > 0');
  });

  it('실패한 건은 메시지로 안내하고 목록에서 조용히 사라지지 않는다', () => {
    const start = src.indexOf('const applyBodyAgeFixes = async () => {');
    const end = src.indexOf('return (', start);
    const fn = src.slice(start, end);
    expect(fn).toContain('failed.push');
    expect(fn).toMatch(/실패/);
  });
});
