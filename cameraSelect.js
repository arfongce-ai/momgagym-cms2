// ai-measure/core/cameraSelect.js
// 후면 "메인(광각)" 카메라를 골라 스트림을 여는 공용 헬퍼.
//
// 왜 필요한가:
//  폰/태블릿엔 초광각·메인·망원 등 후면 렌즈가 여러 개다. facingMode:'environment'
//  만 지정하면 브라우저가 왜곡이 큰 초광각을 고를 수 있어 화면이 휘어 보인다.
//  enumerateDevices로 후면 목록을 받아 "메인"으로 보이는 렌즈를 우선 선택한다.

function score(label = '') {
  const l = label.toLowerCase();
  if (/ultra|wide angle|0\.5|초광각/.test(l)) return -2; // 초광각 → 회피(왜곡)
  if (/tele|망원|zoom|3x|5x/.test(l)) return -1;          // 망원 → 회피
  if (/main|메인|wide(?!\s*angle)|광각|back camera|camera2 0|^camera 0/.test(l)) return 2;
  return 0;
}

/** 후면 메인 카메라의 deviceId 추정(없으면 null). 권한 필요. */
export async function findMainBackCameraId() {
  try {
    const probe = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    const devices = await navigator.mediaDevices.enumerateDevices();
    const cams = devices.filter(d => d.kind === 'videoinput');
    const backCams = cams.filter(d => /back|rear|환경|후면|environment/i.test(d.label));
    const pickFrom = backCams.length ? backCams : cams;
    const sorted = [...pickFrom].sort((a, b) => score(b.label) - score(a.label));
    const id = sorted[0]?.deviceId || null;
    probe.getTracks().forEach(t => t.stop());
    return id;
  } catch (e) {
    return null;
  }
}

/**
 * 메인 후면 카메라 스트림을 연다(해상도 폴백 포함).
 * @param {{audio?:boolean}} opt
 * @returns {Promise<MediaStream>}
 */
export async function openMainCameraStream({ audio = false } = {}) {
  const id = await findMainBackCameraId();
  const list = [
    id ? { video: { deviceId: { exact: id }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio } : null,
    { video: { facingMode: { exact: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio },
    { video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }, audio },
    { video: { facingMode: 'environment' }, audio },
    { video: true, audio },
  ].filter(Boolean);
  for (const c of list) {
    try { return await navigator.mediaDevices.getUserMedia(c); }
    catch (e) { /* 다음 폴백 */ }
  }
  throw new Error('카메라를 사용할 수 없습니다. 권한을 확인해 주세요.');
}
