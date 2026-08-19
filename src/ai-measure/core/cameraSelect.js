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
    { facingMode: { exact: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
    { facingMode: { exact: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
    { facingMode: { exact: 'environment' } },
    { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
    { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
    { facingMode: 'environment' },
    true,
  ].filter(Boolean);
}

// 세션 내 후면 카메라 deviceId 캐시. 라벨(카메라 이름)은 getUserMedia 로 권한을
// 한 번 얻고 나면 그 뒤로는 enumerateDevices() 만으로도 계속 채워져 나온다
// (스펙 동작) — 그런데도 이 함수가 매 호출(실시간 측정 진입·모드 전환·재측정
// 마다)마다 별도 "probe" getUserMedia 를 새로 여는 바람에, 후면 확정 전 잠깐
// 전면 카메라가 열리는 기종이 있었다("실시간 촬영 시 전면카메라가 한번씩
// 켜짐" 버그의 원인 — probe 가 facingMode:{ideal:'environment'} 라는 물렁한
// 제약이라 브라우저/OS 카메라 HAL 이 초기화 중 기본(전면) 카메라를 먼저 여는
// 경우가 있었음). 한 세션에서 한 번만 probe 하고 이후로는 캐시된 deviceId 를
// 재사용해 반복적인 전면 카메라 노출을 없앤다.
let cachedBackCameraId = null;
let labelsUnlocked = false;

/** 다음 openMainCameraStream 호출부터 다시 probe 하도록 캐시를 비운다
 *  (예: 카메라 연결이 바뀌었거나 캐시된 deviceId 가 더 이상 유효하지 않을 때). */
export function resetCameraSelectionCache() {
  cachedBackCameraId = null;
  labelsUnlocked = false;
}

/**
 * Open the rear/main camera stream.
 * @param {{audio?: boolean, preferExactDevice?: boolean}} opt
 * @returns {Promise<MediaStream>}
 */
export async function openMainCameraStream({ audio = false, preferExactDevice = true } = {}) {
  assertMediaDevices();

  let deviceId = cachedBackCameraId;
  if (preferExactDevice && !labelsUnlocked) {
    // 이 세션에서 처음 여는 카메라만 probe 한다. 라벨(카메라 이름)을 얻으려면
    // 한 번은 getUserMedia 로 권한을 받아야 하는데, 이때 "environment"를
    // exact(하드 제약)로 먼저 시도해 전면 카메라가 열릴 가능성을 원천 차단한다.
    // exact 가 기기에서 지원되지 않으면(OverconstrainedError) 기존처럼 ideal 로
    // 한 번 더만 시도한다(마지막 안전판 — 그래도 대부분 후면이 선택됨).
    let probe = null;
    try {
      probe = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { exact: 'environment' } }, audio: false });
    } catch (e) {
      try {
        probe = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      } catch (e2) {
        probe = null;
      }
    }
    if (probe) {
      deviceId = await findMainBackCameraId();
      probe.getTracks().forEach((t) => t.stop());
      labelsUnlocked = true;
      cachedBackCameraId = deviceId;
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
        // 캐시된 deviceId 가 더 이상 유효하지 않으면(기기 분리·재연결 등)
        // 다음 시도부터는 버리고 facingMode 기반 제약으로 폴백한다.
        if (video?.deviceId?.exact === deviceId) {
          cachedBackCameraId = null;
          labelsUnlocked = false;
        }
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
