// src/components/common/MomiHud.jsx
// [모미 HUD 2026-09] "모미가 인식할 때 화면에서 바로 보여야 한다"는 요청 대응.
// 예전엔 오브 옆에 작은 검은 말풍선 하나로 인식 결과를 보여줬다 — 키오스크처럼
// 몇 미터 떨어져서 곁눈질로 보는 상황에서는 (1) 지금 듣고 있는 건지, (2) 방금
// 제대로 알아들었는지가 전혀 눈에 안 들어왔다. 그래서 상태에 따라 크기·색·
// 기하 도형이 전부 달라지는 HUD로 바꾼다:
//   - 대기(idle)   : 거의 안 보이게 작게 접힘(방해 X)
//   - 듣는 중       : 크게 펼쳐지며 청록색, 도형이 회전·확장하고 마이크 음량에
//                    맞춰 12방향 눈금이 실시간으로 튄다
//   - 인식 성공     : 초록색으로 확 커지며 도형이 터지듯 퍼짐
//   - 못 알아들음   : 빨간색으로 흔들림
//   - 생각/답변 중  : 보라/파랑으로 도형 회전 속도가 바뀜
// 도형은 삼각형→사각형→육각형을 서로 교차 페이드시켜 "계속 변하는" 인상을 준다
// (SVG polygon의 points는 CSS로 보간이 안 되므로, 겹쳐놓고 번갈아 보여주는 방식).
//
// 모든 props는 선택 — 안 넘기면 조용히 접힌 상태로만 뜬다.
import { useEffect, useRef, useState } from 'react';

const STATUS_COPY = {
  idle: 'MOMI 대기',
  listening: '듣는 중',
  thinking: '생각하는 중',
  speaking: '답하는 중',
  error: '확인 필요',
};

const FLASH_MS = 1000;

// 정삼각형·정사각형·정육각형의 꼭짓점을 (60,60) 중심 반지름 r로 생성한다.
function polygonPoints(sides, radius, rotationDeg = 0) {
  const points = [];
  for (let i = 0; i < sides; i += 1) {
    const angle = ((360 / sides) * i + rotationDeg - 90) * (Math.PI / 180);
    points.push(`${(60 + radius * Math.cos(angle)).toFixed(2)},${(60 + radius * Math.sin(angle)).toFixed(2)}`);
  }
  return points.join(' ');
}

// 음량 눈금 — 12방향으로 뻗는 막대. 각도만 미리 계산해두고 길이는 CSS 변수로 준다.
const TICKS = Array.from({ length: 12 }, (_, i) => i * 30);

export default function MomiHud({
  state = 'idle',
  text = '',
  confidence = null,
  level = 0,
  flashKind = null,
  flashSeq = 0,
  align = 'right',
}) {
  const [activeFlash, setActiveFlash] = useState(null);
  const lastSeqRef = useRef(0);

  useEffect(() => {
    if (!flashSeq || flashSeq === lastSeqRef.current) return undefined;
    lastSeqRef.current = flashSeq;
    setActiveFlash(flashKind);
    const timer = setTimeout(() => setActiveFlash(null), FLASH_MS);
    return () => clearTimeout(timer);
  }, [flashSeq, flashKind]);

  const clampedLevel = Math.max(0, Math.min(1, level || 0));
  const hasConfidence = confidence !== null && confidence !== undefined;
  const pct = hasConfidence ? Math.round(Math.max(0, Math.min(1, confidence)) * 100) : null;
  // 신뢰도 막대 10칸 중 몇 칸을 채울지.
  const filledBars = hasConfidence ? Math.round((pct / 100) * 10) : 0;
  const active = state !== 'idle';
  const statusText = activeFlash === 'matched'
    ? '인식 완료'
    : activeFlash === 'mismatch'
      ? '못 알아들었어요'
      : STATUS_COPY[state] || STATUS_COPY.idle;

  return (
    <div
      className={[
        'momi-hud',
        `momi-hud--${state}`,
        active ? 'momi-hud--active' : '',
        activeFlash ? `momi-hud--flash-${activeFlash}` : '',
        align === 'left' ? 'momi-hud--left' : '',
      ].filter(Boolean).join(' ')}
      style={{ '--lv': clampedLevel }}
      role="status"
      aria-live="polite"
    >
      <svg className="momi-hud__geo" viewBox="0 0 120 120" aria-hidden="true">
        {/* 바깥 점선 링 — 상태별로 회전 속도가 다르다. */}
        <circle className="momi-hud__ring momi-hud__ring--outer" cx="60" cy="60" r="54" />
        <circle className="momi-hud__ring momi-hud__ring--inner" cx="60" cy="60" r="44" />

        {/* 음량 눈금 — 실제 마이크 크기에 맞춰 길이가 실시간으로 늘었다 줄었다 한다. */}
        <g className="momi-hud__ticks">
          {TICKS.map((angle) => (
            <line
              key={angle}
              x1="60"
              y1="14"
              x2="60"
              y2="30"
              pathLength="1"
              transform={`rotate(${angle} 60 60)`}
            />
          ))}
        </g>

        {/* 변화무쌍한 기하 도형 — 삼각형/사각형/육각형을 교차 페이드 + 역회전. */}
        <g className="momi-hud__shapes">
          <polygon className="momi-hud__shape momi-hud__shape--s1" points={polygonPoints(3, 32)} />
          <polygon className="momi-hud__shape momi-hud__shape--s2" points={polygonPoints(4, 30, 45)} />
          <polygon className="momi-hud__shape momi-hud__shape--s3" points={polygonPoints(5, 32)} />
          <polygon className="momi-hud__shape momi-hud__shape--s4" points={polygonPoints(6, 32)} />
          {/* 안쪽에서 반대로 도는 작은 도형 한 겹 더 — 겹쳐 돌면서 계속 모양이 바뀌는 인상을 준다. */}
          <polygon className="momi-hud__shape momi-hud__shape--in" points={polygonPoints(3, 17, 180)} />
        </g>

        {/* 레이더 스윕 — "지금 듣고 있다"를 한눈에 알리는 회전 빔. */}
        <line className="momi-hud__sweep" x1="60" y1="60" x2="60" y2="18" />

        {/* 궤도를 도는 점 + 중심 코어(음량에 따라 커짐). */}
        <circle className="momi-hud__orbit-dot" cx="60" cy="20" r="2.6" />
        <circle className="momi-hud__core" cx="60" cy="60" r="9" />

        {activeFlash === 'matched' && (
          <g key={`ok-${flashSeq}`} className="momi-hud__burst">
            <polygon points={polygonPoints(6, 26)} />
            <polygon points={polygonPoints(3, 22)} />
          </g>
        )}
        {activeFlash === 'mismatch' && (
          <g key={`ng-${flashSeq}`} className="momi-hud__burst momi-hud__burst--bad">
            <line x1="44" y1="44" x2="76" y2="76" />
            <line x1="76" y1="44" x2="44" y2="76" />
          </g>
        )}
      </svg>

      <div className="momi-hud__body">
        <div className="momi-hud__status">
          <span className="momi-hud__pip" />
          {statusText}
        </div>
        {text ? <div className="momi-hud__text">{text}</div> : null}
        {hasConfidence && (
          <div className="momi-hud__meter" title={`인식 신뢰도 ${pct}%`}>
            <div className="momi-hud__bars">
              {Array.from({ length: 10 }, (_, i) => (
                <span key={i} className={i < filledBars ? 'on' : ''} style={{ '--bar-i': i }} />
              ))}
            </div>
            <span className="momi-hud__pct">{pct}%</span>
          </div>
        )}
      </div>

      <style>{`
        /* color-mix를 못 쓰는 구형 브라우저에서도 테두리·그림자가 사라지지 않도록
           먼저 안전한 rgba 값을 깔고, 그 뒤에 color-mix 버전으로 덮어쓴다. */
        .momi-hud{--hud:#27eee5;--hud2:#16a6c2;position:relative;display:flex;align-items:center;gap:14px;
          padding:12px 18px 12px 12px;border-radius:20px;
          background:linear-gradient(135deg,rgba(2,18,22,.95),rgba(0,8,11,.98));border:1.5px solid rgba(56,236,226,.4);
          box-shadow:0 0 calc(20px + 30px*var(--lv,0)) rgba(22,210,205,.38),0 10px 30px rgba(0,0,0,.55);
          color:#eafeff;max-width:min(80vw,440px);transform-origin:var(--hud-origin,100% 100%);transform:scale(.8);opacity:.5;
          transition:transform .34s cubic-bezier(.2,1.5,.4,1),opacity .24s,box-shadow .14s,border-color .3s;backdrop-filter:blur(7px)}
        /* HUD다운 코너 브래킷 — 인식 중에는 바깥으로 벌어지며 프레임이 살아난다. */
        .momi-hud::before,.momi-hud::after{content:'';position:absolute;width:16px;height:16px;border:2px solid var(--hud);
          opacity:0;transition:opacity .3s,inset .3s;pointer-events:none}
        .momi-hud::before{top:6px;left:6px;border-right:0;border-bottom:0;border-radius:8px 0 0 0}
        .momi-hud::after{bottom:6px;right:6px;border-left:0;border-top:0;border-radius:0 0 8px 0}
        .momi-hud--active::before{opacity:.85;top:-3px;left:-3px}
        .momi-hud--active::after{opacity:.85;bottom:-3px;right:-3px}
        @supports (color:color-mix(in srgb,red 50%,transparent)){
          .momi-hud{border-color:color-mix(in srgb,var(--hud) 50%,transparent);
            box-shadow:0 0 calc(20px + 32px*var(--lv,0)) color-mix(in srgb,var(--hud) calc(22% + 38%*var(--lv,0)),transparent),0 10px 30px rgba(0,0,0,.55)}
          .momi-hud__text{text-shadow:0 0 14px color-mix(in srgb,var(--hud) 50%,transparent)}
        }
        .momi-hud--left{--hud-origin:0% 50%}
        .momi-hud--active{transform:scale(1);opacity:1}
        .momi-hud--listening{--hud:#27eee5;--hud2:#22c8ff}
        .momi-hud--thinking{--hud:#a78bfa;--hud2:#8d71ff}
        .momi-hud--speaking{--hud:#38bdf8;--hud2:#22d3ee}
        .momi-hud--error{--hud:#fb7185;--hud2:#f59e0b}
        .momi-hud--flash-matched{--hud:#34e0a1;--hud2:#7dffcf;transform:scale(1.1);border-color:#34e0a1;
          box-shadow:0 0 60px rgba(52,224,161,.7),0 10px 30px rgba(0,0,0,.55)}
        .momi-hud--flash-mismatch{--hud:#fb7185;--hud2:#f43f5e;animation:momi-hud-shake .5s ease-in-out}

        /* 도형 캔버스 — 대기 땐 작게, 말을 걸면 눈에 띄게 커진다. overflow는 기본값
           (hidden)으로 둬서 도형이 패널 밖으로 새지 않게 한다. */
        .momi-hud__geo{width:62px;height:62px;flex:0 0 auto;transition:width .34s,height .34s}
        .momi-hud--active .momi-hud__geo{width:96px;height:96px}
        .momi-hud__ring{fill:none;stroke:var(--hud);opacity:.4;transform-origin:60px 60px}
        .momi-hud__ring--outer{stroke-width:1.4;stroke-dasharray:4 8;animation:momi-hud-spin 12s linear infinite}
        .momi-hud__ring--inner{stroke-width:1;stroke-dasharray:1 6;stroke:var(--hud2);animation:momi-hud-spin 9s linear infinite reverse}
        .momi-hud--active .momi-hud__ring{opacity:.65}
        .momi-hud--active .momi-hud__ring--outer{animation-duration:4.5s}
        .momi-hud--active .momi-hud__ring--inner{animation-duration:3.2s}
        .momi-hud--thinking .momi-hud__ring--outer{animation-duration:1.8s}

        /* 음량 눈금 — pathLength=1로 길이를 정규화해두고 dashoffset으로 "얼마나
           그릴지"를 조절한다. SVG의 x1/y1은 CSS로 못 바꾸지만 dash 계열은 CSS
           속성이라 이 방식이 안전하다(= 소리가 클수록 눈금이 길어진다). */
        .momi-hud__ticks{transform-origin:60px 60px;transform:scale(calc(1 + .07*var(--lv,0)));transition:transform .08s linear}
        .momi-hud__ticks line{stroke:var(--hud);stroke-width:3;stroke-linecap:round;opacity:calc(.2 + .8*var(--lv,0));
          stroke-dasharray:1;stroke-dashoffset:calc(.75 - .75*var(--lv,0));
          transition:opacity .08s linear,stroke-dashoffset .08s linear}

        /* 변화무쌍한 기하 도형 — 삼각→사각→오각→육각이 서로 자리를 넘겨받으며
           회전/확대되고, 안쪽 도형은 반대로 돈다. */
        .momi-hud__shape{fill:none;stroke:var(--hud);stroke-width:2;stroke-linejoin:round;opacity:0;transform-origin:60px 60px}
        .momi-hud__shape--s1{animation:momi-hud-morph1 7.2s ease-in-out infinite}
        .momi-hud__shape--s2{stroke:var(--hud2);animation:momi-hud-morph2 7.2s ease-in-out infinite}
        .momi-hud__shape--s3{animation:momi-hud-morph3 7.2s ease-in-out infinite}
        .momi-hud__shape--s4{stroke:var(--hud2);animation:momi-hud-morph4 7.2s ease-in-out infinite}
        .momi-hud__shape--in{stroke-width:1.6;opacity:.55;animation:momi-hud-spin 6s linear infinite reverse}
        .momi-hud--active .momi-hud__shape--s1,.momi-hud--active .momi-hud__shape--s2,
        .momi-hud--active .momi-hud__shape--s3,.momi-hud--active .momi-hud__shape--s4{animation-duration:3.2s}
        .momi-hud--active .momi-hud__shape--in{animation-duration:2.2s;opacity:.8}

        .momi-hud__sweep{stroke:var(--hud);stroke-width:2.4;stroke-linecap:round;opacity:0;transform-origin:60px 60px;
          animation:momi-hud-spin 3.4s linear infinite}
        .momi-hud--active .momi-hud__sweep{opacity:.55}
        .momi-hud--listening .momi-hud__sweep{animation-duration:1.9s}
        .momi-hud__orbit-dot{fill:#d8ffff;opacity:0;transform-origin:60px 60px;animation:momi-hud-spin 2.6s linear infinite}
        .momi-hud--active .momi-hud__orbit-dot{opacity:.9}
        .momi-hud__core{fill:var(--hud);opacity:.28;transform-origin:60px 60px;
          transform:scale(calc(1 + .95*var(--lv,0)));transition:transform .08s linear;filter:drop-shadow(0 0 7px var(--hud))}
        .momi-hud--active .momi-hud__core{opacity:calc(.4 + .5*var(--lv,0));animation:momi-hud-pulse 1.8s ease-in-out infinite}

        .momi-hud__burst polygon{fill:none;stroke:#7dffcf;stroke-width:3;transform-origin:60px 60px;
          animation:momi-hud-burst 1s ease-out forwards}
        .momi-hud__burst polygon:nth-child(2){animation-delay:.12s;stroke:#34e0a1}
        .momi-hud__burst--bad line{stroke:#fb7185;stroke-width:4;stroke-linecap:round;transform-origin:60px 60px;
          animation:momi-hud-x .7s ease-out forwards}

        .momi-hud__body{min-width:0;display:flex;flex-direction:column;gap:5px}
        .momi-hud__status{display:flex;align-items:center;gap:7px;font-size:11px;font-weight:800;letter-spacing:.1em;
          text-transform:uppercase;color:var(--hud);transition:color .3s}
        .momi-hud--active .momi-hud__status{font-size:12px}
        .momi-hud__pip{width:8px;height:8px;border-radius:50%;background:var(--hud);box-shadow:0 0 10px var(--hud)}
        .momi-hud--active .momi-hud__pip{animation:momi-hud-pip 1.1s ease-in-out infinite}
        .momi-hud__text{font-size:16px;font-weight:700;line-height:1.35;white-space:pre-line;word-break:keep-all;
          text-shadow:0 0 14px rgba(39,238,229,.5);transition:font-size .2s,color .3s}
        .momi-hud--active .momi-hud__text{font-size:20px}
        .momi-hud--flash-matched .momi-hud__text{color:#c4ffe9}
        .momi-hud--flash-mismatch .momi-hud__text{color:#ffd7dd}
        .momi-hud__meter{display:flex;align-items:center;gap:9px;margin-top:3px}
        .momi-hud__bars{display:flex;gap:3px}
        .momi-hud__bars span{width:9px;height:11px;border-radius:2px;background:rgba(255,255,255,.14);
          transform:skewX(-18deg);transition:background .25s,transform .25s}
        .momi-hud__bars span.on{background:var(--hud);box-shadow:0 0 8px var(--hud);
          animation:momi-hud-bar .5s ease-out both;animation-delay:calc(var(--bar-i) * 35ms)}
        .momi-hud__pct{font-size:12px;font-weight:800;color:var(--hud);font-variant-numeric:tabular-nums}

        @keyframes momi-hud-spin{to{transform:rotate(360deg)}}
        @keyframes momi-hud-pulse{50%{opacity:.8}}
        @keyframes momi-hud-pip{50%{opacity:.2;transform:scale(.75)}}
        @keyframes momi-hud-bar{from{transform:skewX(-18deg) scaleY(.2)}to{transform:skewX(-18deg) scaleY(1)}}
        @keyframes momi-hud-morph1{0%,18%{opacity:.95;transform:rotate(0) scale(1)}26%,100%{opacity:0;transform:rotate(72deg) scale(.82)}}
        @keyframes momi-hud-morph2{0%,18%{opacity:0;transform:rotate(-40deg) scale(.82)}26%,43%{opacity:.95;transform:rotate(0) scale(1)}51%,100%{opacity:0;transform:rotate(72deg) scale(.82)}}
        @keyframes momi-hud-morph3{0%,43%{opacity:0;transform:rotate(-40deg) scale(.82)}51%,68%{opacity:.95;transform:rotate(0) scale(1)}76%,100%{opacity:0;transform:rotate(72deg) scale(.82)}}
        @keyframes momi-hud-morph4{0%,68%{opacity:0;transform:rotate(-40deg) scale(.82)}76%,93%{opacity:.95;transform:rotate(0) scale(1)}100%{opacity:0;transform:rotate(40deg) scale(.86)}}
        @keyframes momi-hud-burst{0%{opacity:1;transform:scale(.35)}100%{opacity:0;transform:scale(1.75) rotate(60deg)}}
        @keyframes momi-hud-x{0%{opacity:0;transform:scale(.5)}35%{opacity:1;transform:scale(1.12)}100%{opacity:0;transform:scale(1)}}
        @keyframes momi-hud-shake{0%,100%{transform:scale(1.02) translateX(0)}20%{transform:scale(1.04) translateX(-7px)}40%{transform:scale(1.04) translateX(7px)}60%{transform:scale(1.03) translateX(-5px)}80%{transform:scale(1.03) translateX(5px)}}
        @media(max-width:480px){.momi-hud{max-width:74vw;padding:10px 14px 10px 10px;gap:10px}
          .momi-hud--active .momi-hud__geo{width:74px;height:74px}
          .momi-hud--active .momi-hud__text{font-size:17px}}
        @media(prefers-reduced-motion:reduce){.momi-hud,.momi-hud *{animation-duration:.001s!important;animation-iteration-count:1!important;transition:none!important}
          .momi-hud__shape--s4{opacity:.9}}
      `}</style>
    </div>
  );
}
