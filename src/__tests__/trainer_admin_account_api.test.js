import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = path => readFileSync(join(process.cwd(), path), 'utf8');

describe('관리자 트레이너 계정 API', () => {
  it('서버에서 관리자 토큰과 서비스 계정 키를 검증한다', () => {
    const api = read('functions/api/trainer-account.js');
    expect(api).toContain('await verifyAdmin(request, accessToken)');
    expect(api).toContain('env.FIREBASE_SERVICE_ACCOUNT_JSON');
    expect(api).toContain("identityRequest('accounts:update'");
  });

  it('기존 계정 이메일·비밀번호 변경과 계정 삭제를 지원한다', () => {
    const api = read('functions/api/trainer-account.js');
    const page = read('src/pages/Trainers.jsx');
    expect(api).toContain("identityRequest('accounts:update'");
    expect(api).toContain("identityRequest('accounts:delete'");
    expect(page).toContain('관리자가 아이디·비밀번호 생성 및 변경');
    expect(page).toContain('deleteTrainerAuthAccount(target.authUid, target.loginEmail)');
  });

  it('브라우저는 관리자 ID 토큰으로만 서버 API를 호출한다', () => {
    const service = read('src/services/trainerAccountService.js');
    expect(service).toContain("fetch('/api/trainer-account'");
    expect(service).toContain('currentUser.getIdToken()');
    expect(service).not.toContain('FIREBASE_SERVICE_ACCOUNT_JSON');
  });
});
