// ai-measure/menus/PlateWeightInput.jsx
// 원판 무게 입력 공용 컴포넌트 — 1RM·VBT·역도에서 함께 사용.
//  - 봉 무게 선택 + 편측 원판 버튼으로 구성(양쪽 ×2) → 총중량 산출.
//  - getVideo()로 현재 카메라 프레임을 받아 색 자동 추정(보조) → 사용자가 장수 확인·수정.
//  - 무게는 "정확도"가 아니라 "기록"을 위한 값(VBT·역도). 항상 수동 확인 전제.
//
// props:
//   value      : { barKg:number, sidePlates:[{kg,label,count}] }
//   onChange   : (next) => void   // value 갱신
//   getVideo   : () => HTMLVideoElement|null  // 색 인식용(없으면 색인식 버튼 숨김)
//   roi        : {x,y,w,h} 0~1    // 색 인식 관심영역(기본 좌측 바벨 끝)
import { useState } from 'react';
import {
  IWF_PLATES, BAR_WEIGHTS, detectPlatesFromVideo,
  suggestSidePlates, totalWeight,
} from '../core/plates';

const PLATE_HEX = { 빨강:'#D7263D', 파랑:'#0B61A4', 노랑:'#F2C200', 초록:'#1F9D55', 흰색:'#E8E8E8' };
const DEFAULT_ROI = { x: 0.05, y: 0.35, w: 0.22, h: 0.45 };

export default function PlateWeightInput({ value, onChange, getVideo, roi = DEFAULT_ROI }) {
  const barKg = value?.barKg ?? 20;
  const sidePlates = value?.sidePlates ?? [];
  const [detected, setDetected] = useState([]);

  const total = totalWeight(sidePlates, barKg).total;

  const setBar = (kg) => onChange?.({ barKg: kg, sidePlates });
  const setPlates = (next) => onChange?.({ barKg, sidePlates: next });

  const addPlate = (p) => {
    const i = sidePlates.findIndex(x => x.kg === p.kg);
    if (i >= 0) {
      const n = [...sidePlates]; n[i] = { ...n[i], count: n[i].count + 1 }; setPlates(n);
    } else {
      setPlates([...sidePlates, { kg: p.kg, label: p.label, count: 1 }]);
    }
  };
  const changeCount = (kg, delta) => {
    setPlates(sidePlates
      .map(x => x.kg === kg ? { ...x, count: Math.max(0, x.count + delta) } : x)
      .filter(x => x.count > 0));
  };

  // 영상 인식(보조) — 현재 프레임 ROI 색 집계 → 후보 자동 채움(사용자 보정)
  const scanColors = () => {
    const v = getVideo?.();
    if (!v || !v.videoWidth) {
      alert('카메라가 아직 켜지지 않았습니다. 위에서 카메라를 먼저 시작한 뒤 다시 누르세요.');
      return;
    }
    const { dominant } = detectPlatesFromVideo(v, roi);
    if (!dominant.length) { alert('원판 색을 찾지 못했습니다. 원판이 잘 보이게 한 뒤 다시 시도하세요.'); return; }
    setDetected(dominant);
    setPlates(suggestSidePlates(dominant));
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest">원판 무게 (기록용)</p>
        {getVideo && (
          <button onClick={scanColors} className="px-3 py-1 rounded-lg bg-amber-500 text-slate-950 text-[11px] font-black active:scale-95">
            영상 인식
          </button>
        )}
      </div>

      {detected.length > 0 && (
        <p className="text-[11px] text-cyan-400">
          인식된 색: {detected.map(d => `${d.label}(${Math.round(d.ratio * 100)}%)`).join(', ')} — 아래에서 장수를 확인·수정하세요.
        </p>
      )}

      {/* 봉 무게 */}
      <div>
        <label className="block text-[11px] text-slate-500 mb-1">봉 무게</label>
        <select value={barKg} onChange={e => setBar(Number(e.target.value))} className="input">
          {BAR_WEIGHTS.map(b => <option key={b.kg} value={b.kg}>{b.label}</option>)}
        </select>
      </div>

      {/* 편측 원판 추가 */}
      <div>
        <label className="block text-[11px] text-slate-500 mb-1">한쪽 원판 추가 (양쪽 동일 적용)</label>
        <div className="flex flex-wrap gap-1.5">
          {IWF_PLATES.filter(p => !p.small && !p.chrome).map(p => (
            <button key={p.label} onClick={() => addPlate(p)}
              className="px-2.5 py-1 rounded-lg text-[11px] font-bold border"
              style={{ borderColor: PLATE_HEX[p.label] || '#64748b', color: PLATE_HEX[p.label] || '#cbd5e1' }}>
              + {p.kg}
            </button>
          ))}
        </div>
      </div>

      {/* 현재 편측 구성 */}
      {sidePlates.length > 0 && (
        <div className="bg-slate-800 rounded-xl p-3 space-y-2">
          <p className="text-[10px] text-slate-500">한쪽 구성 (확인·수정)</p>
          {sidePlates.map(p => (
            <div key={p.kg} className="flex items-center justify-between">
              <span className="text-xs font-bold" style={{ color: PLATE_HEX[p.label] || '#cbd5e1' }}>
                {p.label} {p.kg}kg
              </span>
              <div className="flex items-center gap-2">
                <button onClick={() => changeCount(p.kg, -1)} className="w-7 h-7 rounded bg-slate-700 text-slate-200 font-bold">−</button>
                <span className="font-mono font-bold text-slate-100 w-6 text-center">{p.count}</span>
                <button onClick={() => changeCount(p.kg, +1)} className="w-7 h-7 rounded bg-slate-700 text-slate-200 font-bold">+</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 총중량 */}
      <div className="card-accent p-3 text-center">
        <p className="text-[10px] text-slate-500">총중량 (양쪽 + 봉)</p>
        <p className="font-mono font-black text-2xl text-slate-100">{total}<span className="text-sm text-slate-500"> kg</span></p>
      </div>
    </div>
  );
}
