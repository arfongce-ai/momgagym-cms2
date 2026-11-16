// [근육 경향 그림 개선 2026-11-15]
// 타원 표시 → 근육 모양 그대로 색칠하는 앞·뒤 해부도(직접 그린 SVG, 외부 패키지 없음).
// 왼쪽 절반만 정의하고 좌우 대칭으로 복제한다. 근육 묶음은 postureClinical.buildMuscleMap
// 의 부위(region)별 긴장/약화 근육과 1:1로 맞춘다 — 근육 이름 문구는 그쪽 한 곳에서만 관리.
import React from 'react';

// 근육 조각(왼쪽 절반, viewBox 200x400 기준)
const FRONT = {
  neckFlexor: 'M92 50 L95 70 L100 73 L100 50 Z',
  trapFront: 'M90 62 Q78 68 68 75 L88 74 Z',
  deltoid: 'M67 76 Q54 79 51 98 Q55 108 62 104 Q64 90 72 83 Z',
  pec: 'M73 81 Q86 75 99 79 L99 110 Q86 117 73 108 Q69 95 73 81 Z',
  biceps: 'M53 104 Q48 124 53 140 L61 140 Q65 122 63 106 Z',
  forearm: 'M52 143 Q47 166 52 190 L59 190 Q63 166 61 143 Z',
  oblique: 'M75 112 Q81 138 80 162 L88 166 L88 118 Z',
  abs: 'M90 116 L99 116 L99 184 L90 184 Q88 150 90 116 Z',
  hipFlexor: 'M80 170 Q84 186 93 196 L98 190 L89 174 Z',
  itBand: 'M72 194 Q67 238 73 280 L77 280 Q72 238 76 194 Z',
  quad: 'M77 196 Q73 240 79 281 L92 283 Q96 240 94 201 Z',
  adductor: 'M95 202 Q98 232 96 262 L99 262 L99 199 Z',
  tibialis: 'M80 297 Q78 330 82 362 L88 362 Q90 330 89 297 Z',
  calfInner: 'M90 297 Q96 322 94 352 L98 352 L98 297 Z',
};
const BACK = {
  suboccipital: 'M92 50 L94 64 L100 66 L100 50 Z',
  trapUpper: 'M100 64 L92 64 Q80 69 68 76 L86 84 L100 84 Z',
  trapLower: 'M86 85 L100 85 L100 150 Q93 122 86 100 Z',
  rhomboid: 'M88 88 L97 88 L97 116 Q92 106 88 98 Z',
  deltoid: 'M67 76 Q54 79 51 98 Q55 108 62 104 Q64 90 72 83 Z',
  triceps: 'M53 104 Q48 124 53 140 L61 140 Q65 122 63 106 Z',
  forearm: 'M52 143 Q47 166 52 190 L59 190 Q63 166 61 143 Z',
  lat: 'M72 98 Q69 130 81 160 L90 160 Q87 128 84 102 Z',
  erector: 'M91 150 L99 150 L99 186 L90 186 Q88 168 91 150 Z',
  ql: 'M82 162 L90 162 L89 186 L80 182 Z',
  gluteMed: 'M74 180 Q75 194 83 197 L90 188 Q84 179 74 180 Z',
  gluteMax: 'M80 195 Q75 214 86 227 Q98 229 99 219 L99 193 Q90 189 80 195 Z',
  itBand: 'M72 196 Q67 238 73 280 L77 280 Q72 238 76 198 Z',
  hamstring: 'M77 229 Q73 260 80 283 L94 283 Q98 257 96 229 Z',
  calf: 'M78 297 Q73 322 82 348 L91 348 Q95 322 91 297 Z',
  tibPost: 'M92 302 Q96 330 92 354 L98 354 L98 302 Z',
};

// 부위(region) → 긴장(tight)/약화(weak) 근육 조각
export const REGION_MUSCLES = {
  head_neck: { tight: ['front.trapFront', 'back.trapUpper', 'back.suboccipital'], weak: ['front.neckFlexor'] },
  shoulder_back: { tight: ['front.pec'], weak: ['back.trapLower', 'back.rhomboid'] },
  pelvis_spine: { tight: ['back.ql', 'front.hipFlexor'], weak: ['back.gluteMed', 'front.abs'] },
  foot_leg: { tight: ['front.itBand', 'back.itBand', 'back.calf'], weak: ['back.gluteMax', 'back.tibPost'] },
};

const TIGHT = '#ef4444';
const WEAK = '#3b82f6';

export function muscleStates(regions = []) {
  const state = {};
  regions.forEach((r) => {
    const m = REGION_MUSCLES[r];
    if (!m) return;
    m.weak.forEach((k) => { if (!state[k]) state[k] = 'weak'; });
    m.tight.forEach((k) => { state[k] = 'tight'; }); // 겹치면 긴장 우선
  });
  return state;
}

function Silhouette() {
  return (
    <g className="text-slate-100 dark:text-slate-800" fill="currentColor" stroke="currentColor">
      <ellipse cx="100" cy="30" rx="17" ry="21" />
      <path d="M90 48 L110 48 L112 66 L88 66 Z" />
      <path d="M100 66 Q76 66 62 76 Q48 82 48 102 L46 192 L62 192 L66 110 L72 112 Q76 150 76 172 Q70 200 72 282 L76 300 Q72 340 78 372 L74 384 L98 384 L97 300 L99 210 L101 210 L103 300 L102 384 L126 384 L122 372 Q128 340 124 300 L128 282 Q130 200 124 172 Q124 150 128 112 L134 110 L138 192 L154 192 L152 102 Q152 82 138 76 Q124 66 100 66 Z" />
    </g>
  );
}

function Half({ parts, view, state }) {
  return Object.entries(parts).map(([name, d]) => {
    const s = state[`${view}.${name}`];
    const fill = s === 'tight' ? TIGHT : s === 'weak' ? WEAK : undefined;
    return (
      <path
        key={name}
        d={d}
        className={fill ? '' : 'text-slate-300 dark:text-slate-600'}
        fill={fill || 'currentColor'}
        fillOpacity={fill ? 0.85 : 1}
        stroke="#ffffff"
        strokeOpacity="0.9"
        strokeWidth="0.8"
        strokeLinejoin="round"
        data-muscle={`${view}.${name}`}
        data-state={s || 'none'}
      />
    );
  });
}

export default function MuscleAnatomyFigure({ view = 'front', regions = [], label }) {
  const parts = view === 'back' ? BACK : FRONT;
  const state = muscleStates(regions);
  return (
    <figure className="m-0">
      <svg viewBox="40 0 120 392" className="mx-auto block w-full max-w-[140px]" role="img" aria-label={`${label || view} 근육 경향`}>
        <Silhouette />
        <g><Half parts={parts} view={view} state={state} /></g>
        <g transform="translate(200 0) scale(-1 1)"><Half parts={parts} view={view} state={state} /></g>
        {view === 'front' && <ellipse cx="85" cy="288" rx="5" ry="6" className="text-slate-300 dark:text-slate-600" fill="currentColor" />}
        {view === 'front' && <ellipse cx="115" cy="288" rx="5" ry="6" className="text-slate-300 dark:text-slate-600" fill="currentColor" />}
      </svg>
      {label && <figcaption className="mt-1 text-center text-[11px] font-bold text-slate-500">{label}</figcaption>}
    </figure>
  );
}
