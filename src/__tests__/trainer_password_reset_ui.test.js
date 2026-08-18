import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = path => readFileSync(join(process.cwd(), 'src', path), 'utf8');

describe('트레이너 비밀번호 재설정과 과다 요청 안내', () => {
  it('관리자가 기존 계정에 재설정 메일을 보낼 수 있다', () => {
    const page = read('pages/Trainers.jsx');
    const service = read('services/trainerAccountService.js');
    expect(page).toContain('비밀번호 재설정 메일 보내기');
    expect(page).toContain('sendTrainerPasswordReset(email)');
    expect(service).toContain('sendPasswordResetEmail(auth, normalizedEmail)');
  });

  it('Firebase 과다 요청 원문 대신 한글 안내를 보여준다', () => {
    const auth = read('contexts/AuthContext.jsx');
    const service = read('services/trainerAccountService.js');
    expect(auth).toContain("fbErr?.code === 'auth/too-many-requests'");
    expect(service).toContain("error?.code === 'auth/too-many-requests'");
  });
});
