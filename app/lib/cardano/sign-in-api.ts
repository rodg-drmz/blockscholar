import { findCardanoApi, type Cip30Enabled } from './cip30-connect';

/** Reuse the just-enabled API. Only an existing address-only session needs enable(). */
export async function cardanoSignInApi(walletId: string, enabled?: Cip30Enabled) {
  const api = enabled ?? await findCardanoApi(walletId)?.enable();
  if (!api || typeof api.getChangeAddress !== 'function' || typeof api.signData !== 'function') {
    throw new Error('This Cardano wallet does not support secure message signing. Try Lace, Vespr, Eternl, or email.');
  }
  return api as Omit<Cip30Enabled, 'getChangeAddress' | 'signData'> & {
    getChangeAddress: () => Promise<string>;
    signData: NonNullable<Cip30Enabled['signData']>;
  };
}
