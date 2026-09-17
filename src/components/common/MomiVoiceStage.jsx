// src/components/common/MomiVoiceStage.jsx
// [전체화면 오브 2026-09b] "음성 인식 중에는 오브가 화면 전체로 커지고, 인식이
// 끝나면 HUD로 접히면서 대기 상태로 돌아간다"는 요청 대응.
//
// 흐름(phase):
//   open       — 화면 전체를 덮으며 오브가 크게 열린다. 지금 듣고 있다는 걸
//                멀리서도 알 수 있고, 말하는 동안 실시간 자막이 크게 뜬다.
//   collapsing — 인식이 끝난 순간. 오브가 초록으로 번쩍이며 HUD가 있는
//                모서리 방향으로 빨려들듯 축소·페이드된다(약 0.5초).
//   (그 뒤 부모가 이 컴포넌트를 내리고, 결과는 코너 HUD가 이어받는다 = 대기)
//
// 주의 — 이 무대는 화면을 통째로 덮기 때문에:
//   * interactive=false(키오스크 기본)면 pointer-events를 꺼서 뒤쪽 화면 조작을
//     전혀 막지 않는다. 상시 감지 기기라 사람이 계속 화면을 쓰고 있기 때문이다.
//   * interactive=true(폰/버튼 모드)면 아무 데나 눌러서 바로 닫을 수 있다.
//   * 측정 카메라 화면이 떠 있을 때는 부모가 아예 열지 않는다(가리면 안 되므로).
import MomiVoiceOrb from './MomiVoiceOrb';

// 접히는 애니메이션 길이(아래 CSS의 .5s와 맞춰야 한다) — 부모가 이 시간 뒤에
// 무대를 내리고 HUD로 넘긴다.
export const STAGE_COLLAPSE_MS = 500;

const PROMPT = {
  listening: '말씀하세요',
  thinking: '생각하고 있어요',
  speaking: '답하고 있어요',
  error: '다시 확인해 주세요',
  idle: '',
};

// 오브를 둘러싸는 큰 음량 눈금 — 24방향. 전체화면에서는 이 고리가 "듣고 있다"를
// 가장 강하게 보여주는 요소라 HUD(12방향)보다 촘촘하게 둔다.
const RING_TICKS = Array.from({ length: 24 }, (_, i) => i * 15);

export default function MomiVoiceStage({
  phase = 'open',            // 'open' | 'collapsing'
  state = 'listening',
  text = '',
  confidence = null,
  level = 0,
  interactive = false,
  collapseTo = 'bottom-right', // HUD가 있는 방향 — 그쪽으로 빨려들어간다
  onDismiss,
}) {
  const clampedLevel = Math.max(0, Math.min(1, level || 0));
  const hasConfidence = confidence !== null && confidence !== undefined;
  const pct = hasConfidence ? Math.round(Math.max(0, Math.min(1, confidence)) * 100) : null;

  return (
    <div
      className={[
        'momi-stage',
        `momi-stage--${state}`,
        `momi-stage--${phase}`,
        `momi-stage--to-${collapseTo}`,
        interactive ? 'momi-stage--interactive' : '',
      ].filter(Boolean).join(' ')}
      style={{ '--lv': clampedLevel }}
      onClick={interactive && onDismiss ? onDismiss : undefined}
      role="presentation"
    >
      <div className="momi-stage__inner">
        <div className="momi-stage__orbwrap">
          {/* 오브를 감싸는 대형 눈금 고리 — 실제 마이크 음량(노이즈 게이트를 통과한
              사람 목소리)에 맞춰 길이와 밝기가 살아 움직인다. */}
          <svg className="momi-stage__ring" viewBox="0 0 200 200" aria-hidden="true">
            <circle className="momi-stage__ring-line" cx="100" cy="100" r="92" />
            <circle className="momi-stage__ring-line momi-stage__ring-line--b" cx="100" cy="100" r="84" />
            <g className="momi-stage__ticks">
              {RING_TICKS.map((angle) => (
                <line
                  key={angle}
                  x1="100"
                  y1="8"
                  x2="100"
                  y2="30"
                  pathLength="1"
                  transform={`rotate(${angle} 100 100)`}
                />
              ))}
            </g>
          </svg>
          <MomiVoiceOrb state={state} size="min(58vw, 38vh)" label={PROMPT[state] || ''} />
        </div>

        <div className="momi-stage__caption">
          <div className="momi-stage__prompt">
            <span className="momi-stage__pip" />
            {PROMPT[state] || ''}
          </div>
          {text ? <div className="momi-stage__text">{text}</div> : (
            <div className="momi-stage__hint">예) “회원 관리 열어줘”, “오늘 예약 알려줘”</div>
          )}
          {hasConfidence && (
            <div className="momi-stage__meter">
              <div className="momi-stage__bars">
                {Array.from({ length: 12 }, (_, i) => (
                  <span key={i} className={i < Math.round((pct / 100) * 12) ? 'on' : ''} />
                ))}
              </div>
              <span className="momi-stage__pct">{pct}%</span>
            </div>
          )}
        </div>
      </div>

      <style>{`
        .momi-stage{position:fixed;inset:0;z-index:1100;display:grid;place-items:center;pointer-events:none;
          background:radial-gradient(circle at 50% 45%,rgba(3,26,31,.82) 0%,rgba(0,6,9,.93) 55%,rgba(0,0,0,.97) 100%);
          backdrop-filter:blur(9px);-webkit-backdrop-filter:blur(9px);
          animation:momi-stage-in .34s cubic-bezier(.2,1.2,.3,1) both}
        .momi-stage--interactive{pointer-events:auto;cursor:pointer}
        .momi-stage__inner{display:flex;flex-direction:column;align-items:center;gap:clamp(12px,2.5vh,28px);max-height:100vh;
          transform-origin:center;transition:transform .5s cubic-bezier(.6,0,.9,.4),opacity .5s ease-in}
        .momi-stage__orbwrap{position:relative;display:grid;place-items:center}

        .momi-stage__ring{position:absolute;width:min(76vw,50vh);height:min(76vw,50vh);overflow:visible;pointer-events:none}
        .momi-stage__ring-line{fill:none;stroke:var(--stage,#27eee5);stroke-width:.6;opacity:.3;stroke-dasharray:2 6;
          transform-origin:100px 100px;animation:momi-stage-spin 22s linear infinite}
        .momi-stage__ring-line--b{stroke-dasharray:1 9;opacity:.2;animation-duration:15s;animation-direction:reverse}
        .momi-stage__ticks{transform-origin:100px 100px;transform:scale(calc(1 + .04*var(--lv,0)));
          transition:transform .09s linear;animation:momi-stage-spin 40s linear infinite}
        .momi-stage__ticks line{stroke:var(--stage,#27eee5);stroke-width:2.4;stroke-linecap:round;
          opacity:calc(.18 + .82*var(--lv,0));stroke-dasharray:1;stroke-dashoffset:calc(.8 - .8*var(--lv,0));
          transition:opacity .09s linear,stroke-dashoffset .09s linear}

        .momi-stage__caption{text-align:center;max-width:min(86vw,720px);color:#eafeff;padding:0 16px}
        .momi-stage__prompt{display:inline-flex;align-items:center;gap:8px;font-size:clamp(12px,1.6vh,14px);font-weight:800;
          letter-spacing:.16em;text-transform:uppercase;color:var(--stage,#27eee5)}
        .momi-stage__pip{width:9px;height:9px;border-radius:50%;background:var(--stage,#27eee5);
          box-shadow:0 0 12px var(--stage,#27eee5);animation:momi-stage-pip 1.1s ease-in-out infinite}
        .momi-stage__text{margin-top:10px;font-size:clamp(22px,4.4vh,44px);font-weight:800;line-height:1.3;word-break:keep-all;
          text-shadow:0 0 26px rgba(39,238,229,.45)}
        .momi-stage__hint{margin-top:10px;font-size:clamp(13px,2vh,17px);font-weight:500;color:#7fa8ad;word-break:keep-all}
        .momi-stage__meter{margin-top:14px;display:flex;align-items:center;justify-content:center;gap:10px}
        .momi-stage__bars{display:flex;gap:4px}
        .momi-stage__bars span{width:12px;height:14px;border-radius:2px;background:rgba(255,255,255,.13);transform:skewX(-18deg)}
        .momi-stage__bars span.on{background:var(--stage,#27eee5);box-shadow:0 0 10px var(--stage,#27eee5)}
        .momi-stage__pct{font-size:14px;font-weight:800;color:var(--stage,#27eee5);font-variant-numeric:tabular-nums}

        .momi-stage--listening{--stage:#27eee5}
        .momi-stage--thinking{--stage:#a78bfa}
        .momi-stage--speaking{--stage:#38bdf8}
        .momi-stage--error{--stage:#fb7185}

        /* 인식 완료 — 초록으로 번쩍인 뒤 HUD가 있는 모서리로 빨려들어간다. */
        .momi-stage--collapsing{--stage:#34e0a1;animation:momi-stage-out .5s ease-in both}
        .momi-stage--collapsing .momi-stage__inner{opacity:0}
        .momi-stage--collapsing.momi-stage--to-bottom-right .momi-stage__inner{transform:scale(.08) translate(46vw,42vh)}
        .momi-stage--collapsing.momi-stage--to-top-right .momi-stage__inner{transform:scale(.08) translate(46vw,-42vh)}

        @keyframes momi-stage-in{from{opacity:0;backdrop-filter:blur(0)}to{opacity:1}}
        @keyframes momi-stage-out{from{opacity:1}to{opacity:0}}
        @keyframes momi-stage-spin{to{transform:rotate(360deg)}}
        @keyframes momi-stage-pip{50%{opacity:.2;transform:scale(.75)}}
        @media(prefers-reduced-motion:reduce){
          .momi-stage,.momi-stage *{animation-duration:.001s!important;animation-iteration-count:1!important}
          .momi-stage__inner{transition:opacity .2s}
          .momi-stage--collapsing .momi-stage__inner{transform:none}
        }
      `}</style>
    </div>
  );
}
