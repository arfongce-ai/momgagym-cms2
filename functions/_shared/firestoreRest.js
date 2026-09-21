// functions/_shared/firestoreRest.js
// ════════════════════════════════════════════════════════════════════════
//  영양 앱 연동(functions/api/nutrition-*.js, teacher-nutrition.js)이 공통으로
//  쓰는 Firestore REST 값 인코딩/디코딩 + 조회·쓰기 헬퍼.
//
//  trainer-account.js / login-role.js가 이미 서비스 계정 access token으로
//  Firestore REST를 직접 호출하는 패턴을 쓰고 있어(Admin SDK 없이도 규칙을
//  우회할 수 있음), 그 패턴을 그대로 재사용하되 여러 파일에서 반복되던
//  "JS 값 ↔ Firestore {stringValue:...} 포맷" 변환을 한 곳으로 모았다.
//
//  getGoogleAccessToken(env)는 functions/api/trainer-account.js의 것을 그대로
//  가져다 쓴다(중복 구현 금지 — 서비스 계정 캐시도 하나만 유지).
// ════════════════════════════════════════════════════════════════════════
import { getGoogleAccessToken } from '../api/trainer-account.js';

export { getGoogleAccessToken };

const PROJECT_ID = 'momgagym-cms';
const BASE_URL = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

/** JS 값 → Firestore REST value. 회원/영양 요약 문서에 필요한 타입만 지원한다. */
export function toFirestoreValue(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') {
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map(toFirestoreValue) } };
  }
  if (typeof value === 'object') {
    return { mapValue: { fields: toFirestoreFields(value) } };
  }
  return { stringValue: String(value) };
}

export function toFirestoreFields(obj = {}) {
  const fields = {};
  Object.entries(obj).forEach(([key, value]) => {
    if (value === undefined) return; // Firestore REST는 undefined 필드를 못 씀 — 생략
    fields[key] = toFirestoreValue(value);
  });
  return fields;
}

/** Firestore REST value → JS 값. */
export function fromFirestoreValue(value) {
  if (!value) return null;
  if ('nullValue' in value) return null;
  if ('stringValue' in value) return value.stringValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return Number(value.doubleValue);
  if ('timestampValue' in value) return value.timestampValue;
  if ('arrayValue' in value) return (value.arrayValue.values || []).map(fromFirestoreValue);
  if ('mapValue' in value) return fromFirestoreFields(value.mapValue.fields || {});
  return null;
}

export function fromFirestoreFields(fields = {}) {
  const obj = {};
  Object.entries(fields).forEach(([key, value]) => {
    obj[key] = fromFirestoreValue(value);
  });
  return obj;
}

/** Firestore 문서(REST 응답)를 { id, ...평문필드 } 형태로 변환. 문서 없으면 null. */
export function docToPlain(document) {
  if (!document) return null;
  const marker = document.name?.lastIndexOf('/') ?? -1;
  const id = marker >= 0 ? document.name.slice(marker + 1) : null;
  return { id, ...fromFirestoreFields(document.fields || {}) };
}

/** 문서 1개 조회. 없으면 null. */
export async function getDocument(accessToken, path) {
  const res = await fetch(`${BASE_URL}/${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw Object.assign(new Error(`Firestore 문서 조회 실패: ${path}`), { status: 503 });
  return res.json();
}

/** 문서 생성/전체교체(setDoc 방식 — 지정한 필드로 완전히 덮어씀). */
export async function setDocument(accessToken, path, fields) {
  const res = await fetch(`${BASE_URL}/${path}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ fields: toFirestoreFields(fields) }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw Object.assign(new Error(`Firestore 문서 저장 실패: ${path} ${body}`), { status: 503 });
  }
  return res.json();
}

/** 지정한 필드만 부분 업데이트(updateMask). */
export async function patchDocument(accessToken, path, fields) {
  const mask = Object.keys(fields).map(k => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join('&');
  const res = await fetch(`${BASE_URL}/${path}?${mask}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ fields: toFirestoreFields(fields) }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw Object.assign(new Error(`Firestore 문서 수정 실패: ${path} ${body}`), { status: 503 });
  }
  return res.json();
}

export async function deleteDocument(accessToken, path) {
  const res = await fetch(`${BASE_URL}/${path}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok && res.status !== 404) {
    throw Object.assign(new Error(`Firestore 문서 삭제 실패: ${path}`), { status: 503 });
  }
}

/** 단순 동등조건 쿼리(컬렉션 전체에서 field==value). */
export async function queryEquals(accessToken, collectionId, field, value, limit = 20) {
  const res = await fetch(`${BASE_URL}:runQuery`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId }],
        where: {
          fieldFilter: {
            field: { fieldPath: field },
            op: 'EQUAL',
            value: toFirestoreValue(value),
          },
        },
        limit,
      },
    }),
  });
  if (!res.ok) throw Object.assign(new Error(`Firestore 조회 실패: ${collectionId}.${field}`), { status: 503 });
  const rows = await res.json();
  return rows.map(row => docToPlain(row.document)).filter(Boolean);
}

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
