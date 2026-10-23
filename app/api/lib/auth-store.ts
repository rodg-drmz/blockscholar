import { randomBytes } from 'node:crypto';
import {
  chmod,
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises';
import path from 'path';
import {
  isLocalDataProtectionError,
  parseProtectedJson,
  stringifyProtectedJson,
} from '@/lib/security/protected-json';

const AUTH_ROOT = process.env.DRMZ_LEARN_DATA_DIR?.trim()
  ? path.join(path.resolve(process.env.DRMZ_LEARN_DATA_DIR.trim()), 'auth')
  : path.join(process.cwd(), 'data', 'auth');

export type MagicLinkRecord = {
  email: string;
  expiresAt: number;
  /** Present when a wallet-first learner is verifying a recovery email. */
  linkSubjectId?: string;
  linkDid?: string | null;
};

async function ensureDir(sub: string) {
  const directory = path.join(AUTH_ROOT, sub);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700).catch(() => undefined);
}

async function writeJson(file: string, value: unknown, context: string): Promise<void> {
  const payload = stringifyProtectedJson(value, context);
  const temp = path.join(
    path.dirname(file),
    `.${path.basename(file)}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`,
  );
  try {
    await writeFile(temp, payload, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    await rename(temp, file);
    await chmod(file, 0o600).catch(() => undefined);
  } finally {
    await unlink(temp).catch(() => undefined);
  }
}

function readJson<T>(raw: string, context: string): T {
  return parseProtectedJson<T>(raw, context).value;
}

function rethrowProtectionError(error: unknown): void {
  if (isLocalDataProtectionError(error)) throw error;
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  );
}

async function consumeJsonFile<T>(file: string, context: string): Promise<T | null> {
  const claimed = `${file}.${process.pid}.${randomBytes(6).toString('hex')}.consuming`;
  try {
    await rename(file, claimed);
  } catch (error) {
    if (isMissingFile(error)) return null;
    throw error;
  }

  try {
    const raw = await readFile(claimed, 'utf8');
    const value = readJson<T>(raw, context);
    await unlink(claimed);
    return value;
  } catch (error) {
    // Preserve a token/challenge when a transient I/O or key configuration error
    // prevents consumption. Atomic rename still permits only one active consumer.
    await rename(claimed, file).catch(() => undefined);
    throw error;
  }
}

export async function saveMagicToken(token: string, record: MagicLinkRecord) {
  await ensureDir('magic');
  await writeJson(
    path.join(AUTH_ROOT, 'magic', `${token}.json`),
    record,
    `auth/magic/${token}`,
  );
}

export async function consumeMagicToken(token: string): Promise<MagicLinkRecord | null> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const file = path.join(AUTH_ROOT, 'magic', `${token}.json`);
  try {
    const record = await consumeJsonFile<MagicLinkRecord>(
      file,
      `auth/magic/${token}`,
    );
    if (!record) return null;
    if (!record?.email || !record?.expiresAt) return null;
    if (Date.now() > record.expiresAt) return null;
    return record;
  } catch (error) {
    rethrowProtectionError(error);
    if (isMissingFile(error)) return null;
    throw error;
  }
}

const challengeDir = path.join(AUTH_ROOT, 'challenges');

export async function saveChallenge(key: string, payload: unknown, ttlMs = 5 * 60 * 1000) {
  await ensureDir('challenges');
  await writeJson(
    path.join(challengeDir, `${key}.json`),
    { payload, expiresAt: Date.now() + ttlMs },
    `auth/challenges/${key}`,
  );
}

export async function consumeChallenge<T>(key: string): Promise<T | null> {
  const file = path.join(challengeDir, `${key}.json`);
  try {
    const record = await consumeJsonFile<{ payload: T; expiresAt: number }>(
      file,
      `auth/challenges/${key}`,
    );
    if (!record) return null;
    const { payload, expiresAt } = record;
    if (Date.now() > expiresAt) return null;
    return payload;
  } catch (error) {
    rethrowProtectionError(error);
    if (isMissingFile(error)) return null;
    throw error;
  }
}
