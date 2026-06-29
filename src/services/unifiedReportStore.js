import { doc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { buildUnifiedReportDocument } from '../ai-measure/core/unifiedReport';

export async function saveUnifiedReport({
  userId,
  reportId,
  report,
  reportType,
  member,
  share,
} = {}) {
  const targetUserId = userId || member?.id || report?.member?.id || report?.memberId || report?.basic_info?.memberId;
  if (!targetUserId) throw new Error('userId is required to save a unified report.');

  const document = buildUnifiedReportDocument(report || {}, {
    userId: targetUserId,
    reportId,
    reportType,
    member: { ...(member || report?.member || {}), id: targetUserId },
    share,
  });

  await setDoc(doc(db, 'users', targetUserId, 'reports', document.reportId), document, { merge: true });
  return document;
}

