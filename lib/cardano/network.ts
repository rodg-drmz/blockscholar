export type CardanoNetwork = 'mainnet' | 'preprod' | 'preview';

/** Network for Learn burner wallets — preprod-first; override with DRMZ_LEARN_WALLET_NETWORK. */
export function getLearnWalletNetwork(): CardanoNetwork {
  const raw = (
    process.env.DRMZ_LEARN_WALLET_NETWORK ||
    process.env.CARDANO_NETWORK ||
    process.env.NEXT_PUBLIC_CARDANO_NETWORK ||
    'preprod'
  )
    .toLowerCase()
    .trim();

  if (raw === 'mainnet') return 'mainnet';
  if (raw === 'preview') return 'preview';
  return 'preprod';
}

/** Single source of truth for Cardano network (defaults to preprod for safe dev/testing). */
export function getCardanoNetwork(): CardanoNetwork {
  return getLearnWalletNetwork();
}

/** Cardano protocol network id: 0 = testnets (preprod/preview), 1 = mainnet. */
export function cardanoNetworkId(network: CardanoNetwork = getCardanoNetwork()): 0 | 1 {
  return network === 'mainnet' ? 1 : 0;
}

export function isMainnetAddress(address: string): boolean {
  return /^addr1/i.test(address.trim());
}

export function isTestnetAddress(address: string): boolean {
  return /^addr_test/i.test(address.trim());
}

export function addressMatchesNetwork(
  address: string,
  network: CardanoNetwork = getCardanoNetwork()
): boolean {
  const a = address.trim();
  if (!a) return false;
  if (network === 'mainnet') return isMainnetAddress(a);
  return isTestnetAddress(a);
}

export function cardanoTxExplorerUrl(network: CardanoNetwork, txHash: string): string | null {
  const hash = txHash.trim();
  if (!hash) return null;
  if (network === 'mainnet') return `https://cardanoscan.io/transaction/${hash}`;
  if (network === 'preview') return `https://preview.cardanoscan.io/transaction/${hash}`;
  return `https://preprod.cardanoscan.io/transaction/${hash}`;
}
