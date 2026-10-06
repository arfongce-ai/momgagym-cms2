import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { NotionClient } from './notionClient.mjs';
import { runNotionVideoWorkflow } from './notionWorkflow.mjs';
import { prepareReview } from './prepare-review.mjs';

const CONTENT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../content-video');
const PRIVATE_ENV = Object.freeze({
  consentToken: 'NOTION_CONSENT_READ_TOKEN',
  consentDataSourceId: 'NOTION_CONSENT_DATA_SOURCE_ID',
  calendarToken: 'NOTION_CONTENT_CALENDAR_TOKEN',
  calendarDataSourceId: 'NOTION_CONTENT_CALENDAR_DATA_SOURCE_ID',
});

async function readConfig() {
  return JSON.parse(await readFile(path.join(CONTENT_DIR, 'config.local.json'), 'utf8'));
}

export async function runConfiguredNotionReview({ env = process.env, processJob = prepareReview } = {}) {
  if (!Object.values(PRIVATE_ENV).every((key) => typeof env[key] === 'string' && env[key].trim())) throw new Error('NOTION');
  const config = await readConfig();
  const consentClient = new NotionClient({ token: env[PRIVATE_ENV.consentToken], access: 'read' });
  const calendarClient = new NotionClient({ token: env[PRIVATE_ENV.calendarToken], access: 'write' });
  return runNotionVideoWorkflow({
    consentClient,
    calendarClient,
    consentDataSourceId: env[PRIVATE_ENV.consentDataSourceId],
    calendarDataSourceId: env[PRIVATE_ENV.calendarDataSourceId],
    processClip: async ({ clip, channels, consentSnapshot }) => processJob({
      config,
      consentSnapshot,
      manifest: { publishing: { channels }, clips: [clip] },
    }),
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const summary = await runConfiguredNotionReview();
    for (const [code, count] of Object.entries(summary.failed)) console.log(`${code}:${count}`);
    if (summary.blocked) console.log(`BLOCKED:${summary.blocked}`);
    console.log(`PROCESSED:${summary.processed} REVIEWED:${summary.reviewed} SKIPPED:${summary.skipped}`);
    if (summary.blocked || Object.keys(summary.failed).length) process.exitCode = 1;
  } catch {
    console.error('NOTION');
    process.exitCode = 1;
  }
}
