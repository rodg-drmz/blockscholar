import type { LearnWalletChain } from './learn-identity-store';

const walletLabels: Record<LearnWalletChain, string> = {
  cardano: 'Cardano', midnight: 'Midnight', ethereum: 'Ethereum / EVM', solana: 'Solana',
};

/** Server-created text: readable in wallet prompts, still bound to this site and nonce. */
export function walletSignInMessage(input: {
  origin: string;
  chain: LearnWalletChain;
  address: string;
  challenge: string;
  nonce: string;
  expiresAt: number;
  linkExistingAccount?: boolean;
}) {
  return [
    'Sign in to DRMZ',
    '',
    'Verify that you own this wallet to sign in to DRMZ.',
    ...(input.linkExistingAccount ? ['This also links this wallet to your signed-in DRMZ account.'] : []),
    'This signature does not cast a vote, send a transaction, or authorize spending.',
    '',
    `Website: ${input.origin}`,
    `Wallet type: ${walletLabels[input.chain]}`,
    `Wallet address: ${input.address}`,
    `Expires: ${new Date(input.expiresAt).toISOString()}`,
    '',
    'Security details (single use):',
    `Request ID: ${input.challenge}`,
    `Nonce: ${input.nonce}`,
    'Message version: 2',
  ].join('\n');
}
