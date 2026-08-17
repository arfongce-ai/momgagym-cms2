// overlay_compare_simplified_ux.test.js
// ════════════════════════════════════════════════════════════════════════
//  '전/후 비교' UX 단순화 — overlay_compare_registry.test.js와 같은 정적
//  소스 패턴 테스트. 이 화면은 렌더 테스트 하네스(@testing-library/react)가
//  프로젝트에 없어 다른 측정 화면들처럼 소스 문자열 배선을 확인한다.
//
//  변경 요지: (1) 자동 정렬·자동 속도 맞춤 파이프라인을 "1 업로드 →
//  2 정렬(진행 표시) → 3 비교" 3단계로 눈에 보이게 분리하고, (2) 비교
//  화면의 기본 노출 컨트롤은 오버레이 투명도만 남기고 블렌드 모드·수동
//  정렬 슬라이더·영상 세부 동기화는 "고급 설정"에 접어 둔다.
// ════════════════════════════════════════════════════════════════════════
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const src = fs.readFileSync(
  path.resolve(__dirname, '..', 'ai-measure/menus/OverlayCompare.jsx'),
  'utf-8',
);

describe('OverlayCompare.jsx — 3단계 흐름 (업로드 → 정렬 → 비교)', () => {
  it('정렬 진행 상태를 표시하는 runAlignSequence가 정의돼 있다', () => {
    expect(src).toContain('const runAlignSequence');
  });

  it('정렬 단계는 A 확인 → B 자동 정렬 → 오버레이 적용 순서로 진행된다', () => {
    const idx = src.indexOf('ALIGN_PROGRESS_STEPS');
    expect(idx).toBeGreaterThan(-1);
    const block = src.slice(idx, idx + 400);
    const confirmIdx = block.indexOf("key: 'confirm'");
    const autoAlignIdx = block.indexOf("key: 'autoAlign'");
    const applyIdx = block.indexOf("key: 'apply'");
    expect(confirmIdx).toBeGreaterThan(-1);
    expect(autoAlignIdx).toBeGreaterThan(confirmIdx);
    expect(applyIdx).toBeGreaterThan(autoAlignIdx);
  });

  it('두 레이어가 준비되면 2단계(정렬 진행 화면)로 전환된다', () => {
    const idx = src.indexOf('레이어가 모두 준비되면');
    expect(idx).toBeGreaterThan(-1);
    const block = src.slice(idx, idx + 300);
    expect(block).toContain('setStep(2)');
    expect(block).toContain('runAlignSequence()');
  });

  it('자동 정렬 실패 시 막지 않고 "계속하기"로 3단계 진행을 허용한다', () => {
    expect(src).toContain('alignPipelineError');
    expect(src).toContain('비교 화면으로 계속하기');
    expect(src).toContain('지금 건너뛰기');
  });

  it('runAutoAlign은 성공/실패를 boolean으로 반환한다(파이프라인 진행 판정에 사용)', () => {
    const idx = src.indexOf('const runAutoAlign = useCallback');
    const end = src.indexOf('}, [setAlignStatusSafe]);', idx);
    const block = src.slice(idx, end);
    expect(block).toContain('return false;');
    expect(block).toContain('return true;');
  });
});

describe('OverlayCompare.jsx — 컨트롤 단순화 (고급 설정 접기)', () => {
  it('showAdvanced 상태와 토글 버튼이 있다', () => {
    expect(src).toContain('const [showAdvanced, setShowAdvanced] = useState(false);');
    expect(src).toContain('setShowAdvanced((v) => !v)');
  });

  it('기본 노출 카드는 오버레이 투명도이고, 블렌드 모드는 고급 설정으로 이동했다', () => {
    const opacityCardIdx = src.indexOf('<p className="label">오버레이 투명도</p>');
    const advancedToggleIdx = src.indexOf('setShowAdvanced((v) => !v)');
    const blendCardIdx = src.indexOf('<p className="label">블렌드 모드</p>');
    expect(opacityCardIdx).toBeGreaterThan(-1);
    expect(advancedToggleIdx).toBeGreaterThan(opacityCardIdx);
    expect(blendCardIdx).toBeGreaterThan(advancedToggleIdx);
  });

  it('블렌드 모드·정렬 수동 조정·영상 세부 설정은 showAdvanced가 true일 때만 렌더된다', () => {
    const advancedBlockIdx = src.indexOf('{showAdvanced && (');
    expect(advancedBlockIdx).toBeGreaterThan(-1);
    const blendCardIdx = src.indexOf('<p className="label">블렌드 모드</p>');
    const alignCardIdx = src.indexOf('정렬 조정 (레이어 B)');
    const videoDetailIdx = src.indexOf('재생 상세 설정');
    expect(blendCardIdx).toBeGreaterThan(advancedBlockIdx);
    expect(alignCardIdx).toBeGreaterThan(advancedBlockIdx);
    expect(videoDetailIdx).toBeGreaterThan(advancedBlockIdx);
  });

  it('재생/정지 버튼은 고급 설정과 무관하게 스테이지 바로 아래 항상 노출된다', () => {
    const advancedBlockIdx = src.indexOf('{showAdvanced && (');
    const playBtnIdx = src.indexOf('togglePlay} className="btn btn-primary btn-sm">{playing');
    expect(playBtnIdx).toBeGreaterThan(-1);
    expect(playBtnIdx).toBeLessThan(advancedBlockIdx);
  });
});
