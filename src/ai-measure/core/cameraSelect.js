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
  if (!navigator?.mediaDevices?.getUserMedia) {
    throw new Error('이 브라우저에서는 카메라 API를 사용할 수 없습니다.');
  }
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
        return await navigator.mediaDevices.getUserMedia({ video, audio: wantsAudio });
      } catch (e) {
        lastError = e;
      }
    }
  }

  const detail = lastError?.name ? ` (${lastError.name})` : '';
  throw new Error(`카메라를 사용할 수 없습니다. 권한과 브라우저 설정을 확인해 주세요.${detail}`);
}
