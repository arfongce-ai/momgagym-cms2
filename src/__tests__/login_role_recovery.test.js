import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = path => readFileSync(join(process.cwd(), path), 'utf8');

describe('관리자·기존 트레이너 로그인 권한 복구', () => {
  it('대표 관리자 이메일은 역할 문서 유실 시에도 복구 진입할 수 있다', () => {
    const auth = read('src/contexts/AuthContext.jsx');
    const rules = read('firestore.rules');
    expect(auth).toContain("const OWNER_EMAIL = 'momgagym@naver.com'");
    expect(rules).toContain("request.auth.token.email == 'momgagym@naver.com'");
    expect(rules).toContain('hasOwnerEmail()');
    expect(rules).not.toContain("request.auth.token.firebase.sign_in_provider != 'anonymous'");
  });

  it('권한 없는 기존 계정은 비밀번호 없이 연결 요청만 남긴다', () => {
    const auth = read('src/contexts/AuthContext.jsx');
    const rules = read('firestore.rules');
    expect(auth).toContain("doc(db, 'loginRequests', fbUser.uid)");
    expect(auth).toContain('approveKnownTrainerRequests(role)');
    expect(rules).toContain('match /loginRequests/{uid}');
    expect(rules).toContain("hasOnly(['email', 'requestedAt'])");
  });

  it('로그인 순간 서버가 누락된 역할과 트레이너 UID를 자동 복구한다', () => {
    const auth = read('src/contexts/AuthContext.jsx');
    const api = read('functions/api/login-role.js');
    expect(auth).toContain("fetch('/api/login-role'");
    expect(api).toContain("collectionId: 'trainers'");
    expect(api).toContain("fieldPath: 'loginEmail'");
    expect(api).toContain("await setRoleDocument(accessToken, user.uid, 'trainer', user.email)");
    expect(api).toContain('await linkTrainerUid(accessToken, trainer, user.uid)');
    expect(api).toContain('await verifyRequiredDataRead(user.idToken)');
    expect(auth).toContain('const retryData = async () =>');
    expect(auth).toContain("initStore({ force: true })");
  });

  it('인증 후속 작업이 실패해도 PC가 무한 로딩에 갇히지 않는다', () => {
    const auth = read('src/contexts/AuthContext.jsx');
    expect(auth).toContain('const AUTH_STEP_TIMEOUT_MS = 20000');
    expect(auth).toContain("await withTimeout(resolveRole(fbUser), '로그인 권한 확인')");
    expect(auth).toContain('} finally {\n        setLoading(false);');
  });

  it('관리자용 로그인 요청 조회 실패는 로그인 전체를 중단시키지 않는다', () => {
    const auth = read('src/contexts/AuthContext.jsx');
    expect(auth).toContain("console.error('[trainer 로그인 요청 목록 조회 실패]', error)");
    expect(auth).toContain('return 0;');
  });
});
