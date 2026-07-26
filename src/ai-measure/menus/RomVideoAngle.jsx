// ai-measure/menus/RomVideoAngle.jsx
// ════════════════════════════════════════════════════════════════════════
//  영상 업로드 — 스포츠 수행 중 각도 확인 (특정 관절 자동 ROM 아님)
//
//  용도: 달리기·역도·점프 등 '동작 수행 영상'에서 원하는 순간의 관절/분절 각도를
//  트레이너가 직접 확인한다. 자동 관절 추적이 아니라, 영상을 원하는 프레임에
//  세운 뒤 그 장면에서 각도기(세 점 탭)로 측정하는 방식.
//
//  흐름:
//   1) 영상 업로드 → 플레이어에 로드.
//   2) [4-1] 재생 속도 조절(0.1×~2×) + 프레임 단위 이동으로 원하는 장면을 찾는다.
//   3) [4-2] 캡처 — 현재 프레임을 정지 이미지로 뽑는다(여러 장 가능).
//   4) [4-3] 캡처한 프레임에서 각도기(RomGoniometer, 세 점 탭)로 각도 측정.
//   5) 측정한 각도들을 '장면 목록'으로 모아 확인.
//
//  측정 정직성: 2D 영상 각도이므로 '측정 분절이 카메라와 평행'할 때만 정확.
//  자동 좌우/보상 분석은 제공하지 않는다(수행 영상은 촬영면이 제각각이므로).
// ════════════════════════════════════════════════════════════════════════
import { useEffect, useRef, useState } from 'react';
import RomGoniometer from './RomGoniometer.jsx';

const SPEEDS = [0.1, 0.25, 0.5, 1, 1.5, 2];
const FRAME_STEP = 1 / 30; // 대략 한 프레임(30fps 가정) 이동 폭(초)

export default function RomVideoAngle({ member, onBack, onCollect }) {
  const videoRef = useRef(null);
  const [videoUrl, setVideoUrl] = useState('');
  const [fileName, setFileName] = useState('');
  const [speed, setSpeed] = useState(1);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [current, setCurrent] = useState(0);
  const [captureUrl, setCaptureUrl] = useState('');   // 각도 측정할 캡처 프레임
  const [shots, setShots] = useState([]);             // [{ url, time, angle?, movement? }]

  // 언마운트 정리용 최신값 — state를 effect 의존성에 직접 넣지 않기 위한 ref.
  const videoUrlRef = useRef('');
  useEffect(() => { videoUrlRef.current = videoUrl; }, [videoUrl]);
  const shotsRef = useRef([]);
  useEffect(() => { shotsRef.current = shots; }, [shots]);

  // 주의: 의존성에 videoUrl을 넣으면 새 영상을 업로드해 videoUrl이 바뀔
  // 때마다 이 클린업이 재실행된다. 그 시점의 클로저가 잡고 있는 shots는
  // effect가 마지막으로 설정된 시점(=이전 videoUrl로 바뀌던 순간)의 값이라,
  // 그 사이에 캡처된 장면들의 blob URL은 한 번도 정리되지 못하고 새는
  // 문제가 있었다(활성 이미지가 갑자기 깨지는 문제는 아니고 누수만 발생).
  // ref로 최신값을 추적하고, 이 effect는 언마운트 시 1회만 실행한다.
  useEffect(() => () => {
    if (videoUrlRef.current) URL.revokeObjectURL(videoUrlRef.current);
    shotsRef.current.forEach((s) => { if (s.url?.startsWith('blob:')) URL.revokeObjectURL(s.url); });
  }, []);

  const onFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    const url = URL.createObjectURL(file);
    setVideoUrl(url);
    setFileName(file.name);
    setCaptureUrl('');
    setPlaying(false);
  };

  // 속도 변경 즉시 반영
  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = speed;
  }, [speed, videoUrl]);

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) { v.playbackRate = speed; v.play(); setPlaying(true); }
    else { v.pause(); setPlaying(false); }
  };

  const stepFrame = (dir) => {
    const v = videoRef.current;
    if (!v) return;
    v.pause(); setPlaying(false);
    v.currentTime = Math.max(0, Math.min(v.duration || 0, v.currentTime + dir * FRAME_STEP));
  };

  const onSeek = (e) => {
    const v = videoRef.current;
    if (!v) return;
    const t = Number(e.target.value);
    v.currentTime = t;
    setCurrent(t);
  };

  // [4-2] 현재 프레임 캡처 → [4-3] 각도기로 넘어감
  const captureFrame = () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    v.pause(); setPlaying(false);
    const c = document.createElement('canvas');
    c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
    const url = c.toDataURL('image/jpeg', 0.92);
    setCaptureUrl(url);
  };

  // 각도기에서 '이 각도 기록' → 장면 목록에 누적
  const handleAngle = (payload) => {
    setShots((prev) => [
      ...prev,
      { url: captureUrl, time: current, angle: payload?.angle ?? null, note: payload?.note || '' },
    ]);
    setCaptureUrl(''); // 각도기 닫고 영상으로 복귀
  };

  const removeShot = (i) => setShots((prev) => prev.filter((_, idx) => idx !== i));

  const fmtTime = (t) => {
    const s = Math.floor(t % 60), m = Math.floor(t / 60);
    const cs = Math.floor((t - Math.floor(t)) * 100);
    return `${m}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
  };

  // ════════════════ [4-3] 캡처 프레임 → 각도기 ════════════════
  if (captureUrl) {
    return (
      <RomGoniometer
        member={member}
        jointName="수행 각도"
        title={`영상 각도 · ${fmtTime(current)}`}
        initialImageUrl={captureUrl}
        allowRetake={false}
        onBack={() => setCaptureUrl('')}
        onUseAngle={handleAngle}
      />
    );
  }

  // ════════════════ 영상 플레이어 화면 ════════════════
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="measure-back">← 뒤로</button>
        <h2 className="measure-title">영상 업로드 · 수행 각도</h2>
        <span className="w-12" />
      </div>

      {!videoUrl ? (
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4 space-y-3">
          <p className="text-sm font-bold text-slate-200">스포츠 수행 영상을 올려 각도를 확인합니다</p>
          <p className="text-[12px] leading-relaxed text-slate-400">
            달리기·역도·점프 등 동작 영상에서 원하는 순간을 세운 뒤, 그 장면의 관절·분절
            각도를 직접 측정합니다. <span className="text-amber-300">특정 관절 자동 ROM 측정이 아닙니다.</span>
          </p>
          <label className="block">
            <span className="text-xs font-bold text-slate-400">영상 파일 선택</span>
            <input type="file" accept="video/*" onChange={onFile}
              className="mt-1 block w-full text-sm text-slate-300 file:mr-3 file:rounded-lg file:border-0 file:bg-amber-500 file:px-3 file:py-1.5 file:text-sm file:font-bold file:text-slate-950" />
          </label>
        </div>
      ) : (
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-3 space-y-3">
          {fileName && <p className="text-[11px] text-slate-500">파일: {fileName}</p>}
          <div className="overflow-hidden rounded-xl bg-black">
            <video
              ref={videoRef}
              src={videoUrl}
              className="w-full"
              playsInline
              onLoadedMetadata={(e) => { setDuration(e.target.duration || 0); e.target.playbackRate = speed; }}
              onTimeUpdate={(e) => setCurrent(e.target.currentTime || 0)}
              onEnded={() => setPlaying(false)}
            />
          </div>

          {/* 탐색 바 */}
          <div className="space-y-1">
            <input type="range" min={0} max={duration || 0} step={0.01} value={current}
              onChange={onSeek} className="w-full accent-amber-400" />
            <div className="flex justify-between text-[11px] tabular-nums text-slate-400">
              <span>{fmtTime(current)}</span>
              <span>{fmtTime(duration)}</span>
            </div>
          </div>

          {/* 재생 · 프레임 이동 */}
          <div className="flex items-center gap-2">
            <button onClick={() => stepFrame(-1)}
              className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm font-black text-slate-300">◀ 프레임</button>
            <button onClick={togglePlay}
              className="flex-1 rounded-lg bg-amber-500 px-3 py-2 text-sm font-black text-slate-950">
              {playing ? '일시정지' : '재생'}
            </button>
            <button onClick={() => stepFrame(1)}
              className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm font-black text-slate-300">프레임 ▶</button>
          </div>

          {/* [4-1] 재생 속도 */}
          <div>
            <p className="mb-1 text-xs font-bold text-slate-400">재생 속도</p>
            <div className="flex flex-wrap gap-2">
              {SPEEDS.map((sp) => (
                <button key={sp} onClick={() => setSpeed(sp)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-black ${
                    speed === sp ? 'border-amber-400 bg-amber-400 text-slate-950' : 'border-slate-700 bg-slate-800 text-slate-400'
                  }`}>
                  {sp}×
                </button>
              ))}
            </div>
          </div>

          {/* [4-2] 캡처 → [4-3] 각도기 */}
          <button onClick={captureFrame}
            className="w-full rounded-xl bg-sky-500 px-4 py-3.5 text-sm font-black text-slate-950 active:scale-[0.99]">
            이 장면 캡처 → 각도 측정
          </button>
          <p className="text-[11px] leading-relaxed text-slate-500">
            원하는 순간에서 캡처하면, 그 장면 위에서 세 점(끝점–관절–끝점)을 탭해 각도를 잽니다.
            측정 분절이 카메라와 나란한 장면일수록 정확합니다.
          </p>
        </div>
      )}

      {/* 측정한 장면 목록 */}
      {shots.length > 0 && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-3 space-y-2">
          <p className="text-sm font-bold text-slate-300">측정한 장면 ({shots.length})</p>
          <div className="grid grid-cols-2 gap-2">
            {shots.map((s, i) => (
              <div key={i} className="relative overflow-hidden rounded-lg border border-slate-700 bg-slate-800">
                {s.url && <img src={s.url} alt={`장면 ${i + 1}`} className="w-full" />}
                <div className="flex items-center justify-between px-2 py-1">
                  <span className="text-[11px] font-bold text-slate-300">{fmtTime(s.time)}</span>
                  <span className="text-sm font-black text-amber-300">{s.angle == null ? '—' : `${s.angle}°`}</span>
                </div>
                <button onClick={() => removeShot(i)}
                  className="absolute right-1 top-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-bold text-white">삭제</button>
              </div>
            ))}
          </div>
          {onCollect && (
            <button onClick={() => onCollect(shots)}
              className="w-full rounded-xl bg-emerald-500 px-4 py-3 text-sm font-black text-slate-950">
              측정 장면 저장/공유
            </button>
          )}
        </div>
      )}
    </div>
  );
}
