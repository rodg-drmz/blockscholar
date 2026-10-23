/** A login wallet is a provider hint, never authority to change a saved Strike account. */
export function loginWalletProvider(wallets, connection) {
  if (connection?.chain !== 'cardano') return null;
  const name = String(connection.walletName || '').trim().toLowerCase();
  if (!name) return null;
  return wallets.find(wallet => [wallet.id, wallet.name].some(value => String(value || '').trim().toLowerCase() === name)) || null;
}
