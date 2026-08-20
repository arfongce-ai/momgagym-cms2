// jump_replay_graph.test.js — [점프 리플레이 그래프 2026-08-20] 배선 확인.
//
// 검증 대상:
//  1) JumpBiomechAccumulator의 comHeightCm 계산(수치 로직)은
//     jump_biomechanics.test.js에서 이미 커버 — 여기서는 반복하지 않는다.
//  2) 라이브 측정 중 영상-무관 실시간 파형(LiveHeightWave) 배선.
//  3) 측정 종료 시 timeline의 tMs를 녹화 시작 시각(recStartedAtRef) 기준으로
//     재계산해 영상 currentTime과 동기화하는 로직.
//  4) 리포트 화면(JumpReportDashboard)이 videoBlob + timeline을 새 컴포넌트
//     (JumpReplayGraph)에 넘긴다.
//  5) JumpReplayGraph 자체가 영상 유무에 따라 정적/동기화 그래프로 분기하고,
//     Blob object URL을 정리(revoke)하며, 리포트 캡처(html2canvas)에서
//     비디오/컨트롤을 제외한다.
//
// 카메라·MediaRecorder·비디오 재생 등 브라우저 API 의존으로, 이 코드베이스의
// 기존 관례(slj_live_leg_switch.test.js 등)를 따라 jsdom 렌더 대신 소스
// 패턴 테스트를 쓴다.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const read = (p) => readFileSync(join(process.cwd(), p), 'utf8');

const jumpPrecisionSrc = read('src/ai-measure/menus/JumpPrecisionAnalysis.jsx');
const jumpReportDashboardSrc = read('src/ai-measure/menus/JumpReportDashboard.jsx');
const jumpReplayGraphSrc = read('src/components/report/JumpReplayGraph.jsx');
const jumpBiomechSrc = read('src/ai-measure/core/jumpBiomechanics.js');

describe('JumpBiomechAccumulator — comHeightCm이 timeline에 포함된다', () => {
  it('push()가 골반 원시값(comY)을 시계열에 남긴다', () => {
    expect(jumpBiomechSrc).toContain('comY: comYNow');
  });
  it('summary()가 stand 기준선 + 스케일로 comHeightCm을 계산해 반환한다', () => {
    expect(jumpBiomechSrc).toContain('const standPelvisBase = mean(this.stand.pelvisY)');
    expect(jumpBiomechSrc).toContain('timeline: timelineWithHeight');
  });
  it('liveComHeightCm() 메서드가 존재한다(라이브 HUD용)', () => {
    expect(jumpBiomechSrc).toContain('liveComHeightCm(comY)');
  });
});

describe('라이브 HUD — 실시간 무게중심 높이 파형(LiveHeightWave)', () => {
  it('liveHeightSeries 상태가 존재하고 측정 리셋 시 함께 초기화된다', () => {
    expect(jumpPrecisionSrc).toContain('const [liveHeightSeries, setLiveHeightSeries] = useState([])');
    expect(jumpPrecisionSrc).toContain('setLiveHeightSeries([]); // [점프 리플레이 그래프 2026-08-20]');
  });
  it('측정 루프가 매 프레임 biomechAccRef.liveComHeightCm()으로 값을 갱신한다', () => {
    expect(jumpPrecisionSrc).toContain('biomechAccRef.current?.liveComHeightCm(comYNow)');
  });
  it('JumpLiveOverlay가 liveHeightSeries를 받아 LiveHeightWave를 렌더링한다', () => {
    expect(jumpPrecisionSrc).toContain('liveHeightSeries={liveHeightSeries}');
    expect(jumpPrecisionSrc).toContain('<LiveHeightWave series={liveHeightSeries} accent={accent} />');
  });
});

describe('측정 종료 — timeline이 녹화 영상 시작 시각 기준으로 재계산된다', () => {
  it('finishMeasure가 recStartedAtRef 기준으로 tMs를 재계산하고 음수(녹화 전) 표본을 버린다', () => {
    expect(jumpPrecisionSrc).toContain('const t0 = recStartedAtRef.current;');
    expect(jumpPrecisionSrc).toContain('tMs: Math.round(p.tMs - t0)');
    expect(jumpPrecisionSrc).toContain('.filter((p) => p.tMs >= 0)');
  });
});

describe('리포트 화면 — JumpReplayGraph 연결', () => {
  it('JumpReportDashboard가 JumpReplayGraph를 import하고 videoBlob·timeline을 넘긴다', () => {
    expect(jumpReportDashboardSrc).toContain("import JumpReplayGraph from '../../components/report/JumpReplayGraph.jsx'");
    expect(jumpReportDashboardSrc).toContain('<JumpReplayGraph videoBlob={report.videoBlob || null} timeline={biomech.timeline} />');
  });
});

describe('JumpReplayGraph 컴포넌트', () => {
  it('영상이 없으면(고속영상 업로드 등) 정적 그래프로 자동 분기한다', () => {
    expect(jumpReplayGraphSrc).toContain("videoUrl ? '' : ' — 정적 그래프'");
  });
  it('videoBlob → object URL 생성 후 언마운트/변경 시 revoke한다(메모리 누수 방지)', () => {
    expect(jumpReplayGraphSrc).toContain('URL.createObjectURL(videoBlob)');
    expect(jumpReplayGraphSrc).toContain('URL.revokeObjectURL(videoUrl)');
  });
  it('타임라인 데이터가 없으면 아무것도 그리지 않는다(허위 그래프 방지)', () => {
    expect(jumpReplayGraphSrc).toContain('if (!pts.length) return null;');
  });
  it('리포트 JPG 캡처에서 비디오/컨트롤을 제외한다(html2canvas-ignore)', () => {
    const count = (jumpReplayGraphSrc.match(/data-html2canvas-ignore="true"/g) || []).length;
    expect(count).toBeGreaterThanOrEqual(2);
  });
  it('플레이헤드가 영상 재생 위치(curSec)를 timeline의 tMs 범위에 매핑한다', () => {
    expect(jumpReplayGraphSrc).toContain('const playedMs = curSec * 1000;');
    expect(jumpReplayGraphSrc).toContain('const xAt = (tMs) => padL + ((tMs - t0) / spanMs) * innerW;');
  });
});
