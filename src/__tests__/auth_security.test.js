import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('CMS 인증 보안 배선', () => {
  it('로그인 전에 익명 인증으로 Firestore를 열지 않는다', () => {
    const auth = readFileSync(join(process.cwd(), 'src/contexts/AuthContext.jsx'), 'utf8');
    expect(auth).not.toContain('signInAnonymously');
    expect(auth).not.toContain('fitcms_trainer_session');
  });

  it('Firestore 운영 데이터는 등록된 역할 계정만 접근한다', () => {
    const rules = readFileSync(join(process.cwd(), 'firestore.rules'), 'utf8');
    expect(rules).toContain('exists(/databases/$(database)/documents/roles/$(request.auth.uid))');
    expect(rules).not.toContain("request.auth.token.firebase.sign_in_provider != 'anonymous'");
    expect(rules).toContain("isAdmin() || hasRole('staff') || hasRole('trainer')");
    expect(rules).toContain("request.auth.token.admin == true");
    expect(rules).toContain('match /members/{id}    { allow read, write: if isAuthorized(); }');
    expect(rules).toContain('request.auth.uid == uid');
  });

  it('트레이너 비밀번호를 CMS나 Firestore에 저장하지 않는다', () => {
    const trainers = readFileSync(join(process.cwd(), 'src/pages/Trainers.jsx'), 'utf8');
    const store = readFileSync(join(process.cwd(), 'src/demoData.js'), 'utf8');
    expect(trainers).not.toContain('loginPassword');
    expect(store).toContain('withoutLegacyTrainerPassword');
    expect(store).toContain('purgeLegacyTrainerPasswords');
  });
});
