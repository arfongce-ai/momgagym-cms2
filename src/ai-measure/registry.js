import { lazy } from 'react';

// AI 측정 · 분석 탭 등록부.
//  탭 순서(no)는 측정 흐름 순서를 따른다:
//   1 신체 정보(기본) → 2 자세·체형(정적) → 3 ROM(가동성) → 4 보행·러닝(이동)
//   → 5 점프·RSI(파워) → 6 바벨 리프팅(근력) → 7 한다리서기(SLST, 균형)
//   → 8 오버헤드 딥 스쿼트(균형+가동성 복합) → 9 전/후 비교(오버레이) →
//   10 일반 녹화 · 11 초시계 (도구, 항상 맨 마지막 — 기존 테스트 불변식:
//   정렬 후 timer가 배열 끝).
//  '던지기(throw)'·'스윙(swing)' 준비 중 탭은 제거됨(2607 요청).
//  7번(SLST)·8번(스쿼트) 모두 실시간·업로드 둘 다 지원.
//  [전/후 비교 추가] 사진/영상 오버레이·어니언 스킨 비교 도구. 다른 측정처럼
//  값을 산출/저장하지 않는 시각 비교 도구라 개별 항목들 뒤, 도구(녹화/초시계)
//  바로 앞에 둔다.
export const MEASURE_MENUS = [
  {
    id: 'body',
    no: 1,
    title: '신체 정보',
    desc: '키, 몸무게, 혈압 입력 및 분석',
    icon: 'BIO',
    status: 'ready',
    component: lazy(() => import('./menus/BodyInfoMeasure.jsx')),
  },
  {
    id: 'posture',
    no: 2,
    title: '자세·체형 측정',
    desc: 'Posture score, Body age, CoG, Ghosting',
    icon: 'BAL',
    status: 'ready',
    component: lazy(() => import('./menus/PostureMeasure.jsx')),
  },
  {
    id: 'rom',
    no: 3,
    title: 'ROM 좌우 비교',
    desc: '관절 가동범위 및 좌우 대칭',
    icon: 'ROM',
    status: 'ready',
    component: lazy(() => import('./menus/RomMeasure.jsx')),
  },
  {
    id: 'gait',
    no: 4,
    title: '보행 & 러닝',
    desc: '측면/정면, 각도, 케이던스, 주기 분석',
    icon: 'RUN',
    status: 'ready',
    component: lazy(() => import('./menus/GaitAnalysisHub.jsx')),
  },
  {
    id: 'jump',
    no: 5,
    title: '점프 & RSI',
    desc: '반동점프, 반응탄성, 고속영상/수동 분석',
    icon: 'JMP',
    status: 'ready',
    component: lazy(() => import('./menus/JumpAnalysisHub.jsx')),
  },
  {
    id: 'lifting',
    no: 6,
    title: '바벨 리프팅',
    desc: 'VBT 속도 · 1RM 추정 · 고속영상 분석',
    icon: 'BAR',
    status: 'ready',
    component: lazy(() => import('./menus/BarbellLiftingHub.jsx')),
  },
  {
    id: 'stance',
    no: 7,
    title: '한다리서기 (SLST)',
    desc: '균형 능력, 좌우 비대칭 — 실시간 카메라·영상 업로드',
    icon: 'LEG',
    status: 'ready',
    component: lazy(() => import('./menus/StanceAnalysisHub.jsx')),
  },
  {
    id: 'squat',
    no: 8,
    title: '오버헤드 딥 스쿼트',
    desc: '깊이·상체 기울기·무릎 정렬·골반 — 실시간 카메라·영상 업로드',
    icon: 'SQT',
    status: 'ready',
    component: lazy(() => import('./menus/SquatAnalysisHub.jsx')),
  },
  {
    id: 'compare',
    no: 9,
    title: '전/후 비교 (오버레이)',
    desc: '사진·영상 오버레이 · 어니언 스킨 비교, 발목 기준 자동 정렬',
    icon: 'CMP',
    status: 'ready',
    component: lazy(() => import('./menus/OverlayCompare.jsx')),
  },
  {
    id: 'record',
    no: 10,
    title: '일반 영상 녹화',
    desc: '카메라 녹화 및 저장',
    icon: 'REC',
    status: 'ready',
    component: lazy(() => import('./menus/RecordMeasure.jsx')),
  },
  {
    id: 'timer',
    no: 11,
    title: '초시계·메트로놈',
    desc: '초시계, 타이머, 인터벌, 메트로놈',
    icon: 'TMR',
    status: 'ready',
    component: lazy(() => import('./menus/TimerTool.jsx')),
  },
];
