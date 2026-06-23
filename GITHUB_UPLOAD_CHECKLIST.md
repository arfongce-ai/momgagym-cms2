# GitHub Upload Checklist

1. Upload this project folder to GitHub with `package.json`, `package-lock.json`, `src`, `public`, and `firestore.rules` included.
2. Do not upload `node_modules`, `dist`, `.codex`, log files, or old ZIP files.
3. After GitHub upload, install dependencies with `npm install` or `npm ci`.
4. Verify locally with `npm run build`.
5. In Firebase Console, publish the latest `firestore.rules`. The `gait_reports` rule must exist for gait/jump comparison data.
6. Firestore stores measurement data only. Video files are shared/downloaded from the browser, not saved to Firestore.

Verified before packaging:
- Firebase SDK: `firebase@10.14.1`
- Chart dependency: `recharts@3.8.1`
- Tests: 128 passed
- Build: passed
