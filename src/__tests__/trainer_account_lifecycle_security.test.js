import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = path => readFileSync(join(process.cwd(), 'src', path), 'utf8');

describe('트레이너 계정 생명주기 보안', () => {
  it('삭제·이메일 변경·프로필 저장 실패 때 trainer 권한을 회수한다', () => {
    const page = read('pages/Trainers.jsx');
    const service = read('services/trainerAccountService.js');
    const api = readFileSync(join(process.cwd(), 'functions/api/trainer-account.js'), 'utf8');
    expect(page).toContain('revokeTrainerAccess(target.authUid)');
    expect(page).toContain('deleteTrainerAuthAccount(target.authUid, target.loginEmail)');
    expect(page).toContain('if (provisioned?.uid)');
    expect(service).toContain("action: 'revoke'");
    expect(api).toContain('await deleteRoleDocument');
    expect(api).toContain("identityRequest('accounts:delete'");
  });

  it('기존 수동 계정도 로그인 시 UID가 자동 연결된다', () => {
    const auth = read('contexts/AuthContext.jsx');
    expect(auth).toContain('linkTrainerUid(role, asTrainer, fbUser.uid)');
    expect(auth).toContain('linkTrainerUid(role, asTrainer, cred.user.uid)');
  });

  it('역할 문서에는 비밀번호가 아니라 role과 이메일만 허용한다', () => {
    const rules = readFileSync(join(process.cwd(), 'firestore.rules'), 'utf8');
    expect(rules).toContain("hasOnly(['role', 'email'])");
    expect(rules).toContain("request.resource.data.role == 'trainer'");
  });
});
