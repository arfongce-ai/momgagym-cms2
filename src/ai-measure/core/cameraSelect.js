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
