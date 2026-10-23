import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { parseProtectedJson, stringifyProtectedJson } from '@/lib/security/protected-json';
import { emptyPractice, practiceAction } from './learning-practice.mjs';
export type PracticeRecord = { version: number; prepScore: number; challengeScore: number; credits: number; claimedAt: string | null; updatedAt: string | null };
function location(subject: string) {
  const id = createHash('sha256').update(subject).digest('hex');
  return { file: path.join(process.env.DRMZ_LEARN_DATA_DIR || path.join(process.cwd(), 'data/learn'), 'spaces-practice', `${id}.json`), context: `spaces/practice/${id}` };
}
export function readPractice(subject: string): PracticeRecord {
  const { file, context } = location(subject);
  try { return parseProtectedJson<PracticeRecord>(fs.readFileSync(file, 'utf8'), context).value; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyPractice(); throw error; }
}
// Synchronous read/modify/atomic rename: requests in this single-process pilot cannot double-award credits.
export function updatePractice(subject: string, action: { type: string; answers?: number[] }) {
  const result = practiceAction(readPractice(subject), action), { file, context } = location(subject);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${randomBytes(8).toString('hex')}.tmp`;
  try { fs.writeFileSync(temp, stringifyProtectedJson(result.state, context), { flag: 'wx', mode: 0o600 }); fs.renameSync(temp, file); }
  finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
  return result;
}
