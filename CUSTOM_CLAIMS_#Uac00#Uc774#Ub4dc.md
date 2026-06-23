# Custom Claims로 권한 강화하기 (권장 아키텍처)

현재 구조는 `roles/{uid}` 문서를 읽어 관리자 여부를 판단합니다.
보안 규칙으로 `roles` 쓰기를 막아두었으니 클라이언트 조작은 불가능하지만,
한 단계 더 견고하게 하려면 **Custom Claims**를 token에 직접 새기는 방식이 좋습니다.

## 왜 Custom Claims가 더 좋은가
- 권한이 **로그인 토큰(JWT) 안**에 들어가, Firestore 문서를 한 번 더 읽지 않아도 됨(보안 규칙에서 `get()` 비용 0).
- 클라이언트가 토큰을 위조할 수 없음(서명되어 있음). roles 문서가 아예 없어도 안전.
- 보안 규칙이 단순해짐: `request.auth.token.admin == true`.

## 적용 절차

### 1) 서버(Admin SDK)에서 관리자에게 claim 부여
Cloud Functions 또는 1회성 Node 스크립트로 실행합니다. (Admin SDK는 서버 전용 — 클라이언트에 키를 넣지 마세요.)

```js
// setAdmin.js  (Node, firebase-admin 필요)
const admin = require('firebase-admin');
admin.initializeApp({ credential: admin.credential.applicationDefault() });

const ADMIN_UID = '여기에_관리자_UID';
admin.auth().setCustomUserClaims(ADMIN_UID, { admin: true })
  .then(() => console.log('admin claim 부여 완료'))
  .then(() => process.exit(0));
```

실행:
```bash
GOOGLE_APPLICATION_CREDENTIALS=service-account.json node setAdmin.js
```

### 2) 보안 규칙을 claim 기반으로 교체
`firestore.rules`의 `isAdmin()`을 다음으로 바꿉니다(roles 문서 조회 불필요):

```
function isAdmin() {
  return request.auth != null && request.auth.token.admin == true;
}
```

`roles` 컬렉션 규칙은 그대로 둬도 무방하며, 더 이상 권한 판단에 쓰이지 않으므로
원하면 read도 `if false`로 닫을 수 있습니다.

### 3) 클라이언트에서 claim 읽기
로그인 후 `getIdTokenResult()`로 claim을 읽습니다. claim은 토큰 갱신 후 반영되므로
부여 직후에는 `getIdToken(true)`로 강제 새로고침이 필요합니다.

```js
const { claims } = await user.getIdTokenResult();
const role = claims.admin ? 'admin' : 'staff';
```

(AuthContext는 이미 claim을 우선 읽고, 없으면 roles 문서로 폴백하도록 수정해 두었습니다.)

### 4) claim 부여 직후 토큰 새로고침
관리자에게 claim을 막 부여한 경우, 해당 사용자는 한 번 로그아웃/재로그인하거나
앱에서 `await auth.currentUser.getIdToken(true)`를 호출해야 새 권한이 적용됩니다.

## 마이그레이션 동안의 호환
AuthContext는 **claim → roles 문서** 순으로 역할을 결정합니다.
따라서 일부 관리자에게만 claim을 부여한 상태에서도 기존 roles 문서 사용자는 그대로 동작하며,
claim 전환을 점진적으로 진행할 수 있습니다.
