// src/utils/momiLog.js
// [2026-11-13] 모미 화면 진단 기록. 폰·키오스크처럼 콘솔을 볼 수 없는 기기에서
// "왜 반응이 없는지"를 화면 캡처 한 장으로 확인하기 위한 것.
// 설정 화면의 "모미 화면 기록" 스위치로 켜고 끈다(이 기기에 기억). 앱처럼 설치해 주소창이
// 없는 기기에서도 쓸 수 있게 하기 위함. 주소에 ?momilog=1 / ?momilog=0 을 붙여도 된다.
// 꺼져 있을 때는 아무것도 기록하지 않고 화면에도 아무것도 그리지 않는다.
// 기록은 이 기기 메모리에만 있고 어디에도 저장·전송하지 않는다.

const KEY = 'momiLog';
const MAX = 14;
const entries = [];
const listeners = new Set();
let enabledCache = null;
let consoleHooked = false;

function readEnabled() {
  if (typeof window === 'undefined') return false;
  try {
    const param = new URLSearchParams(window.location?.search || '').get('momilog');
    if (param === '1') window.localStorage?.setItem(KEY, '1');
    if (param === '0') window.localStorage?.removeItem(KEY);
    return window.localStorage?.getItem(KEY) === '1';
  } catch (e) {
    return false;
  }
}

export function isMomiLogEnabled() {
  if (enabledCache === null) enabledCache = readEnabled();
  return enabledCache;
}

// 설정 화면 스위치용 — 새로고침 없이 바로 켜고 끈다.
export function setMomiLogEnabled(on) {
  enabledCache = !!on;
  try {
    if (on) window.localStorage?.setItem(KEY, '1');
    else window.localStorage?.removeItem(KEY);
  } catch (e) { /* no-op */ }
  if (!on) entries.length = 0;
  listeners.forEach((fn) => {
    try { fn(); } catch (e) { /* no-op */ }
  });
  if (on) momiLog('화면 기록 켬');
}

function clock() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function momiLog(text) {
  if (!isMomiLogEnabled()) return;
  const line = String(text).slice(0, 90);
  const last = entries[entries.length - 1];
  // 같은 줄이 연달아 오면(무음 재시작 반복 등) 횟수만 올려 화면을 밀어내지 않게 한다.
  if (last && last.text === line) {
    last.count += 1;
    last.time = clock();
  } else {
    entries.push({ time: clock(), text: line, count: 1 });
    if (entries.length > MAX) entries.shift();
  }
  listeners.forEach((fn) => {
    try { fn(); } catch (e) { /* no-op */ }
  });
}

export function getMomiLogEntries() {
  return entries.slice();
}

export function subscribeMomiLog(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// 기존 코드가 이미 콘솔에 남기는 "[모미] ..." 줄도 화면 기록으로 같이 가져온다.
export function hookMomiConsole() {
  if (consoleHooked || !isMomiLogEnabled() || typeof console === 'undefined') return;
  consoleHooked = true;
  ['log', 'info', 'warn'].forEach((level) => {
    const original = console[level]?.bind(console);
    if (!original) return;
    console[level] = (...args) => {
      try {
        if (typeof args[0] === 'string' && args[0].includes('[모미]')) {
          momiLog(args.map((a) => (typeof a === 'string' ? a : String(a?.message || a))).join(' ').replace('[모미] ', ''));
        }
      } catch (e) { /* no-op */ }
      original(...args);
    };
  });
}
