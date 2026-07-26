// ai-measure/core/cameraSelect.js
// Shared camera helper. It prefers the rear camera, but keeps fallbacks broad so
// Android WebView/iOS Safari can still open a stream when labels, mic permission,
// or exact device constraints are unreliable.

function score(label = '') {
  const l = label.toLowerCase();
  if (/ultra|wide angle|0\.5|초광각/.test(l)) return -2;
  if (/tele|망원|zoom|3x|5x/.test(l)) return -1;
  if (/main|메인|wide(?!\s*angle)|광각|back camera|camera2 0|^camera 0/.test(l)) return 2;
  return 0;
}

function assertMediaDevices() {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    throw new Error('이 브라우저에서는 카메라 API를 사용할 수 없습니다.');
  }
}

function supportsValue(capabilities, key, value) {
  return Array.isArray(capabilities?.[key]) && capabilities[key].includes(value);
}

function supportsPointFocus(capabilities) {
  const supported = typeof navigator !== 'undefined'
    ? navigator.mediaDevices?.getSupportedConstraints?.() || {}
    : {};
  return Boolean(supported.pointsOfInterest || capabilities?.pointsOfInterest);
}

function normalizePoint(point) {
  const x = Number(point?.x);
  const y = Number(point?.y);
  return {
    x: Math.max(0, Math.min(1, Number.isFinite(x) ? x : 0.5)),
    y: Math.max(0, Math.min(1, Number.isFinite(y) ? y : 0.5)),
  };
}

async function applyVideoTrackConstraints(track, constraints) {
  try {
    await track.applyConstraints(constraints);
    return true;
  } catch (e) {
    return false;
  }
}

async function applyAdvancedConstraints(track, advanced) {
  let applied = false;
  for (const constraint of advanced) {
    applied = await applyVideoTrackConstraints(track, { advanced: [constraint] }) || applied;
  }
  return applied;
}

export async function improveCameraFocus(stream, point = { x: 0.5, y: 0.5 }) {
  const track = stream?.getVideoTracks?.()[0];
  if (!track?.applyConstraints) return false;

  const capabilities = track.getCapabilities?.() || {};
  const focusMode = supportsValue(capabilities, 'focusMode', 'continuous')
    ? 'continuous'
    : supportsValue(capabilities, 'focusMode', 'single-shot')
      ? 'single-shot'
      : null;
  const advanced = [];

  if (focusMode) advanced.push({ focusMode });
  if (supportsValue(capabilities, 'exposureMode', 'continuous')) advanced.push({ exposureMode: 'continuous' });
  if (supportsValue(capabilities, 'whiteBalanceMode', 'continuous')) advanced.push({ whiteBalanceMode: 'continuous' });
  if (supportsPointFocus(capabilities)) advanced.push({ pointsOfInterest: [normalizePoint(point)] });

  if (!advanced.length) return false;
  return applyAdvancedConstraints(track, advanced);
}

export async function refocusCameraStream(stream, point = { x: 0.5, y: 0.5 }) {
  const track = stream?.getVideoTracks?.()[0];
  if (!track?.applyConstraints) return false;

  const capabilities = track.getCapabilities?.() || {};
  const advanced = [];
  if (supportsValue(capabilities, 'focusMode', 'single-shot')) advanced.push({ focusMode: 'single-shot' });
  if (supportsPointFocus(capabilities)) advanced.push({ pointsOfInterest: [normalizePoint(point)] });

  if (advanced.length && await applyAdvancedConstraints(track, advanced)) {
    await improveCameraFocus(stream, point);
    return true;
  }
  return improveCameraFocus(stream, point);
}

export async function lockCameraCapture(stream, point = { x: 0.5, y: 0.5 }) {
  const track = stream?.getVideoTracks?.()[0];
  if (!track?.applyConstraints) return false;

  const capabilities = track.getCapabilities?.() || {};
  const advanced = [];
  if (supportsValue(capabilities, 'focusMode', 'manual')) advanced.push({ focusMode: 'manual' });
  else if (supportsValue(capabilities, 'focusMode', 'single-shot')) advanced.push({ focusMode: 'single-shot' });
  if (supportsValue(capabilities, 'exposureMode', 'manual')) advanced.push({ exposureMode: 'manual' });
  if (supportsValue(capabilities, 'whiteBalanceMode', 'manual')) advanced.push({ whiteBalanceMode: 'manual' });
  if (supportsPointFocus(capabilities)) advanced.push({ pointsOfInterest: [normalizePoint(point)] });

  if (!advanced.length) return false;
  return applyAdvancedConstraints(track, advanced);
}

export async function unlockCameraCapture(stream) {
  return improveCameraFocus(stream);
}

/** Estimate the rear main camera deviceId after permission is available. */
export async function findMainBackCameraId() {
  assertMediaDevices();
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const cams = devices.filter((d) => d.kind === 'videoinput');
    const backCams = cams.filter((d) => /back|rear|후면|환경|environment/i.test(d.label));
    const pickFrom = backCams.length ? backCams : cams;
    const sorted = [...pickFrom].sort((a, b) => score(b.label) - score(a.label));
    return sorted[0]?.deviceId || null;
  } catch (e) {
    return null;
  }
}

function baseVideoConstraints(deviceId) {
  return [
    deviceId ? { deviceId: { exact: deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } } : null,
    { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
    { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
    { facingMode: 'environment' },
    true,
  ].filter(Boolean);
}

/**
 * Open the rear/main camera stream.
 * @param {{audio?: boolean, preferExactDevice?: boolean}} opt
 * @returns {Promise<MediaStream>}
 */
export async function openMainCameraStream({ audio = false, preferExactDevice = true } = {}) {
  assertMediaDevices();

  let deviceId = null;
  if (preferExactDevice) {
    // First ask for a simple rear stream to unlock device labels. Some WebViews
    // fail if this probe also asks for audio, so keep it video-only.
    let probe = null;
    try {
      probe = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      deviceId = await findMainBackCameraId();
    } catch (e) {
      deviceId = null;
    } finally {
      if (probe) probe.getTracks().forEach((t) => t.stop());
    }
  }

  const videoChoices = baseVideoConstraints(deviceId);
  const audioChoices = audio ? [true, false] : [false];
  let lastError = null;

  for (const wantsAudio of audioChoices) {
    for (const video of videoChoices) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video, audio: wantsAudio });
        await improveCameraFocus(stream);
        return stream;
      } catch (e) {
        lastError = e;
      }
    }
  }

  const detail = lastError?.name ? ` (${lastError.name})` : '';
  throw new Error(`카메라를 사용할 수 없습니다. 권한과 브라우저 설정을 확인해 주세요.${detail}`);
}

/**
 * 카메라 오류를 화면에 보여줄 한국어 메시지로 분류한다.
 * getUserMedia 실패 원인은 권한 거부 말고도 다양한데(기기가 이미 사용 중,
 * 카메라 없음, 제약 조건 불충족 등) 전부 "권한을 허용해주세요"로 뭉뚱그리면
 * 실제 원인과 다른 안내가 나가 사용자가 잘못된 조치(권한은 이미 줬는데 계속
 * 설정만 들여다봄)를 하게 된다. err.name(네이티브 예외) 또는
 * openMainCameraStream 이 메시지 끝에 붙이는 "(ErrorName)" 표기 둘 다에서
 * 원인을 추출해 분류한다.
 * @param {Error} err
 * @returns {string}
 */
export function describeCameraError(err) {
  const fromMessage = /\(([A-Za-z]+)\)\s*$/.exec(err?.message || '')?.[1];
  const name = (err?.name && err.name !== 'Error') ? err.name : (fromMessage || '');

  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return '카메라 권한을 허용해주세요.';
    case 'NotReadableError':
    case 'TrackStartError':
      return '카메라를 시작할 수 없습니다. 다른 앱에서 카메라를 사용 중인지 확인한 뒤 다시 시도해 주세요.';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'OverconstrainedError':
      return '사용 가능한 카메라를 찾지 못했습니다. 기기의 카메라 연결 상태를 확인해 주세요.';
    case 'AbortError':
      return '카메라 시작이 중단되었습니다. 다시 시도해 주세요.';
    default:
      return err?.message || '카메라를 시작할 수 없습니다. 잠시 후 다시 시도해 주세요.';
  }
}
