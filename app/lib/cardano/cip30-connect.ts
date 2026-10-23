import { cardanoAddressToBech32, isCardanoBech32 } from '@/lib/cardano/address-bech32';

export type Cip30Enabled = {
  getUsedAddresses?: (paginate?: { page: number; limit: number }) => Promise<unknown>;
  getUnusedAddresses?: (paginate?: { page: number; limit: number }) => Promise<unknown>;
  getChangeAddress?: () => Promise<unknown>;
  signData?: (address: string, payload: string) => Promise<{ key: string; signature: string }>;
};

export type Cip30Api = {
  name?: string;
  icon?: string;
  enable: (opts?: { extensions?: { cip: number }[] }) => Promise<Cip30Enabled>;
  isEnabled?: () => Promise<boolean>;
};

const WALLET_ALIASES: Record<string, string[]> = {
  vespr: ['vespr'],
  lace: ['lace', 'nami'],
  eternl: ['eternl', 'ccvault'],
  gamechanger: ['gamechanger', 'gc'],
  nami: ['nami'],
  flint: ['flint'],
  nufi: ['nufi'],
  yoroi: ['yoroi'],
};

function cardanoRoot(): Record<string, Cip30Api | undefined> {
  if (typeof window === 'undefined' || !window.cardano) return {};
  return window.cardano as Record<string, Cip30Api | undefined>;
}

export function injectedCardanoWalletKeys(): string[] {
  return Object.entries(cardanoRoot())
    .filter(([, api]) => typeof api?.enable === 'function')
    .map(([key]) => key);
}

function resolveWalletKey(walletId: string): string | undefined {
  const root = cardanoRoot();
  const aliases = WALLET_ALIASES[walletId.toLowerCase()] ?? [walletId.toLowerCase()];
  for (const key of aliases) {
    if (typeof root[key]?.enable === 'function') return key;
    const lower = key.toLowerCase();
    const upper = key.toUpperCase();
    if (typeof root[lower]?.enable === 'function') return lower;
    if (typeof root[upper]?.enable === 'function') return upper;
  }
  const wanted = walletId.toLowerCase();
  return Object.entries(root).find(
    ([key, api]) =>
      typeof api?.enable === 'function' &&
      (key.toLowerCase() === wanted || api.name?.toLowerCase().includes(wanted)),
  )?.[0];
}

export function findCardanoApi(walletId: string): Cip30Api | undefined {
  const key = resolveWalletKey(walletId);
  return key ? cardanoRoot()[key] : undefined;
}

export async function addressToBech32(raw: string): Promise<string> {
  const value = raw.trim();
  if (!value) throw new Error('Wallet did not return an address.');
  if (isCardanoBech32(value)) return value;

  try {
    return cardanoAddressToBech32(value);
  } catch {
    /* fall through to the server decoder */
  }

  const res = await fetch('/api/cardano/address', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address: value }),
  });
  const data = (await res.json()) as { address?: string; error?: string };
  if (!res.ok || !data.address) {
    throw new Error(data.error || 'Could not read that wallet address.');
  }
  return data.address;
}

function firstHexOrBech32(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = firstHexOrBech32(entry);
      if (found) return found;
    }
  }
  if (value && typeof value === 'object' && 'address' in value) {
    return firstHexOrBech32((value as { address: unknown }).address);
  }
  return null;
}

async function readPaymentAddress(enabled: Cip30Enabled): Promise<string> {
  const readers: Array<() => Promise<unknown>> = [
    () => (enabled.getChangeAddress ? enabled.getChangeAddress() : Promise.resolve(undefined)),
    () => (enabled.getUnusedAddresses ? enabled.getUnusedAddresses() : Promise.resolve([])),
    () =>
      enabled.getUnusedAddresses
        ? enabled.getUnusedAddresses({ page: 0, limit: 5 })
        : Promise.resolve([]),
    () => (enabled.getUsedAddresses ? enabled.getUsedAddresses() : Promise.resolve([])),
    () =>
      enabled.getUsedAddresses ? enabled.getUsedAddresses({ page: 0, limit: 5 }) : Promise.resolve([]),
  ];

  for (const read of readers) {
    try {
      const raw = firstHexOrBech32(await read());
      if (raw) return addressToBech32(raw);
    } catch {
      /* Vespr/Lace sometimes throw on unused/used instead of returning [] */
    }
  }

  throw new Error('Wallet connected, but no payment address was returned.');
}

async function enableCip30(api: Cip30Api): Promise<Cip30Enabled> {
  try {
    return await api.enable();
  } catch (first) {
    try {
      return await api.enable({ extensions: [] });
    } catch {
      throw first instanceof Error ? first : new Error('Wallet declined the connection.');
    }
  }
}

async function connectGameChangerWeb(): Promise<{ address: string; name: string }> {
  const injected =
    (window as Window & { gc?: { run?: (script: object) => Promise<unknown> }; gamechanger?: { run?: (script: object) => Promise<unknown> } }).gc
    ?? (window as Window & { gamechanger?: { run?: (script: object) => Promise<unknown> } }).gamechanger;

  if (typeof injected?.run !== 'function') {
    throw new Error(
      'GameChanger is not available here. Open this page in GameChanger’s dApp browser, or install the GameChanger extension, then tap Connect again.',
    );
  }

  const result = (await injected.run({
    type: 'script',
    title: 'Connect to DRMZ Learn',
    description: 'Read-only: share your Cardano address so you can pin an NFT portrait.',
    exportAs: 'learnConnect',
    run: {
      address: { type: 'getCurrentAddress' },
    },
  })) as { response?: { address?: string }; address?: string };

  const address = result?.response?.address ?? result?.address;
  if (!address || typeof address !== 'string') {
    throw new Error('GameChanger did not return an address.');
  }
  return { address: await addressToBech32(address), name: 'gamechanger' };
}

export async function connectCardanoCip30(
  walletId: string,
): Promise<{ address: string; name: string; api?: Cip30Enabled }> {
  const id = walletId.trim().toLowerCase();
  const api = findCardanoApi(id);

  if (!api) {
    if (id === 'gamechanger') {
      return connectGameChangerWeb();
    }
    const installed = injectedCardanoWalletKeys();
    const hint = installed.length
      ? ` This browser has: ${installed.join(', ')}.`
      : ' Unlock Vespr or Lace on this tab, then tap Connect again.';
    throw new Error(`${walletId} is not available in this browser.${hint}`);
  }

  const enabled = await enableCip30(api);
  const address = await readPaymentAddress(enabled);
  return { address, name: id, api: enabled };
}
