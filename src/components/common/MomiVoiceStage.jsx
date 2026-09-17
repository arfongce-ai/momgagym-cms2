// src/components/common/MomiVoiceStage.jsx
// [모미 전체화면 HUD 2026-09c] 요청받은 흐름 그대로:
//   평소   — 화면에 모미가 전혀 안 보인다(아무것도 렌더링하지 않음).
//   "모미야" — 화면 전체에 음성인식 그래프(HUD)가 그라데이션으로 떠오른다.
//   명령 후 — 답을 보여주고 나서 그라데이션으로 사라진다.
//   다음 명령 때 같은 방식으로 다시 나타난다.
//
// phase:
//   'open'    — 그라데이션으로 떠오르며 유지(실시간 자막 + 음성 그래프)
//   'closing' — 그라데이션으로 사라지는 중(부모가 STAGE_FADE_MS 뒤에 내림)
//
// 화면을 통째로 덮으므로 pointer-events는 기본적으로 꺼둔다 — 키오스크·PC 모두
// 모미가 떠 있는 동안에도 뒤쪽 화면을 그대로 쓸 수 있어야 한다. interactive를
// 켠 화면에서만 아무 데나 눌러서 닫을 수 있다.
import MomiVoiceOrb from './MomiVoiceOrb';

// 떠오르고 사라지는 그라데이션 전환 길이(아래 CSS와 맞춰야 한다).
export const STAGE_FADE_MS = 520;

const PROMPT = {
  listening: '말씀하세요',
  thinking: '생각하고 있어요',
  speaking: '답하고 있어요',
  error: '다시 확인해 주세요',
  idle: '',
};

// 그래프 막대 개수 — useMomiVoice가 넘겨주는 밴드 수(28)와 맞춘다.
// 실제로는 이걸 좌우로 미러링해서 56개로 그린다: 사람 목소리는 에너지가 저주파에
// 몰려 있어서 그대로 나열하면 왼쪽만 크고 오른쪽은 납작한 비대칭 그래프가 된다.
// 가운데(저주파)에서 양옆(고주파)으로 퍼지게 대칭으로 두면 같은 데이터인데도
// 훨씬 그래프답게 보이고, 어느 쪽에서 봐도 중심이 맞는다.
const BAR_COUNT = 28;

export default function MomiVoiceStage({
  phase = 'open',
  state = 'listening',
  text = '',
  confidence = null,
  level = 0,
  bands = null,
  interactive = false,
  onDismiss,
}) {
  const clampedLevel = Math.max(0, Math.min(1, level || 0));
  const hasConfidence = confidence !== null && confidence !== undefined;
  const pct = hasConfidence ? Math.round(Math.max(0, Math.min(1, confidence)) * 100) : null;

  // 밴드가 없는 환경(측정 스트림 실패 등)에서는 전체 음량 하나로 그래프를
  // 만들어 준다 — 정확한 주파수 분포는 아니지만 "듣고 있다"는 건 보인다.
  const half = Array.from({ length: BAR_COUNT }, (_, i) => {
    if (Array.isArray(bands) && bands.length) {
      return Math.max(0, Math.min(1, bands[i % bands.length] || 0));
    }
    // 대역 데이터가 없는 환경(측정 스트림 실패 등)에서는 전체 음량 하나로 만든다.
    return clampedLevel * (1 - (i / BAR_COUNT) * 0.75);
  });
  // 저주파(가운데) → 고주파(바깥) 순서가 되도록 뒤집은 절반을 앞에 붙인다.
  const bars = [...half].reverse().concat(half);

  return (
    <div
      className={[
        'momi-stage',
        `momi-stage--${state}`,
        `momi-stage--${phase}`,
        interactive ? 'momi-stage--interactive' : '',
      ].filter(Boolean).join(' ')}
      style={{ '--lv': clampedLevel }}
      onClick={interactive && onDismiss ? onDismiss : undefined}
      role="status"
      aria-live="polite"
    >
      {/* 배경 그라데이션 — 이 레이어가 떠오르고 사라지면서 "그라데이션으로
          뜬다/사라진다"를 만든다. 내용과 분리해둬야 내용은 살짝 움직이고
          배경은 부드럽게만 번지는 연출이 가능하다. */}
      <div className="momi-stage__wash" aria-hidden="true" />

      <div className="momi-stage__inner">
        <div className="momi-stage__orbwrap">
          <MomiVoiceOrb state={state} size="min(26vw, 22vh)" label={PROMPT[state] || ''} />
        </div>

        {/* 음성인식 그래프 — 실제 목소리 주파수 대역별 세기를 위아래 대칭
            막대로 그린다. 소음만 있을 때는 노이즈 게이트가 전부 0으로 눌러서
            납작하게 눕는다(= 사람이 말할 때만 살아 움직인다). */}
        <div className="momi-stage__graph" aria-hidden="true">
          {bars.map((v, i) => (
            <span
              key={i}
              className="momi-stage__bar"
              style={{ '--v': v, '--i': i }}
            />
          ))}
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
        .momi-stage{position:fixed;inset:0;z-index:1100;display:grid;place-items:center;pointer-events:none;overflow:hidden}
        .momi-stage--interactive{pointer-events:auto;cursor:pointer}
        .momi-stage__wash{position:absolute;inset:0;
          background:
            radial-gradient(circle at 50% 46%, color-mix(in srgb, var(--stage,#27eee5) 16%, transparent) 0%, transparent 46%),
            radial-gradient(circle at 50% 50%, rgba(2,20,25,.86) 0%, rgba(0,8,11,.95) 52%, rgba(0,0,0,.98) 100%);
          backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px)}
        @supports not (color:color-mix(in srgb,red 50%,transparent)){
          .momi-stage__wash{background:radial-gradient(circle at 50% 50%,rgba(2,20,25,.88) 0%,rgba(0,8,11,.95) 52%,rgba(0,0,0,.98) 100%)}
        }

        /* 떠오름 — 배경 그라데이션이 번지고, 내용이 살짝 떠오르며 또렷해진다. */
        .momi-stage--open .momi-stage__wash{animation:momi-wash-in .52s ease-out both}
        .momi-stage--open .momi-stage__inner{animation:momi-content-in .52s cubic-bezier(.2,.9,.3,1) both}
        /* 사라짐 — 같은 그라데이션이 역순으로 옅어진다. */
        .momi-stage--closing .momi-stage__wash{animation:momi-wash-out .52s ease-in both}
        .momi-stage--closing .momi-stage__inner{animation:momi-content-out .52s ease-in both}

        .momi-stage__inner{position:relative;display:flex;flex-direction:column;align-items:center;
          gap:clamp(10px,2.2vh,24px);max-height:100vh;padding:16px}
        .momi-stage__orbwrap{display:grid;place-items:center}

        /* 음성인식 그래프 */
        .momi-stage__graph{display:flex;align-items:center;justify-content:center;gap:clamp(3px,.6vw,8px);
          width:min(74vw,900px);height:clamp(70px,16vh,150px)}
        .momi-stage__bar{flex:1 1 0;min-width:2px;border-radius:999px;
          /* 최소 높이를 둬서 조용할 때도 가느다란 기준선이 보인다 */
          height:calc(6% + 94% * var(--v,0));
          background:linear-gradient(180deg,var(--stage,#27eee5) 0%,var(--stage2,#22c8ff) 100%);
          box-shadow:0 0 calc(4px + 14px*var(--v,0)) var(--stage,#27eee5);
          opacity:calc(.35 + .65*var(--v,0));
          transition:height .09s linear,opacity .09s linear,box-shadow .09s linear}

        .momi-stage__caption{text-align:center;max-width:min(88vw,760px);color:#eafeff}
        .momi-stage__prompt{display:inline-flex;align-items:center;gap:8px;font-size:clamp(11px,1.5vh,14px);font-weight:800;
          letter-spacing:.16em;text-transform:uppercase;color:var(--stage,#27eee5)}
        .momi-stage__pip{width:9px;height:9px;border-radius:50%;background:var(--stage,#27eee5);
          box-shadow:0 0 12px var(--stage,#27eee5);animation:momi-stage-pip 1.1s ease-in-out infinite}
        .momi-stage__text{margin-top:10px;font-size:clamp(22px,4.6vh,46px);font-weight:800;line-height:1.3;word-break:keep-all;
          text-shadow:0 0 28px rgba(39,238,229,.45)}
        .momi-stage__hint{margin-top:10px;font-size:clamp(13px,2vh,18px);font-weight:500;color:#7fa8ad;word-break:keep-all}
        .momi-stage__meter{margin-top:14px;display:flex;align-items:center;justify-content:center;gap:10px}
        .momi-stage__bars{display:flex;gap:4px}
        .momi-stage__bars span{width:12px;height:14px;border-radius:2px;background:rgba(255,255,255,.13);transform:skewX(-18deg)}
        .momi-stage__bars span.on{background:var(--stage,#27eee5);box-shadow:0 0 10px var(--stage,#27eee5)}
        .momi-stage__pct{font-size:14px;font-weight:800;color:var(--stage,#27eee5);font-variant-numeric:tabular-nums}

        .momi-stage--listening{--stage:#27eee5;--stage2:#22c8ff}
        .momi-stage--thinking{--stage:#a78bfa;--stage2:#8d71ff}
        .momi-stage--speaking{--stage:#38bdf8;--stage2:#22d3ee}
        .momi-stage--error{--stage:#fb7185;--stage2:#f59e0b}

        @keyframes momi-wash-in{from{opacity:0}to{opacity:1}}
        @keyframes momi-wash-out{from{opacity:1}to{opacity:0}}
        @keyframes momi-content-in{from{opacity:0;transform:translateY(14px) scale(.96)}to{opacity:1;transform:none}}
        @keyframes momi-content-out{from{opacity:1;transform:none}to{opacity:0;transform:translateY(-10px) scale(1.03)}}
        @keyframes momi-stage-pip{50%{opacity:.2;transform:scale(.75)}}
        @media(prefers-reduced-motion:reduce){
          .momi-stage *{animation-duration:.001s!important;animation-iteration-count:1!important;transition:none!important}
        }
      `}</style>
    </div>
  );
}
