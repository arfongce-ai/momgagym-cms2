// src/__tests__/nutrition_link_shared.test.js
// 영양 앱 연동(functions/_shared/*, functions/api/nutrition-*)의 순수 로직만
// 골라 테스트한다. Cloudflare Pages Functions 런타임(실제 fetch로 Firestore
// REST 호출)까지는 이 스위트로 검증하지 않는다 — 그건 배포 후 수동/이용기간
// 만료 테스트로 확인(claude/2026-09-17_영양앱-CMS연동_1단계조사_설계문서.md
// 섹션 8 테스트 계획 참고). 여기서는 값 인코딩과 토큰 서명·검증처럼 "틀리면
// 조용히 모든 요청이 깨지는" 부분만 자동화한다.
import { describe, it, expect, vi } from 'vitest';
import {
  toFirestoreValue, fromFirestoreValue, toFirestoreFields, fromFirestoreFields, docToPlain, getDocument, queryEquals,
} from '../../functions/_shared/firestoreRest.js';
import {
  signConnectionToken, verifyConnectionToken, newJti, newLinkCode,
} from '../../functions/_shared/nutritionToken.js';

describe('firestoreRest 값 인코딩', () => {
  it('단일 문서 조회는 요청한 필드만 마스킹한다', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ fields: {} })));
    try {
      await getDocument('token', 'settings/config', ['vatRate', 'expiryWarnDays']);
      expect(fetchSpy.mock.calls[0][0]).toContain('mask.fieldPaths=vatRate&mask.fieldPaths=expiryWarnDays');
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('동등조건 조회는 필드 선택, 최신순 정렬, 제한을 Firestore 쿼리에 함께 전달한다', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('[]'));
    try {
      await queryEquals('token', 'nutritionSummaries', 'memberRef', 'm1', 7, {
        select: ['memberRef', 'date', 'totals'],
        orderBy: { fieldPath: 'date', direction: 'DESCENDING' },
      });
      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(body.structuredQuery).toMatchObject({
        limit: 7,
        select: { fields: [{ fieldPath: 'memberRef' }, { fieldPath: 'date' }, { fieldPath: 'totals' }] },
        orderBy: [{ field: { fieldPath: 'date' }, direction: 'DESCENDING' }],
      });
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('문자열·숫자·불리언·배열·중첩객체를 왕복 변환해도 원래 값과 같다', () => {
    const original = {
      memberRef: 'member_123',
      recordedMealCount: 3,
      dayCompleted: true,
      totals: { calories: 1820.5, carbG: 220, waterMl: 0 },
      tags: ['a', 'b'],
      dailyNote: null,
    };
    const encoded = toFirestoreFields(original);
    const decoded = fromFirestoreFields(encoded);
    expect(decoded).toEqual(original);
  });

  it('정수는 integerValue로, 소수는 doubleValue로 인코딩한다(Firestore REST 요구사항)', () => {
    expect(toFirestoreValue(220)).toEqual({ integerValue: '220' });
    expect(toFirestoreValue(220.5)).toEqual({ doubleValue: 220.5 });
  });

  it('undefined 필드는 인코딩 결과에서 생략된다(Firestore REST가 undefined를 거부하므로)', () => {
    const encoded = toFirestoreFields({ a: 1, b: undefined });
    expect(Object.keys(encoded)).toEqual(['a']);
  });

  it('docToPlain은 문서 name 경로 끝에서 id를 뽑아내고 필드를 평문화한다', () => {
    const document = {
      name: 'projects/x/databases/(default)/documents/members/member_123',
      fields: { name: { stringValue: '홍길동' }, isActive: { booleanValue: true } },
    };
    expect(docToPlain(document)).toEqual({ id: 'member_123', name: '홍길동', isActive: true });
  });

  it('문서가 없으면(null) docToPlain도 null을 돌려준다', () => {
    expect(docToPlain(null)).toBeNull();
  });
});

describe('nutritionToken 연결 토큰', () => {
  const env = { NUTRITION_LINK_SECRET: 'test-secret-only-for-unit-tests' };

  it('서명한 토큰을 같은 비밀키로 검증하면 memberRef/jti가 그대로 돌아온다', async () => {
    const jti = newJti();
    const token = await signConnectionToken(env, { memberRef: 'member_123', jti });
    const result = await verifyConnectionToken(env, `Bearer ${token}`);
    expect(result).toEqual({ memberRef: 'member_123', jti });
  });

  it('Authorization 헤더가 없으면 401로 거부한다', async () => {
    await expect(verifyConnectionToken(env, null)).rejects.toMatchObject({ status: 401 });
  });

  it('다른 비밀키로 서명된 토큰은 거부한다(연동토큰 위조 방지)', async () => {
    const jti = newJti();
    const token = await signConnectionToken({ NUTRITION_LINK_SECRET: 'other-secret' }, { memberRef: 'm1', jti });
    await expect(verifyConnectionToken(env, `Bearer ${token}`)).rejects.toMatchObject({ status: 401 });
  });

  it('NUTRITION_LINK_SECRET이 없으면 즉시 503으로 실패한다(조용히 통과시키지 않음)', async () => {
    await expect(signConnectionToken({}, { memberRef: 'm1', jti: 'j1' })).rejects.toMatchObject({ status: 503 });
  });

  it('newLinkCode는 8자리이며 혼동되는 문자(0/O/1/I)를 포함하지 않는다', () => {
    const code = newLinkCode();
    expect(code).toHaveLength(8);
    expect(code).not.toMatch(/[01OI]/);
  });

  it('newJti는 호출할 때마다 다른 값을 만든다(연결 토큰 재사용/충돌 방지)', () => {
    const seen = new Set(Array.from({ length: 20 }, () => newJti()));
    expect(seen.size).toBe(20);
  });
});
