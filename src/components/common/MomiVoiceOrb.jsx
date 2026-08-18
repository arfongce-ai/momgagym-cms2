import { useId } from 'react';

const COPY = {
  idle: 'MOMI 대기 중',
  listening: '듣고 있어요',
  thinking: '생각하고 있어요',
  speaking: '답하고 있어요',
  error: '다시 확인해 주세요',
};

/** 음성 상태를 예시 이미지처럼 빛의 파동으로 보여주는 코드 기반 오브. */
export default function MomiVoiceOrb({ state = 'idle', size = 72, label, button = false, ...props }) {
  const uid = useId().replace(/:/g, '');
  const Tag = button ? 'button' : 'div';
  const text = label || COPY[state] || COPY.idle;

  return (
    <Tag
      type={button ? 'button' : undefined}
      className={`momi-orb momi-orb--${state}`}
      style={{ '--momi-orb-size': `${size}px` }}
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
        <g filter={`url(#${uid}-wave)`}>
          <circle className="momi-orb__ring momi-orb__ring--a" cx="50" cy="50" r="35" />
          <circle className="momi-orb__ring momi-orb__ring--b" cx="50" cy="50" r="31" />
          <circle className="momi-orb__ring momi-orb__ring--c" cx="50" cy="50" r="38" />
        </g>
        <circle className="momi-orb__core" cx="50" cy="50" r="18" fill={`url(#${uid}-core)`} filter={`url(#${uid}-glow)`} />
        <circle className="momi-orb__dot" cx="50" cy="50" r="4" filter={`url(#${uid}-glow)`} />
      </svg>
      <span className="momi-orb__sr">{text}</span>
      <style>{`
        .momi-orb{--orb:#27eee5;--orb2:#16a6c2;width:var(--momi-orb-size);height:var(--momi-orb-size);padding:0;border:1px solid rgba(56,236,226,.2);border-radius:50%;display:grid;place-items:center;overflow:hidden;background:radial-gradient(circle at 50% 50%,#06333a 0,#01191e 48%,#020a0c 72%,#000 100%);box-shadow:0 0 22px rgba(22,210,205,.22),inset 0 0 20px rgba(25,238,226,.09);color:var(--orb);transition:filter .25s,transform .25s,box-shadow .25s;isolation:isolate}
        button.momi-orb{cursor:pointer}.momi-orb:disabled{cursor:wait}.momi-orb svg{width:100%;height:100%;overflow:visible}
        .momi-orb__halo{fill:none;stroke:var(--orb);stroke-width:.5;opacity:.18}
        .momi-orb__ring{fill:none;stroke:var(--orb);stroke-linecap:round;transform-origin:50px 50px}
        .momi-orb__ring--a{stroke-width:1.6;stroke-dasharray:5 2;opacity:.9;animation:momi-spin 8s linear infinite,momi-breathe 2.8s ease-in-out infinite}
        .momi-orb__ring--b{stroke:var(--orb2);stroke-width:1;stroke-dasharray:2 4;opacity:.75;animation:momi-spin 11s linear infinite reverse,momi-breathe 2.2s ease-in-out infinite reverse}
        .momi-orb__ring--c{stroke-width:.65;stroke-dasharray:1 3;opacity:.55;animation:momi-spin 14s linear infinite}
        .momi-orb__core{opacity:.72;transform-origin:50px 50px;animation:momi-core 2.6s ease-in-out infinite}
        .momi-orb__dot{fill:#d8ffff;opacity:.8}
        .momi-orb--listening{filter:saturate(1.2);box-shadow:0 0 30px rgba(23,238,229,.42),inset 0 0 24px rgba(25,238,226,.15)}
        .momi-orb--listening .momi-orb__ring--a{animation-duration:2.3s,.72s}.momi-orb--listening .momi-orb__ring--b{animation-duration:3.1s,.58s}
        .momi-orb--thinking{--orb:#77f7ee;--orb2:#8d71ff}.momi-orb--thinking .momi-orb__ring{animation-duration:1.4s,1s}.momi-orb--thinking .momi-orb__core{animation-duration:.9s}
        .momi-orb--speaking{--orb:#72fff4;--orb2:#22c8ff;box-shadow:0 0 34px rgba(39,238,229,.48),inset 0 0 28px rgba(25,238,226,.18)}
        .momi-orb--speaking .momi-orb__ring--a{animation-duration:1.8s,.42s}.momi-orb--speaking .momi-orb__ring--b{animation-duration:2.4s,.34s}.momi-orb--speaking .momi-orb__core{animation-duration:.48s}
        .momi-orb--error{--orb:#fb7185;--orb2:#f59e0b;box-shadow:0 0 26px rgba(251,113,133,.36)}
        .momi-orb__sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
        @keyframes momi-spin{to{transform:rotate(360deg)}}@keyframes momi-breathe{50%{transform:scale(1.1);opacity:.45}}@keyframes momi-core{50%{transform:scale(1.3);opacity:1}}
        @media(prefers-reduced-motion:reduce){.momi-orb *{animation-duration:0s!important;animation-iteration-count:1!important}}
      `}</style>
    </Tag>
  );
}
