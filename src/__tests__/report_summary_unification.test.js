// [리포트 통합 2026-08-09] "결과리포트 모음과 종합리포트는 통합으로 UI/UX 개편"
// 요청 대응. 종전엔 서로 다른 세 곳에 종합/트렌드 성격의 화면이 흩어져 있었다:
//   1) Report.jsx 안의 ComprehensiveReportSection(일/주/월 트렌드 — 그래프·상태
//      토큰까지 있어 더 완성도 높음, 하지만 이상 데이터 삭제 기능이 없었음)
//   2) 독립 페이지 pages/ComprehensiveReport.jsx(/summary 라우트 — 이상 데이터
//      확인·개별/일괄 삭제 기능은 있지만 트렌드 그래프·상태 토큰이 없음)
//   3) CombinedAssessmentPanel(측정 종류를 골라 보는 다른 축의 분석 — 이건 원래
//      부터 Report.jsx 안에 있었고, 트렌드와는 성격이 달라 그대로 유지)
// 1)이 2)의 상위호환이 되도록 이상 데이터 기능을 이관하고, 2)는 제거해서
// "리포트" 하나로 합쳤다 — 기능 손실 없이 화면만 하나로.
import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const readSrc = (...segs) => readFileSync(join(process.cwd(), ...segs), 'utf8');

describe('독립 종합리포트 페이지 제거 — Report.jsx로 완전히 흡수됨', () => {
  it('pages/ComprehensiveReport.jsx 파일이 더 이상 존재하지 않는다', () => {
    expect(existsSync(join(process.cwd(), 'src/pages/ComprehensiveReport.jsx'))).toBe(false);
  });

  it('App.jsx가 더 이상 ComprehensiveReport를 import하지 않는다', () => {
    const src = readSrc('src', 'App.jsx');
    expect(src).not.toContain("from './pages/ComprehensiveReport'");
  });

  it('/summary 라우트는 /report로 리다이렉트한다(기존 북마크/딥링크 보존)', () => {
    const src = readSrc('src', 'App.jsx');
    expect(src).toMatch(/<Route path="\/summary"\s+element=\{<Navigate to="\/report" replace \/>\}/);
  });

  it('AppLayout 메뉴에 더 이상 별도 종합리포트 항목이 없다(리포트 하나로 통합)', () => {
    const src = readSrc('src', 'components', 'layout', 'AppLayout.jsx');
    expect(src).not.toContain("path:'/summary'");
    // NAV 배열 안의 실제 메뉴 항목(label:'종합리포트')이 없어야 한다 — 설명
    // 주석에서 '종합리포트'라는 단어 자체를 언급하는 것과는 별개로 확인.
    expect(src).not.toMatch(/label:'종합리포트'/);
    // '리포트' 메뉴 자체는 그대로 있어야 한다.
    expect(src).toContain("path:'/report'");
  });
});

describe('Report.jsx의 ComprehensiveReportSection — 독립 페이지 기능을 빠짐없이 흡수', () => {
  const src = readSrc('src', 'pages', 'Report.jsx');
  const start = src.indexOf('function ComprehensiveReportSection(');
  const end = src.indexOf('\nconst GUIDE_STATUS_TONE', start);
  const body = src.slice(start, end);

  it('findAnomalies로 이상 데이터를 판정한다(독립 페이지에서 이관)', () => {
    expect(src).toContain("import { findAnomalies } from '../ai-measure/core/comprehensiveReport';");
    expect(body).toContain('findAnomalies(records)');
  });

  it('이상 데이터 개별 삭제(handleDelete)와 일괄 삭제(handleDeleteAllAnomalies)를 제공한다', () => {
    expect(body).toContain('const handleDelete = async (record, why');
    expect(body).toContain('const handleDeleteAllAnomalies = async ()');
    expect(body).toContain('deleteMeasureRecord(member.id, record)');
  });

  it('삭제 전 확인창을 띄운다(되돌릴 수 없는 삭제라 항상 확인)', () => {
    expect(body).toContain('window.confirm(');
  });

  it('삭제 후 onRecordsChanged로 상위(dataReady)에 새로고침을 알린다(페이지 다른 섹션과 정합성 유지)', () => {
    expect(body).toContain('onRecordsChanged?.()');
    const callSiteIdx = src.indexOf('<ComprehensiveReportSection');
    const callSiteEnd = src.indexOf('/>', callSiteIdx);
    const callSite = src.slice(callSiteIdx, callSiteEnd);
    expect(callSite).toContain('onRecordsChanged={() => setDataReady((v) => v + 1)}');
  });

  it('트렌드 그래프(TrendChart)와 상태 토큰은 독립 페이지엔 없던, 기존에 이미 더 완성도 높던 기능이라 그대로 유지된다', () => {
    expect(body).toContain('TrendChart');
    expect(body).toContain('scoreToStatus');
  });
});
