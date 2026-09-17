import { useEffect, useId, useRef, useState } from 'react';

const COPY = {
  idle: 'MOMI 대기 중',
  listening: '듣고 있어요',
  thinking: '생각하고 있어요',
  speaking: '답하고 있어요',
  error: '다시 확인해 주세요',
};

// [정확도 시각화 2026-09] "모미가 제대로 듣고 있는지 화면으로 보여달라"는 요청
// 대응. 예전엔 상태(idle/listening/...)에 따라 정해진 CSS 애니메이션만 도는
// 정적인 오브였다 — 실제로 마이크에 소리가 들어오는지, 방금 알아들은 말을
// 제대로 인식했는지는 화면만 봐서는 전혀 알 수 없었다. 이제 세 가지를 추가로
// 반영한다:
//  1) level(0~1, 실시간 마이크 음량) — 말하는 크기에 맞춰 오브가 실제로 반응함
//  2) confidence(0~1|null) — 인식 엔진이 이번 발화를 얼마나 확신했는지를 색깔
//     고리(초록=높음/노랑=보통/빨강=낮음)로 보여줌
//  3) flashKind('matched'|'mismatch') + flashSeq(매번 바뀌는 값) — 웨이크워드나
//     명령을 "제대로 알아들었을 때"는 초록 파동+반짝임을, "못 알아들었을 때"는
//     빨간 흔들림을 순간적으로 보여줌
// 셋 다 선택 props라 안 넘기면(기존 호출부) 예전과 시각적으로 거의 동일하게
// 동작한다 — 회귀 없음.
function confidenceColor(confidence) {
  if (confidence === null || confidence === undefined) return '#2f4a4f';
  if (confidence >= 0.7) return '#34e0a1';
  if (confidence >= 0.4) return '#ffd166';
  return '#fb7185';
}

const FLASH_DURATION_MS = 900;

/** 음성 상태를 예시 이미지처럼 빛의 파동으로 보여주는 코드 기반 오브. */
export default function MomiVoiceOrb({
  state = 'idle',
  size = 72,
  label,
  button = false,
  level = 0,
  confidence = null,
  flashKind = null,
  flashSeq = 0,
  ...props
}) {
  const uid = useId().replace(/:/g, '');
  const Tag = button ? 'button' : 'div';
  const text = label || COPY[state] || COPY.idle;

  const [activeFlash, setActiveFlash] = useState(null);
  const lastSeqRef = useRef(0);
  useEffect(() => {
    // flashSeq는 매 발화 판정마다(맞았든 틀렸든) 바뀌는 값 — 0(초기값)에서는
    // 아직 아무 판정도 없었다는 뜻이라 아무것도 안 보여준다.
    if (!flashSeq || flashSeq === lastSeqRef.current) return;
    lastSeqRef.current = flashSeq;
    setActiveFlash(flashKind);
    const timer = setTimeout(() => setActiveFlash(null), FLASH_DURATION_MS);
    return () => clearTimeout(timer);
  }, [flashSeq, flashKind]);

  const clampedLevel = Math.max(0, Math.min(1, level || 0));
  const hasConfidence = confidence !== null && confidence !== undefined;
  const clampedConfidence = hasConfidence ? Math.max(0, Math.min(1, confidence)) : 0;
  const ringColor = confidenceColor(hasConfidence ? clampedConfidence : null);
  // 신뢰도 고리 둘레(반지름 45 기준) — 신뢰도가 높을수록 고리가 더 많이 채워진다.
  const CIRCUMFERENCE = 2 * Math.PI * 45;
  const dashOffset = CIRCUMFERENCE * (1 - (hasConfidence ? clampedConfidence : 1));

  return (
    <Tag
      type={button ? 'button' : undefined}
      className={`momi-orb momi-orb--${state}${activeFlash ? ` momi-orb--flash-${activeFlash}` : ''}`}
      style={{
        // [전체화면 오브 2026-09b] size는 보통 숫자(px)지만, 전체화면 무대에서는
        // 'min(62vw,62vh)' 같은 CSS 길이 문자열을 그대로 넘길 수 있어야 한다.
        '--momi-orb-size': typeof size === 'number' ? `${size}px` : size,
        '--momi-orb-level': clampedLevel,
        '--momi-orb-glow': 0.4 + clampedLevel * 0.6,
      }}
      aria-label={text}
      title={text}
      {...props}
    >
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <defs>
          <radialGradient id={`${uid}-core`}>
            <stop offset="0" stopColor="#bfffff" stopOpacity=".95" />
            <stop offset=".35" stopColor="#1ddbd4" stopOpacity=".6" />
            <stop offset="1" stopColor="#00181d" stopOpacity="0" />
          </radialGradient>
          <filter id={`${uid}-glow`} x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="2.4" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <filter id={`${uid}-wave`} x="-40%" y="-40%" width="180%" height="180%">
            <feTurbulence type="fractalNoise" baseFrequency=".025 .11" numOctaves="2" seed="8" result="noise" />
            <feDisplacementMap in="SourceGraphic" in2="noise" scale="5" />
          </filter>
        </defs>
        <circle className="momi-orb__halo" cx="50" cy="50" r="45" />
        {/* [정확도 시각화] 신뢰도 고리 — 이번 발화를 엔진이 얼마나 확신했는지를
            둘레 채움 비율(높을수록 꽉 참)과 색(초록/노랑/빨강)으로 보여준다.
            confidence가 없으면(null) 표시하지 않는다(값을 안 주는 브라우저 대응). */}
        {hasConfidence && (
          <circle
            className="momi-orb__confidence"
            cx="50"
            cy="50"
            r="45"
            stroke={ringColor}
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={dashOffset}
          />
        )}
        {/* [정확도 시각화] 실제 마이크 음량에 반응하는 레벨 고리 — 말할수록 커지고
            밝아진다(단순 장식이 아니라 진짜 소리 크기를 반영). */}
        <circle className="momi-orb__level" cx="50" cy="50" r="41" />
        <g filter={`url(#${uid}-wave)`}>
          <circle className="momi-orb__ring momi-orb__ring--a" cx="50" cy="50" r="35" />
          <circle className="momi-orb__ring momi-orb__ring--b" cx="50" cy="50" r="31" />
          <circle className="momi-orb__ring momi-orb__ring--c" cx="50" cy="50" r="38" />
        </g>
        <circle className="momi-orb__core" cx="50" cy="50" r="18" fill={`url(#${uid}-core)`} filter={`url(#${uid}-glow)`} />
        <circle className="momi-orb__dot" cx="50" cy="50" r="4" filter={`url(#${uid}-glow)`} />
        {/* [정확도 시각화] "제대로 알아들었다/못 알아들었다" 순간 반짝임. key를
            flashSeq에 묶어 같은 결과가 연속으로 와도(예: 연속 mismatch) 매번
            애니메이션이 처음부터 다시 재생되게 한다. */}
        {activeFlash === 'matched' && (
          <g key={`match-${flashSeq}`} className="momi-orb__burst momi-orb__burst--matched">
            <circle cx="50" cy="50" r="20" />
            {[0, 60, 120, 180, 240, 300].map((angle) => (
              <circle
                key={angle}
                className="momi-orb__spark"
                cx={50 + 34 * Math.cos((angle * Math.PI) / 180)}
                cy={50 + 34 * Math.sin((angle * Math.PI) / 180)}
                r="2.2"
              />
            ))}
          </g>
        )}
        {activeFlash === 'mismatch' && (
          <circle key={`miss-${flashSeq}`} className="momi-orb__burst momi-orb__burst--mismatch" cx="50" cy="50" r="30" />
        )}
      </svg>
      <span className="momi-orb__sr">{text}</span>
      <style>{`
        .momi-orb{--orb:#27eee5;--orb2:#16a6c2;width:var(--momi-orb-size);height:var(--momi-orb-size);padding:0;border:1px solid rgba(56,236,226,.2);border-radius:50%;display:grid;place-items:center;overflow:hidden;background:radial-gradient(circle at 50% 50%,#06333a 0,#01191e 48%,#020a0c 72%,#000 100%);box-shadow:0 0 calc(22px + 14px*var(--momi-orb-level,0)) rgba(22,210,205,calc(.22 + .2*var(--momi-orb-level,0))),inset 0 0 20px rgba(25,238,226,.09);color:var(--orb);transition:filter .25s,transform .12s ease-out,box-shadow .12s ease-out;isolation:isolate}
        button.momi-orb{cursor:pointer}.momi-orb:disabled{cursor:wait}.momi-orb svg{width:100%;height:100%;overflow:visible}
        .momi-orb__halo{fill:none;stroke:var(--orb);stroke-width:.5;opacity:.18}
        .momi-orb__confidence{fill:none;stroke-width:1.4;stroke-linecap:round;transform:rotate(-90deg);transform-origin:50px 50px;opacity:.85;transition:stroke-dashoffset .4s ease,stroke .3s ease;filter:drop-shadow(0 0 3px currentColor)}
        .momi-orb__level{fill:none;stroke:var(--orb);stroke-width:1;opacity:calc(.12 + .55*var(--momi-orb-level,0));transform:scale(calc(1 + .12*var(--momi-orb-level,0)));transform-origin:50px 50px;transition:transform .1s linear,opacity .1s linear}
        .momi-orb__ring{fill:none;stroke:var(--orb);stroke-linecap:round;transform-origin:50px 50px}
        .momi-orb__ring--a{stroke-width:1.6;stroke-dasharray:5 2;opacity:.9;animation:momi-spin 8s linear infinite,momi-breathe 2.8s ease-in-out infinite}
        .momi-orb__ring--b{stroke:var(--orb2);stroke-width:1;stroke-dasharray:2 4;opacity:.75;animation:momi-spin 11s linear infinite reverse,momi-breathe 2.2s ease-in-out infinite reverse}
        .momi-orb__ring--c{stroke-width:.65;stroke-dasharray:1 3;opacity:.55;animation:momi-spin 14s linear infinite}
        .momi-orb__core{opacity:.72;transform-origin:50px 50px;animation:momi-core 2.6s ease-in-out infinite;transform:scale(calc(1 + .3*var(--momi-orb-level,0)))}
        .momi-orb__dot{fill:#d8ffff;opacity:.8}
        .momi-orb--listening{filter:saturate(1.2);box-shadow:0 0 calc(30px + 16px*var(--momi-orb-level,0)) rgba(23,238,229,calc(.42 + .25*var(--momi-orb-level,0))),inset 0 0 24px rgba(25,238,226,.15)}
        .momi-orb--listening .momi-orb__ring--a{animation-duration:2.3s,.72s}.momi-orb--listening .momi-orb__ring--b{animation-duration:3.1s,.58s}
        .momi-orb--thinking{--orb:#77f7ee;--orb2:#8d71ff}.momi-orb--thinking .momi-orb__ring{animation-duration:1.4s,1s}.momi-orb--thinking .momi-orb__core{animation-duration:.9s}
        .momi-orb--speaking{--orb:#72fff4;--orb2:#22c8ff;box-shadow:0 0 34px rgba(39,238,229,.48),inset 0 0 28px rgba(25,238,226,.18)}
        .momi-orb--speaking .momi-orb__ring--a{animation-duration:1.8s,.42s}.momi-orb--speaking .momi-orb__ring--b{animation-duration:2.4s,.34s}.momi-orb--speaking .momi-orb__core{animation-duration:.48s}
        .momi-orb--error{--orb:#fb7185;--orb2:#f59e0b;box-shadow:0 0 26px rgba(251,113,133,.36)}
        .momi-orb__sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
        .momi-orb__burst{fill:none;pointer-events:none}
        .momi-orb__burst--matched circle:first-child{stroke:#34e0a1;stroke-width:2;fill:none;transform-origin:50px 50px;animation:momi-burst-ring .9s ease-out forwards}
        .momi-orb__spark{fill:#7dffcf;transform-origin:50px 50px;animation:momi-spark .9s ease-out forwards}
        .momi-orb__burst--mismatch{fill:none;stroke:#fb7185;stroke-width:2.4;transform-origin:50px 50px;animation:momi-burst-ring-red .7s ease-out forwards}
        .momi-orb--flash-matched{animation:momi-flash-glow-green .9s ease-out}
        .momi-orb--flash-mismatch{animation:momi-shake .5s ease-in-out}
        @keyframes momi-spin{to{transform:rotate(360deg)}}
        @keyframes momi-breathe{50%{transform:scale(1.1);opacity:.45}}
        @keyframes momi-core{50%{transform:scale(calc(1.3 + .3*var(--momi-orb-level,0)));opacity:1}}
        @keyframes momi-burst-ring{0%{r:14;stroke-opacity:1;stroke-width:3}100%{r:48;stroke-opacity:0;stroke-width:.4}}
        @keyframes momi-burst-ring-red{0%{r:16;stroke-opacity:1}100%{r:46;stroke-opacity:0}}
        @keyframes momi-spark{0%{opacity:1;transform:scale(1)}100%{opacity:0;transform:scale(2.4) translate(0,0)}}
        @keyframes momi-flash-glow-green{0%{box-shadow:0 0 0 rgba(52,224,161,0)}30%{box-shadow:0 0 46px rgba(52,224,161,.75)}100%{box-shadow:0 0 22px rgba(22,210,205,.22)}}
        @keyframes momi-shake{0%,100%{transform:translateX(0)}20%{transform:translateX(-4px)}40%{transform:translateX(4px)}60%{transform:translateX(-3px)}80%{transform:translateX(3px)}}
        @media(prefers-reduced-motion:reduce){.momi-orb *{animation-duration:0s!important;animation-iteration-count:1!important}.momi-orb{transition:none}}
      `}</style>
    </Tag>
  );
}
