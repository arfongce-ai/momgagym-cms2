// 회원·결제 엑셀(매출관리 양식) 파서.
// 한 행 = 결제 1건. 회원별로 묶어 { member, payments[] } 구조로 변환한다.
// Members.jsx와 테스트에서 공용으로 사용.

// 집계/요약 행(회원이 아님) — 이 이름들은 건너뛴다.
const NON_MEMBER = new Set(['총매출', '고정지출', '순익', '합계', '부가세', '현금', '카드1', '카드2', '입금', '구매 지출', '구매지출']);

// 결제수단 라벨 → CMS 내부 키
export function normalizeMethod(raw) {
  const m = String(raw ?? '').replace(/\s/g, '');
  if (!m || m === 'nan') return 'transfer';
  if (/울산페이|울신페이|^페이$/.test(m)) return 'pay';
  if (/현금영수증/.test(m)) return 'cash_receipt';
  if (/^현금$/.test(m)) return 'cash';
  if (/^계좌$/.test(m)) return 'transfer';
  if (/^카드1$/.test(m)) return 'card1';
  if (/^카드2$/.test(m)) return 'card2';
  if (/^카드$/.test(m)) return 'card1';
  return 'transfer';
}

// 세션 표기 파싱: '10s'→{kind:session,count:10}, '1m'→{kind:monthly}, '30S'→30, ''→etc
export function parseSession(raw) {
  const s = String(raw ?? '').trim().toLowerCase();
  if (!s || s === 'nan' || s === '입금') return { kind: 'etc', count: 0 };
  let mm = s.match(/(\d+)\s*m/);
  if (mm) return { kind: 'monthly', count: Number(mm[1]) };
  mm = s.match(/(\d+)\s*s/);
  if (mm) return { kind: 'session', count: Number(mm[1]) };
  mm = s.match(/(\d+)/);
  if (mm) return { kind: 'session', count: Number(mm[1]) };
  return { kind: 'etc', count: 0 };
}

// 엑셀 시리얼 날짜 → 'YYYY-MM-DD' (문자열 날짜면 그대로 정규화)
export function excelDate(v) {
  if (v == null || v === '') return '';
  if (typeof v === 'number' || /^\d+(\.\d+)?$/.test(String(v))) {
    const n = Number(v);
    const d = new Date(Date.UTC(1899, 11, 30) + n * 86400000);
    if (!isNaN(d)) return d.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  const m = s.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  return '';
}

// 매출관리 '등록회원' 시트(rows[][]) 파싱.
// 헤더행을 찾아 컬럼 위치를 잡고, 데이터행을 결제 레코드로 만든다.
// trainerNameToId: { '김동규': 't_id', ... } (약칭은 호출 측에서 먼저 이름으로 치환하거나 별도 맵 제공)
// abbrToName: { '동규T':'김동규', ... }
export function parsePaymentSheet(rows, { abbrToName = {}, trainerNameToId = {} } = {}) {
  // 1) 헤더행 탐지: '이름'과 '금액'이 같은 행에 있는 곳
  let hi = -1, col = {};
  for (let r = 0; r < rows.length; r++) {
    const cells = (rows[r] || []).map(c => String(c ?? '').trim());
    const find = (...names) => cells.findIndex(c => names.some(n => c === n || c.replace(/\s/g, '') === n));
    const nameC = find('이름');
    const amtC = find('금액');
    if (nameC >= 0 && amtC >= 0) {
      hi = r;
      col = {
        date: find('날짜'), name: nameC, sess: find('세션'), amount: amtC,
        vat: find('부가세', '부가세(10%)'), method: find('수단'),
        consult: find('상담'), trainer: find('담당'), content: find('내용'), deposit: find('입금'),
      };
      break;
    }
  }
  if (hi < 0) return { records: [], skipped: 0 };

  const resolveTrainer = (abbr) => {
    const a = String(abbr ?? '').trim();
    if (!a || a === 'nan') return { name: '', id: '' };
    const name = abbrToName[a] || a;
    return { name, id: trainerNameToId[name] || '' };
  };

  const records = [];
  let skipped = 0;
  for (let r = hi + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const get = (i) => (i >= 0 ? row[i] : null);
    const name = String(get(col.name) ?? '').trim();
    const amount = Number(String(get(col.amount) ?? '').replace(/[, ]/g, ''));
    if (!name || NON_MEMBER.has(name)) { if (name) skipped++; continue; }
    if (!Number.isFinite(amount) || amount === 0) continue;

    const sess = parseSession(get(col.sess));
    const tr = resolveTrainer(get(col.trainer));
    const cs = resolveTrainer(get(col.consult));
    const vat = Number(String(get(col.vat) ?? '').replace(/[, ]/g, '')) || 0;
    const deposit = Number(String(get(col.deposit) ?? '').replace(/[, ]/g, ''));

    records.push({
      date: excelDate(get(col.date)),
      name,
      kind: amount < 0 ? 'refund' : sess.kind,   // refund / monthly / session / etc
      sessionCount: sess.kind === 'session' ? sess.count : 0,
      amount,
      vat,
      deposit: Number.isFinite(deposit) ? deposit : amount,
      method: normalizeMethod(get(col.method)),
      trainerName: tr.name, trainerId: tr.id,
      consultName: cs.name, consultId: cs.id,
      content: String(get(col.content) ?? '').trim().replace(/^nan$/, ''),
    });
  }
  return { records, skipped };
}

// 결제 레코드를 회원 단위로 묶어 가져오기 구조로 변환.
// 같은 이름은 한 회원으로 보고 결제들을 누적(재등록). 환불은 별도 표시.
export function buildMemberImport(records) {
  const byName = new Map();
  for (const rec of records) {
    if (!byName.has(rec.name)) {
      byName.set(rec.name, { name: rec.name, monthly: null, trainerSessions: {}, classTypes: new Set(), payments: [], lastPaymentDate: '', warnings: [] });
    }
    const M = byName.get(rec.name);
    if (rec.content) M.classTypes.add(rec.content);
    if (rec.date && rec.date > M.lastPaymentDate) M.lastPaymentDate = rec.date;

    if (rec.kind === 'refund') {
      M.payments.push({ ...payloadOf(rec), isRefunded: true });
      M.warnings.push(`환불 ${rec.amount.toLocaleString()}원`);
      continue;
    }
    if (rec.kind === 'monthly') {
      M.monthly = { active: true, fee: rec.amount, dueDate: addMonth(rec.date), startDate: rec.date };
      M.payments.push(payloadOf(rec));
      continue;
    }
    // 세션
    if (rec.trainerId && rec.sessionCount > 0) {
      const slot = M.trainerSessions[rec.trainerId] || { total: 0, remaining: 0 };
      slot.total += rec.sessionCount; slot.remaining += rec.sessionCount;
      M.trainerSessions[rec.trainerId] = slot;
    } else if (rec.sessionCount > 0 && !rec.trainerId) {
      M.warnings.push('담당 트레이너 매칭 실패');
    }
    M.payments.push(payloadOf(rec));
  }
  return [...byName.values()].map(M => ({ ...M, classTypes: [...M.classTypes] }));
}

function payloadOf(rec) {
  const p = {
    amount: Math.abs(rec.amount) * (rec.amount < 0 ? -1 : 1),
    method: rec.method,
    paidAt: rec.date,
    trainerIds: rec.trainerId ? [rec.trainerId] : [],
    sessionAdds: (rec.kind === 'session' && rec.trainerId && rec.sessionCount > 0)
      ? [{ trainerId: rec.trainerId, count: rec.sessionCount, classType: rec.content || '' }] : [],
    splitRateAtPay: rec.trainerId ? { [rec.trainerId]: 50 } : {},
    isReEnroll: false,        // 가져오기 단계에서는 일괄 false (이후 재등록은 앱에서)
    consultTrainerId: rec.consultId || '',
    note: rec.vat ? `부가세 ${rec.vat.toLocaleString()}` : '',
  };
  return p;
}

function addMonth(ymd) {
  if (!ymd) return '';
  const [y, m, d] = ymd.split('-').map(Number);
  const nm = m === 12 ? 1 : m + 1; const ny = m === 12 ? y + 1 : y;
  return `${ny}-${String(nm).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
