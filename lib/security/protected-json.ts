import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';

const ENVELOPE_MARKER = 'drmz.local-json';
const ENVELOPE_VERSION = 1;
const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;

type ProtectedJsonEnvelope = {
  format: typeof ENVELOPE_MARKER;
  version: typeof ENVELOPE_VERSION;
  algorithm: typeof ALGORITHM;
  keyId: string;
  iv: string;
  tag: string;
  ciphertext: string;
};

export type ProtectedJsonResult<T> = {
  value: T;
  encrypted: boolean;
  keyId?: string;
};

export class LocalDataProtectionError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'INVALID_CONFIGURATION'
      | 'ENCRYPTION_KEY_REQUIRED'
      | 'KEY_NOT_AVAILABLE'
      | 'INVALID_JSON'
      | 'INVALID_ENVELOPE'
      | 'DECRYPTION_FAILED'
      | 'PLAINTEXT_REJECTED',
  ) {
    super(message);
    this.name = 'LocalDataProtectionError';
  }
}

function parseBooleanEnv(name: string, fallback = false): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  if (raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on') return true;
  if (raw === '0' || raw === 'false' || raw === 'no' || raw === 'off') return false;
  throw new LocalDataProtectionError(
    `${name} must be true or false.`,
    'INVALID_CONFIGURATION',
  );
}

export function localDataEncryptionPolicy(): {
  encryptWrites: boolean;
  requireEncryptedReads: boolean;
} {
  const requireEncryptedReads = parseBooleanEnv('DRMZ_LOCAL_DATA_REQUIRE_ENCRYPTED');
  return {
    encryptWrites:
      requireEncryptedReads || parseBooleanEnv('DRMZ_LOCAL_DATA_ENCRYPTION_ENABLED'),
    requireEncryptedReads,
  };
}

function decodeKey(raw: string, envName: string): Buffer {
  const trimmed = raw.trim();
  let encoded = trimmed;
  let encoding: 'hex' | 'base64url' = 'base64url';

  if (trimmed.startsWith('hex:')) {
    encoded = trimmed.slice(4);
    encoding = 'hex';
  } else if (trimmed.startsWith('base64:')) {
    encoded = trimmed.slice(7);
  } else if (trimmed.startsWith('base64url:')) {
    encoded = trimmed.slice(10);
  } else if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    encoding = 'hex';
  }

  if (
    (encoding === 'hex' && !/^[0-9a-fA-F]{64}$/.test(encoded)) ||
    (encoding === 'base64url' && !/^[A-Za-z0-9+/_-]+={0,2}$/.test(encoded))
  ) {
    throw new LocalDataProtectionError(
      `${envName} must contain exactly 32 random bytes encoded as hex, base64, or base64url.`,
      'INVALID_CONFIGURATION',
    );
  }

  const key = Buffer.from(encoded, encoding);
  if (key.length !== KEY_BYTES) {
    throw new LocalDataProtectionError(
      `${envName} must decode to exactly 32 random bytes.`,
      'INVALID_CONFIGURATION',
    );
  }
  return key;
}

function keyId(key: Buffer): string {
  return createHash('sha256')
    .update('drmz-local-json-key-id:v1\0')
    .update(key)
    .digest('base64url')
    .slice(0, 16);
}

function configuredKeys(): Array<{ id: string; key: Buffer }> {
  const rows: Array<{ raw: string; name: string }> = [];
  const primary = process.env.DRMZ_LOCAL_DATA_ENCRYPTION_KEY?.trim();
  if (primary) {
    rows.push({ raw: primary, name: 'DRMZ_LOCAL_DATA_ENCRYPTION_KEY' });
  }

  const previous = process.env.DRMZ_LOCAL_DATA_ENCRYPTION_PREVIOUS_KEYS?.trim();
  if (previous) {
    for (const [index, raw] of previous.split(',').map((value) => value.trim()).entries()) {
      if (raw) {
        rows.push({
          raw,
          name: `DRMZ_LOCAL_DATA_ENCRYPTION_PREVIOUS_KEYS[${index}]`,
        });
      }
    }
  }

  const unique = new Map<string, Buffer>();
  for (const row of rows) {
    const key = decodeKey(row.raw, row.name);
    unique.set(keyId(key), key);
  }
  return [...unique].map(([id, key]) => ({ id, key }));
}

function primaryKey(): { id: string; key: Buffer } {
  const raw = process.env.DRMZ_LOCAL_DATA_ENCRYPTION_KEY?.trim();
  if (!raw) {
    throw new LocalDataProtectionError(
      'DRMZ_LOCAL_DATA_ENCRYPTION_KEY is required when local data encryption is enabled.',
      'ENCRYPTION_KEY_REQUIRED',
    );
  }
  const key = decodeKey(raw, 'DRMZ_LOCAL_DATA_ENCRYPTION_KEY');
  return { id: keyId(key), key };
}

function aadFor(context: string): Buffer {
  const normalized = context.trim();
  if (!normalized) {
    throw new LocalDataProtectionError(
      'Protected JSON requires a stable, non-empty context.',
      'INVALID_CONFIGURATION',
    );
  }
  return Buffer.from(`drmz-local-json:v1:${normalized}`, 'utf8');
}

function isEnvelope(value: unknown): value is ProtectedJsonEnvelope {
  return (
    typeof value === 'object' &&
    value !== null &&
    'format' in value &&
    (value as { format?: unknown }).format === ENVELOPE_MARKER
  );
}

function assertEnvelope(value: ProtectedJsonEnvelope): void {
  if (
    value.version !== ENVELOPE_VERSION ||
    value.algorithm !== ALGORITHM ||
    typeof value.keyId !== 'string' ||
    typeof value.iv !== 'string' ||
    typeof value.tag !== 'string' ||
    typeof value.ciphertext !== 'string'
  ) {
    throw new LocalDataProtectionError(
      'Local data contains an unsupported or malformed encrypted envelope.',
      'INVALID_ENVELOPE',
    );
  }
}

export function stringifyProtectedJson<T>(
  value: T,
  context: string,
  options?: { encrypt?: boolean; space?: number },
): string {
  const policy = localDataEncryptionPolicy();
  const encrypt = options?.encrypt ?? policy.encryptWrites;
  const space = options?.space ?? 2;
  if (!encrypt) return JSON.stringify(value, null, space);

  const { id, key } = primaryKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(aadFor(context));
  const plaintext = Buffer.from(JSON.stringify(value), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);

  const envelope: ProtectedJsonEnvelope = {
    format: ENVELOPE_MARKER,
    version: ENVELOPE_VERSION,
    algorithm: ALGORITHM,
    keyId: id,
    iv: iv.toString('base64url'),
    tag: cipher.getAuthTag().toString('base64url'),
    ciphertext: ciphertext.toString('base64url'),
  };
  return JSON.stringify(envelope, null, space);
}

export function parseProtectedJson<T>(
  raw: string,
  context: string,
  options?: { allowPlaintext?: boolean },
): ProtectedJsonResult<T> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new LocalDataProtectionError(
      'Local JSON is malformed; refusing to substitute or overwrite it.',
      'INVALID_JSON',
    );
  }
  if (!isEnvelope(parsed)) {
    const policy = localDataEncryptionPolicy();
    const allowPlaintext = options?.allowPlaintext ?? !policy.requireEncryptedReads;
    if (!allowPlaintext) {
      throw new LocalDataProtectionError(
        'Plaintext local JSON is rejected by DRMZ_LOCAL_DATA_REQUIRE_ENCRYPTED.',
        'PLAINTEXT_REJECTED',
      );
    }
    return { value: parsed as T, encrypted: false };
  }

  assertEnvelope(parsed);
  const match = configuredKeys().find(({ id }) => id === parsed.keyId);
  if (!match) {
    throw new LocalDataProtectionError(
      `No configured local data encryption key matches key id ${parsed.keyId}.`,
      'KEY_NOT_AVAILABLE',
    );
  }

  try {
    const decipher = createDecipheriv(
      ALGORITHM,
      match.key,
      Buffer.from(parsed.iv, 'base64url'),
    );
    decipher.setAAD(aadFor(context));
    decipher.setAuthTag(Buffer.from(parsed.tag, 'base64url'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(parsed.ciphertext, 'base64url')),
      decipher.final(),
    ]);
    return {
      value: JSON.parse(plaintext.toString('utf8')) as T,
      encrypted: true,
      keyId: parsed.keyId,
    };
  } catch (error) {
    if (error instanceof LocalDataProtectionError) throw error;
    throw new LocalDataProtectionError(
      'Encrypted local JSON could not be authenticated or decrypted.',
      'DECRYPTION_FAILED',
    );
  }
}

export function isLocalDataProtectionError(
  error: unknown,
): error is LocalDataProtectionError {
  return error instanceof LocalDataProtectionError;
}
