import { createHash, randomBytes } from 'node:crypto';
import { chmod, mkdir, readFile, rename, rm, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { normalizeEmail } from '@/app/lib/normalizeEmail';
import { didFromEmail, didFromWalletIdentity } from '@/lib/student-did';
import { parseProtectedJson, stringifyProtectedJson } from '@/lib/security/protected-json';

export type LearnWalletChain = 'cardano' | 'midnight' | 'ethereum' | 'solana';

export type LearnWalletIdentity = {
  chain: LearnWalletChain;
  key: string;
  address: string;
  walletName?: string | null;
  network?: string | null;
  linkedAt: string;
};

export type LearnIdentityAccount = {
  id: string;
  did: string;
  email: string | null;
  emailVerifiedAt: string | null;
  wallets: LearnWalletIdentity[];
  createdAt: string;
  updatedAt: string;
};

type IdentityStore = {
  version: 1;
  accounts: Record<string, LearnIdentityAccount>;
  links: Record<string, string>;
};

type PreferredAccount = {
  id: string;
  did?: string | null;
  email?: string | null;
};

const ROOT = process.env.DRMZ_LEARN_DATA_DIR?.trim()
  ? path.join(path.resolve(process.env.DRMZ_LEARN_DATA_DIR.trim()), 'auth', 'learn-identities')
  : path.join(process.cwd(), 'data', 'auth', 'learn-identities');
const STORE_FILE = path.join(ROOT, 'store.json');
const LOCK_DIR = path.join(ROOT, '.lock');
const STORE_CONTEXT = 'auth/learn-identities/store';

function emptyStore(): IdentityStore {
  return { version: 1, accounts: {}, links: {} };
}

function digestId(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 24);
}

function emailLink(email: string): string {
  return `email:${email}`;
}

function walletLink(wallet: Pick<LearnWalletIdentity, 'chain' | 'key'>): string {
  return `wallet:${wallet.chain}:${wallet.key}`;
}

function normalizeWallet(wallet: Omit<LearnWalletIdentity, 'linkedAt'>): LearnWalletIdentity {
  const key = wallet.key.trim();
  const address = wallet.address.trim();
  if (!key || key.length > 512 || !address || address.length > 512) {
    throw new Error('Invalid wallet identity');
  }
  return {
    chain: wallet.chain,
    key:
      wallet.chain === 'ethereum' || wallet.chain === 'cardano' || wallet.chain === 'midnight'
        ? key.toLowerCase()
        : key,
    address,
    walletName: wallet.walletName?.trim().slice(0, 120) || null,
    network: wallet.network?.trim().slice(0, 120) || null,
    linkedAt: new Date().toISOString(),
  };
}

async function ensureRoot(): Promise<void> {
  await mkdir(ROOT, { recursive: true, mode: 0o700 });
  await chmod(ROOT, 0o700).catch(() => undefined);
}

function isMissing(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: unknown }).code === 'ENOENT',
  );
}

async function readStore(): Promise<IdentityStore> {
  try {
    const raw = await readFile(STORE_FILE, 'utf8');
    const parsed = parseProtectedJson<IdentityStore>(raw, STORE_CONTEXT).value;
    if (parsed?.version !== 1 || !parsed.accounts || !parsed.links) {
      throw new Error('Learn identity store is malformed');
    }
    return parsed;
  } catch (error) {
    if (isMissing(error)) return emptyStore();
    throw error;
  }
}

async function writeStore(store: IdentityStore): Promise<void> {
  const temp = path.join(ROOT, `.store.${process.pid}.${randomBytes(6).toString('hex')}.tmp`);
  const payload = stringifyProtectedJson(store, STORE_CONTEXT);
  try {
    await writeFile(temp, payload, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    await rename(temp, STORE_FILE);
    await chmod(STORE_FILE, 0o600).catch(() => undefined);
  } finally {
    await unlink(temp).catch(() => undefined);
  }
}

async function withStoreLock<T>(work: (store: IdentityStore) => T | Promise<T>): Promise<T> {
  await ensureRoot();
  let acquired = false;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      await mkdir(LOCK_DIR, { mode: 0o700 });
      acquired = true;
      break;
    } catch (error) {
      if (!error || typeof error !== 'object' || !('code' in error) || (error as { code?: unknown }).code !== 'EEXIST') {
        throw error;
      }
      const lockStat = await stat(LOCK_DIR).catch(() => null);
      if (lockStat && Date.now() - lockStat.mtimeMs > 15_000) {
        await rm(LOCK_DIR, { recursive: true, force: true });
      } else {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    }
  }
  if (!acquired) throw new Error('Learn identity store is busy. Try again.');

  try {
    const store = await readStore();
    const result = await work(store);
    await writeStore(store);
    return result;
  } finally {
    await rm(LOCK_DIR, { recursive: true, force: true });
  }
}

function ensurePreferredAccount(store: IdentityStore, preferred: PreferredAccount): LearnIdentityAccount {
  const existing = store.accounts[preferred.id];
  if (existing) return existing;

  const email = normalizeEmail(preferred.email);
  if (email) {
    const mapped = store.links[emailLink(email)];
    if (mapped && mapped !== preferred.id) {
      throw new Error('That email is already linked to another DRMZ Learn account.');
    }
  }
  const now = new Date().toISOString();
  const account: LearnIdentityAccount = {
    id: preferred.id,
    did: preferred.did?.trim() || (email ? didFromEmail(email) : didFromWalletIdentity(`subject:${preferred.id}`)),
    email,
    emailVerifiedAt: email ? now : null,
    wallets: [],
    createdAt: now,
    updatedAt: now,
  };
  store.accounts[account.id] = account;
  if (email) store.links[emailLink(email)] = account.id;
  return account;
}

export async function resolveEmailAccount(
  rawEmail: string,
  preferred?: PreferredAccount,
): Promise<LearnIdentityAccount> {
  const email = normalizeEmail(rawEmail);
  if (!email) throw new Error('Valid email required');

  return withStoreLock((store) => {
    const mappedId = store.links[emailLink(email)];
    if (preferred && mappedId && mappedId !== preferred.id) {
      throw new Error('That email is already linked to another DRMZ Learn account.');
    }

    const account = preferred
      ? ensurePreferredAccount(store, preferred)
      : mappedId
        ? store.accounts[mappedId]
        : undefined;
    const now = new Date().toISOString();
    const resolved =
      account ??
      ({
        id: digestId(email),
        did: didFromEmail(email),
        email,
        emailVerifiedAt: now,
        wallets: [],
        createdAt: now,
        updatedAt: now,
      } satisfies LearnIdentityAccount);

    if (resolved.email && resolved.email !== email) {
      throw new Error('This DRMZ Learn account already has a different backup email.');
    }
    resolved.email = email;
    resolved.emailVerifiedAt ??= now;
    resolved.updatedAt = now;
    store.accounts[resolved.id] = resolved;
    store.links[emailLink(email)] = resolved.id;
    return structuredClone(resolved);
  });
}

export async function resolveWalletAccount(
  rawWallet: Omit<LearnWalletIdentity, 'linkedAt'>,
  preferred?: PreferredAccount,
): Promise<LearnIdentityAccount> {
  const wallet = normalizeWallet(rawWallet);
  return withStoreLock((store) => {
    const link = walletLink(wallet);
    const mappedId = store.links[link];
    if (preferred && mappedId && mappedId !== preferred.id) {
      throw new Error('That wallet is already linked to another DRMZ Learn account.');
    }

    const now = new Date().toISOString();
    const account = preferred
      ? ensurePreferredAccount(store, preferred)
      : mappedId
        ? store.accounts[mappedId]
        : undefined;
    const resolved =
      account ??
      ({
        id: digestId(link),
        did: didFromWalletIdentity(link),
        email: null,
        emailVerifiedAt: null,
        wallets: [],
        createdAt: now,
        updatedAt: now,
      } satisfies LearnIdentityAccount);

    const existingWallet = resolved.wallets.find(
      (entry) => entry.chain === wallet.chain && entry.key === wallet.key,
    );
    if (existingWallet) {
      existingWallet.address = wallet.address;
      existingWallet.walletName = wallet.walletName;
      existingWallet.network = wallet.network;
    } else {
      resolved.wallets.push(wallet);
    }
    resolved.updatedAt = now;
    store.accounts[resolved.id] = resolved;
    store.links[link] = resolved.id;
    return structuredClone(resolved);
  });
}

export async function getLearnIdentityAccount(id: string): Promise<LearnIdentityAccount | null> {
  await ensureRoot();
  const store = await readStore();
  return store.accounts[id] ? structuredClone(store.accounts[id]) : null;
}
